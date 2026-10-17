"""Offline invariants for the repository-only merge gate."""
import unittest

from autonomous_safe_merge import allowed_file, eligible


class SafeMergeInvariantTests(unittest.TestCase):
    def fixture(self):
        run = {"display_title": "Sandy engineering issue #57", "id": 123456789,
               "status": "completed", "conclusion": "success"}
        issue = {"number": 57, "state": "open", "body": "<!-- sandy-repo-only-engineering -->",
                 "labels": [{"name": "sandy-autonomous-ready"}]}
        pr = {"state": "open", "draft": True, "user": {"login": "github-actions[bot]"},
              "base": {"ref": "main"}, "body": "References #57",
              "head": {"ref": "sandy/codex-issue-57-123456789", "sha": "a" * 40,
                       "repo": {"full_name": "ausstyle/web-staging"}}}
        return run, issue, pr, [self.file()]

    def file(self, **changes):
        return {"filename": "scripts/sandy/test_invariant.py", "status": "added",
                "additions": 1, "deletions": 0, **changes}

    def test_identity_lifecycle_and_authorisation(self):
        missing = object()
        cases = [
            ("queued", 0, ("status",), "queued"),
            ("in_progress", 0, ("status",), "in_progress"),
            ("missing_conclusion", 0, ("conclusion",), missing),
            ("failed", 0, ("conclusion",), "failure"),
            ("cancelled", 0, ("conclusion",), "cancelled"),
            ("no_conclusion", 0, ("conclusion",), None),
            ("malformed_title", 0, ("display_title",), "Sandy engineering issue #57 extra"),
            ("missing_title", 0, ("display_title",), missing),
            ("wrong_title_issue", 0, ("display_title",), "Sandy engineering issue #58"),
            ("old_run_branch_mismatch", 0, ("id",), 123456788),
            ("wrong_issue", 1, ("number",), 58),
            ("closed_issue", 1, ("state",), "closed"),
            ("missing_readiness", 1, ("labels",), []),
            ("missing_opt_in", 1, ("body",), "Ordinary issue"),
            ("wrong_author", 2, ("user", "login"), "other-bot"),
            ("wrong_base", 2, ("base", "ref"), "develop"),
            ("wrong_head_branch", 2, ("head", "ref"), "sandy/codex-issue-57-123456788"),
            ("wrong_head_repo", 2, ("head", "repo", "full_name"), "other/web-staging"),
            ("missing_sha", 2, ("head", "sha"), missing),
            ("malformed_sha", 2, ("head", "sha"), "g" * 40),
            ("short_sha", 2, ("head", "sha"), "a" * 39),
            ("closed_pr", 2, ("state",), "closed"),
            ("non_draft", 2, ("draft",), False),
            ("missing_draft", 2, ("draft",), missing),
            ("absent_reference", 2, ("body",), "No reference"),
            ("different_reference", 2, ("body",), "References #58"),
            ("prefix_collision", 2, ("body",), "References #570"),
        ]
        for label in ("paused", "blocked"):
            cases.append((label, 1, ("labels",), [{"name": "sandy-autonomous-ready"},
                          {"name": "sandy-autonomous-" + label}]))
        for name, index, path, value in cases:
            with self.subTest(case=name):
                args = self.fixture()
                self.assertTrue(eligible(*args))
                target = args[index]
                for key in path[:-1]:
                    target = target[key]
                if value is missing:
                    del target[path[-1]]
                else:
                    target[path[-1]] = value
                self.assertFalse(eligible(*args))

    def test_file_scope_and_additive_changes(self):
        cases = [
            ("gate_source", {"filename": "scripts/sandy/autonomous_safe_merge.py"}),
            ("workflow", {"filename": ".github/workflows/sandy-safe-automerge.yml"}),
            ("edge_function", {"filename": "supabase/functions/sandy-task-api/index.ts"}),
            ("nested_test", {"filename": "scripts/sandy/nested/test_invariant.py"}),
            ("test_traversal", {"filename": "scripts/sandy/../test_invariant.py"}),
            ("doc_traversal", {"filename": "docs/sandy/../secret.md"}),
            ("modified_test", {"status": "modified"}),
            ("renamed_test", {"status": "renamed"}),
            ("removed_test", {"status": "removed"}),
            ("deletions", {"deletions": 1}),
        ]
        for name, changes in cases:
            with self.subTest(case=name):
                run, issue, pr, files = self.fixture()
                self.assertTrue(allowed_file(files[0]))
                self.assertTrue(eligible(run, issue, pr, files))
                unsafe = self.file(**changes)
                self.assertFalse(allowed_file(unsafe))
                self.assertFalse(eligible(run, issue, pr, [unsafe]))
                self.assertFalse(eligible(run, issue, pr, files + [unsafe]))
        for status in ("added", "modified"):
            with self.subTest(documentation=status):
                run, issue, pr, _ = self.fixture()
                doc = self.file(filename="docs/sandy/note.md", status=status)
                self.assertTrue(allowed_file(doc))
                self.assertTrue(eligible(run, issue, pr, [doc]))

    def test_budgets(self):
        for count, expected in ((0, False), (1, True), (3, True), (4, False)):
            with self.subTest(file_count=count):
                run, issue, pr, files = self.fixture()
                self.assertTrue(eligible(run, issue, pr, files))
                self.assertEqual(eligible(run, issue, pr, [self.file(
                    filename=f"scripts/sandy/test_budget_{i}.py") for i in range(count)]), expected)
        for additions, expected in ((0, False), (1, True), (120, True), (121, False)):
            with self.subTest(per_file_additions=additions):
                run, issue, pr, files = self.fixture()
                self.assertTrue(eligible(run, issue, pr, files))
                file = self.file(additions=additions)
                self.assertEqual(allowed_file(file), expected)
                self.assertEqual(eligible(run, issue, pr, [file]), expected)
        for total, expected in ((200, True), (201, False)):
            with self.subTest(total_additions=total):
                run, issue, pr, files = self.fixture()
                self.assertTrue(eligible(run, issue, pr, files))
                files = [self.file(additions=100), self.file(
                    filename="scripts/sandy/test_other.py", additions=total - 100)]
                self.assertTrue(all(allowed_file(file) for file in files))
                self.assertEqual(eligible(run, issue, pr, files), expected)
