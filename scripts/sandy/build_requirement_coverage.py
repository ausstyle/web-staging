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


def standing_execution_evidence(report, verification, evidence_sha256):
    """Accept operation-specific MCP evidence only with matching registry readback.

    These are historical executions at their recorded releases, never blanket
    certificates for a wildcard family or a newly revised provider contract.
    """
    positive, denied = defaultdict(list), defaultdict(list)
    if (report.get("complete") is not True
            or verification.get("evidence_sha256") != evidence_sha256):
        return {}, {}
    durable = {r["id"]: r for r in report.get("durable_admissions", [])}
    registry = {r["operation"]: r for r in verification.get("operations", [])}
    filename = "standing-engineering-GitHub-MCP-evidence-20261022.json"
    for operation, proof in report.get("operation_evidence", {}).items():
        row = registry.get(operation, {})
        if (proof.get("mcp_end_to_end_verified") is not True or row.get("verified") is not True
                or row.get("evidence", {}).get("evidence_sha256") != evidence_sha256):
            continue
        for call in proof.get("successful_calls", []):
            if not successful_call(call) or call.get("operation") != operation:
                continue
            admission = call.get("admission_id")
            receipt = call.get("execution_receipt")
            record = durable.get(admission, {})
            if admission and (record.get("state") != "succeeded"
                    or record.get("job_status") != "succeeded"
                    or not record.get("audit") or not all(a.get("hash_valid") is True
                        and a.get("previous_link_valid") is True for a in record["audit"])):
                continue
            if receipt and (receipt.get("state") != "succeeded"
                    or receipt.get("effect_verified") is not True
                    or receipt.get("admission_id") != admission):
                continue
            if not admission and operation not in ("system.lifecycle.get", "system.lifecycle.verify"):
                continue
            value = {"file": filename, "level": "standing_Auth_MCP_provider_execution_at_recorded_release",
                     "durable_admission_receipt_present": bool(admission),
                     "whole_family_acceptance": False}
            if value not in positive[operation]:
                positive[operation].append(value)
    for call in report.get("policy_denials", []):
        if (call.get("http_status") == 200 and call.get("API_status") == 403
                and call.get("MCP_isError") is True and call.get("executed") is False
                and call.get("provider_admissions") == 0
                and call.get("authenticated_denial_audit", {}).get("hash_valid") is True):
            value = {"file": filename, "level": "standing_Auth_MCP_scope_expiry_revocation_denied_before_provider"}
            if value not in denied[call["operation"]]:
                denied[call["operation"]].append(value)
    return dict(positive), dict(denied)


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
    filename = "canonical-vm-read-MCP-evidence-20261021.json"
    path = docs / filename
    if path.exists():
        report = load(path)
        if (report.get("passed") is True and report.get("http_status") == 200
                and report.get("MCP_is_error") is False and report.get("API_status") == 200
                and report.get("executed") is True and report.get("provider_http_status") == 200
                and report.get("provider_instance_id") == "6831598645020395570"
                and report.get("provider_instance_name") == "sandy-video"):
            positive["gcp.compute.instances.get"].append({"file": filename,
                "level": "normal_Auth_owner_delegated_MCP_canonical_Google_provider_read",
                "admission_id": report["admission_id"]})
    filename = "canonical-vm-read-denial-evidence-20261021.json"
    path = docs / filename
    if path.exists():
        report = load(path)
        if report.get("passed") is True and any(test.get("MCP_is_error") is True
                and test.get("API_status") == 403 and test.get("executed") is False
                for test in report.get("tests", [])):
            denied["gcp.compute.instances.get"].append({"file": filename,
                "level": "normal_Auth_MCP_wrong_target_and_revoked_delegation_denied"})
    filename = "customer-service-MCP-evidence-20261022.json"
    path = docs / filename
    if path.exists():
        report = load(path)
        if report.get("independent_readback_matches") is True:
            for operation, proof in report.get("operation_evidence", {}).items():
                calls = proof.get("successful_calls", [])
                if (proof.get("all_fixtures_cleaned") is True and len(calls) == 2
                        and all(call.get("passed") is True and call.get("discovered") is True
                                and call.get("http_status") == 200 and call.get("api_status") == 200
                                and call.get("is_error") is False and call.get("executed") is True for call in calls)):
                    positive[operation].append({"file": filename,
                        "level": "normal_customer_MCP_read_nonempty_fixture_asserted" if proof.get("nonempty_fixture_assertion_performed")
                            else "normal_customer_MCP_read_without_nonempty_resource_assertion",
                        "durable_admission_receipt_present": False})
                for call in proof.get("negative_calls", []):
                    if call.get("negative") is True and call.get("passed") is True and call.get("is_error") is True:
                        value = {"file": filename, "level": "normal_customer_foreign_resource_hidden_or_identity_override_rejected"}
                        if value not in denied[call["operation"]]:
                            denied[call["operation"]].append(value)
    filename = "customer-read-receipt-MCP-evidence-20261022.json"
    path = docs / filename
    if path.exists():
        report = load(path)
        live = report.get("normal_Auth_test", {})
        if (report.get("registry_evidence_readback_matches") is True and live.get("complete") is True
                and live.get("cleanup", {}).get("complete") is True):
            for operation, proof in report.get("operation_proofs", {}).items():
                calls = [c for c in live.get("calls", []) if c.get("operation") == operation
                         and c.get("negative") is not True and c.get("discovered") is True]
                receipts = proof.get("independent_receipts", [])
                if (len(calls) == 2 and all(c.get("passed") is True and c.get("api_status") == 200
                        and c.get("executed") is True and c.get("admission_id") for c in calls)
                        and proof.get("durable_admission_receipt_present") is True
                        and all(any(r.get("id") == c["admission_id"] and r.get("state") == "succeeded"
                                    and r.get("audit_events") == 3 for r in receipts) for c in calls)):
                    positive[operation].append({"file": filename,
                        "level": "normal_customer_MCP_nonempty_read_shared_receipt_and_audit_verified",
                        "durable_admission_receipt_present": True})
            for call in live.get("calls", []):
                if (call.get("request_replay") is True and call.get("passed") is True
                        and call.get("api_status") == 409 and call.get("executed") is False):
                    value = {"file": filename, "level": "MCP_request_replay_or_changed_operation_refused"}
                    if value not in denied[call["operation"]]:
                        denied[call["operation"]].append(value)
    filename = "github-platform-MCP-evidence-20261022.json"
    path = docs / filename
    if path.exists():
        report = load(path)
        durable = report.get("durable_verification", {}).get("real_MCP_admissions", [])
        for call in report.get("MCP_execution", {}).values():
            receipt = call.get("execution_receipt") or {}
            if (call.get("verified") is True and call.get("http_status") == 200
                    and call.get("api_status") in (200, 201) and call.get("is_error") is False
                    and call.get("executed") is True and receipt.get("state") == "succeeded"
                    and receipt.get("effect_verified") is True and any(
                        row.get("id") == call.get("admission_id") == receipt.get("admission_id")
                        and row.get("state") == row.get("job_status") == "succeeded"
                        and row.get("verification_sha256") == receipt.get("verification_sha256")
                        for row in durable)):
                value = {"file": filename, "level": "MCP_GitHub_fixture_immutable_readback_settled_receipt",
                         "durable_admission_receipt_present": True}
                if value not in positive[call["operation"]]:
                    positive[call["operation"]].append(value)
        for call in report.get("negative_execution", []):
            # A runtime refusal before MCP is a separate dependency, not MCP evidence.
            if (call.get("denial_layer") == "MCP_to_API" and call.get("passed") is True
                    and call.get("http_status") == 200 and call.get("api_status") == 403
                    and call.get("executed") is False and not call.get("admission_id")):
                value = {"file": filename, "level": "MCP_GitHub_fixture_wrong_scope_or_replay_denied"}
                if value not in denied[call["operation"]]:
                    denied[call["operation"]].append(value)
    filename = "standing-engineering-GitHub-MCP-evidence-20261022.json"
    readback = docs / "standing-engineering-registry-verification-20261022.json"
    if (docs / filename).exists() and readback.exists():
        report = load(docs / filename)
        reference = report.get("durable_admissions_reference", {})
        if reference.get("file") == "standing-engineering-durable-admissions-20261022.json":
            receipts = docs / reference["file"]
            if receipts.exists() and digest(receipts) == reference.get("sha256"):
                report["durable_admissions"] = load(receipts)
        actual, refusals = standing_execution_evidence(report, load(readback), digest(docs / filename))
        for operation, evidence in actual.items():
            positive[operation].extend(evidence)
        for operation, evidence in refusals.items():
            denied[operation].extend(evidence)
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
        candidates = (set(requirement.get("registered_operation_ids", [])) | linked[ident]
                      | set(requirement.get("historical_candidate_operation_ids", [])))
        required = set(overrides.get(str(ident), candidates)) - set(excluded) - set(diagnostics)
        required_rows = [rows[name] for name in sorted(required) if name in rows]
        actual = sorted(required & set(positive))
        certified = disposition.get("family_acceptance", {}).get(str(ident), {})
        complete = (certified.get("all_required_constituents_reviewed") is True
                    and certified.get("shared_and_contract_tests_passed") is True
                    and certified.get("representative_provider_acceptance_passed") is True
                    and certified.get("higher_risk_independent_verification_passed") is True
                    and bool(certified.get("evidence_files")) and bool(required) and required <= set(positive)
                    and required <= rows.keys()
                    and all(row.get("api_exposed") is True and row.get("ai_exposed") is True for row in required_rows))
        review = disposition.get("implementation_review", {}).get(str(ident), {})
        # Only an explicit constituent review can classify code as complete.
        # A deployed function, registry flags or a generated schema cannot do so.
        source_candidates = set(requirement.get("source_gateway_operation_ids", []))
        implemented = (review.get("reviewed_explicit_constituents") is True
                       and review.get("code_status") == "implemented_for_reviewed_authorized_targets"
                       and bool(required) and required <= rows.keys()
                       and required <= source_candidates)
        external = [dependency for dependency in disposition.get("external_dependencies", [])
                    if ident in dependency["families"]]
        software_required = not complete and not implemented
        matrix.append({
            "requirement_id": ident, "requirement": requirement["requirement"],
            "fully_accepted": complete,
            "implementation_assessment": "implemented_awaiting_real_family_acceptance" if implemented and not complete
                else "fully_operational" if complete else "implementation_or_constituent_reconciliation_required",
            "implementation_review": review or None,
            "software_or_constituent_reconciliation_required": software_required,
            "external_dependency_ids": [dependency["id"] for dependency in external],
            "external_dependency_details": external,
            "production_handler_versions": {name: {key: live[name].get(key) for key in ("version", "status", "verify_jwt")}
                                            for name in sorted({row["handler"] for row in required_rows}) if name in live},
            "MCP_exposure_assessment": "all_required_flags_enabled_but_execution_still_requires_authorization_and_acceptance"
                if required_rows and len(required_rows) == len(required) and all(row.get("api_exposed") is True and row.get("ai_exposed") is True for row in required_rows)
                else "one_or_more_required_operations_not_API_and_MCP_exposed",
            "state": "verified_complete" if complete else "partial_MCP_evidence" if actual else "not_yet_accepted",
            "required_operation_ids": sorted(required),
            "operation_delivery_states": [{
                "operation": name,
                "registered": name in rows,
                "source_contract_candidate_present": name in source_candidates,
                "code_assessment": "real_execution_at_recorded_release" if name in positive
                    else "explicit_constituent_code_review" if implemented else "current_code_review_incomplete",
                "API_exposed_flag": rows.get(name, {}).get("api_exposed") is True,
                "MCP_exposed_flag": rows.get(name, {}).get("ai_exposed") is True,
                "MCP_discovery_observation": "not_independently_inferred_from_flags_or_call_success",
                "authorized_MCP_execution_verified_for_recorded_scope": name in positive,
                "authorized_execution_evidence": positive.get(name, []),
                "denied_execution_evidence": denied.get(name, []),
                "existing_target_only_not_universal_authority": True,
            } for name in sorted(required)],
            "constituent_mapping_status": "reviewed_explicit_operations" if str(ident) in overrides
                else "unreviewed_candidates_not_independent_development_tasks",
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
            "remaining_capability": disposition.get("current_remaining_capability", {}).get(str(ident),
                requirement.get("remaining_capability", "Constituent-level production acceptance remains required.")),
            "remaining_capability_basis": "current_review" if str(ident) in disposition.get("current_remaining_capability", {})
                else "historical_source_reconciliation_pending_current_constituent_review",
            "wildcard_constituent_review": "required" if "*" in requirement["requirement"] else "explicit_scope",
        })
    return matrix


