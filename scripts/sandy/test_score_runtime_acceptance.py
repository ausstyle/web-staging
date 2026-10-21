import unittest
from score_runtime_acceptance import score

class AcceptanceGate(unittest.TestCase):
    def setUp(self):
        self.cohort = {"version":"fixture", "cases":[{"case_id":"one", "critical":True, "required_evidence":["trace_id"]}]}
        self.result = {"case_id":"one", "evidence":{"test_class":"staging_provider", "trace_id":"fixture-trace"}, "independent_labels":{"reviewer":"independent-reviewer", "adequate":True, "critical_pass":True, "false_critical_completion":False, "routine_tool_case":True, "correct_routine_tool":True, "citation_claims":1, "supported_citations":1}}
    def test_unrun_is_not_a_quality_score(self):
        result = score(self.cohort, [])
        self.assertFalse(result["acceptance_passed"])
        self.assertIsNone(result["metrics"]["adequacy"]["rate"])
    def test_mock_cannot_establish_real_acceptance(self):
        self.result["evidence"]["test_class"] = "unit_mock"
        self.assertFalse(score(self.cohort, [self.result])["acceptance_passed"])
    def test_critical_failure_blocks_perfect_average_scores(self):
        self.result["independent_labels"]["critical_pass"] = False
        self.assertFalse(score(self.cohort, [self.result])["acceptance_passed"])
    def test_false_completion_blocks_perfect_average_scores(self):
        self.result["independent_labels"]["false_critical_completion"] = True
        self.assertFalse(score(self.cohort, [self.result])["acceptance_passed"])
    def test_duplicate_case_cannot_inflate_sample_size(self):
        result = score(self.cohort, [self.result,self.result])
        self.assertEqual(result["evaluated_cases"], 1)
        self.assertFalse(result["acceptance_passed"])
    def test_missing_receipt_cannot_be_scored_as_pass(self):
        self.result["evidence"].pop("trace_id")
        self.assertFalse(score(self.cohort, [self.result])["acceptance_passed"])
    def test_independently_evidenced_outcome_can_pass(self):
        self.assertTrue(score(self.cohort, [self.result])["acceptance_passed"])

if __name__ == "__main__":
    unittest.main()
