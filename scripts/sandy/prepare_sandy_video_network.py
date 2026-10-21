"""Bounded existing-VM network prerequisite using existing Sandy application code.

Management authorizes deployment/setup; the private backend checks a genuine
current owner-approved change. This is not a customer session or MCP write test.
A fresh normal-workload MCP call independently verifies the resulting network.
No NAT, public address, IAM grant, firewall or provider purchase is requested.
"""
import argparse
import hashlib
import json
from pathlib import Path
import re
import urllib.error
import urllib.request
import uuid
from engineering_runtime import EngineeringRuntime, BASE, MANAGEMENT

ROOT = Path(__file__).resolve().parents[2]
MIGRATION = ROOT / "supabase/migrations/20261021162000_sandy_video_network_preparation.sql"
TEST = ROOT / "scripts/sandy/test_video_network_prepare_rollback.sql"
CHANGE = "232d8d7e-ac98-4669-9907-93302303a7c1"


def component(runtime, candidate):
    source = MIGRATION.read_text()
    ddl = re.sub(r"COMMIT;\s*$", "", re.sub(r"(?m)^BEGIN;", "", source, count=1)) if candidate else ""
    query = "BEGIN;SELECT set_config('sandy.fixture.vm_change','" + CHANGE + "',true);\n" + ddl + "\n" + TEST.read_text() + "\nROLLBACK;"
    rows = runtime._sql(query)
    assert rows == [{"passed": 24, "failed": 0, "rolled_back": True, "provider_calls": False}]
    return {"result": rows, "migration_sha256": hashlib.sha256(MIGRATION.read_bytes()).hexdigest(),
            "test_sha256": hashlib.sha256(TEST.read_bytes()).hexdigest(), "candidate_ddl_rolled_back": candidate}


