import unittest
from verify_repo_release import find_repo_only_issue,ISSUE

class RepoReleaseTests(unittest.TestCase):
    def test_merged_pr_with_one_issue(self):
        p=[{"number":50,"merged_at":"2026-10-17","body":"Closes #47 after tests"}]
        self.assertEqual(find_repo_only_issue(p),(50,47))
    def test_multiple_unrelated_prs_fail_closed(self):
        p=[{"number":50,"merged_at":"2026-10-17","body":"Closes #47"},
           {"number":51,"merged_at":"2026-10-17","body":"Fixes #49"}]
        self.assertIsNone(find_repo_only_issue(p))
    def test_ambiguous_unmerged_and_unreferenced_rejected(self):
        p=[{"number":50,"merged_at":None,"body":"Closes #47"},
           {"number":52,"merged_at":"2026-10-17","body":"Features"}]
        self.assertIsNone(find_repo_only_issue(p))
        self.assertIsNone(find_repo_only_issue([{"number":51,"merged_at":"now","body":"Closes #47. Fixes #48"}]))
    def test_only_closing_references_count(self):
        self.assertIsNone(ISSUE.search("untrusted url #47"))
if __name__=="__main__":
    unittest.main()
