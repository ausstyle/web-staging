import unittest
from build_requirement_coverage import reconcile


def requirements():
    return [{"requirement_id": i, "requirement": "Original family " + str(i),
             "registered_operation_ids": [], "source_gateway_operation_ids": []} for i in range(1, 162)]


def operation(name):
    return {"operation": name, "handler": "shared-adapter", "requirement_ids": [],
            "api_exposed": True, "ai_exposed": True, "verified": True}


class RequirementCoverageTests(unittest.TestCase):
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
