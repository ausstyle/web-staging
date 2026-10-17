import unittest
from post_architect_outcome import validate_outcome
from observe_architect_run import event_payload


class OutcomeTests(unittest.TestCase):
    def test_authenticated_event_payload(self):
        self.assertEqual(event_payload("Sandy engineering issue #5","DECISION: READY","12345678",
                                       {"number": 30})["pr_number"],30)

    def test_blocked_artifact_does_not_claim_pr(self):
        payload=event_payload("Sandy engineering issue #5","DECISION: BLOCKED","12345678",{"number":30})
        self.assertIsNone(payload["pr_number"])
        self.assertEqual(validate_outcome(payload)["decision"],"BLOCKED")

    def test_unknown_artifact_never_emits(self):
        self.assertIsNone(event_payload("Sandy engineering issue #5","error","12345678",None))
        self.assertIsNone(event_payload("Sandy engineering issue #5","DECISION: READY","bad",None))

    def test_rejects_invalid_pr_and_issue(self):
        with self.assertRaises(ValueError):
            validate_outcome({"issue_number":5,"architecture_run_id":"12345678","decision":"BLOCKED","pr_number":88})
        with self.assertRaises(ValueError):
            validate_outcome({"issue_number":0,"architecture_run_id":"12345678","decision":"READY"})


if __name__=="__main__":
    unittest.main()
