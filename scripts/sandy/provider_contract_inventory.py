"""Reconcile provider schemas with all scope rows without registering fictitious executors.

Input contracts retain references to checksum-identified source documents.
These are review candidates, never executable Sandy contracts or runtime grants.
"""
from __future__ import annotations

import argparse
import ast
import hashlib
import json
from pathlib import Path
import re
from typing import Any

from fetch_provider_contracts import read_cached_contract


def _proto_tokens(text: str) -> list[tuple[str, str]]:
    """Tokenize annotations without treating braces or comments inside strings as syntax."""
    result = []
    offset = 0
    while offset < len(text):
        if text[offset].isspace():
            offset += 1
            continue
        if text.startswith("//", offset):
            newline = text.find("\n", offset)
            offset = len(text) if newline < 0 else newline + 1
            continue
        if text.startswith("/*", offset):
            end = text.find("*/", offset + 2)
            if end < 0:
                raise ValueError("Unterminated protobuf comment")
            offset = end + 2
            continue
        if text[offset] in {"\"", "'"}:
            quote = text[offset]
            match = re.match(quote + r"(?:\\[^\r\n]|[^" + quote + r"\\\r\n])*" + quote, text[offset:])
            if not match:
                raise ValueError("Unterminated protobuf string")
            value = ast.literal_eval(match.group())
            if not isinstance(value, str):
                raise ValueError("Unsupported protobuf string")
            result.append(("string", value))
            offset += match.end()
            continue
        match = re.match(r"[A-Za-z_][A-Za-z0-9_]*|[0-9]+", text[offset:])
        if match:
            result.append(("word", match.group()))
            offset += match.end()
        else:
            result.append(("symbol", text[offset]))
            offset += 1
    stack = []
    for kind, value in result:
        if kind != "symbol":
            continue
        if value in {"(", "[", "{"}:
            stack.append(value)
        elif value in {")", "]", "}"}:
            if not stack or {"(": ")", "[": "]", "{": "}"}[stack.pop()] != value:
                raise ValueError("Unbalanced protobuf structure")
    if stack:
        raise ValueError("Unbalanced protobuf structure")
    return result


def _proto_group_end(tokens: list[tuple[str, str]], start: int) -> int:
    opening = tokens[start]
    closing = ("symbol", {"(": ")", "[": "]", "{": "}"}[opening[1]])
    depth = 0
    for index in range(start, len(tokens)):
        if tokens[index] == opening:
            depth += 1
        elif tokens[index] == closing:
            depth -= 1
            if depth == 0:
                return index
    raise ValueError("Unbalanced protobuf group")


def _proto_items(tokens: list[tuple[str, str]]):
    """Yield statements and named blocks at the current structural depth."""
    offset = 0
    while offset < len(tokens):
        start = offset
        while offset < len(tokens):
            token = tokens[offset]
            if token in {("symbol", "("), ("symbol", "[")}:
                offset = _proto_group_end(tokens, offset) + 1
            elif token == ("symbol", "{"):
                end = _proto_group_end(tokens, offset)
                yield tokens[start:offset], tokens[offset + 1:end]
                offset = end + 1
                if offset < len(tokens) and tokens[offset] == ("symbol", ";"):
                    offset += 1
                break
            elif token == ("symbol", ";"):
                if offset > start:
                    yield tokens[start:offset], None
                offset += 1
                break
            else:
                offset += 1
        else:
            raise ValueError("Unterminated protobuf statement")


def _proto_name(tokens: list[tuple[str, str]]) -> str:
    name = "".join(value for _, value in tokens)
    if not re.fullmatch(r"\.?[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*", name):
        raise ValueError("Invalid protobuf qualified name")
    expected = [("symbol", ".")] if name.startswith(".") else []
    for part in name.lstrip(".").split("."):
        if expected and expected[-1] != ("symbol", "."):
            expected.append(("symbol", "."))
        expected.append(("word", part))
    if tokens != expected:
        raise ValueError("Invalid protobuf name tokens")
    return name


def _proto_option(header: list[tuple[str, str]]) -> tuple[str, list[tuple[str, str]]]:
    if header[0] != ("word", "option"):
        raise ValueError("Expected protobuf option")
    if len(header) > 1 and header[1] == ("symbol", "("):
        end = _proto_group_end(header, 1)
        name = _proto_name(header[2:end])
        remainder = header[end + 1:]
    else:
        name = _proto_name(header[1:2])
        remainder = header[2:]
    if not remainder or remainder[0] != ("symbol", "="):
        raise ValueError("Malformed protobuf option")
    return name, remainder[1:]


