import copy
import hashlib
import json
from pathlib import Path
import unittest
import tempfile
from build_requirement_coverage import reconcile, standing_execution_evidence, guest_status_execution_evidence


def requirements():
    return [{"requirement_id": i, "requirement": "Original family " + str(i),
             "registered_operation_ids": [], "source_gateway_operation_ids": []} for i in range(1, 162)]


def operation(name):
    return {"operation": name, "handler": "shared-adapter", "requirement_ids": [],
            "api_exposed": True, "ai_exposed": True, "verified": True}


class RequirementCoverageTests(unittest.TestCase):
    def test_family_certificate_requires_current_contract_deployment_and_evidence_bytes(self):
        families = requirements()
        families[0]["registered_operation_ids"] = ["fixture.read"]
        row = {**operation("fixture.read"), "error_contract": {"contract_sha256": "a" * 64}}
        live = {"name": "shared-adapter", "status": "ACTIVE", "version": 7, "verify_jwt": True}
        certificate = {"all_required_constituents_reviewed": True,
                       "shared_and_contract_tests_passed": True,
                       "representative_provider_acceptance_passed": True,
                       "higher_risk_independent_verification_passed": True,
                       "evidence_files": ["proof.json"],
                       "evidence_sha256": {"proof.json": hashlib.sha256(b"{}").hexdigest()},
                       "operation_bindings": {"fixture.read": {
                           "contract_sha256": "a" * 64, "handler": "shared-adapter",
                           "version": 7, "verify_jwt": True}}}
        policy = {"explicit_family_required_operations": {"1": ["fixture.read"]},
                  "family_acceptance": {"1": certificate}}
        positive = {"fixture.read": [{"file": "proof.json"}]}
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "proof.json").write_bytes(b"{}")
            def accepted(p=policy, r=row, f=live):
                return reconcile(families, [r], [f], p, positive, {}, evidence_root=root)[0]
            self.assertTrue(accepted()["fully_accepted"])
            for gap in (["required publication adapter missing"], {"missing": "team permission lifecycle"}, "malformed gap record"):
                altered = copy.deepcopy(policy)
                altered["unresolved_family_capabilities"] = {"1": gap}
                result = accepted(p=altered)
                self.assertFalse(result["fully_accepted"])
                self.assertEqual(result["unresolved_capability_obligations"], gap)
                self.assertEqual(result["actual_MCP_success_operation_ids"], ["fixture.read"])

            for altered in [{**live, "version": 8}, {**live, "status": "REMOVED"},
                            {**live, "verify_jwt": False}, {**live, "version": None}]:
                self.assertFalse(accepted(f=altered)["fully_accepted"])
            self.assertFalse(accepted(r={**row, "error_contract": {"contract_sha256": "b" * 64}})["fully_accepted"])
            self.assertFalse(accepted(r={**row, "error_contract": {}})["fully_accepted"])
            for field in ("operation_bindings", "evidence_sha256"):
                altered = copy.deepcopy(policy)
                del altered["family_acceptance"]["1"][field]
                self.assertFalse(accepted(p=altered)["fully_accepted"])
            for name in (str(root / "proof.json"), "../proof.json"):
                altered = copy.deepcopy(policy)
                cert = altered["family_acceptance"]["1"]
                cert["evidence_files"] = [name]
                cert["evidence_sha256"] = {name: hashlib.sha256(b"{}").hexdigest()}
                self.assertFalse(accepted(p=altered)["fully_accepted"])
            altered = copy.deepcopy(policy)
            altered["family_acceptance"]["1"]["operation_bindings"]["unreviewed.read"] = {}
            self.assertFalse(accepted(p=altered)["fully_accepted"])
            altered = copy.deepcopy(policy)
            del altered["explicit_family_required_operations"]
            self.assertFalse(accepted(p=altered)["fully_accepted"])
            (root / "proof.json").write_bytes(b"changed")
            stale = accepted()
            self.assertFalse(stale["fully_accepted"])
            self.assertEqual(stale["actual_MCP_success_operation_ids"], ["fixture.read"])
            (root / "proof.json").unlink()
            self.assertFalse(accepted()["fully_accepted"])

    def test_guest_status_requires_actual_matching_receipts_and_never_certifies_VM_execution(self):
        docs = Path(__file__).resolve().parents[2] / "docs/sandy-api"
        path = docs / "guest-status-MCP-evidence-20261022.json"
        report = json.loads(path.read_text())
        verification = json.loads((docs / "guest-status-registry-verification-20261022.json").read_text())
        sha = hashlib.sha256(path.read_bytes()).hexdigest()
        positive, _ = guest_status_execution_evidence(report, verification, sha)
        self.assertIn("gcp.vm.agent.status", positive)
        self.assertIs(positive["gcp.vm.agent.status"][0]["independent_VM_execution"], False)
        for field, value in [("state", "accepted"), ("result_sha256", "0" * 64)]:
            altered = copy.deepcopy(report)
            altered["verified_status_observations"][0]["admission"][field] = value
            self.assertEqual(guest_status_execution_evidence(altered, verification, sha), ({}, {}))
        altered = copy.deepcopy(report)
        altered["verified_status_observations"][0]["audit"][0]["hash_valid"] = False
        self.assertEqual(guest_status_execution_evidence(altered, verification, sha), ({}, {}))
        self.assertEqual(guest_status_execution_evidence(report, verification, "0" * 64), ({}, {}))

    def test_flags_active_handler_and_claimed_certificate_cannot_replace_mcp_execution(self):
        families = requirements()
        families[0]["registered_operation_ids"] = ["fixture.read"]
        policy = {"family_acceptance": {"1": {"all_required_constituents_reviewed": True,
                  "shared_and_contract_tests_passed": True, "representative_provider_acceptance_passed": True,
                  "higher_risk_independent_verification_passed": True, "evidence_files": ["claimed.json"]}}}
        result = reconcile(families, [operation("fixture.read")], [{"name": "shared-adapter", "status": "ACTIVE"}], policy, {}, {})
        self.assertFalse(result[0]["fully_accepted"])
        self.assertEqual(result[0]["actual_MCP_success_operation_ids"], [])
        self.assertEqual(len(result), 161)

    def test_one_real_operation_is_partial_evidence_not_whole_family_acceptance(self):
        families = requirements()
        families[0]["registered_operation_ids"] = ["fixture.read", "fixture.write"]
        result = reconcile(families, [operation("fixture.read"), operation("fixture.write")], [], {}, {"fixture.read": ["actual.json"]}, {})
        self.assertEqual(result[0]["state"], "partial_MCP_evidence")
        self.assertEqual(result[0]["constituent_mapping_status"], "unreviewed_candidates_not_independent_development_tasks")
        self.assertFalse(result[0]["fully_accepted"])
        self.assertEqual(result[0]["actual_MCP_success_operation_ids"], ["fixture.read"])

    def test_claimed_family_certificate_cannot_hide_an_unexecuted_required_constituent(self):
        families = requirements()
        families[0]["registered_operation_ids"] = ["fixture.read", "fixture.write"]
        policy = {"explicit_family_required_operations": {"1": ["fixture.read", "fixture.write"]},
                  "family_acceptance": {"1": {"all_required_constituents_reviewed": True,
                  "shared_and_contract_tests_passed": True, "representative_provider_acceptance_passed": True,
                  "higher_risk_independent_verification_passed": True, "evidence_files": ["actual.json"]}}}
        result = reconcile(families, [operation("fixture.read"), operation("fixture.write")], [], policy,
                           {"fixture.read": ["actual.json"]}, {})
        self.assertFalse(result[0]["fully_accepted"])

    def test_live_metadata_omission_does_not_silently_remove_a_previously_mapped_constituent(self):
        families = requirements()
        families[0]["historical_candidate_operation_ids"] = ["fixture.read", "fixture.write"]
        rows = [operation("fixture.read"), {**operation("fixture.write"), "api_exposed": False}]
        result = reconcile(families, rows, [], {}, {"fixture.read": ["actual.json"]}, {})
        self.assertEqual(result[0]["required_operation_ids"], ["fixture.read", "fixture.write"])
        self.assertFalse(result[0]["fully_accepted"])
        self.assertTrue(result[0]["software_or_constituent_reconciliation_required"])

    def test_expanded_provider_candidates_do_not_create_unrequested_development_units(self):
        families = requirements()
        families[25]["registered_operation_ids"] = ["gcp.compute.instances.get", "gcp.compute.instances.simulate_maintenance_event"]
        policy = {"explicit_family_required_operations": {"26": ["gcp.compute.instances.get"]}}
        result = reconcile(families, [operation(name) for name in families[25]["registered_operation_ids"]], [], policy, {}, {})
        self.assertEqual(result[25]["required_operation_ids"], ["gcp.compute.instances.get"])
        self.assertEqual(result[25]["constituent_mapping_status"], "reviewed_explicit_operations")
        self.assertEqual(result[25]["supporting_or_optional_candidates"], ["gcp.compute.instances.simulate_maintenance_event"])

    def test_vm_diagnostics_do_not_certify_generic_execution_or_video_applications(self):
        families = requirements()
        families[149]["registered_operation_ids"] = ["video.status"]
        policy = {"supporting_diagnostic_families": {"video.status": [26]}}
        result = reconcile(families, [operation("video.status")], [], policy, {"video.status": ["actual.json"]}, {})
        self.assertEqual(result[25]["supporting_MCP_success_operation_ids"], ["video.status"])
        self.assertEqual(result[149]["actual_MCP_success_operation_ids"], [])
        self.assertFalse(any(row["fully_accepted"] for row in result))

    def test_function_states_distinguish_code_flags_scope_and_real_execution(self):
        families = requirements()
        families[0]["registered_operation_ids"] = ["fixture.read", "fixture.write"]
        families[0]["source_gateway_operation_ids"] = ["fixture.read"]
        result = reconcile(families, [operation("fixture.read"), operation("fixture.write")], [], {},
                           {"fixture.read": [{"file": "real-provider.json"}]}, {})
        states = {row["operation"]: row for row in result[0]["operation_delivery_states"]}
        self.assertTrue(states["fixture.read"]["authorized_MCP_execution_verified_for_recorded_scope"])
        self.assertFalse(states["fixture.write"]["authorized_MCP_execution_verified_for_recorded_scope"])
        self.assertTrue(states["fixture.write"]["MCP_exposed_flag"])
        self.assertFalse(states["fixture.write"]["source_contract_candidate_present"])
        self.assertEqual(states["fixture.read"]["code_assessment"], "real_execution_at_recorded_release")
        self.assertEqual(states["fixture.write"]["code_assessment"], "current_code_review_incomplete")
        self.assertEqual(states["fixture.read"]["MCP_discovery_observation"],
                         "not_independently_inferred_from_flags_or_call_success")

    def test_missing_or_duplicate_original_family_is_rejected(self):
        families = requirements()
        families[-1] = families[0]
        with self.assertRaisesRegex(ValueError, "each_original_requirement"):
            reconcile(families, [], [], {}, {}, {})

    def test_explicit_review_requires_all_source_constituents_and_never_certifies_execution(self):
        families = requirements()
        families[0]["registered_operation_ids"] = ["fixture.read", "fixture.write"]
        families[0]["source_gateway_operation_ids"] = ["fixture.read"]
        policy = {"implementation_review": {"1": {"reviewed_explicit_constituents": True,
                  "code_status": "implemented_for_reviewed_authorized_targets"}}}
        rows = [operation("fixture.read"), operation("fixture.write")]
        result = reconcile(families, rows, [], policy, {}, {})
        self.assertTrue(result[0]["software_or_constituent_reconciliation_required"])
        families[0]["source_gateway_operation_ids"].append("fixture.write")
        result = reconcile(families, rows, [], policy, {}, {})
        self.assertEqual(result[0]["implementation_assessment"], "implemented_awaiting_real_family_acceptance")
        self.assertFalse(result[0]["fully_accepted"])

    def test_external_permission_dependency_does_not_erase_software_gaps(self):
        families = requirements()
        policy = {"external_dependencies": [{"id": "iap", "families": [36, 37], "type": "external_permission"}]}
        result = reconcile(families, [], [], policy, {}, {})
        self.assertEqual(result[35]["external_dependency_ids"], ["iap"])
        self.assertTrue(result[35]["software_or_constituent_reconciliation_required"])
        self.assertEqual(result[34]["external_dependency_ids"], [])

    def test_required_business_operations_absent_from_catalogue_remain_visible_as_gaps(self):
        families = requirements()
        families[75]["registered_operation_ids"] = ["supabase.projects.get"]
        policy = {"explicit_family_required_operations": {"76": ["supabase.projects.get", "supabase.projects.create"]}}
        result = reconcile(families, [operation("supabase.projects.get")], [], policy, {}, {})
        self.assertEqual(result[75]["missing_registry_operation_ids"], ["supabase.projects.create"])
        self.assertIn("supabase.projects.create", result[75]["required_operation_ids"])
        self.assertFalse(result[75]["fully_accepted"])


