import unittest
from autonomous_safe_merge import eligible,allowed_file

RUN={"display_title":"Sandy engineering issue #54","id":123456789,"conclusion":"success","status":"completed"}
ISSUE={"number":54,"state":"open","labels":[{"name":"sandy-autonomous-ready"}],"body":"<!-- sandy-repo-only-engineering -->"}
PR={"state":"open","draft":True,"user":{"login":"github-actions[bot]"},
    "base":{"ref":"main"},"head":{"ref":"sandy/codex-issue-54-123456789",
    "repo":{"full_name":"ausstyle/web-staging"},"sha":"a"*40},
    "body":"References #54"}
FILE={"filename":"scripts/sandy/test_new_feature.py","status":"added","additions":25,"deletions":0}

class SafeAutoMergeTests(unittest.TestCase):
    def test_add_only_test_and_docs_are_eligible(self):
        self.assertTrue(eligible(RUN,ISSUE,PR,[FILE]))
        self.assertTrue(allowed_file({"filename":"docs/sandy/new-note.md","status":"modified","additions":5,"deletions":0}))
    def test_production_code_never_automerge(self):
        for path in ["supabase/functions/email-ai/index.ts","scripts/sandy/observe_architect_run.py",
                     "scripts/sandy/autonomous_dispatch.py",".github/workflows/sandy-codex-engineering.yml"]:
            with self.subTest(path=path):
                self.assertFalse(eligible(RUN,ISSUE,PR,[{**FILE,"filename":path}]))
    def test_delete_or_rewrite_rejected(self):
        self.assertFalse(eligible(RUN,ISSUE,PR,[{**FILE,"deletions":1}]))
        self.assertFalse(eligible(RUN,ISSUE,PR,[{**FILE,"status":"modified"}]))
    def test_identity_and_approval_fails_closed(self):
        self.assertFalse(eligible(RUN,{**ISSUE,"labels":[]},PR,[FILE]))
        self.assertFalse(eligible(RUN,ISSUE,{**PR,"user":{"login":"attacker"}},[FILE]))
        self.assertFalse(eligible(RUN,ISSUE,{**PR,"body":"no issue reference"},[FILE]))
        self.assertFalse(eligible(RUN,ISSUE,{**PR,"head":{"ref":"other","sha":"b"*40}},[FILE]))
        self.assertFalse(eligible({**RUN,"conclusion":"failure"},ISSUE,PR,[FILE]))
    def test_change_budget_limits(self):
        self.assertFalse(eligible(RUN,ISSUE,PR,[{**FILE,"additions":250}]))
        self.assertFalse(eligible(RUN,ISSUE,PR,[FILE]*4))
    def test_no_secret_or_path_traversal(self):
        self.assertFalse(allowed_file({"filename":"docs/sandy/../secret.md",
                "status":"added","additions":1,"deletions":0}))

if __name__=="__main__":
    unittest.main()