def _proto_string(tokens: list[tuple[str, str]]) -> str:
    if not tokens or any(kind != "string" for kind, _ in tokens):
        raise ValueError("Expected protobuf string value")
    return "".join(value for _, value in tokens)


def _http_bindings(tokens: list[tuple[str, str]], allow_additional: bool = True) -> list[dict[str, str]]:
    """Extract only simple google.api.http bindings; unsupported rules fail closed."""
    verbs = {"get", "post", "patch", "put", "delete"}
    fields = {}
    additional = []
    offset = 0
    while offset < len(tokens):
        if tokens[offset] in {("symbol", ","), ("symbol", ";")}:
            offset += 1
            continue
        kind, field = tokens[offset]
        if kind != "word":
            raise ValueError("Malformed HTTP annotation field")
        offset += 1
        colon = offset < len(tokens) and tokens[offset] == ("symbol", ":")
        if colon:
            offset += 1
        if field == "additional_bindings":
            if not allow_additional or offset >= len(tokens) or tokens[offset] != ("symbol", "{"):
                raise ValueError("Unsupported nested HTTP binding")
            end = _proto_group_end(tokens, offset)
            additional.extend(_http_bindings(tokens[offset + 1:end], False))
            offset = end + 1
            continue
        if field not in verbs | {"body", "response_body"} or field in fields or not colon:
            raise ValueError("Unsupported or duplicate HTTP annotation field")
        start = offset
        while offset < len(tokens) and tokens[offset][0] == "string":
            offset += 1
        fields[field] = _proto_string(tokens[start:offset])
    methods = verbs.intersection(fields)
    if len(methods) != 1:
        raise ValueError("HTTP binding must contain one simple method")
    method = methods.pop()
    path = fields.pop(method)
    if not re.fullmatch(r"/(?:[^{}\s?#]|\{[^{}\s?#]+\})*", path):
        raise ValueError("Invalid HTTP annotation path template")
    result = [{"method": method.upper(), "path": path, **fields}, *additional]
    if len({(item["method"], item["path"]) for item in result}) != len(result):
        raise ValueError("Duplicate HTTP binding")
    return result


def _proto_service(body: list[tuple[str, str]]) -> dict[str, Any]:
    result: dict[str, Any] = {"methods": []}
    for header, inner in _proto_items(body):
        if header[0] == ("word", "option"):
            name, value = _proto_option(header)
            if name in {"google.api.default_host", "google.api.oauth_scopes"}:
                if inner is not None or name in result:
                    raise ValueError("Duplicate or malformed service annotation")
                result[name] = _proto_string(value)
            continue
        if header[0] != ("word", "rpc") or inner is None or len(header) < 9 or header[1][0] != "word" or header[2] != ("symbol", "("):
            raise ValueError("Unsupported protobuf service member")
        request_end = _proto_group_end(header, 2)
        tail = header[request_end + 1:]
        if len(tail) < 4 or tail[:2] != [("word", "returns"), ("symbol", "(")] or _proto_group_end(tail, 1) != len(tail) - 1:
            raise ValueError("Unsupported protobuf RPC signature")
        method = {"rpc": header[1][1], "request": _proto_name(header[3:request_end]),
                  "response": _proto_name(tail[2:-1])}
        for option, annotation in _proto_items(inner):
            name, value = _proto_option(option)
            if name == "google.api.http":
                if value or annotation is None or "http_bindings" in method:
                    raise ValueError("Duplicate or malformed HTTP annotation")
                method["http_bindings"] = _http_bindings(annotation)
        if "http_bindings" not in method:
            raise ValueError("RPC lacks a supported HTTP annotation")
        result["methods"].append(method)
    if not result["methods"] or len({item["rpc"] for item in result["methods"]}) != len(result["methods"]):
        raise ValueError("Missing or duplicate RPC identity")
    bindings = [(item["method"], item["path"]) for method in result["methods"] for item in method["http_bindings"]]
    if len(set(bindings)) != len(bindings):
        raise ValueError("RPC HTTP binding collision")
    return result


