"""Read-only deployed API checks, with explicit network/auth/component outcomes.

Service credentials authenticate internal handlers only. A Controller user session
is required for API/MCP user-path tests; no service key substitutes for that session.
Reports contain selected evidence, never response bodies or credential values.
"""
from __future__ import annotations

import argparse
from datetime import datetime, timezone
import json
import os
from pathlib import Path
from typing import Any, Callable, Mapping
import urllib.error
import urllib.request

from inspect_api_production import HttpResult, NoRedirectHandler, PROJECT_REF

BASE = f"https://{PROJECT_REF}.supabase.co/functions/v1/"
MANAGEMENT = f"https://api.supabase.com/v1/projects/{PROJECT_REF}"
LIMIT = 2 * 1024 * 1024
BOUNDED_METADATA = {
    "supabase.schema.views.list": 1000, "supabase.schema.materialized_views.list": 1000,
    "supabase.schema.triggers.list": 1000, "supabase.schema.constraints.list": 1000,
    "supabase.schema.types.list": 1000, "supabase.schema.extensions.list": 200,
    "supabase.database.roles.list": 1000, "supabase.database.grants.list": 1000,
    "supabase.database.default_privileges.list": 1000,
    "supabase.database.rls.policies.list": 1000,
    "supabase.database.locks.list": 200, "supabase.database.cron.jobs.list": 200,
}
Transport = Callable[[str, str, Mapping[str, str], Any], HttpResult]


def transport(method: str, url: str, headers: Mapping[str, str], body: Any) -> HttpResult:
    request = urllib.request.Request(url, method=method, headers=dict(headers),
                                    data=None if body is None else json.dumps(body).encode())
    try:
        try:
            response = urllib.request.build_opener(NoRedirectHandler()).open(request, timeout=60)
        except urllib.error.HTTPError as error:
            response = error
        with response:
            if 300 <= response.code < 400:
                return HttpResult(response.code, failure="redirect_blocked")
            data = response.read(LIMIT + 1)
            if len(data) > LIMIT:
                return HttpResult(response.code, failure="response_size_limit")
            try:
                return HttpResult(response.code, json.loads(data))
            except (ValueError, UnicodeDecodeError):
                return HttpResult(response.code, failure="invalid_json_response")
    except urllib.error.URLError as error:
        reason = str(error.reason)
        denied = "Tunnel connection failed" in reason and "403" in reason
        return HttpResult(None, failure="network_proxy_denied" if denied else "network_unavailable")
    except (OSError, TimeoutError):
        return HttpResult(None, failure="network_unavailable")


