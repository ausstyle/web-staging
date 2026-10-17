from pathlib import Path
import unittest


SOURCE = (Path(__file__).resolve().parents[2] /
          "supabase/functions/sandy-feature-discovery/index.ts").read_text()


class FeatureDiscoverySafetyTests(unittest.TestCase):
    def test_existing_tasks_and_proposals_are_both_considered(self):
        self.assertIn('db.from("sandy_self_improvement_tasks")', SOURCE)
        self.assertIn('category:"existing_self_improvement_task"', SOURCE)
        self.assertIn('||duplicate(item)', SOURCE)
        self.assertIn('x.evidence?.github_issue_url', SOURCE)
        self.assertIn('.eq("status","proposed")', SOURCE)

    def test_requires_existing_scheduler_authentication(self):
        self.assertIn('sandy_qualitative_authorize', SOURCE)
        self.assertIn('x-sandy-qa-scheduler', SOURCE)

    def test_requires_multiple_real_observations(self):
        self.assertIn("allowed.has(x)", SOURCE)
        self.assertIn("size<2", SOURCE)

    def test_uses_existing_deduplicating_backlog(self):
        self.assertIn('sandy_store_self_discovered_feature', SOURCE)
        self.assertIn("sandy_improvement_proposals", SOURCE)
        self.assertIn('verified_delivery:false', SOURCE)

    def test_does_not_deploy_or_claim_implementation(self):
        self.assertIn('phase:"proposed_not_implemented"', SOURCE)
        self.assertNotIn("supabase functions deploy", SOURCE)


if __name__ == "__main__":
    unittest.main()