def _proto_document(text: str) -> dict[str, Any]:
    result: dict[str, Any] = {"messages": [], "services": {}}
    for header, body in _proto_items(_proto_tokens(text)):
        if header[0] in {("word", "syntax"), ("word", "package")}:
            key = header[0][1]
            if key in result or body is not None:
                raise ValueError("Duplicate protobuf document identity")
            if key == "syntax":
                if header[1:] != [("symbol", "="), ("string", "proto3")]:
                    raise ValueError("Supplemental contracts must use proto3")
                result[key] = "proto3"
            else:
                result[key] = _proto_name(header[1:])
        elif header[0] in {("word", "message"), ("word", "service")}:
            if len(header) != 2 or header[1][0] != "word" or body is None:
                raise ValueError("Malformed protobuf definition")
            name = header[1][1]
            if header[0][1] == "message":
                if name in result["messages"]:
                    raise ValueError("Duplicate protobuf message")
                result["messages"].append(name)
            else:
                if name in result["services"]:
                    raise ValueError("Duplicate protobuf service")
                result["services"][name] = _proto_service(body)
    if "syntax" not in result or "package" not in result:
        raise ValueError("Supplemental protobuf document lacks identity")
    return result


def supplemental_candidates(source: dict[str, Any], cache: Path) -> list[dict[str, Any]]:
    """Account for pinned proto evidence while leaving Discovery and executors unverified."""
    sources = source.get("alternative_contract_sources", [])
    if not sources:
        return []
    if source["provider"] != "gcp-cloudquotas":
        raise ValueError("Unsupported supplemental provider contract")
    messages, services, contracts = {}, {}, []
    for item in sources:
        filename = item.get("cache_file", "")
        if item.get("format") != "protobuf" or not isinstance(filename, str) or not filename.startswith(source["provider"] + "-"):
            raise ValueError("Unsupported supplemental contract cache file")
        if filename in {contract["cache_file"] for contract in contracts}:
            raise ValueError("Duplicate supplemental contract cache file")
        document = _proto_document(read_cached_contract(item, cache, filename, "protobuf").decode("utf-8"))
        contracts.append({key: item[key] for key in ["format", "source", "sha256", "bytes", "cache_file"]})
        for message in document["messages"]:
            qualified = document["package"] + "." + message
            if qualified in messages:
                raise ValueError("Duplicate supplemental message identity")
            messages[qualified] = filename
        for name, service in document["services"].items():
            qualified = document["package"] + "." + name
            if qualified in services:
                raise ValueError("Duplicate supplemental service identity")
            services[qualified] = {**service, "package": document["package"], "source": item}
    expected = source.get("alternative_contract_service")
    if expected != "google.api.cloudquotas.v1.CloudQuotas" or set(services) != {expected}:
        raise ValueError("Supplemental service identity mismatch")
    service = services[expected]
    if service.get("google.api.default_host") != "cloudquotas.googleapis.com" or not service.get("google.api.oauth_scopes"):
        raise ValueError("Supplemental service host or OAuth scopes are missing")
    methods = service["methods"]
    advertised = source.get("alternative_contract_methods")
    observed = [{"rpc": item["rpc"], "http_bindings": [{key: binding[key] for key in ["method", "path"]}
                 for binding in item["http_bindings"]]} for item in methods]
    if advertised is not None and advertised != observed:
        raise ValueError("Advertised supplemental HTTP methods do not match pinned source")
    result = []
    for method in methods:
        references = {}
        for key in ["request", "response"]:
            name = method[key].lstrip(".")
            if "." not in name:
                name = service["package"] + "." + name
            if name not in messages:
                raise ValueError("RPC message is absent from pinned supplemental sources: " + name)
            references[key] = {"protobuf_message": name, "cache_file": messages[name]}
        primary = method["http_bindings"][0]
        result.append({"candidate_id": "gcp.cloudquotas." + method["rpc"], "provider": "gcp",
                       "provider_operation_id": expected + "." + method["rpc"], "resource": "cloudquotas",
                       "method": method["rpc"], "http_method": primary["method"], "path_template": primary["path"],
                       "provider_contract": {"format": "http_annotated_protobuf", "service": expected,
                                             "default_host": service["google.api.default_host"],
                                             "scopes": [value.strip() for value in service["google.api.oauth_scopes"].split(",")],
                                             "http_bindings": method["http_bindings"], **references,
                                             "source_contracts": contracts},
                       "source_sha256": service["source"]["sha256"], "source_kind": "supplemental_protobuf",
                       "discovery_observed": False, "requirement_ids": classify("gcp", "cloudquotas", method["rpc"]),
                       "executable": False, "registration_eligible": False,
                       "missing": ["reviewed_sandy_contract", "installed_executor", "scoped_policy", "live_attestation"]})
    return result


