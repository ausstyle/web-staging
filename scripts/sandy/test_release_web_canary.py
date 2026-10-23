import copy
import json
from pathlib import Path
import struct
import tempfile
import unittest
from unittest.mock import patch

import release_web_canary as release


class ReleaseAdmissionTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.manifest, cls.sources = release.load_candidate(release.MANIFEST.read_bytes())

    def control_record(self):
        return {"change": {"id": release.CHANGE, "status": "approved", "scope": list(release.TARGETS)},
            "tests": [{"outcome": "passed", "evidence": {"manifest_sha256": release.PIN,
                "source_commit": self.manifest["source_commit"], "release_manifest": self.manifest}}]}

    def test_pinned_transitive_source_is_available(self):
        self.assertEqual({k: len(v) for k, v in self.sources.items()},
            {"sandy-agent-runtime-v4": 26, "sandy-workspace": 2})

    def test_manifest_mutation_cannot_change_approved_material(self):
        with self.assertRaisesRegex(release.Blocked, "manifest_changed"):
            release.load_candidate(release.MANIFEST.read_bytes() + b"\n")

    def test_status_scope_test_and_source_are_independent_release_gates(self):
        valid = self.control_record()
        release.check_control(valid, self.manifest)
        for status in ("proposed", "failed", "verified", "cancelled", None):
            with self.subTest(status=status), self.assertRaises(release.Blocked):
                record = copy.deepcopy(valid)
                record["change"]["status"] = status
                release.check_control(record, self.manifest)
        changes = [
            lambda r: r["change"].update(id="foreign"),
            lambda r: r["change"].update(scope=["sandy-agent-runtime-v4"]),
            lambda r: r.update(tests=[]),
            lambda r: r["tests"][0].update(outcome="blocked"),
            lambda r: r["tests"][0]["evidence"].update(source_commit="0" * 40),
            lambda r: r["tests"][0]["evidence"].update(manifest_sha256="0" * 64),
            lambda r: r["tests"][0]["evidence"]["release_manifest"].update(deployed=True),
        ]
        for mutate in changes:
            record = copy.deepcopy(valid)
            mutate(record)
            with self.assertRaises(release.Blocked):
                release.check_control(record, self.manifest)

    def test_approved_metadata_cannot_replace_actual_owner_auth_event(self):
        runner = release.Release.__new__(release.Release)
        runner.manifest, runner.credential = self.manifest, "not-a-real-credential"
        runner.sql = lambda _: [{"approved": False}]
        with patch.object(release, "control", return_value=(200, self.control_record())):
            with self.assertRaisesRegex(release.Blocked, "manifest_bound_controller_owner"):
                runner.admission()

    def test_renewable_auth_or_grant_failure_is_not_retried(self):
        runner = release.Release.__new__(release.Release)
        runner.manifest, runner.credential = self.manifest, "not-a-real-credential"
        for status in (401, 403, 503):
            with patch.object(release, "control", return_value=(status, {})) as control:
                with self.assertRaises(release.Blocked):
                    runner.admission()
                control.assert_called_once()

    def test_changed_live_version_bundle_or_jwt_policy_blocks(self):
        function = {"slug": "sandy-workspace", "expected_prior_version": 39,
            "prior_bundle_sha256": release.digest(b"captured-source")}
        metadata = {"slug": "sandy-workspace", "version": 39, "status": "ACTIVE", "verify_jwt": False}
        release.check_live(function, metadata, b"captured-source")
        for updates in ({"version": 40}, {"status": "DEPLOYING"}, {"verify_jwt": True}, {"slug": "other"}):
            with self.assertRaises(release.Blocked):
                release.check_live(function, {**metadata, **updates}, b"captured-source")
        with self.assertRaises(release.Blocked):
            release.check_live(function, metadata, b"newer-published-source")

    def test_no_lease_or_provider_write_without_owner_approval(self):
        runner = release.Release.__new__(release.Release)
        with patch.object(runner, "admission", side_effect=release.Blocked("owner_required")), \
                patch.object(runner, "acquire") as acquire, patch.object(runner, "api") as api:
            with self.assertRaises(release.Blocked):
                runner.deploy()
            acquire.assert_not_called()
            api.assert_not_called()

    def test_whole_pair_preflight_failure_releases_lease_without_provider_write(self):
        runner = release.Release.__new__(release.Release)
        runner.holder = "test-holder"
        with patch.object(runner, "admission"), patch.object(runner, "acquire"), \
                patch.object(runner, "inspect", side_effect=release.Blocked("source_changed")), \
                patch.object(runner, "sql") as sql, patch.object(runner, "api") as api:
            with self.assertRaisesRegex(release.Blocked, "source_changed"):
                runner.deploy()
            sql.assert_called_once()
            self.assertIn("DELETE FROM public.sandy_engineering_component_leases", sql.call_args.args[0])
            api.assert_not_called()

    def test_rollback_evidence_cannot_be_overwritten(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory)
            release.private_write(path, "before.body", b"original")
            with self.assertRaises(FileExistsError):
                release.private_write(path, "before.body", b"replacement")
            self.assertEqual((path / "before.body").read_bytes(), b"original")
            self.assertEqual((path / "before.body").stat().st_mode & 0o777, 0o600)

    def test_source_readback_requires_original_source_map(self):
        def section(value):
            return struct.pack(">I", len(value)) + value
        name = b"source/sandy-workspace/index.ts"
        source_map = json.dumps({"sourcesContent": ["original TypeScript"]}).encode()
        header = section(name) + b"\0" + struct.pack(">IIII", 0, 0, 0, len(source_map)) + b"\0"
        bundle = b"ESZIP2.3" + section(bytes([0, 0, 1, 0])) + section(header) + section(b"") + section(b"") + section(source_map)
        self.assertEqual(release.original_sources(bundle), {"sandy-workspace/index.ts": b"original TypeScript"})
        with self.assertRaises(release.Blocked):
            release.original_sources(b"compiled JavaScript without original TypeScript")
        with self.assertRaises(release.Blocked):
            release.original_sources(bundle[:-1])

    def test_only_unmapped_javascript_or_json_may_use_byte_exact_sources(self):
        def bundle(name):
            def section(value):
                return struct.pack(">I", len(value)) + value
            source = b"unchanged JavaScript"
            header = section(name) + b"\0" + struct.pack(">IIII", 0, len(source), 0, 0) + b"\0"
            return b"ESZIP2.3" + section(bytes([0, 0, 1, 0])) + section(header) + section(b"") + section(source) + section(b"")
        for name in ("version.js", "transport.mjs", "contract.json"):
            self.assertEqual(release.original_sources(bundle(("source/" + name).encode())), {name: b"unchanged JavaScript"})
        with self.assertRaisesRegex(release.Blocked, "original_deployed_source_unavailable"):
            release.original_sources(bundle(b"source/index.ts"))


if __name__ == "__main__":
    unittest.main()
