import unittest
from post_architect_outcome import validate_outcome, validate_acknowledgement
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

    def test_boolean_identifiers_and_additional_action_fields_are_rejected(self):
        valid={"issue_number":5,"architecture_run_id":"12345678","decision":"READY","pr_number":None}
        for changed in [{**valid,"issue_number":True},{**valid,"pr_number":True},{**valid,"op":"another_mode"}]:
            with self.assertRaises(ValueError):validate_outcome(changed)

    def test_generic_or_mismatched_http_success_is_not_recorded_evidence(self):
        outcome={"issue_number":5,"architecture_run_id":"12345678","decision":"READY","pr_number":30}
        for ack in [{"ok":True},{"ok":True,"recorded":True,"decision":"BLOCKED","pr_recorded":True},{"ok":True,"recorded":True,"decision":"READY","pr_recorded":False}]:
            with self.assertRaises(RuntimeError):validate_acknowledgement(ack,outcome)
        self.assertEqual(validate_acknowledgement({"ok":True,"recorded":True,"decision":"READY","pr_recorded":True},outcome),"recorded")

    def test_superseded_acknowledgement_preserves_state_without_claiming_pr_or_acceptance(self):
        outcome={"issue_number":5,"architecture_run_id":"12345678","decision":"READY","pr_number":30}
        ack={"ok":True,"recorded":True,"superseded":True,"decision":"READY","pr_recorded":False,"production_acceptance_inferred":False}
        self.assertEqual(validate_acknowledgement(ack,outcome),"superseded")
        for changed in [{**ack,"pr_recorded":True},{**ack,"production_acceptance_inferred":True}]:
            with self.assertRaises(RuntimeError):validate_acknowledgement(changed,outcome)


if __name__=="__main__":
    unittest.main()