def scope_rows(text: str) -> list[dict[str, Any]]:
    if "## Core orchestration" in text:
        text = text.split("## Core orchestration", 1)[1].split("## Acceptance", 1)[0]
    rows = [{"requirement_id": int(number), "requirement": value.strip()}
            for number, value in re.findall(r"^(\d+)\.\s+(.+)$", text, re.M)]
    if [row["requirement_id"] for row in rows] != list(range(1, 162)):
        raise ValueError("Scope must contain exactly the ordered 161 requirements")
    return rows


def classify(provider: str, resource: str, method: str) -> list[int]:
    """Group candidate evidence; membership never certifies family completeness."""
    name = resource.lower()
    if provider == "supabase":
        if "/organizations" in name:
            return [75]
        if "/branches" in name:
            return [81] if name.endswith("/diff") else [80]
        if "/functions" in name:
            return [83]
        if name.endswith("/secrets"):
            return [84]
        if "/network" in name:
            return [78]
        if "hostname" in name or "vanity" in name:
            return [79]
        if "/config/auth" in name:
            return [77, 104]
        if "/config/" in name:
            return [77]
        if "/analytics/" in name:
            return [85, 110]
        if "/health" in name:
            return [86]
        if "/backups" in name:
            return [87, 100]
        if name.endswith("/database/query"):
            return [88, 89, 90]
        if re.fullmatch(r"/v1/projects(?:/\{ref\})?(?:/[^/]+)?", resource):
            return [76]
        return []
    if provider == "github":
        patterns = [
            (r"/environments/[^/]+/secrets", 136), (r"/actions/secrets", 134),
            (r"/actions/variables|/environments/[^/]+/variables", 135),
            (r"/actions/workflows", 127), (r"/actions/runs|/actions/jobs", 128),
            (r"/actions/artifacts", 129), (r"/check-runs|/check-suites", 130),
            (r"/statuses|/status$", 131), (r"/deployments", 132),
            (r"/environments", 133), (r"/hooks", 137),
            (r"/collaborators|/teams|/permissions", 138), (r"/rulesets", 139),
            (r"/audit-log", 140), (r"/code-scanning", 142),
            (r"/(?:dependabot|secret-scanning)/alerts", 141),
            (r"/installations", 113), (r"/labels", 121), (r"/milestones", 122),
            (r"/discussions", 123), (r"/issues", 120), (r"/pulls", 119),
            (r"/branches", 116), (r"/contents", 117),
            (r"/git/(?:blobs|trees|commits)", 118), (r"/git/refs|/git/matching-refs", 115),
            (r"/tags", 124), (r"/releases", 125), (r"/packages", 126),
            (r"^/repos/\{owner\}/\{repo\}$|^/(?:user|orgs/\{org\})/repos$", 114),
        ]
        return next(([number] for pattern, number in patterns if re.search(pattern, resource)), [])
    if provider != "gcp":
        return []
    service, _, members = name.partition(".")
    if "iampolicy" in method.lower():
        return [17]
    if service == "cloudresourcemanager":
        return [12] if "organizations" in members else [13] if "folders" in members else [14] if "projects" in members else []
    if service == "serviceusage":
        return [16] if "quota" in members else [15]
    if service == "cloudquotas":
        return [16]
    if service == "iam":
        return [20] if "serviceaccounts.keys" in members else [19] if "serviceaccounts" in members else [18] if "roles" in members else [21] if "workloadidentity" in members else []
    if service == "cloudbilling":
        return [24] if "projects" in members else [23]
    if service == "compute":
        if members == "instances":
            if method in {"start", "stop", "reset", "suspend", "resume", "startWithEncryptionKey"}:
                return [27]
            if method in {"setMachineType", "setLabels", "setTags", "setMetadata"}:
                return [28]
            if method in {"attachDisk", "detachDisk"}:
                return [29]
            if method == "getSerialPortOutput":
                return [33]
            return [26] if method in {"list", "aggregatedList", "get", "insert", "delete"} else []
        resources = {"disks": 30, "images": 31, "snapshots": 32, "instantSnapshots": 32,
                     "globalOperations": 34, "zoneOperations": 34, "regionOperations": 34,
                     "instanceGroups": 45, "instanceGroupManagers": 45, "regionInstanceGroupManagers": 45,
                     "instanceTemplates": 46, "regionInstanceTemplates": 46, "networks": 47,
                     "subnetworks": 48, "routes": 49, "firewalls": 50, "firewallPolicies": 51,
                     "routers": 52, "vpnGateways": 53, "targetVpnGateways": 53, "vpnTunnels": 53,
                     "addresses": 54, "globalAddresses": 54, "forwardingRules": 57,
                     "globalForwardingRules": 57, "backendServices": 57, "urlMaps": 57,
                     "targetHttpProxies": 57, "targetHttpsProxies": 57, "sslCertificates": 58,
                     "regionSslCertificates": 58, "healthChecks": 59, "regionHealthChecks": 59}
        match = next((number for key, number in resources.items() if key.lower() == members), None)
        return [match] if match else []
    if service == "dns":
        return [56] if "resourcerecordsets" in members or "changes" in members else [55]
    if service == "run":
        return [61] if "jobs" in members else [60] if "services" in members else []
    return {"oslogin": [22], "billingbudgets": [25], "container": [62],
            "artifactregistry": [63], "storage": [65] if "objects" in members else [64],
            "secretmanager": [66], "logging": [67], "monitoring": [68],
            "cloudscheduler": [69], "pubsub": [70], "cloudtasks": [71],
            "securitycenter": [72], "cloudkms": [73], "backupdr": [74]}.get(service, [])


