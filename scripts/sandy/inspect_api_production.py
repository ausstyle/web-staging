"""Read-only Sandy API inspection; credentials and network access remain prerequisites.

This tool never deploys, executes operations, changes database state or marks an
operation verified. PostgreSQL requests use only fixed SELECT statements. Output
must be outside the checkout and contains metadata, never credential values.
"""
from __future__ import annotations

import argparse
from dataclasses import dataclass
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import re
import tempfile
from typing import Any, Callable, Mapping
import urllib.error
import urllib.request


PROJECT_REF = "zmqlyygzqoidkcwdysok"
MANAGEMENT_BASE = f"https://api.supabase.com/v1/projects/{PROJECT_REF}"
API_URL = f"https://{PROJECT_REF}.supabase.co/functions/v1/sandy-operation-api"
GITHUB_URL = "https://api.github.com/repos/ausstyle/web-staging"
GCP_URL = "https://cloudresourcemanager.googleapis.com/v1/projects/elaborate-haven-511518-a5"
METADATA_COLUMNS = (
    "operation", "domain", "permission_scope", "is_mutation", "input_schema",
    "output_schema", "handler", "api_exposed", "ui_exposed", "ai_exposed",
    "verified", "last_verified_at", "dependencies", "deployment_state",
    "deployment_evidence", "test_evidence", "updated_at",
)
FUNCTION_FIELDS = (
    "id", "name", "slug", "status", "version", "verify_jwt", "created_at", "updated_at",
)
COLUMN_QUERY = (
    "SELECT column_name, data_type FROM information_schema.columns "
    "WHERE table_schema = 'public' AND table_name = 'sandy_operation_registry' "
    "ORDER BY ordinal_position;"
)
SENSITIVE_KEY = re.compile(
    r"(?:^|_)authorization$|cookie|password|passwd|private.?key|service.?role.?key|"
    r"access.?token|refresh.?token|api.?key|credential|secret.?value", re.I
)


@dataclass(frozen=True)
class HttpResult:
    status: int | None
    payload: Any = None
    failure: str | None = None


Transport = Callable[[str, str, Mapping[str, str], Any], HttpResult]


class NoRedirectHandler(urllib.request.HTTPRedirectHandler):
    """Never forward a credential-bearing request to a redirected destination."""

    def redirect_request(self, request, response, code, message, headers, new_url):
        return None


def http_transport(method: str, url: str, headers: Mapping[str, str], body: Any) -> HttpResult:
    """Keep provider bodies only on success; exception strings can contain secrets."""
    data = None if body is None else json.dumps(body).encode("utf-8")
    request = urllib.request.Request(url, data=data, headers=dict(headers), method=method)
    # Keep standard TLS verification and environment proxy handlers. Only the
    # default redirect behavior changes: even same-origin redirects are blocked.
    opener = urllib.request.build_opener(NoRedirectHandler())
    try:
        with opener.open(request, timeout=20) as response:
            raw = response.read(8 * 1024 * 1024 + 1)
            if len(raw) > 8 * 1024 * 1024:
                return HttpResult(response.status, failure="response_size_limit")
            try:
                payload = json.loads(raw)
            except (ValueError, UnicodeDecodeError):
                return HttpResult(response.status, failure="invalid_json_response")
            return HttpResult(response.status, payload)
    except urllib.error.HTTPError as error:
        failure = ("redirect_blocked" if 300 <= error.code < 400 else
                   "provider_request_denied" if error.code in (401, 403) else "provider_http_error")
        return HttpResult(error.code, failure=failure)
    except urllib.error.URLError as error:
        # Inspect only for classification. Never return the raw exception/reason.
        reason = str(error.reason)
        if "Tunnel connection failed" in reason and "403" in reason:
            return HttpResult(403, failure="network_proxy_denied")
        return HttpResult(None, failure="network_unavailable")
    except (OSError, TimeoutError):
        return HttpResult(None, failure="network_unavailable")


def sanitize(value: Any, sensitive_values: tuple[str, ...]) -> Any:
    if isinstance(value, dict):
        return {
            str(key): "[REDACTED]" if SENSITIVE_KEY.search(str(key)) else sanitize(item, sensitive_values)
            for key, item in value.items()
        }
    if isinstance(value, (list, tuple)):
        return [sanitize(item, sensitive_values) for item in value]
    if isinstance(value, str):
        result = value
        for secret in sensitive_values:
            if secret:
                result = result.replace(secret, "[REDACTED]")
        return result
    if value is None or isinstance(value, (bool, int, float)):
        return value
    return "[unsupported metadata value]"


