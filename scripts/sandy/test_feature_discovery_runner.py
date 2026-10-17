import unittest
from run_feature_discovery import verify_response,validate_pending,clean_for_public_issue,issue_for,load_all_existing_issues
from unittest.mock import patch
from pathlib import Path


class FeatureDiscoveryRunnerTests(unittest.TestCase):
    def test_success_is_only_a_proposal(self):
        self.assertEqual(verify_response({"ok": True, "created": 1, "assessed": 25}),
                         {"assessed": 25, "created": 1, "proposed_not_deployed": True})

    def test_missing_success_rejected(self):
        with self.assertRaises(RuntimeError):
            verify_response({"status": "queued"})
        with self.assertRaises(RuntimeError):
            verify_response({"ok": False, "created": 0})

    def test_impossible_count_rejected(self):
        with self.assertRaises(RuntimeError):
            verify_response({"ok": True, "created": 99})


    def test_public_issue_redacts_private_identifiers(self):
        scrubbed=clean_for_public_issue("Email bob@example.com URL https://example.com/private account 00000000-0000-0000-0000-000000000000")
        self.assertNotIn("bob@example.com",scrubbed)
        self.assertNotIn("https://example.com/private",scrubbed)
        self.assertNotIn("00000000-0000-0000-0000-000000000000",scrubbed)

    def test_pending_requires_proper_evidence_shape(self):
        self.assertIsNone(validate_pending({"key":"bad"}))
        good={"key":"unified_task_insights","problem":"Repeated users need faster verified task execution",
              "ideal":"A single task interface that shows verified execution receipts",
              "risk":"low","priority":87}
        self.assertEqual(validate_pending(good)["key"],"unified_task_insights")

    def test_issue_creation_idempotent_and_gated(self):
        item=validate_pending({"key":"unified_task_insights",
              "problem":"Repeated users need faster verified task execution",
              "ideal":"A single task interface that shows verified execution receipts",
              "risk":"low","priority":87})
        prior=[{"number":9,"body":"<!-- sandy-feature-key:unified_task_insights -->"}]
        with patch("run_feature_discovery.github") as api:
            self.assertEqual(issue_for(item,prior),9)
            api.assert_not_called()
        with patch("run_feature_discovery.github",return_value={"number":11,"body":"ok"}) as api:
            self.assertEqual(issue_for(item,[]),11)
            self.assertIn("sandy-autonomous-ready",api.call_args.args[2]["labels"])

    def test_smoke_reruns_on_runner_changes_and_reports_safely(self):
        root=Path(__file__).resolve().parents[2]
        runner=(root/"scripts/sandy/run_feature_discovery.py").read_text()
        workflow=(root/".github/workflows/sandy-feature-discovery.yml").read_text()
        self.assertIn("scripts/sandy/run_feature_discovery.py",workflow)
        self.assertIn("except urllib.error.HTTPError as error:",runner)
        self.assertIn("reason=\"unclassified\"",runner)

    def test_push_smoke_never_publishes_public_issue(self):
        worker=(Path(__file__).resolve().parents[2] /
                "scripts/sandy/run_feature_discovery.py").read_text()
        workflow=(Path(__file__).resolve().parents[2] /
                  ".github/workflows/sandy-feature-discovery.yml").read_text()
        self.assertIn('GITHUB_EVENT_NAME")=="push"',worker)
        self.assertIn('"github_publication":False',worker)
        self.assertIn("paths:",workflow)
        self.assertIn("'.github/workflows/sandy-feature-discovery.yml'",workflow)


    def test_paginated_issue_lookup_prevents_duplicate(self):
        existing=[{"number":n,"body":""} for n in range(1,101)]
        matching={"number":101,"body":"<!-- sandy-feature-key:unified_task_insights -->"}
        item=validate_pending({"key":"unified_task_insights",
              "problem":"Repeated users need faster verified task execution",
              "ideal":"A single task interface that shows verified execution receipts",
              "risk":"low","priority":87})
        with patch("run_feature_discovery.github",side_effect=[existing,[matching]]) as api:
            found=load_all_existing_issues()
            self.assertEqual(issue_for(item,found),101)
            self.assertEqual(api.call_count,2)

    def test_pagination_errors_fail_closed(self):
        with patch("run_feature_discovery.github",side_effect=RuntimeError("GitHub down")):
            with self.assertRaises(RuntimeError):
                load_all_existing_issues()
        with patch("run_feature_discovery.github",return_value={"not":"a list"}):
            with self.assertRaises(RuntimeError):
                load_all_existing_issues()
        with patch("run_feature_discovery.github",return_value=[{"number":i} for i in range(100)]):
            with self.assertRaises(RuntimeError):
                load_all_existing_issues(max_pages=2)


if __name__=="__main__":
    unittest.main()
