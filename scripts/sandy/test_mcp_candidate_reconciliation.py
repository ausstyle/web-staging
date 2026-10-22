import copy
import unittest
from reconcile_mcp_candidate import IDENTITY, REPOSITORY, WORKFLOW, DEPLOY_STEP, Refused, reconcile, select_artifact


class ExistingCandidateGuards(unittest.TestCase):
    def fixture(self):
        meta = {"run_id": 123, "run_attempt": 4, "source_commit": "a" * 40}
        name = "sandy-engineering-mcp-api-123-4"
        tag = {"tag": "sandy-api-review", "revisionName": name,
               "url": "https://sandy-api-review---sandy-engineering-mcp-fixture-ew.a.run.app"}
        traffic = [{"revisionName": "preserved-production", "percent": 100}, tag]
        before = {"service": "sandy-engineering-mcp", "project": "elaborate-haven-511518-a5", "source_commit_candidate": "a" * 40,
                  "verified_runtime_identity": IDENTITY, "traffic": traffic,
                  "url": "https://sandy-engineering-mcp-fixture-ew.a.run.app"}
        after = {"status": {"latestCreatedRevisionName": name, "traffic": copy.deepcopy(traffic)}}
        revision = {"metadata": {"name": name}, "spec": {"serviceAccountName": IDENTITY},
                    "status": {"conditions": [{"type": "Ready", "status": "True"}]}}
        live = {"spec": {"template": {"spec": {"serviceAccountName": IDENTITY}}}, "status": {"traffic": copy.deepcopy(traffic)}}
        return [meta, before, after, copy.deepcopy(revision), live, revision]

    def test_exact_existing_candidate_is_read_only(self):
        result = reconcile(*self.fixture())
        self.assertTrue(result["production_traffic_unchanged"])
        self.assertEqual(result["candidate_deployments"], 0)
        self.assertFalse(result["administrator_token_issuance_verified"])

    def test_changed_revision_or_source_is_refused(self):
        for index, field in [(0, "source_commit"), (0, "run_attempt")]:
            values = self.fixture(); values[index][field] = "b" * 40 if field == "source_commit" else 5
            with self.assertRaises(Refused): reconcile(*values)

    def test_changed_identity_is_refused(self):
        values = self.fixture(); values[-1]["spec"]["serviceAccountName"] = "unrelated@example.invalid"
        with self.assertRaisesRegex(Refused, "identity_mismatch"): reconcile(*values)

    def test_traffic_changes_are_not_repaired(self):
        values = self.fixture(); values[-2]["status"]["traffic"][0]["revisionName"] = "another-production"
        with self.assertRaisesRegex(Refused, "traffic_changed"): reconcile(*values)

    def test_retargeted_tag_is_refused(self):
        values = self.fixture(); values[-2]["status"]["traffic"][1]["revisionName"] = "another-candidate"
        with self.assertRaisesRegex(Refused, "tag_changed"): reconcile(*values)

    def test_not_ready_candidate_is_refused(self):
        values = self.fixture(); values[-1]["status"]["conditions"][0]["status"] = "False"
        with self.assertRaisesRegex(Refused, "not_ready"): reconcile(*values)

    def test_artifact_must_belong_to_successful_deployment_in_exact_attempt(self):
        run = {"repository": {"full_name": REPOSITORY}, "path": WORKFLOW, "head_branch": "main", "event": "push",
               "run_attempt": 4, "status": "completed", "head_sha": "a" * 40}
        jobs = [{"name": "deploy", "started_at": "2026-10-22T20:00:00Z", "completed_at": "2026-10-22T20:05:00Z",
                 "steps": [{"name": DEPLOY_STEP, "conclusion": "success"}]}]
        artifact = {"id": 9, "name": "sandy-mcp-release-" + "a" * 40, "expired": False, "created_at": "2026-10-22T20:04:00Z"}
        old = {**artifact, "id": 8, "created_at": "2026-10-22T19:04:00Z"}
        self.assertEqual(select_artifact(run, jobs, [artifact, old], 4)["id"], 9)
        for artifacts in [[old], [artifact, artifact]]:
            with self.assertRaises(Refused): select_artifact(run, jobs, artifacts, 4)
        jobs[0]["steps"][0]["conclusion"] = "failure"
        with self.assertRaises(Refused): select_artifact(run, jobs, [artifact], 4)


if __name__ == "__main__":
    unittest.main()
