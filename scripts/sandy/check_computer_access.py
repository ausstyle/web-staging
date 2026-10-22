"""Check fixed-VM readiness, or use --canonical-read for actual MCP metadata access.

Uses the existing audited worker transport with a current approved engineering
authority. No credential is printed, persisted or substituted for a user session.
"""
import argparse
import datetime
import json
import hashlib
import re
import uuid
from pathlib import Path
import urllib.error
import urllib.request
from engineering_runtime import EngineeringRuntime, BASE, MANAGEMENT


def run(output, permissions_only=True, version=66, authority_diagnosis=False):
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


def canonical_read_result(http_status, response):
    """Project only safe evidence; HTTP 200 alone never establishes execution."""
    try:
        result = response["result"]
        envelope = json.loads(result["content"][0]["text"])
        api = envelope["result"]
        payload = result.get("structuredContent") or {}
        vm = payload.get("result") or {}
        admission = api.get("admission_id")
        valid_admission = isinstance(admission, str) and str(uuid.UUID(admission)) == admission
        proof = {"http_status": http_status, "MCP_is_error": result.get("isError"),
            "API_status": envelope.get("status"), "executed": api.get("executed"),
            "admission_id": admission, "request_id": api.get("request_id"),
            "provider_http_status": payload.get("provider_http_status"),
            "provider_instance_id": vm.get("id"), "provider_instance_name": vm.get("name"),
            "provider_instance_status": vm.get("status")}
        if isinstance(api.get("error"), str) and re.fullmatch(r"[a-z][a-z0-9_]{1,100}", api["error"]):
            proof["error"] = api["error"]
        proof["passed"] = (http_status == 200 and result.get("isError") is False
            and envelope.get("status") == 200 and api.get("ok") is True
            and api.get("executed") is True and payload.get("executed") is True
            and payload.get("provider_http_status") == 200 and valid_admission
            and vm.get("id") == "6831598645020395570" and vm.get("name") == "sandy-video")
        return proof
    except (KeyError, IndexError, TypeError, ValueError, AttributeError):
        return {"http_status": http_status, "passed": False, "error": "invalid_MCP_provider_read_evidence"}


def run_canonical_read(output, runtime=None):
    # Reuse the permanent normal-Auth runtime. This does not issue an owner
    # delegation, modify registry flags, acquire SSH access or change resources.
    from jsonschema import Draft202012Validator
    runtime = runtime or EngineeringRuntime()
    status, discovery = runtime.invoke({"jsonrpc": "2.0", "id": str(uuid.uuid4()),
        "method": "tools/list", "params": {}})
    tools = discovery.get("result", {}).get("tools", []) if isinstance(discovery, dict) else []
    tool = next((t for t in tools if t.get("name") == "gcp.compute.instances.get"), None)
    if status != 200 or not tool:
        raise RuntimeError("canonical_VM_read_not_authorized_or_discoverable")
    for entry in tools:
        Draft202012Validator.check_schema(entry["inputSchema"])
    args = {"path": {"instance": "sandy-video"}}
    Draft202012Validator(tool["inputSchema"]).validate(args)
    status, response = runtime.invoke({"jsonrpc": "2.0", "id": str(uuid.uuid4()),
        "method": "tools/call", "params": {"name": "gcp.compute.instances.get", "arguments": args}})
    proof = canonical_read_result(status, response)
    report = {"observed_at": datetime.datetime.now(datetime.timezone.utc).isoformat(),
        "operation": "gcp.compute.instances.get", "arguments": args,
        "authenticated_MCP_proof": True, "identity_kind": "dedicated_nonowner_workload",
        "scope": "existing owner-delegated fixed VM read only",
        "remote_command_executed": False, "discovered_tools": len(tools),
        "all_discovered_input_schemas_valid": True, "result": proof,
        "response_sha256": hashlib.sha256(json.dumps(response, sort_keys=True).encode()).hexdigest()}
    output.write_text(json.dumps(report, indent=2) + "\n")
    print(json.dumps(report))
    if not proof["passed"]:
        raise RuntimeError("canonical_VM_read_not_verified")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--connect", action="store_true", help="One tunnel attempt per fixed target; default tests permissions only")
    parser.add_argument("--backend-version", type=int, default=66)
    parser.add_argument("--authority-diagnosis", action="store_true", help="Read exact IAP policies, target permissions and Windows guest evidence without opening tunnels")
    parser.add_argument("--canonical-read", action="store_true", help="Use normal authenticated MCP discovery/call through the shared provider engine; no tunnel attempt")
    args = parser.parse_args()
    if args.canonical_read:
        if args.connect or args.authority_diagnosis:
            parser.error("canonical read cannot be combined with private tunnel diagnostics")
        run_canonical_read(args.output)
    else:
        run(args.output, not args.connect, args.backend_version, args.authority_diagnosis)
