import copy
import tempfile
from pathlib import Path
import unittest
from iap_admin_repair import MEMBER, ROLE, RepairError, apply, candidate, connection_env, plan


class AdminFixture:
    alias = "authorized-admin"
    principal = "authorized-admin@example.test"
    def __init__(self):
        self.value = {"version": 3, "etag": "original", "bindings": [{"role": "roles/iap.httpsResourceAccessor", "members": ["group:customer@example.test"], "condition": {"expression": "request.time < timestamp('2026-12-01T00:00:00Z')", "title": "existing"}}]}
        self.calls = []
    def identity(self, name):
        self.calls.append(("identity", name))
    def policy(self, name):
        self.calls.append(("read", name)); return copy.deepcopy(self.value)
    def url(self, name):
        return "fixed/" + name
    def request(self, method, url, body):
        self.calls.append((method, url))
        self.value = copy.deepcopy(body["policy"]); self.value["etag"] = "new"


class IapRepairTests(unittest.TestCase):
    def test_preserves_every_existing_binding_condition_and_audit(self):
        policy = AdminFixture().value
        policy["auditConfigs"] = [{"service": "allServices", "auditLogConfigs": [{"logType": "ADMIN_READ"}]}]
        before = copy.deepcopy(policy)
        for name, port in [("sandy-video", 22), ("sandy-windows", 5986)]:
            after, changed = candidate(policy, name)
            self.assertTrue(changed); self.assertEqual(policy, before)
            self.assertEqual(after["bindings"][:-1], before["bindings"])
            self.assertEqual(after["auditConfigs"], before["auditConfigs"])
            self.assertEqual(after["etag"], before["etag"])
            self.assertEqual(after["bindings"][-1]["condition"]["expression"], f"destination.port == {port}")
            self.assertEqual(after["bindings"][-1]["members"], [MEMBER])

    def test_exact_existing_binding_is_idempotent(self):
        after, _ = candidate(AdminFixture().value, "sandy-video")
        again, changed = candidate(after, "sandy-video")
        self.assertFalse(changed); self.assertEqual(after, again)

    def test_does_not_bypass_an_existing_restrictive_condition(self):
        for condition in [None, {"expression": "destination.port == 9999", "title": "restricted"}]:
            value = {"etag": "known", "bindings": [{"role": ROLE, "members": [MEMBER]}]}
            if condition: value["bindings"][0]["condition"] = condition
            with self.assertRaisesRegex(RepairError, "administrator_review"):
                candidate(value, "sandy-video")

    def test_requires_target_etag_and_supported_policy_shape(self):
        for name, policy in [("other", {"etag": "known"}), ("sandy-video", {}), ("sandy-video", {"etag": "known", "unexpected": True})]:
            with self.assertRaises(RepairError): candidate(policy, name)

    def test_connection_must_be_explicit_without_fallback(self):
        for manifest in [{"version": 1, "connections": []}, {"version": 1, "connections": [{"provider_kind": "gcp", "alias": "different"}]}, {"version": 2}]:
            with self.assertRaises(RepairError): connection_env("authorized-admin", manifest)

    def test_apply_checks_preimage_before_any_write(self):
        admin = AdminFixture(); saved = plan(admin, "sandy-video")
        admin.value["etag"] = "changed"
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / "attempt.json"
            with self.assertRaisesRegex(RepairError, "preimage_changed"): apply(admin, saved, output)
            self.assertFalse(output.exists())
        self.assertFalse(any(c[0] == "POST" for c in admin.calls))

    def test_apply_independently_reads_back_and_never_replays_saved_attempt(self):
        admin = AdminFixture(); saved = plan(admin, "sandy-windows")
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / "attempt.json"
            result = apply(admin, saved, output)
            self.assertEqual(result["outcome"], "policy_readback_verified")
            self.assertFalse(result["tunnel_execution_verified"])
            self.assertEqual(result["rollback_policy"], saved["before"])
            self.assertEqual(admin.calls[-1], ("read", "sandy-windows"))
            with self.assertRaisesRegex(RepairError, "existing_attempt"): apply(admin, saved, output)
        self.assertEqual(sum(c[0] == "POST" for c in admin.calls), 1)


if __name__ == "__main__":
    unittest.main()
