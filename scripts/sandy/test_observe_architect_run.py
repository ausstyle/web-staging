import unittest
from observe_architect_run import describe

class ObserverTests(unittest.TestCase):
    def test_blocked_run_never_reports_success(self):
        issue,detail=describe("Sandy engineering issue #1","DECISION: BLOCKED",None)
        self.assertEqual(issue,"1")
        self.assertIn("blocked",detail.lower())
    def test_ready_without_engineer_pr_is_incomplete(self):
        issue,detail=describe("Sandy engineering issue #1","DECISION: READY",None)
        self.assertEqual(issue,"1")
        self.assertIn("incomplete",detail)
    def test_ready_with_pr_requires_review(self):
        issue,detail=describe("Sandy engineering issue #1","DECISION: READY",{"number":92,"url":"https://github.com/ausstyle/web-staging/pull/92"})
        self.assertIn("review",detail.lower())
    def test_unsafe_run_title_ignored(self):
        self.assertIsNone(describe("Sandy engineering issue #1; echo nope","DECISION: READY",None))
