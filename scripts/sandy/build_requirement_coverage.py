"""Reconcile all 161 families from captured production metadata and real evidence.

Registry flags, schema expansion and handler presence never certify execution.
This report groups development by shared adapters, retains operation contracts
and does not mutate exposure flags, permissions, credentials or provider state.
"""
import argparse
from collections import Counter, defaultdict
import datetime
import hashlib
import json
from pathlib import Path
import subprocess

ROOT = Path(__file__).resolve().parents[2]
DOCS = ROOT / "docs/sandy-api"


def load(path):
    return json.loads(path.read_text())


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def successful_call(call):
    return (call.get("channel") == "mcp" and call.get("http_status") == 200
            and call.get("api_status") in (200, 201) and call.get("is_error") is False
            and call.get("executed") is True and not call.get("error"))


def execution_evidence(docs=DOCS):
    positive, denied = defaultdict(list), defaultdict(list)
    workload = "engineering-workload-evidence-20261021.json"
    for operation, proof in load(docs / workload)["verified_operation_evidence"].items():
        if proof.get("mcp_end_to_end_verified") is True and proof.get("successful_calls"):
            positive[operation].append({"file": workload, "level": "authenticated_MCP_provider_execution_and_readback"})
        if proof.get("ordinary_nonowner_eight_denials_verified") is True:
            denied[operation].append({"file": workload, "level": "normal_nonowner_denied"})
    owner = "engineering-owner-mcp-evidence-20261021.json"
    for entry in load(docs / owner):
        proof = entry["proof"]
        if proof.get("mcp_end_to_end_verified") is True and any(c.get("mcp_is_error") is False and c.get("api_http") in (200, 201) and c.get("executed") is True for c in proof.get("successful_calls", [])):
            positive[entry["operation"]].append({"file": owner, "level": "normal_owner_MCP_application_database_execution"})
        if proof.get("nonowner_boundary_denial_verified") is True:
            denied[entry["operation"]].append({"file": owner, "level": "normal_nonowner_denied"})
    for filename in ["customer-onboarding-evidence-20261021.json", "customer-provisioning-evidence-20261021.json"]:
        report = load(docs / filename)
        if report.get("complete") is not True:
            continue
        for call in report["calls"]:
            if successful_call(call):
                value = {"file": filename, "level": "normal_customer_MCP_application_database_execution"}
                if value not in positive[call["operation"]]:
                    positive[call["operation"]].append(value)
            elif call.get("channel") == "mcp" and call.get("http_status") == 200 and call.get("is_error") is True and call.get("api_status") in (401, 403):
                value = {"file": filename, "level": "authenticated_MCP_authorization_or_entitlement_denial"}
                if value not in denied[call["operation"]]:
                    denied[call["operation"]].append(value)
    filename = "sandy-video-diagnostic-evidence-20261021.json"
    report = load(docs / filename)
    for call in report["diagnostic_operations"]:
        if call.get("positive_execution_verified") is True:
            positive[call["operation"]].append({"file": filename, "level": "authenticated_MCP_readonly_Google_observation"})
    if report.get("scope_revocation_denied_api_status") == 403:
        denied["video.status"].append({"file": filename, "level": "revoked_optional_workload_scope_denied"})
    return dict(positive), dict(denied)


