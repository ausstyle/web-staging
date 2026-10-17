import unittest
from verify_repo_release import find_repo_only_issue,ISSUE,completed_main_runs

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
    def test_signed_receipt_candidates_require_successful_main_ci(self):
        good={"id":39064288298,"head_sha":"a"*40,
              "event":"workflow_dispatch","head_branch":"main",
              "status":"completed","conclusion":"success",
              "path":".github/workflows/sandy-regression-checks.yml"}
        failures=[
            {**good,"event":"pull_request"},
            {**good,"head_branch":"feature"},
            {**good,"status":"in_progress"},
            {**good,"conclusion":"failure"},
            {**good,"path":".github/workflows/untrusted.yml"},
        ]
        self.assertEqual(completed_main_runs({"workflow_runs":failures+[good]}),
                         [("a"*40,39064288298)])
        self.assertEqual(completed_main_runs({"workflow_runs":[good,good]},limit=1),
                         [("a"*40,39064288298)])

    def test_malformed_receipt_inputs_fail_closed(self):
        with self.assertRaises(RuntimeError):
            completed_main_runs({"wrong":[]})
        for bad in [None,{"id":"39064288298","head_sha":"a"*40,
                  "event":"workflow_dispatch","head_branch":"main",
                  "status":"completed","conclusion":"success",
                  "path":".github/workflows/sandy-regression-checks.yml"}]:
            with self.assertRaises(RuntimeError):
                completed_main_runs({"workflow_runs":[bad]})

if __name__=="__main__":
    unittest.main()
