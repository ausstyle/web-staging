"""Reconcile provider schemas with all scope rows without registering fictitious executors.

Input contracts retain JSON references to the checksum-identified source document.
These are review candidates, never executable Sandy contracts or runtime grants.
"""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
import re
from typing import Any


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
        "deployment.jobs.cancel": [6], "deployment.management.release": [83],
        "deployment.audit.list": [9], "system.registry.list": [1], "system.registry.describe": [2],
        "system.registry.summary": [1], "supabase.projects.get": [76], "supabase.project.status": [76, 86],
        "supabase.project.health": [86], "supabase.branches.list": [80], "supabase.branches.get": [80],
        "supabase.network.restrictions.get": [78], "supabase.domains.get": [79],
        "supabase.functions.secrets.list": [84], "supabase.backups.list": [87],
        "supabase.functions.list": [83], "supabase.functions.get": [83],
        "supabase.db.migrations.list": [82], "supabase.database.inspect": [98],
        "supabase.schema.tables.list": [91], "supabase.schema.functions.list": [92],
        "supabase.schema.indexes.list": [93], "supabase.database.connections.list": [99],
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
            continue
        path = args.schemas / (source["provider"] + ".json")
        raw = path.read_bytes()
        digest = hashlib.sha256(raw).hexdigest()
        if digest != source["sha256"]:
            raise ValueError("Schema checksum mismatch: " + path.name)
        provider = "gcp" if source["provider"].startswith("gcp-") else source["provider"]
        operations.extend(candidates(provider, json.loads(raw), digest))
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
