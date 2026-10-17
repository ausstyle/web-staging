import datetime as dt
import copy
import io
import itertools
import os
import subprocess
import unittest
from contextlib import redirect_stdout
from unittest.mock import patch
from pathlib import Path
import autonomous_dispatch as dispatcher
from autonomous_dispatch import choose, priority

NOW = dt.datetime(2026, 10, 17, 18, tzinfo=dt.timezone.utc)
IDS = itertools.count(1)


def issue(number, title="Sandy QA: issue", priority_value=85, updated="2026-10-17T17:00:00Z", labels=None):
    return {"number": number, "title": title, "state": "open", "body": f"priority {priority_value}/100",
            "updated_at": updated, "labels": [{"name": label} for label in (["sandy-autonomous-ready"] if labels is None else labels)]}


def run(number, status="completed", created="2026-10-17T16:00:00Z"):
    return {"id": next(IDS), "display_title": f"Sandy engineering issue #{number}", "status": status, "created_at": created}


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
        self.assertIn('pull-requests: read',wf.split('  record_outcome:',1)[1])

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


class FakeGitHub:
    def __init__(self):
        self.issues, self.runs = [issue(38)], [run(38) for _ in range(3)]
        self.comments, self.label_names, self.writes = [], [], []
        self.fail, self.lost, self.bad, self.recheck = None, False, None, None

    def __call__(self, *args, payload=None):
        endpoint = next(a for a in args if a.startswith("repos/")).split("/", 3)[3]
        if "--method" in args:
            self.writes.append((endpoint, payload))
            if endpoint == self.fail and not self.lost:
                raise subprocess.CalledProcessError(1, "gh", stderr="SECRET")
            if endpoint == "labels":
                self.label_names.append({"name": payload["name"]})
            elif endpoint.endswith("/labels"):
                self.issues[0]["labels"].append({"name": dispatcher.BLOCKED})
            elif endpoint.endswith("/comments"):
                self.comments.append({"body": payload["body"], "user": {"login": "github-actions[bot]"}})
            if endpoint == self.fail:
                raise subprocess.CalledProcessError(1, "gh", stderr="SECRET")
            return None
        if endpoint == self.fail:
            raise subprocess.CalledProcessError(1, "gh", stderr="SECRET")
        if endpoint.startswith("actions/"):
            result = [{"workflow_runs": self.runs[:1], "total_count": len({r['id'] for r in self.runs})},
                      {"workflow_runs": self.runs[1:], "total_count": len({r['id'] for r in self.runs})}]
        elif endpoint.startswith("issues?"):
            result = [[], copy.deepcopy(self.issues)]
        elif "/comments?" in endpoint:
            result = [[], copy.deepcopy(self.comments)]
        elif endpoint.startswith("labels?"):
            result = [copy.deepcopy(self.label_names)]
        else:
            number = int(endpoint.split("/")[1])
            result = copy.deepcopy(self.recheck or next(i for i in self.issues if i["number"] == number))
        if self.bad and endpoint.startswith(self.bad[0]):
            return self.bad[1]
        if "?" in endpoint:
            assert "--paginate" in args and "--slurp" in args
        return result


