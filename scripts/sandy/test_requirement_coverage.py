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
        self.assertFalse(result[0]["fully_accepted"])
        self.assertEqual(result[0]["actual_MCP_success_operation_ids"], ["fixture.read"])

    def test_expanded_provider_candidates_do_not_create_unrequested_development_units(self):
        families = requirements()
        families[25]["registered_operation_ids"] = ["gcp.compute.instances.get", "gcp.compute.instances.simulate_maintenance_event"]
        policy = {"explicit_family_required_operations": {"26": ["gcp.compute.instances.get"]}}
        result = reconcile(families, [operation(name) for name in families[25]["registered_operation_ids"]], [], policy, {}, {})
        self.assertEqual(result[25]["required_operation_ids"], ["gcp.compute.instances.get"])
        self.assertEqual(result[25]["supporting_or_optional_candidates"], ["gcp.compute.instances.simulate_maintenance_event"])

    def test_vm_diagnostics_do_not_certify_generic_execution_or_video_applications(self):
        families = requirements()
        families[149]["registered_operation_ids"] = ["video.status"]
        policy = {"supporting_diagnostic_families": {"video.status": [26]}}
        result = reconcile(families, [operation("video.status")], [], policy, {"video.status": ["actual.json"]}, {})
        self.assertEqual(result[25]["supporting_MCP_success_operation_ids"], ["video.status"])
        self.assertEqual(result[149]["actual_MCP_success_operation_ids"], [])
        self.assertFalse(any(row["fully_accepted"] for row in result))

    def test_missing_or_duplicate_original_family_is_rejected(self):
        families = requirements()
        families[-1] = families[0]
        with self.assertRaisesRegex(ValueError, "each_original_requirement"):
            reconcile(families, [], [], {}, {}, {})


if __name__ == "__main__":
    unittest.main()