def verify(environment: Mapping[str, str], request: Transport = transport) -> dict[str, Any]:
    tests: list[dict[str, Any]] = []
    report: dict[str, Any] = {"project": PROJECT_REF, "tested_at": datetime.now(timezone.utc).isoformat(),
                              "tests": tests, "complete": False}

    def record(name: str, result: HttpResult, passed: bool, layer: str, *, blocker: str | None = None):
        outcome = "blocked" if blocker else "passed" if passed else "failed"
        tests.append({"test": name, "outcome": outcome, "http_status": result.status,
                      "layer": layer, **({"blocker": blocker} if blocker else {})})

    def call(method: str, url: str, token: str | None = None, body: Any = None,
             anon: str | None = None) -> HttpResult:
        headers = {"accept": "application/json", "content-type": "application/json"}
        if token:
            headers["authorization"] = "Bearer " + token
        if anon:
            headers["apikey"] = anon
        try:
            return request(method, url, headers, body)
        except Exception:
            return HttpResult(None, failure="transport_failed")

    # Reachability is tested before requesting internal API keys from Management.
    probe = call("GET", BASE + "sandy-operation-api/v1/capabilities")
    network_failure = probe.failure in {"network_proxy_denied", "network_unavailable", "transport_failed"}
    record("project_endpoint_reachable_and_requires_authentication", probe,
           probe.status == 401, "edge_authentication", blocker=probe.failure if network_failure else None)
    if network_failure:
        report["deferred"] = ["internal_handler_checks", "authenticated_api_mcp_checks"]
        return report

    management = environment.get("SANDY_SUPABASE_MANAGEMENT_TOKEN")
    if not management:
        record("internal_handler_credential_binding", HttpResult(None), False, "configuration",
               blocker="management_binding_unavailable")
        return report
    keys = call("GET", MANAGEMENT + "/api-keys", management)
    if keys.status != 200 or not isinstance(keys.payload, list):
        record("internal_handler_credential_lookup", keys, False, "management",
               blocker=keys.failure or "management_key_lookup_denied")
        return report
    # Use these only on this fixed project's internal service endpoints.
    service = next((row.get("api_key") for row in keys.payload if isinstance(row, dict) and row.get("name") == "service_role"), None)
    anon = next((row.get("api_key") for row in keys.payload if isinstance(row, dict) and row.get("name") == "anon"), None)
    if not isinstance(service, str) or not service or not isinstance(anon, str) or not anon:
        record("internal_handler_credential_binding", HttpResult(None), False, "configuration",
               blocker="project_internal_binding_unavailable")
        return report

    def edge(slug: str, body: Any, token: str | None = None) -> HttpResult:
        return call("POST", BASE + slug, token, body, anon)

    denial = edge("sandy-operation-api", {"action": "list"}, service)
    denied = isinstance(denial.payload, dict) and denial.payload.get("error") == "invalid_identity"
    record("gateway_rejects_service_key_as_user_session", denial, denial.status == 401 and denied,
           "application_authentication")
    for slug in ("sandy-api-mcp", "sandy-provider-read-api"):
        response = edge(slug, {})
        record(slug + ".unauthenticated", response, response.status == 401, "edge_authentication")

    branch_name = None
    for operation in (
        "supabase.projects.get", "supabase.project.health", "supabase.branches.list",
        "supabase.branches.get", "supabase.network.restrictions.get", "supabase.domains.get",
        "supabase.functions.secrets.list", "supabase.backups.list", "supabase.db.migrations.list",
        "supabase.database.inspect", "supabase.schema.tables.list", "supabase.schema.functions.list",
        "supabase.schema.indexes.list", "supabase.database.connections.list",
        *BOUNDED_METADATA,
    ):
        negative_branch = operation == "supabase.branches.get" and not branch_name
        args = {"name": branch_name or "sandy-api-test-nonexistent-20261020"} if operation == "supabase.branches.get" else {}
        result = edge("sandy-provider-read-api", {"operation": operation, "arguments": args}, service)
        body = result.payload if isinstance(result.payload, dict) else {}
        passed = result.status == 200 and body.get("ok") is True and body.get("project_id") == PROJECT_REF
        if negative_branch:
            passed = result.status == 404 and body.get("upstream_status") == 404
        if operation == "supabase.projects.get" and passed:
            passed = isinstance(body.get("result"), dict) and body["result"].get("id") == PROJECT_REF
        if operation == "supabase.branches.list" and passed and body.get("result"):
            branch_name = body["result"][0].get("name")
        if operation == "supabase.functions.secrets.list" and passed:
            passed = isinstance(body.get("result"), list) and all(
                isinstance(row, dict) and set(row) <= {"name", "updated_at"} for row in body["result"])
        if operation in BOUNDED_METADATA and passed:
            rows = body.get("result")
            passed = isinstance(rows, list) and body.get("result_limit") == BOUNDED_METADATA[operation] and len(rows) <= BOUNDED_METADATA[operation] and body.get("possibly_truncated") is (len(rows) == BOUNDED_METADATA[operation])
        blocked = "provider_entitlement_required" if result.status == 424 and body.get("error") == "provider_entitlement_required" else result.failure if result.failure in {"network_proxy_denied", "network_unavailable", "transport_failed"} else None
        record(operation + (".missing_branch" if negative_branch else ""), result, passed,
               "deployed_internal_handler_to_provider", blocker=blocked)

    controller = environment.get("SANDY_CONTROLLER_ACCESS_TOKEN")
    if not controller:
        record("authenticated_api_mcp_execution", HttpResult(None), False, "controller_session",
               blocker="controller_user_session_unavailable")
    elif controller in (service, anon, management):
        record("authenticated_api_mcp_execution", HttpResult(None), False, "configuration")
    else:
        catalogue = edge("sandy-operation-api", {"action": "list"}, controller)
        data = catalogue.payload if isinstance(catalogue.payload, dict) else {}
        good = catalogue.status == 200 and data.get("ok") is True and isinstance(data.get("operations"), list) and any(
            isinstance(row, dict) and row.get("operation") == "engineering.preflight" and row.get("executable") is True for row in data["operations"])
        record("authenticated_api_catalogue", catalogue, good, "controller_session")
        rpc = edge("sandy-api-mcp", {"jsonrpc": "2.0", "id": 1, "method": "tools/list", "params": {}}, controller)
        data = rpc.payload if isinstance(rpc.payload, dict) else {}
        result = data.get("result") if isinstance(data.get("result"), dict) else {}
        record("authenticated_mcp_catalogue", rpc, rpc.status == 200 and isinstance(result.get("tools"), list) and any(
            isinstance(row, dict) and row.get("name") == "engineering.preflight" for row in result["tools"]), "controller_session")
        # Preflight is read-only and preserves the user's actual authorization.
        execution = edge("sandy-api-mcp", {"jsonrpc": "2.0", "id": 2, "method": "tools/call",
                         "params": {"name": "engineering.preflight", "arguments": {}}}, controller)
        body = execution.payload if isinstance(execution.payload, dict) else {}
        result = body.get("result") if isinstance(body.get("result"), dict) else {}
        record("authenticated_mcp_api_preflight_execution", execution,
               execution.status == 200 and result.get("isError") is False and isinstance(result.get("structuredContent"), dict) and result["structuredContent"].get("ok") is True,
               "controller_session_through_api")

    report["complete"] = all(test["outcome"] == "passed" for test in tests)
    return report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    target = args.output.resolve()
    checkout = Path(__file__).resolve().parents[2]
    if target == checkout or checkout in target.parents:
        raise SystemExit("Write generated integration reports outside the checkout")
    report = verify(os.environ)
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(json.dumps(report, indent=2) + "\n")
    print(json.dumps({"report": str(target), "complete": report["complete"],
                      "outcomes": {outcome: sum(row["outcome"] == outcome for row in report["tests"])
                                   for outcome in ("passed", "failed", "blocked")}}))
    raise SystemExit(0 if report["complete"] else 1)


if __name__ == "__main__":
    main()
