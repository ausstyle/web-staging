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
    def test_dispatcher_issue_escalation_requires_issue_write(self):
        wf=(Path(__file__).resolve().parents[2]/'.github/workflows/sandy-autonomous-dispatch.yml').read_text()
        self.assertIn('issues: write',wf)
        self.assertNotIn('issues: read',wf)

    def test_inline_engineering_outcome_always_runs(self):
        wf=(Path(__file__).resolve().parents[2]/'.github/workflows/sandy-codex-engineering.yml').read_text()
        self.assertIn('  record_outcome:',wf)
        self.assertIn('needs: [architect, engineer]',wf)
        self.assertIn('if: ${{ always() }}',wf)
        self.assertIn('python3 scripts/sandy/post_architect_outcome.py',wf)

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


    def test_repair_retry_requires_actual_source_change(self):
        now=dt.datetime(2026,10,17,18,tzinfo=dt.timezone.utc)
        failed=run(1,created="2026-10-17T17:50:00Z")
        failed["conclusion"]="failure"
        self.assertIsNone(choose([issue(1)],[failed],now,lambda _:False))
        self.assertEqual(choose([issue(1)],[failed],now,lambda _:True)["number"],1)
        succeeded=dict(failed,conclusion="success")
        self.assertIsNone(choose([issue(1)],[succeeded],now,lambda _:True))
    def test_repair_retry_still_respects_attempt_cap(self):
        now=dt.datetime(2026,10,17,18,tzinfo=dt.timezone.utc)
        runs=[dict(run(1,created="2026-10-17T17:50:00Z"),conclusion="failure") for _ in range(3)]
        self.assertIsNone(choose([issue(1)],runs,now,lambda _:True))

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
