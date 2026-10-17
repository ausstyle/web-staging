import unittest
from pathlib import Path

SOURCE=(Path(__file__).resolve().parents[2] /
    "supabase/functions/sandy-engineering-oidc-ingest/index.ts").read_text()

class GitHubOutcomeIdentityTests(unittest.TestCase):
    def test_workflow_identity_not_mutable_display_name(self):
        self.assertIn('run.path!==".github/workflows/sandy-codex-engineering.yml"',SOURCE)
        self.assertIn('run.workflow_id!==387224954',SOURCE)
        self.assertNotIn('run.name!=="Sandy Architect and Engineer"',SOURCE)
    def test_workflow_run_and_pr_are_verified(self):
        self.assertIn('run.display_title!=="Sandy engineering issue #"+issue',SOURCE)
        self.assertIn('run.status!=="completed"',SOURCE)
        self.assertIn('pull.head?.repo?.full_name!==REPO',SOURCE)
    def test_short_lived_identity_enforced(self):
        self.assertIn('jwtVerify(',SOURCE)
        self.assertIn('claims.workflow_ref!==WORKFLOW_REF',SOURCE)

if __name__=="__main__": unittest.main()