def reconcile(requirements, registry, functions, disposition, positive, denied):
    ids = [row["requirement_id"] for row in requirements]
    if sorted(ids) != list(range(1, 162)):
        raise ValueError("exactly_one_row_for_each_original_requirement_required")
    rows = {row["operation"]: row for row in registry}
    if len(rows) != len(registry):
        raise ValueError("duplicate_registry_operation")
    live = {row.get("slug") or row.get("name"): row for row in functions}
    linked = defaultdict(set)
    for row in registry:
        for requirement in row.get("requirement_ids") or []:
            if isinstance(requirement, int) and 1 <= requirement <= 161:
                linked[requirement].add(row["operation"])
    for name in rows:
        if name.startswith("customer."):
            linked[161 if name.startswith(("customer.provisioning.features.", "customer.provisioning.templates.")) else 159].add(name)
    overrides = disposition.get("explicit_family_required_operations", {})
    excluded = disposition.get("standalone_mcp_tools_not_required", {})
    diagnostics = disposition.get("supporting_diagnostic_families", {})
    for name, families in diagnostics.items():
        for family in families:
            linked[family].add(name)
    matrix = []
    for requirement in requirements:
        ident = requirement["requirement_id"]
        candidates = set(requirement.get("registered_operation_ids", [])) | linked[ident]
        required = set(overrides.get(str(ident), candidates)) - set(excluded) - set(diagnostics)
        required_rows = [rows[name] for name in sorted(required) if name in rows]
        actual = sorted(required & set(positive))
        certified = disposition.get("family_acceptance", {}).get(str(ident), {})
        complete = (certified.get("all_required_constituents_reviewed") is True
                    and certified.get("shared_and_contract_tests_passed") is True
                    and certified.get("representative_provider_acceptance_passed") is True
                    and certified.get("higher_risk_independent_verification_passed") is True
                    and bool(certified.get("evidence_files")) and bool(required) and bool(actual)
                    and required <= rows.keys()
                    and all(row.get("api_exposed") is True and row.get("ai_exposed") is True for row in required_rows))
        matrix.append({
            "requirement_id": ident, "requirement": requirement["requirement"],
            "fully_accepted": complete,
            "state": "verified_complete" if complete else "partial_MCP_evidence" if actual else "not_yet_accepted",
            "required_operation_ids": sorted(required),
            "supporting_or_optional_candidates": sorted(candidates - required),
            "source_contract_candidates": sorted(set(requirement.get("source_gateway_operation_ids", [])) & required),
            "missing_registry_operation_ids": sorted(required - rows.keys()),
            "handler_labels": sorted({row["handler"] for row in required_rows}),
            "active_handler_metadata_count": sum(live.get(row["handler"], {}).get("status") == "ACTIVE" for row in required_rows),
            "api_exposure_flags": sum(row.get("api_exposed") is True for row in required_rows),
            "ai_exposure_flags": sum(row.get("ai_exposed") is True for row in required_rows),
            "actual_MCP_success_operation_ids": actual,
            "actual_MCP_denial_operation_ids": sorted(required & set(denied)),
            "supporting_MCP_success_operation_ids": sorted((candidates - required) & set(positive)),
            "remaining_capability": requirement.get("remaining_capability", "Constituent-level production acceptance remains required."),
            "wildcard_constituent_review": "required" if "*" in requirement["requirement"] else "explicit_scope",
        })
    return matrix