def candidates(provider: str, document: dict[str, Any], source_sha256: str) -> list[dict[str, Any]]:
    result: list[dict[str, Any]] = []

    def append(identifier: str, resource: str, method: str, path: str, verb: str, contract: Any):
        result.append({"candidate_id": provider + "." + identifier,
                       "provider": provider, "provider_operation_id": identifier,
                       "resource": resource, "method": method, "http_method": verb,
                       "path_template": path, "provider_contract": contract,
                       "source_sha256": source_sha256,
                       "requirement_ids": classify(provider, resource, method),
                       "executable": False, "registration_eligible": False,
                       "missing": ["reviewed_sandy_contract", "installed_executor", "scoped_policy", "live_attestation"]})

    if provider == "gcp":
        service = document.get("name")
        if not isinstance(service, str) or not service:
            raise ValueError("Discovery document has no service identity")

        def visit(resources: dict[str, Any], chain: list[str]):
            for name, resource in sorted(resources.items()):
                current = [*chain, name]
                for method, operation in sorted(resource.get("methods", {}).items()):
                    identifier = operation.get("id") or ".".join([service, *current, method])
                    append(identifier, ".".join([service, *current]), method,
                           operation["path"], operation["httpMethod"],
                           {"parameters": operation.get("parameters", {}),
                            "request": operation.get("request"), "response": operation.get("response"),
                            "scopes": operation.get("scopes", [])})
                visit(resource.get("resources", {}), current)
        visit(document.get("resources", {}), [])
    elif provider in {"supabase", "github"}:
        for path, item in sorted(document.get("paths", {}).items()):
            for verb, operation in sorted(item.items()):
                if verb not in {"get", "post", "put", "patch", "delete", "head", "options"}:
                    continue
                identifier = operation.get("operationId")
                if not isinstance(identifier, str) or not identifier:
                    raise ValueError("OpenAPI operation lacks an identifier: " + path)
                append(identifier.replace("/", "."), path, identifier, path, verb.upper(),
                       {"parameters": [*item.get("parameters", []), *operation.get("parameters", [])],
                        "requestBody": operation.get("requestBody"), "responses": operation.get("responses", {})})
    else:
        raise ValueError("Unsupported schema provider")
    if len({row["candidate_id"] for row in result}) != len(result):
        raise ValueError("Provider identifier collision")
    return result


