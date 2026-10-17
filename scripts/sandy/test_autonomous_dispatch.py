import datetime as dt
import unittest
from pathlib import Path
from autonomous_dispatch import choose, priority

NOW = dt.datetime(2026, 10, 17, 18, tzinfo=dt.timezone.utc)


def issue(number, title="Sandy QA: issue", priority_value=85, updated="2026-10-17T17:00:00Z", labels=None):
    return {"number": number, "title": title, "state": "open", "body": f"priority {priority_value}/100",
            "updated_at": updated, "labels": [{"name": label} for label in (["sandy-autonomous-ready"] if labels is None else labels)]}


def run(number, status="completed", created="2026-10-17T16:00:00Z"):
    return {"display_title": f"Sandy engineering issue #{number}", "status": status, "created_at": created}


class AutoDispatchTests(unittest.TestCase):
    def test_engineer_cannot_attempt_unpublishable_workflows(self):
        wf=(Path(__file__).resolve().parents[2]/'.github/workflows/sandy-codex-engineering.yml').read_text()
        self.assertIn("Never modify .github/workflows/**",wf)
        self.assertIn('git status --porcelain -- .github/workflows',wf)
        self.assertIn("FILE_COUNT",wf)

    def test_issue_labeled_dispatch_is_event_gated(self):
        wf=(Path(__file__).resolve().parents[2]/'.github/workflows/sandy-autonomous-dispatch.yml').read_text()
        self.assertIn('types: [labeled]',wf)
        self.assertIn("github.event.label.name == 'sandy-autonomous-ready'",wf)
        self.assertIn('cancel-in-progress: false',wf)

    def test_codex_bot_and_issue_run_title_contract(self):
        source=(Path(__file__).resolve().parents[2]/'.github/workflows/sandy-codex-engineering.yml').read_text()
        self.assertIn("run-name: 'Sandy engineering issue #${{ inputs.issue_number }}'",source)
        self.assertEqual(source.count('allow-bots: true'),2)


    def test_requires_opt_in_and_title(self):
        self.assertIsNone(choose([issue(1, labels=[]), issue(2, title="Unrelated")], [], NOW))

    def test_prioritises_highest_value(self):
        self.assertEqual(choose([issue(1, priority_value=70), issue(2, priority_value=95)], [], NOW)["number"], 2)

    def test_ignores_recent_and_running(self):
        self.assertIsNone(choose([issue(1)], [run(1)], NOW))
        self.assertIsNone(choose([issue(1)], [run(1, status="in_progress")], NOW))

    def test_retries_only_with_fresh_evidence(self):
        old = run(1, created="2026-10-15T12:00:00Z")
        self.assertIsNone(choose([issue(1, updated="2026-10-15T11:00:00Z")], [old], NOW))
        self.assertEqual(choose([issue(1)], [old], NOW)["number"], 1)

    def test_bounded_attempts(self):
        runs = [run(1, created=f"2026-10-{d}T12:00:00Z") for d in (10, 12, 14)]
        self.assertIsNone(choose([issue(1)], runs, NOW))

    def test_paused_and_pull_requests_are_never_dispatched(self):
        paused = issue(1, labels=["sandy-autonomous-ready", "sandy-autonomous-paused"])
        pr = issue(2); pr["pull_request"] = {"url": "https://github.com"}
        self.assertIsNone(choose([paused, pr], [], NOW))

    def test_missing_score_and_invalid_issue_are_safe(self):
        self.assertEqual(priority("none"), 0)
        self.assertIsNone(choose([issue(0)], [], NOW))


if __name__ == "__main__":
    unittest.main()