class EscalationTests(unittest.TestCase):
    def setUp(self):
        self.api = FakeGitHub()
        self.output = io.StringIO()

    def execute(self, dry=False):
        with patch.object(dispatcher, "gh", self.api), patch.dict(os.environ, {
                "GITHUB_REPOSITORY": dispatcher.REPO, "SANDY_DISPATCH_DRY_RUN": "1" if dry else "0"}), redirect_stdout(self.output):
            dispatcher.main()

    def test_repeated_runs_publish_once_and_preserve_labels(self):
        self.execute(); self.execute()
        self.assertEqual(len(self.api.comments), 1)
        self.assertEqual(len(self.api.writes), 3)
        self.assertIn({"name": dispatcher.LABEL}, self.api.issues[0]["labels"])
        body = self.api.comments[0]["body"]
        self.assertIn("sandy-autonomous-retry-exhausted:v1:38", body)
        self.assertIn("operator review", body)
        self.assertTrue(all(f"/actions/runs/{r['id']}" in body for r in self.api.runs))

    def test_marker_survives_history_loss_fresh_evidence_and_label_removal(self):
        self.execute()
        self.api.runs = []
        self.api.issues[0]["updated_at"] = "2099-01-01T00:00:00Z"
        self.api.issues[0]["labels"] = [{"name": dispatcher.LABEL}]
        with patch.object(dispatcher, "verified_engineering_repair", return_value=True) as repair:
            self.execute()
            repair.assert_not_called()
        self.assertEqual(len(self.api.comments), 1)
        self.assertEqual(self.api.writes[-1][0], "issues/38/labels")

    def test_untrusted_marker_does_not_suppress_publication(self):
        self.api.comments = [{"body": "<!-- sandy-autonomous-retry-exhausted:v1:38 -->", "user": {"login": "attacker"}}]
        self.execute()
        self.assertEqual(len(self.api.comments), 2)

    def test_active_third_attempt_waits_without_escalation(self):
        self.api.runs[-1]["status"] = "in_progress"
        self.execute()
        self.assertEqual(self.api.writes, [])

    def test_duplicate_ids_do_not_exhaust_budget(self):
        self.api.runs = [self.api.runs[0]] * 3
        self.execute()
        self.assertEqual(self.api.writes, [])

    def test_dry_run_and_ineligible_issues_never_write(self):
        self.execute(dry=True)
        for changed in (issue(38, labels=[]), issue(38, labels=[dispatcher.LABEL, "sandy-autonomous-paused"]),
                        dict(issue(38), state="closed"), dict(issue(38), pull_request={"url": "x"}), issue(38, title="other")):
            self.api.issues = [changed]
            self.execute()
        self.assertEqual(self.api.writes, [])

    def test_recheck_before_mutation(self):
        self.api.recheck = issue(38, labels=[])
        self.execute()
        self.assertEqual(self.api.writes, [])

    def test_partial_writes_never_blindly_resend(self):
        for endpoint, lost in (("labels", False), ("issues/38/labels", False),
                               ("issues/38/labels", True),
                               ("issues/38/comments", False), ("issues/38/comments", True)):
            with self.subTest(endpoint=endpoint, lost=lost):
                self.api = FakeGitHub(); self.api.fail, self.api.lost = endpoint, lost
                with self.assertRaises(SystemExit): self.execute()
                self.api.fail = None
                if (endpoint.endswith("/comments") and not lost) or (endpoint == "issues/38/labels" and lost):
                    with self.assertRaises(SystemExit): self.execute()
                    self.assertEqual(len(self.api.writes), 3 if endpoint.endswith("/comments") else 2)
                else:
                    self.execute()
                    self.assertEqual(len(self.api.comments), 1)

    def test_interrupted_after_block_and_short_history_requires_review(self):
        self.api.issues[0]["labels"].append({"name": dispatcher.BLOCKED})
        self.api.runs = []
        with self.assertRaises(SystemExit): self.execute()
        self.assertEqual(self.api.writes, [])

    def test_read_failures_and_invalid_evidence_fail_closed(self):
        for endpoint in ("issues?state=open&labels=sandy-autonomous-ready&per_page=100",
                         f"actions/workflows/{dispatcher.WORKFLOW}/runs?per_page=100",
                         "issues/38/comments?per_page=100", "issues/38", "labels?per_page=100"):
            self.api = FakeGitHub(); self.api.fail = endpoint
            with self.assertRaisesRegex(SystemExit, "operator review") as error: self.execute()
            self.assertNotIn("SECRET", str(error.exception))
            self.assertEqual(self.api.writes, [])
        for endpoint, data in (("issues?", None), ("issues?", [{}]), ("actions/", [{}]),
                               ("actions/", [{"workflow_runs": [], "total_count": 3}]),
                               ("issues?", [[dict(issue(38), labels=None)]]), ("labels?", [[{}]]),
                               ("issues/38/comments?", [[{"body": "bad"}]])):
            self.api = FakeGitHub(); self.api.bad = endpoint, data
            with self.assertRaises(SystemExit): self.execute()
            self.assertEqual(self.api.writes, [])

    def test_generated_text_ignores_untrusted_metadata(self):
        self.api.issues[0]["body"] = "SECRET $(curl attacker)"
        for r in self.api.runs: r.update(html_url="SECRET", conclusion="SECRET")
        self.execute()
        self.assertNotIn("SECRET", self.api.comments[0]["body"])
        self.api = FakeGitHub(); self.api.runs[0]["id"] = "SECRET"
        with self.assertRaises(SystemExit): self.execute()
        self.assertEqual(self.api.writes, [])

    def test_invalid_and_conflicting_runs_fail_closed(self):
        for change in ({"status": "SECRET"}, {"created_at": "bad"}, {"id": True}):
            self.api = FakeGitHub(); self.api.runs[0].update(change)
            with self.assertRaises(SystemExit): self.execute()
            self.assertEqual(self.api.writes, [])
        self.api = FakeGitHub()
        self.api.runs.append(dict(self.api.runs[0], status="in_progress"))
        with self.assertRaises(SystemExit): self.execute()
        self.assertEqual(self.api.writes, [])

    def test_eligible_dry_run_and_changed_selection_never_dispatch(self):
        self.api.runs = []
        self.execute(dry=True)
        self.assertEqual(self.api.writes, [])
        self.api.recheck = issue(38, labels=[])
        self.execute()
        self.assertEqual(self.api.writes, [])

    def test_repository_guard_and_subprocess_argument_contract(self):
        with patch.dict(os.environ, {"GITHUB_REPOSITORY": "other/repo"}), patch.object(dispatcher, "gh") as api:
            with self.assertRaisesRegex(SystemExit, "Unexpected repository"): dispatcher.main()
            api.assert_not_called()
        with patch.object(dispatcher.subprocess, "run", return_value=subprocess.CompletedProcess([], 0, "[]")) as process:
            dispatcher.gh("--paginate", "--slurp", "repos/ausstyle/web-staging/issues")
            self.assertEqual(process.call_args.args[0][:4], ["gh", "api", "--paginate", "--slurp"])
            self.assertNotIn("shell", process.call_args.kwargs)

    def test_verified_repair_requires_trusted_comparison_and_surfaces_failure(self):
        latest = dict(run(38), head_sha="a" * 40)
        with patch.dict(os.environ, {"GITHUB_SHA": "b" * 40}), patch.object(dispatcher, "gh") as api:
            api.return_value = {"status": "ahead", "files": [{"filename": "scripts/sandy/autonomous_dispatch.py"}]}
            self.assertTrue(dispatcher.verified_engineering_repair(latest))
            api.return_value["files"] = [{"filename": "README.md"}]
            self.assertFalse(dispatcher.verified_engineering_repair(latest))
            api.return_value = {}
            with self.assertRaises(ValueError): dispatcher.verified_engineering_repair(latest)
            api.side_effect = subprocess.CalledProcessError(1, "gh")
            with self.assertRaises(subprocess.CalledProcessError): dispatcher.verified_engineering_repair(latest)

    def test_dispatches_only_highest_priority_issue(self):
        self.api.issues, self.api.runs = [issue(1, priority_value=50), issue(2)], []
        self.execute()
        self.assertEqual(len(self.api.writes), 1)
        self.assertEqual(self.api.writes[0][1]["inputs"], {"issue_number": "2"})


if __name__ == "__main__":
    unittest.main()