def run(output, candidate=False, apply=False, backend_version=60):
    runtime = EngineeringRuntime()
    report = {"component": component(runtime, candidate), "provider_write_invoked_through_mcp": False,
              "actor_kind": "management_administration_using_private_Sandy_backend",
              "source_change_id": CHANGE, "remote_execution_verified": False, "conference_verified": False}

    def save():
        output.parent.mkdir(parents=True, exist_ok=True)
        output.write_text(json.dumps(report, indent=2) + "\n")

    save()
    if not apply:
        print(json.dumps({"database_checks_passed": 24, "provider_calls": False}))
        return
    assert not candidate
    status, metadata = runtime._http("GET", MANAGEMENT + "/functions/sandy-deploy-provision", runtime._management)
    assert status == 200 and metadata.get("version") == backend_version and metadata.get("status") == "ACTIVE" and metadata.get("verify_jwt") is False
    keys = runtime._api_keys()
    backend = BASE + "/functions/v1/sandy-deploy-provision"
    # The actual deployed backend already supports this private worker identity.
    # Management key JWTs may differ from its historical environment service key.
    # Reuse the supported transport, never export a key to reports or use it as
    # a Controller/customer session. Delivery requires the same genuine approval.
    delivery = runtime._sql("WITH authority AS (SELECT c.id,c.requested_by FROM public.sandy_engineering_changes c WHERE c.id=" + runtime._quote(CHANGE) +
                           " AND public.sandy_api_current_owner(c.requested_by) AND c.status IN('approved','implementing','committed','deployed','verified')"
                           " AND c.scope @> '[\"sandy-video\",\"video.install\",\"osconfig.googleapis.com\",\"google_cloud:network\"]'::jsonb"
                           " AND EXISTS(SELECT 1 FROM public.sandy_engineering_change_events e WHERE e.change_id=c.id AND e.actor=c.requested_by AND ((e.event_type='status_changed' AND e.detail->>'to'='approved') OR e.event_type='delegated_auto_approved'))),"
                           "audit AS (INSERT INTO public.sandy_customer_provisioning_events(operation,detail) SELECT 'administration.video.network.worker_transport',jsonb_build_object('administrative_session_user',session_user,'source_change_id',id,'owner_authority_id',requested_by,'recipient','prepare_sandy_video_network.py','credential_class','existing_private_worker','credential_exposed',false) FROM authority WHERE (SELECT count(*) FROM vault.secrets WHERE name='SANDY_COMPUTER_WORKER_TOKEN')=1 RETURNING id)"
                           " SELECT v.decrypted_secret,a.id audit_id FROM vault.decrypted_secrets v CROSS JOIN audit a WHERE v.name='SANDY_COMPUTER_WORKER_TOKEN'")
    if len(delivery) != 1 or not isinstance(delivery[0].get("decrypted_secret"), str):
        raise RuntimeError("existing_authorized_private_worker_transport_unavailable")
    worker_credential = delivery[0]["decrypted_secret"]
    report["private_transport"] = {"kind": "existing_Vault_worker_authentication", "delivery_audit_id": delivery[0]["audit_id"], "customer_session": False}
    delivery = None

    def redact(value):
        if isinstance(value, str):
            for credential in (worker_credential, keys["service_role"], keys["anon"]):
                value = value.replace(credential, "[REDACTED]")
            return re.sub(r"eyJ[A-Za-z0-9._-]{15,}|ya29\.[A-Za-z0-9._-]{10,}|Bearer\s+[A-Za-z0-9._~+/-]+", "[REDACTED]", value)
        if isinstance(value, dict):
            return {key: redact(item) for key, item in value.items()}
        if isinstance(value, list):
            return [redact(item) for item in value]
        return value

    def invoke_backend(body):
        if body.get("action") not in ("video_network_preflight", "video_network_prepare"):
            raise RuntimeError("private_transport_action_denied")
        request = urllib.request.Request(backend, method="POST", data=json.dumps(body).encode(),
                                         headers={"apikey": keys["anon"], "x-sandy-worker-token": worker_credential,
                                                  "content-type": "application/json"})
        try:
            response = runtime._opener.open(request, timeout=120)
        except urllib.error.HTTPError as error:
            response = error
        with response:
            return response.status, redact(json.loads(response.read()))

    status, before = invoke_backend({"action": "video_network_preflight"})
    report["preparation_preflight"] = {"http_status": status, "ok": before.get("ok"), "subnetwork_http": before.get("subnetwork_http"), "error": before.get("error")}
    save()
    assert status == 200 and before.get("ok") is True and before.get("subnetwork_http") == 200
    controls = ["external_ip_present", "network_tags", "nat_routers", "video_firewall_rules"]
    assert all(key in before for key in controls)
    report["prior_private_google_access_enabled"] = before.get("private_google_access_enabled")
    rid = str(uuid.uuid4())
    report["request_id"] = rid
    save()
    status, result = invoke_backend({"action": "video_network_prepare", "change_id": CHANGE, "request_id": rid})
    allowed = {"ok", "request_id", "phase", "mutation_attempted", "accepted", "operation_name", "subnetwork", "prior_private_google_access",
               "private_google_access_enabled", "configuration_verified", "reconciliation_required", "automatic_retry", "iam_changed", "public_ip_added",
               "firewall_changed", "nat_created", "paid_resource_created", "error", "google_http", "google_error_status", "google_error_message"}
    assert isinstance(result, dict) and set(result) <= allowed
    report["administrative_preparation"] = {"http_status": status, "result": result}
    save()
    # A rejected/unknown mutation is retained and never automatically retried.
    if status not in (200, 202) or result.get("ok") is not True:
        report["provider_blocker_or_unknown"] = True
        save()
        runtime._sql("UPDATE public.sandy_operation_registry SET last_test_result=coalesce(last_test_result,'{}'::jsonb)||jsonb_build_object('video_network_repair_20261021'," + runtime._quote(json.dumps(report)) + "::jsonb),updated_at=now() WHERE operation='video.network.preflight'")
        print(json.dumps({"network_preparation_verified": False, "http_status": status, "error": result.get("error"),
                          "google_http": result.get("google_http"), "google_error_status": result.get("google_error_status")}))
        return
    status, value = runtime.invoke({"jsonrpc": "2.0", "id": str(uuid.uuid4()), "method": "tools/call",
                                    "params": {"name": "video.network.preflight", "arguments": {}}})
    mcp = value.get("result", {})
    envelope = json.loads(mcp.get("content", [{}])[0].get("text", "{}"))
    actual = mcp.get("structuredContent", {})
    verified = status == 200 and envelope.get("status") == 200 and mcp.get("isError") is False and actual.get("ok") is True and actual.get("private_google_access_enabled") is True
    unchanged = all(key in actual and actual[key] == before[key] for key in controls)
    report["mcp_network_readback"] = {"http_status": status, "api_status": envelope.get("status"), "is_error": mcp.get("isError"),
                                       "private_google_access_enabled": actual.get("private_google_access_enabled"), "verified": verified,
                                       "existing_controls_unchanged": unchanged, "compared_controls": controls,
                                       "controls_sha256": hashlib.sha256(json.dumps({key: before[key] for key in controls}, sort_keys=True).encode()).hexdigest()}
    report["administrative_audit_readback"] = runtime._sql("SELECT id,actor_id,customer_id,operation,detail FROM public.sandy_customer_provisioning_events WHERE request_id=" + runtime._quote(rid) + " ORDER BY id", True)
    report["network_configuration_verified"] = verified and unchanged
    report["guest_google_api_connectivity_verified"] = False
    save()
    evidence = runtime._quote(json.dumps(report)) + "::jsonb"
    runtime._sql("UPDATE public.sandy_operation_registry SET last_test_result=coalesce(last_test_result,'{}'::jsonb)||jsonb_build_object('video_network_repair_20261021'," + evidence + "),updated_at=now() WHERE operation='video.network.preflight'")
    assert verified and unchanged
    print(json.dumps({"network_configuration_verified": True, "mcp_readback_verified": True, "existing_controls_unchanged": True,
                      "remote_execution_verified": False, "conference_verified": False}))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--candidate", action="store_true")
    parser.add_argument("--apply", action="store_true")
    parser.add_argument("--backend-version", type=int, default=60)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    run(args.output, args.candidate, args.apply, args.backend_version)
