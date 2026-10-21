"""Run the private fixed-VM readiness probe; never a customer/MCP execution test.

Uses the existing audited worker transport with a current approved engineering
authority. No credential is printed, persisted or substituted for a user session.
"""
import argparse
import datetime
import json
from pathlib import Path
import urllib.error
import urllib.request
from engineering_runtime import EngineeringRuntime, BASE, MANAGEMENT


def run(output, permissions_only=True, version=64, authority_diagnosis=False):
    runtime = EngineeringRuntime()
    status, metadata = runtime._http("GET", MANAGEMENT + "/functions/sandy-deploy-provision", runtime._management)
    if status != 200 or metadata.get("version") != version or metadata.get("status") != "ACTIVE":
        raise RuntimeError("reviewed_computer_readiness_backend_required")
    rows = runtime._sql("""WITH authority AS (
      SELECT c.id FROM public.sandy_engineering_changes c
      WHERE c.id='232d8d7e-ac98-4669-9907-93302303a7c1'
        AND public.sandy_api_current_owner(c.requested_by)
        AND c.status IN('approved','implementing','committed','deployed','verified')
        AND c.scope @> '["sandy-video"]'::jsonb
    ), audit AS (
      INSERT INTO public.sandy_customer_provisioning_events(operation,detail)
      SELECT 'administration.computer.access.preflight',jsonb_build_object(
        'source_change_id',id,'credential_exposed',false,'commands_executed',0)
      FROM authority WHERE (SELECT count(*) FROM vault.secrets WHERE name='SANDY_COMPUTER_WORKER_TOKEN')=1
      RETURNING id
    ) SELECT v.decrypted_secret,a.id audit_id FROM vault.decrypted_secrets v CROSS JOIN audit a
      WHERE v.name='SANDY_COMPUTER_WORKER_TOKEN'""")
    if len(rows) != 1:
        raise RuntimeError("approved_private_readiness_transport_unavailable")
    request = urllib.request.Request(BASE + "/functions/v1/sandy-deploy-provision",
        data=json.dumps({"action": "computer_access_preflight", "permissions_only": permissions_only,
                         "authority_diagnosis": authority_diagnosis}).encode(),
        method="POST", headers={"x-sandy-worker-token": rows[0]["decrypted_secret"], "content-type": "application/json"})
    try:
        response = runtime._opener.open(request, timeout=100)
    except urllib.error.HTTPError as error:
        response = error
    with response:
        status, result = response.status, json.loads(response.read(100001))
    report = {"observed_at": datetime.datetime.now(datetime.timezone.utc).isoformat(),
        "backend_version": version, "http_status": status, "administrative_transport_audit_id": rows[0]["audit_id"],
        "customer_MCP_proof": False, "result": result}
    output.write_text(json.dumps(report, indent=2) + "\n")
    print(json.dumps(report))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--connect", action="store_true", help="One tunnel attempt per fixed target; default tests permissions only")
    parser.add_argument("--backend-version", type=int, default=64)
    parser.add_argument("--authority-diagnosis", action="store_true", help="Read exact IAP policies, target permissions and Windows guest evidence without opening tunnels")
    args = parser.parse_args()
    run(args.output, not args.connect, args.backend_version, args.authority_diagnosis)
