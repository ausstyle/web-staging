"""Real database/REST link completion checks, never external OTP verification.

The service-role requests exercise the existing trusted-ingress RPC boundary;
they are not substituted for customer sessions. No email or WhatsApp is sent.
"""
import argparse
from concurrent.futures import ThreadPoolExecutor
import hashlib
import json
from pathlib import Path
import re
import secrets
import uuid
from engineering_runtime import EngineeringRuntime, BASE

ROOT = Path(__file__).resolve().parents[2]
MIGRATION = ROOT / "supabase/migrations/20261021161000_sandy_atomic_whatsapp_link.sql"
TEST = ROOT / "scripts/sandy/test_customer_channel_link_rollback.sql"


def run(output, candidate=False):
    runtime = EngineeringRuntime()
    source = MIGRATION.read_text()
    ddl = re.sub(r"COMMIT;\s*$", "", re.sub(r"(?m)^BEGIN;", "", source, count=1)) if candidate else ""
    rows = runtime._sql("BEGIN;\n" + ddl + "\n" + TEST.read_text() + "\nROLLBACK;")
    report = {"migration_sha256": hashlib.sha256(MIGRATION.read_bytes()).hexdigest(),
              "test_sha256": hashlib.sha256(TEST.read_bytes()).hexdigest(),
              "candidate_ddl_rolled_back": candidate, "rollback_result": rows,
              "external_provider_verified": False, "customer_session_substitution": False,
              "normal_customer_mcp_test": False, "messages_sent": 0}

    def save():
        output.parent.mkdir(parents=True, exist_ok=True)
        output.write_text(json.dumps(report, indent=2) + "\n")

    save()
    assert rows == [{"passed": 33, "failed": 0, "rolled_back": True, "external_provider_verified": False}]
    cleanup = runtime._sql("SELECT count(*) customers FROM public.email_customers WHERE display_name='Isolated channel link fixture'", True)
    report["rollback_cleanup"] = cleanup
    assert cleanup == [{"customers": 0}]
    if candidate:
        save()
        print(json.dumps({"passed": 33, "failed": 0, "rolled_back": True}))
        return

    customer, challenge = str(uuid.uuid4()), str(uuid.uuid4())
    email = "sandy-link-concurrency-" + customer + "@example.invalid"
    wa = "1555" + str(secrets.randbelow(10 ** 10)).zfill(10)
    proof = secrets.token_hex(32)
    q = runtime._quote
    try:
        # This setup is explicit Management administration, not a claimed user
        # or provider identity. Excluded Drive provisioning prevents side effects.
        runtime._sql("BEGIN;INSERT INTO public.email_customers(id,display_name,google_drive_folder_status) VALUES(" + q(customer) + ",'Isolated channel concurrency fixture','excluded');"
                     "INSERT INTO public.email_customer_addresses(customer_id,email_address,is_primary) VALUES(" + q(customer) + "," + q(email) + ",true);"
                     "INSERT INTO public.sandy_whatsapp_link_challenges(id,wa_id,customer_id,email,code_hash,expires_at) VALUES(" + q(challenge) + "," + q(wa) + "," + q(customer) + "," + q(email) + "," + q(proof) + ",clock_timestamp()+interval '10 minutes');COMMIT;")
        keys = runtime._api_keys()
        args = {"p_wa_id": wa, "p_challenge_id": challenge, "p_candidate_hash": proof}
        endpoint = BASE + "/rest/v1/rpc/sandy_customer_whatsapp_link_finish"
        status, _ = runtime._http("POST", endpoint, keys["anon"], args, keys["anon"])
        report["anonymous_rpc_denied_http"] = status
        assert status in (401, 403, 404)

        def complete(_):
            status, value = runtime._http("POST", endpoint, keys["service_role"], args, keys["service_role"])
            return {"http_status": status, **{k: value.get(k) for k in ("ok", "state", "error", "identity_merged") if k in value}}

        with ThreadPoolExecutor(max_workers=2) as pool:
            results = list(pool.map(complete, range(2)))
        report["concurrent_trusted_ingress_results"] = results
        assert all(r["http_status"] == 200 for r in results)
        assert sum(r.get("ok") is True for r in results) == 1
        assert sum(r.get("error") == "link_challenge_unavailable" for r in results) == 1
        proof_state = runtime._sql("SELECT (SELECT used_at IS NOT NULL FROM public.sandy_whatsapp_link_challenges WHERE id=" + q(challenge) + ") consumed,"
                                  "(SELECT customer_id=" + q(customer) + "::uuid AND verification_status='verified' AND allowed_scopes=ARRAY['memory_read','email_read'] FROM public.sandy_whatsapp_identities WHERE wa_id=" + q(wa) + ") bound,"
                                  "(SELECT count(*) FROM public.sandy_customer_channel_link_audit WHERE challenge_id=" + q(challenge) + " AND event_type='verified') successful_audits", True)
        report["independent_concurrency_readback"] = proof_state
        assert proof_state == [{"consumed": True, "bound": True, "successful_audits": 1}]
        report["concurrency_verified"] = True
    finally:
        # The target is restricted to these generated fixture IDs, even if an
        # earlier request's network outcome was unknown. Never delete by phone alone.
        runtime._sql("BEGIN;DELETE FROM public.sandy_customer_channel_link_audit WHERE challenge_id=" + q(challenge) + ";"
                     "DELETE FROM public.sandy_whatsapp_link_challenges WHERE id=" + q(challenge) + " AND customer_id=" + q(customer) + ";"
                     "DELETE FROM public.sandy_whatsapp_identities WHERE wa_id=" + q(wa) + " AND customer_id=" + q(customer) + ";"
                     "DELETE FROM public.email_customer_addresses WHERE customer_id=" + q(customer) + ";"
                     "DELETE FROM public.email_customers WHERE id=" + q(customer) + ";COMMIT;")
        report["fixture_cleanup"] = runtime._sql("SELECT (SELECT count(*) FROM public.email_customers WHERE id=" + q(customer) + ") customers,"
                                                 "(SELECT count(*) FROM public.sandy_whatsapp_link_challenges WHERE id=" + q(challenge) + ") challenges,"
                                                 "(SELECT count(*) FROM public.sandy_whatsapp_identities WHERE wa_id=" + q(wa) + " AND customer_id=" + q(customer) + ") identities,"
                                                 "(SELECT count(*) FROM public.sandy_customer_channel_link_audit WHERE challenge_id=" + q(challenge) + ") audits", True)
        save()
    assert report["fixture_cleanup"] == [{"customers": 0, "challenges": 0, "identities": 0, "audits": 0}]
    report["complete"] = True
    save()
    print(json.dumps({"passed": 33, "concurrent_completion_verified": True, "anonymous_rpc_denied": True,
                      "fixture_cleanup_verified": True, "external_provider_verified": False}))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--candidate", action="store_true")
    parser.add_argument("--output", type=Path, required=True)
    arguments = parser.parse_args()
    run(arguments.output, arguments.candidate)
