import unittest
from pathlib import Path

SOURCE=(Path(__file__).resolve().parents[2] /
    "supabase/functions/sandy-engineering-oidc-ingest/index.ts").read_text()

class GitHubOutcomeIdentityTests(unittest.TestCase):
    def test_repo_only_issue_enrollment_is_fail_closed(self):
        self.assertIn('sandy-repo-only-engineering',SOURCE)
        self.assertIn('sandy-autonomous-ready',SOURCE)
        self.assertIn('sandy_autonomous_engineering_register_repo_issue',SOURCE)
        self.assertIn('sourceMeta.type!=="file"',SOURCE)
        self.assertIn('repo_only_onboarding_not_authorised',SOURCE)
        self.assertIn('if(!issueKey && !handoffs?.length)',SOURCE)

    def test_workflow_identity_not_mutable_display_name(self):
        self.assertIn('run.path!==".github/workflows/sandy-codex-engineering.yml"',SOURCE)
        self.assertIn('run.workflow_id!==387224954',SOURCE)
        self.assertNotIn('run.name!=="Sandy Architect and Engineer"',SOURCE)
    def test_workflow_run_and_pr_are_verified(self):
        self.assertIn('run.display_title!=="Sandy engineering issue #"+issue',SOURCE)
        self.assertIn('run.status==="completed" || (sameRun&&run.status==="in_progress")',SOURCE)
        self.assertIn('pull.head?.repo?.full_name!==REPO',SOURCE)
    def test_short_lived_identity_enforced(self):
        self.assertIn('jwtVerify(',SOURCE)
        self.assertIn('claims.workflow_ref===ENGINEERING_REF',SOURCE)
        self.assertIn('String(claims.run_id)===String(runId)',SOURCE)
        self.assertIn('sameRun&&run.status==="in_progress"',SOURCE)

if __name__=="__main__": unittest.main()