def _observation(response: HttpResult, payload: Any = None) -> dict[str, Any]:
    if response.failure or response.status is None or not 200 <= response.status < 300:
        return {
            "state": "blocked", "http_status": response.status,
            "blocker": response.failure or "provider_http_error",
            "production_absence_established": False,
        }
    return {"state": "observed", "http_status": response.status, "data": payload}


def _request(transport: Transport, method: str, url: str, token: str | None, body: Any = None) -> HttpResult:
    headers = {"accept": "application/json"}
    if body is not None:
        headers["content-type"] = "application/json"
    if token:
        headers["authorization"] = "Bearer " + token
    try:
        return transport(method, url, headers, body)
    except Exception:
        # A custom transport must not expose request/exception representations.
        return HttpResult(None, failure="transport_failed")


def inspect_production(
    environment: Mapping[str, str] | None = None,
    transport: Transport = http_transport,
    *,
    probe_connectivity: bool = False,
) -> dict[str, Any]:
    environment = os.environ if environment is None else environment
    management_token = environment.get("SANDY_SUPABASE_MANAGEMENT_TOKEN", "")
    controller_token = environment.get("SANDY_CONTROLLER_ACCESS_TOKEN", "")
    observations: dict[str, Any] = {}
    missing_management = {
        "state": "blocked", "blocker": "binding_unavailable_in_current_cloud_machine",
        "required_binding": "SANDY_SUPABASE_MANAGEMENT_TOKEN",
        "production_absence_established": False,
    }
    if management_token:
        functions = _request(transport, "GET", MANAGEMENT_BASE + "/functions", management_token)
        if functions.failure or not isinstance(functions.payload, list):
            if not functions.failure and functions.status is not None and 200 <= functions.status < 300:
                functions = HttpResult(functions.status, failure="invalid_function_list")
            observations["edge_functions"] = _observation(functions)
        else:
            data = [{key: row[key] for key in FUNCTION_FIELDS if key in row}
                    for row in functions.payload if isinstance(row, dict)]
            if len(data) != len(functions.payload):
                observations["edge_functions"] = _observation(HttpResult(functions.status, failure="invalid_function_list"))
            else:
                observations["edge_functions"] = _observation(functions, data)

        columns = _request(transport, "POST", MANAGEMENT_BASE + "/database/query", management_token, {"query": COLUMN_QUERY})
        if columns.failure or not isinstance(columns.payload, list):
            if not columns.failure and columns.status is not None and 200 <= columns.status < 300:
                columns = HttpResult(columns.status, failure="invalid_column_list")
            observations["registry_columns"] = _observation(columns)
            observations["operation_registry"] = {"state": "blocked", "blocker": "registry_schema_unavailable", "production_absence_established": False}
        else:
            names = {row.get("column_name") for row in columns.payload if isinstance(row, dict) and isinstance(row.get("column_name"), str)}
            observations["registry_columns"] = _observation(columns, [
                {key: row[key] for key in ("column_name", "data_type") if key in row}
                for row in columns.payload if isinstance(row, dict)
            ])
            selected = [name for name in METADATA_COLUMNS if name in names]
            if "operation" not in selected:
                observations["operation_registry"] = {"state": "blocked", "blocker": "operation_column_not_observed", "production_absence_established": False}
            else:
                rows: list[dict[str, Any]] = []
                page_size = 500
                for page in range(20):
                    projection = ", ".join('"' + name + '"' for name in selected)
                    query = f'SELECT {projection} FROM public.sandy_operation_registry ORDER BY "operation" LIMIT {page_size} OFFSET {page * page_size};'
                    result = _request(transport, "POST", MANAGEMENT_BASE + "/database/query", management_token, {"query": query})
                    if result.failure or not isinstance(result.payload, list) or any(not isinstance(row, dict) for row in result.payload):
                        if not result.failure and result.status is not None and 200 <= result.status < 300:
                            result = HttpResult(result.status, failure="invalid_registry_rows")
                        observations["operation_registry"] = _observation(result)
                        break
                    rows.extend({key: row[key] for key in selected if key in row} for row in result.payload)
                    if len(result.payload) < page_size:
                        observations["operation_registry"] = {
                            **_observation(result, rows), "selected_columns": selected,
                            "complete": True, "row_count": len(rows),
                        }
                        break
                else:
                    observations["operation_registry"] = {
                        "state": "incomplete", "blocker": "registry_page_limit", "complete": False,
                        "row_count": len(rows), "data": rows, "production_absence_established": False,
                    }
    else:
        for name in ("edge_functions", "registry_columns", "operation_registry"):
            observations[name] = dict(missing_management)

    if controller_token:
        discovery = _request(transport, "POST", API_URL, controller_token, {"action": "list"})
        if not discovery.failure and isinstance(discovery.payload, dict) and discovery.payload.get("ok") is True and isinstance(discovery.payload.get("operations"), list):
            operations = [{key: row[key] for key in (*METADATA_COLUMNS, "executable", "verification") if key in row}
                          for row in discovery.payload["operations"] if isinstance(row, dict)]
            if len(operations) == len(discovery.payload["operations"]):
                observations["api_discovery"] = _observation(discovery, {"operations": operations})
            else:
                observations["api_discovery"] = _observation(HttpResult(discovery.status, failure="invalid_api_discovery"))
        else:
            if not discovery.failure and discovery.status is not None and 200 <= discovery.status < 300:
                discovery = HttpResult(discovery.status, failure="invalid_api_discovery")
            observations["api_discovery"] = _observation(discovery)
    else:
        observations["api_discovery"] = {
            "state": "blocked", "blocker": "binding_unavailable_in_current_cloud_machine",
            "required_binding": "SANDY_CONTROLLER_ACCESS_TOKEN", "production_absence_established": False,
        }

    if probe_connectivity:
        for name, url, method, body in (
            ("management_connectivity", MANAGEMENT_BASE + "/functions", "GET", None),
            ("api_connectivity", API_URL, "POST", {"action": "list"}),
            ("github_connectivity", GITHUB_URL, "GET", None),
            ("google_cloud_connectivity", GCP_URL, "GET", None),
        ):
            response = _request(transport, method, url, None, body)
            observations[name] = {
                "state": "blocked" if response.failure == "network_proxy_denied" or response.status is None else "http_response_observed",
                "http_status": response.status, "failure": response.failure,
                "authentication_supplied": False, "provider_authorization_tested": False,
                "production_absence_established": False,
            }

    report = {
        "project_ref": PROJECT_REF,
        "inspected_at": datetime.now(timezone.utc).isoformat(),
        "mode": "read_only_metadata_inspection",
        "binding_presence": {
            "management_binding_present": bool(management_token),
            "controller_binding_present": bool(controller_token),
        },
        "binding_observation_scope": "current_cloud_machine_only; deployed_server_bindings_not_inspected",
        "observations": observations,
        "inspection_complete": all(observations[name]["state"] == "observed" for name in ("edge_functions", "registry_columns", "operation_registry", "api_discovery")),
        "production_readiness": "not_assessed",
        "operations_executed": False,
        "deployments_performed": False,
        "registry_updated": False,
    }
    return sanitize(report, (management_token, controller_token))