def reconcile(scope: list[dict[str, Any]], operations: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return [{**row,
             "provider_candidate_ids": sorted(op["candidate_id"] for op in operations if row["requirement_id"] in op["requirement_ids"]),
             "complete": False,
             "candidate_mapping_is_not_semantic_or_runtime_verification": True,
             "remaining": "Reconcile deployed executors and tenant/provider grants; implement, deploy and test every required member. Provider schema discovery alone is not implementation."}
            for row in scope]


def runtime_candidates(report: dict[str, Any], source_sha256: str) -> list[dict[str, Any]]:
    observation = report.get("observations", {}).get("operation_registry", {})
    if observation.get("state") != "observed" or observation.get("complete") is not True:
        raise ValueError("Runtime registry inspection must be complete")
    explicit = {
        "deployment.jobs.get": [4], "deployment.jobs.list": [4], "deployment.jobs.events": [5],
        "deployment.jobs.cancel": [6], "deployment.jobs.retry": [7], "deployment.management.release": [83],
        "deployment.audit.list": [9], "system.registry.list": [1], "system.registry.describe": [2],
        "system.registry.summary": [1], "supabase.projects.get": [76], "supabase.project.status": [76, 86],
        "supabase.project.health": [86], "supabase.branches.list": [80], "supabase.branches.get": [80],
        "supabase.network.restrictions.get": [78], "supabase.domains.get": [79],
        "supabase.functions.secrets.list": [84], "supabase.backups.list": [87],
        "supabase.functions.list": [83], "supabase.functions.get": [83],
        "supabase.db.migrations.list": [82], "supabase.database.inspect": [98],
        "supabase.schema.tables.list": [91], "supabase.schema.functions.list": [92],
        "supabase.schema.indexes.list": [93], "supabase.database.connections.list": [99],
        "supabase.schema.views.list": [91], "supabase.schema.materialized_views.list": [91],
        "supabase.schema.triggers.list": [92], "supabase.schema.constraints.list": [93],
        "supabase.schema.types.list": [93], "supabase.schema.extensions.list": [93],
        "supabase.database.roles.list": [94], "supabase.database.grants.list": [94],
        "supabase.database.default_privileges.list": [94], "supabase.database.rls.policies.list": [95],
        "supabase.database.locks.list": [99], "supabase.database.cron.jobs.list": [101],
        "supabase.apply_migration": [82], "supabase.deploy_edge_function": [83],
        "github.read": [117], "github.update_file": [117], "github.push_files": [117],
        "github.commit": [118], "github.merge": [119],
    }
    families = {"tasks": 153, "calendar": 148, "files": 156, "memory": 152,
                "engineering": 155, "composio": 145, "video": 150}
    result = []
    for row in observation.get("data", []):
        operation = row["operation"]
        requirements = explicit.get(operation, [])
        if not requirements and operation.split(".")[0] in families:
            requirements = [families[operation.split(".")[0]]]
        result.append({"candidate_id": "sandy_runtime." + operation, "provider": "sandy_runtime",
                       "provider_operation_id": operation, "requirement_ids": requirements,
                       "provider_contract": {"input_schema": row.get("input_schema"), "output_schema": row.get("output_schema")},
                       "source_sha256": source_sha256, "registry_handler": row.get("handler"),
                       "registry_verified": row.get("verified"), "executable": False,
                       "registration_eligible": False,
                       "missing": ["independent_handler_and_live_path_attestation"]})
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--schemas", type=Path, required=True)
    parser.add_argument("--scope", type=Path, default=Path("docs/sandy-api/api-scope-161.md"))
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--registry-report", type=Path)
    args = parser.parse_args()
    manifest = json.loads((args.schemas / "manifest.json").read_text())
    operations = []
    unavailable = []
    for source in manifest:
        if source["state"] != "downloaded":
            unavailable.append(source)
        else:
            raw = read_cached_contract(source, args.schemas, source["provider"] + ".json")
            provider = "gcp" if source["provider"].startswith("gcp-") else source["provider"]
            operations.extend(candidates(provider, json.loads(raw), source["sha256"]))
        operations.extend(supplemental_candidates(source, args.schemas))
    if args.registry_report:
        raw = args.registry_report.read_bytes()
        operations.extend(runtime_candidates(json.loads(raw), hashlib.sha256(raw).hexdigest()))
    if len({op["candidate_id"] for op in operations}) != len(operations):
        raise ValueError("Cross-document operation collision")
    rows = reconcile(scope_rows(args.scope.read_text()), operations)
    report = {"schema_version": 1, "source_manifest": manifest, "unavailable_sources": unavailable,
              "candidate_count": len(operations), "requirement_count": len(rows),
              "runtime_registration_performed": False, "completed_requirements": 0,
              "requirements": rows, "provider_candidates": operations}
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(report, indent=2) + "\n")
    print(json.dumps({key: report[key] for key in ["candidate_count", "requirement_count", "runtime_registration_performed", "completed_requirements"]}))


if __name__ == "__main__":
    main()
