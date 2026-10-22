"""Real database component checks; all fixtures and candidate DDL roll back.

Uses the authorized Management API for database engineering. Synthetic claims
exercise SQL role checks only and are never represented as customer sessions or
provider webhook verification. No provider message is sent.
"""
import argparse
import hashlib
import json
from pathlib import Path
import re
import urllib.error
import urllib.request
from engineering_runtime import EngineeringRuntime, MANAGEMENT

ROOT = Path(__file__).resolve().parents[2]
MIGRATION = ROOT / "supabase/migrations/20261021160000_sandy_customer_ingress_observation.sql"
TEST = ROOT / "scripts/sandy/test_customer_ingress_rollback.sql"


def run(output, candidate=False):
    runtime = EngineeringRuntime()
    source = MIGRATION.read_text()
    ddl = ""
    if candidate:
        ddl = re.sub(r"(?m)^BEGIN;", "", source, count=1)
        ddl = re.sub(r"COMMIT;\s*$", "", ddl)
    query = "BEGIN;\n" + ddl + "\n" + TEST.read_text() + "\nROLLBACK;"
    request = urllib.request.Request(
        MANAGEMENT + "/database/query", method="POST",
        headers={"authorization": "Bearer " + runtime._management,
                 "content-type": "application/json"},
        data=json.dumps({"query": query, "read_only": False}).encode(),
    )
    try:
        response = runtime._opener.open(request, timeout=120)
    except urllib.error.HTTPError as error:
        response = error
    with response:
        status, raw = response.status, response.read()
    value = json.loads(raw)
    report = {
        "http_status": status,
        "migration_sha256": hashlib.sha256(MIGRATION.read_bytes()).hexdigest(),
        "test_sha256": hashlib.sha256(TEST.read_bytes()).hexdigest(),
        "candidate_ddl_rolled_back": candidate,
        "result": value,
        "external_provider_webhook_verified": False,
        "normal_auth_mcp_test": False,
    }
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(report, indent=2) + "\n")
    if status not in (200, 201) or len(value) != 1 or value[0].get("failed") != 0 or value[0].get("passed") != 27 or value[0].get("rolled_back") is not True:
        raise RuntimeError("customer_ingress_component_failed; inspect protected evidence file")
    # Verify a separate committed snapshot, rather than trusting ROLLBACK alone.
    cleanup = runtime._sql(
        "SELECT (SELECT count(*) FROM public.email_customers WHERE display_name IN('Isolated ingress fixture','Isolated second ingress fixture')) customers,"
        "(SELECT count(*) FROM public.sandy_customer_provisional_contacts WHERE subject LIKE 'sandy-ingress-%@example.invalid' OR subject LIKE 'unknown-%@example.invalid') contacts,"
        "(SELECT count(*) FROM public.sandy_whatsapp_messages WHERE meta_message_id LIKE 'sandy-ingress-%') messages", True,
    )
    report["postrollback_fixture_counts"] = cleanup
    output.write_text(json.dumps(report, indent=2) + "\n")
    if cleanup != [{"customers": 0, "contacts": 0, "messages": 0}]:
        raise RuntimeError("customer_ingress_fixture_cleanup_not_verified")
    print(json.dumps({"passed": 27, "failed": 0, "rollback_cleanup_verified": True,
                      "external_provider_webhook_verified": False}))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--candidate", action="store_true")
    parser.add_argument("--output", type=Path, required=True)
    arguments = parser.parse_args()
    run(arguments.output, arguments.candidate)