if __name__ == "__main__":
    unittest.main()


class StandingEvidenceTests(unittest.TestCase):
    def test_hash_or_failed_durable_receipt_cannot_certify_a_provider_operation(self):
        op = "github.repos.get"
        report = {"complete": True, "operation_evidence": {op: {
            "mcp_end_to_end_verified": True, "successful_calls": [{
                "operation": op, "channel": "mcp", "http_status": 200,
                "api_status": 200, "is_error": False, "executed": True,
                "admission_id": "receipt"}]}}, "durable_admissions": [{
                    "id": "receipt", "state": "failed", "job_status": "failed",
                    "audit": [{"hash_valid": True, "previous_link_valid": True}]}]}
        verification = {"evidence_sha256": "correct", "operations": [{
            "operation": op, "verified": True,
            "evidence": {"evidence_sha256": "correct"}}]}
        self.assertEqual(standing_execution_evidence(report, verification, "wrong"), ({}, {}))
        self.assertEqual(standing_execution_evidence(report, verification, "correct"), ({}, {}))
        report["durable_admissions"][0].update(state="succeeded", job_status="succeeded")
        positive, _ = standing_execution_evidence(report, verification, "correct")
        self.assertIn(op, positive)
        self.assertFalse(positive[op][0]["whole_family_acceptance"])
        report["durable_admissions"][0]["audit"][0]["hash_valid"] = False
        self.assertEqual(standing_execution_evidence(report, verification, "correct"), ({}, {}))
