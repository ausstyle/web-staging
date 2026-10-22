"""Observe the approved two-VM canary through normal authenticated MCP.

This does not enroll an agent or certify OS effects. A disabled enrollment is a
mandatory safety precondition for these dependency probes. Each call is saved
before dispatch and never retried automatically after an uncertain outcome.
"""
from pathlib import Path
import argparse
import datetime
import hashlib
import json
import uuid

from jsonschema import Draft202012Validator
from engineering_runtime import EngineeringRuntime

ROOT = Path(__file__).resolve().parents[2]
PROPOSAL = ROOT / "docs/sandy-engineering/policies/engineering-computer-canary-proposal.json"
CONTRACTS = ROOT / "supabase/functions/sandy-guest-operation-api/contracts.json"
CLASSES = ("guest_read", "guest_files_write", "guest_services_write", "guest_packages_write")


def verify(output: Path, resume_discovery=False):
    previous = json.loads(output.read_text()) if output.exists() else None
    if previous is not None and not (resume_discovery and previous.get("complete") is False and
            all(c.get("method") == "tools/list" and c.get("complete") is True for c in previous.get("calls", []))):
        raise RuntimeError("existing_evidence_requires_reconciliation_not_replay")
    runtime = EngineeringRuntime()
    quote = runtime._quote
    proposal = json.loads(PROPOSAL.read_text())
    uid = proposal["identity_user_id"]
    delegation = runtime._sql("SELECT version,policy,source_sha256,expires_at,revoked_at FROM public.sandy_engineering_standing_delegations WHERE identity_user_id=" + quote(uid), True)[0]
    assert delegation["version"] == 6 and delegation["policy"] == proposal["policy"] and delegation["revoked_at"] is None
    assert runtime.public_status()["controller_memberships"] == 0
    expected = runtime._sql("SELECT operation FROM public.sandy_engineering_operation_classes WHERE operation_class=ANY(ARRAY[" + ",".join(map(quote, CLASSES)) + "]) ORDER BY operation", True)
    expected = {x["operation"] for x in expected}
    assert len(expected) == 10
    proof = previous or {"observed_at": datetime.datetime.now(datetime.timezone.utc).isoformat(),
             "delegation_version": 6, "normal_renewable_Auth": True,
             "personal_Controller_session_used": False, "calls": [],
             "complete": False, "VM_commands_executed": 0,
             "provider_effects_verified": False}

    def save():
        output.write_text(json.dumps(proof, indent=2) + "\n")
        output.chmod(0o600)

    def invoke(method, params):
        observation = {"MCP_id": str(uuid.uuid4()), "method": method, "params": params, "complete": False}
        proof["calls"].append(observation)
        save()
        status, response = runtime.invoke({"jsonrpc": "2.0", "id": observation["MCP_id"], "method": method, "params": params})
        observation.update(HTTP_status=status, response=response, complete=True)
        save()
        assert status == 200
        return observation

    tools = {}
    cursor = None
    for page in range(10):
        if previous is not None:
            value = previous["calls"][page]["response"]["result"]
        else:
            value = invoke("tools/list", {} if cursor is None else {"cursor": cursor})["response"]["result"]
        for tool in value["tools"]:
            assert tool["name"] not in tools
            tools[tool["name"]] = tool
        cursor = value.get("nextCursor")
        if cursor is None:
            break
    else:
        raise RuntimeError("discovery_page_limit")
    assert expected <= tools.keys()
    forbidden = {"gcp.vm.access.bootstrap", "gcp.vm.agent.install", "gcp.vm.ssh.exec", "gcp.vm.winrm.exec", "gcp.vm.reboot", "gcp.vm.firewall_guest.manage"}
    assert not forbidden.intersection(tools)
    contracts = {x["operation"]: x for x in json.loads(CONTRACTS.read_text())["operations"]}
    for name in expected:
        advertised = tools[name]["inputSchema"]
        assert advertised.get("$defs", {}).get("sandy_api_arguments", advertised) == contracts[name]["input_schema"]
        Draft202012Validator.check_schema(tools[name]["inputSchema"])
    proof["discovery"] = {"tools": len(tools), "pages": page + 1, "canary_tools": sorted(expected), "exact_typed_schemas": True, "restricted_operations_absent": True}
    save()

    def call(name, args, expected_status, expected_error, admitted):
        Draft202012Validator(tools[name]["inputSchema"]).validate(args)
        request_id = str(uuid.uuid4())
        result = invoke("tools/call", {"name": name, "arguments": {"__sandy_execution": {"request_id": request_id}, "arguments": args}})
        mcp = result["response"]["result"]
        envelope = json.loads(mcp["content"][0]["text"])
        api = envelope["result"]
        admissions = runtime._sql("SELECT a.id,a.state,a.provider_http_status,a.result_sha256,e.delegation_version,j.status job_status,j.approved_by,j.approved_at FROM public.sandy_api_execution_admissions a JOIN public.sandy_engineering_execution_authorizations e ON e.job_id=a.approval_id JOIN public.sandy_deployment_jobs j ON j.id=e.job_id WHERE a.request_id=" + quote(request_id), True)
        jobs = runtime._sql("SELECT id,state FROM public.sandy_guest_jobs WHERE request_id=" + quote(request_id), True)
        result["proof"] = {"operation": name, "request_id": request_id, "API_status": envelope["status"], "error": api.get("error"), "executed": api.get("executed"), "admissions": admissions, "guest_jobs": jobs}
        save()
        assert envelope["status"] == expected_status and api.get("error") == expected_error and api.get("executed") is False
        assert mcp["isError"] is True and len(admissions) == int(admitted) and not jobs
        if admitted:
            assert admissions[0]["delegation_version"] == 6
            assert admissions[0]["approved_by"] is None and admissions[0]["approved_at"] is None
        print(json.dumps(result["proof"]), flush=True)

    fixture = b"Sandy authorized computer canary\n"
    for vm, manager, package, service in [("sandy-video", "apt", "hello", "sandy-engineering-canary"), ("sandy-windows", "winget", "7zip.7zip", "SandyEngineeringCanary")]:
        enrollment = runtime._sql("SELECT vm_name,enabled,generation,last_seen_at FROM public.sandy_guest_enrollments WHERE vm_name=" + quote(vm), True)[0]
        assert enrollment["enabled"] is False and enrollment["generation"] == 0, "enabled_agent_requires_effect_readback_and_rollback_preparation"
        proof.setdefault("enrollment_preconditions", []).append(enrollment)
        import base64
        upload = {"vm_name": vm, "path": "sandy-engineering-canary/probe-" + uuid.uuid4().hex + ".txt", "content_base64": base64.b64encode(fixture).decode(), "sha256": hashlib.sha256(fixture).hexdigest()}
        for name, args in [("gcp.vm.files.upload", upload), ("gcp.vm.packages.install", {"vm_name": vm, "manager": manager, "packages": [package]}), ("gcp.vm.services.status", {"vm_name": vm, "service": service})]:
            call(name, args, 424, "guest_enrollment_required", True)
        for name, args in [("gcp.vm.files.download", {"vm_name": vm, "path": "outside-canary/probe.txt"}), ("gcp.vm.packages.install", {"vm_name": vm, "manager": manager, "packages": ["not-authorized-canary-package"]}), ("gcp.vm.services.restart", {"vm_name": vm, "service": "NotAuthorizedCanaryService"})]:
            call(name, args, 403, "engineering_policy_blocked", False)
    proof.update(complete=True, authorized_dependency_probes=6, boundary_denials=6, accepted_infrastructure_scenarios=0)
    save()
    return proof


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--resume-readonly-discovery", action="store_true",
                        help="Reuse completed saved tools/list pages only; never replay a tools/call")
    args = parser.parse_args()
    result = verify(args.output, args.resume_readonly_discovery)
    print(json.dumps({k: v for k, v in result.items() if k != "calls"}))