def build(registry, functions, owner_evidence, readback_dir, output, provenance=None):
    baseline = load(DOCS / "scope-reconciliation.json")
    disposition = load(DOCS / "scope-operation-disposition.json")
    # Live database evidence can omit source-derived family links. Do not erase
    # the prior reconciled candidate set when refreshing live flags/versions.
    # Explicit reviewed dispositions still decide required/optional operations;
    # retained candidates confer neither implementation nor execution evidence.
    if output.exists():
        previous = load(output)
        prior = previous.get("requirements", [])
        if (previous.get("scope_markdown_sha256") == digest(DOCS / "api-scope-161.md")
                and sorted(row["requirement_id"] for row in prior) == list(range(1, 162))):
            by_id = {row["requirement_id"]: row for row in prior}
            for requirement in baseline["requirements"]:
                row = by_id[requirement["requirement_id"]]
                requirement["historical_candidate_operation_ids"] = sorted(
                    set(row.get("required_operation_ids", [])) | set(row.get("supporting_or_optional_candidates", [])))
    # Preserve historical positive/negative evidence; no successful tests rerun.
    owner_target = DOCS / "engineering-owner-mcp-evidence-20261021.json"
    if owner_evidence is not None:
        owner_target.write_text(json.dumps(load(owner_evidence), indent=2) + "\n")
    positive, denied = execution_evidence()
    matrix = reconcile(baseline["requirements"], registry, functions, disposition, positive, denied)
    interface_proof = DOCS / "REST-log-MCP-evidence-20261022.json"
    if interface_proof.exists():
        proof = load(interface_proof).get("proof", {}).get("live_acceptance", {})
        if proof.get("passed") is True:
            for index in (0, 1):
                matrix[index]["interface_execution_evidence"] = {
                    "file": interface_proof.name, "API_REST_pages": proof.get("API_REST_discovery_pages"),
                    "API_REST_description_verified": proof.get("API_REST_description_verified"),
                    "normal_Auth_MCP_tools_discovered": proof.get("tools_discovered"),
                    "canonical_named_metadata_tool_invocation_not_inferred": True,
                    "family_acceptance_not_inferred": True,
                }
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
                            "operation_counts_are_development_task_counts": False, "unknowns_are_not_external_blockers": True,
                            "prior_source_family_candidates_retained_without_execution_inference": True},
              "summary": {"original_families": 161, "fully_accepted_families": sum(row["fully_accepted"] for row in matrix),
                          "implemented_families_awaiting_real_verification": sum(row["implementation_assessment"] == "implemented_awaiting_real_family_acceptance" for row in matrix),
                          "families_with_external_dependencies": sum(bool(row["external_dependency_ids"]) for row in matrix),
                          "families_with_external_permission_dependencies": sum(any(item["type"] == "external_permission" for item in row["external_dependency_details"]) for row in matrix),
                          "families_requiring_software_or_constituent_reconciliation": sum(row["software_or_constituent_reconciliation_required"] for row in matrix),
                          "families_with_partial_required_operation_MCP_evidence": sum(bool(row["actual_MCP_success_operation_ids"]) for row in matrix),
                          "documented_distinct_MCP_success_operations": len(set(positive) & existing),
                          "documented_distinct_MCP_denial_operations": len(set(denied) & existing),
                          "registry_rows": len(registry), "api_flags": sum(row["api_exposed"] is True for row in registry),
                          "ai_flags": sum(row["ai_exposed"] is True for row in registry), "verified_flags": sum(row["verified"] is True for row in registry),
                          "missing_required_registry_operation_ids": sorted({name for row in matrix for name in row["missing_registry_operation_ids"]}),
                          "handler_labels": len({row["handler"] for row in registry}), "shared_adapter_groups": len(adapters),
                          "schema_generated_operations_on_one_provider_adapter": len(generated),
                          "generated_provider_mix": dict(Counter(row["provider"] for row in generated))},
              "requirements": matrix, "shared_adapters": adapters,
              "provider_action_groups": [{**row, "registered_members": [name for name in row["operations"] if name in existing]} for row in disposition["provider_action_groups"]],
              "standalone_mcp_tools_not_required": disposition["standalone_mcp_tools_not_required"],
              "known_required_operation_gaps": disposition.get("known_required_operation_gaps", {}),
              "computer_scope_obligations": disposition.get("computer_scope_obligations"),
              "family_external_dependencies": disposition.get("external_dependencies", []),
              "confirmed_external_dependencies": [
                  {"families": [48], "route": "Private Google Access prerequisite on the existing default subnet", "principal": "sandy-computer@elaborate-haven-511518-a5.iam.gserviceaccount.com", "missing_permission": "compute.subnetworks.setPrivateIpGoogleAccess", "actual_error": "Google HTTP 403", "evidence_file": "vm-network-preparation-evidence-20261021.json", "blocks_all_VM_transports": False},
                  {"families": [35], "route": "OS Config inventory inspection", "missing_permission": "osconfig.inventories.get", "actual_error": "Google HTTP 403 PERMISSION_DENIED", "evidence_file": "sandy-video-diagnostic-evidence-20261021.json", "blocks_all_VM_transports": False},
              ],
              "MCP_success_evidence": positive, "MCP_denial_evidence": denied,
              "production_registry_metadata": registry}
    output.write_text(json.dumps(report, indent=2) + "\n")
    lines = ["# Sandy 161-family production coverage", "", "Generated from production metadata and recorded execution evidence. Flags and active functions do not prove execution. Shared-adapter coverage is reused; expanded rows are not separate implementation projects.", "",
             f"**{report['summary']['fully_accepted_families']}/161 families fully accepted**; **{report['summary']['families_with_partial_required_operation_MCP_evidence']} families have partial required-operation MCP evidence**. **{len(positive)} distinct operations** have documented positive MCP evidence. All remaining families require constituent acceptance; unknowns are not labelled external blockers.", "",
             f"**{report['summary']['implemented_families_awaiting_real_verification']} explicit families have reviewed code awaiting real family acceptance**; **{report['summary']['families_requiring_software_or_constituent_reconciliation']} need software, integration or constituent reconciliation**. **{report['summary']['families_with_external_dependencies']} have documented external dependencies**, including **{report['summary']['families_with_external_permission_dependencies']} with permission denials**. External dependencies overlap the implementation counts; they do not certify completion or explain every missing function.", "",
             "The code review is limited to the existing authorized provider targets. It does not certify additional projects, tenants, organizations or newly purchased services. A missing review is classified as work remaining, not proof that every constituent lacks code. Wildcard families stay incomplete until their required business constituents are reconciled and accepted.", "",
             "Only explicit reviewed mappings are definitive required sets. Unreviewed wildcard/provider expansion remains a candidate set; its size is not a count of required development tasks. The JSON marks this distinction per family.", "",
             "| Family | Requirement | Reviewed required / candidates | API/AI flags | Actual required/candidate MCP success | Implementation assessment | External dependencies |", "|---:|---|---:|---:|---:|---|---|"]
    for row in matrix:
        lines.append(f"| {row['requirement_id']} | {row['requirement'].replace('|', '/')} | {len(row['required_operation_ids'])} | {row['api_exposure_flags']}/{row['ai_exposure_flags']} | {len(row['actual_MCP_success_operation_ids'])} | {row['implementation_assessment']} | {', '.join(row['external_dependency_ids']) or 'none established'} |")
    lines += ["", "Explicit-family optional candidates and the four legacy software/video-specific names are not new required implementation tasks. Wildcard expansion still needs semantic review; no unreviewed operation is declared globally out of scope.", "", "Operation-level schemas, permissions, risk classification, receipts and grants remain authoritative in the existing registry and typed source contracts. The JSON companion retains per-operation metadata, evidence references, missing IDs, shared adapter grouping and every family's remaining capability."]
    if report["known_required_operation_gaps"]:
        lines += ["", "Known missing contracts within the original scope (reported without adding registry rows):", ""]
        lines += [f"- `{name}`: {reason}" for name, reason in report["known_required_operation_gaps"].items()]
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
