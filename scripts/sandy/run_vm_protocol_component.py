"""Validate the closed native protocol candidate inside one full ROLLBACK.

Synthetic identity/approval/Vault fixtures test the SQL boundary only. This does
not create an authenticated session, call a VM, activate tools or certify effects.
"""
import argparse
import datetime
import hashlib
import json
from pathlib import Path
from engineering_runtime import EngineeringRuntime, MANAGEMENT

ROOT = Path(__file__).resolve().parents[2]


def run(output):
    files = [ROOT / "supabase/migrations/20261021008900_sandy_vm_protocol_boundary.sql",
             ROOT / "supabase/migrations/20261021008910_sandy_vm_protocol_contracts.sql",
             ROOT / "supabase/functions/sandy-vm-protocol-api/custody_test.sql"]
    query = "BEGIN; SET TRANSACTION ISOLATION LEVEL REPEATABLE READ;\n"
    query += "CREATE TEMP TABLE vm_registry_snapshot ON COMMIT DROP AS SELECT operation,to_jsonb(r) document FROM public.sandy_operation_registry r;\n"
    query += "\n".join("\n".join(line for line in path.read_text().splitlines()
                                if line.strip() not in ("BEGIN;", "COMMIT;", "ROLLBACK;")) for path in files)
    query += "\nROLLBACK;\n"
    assert "\nCOMMIT;" not in query
    runtime = EngineeringRuntime()
    status, body = runtime._http("POST", MANAGEMENT + "/database/query", runtime._management,
                                 {"query": query, "read_only": False})
    report = {"timestamp_utc": datetime.datetime.now(datetime.timezone.utc).isoformat(),
              "http_status": status, "full_rollback": True, "actual_auth_session": False,
              "actual_provider_calls": 0, "catalogue_activated": False,
              "query_sha256": hashlib.sha256(query.encode()).hexdigest(),
              "source_sha256": {str(path.relative_to(ROOT)): hashlib.sha256(path.read_bytes()).hexdigest() for path in files},
              "result": body}
    output.write_text(json.dumps(report, indent=2) + "\n")
    if status not in (200, 201):
        raise RuntimeError("vm_protocol_component_failed; inspect protected evidence file")
    evidence = body[0]["evidence"]
    if evidence.get("passed") is not True or evidence.get("checks") != 53:
        raise RuntimeError("vm_protocol_expected_component_checks_missing")
    report["independent_cleanup"] = runtime._sql("SELECT to_regclass('public.sandy_vm_protocol_contracts') IS NULL AS candidate_tables_absent, (SELECT count(*) FROM auth.users WHERE email LIKE 'sandy-vm-protocol-rollback-%@example.invalid') AS fixture_users", True)
    if report["independent_cleanup"] != [{"candidate_tables_absent": True, "fixture_users": 0}]:
        raise RuntimeError("vm_protocol_component_cleanup_failed")
    output.write_text(json.dumps(report, indent=2) + "\n")
    print(json.dumps({"checks": evidence["checks"], "http_status": status, "full_rollback": True, "provider_called": False}))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, required=True)
    run(parser.parse_args().output)