def build(registry, functions, owner_evidence, readback_dir, output, provenance=None):
    baseline = load(DOCS / "scope-reconciliation.json")
    disposition = load(DOCS / "scope-operation-disposition.json")
    # Preserve historical positive/negative evidence; no successful tests rerun.
    owner_target = DOCS / "engineering-owner-mcp-evidence-20261021.json"
    if owner_evidence is not None:
        owner_target.write_text(json.dumps(load(owner_evidence), indent=2) + "\n")
    positive, denied = execution_evidence()
    matrix = reconcile(baseline["requirements"], registry, functions, disposition, positive, denied)
    live = {row.get("slug") or row.get("name"): row for row in functions}
    groups = defaultdict(list)
    for row in registry:
        groups["internal_workflow_steps" if row["handler"].startswith("internal:") else row["handler"]].append(row["operation"])
    adapters = []
    for handler, names in sorted(groups.items()):
        metadata = live.get(handler)
        attested = None
        if metadata and readback_dir is not None:
            path = readback_dir / f"{handler}-v{metadata['version']}.json"
            if path.exists():
                evidence = load(path)
                if evidence.get("all_uploaded_sources_accounted_for") is True:
                    attested = {"source_commit": evidence.get("uploaded_source_commit"), "readback_sha256": digest(path)}
        adapters.append({"handler": handler, "catalogue_operations": len(names),
                         "active_function_metadata": metadata, "attested_source": attested,
                         "actual_MCP_success_operations": sorted(set(names) & set(positive)),
                         "state": "partially_MCP_verified" if set(names) & set(positive) else "unverified_by_this_evidence_set"})
    generated = []
    for filename in ["gateway_manifest.json", "expansion_gateway_manifest.json"]:
        generated.extend(load(ROOT / "supabase/functions/sandy-provider-operation-api" / filename)["operations"])
    existing = {row["operation"] for row in registry}
    source_head = subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=ROOT, text=True).strip()
    report = {"generated_at_utc": datetime.datetime.now(datetime.timezone.utc).isoformat(),
              "snapshot_provenance": provenance,
              "source_head": source_head, "original_pdf_sha256": digest(DOCS / "Sandy_Autonomous_Control_API_Specification.pdf"),
              "scope_markdown_sha256": digest(DOCS / "api-scope-161.md"),
              "semantics": {"flags_are_execution_evidence": False, "active_function_metadata_proves_operation_implementation": False,
                            "shared_adapter_tests_verify_every_provider_effect": False, "historical_tests_are_reused_at_their_recorded_versions": True,
                            "operation_counts_are_development_task_counts": False, "unknowns_are_not_external_blockers": True},
              "summary": {"original_families": 161, "fully_accepted_families": sum(row["fully_accepted"] for row in matrix),
                          "families_with_partial_required_operation_MCP_evidence": sum(bool(row["actual_MCP_success_operation_ids"]) for row in matrix),
                          "documented_distinct_MCP_success_operations": len(set(positive) & existing),
                          "documented_distinct_MCP_denial_operations": len(set(denied) & existing),
                          "registry_rows": len(registry), "api_flags": sum(row["api_exposed"] is True for row in registry),
                          "ai_flags": sum(row["ai_exposed"] is True for row in registry), "verified_flags": sum(row["verified"] is True for row in registry),
                          "handler_labels": len({row["handler"] for row in registry}), "shared_adapter_groups": len(adapters),
                          "schema_generated_operations_on_one_provider_adapter": len(generated),
                          "generated_provider_mix": dict(Counter(row["provider"] for row in generated))},
              "requirements": matrix, "shared_adapters": adapters,
              "provider_action_groups": [{**row, "registered_members": [name for name in row["operations"] if name in existing]} for row in disposition["provider_action_groups"]],
              "standalone_mcp_tools_not_required": disposition["standalone_mcp_tools_not_required"],
              "confirmed_external_dependencies": [
                  {"families": [48], "route": "Private Google Access prerequisite on the existing default subnet", "principal": "sandy-computer@elaborate-haven-511518-a5.iam.gserviceaccount.com", "missing_permission": "compute.subnetworks.setPrivateIpGoogleAccess", "actual_error": "Google HTTP 403", "evidence_file": "vm-network-preparation-evidence-20261021.json", "blocks_all_VM_transports": False},
                  {"families": [35], "route": "OS Config inventory inspection", "missing_permission": "osconfig.inventories.get", "actual_error": "Google HTTP 403 PERMISSION_DENIED", "evidence_file": "sandy-video-diagnostic-evidence-20261021.json", "blocks_all_VM_transports": False},
              ],
              "MCP_success_evidence": positive, "MCP_denial_evidence": denied,
              "production_registry_metadata": registry}
    output.write_text(json.dumps(report, indent=2) + "\n")
    lines = ["# Sandy 161-family production coverage", "", "Generated from production metadata and recorded execution evidence. Flags and active functions do not prove execution. Shared-adapter coverage is reused; expanded rows are not separate implementation projects.", "",
             f"**{report['summary']['fully_accepted_families']}/161 families fully accepted**; **{report['summary']['families_with_partial_required_operation_MCP_evidence']} families have partial required-operation MCP evidence**. **{len(positive)} distinct operations** have documented positive MCP evidence. All remaining families require constituent acceptance; unknowns are not labelled external blockers.", "",
             "| Family | Requirement | Required/candidate operations | API/AI flags | Actual required MCP success | State |", "|---:|---|---:|---:|---:|---|"]
    for row in matrix:
        lines.append(f"| {row['requirement_id']} | {row['requirement'].replace('|', '/')} | {len(row['required_operation_ids'])} | {row['api_exposure_flags']}/{row['ai_exposure_flags']} | {len(row['actual_MCP_success_operation_ids'])} | {row['state']} |")
    lines += ["", "Explicit-family optional candidates and the four legacy software/video-specific names are not new required implementation tasks. Wildcard expansion still needs semantic review; no unreviewed operation is declared globally out of scope.", "", "Operation-level schemas, permissions, risk classification, receipts and grants remain authoritative in the existing registry and typed source contracts. The JSON companion retains per-operation metadata, evidence references, missing IDs, shared adapter grouping and every family's remaining capability."]
    output.with_suffix(".md").write_text("\n".join(lines) + "\n")
    print(json.dumps(report["summary"]))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--registry", type=Path, required=True)
    parser.add_argument("--functions", type=Path, required=True)
    parser.add_argument("--owner-evidence", type=Path)
    parser.add_argument("--readback-dir", type=Path)
    parser.add_argument("--output", type=Path, default=DOCS / "requirement-coverage-161.json")
    args = parser.parse_args()
    provenance = {label: {"sha256": digest(path), "captured_at_utc": datetime.datetime.fromtimestamp(path.stat().st_mtime, datetime.timezone.utc).isoformat()}
                  for label, path in [("registry", args.registry), ("functions", args.functions)]}
    build(load(args.registry), load(args.functions), args.owner_evidence, args.readback_dir, args.output, provenance)