def save_report(report: Mapping[str, Any], output: Path, repository_root: Path | None = None) -> Path:
    root = (repository_root or Path(__file__).resolve().parents[2]).resolve()
    target = output.expanduser().resolve()
    if target == root or root in target.parents:
        raise ValueError("Inspection output must be outside the checkout")
    target.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(mode="w", encoding="utf-8", prefix=".sandy-inspection-", dir=target.parent, delete=False) as temporary:
        json.dump(report, temporary, indent=2, ensure_ascii=False)
        temporary.write("\n")
        temporary_path = Path(temporary.name)
    temporary_path.replace(target)
    return target


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", required=True, type=Path, help="JSON metadata report path outside the checkout")
    parser.add_argument("--probe-connectivity", "--probe-network", action="store_true", help="Also make unauthenticated read-only requests to four fixed Supabase, GitHub and Google Cloud endpoints; no provider authorization is established")
    args = parser.parse_args()
    report = inspect_production(probe_connectivity=args.probe_connectivity)
    try:
        saved = save_report(report, args.output)
    except (ValueError, OSError) as error:
        parser.exit(2, "Report could not be saved: " + (str(error) if isinstance(error, ValueError) else type(error).__name__) + "\n")
    print(json.dumps({"report": str(saved), "inspection_complete": report["inspection_complete"], "production_readiness": report["production_readiness"]}))
    return 0 if report["inspection_complete"] else 2


if __name__ == "__main__":
    raise SystemExit(main())
