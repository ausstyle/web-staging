"""Credential-handling regression tests; all values here are synthetic."""
import unittest
from unittest.mock import patch
from engineering_runtime import EngineeringRuntime, RuntimeErrorCode, BASE

class RuntimeCredentialTests(unittest.TestCase):
    def test_secret_store_uses_bound_rpc_body_not_sql_text(self):
        runtime = EngineeringRuntime("synthetic-management")
        runtime._api_keys = lambda: {"service_role": "synthetic-admin", "anon": "synthetic-anon"}
        observed = []
        runtime._http = lambda *args: (observed.append(args) or (200, {"ok": True}))
        runtime._sql = lambda *args, **kwargs: self.fail("Secret material must not be embedded in SQL")
        runtime._install_key({"user_id": "synthetic-user"})
        method, url, token, body, apikey = observed[0]
        self.assertEqual(method, "POST")
        self.assertEqual(url, BASE + "/rest/v1/rpc/sandy_engineering_store_bootstrap")
        self.assertEqual(token, "synthetic-admin")
        self.assertEqual(apikey, token)
        self.assertGreaterEqual(len(body["p_secret"]), 43)

    def test_secret_store_error_never_exposes_provider_body(self):
        runtime = EngineeringRuntime("synthetic-management")
        runtime._api_keys = lambda: {"service_role": "synthetic-admin"}
        runtime._http = lambda *args: (403, {"message": "private synthetic credential material"})
        with self.assertRaises(RuntimeErrorCode) as error:
            runtime._install_key({"user_id": "synthetic-user"})
        self.assertEqual(str(error.exception), "runtime_encrypted_bootstrap_store_failed")

    def test_operation_uses_private_runner_key_and_ignores_personal_session(self):
        with patch.dict("os.environ", {"SANDY_CONTROLLER_ACCESS_TOKEN": "expired-synthetic-human-session"}):
            runtime = EngineeringRuntime("synthetic-management")
            runtime._bootstrap_key = lambda: "synthetic-scoped-bootstrap"
            runtime._api_keys = lambda: {"anon": "synthetic-anon"}
            observed = []
            runtime._http = lambda *args: (observed.append(args) or (200, {"ok": True}))
            message = {"jsonrpc": "2.0", "id": 1, "method": "tools/list"}
            runtime.invoke(message)
            self.assertEqual(observed[0][1], BASE + "/functions/v1/sandy-engineering-runtime")
            self.assertEqual(observed[0][2], "synthetic-scoped-bootstrap")
            self.assertEqual(observed[0][3], message)
            self.assertNotIn("expired-synthetic-human-session", repr(observed))

    def test_rotation_cannot_complete_without_auth_metadata_confirmation(self):
        runtime = EngineeringRuntime("synthetic-management")
        runtime.state = lambda: {"user_id": "synthetic-user"}
        events = []
        runtime._rpc = lambda name, *args: (events.append(name) or {"credential_epoch": 2})
        runtime._auth_admin = lambda *args: {"app_metadata": {"sandy_engineering_epoch": 1}}
        runtime._install_key = lambda *args: self.fail("Unconfirmed Auth metadata cannot enable a new credential")
        with self.assertRaisesRegex(RuntimeErrorCode, "runtime_rotation_metadata_not_confirmed"):
            runtime.rotate()
        self.assertEqual(events, ["sandy_engineering_rotate_identity"])

    def test_status_does_not_return_secret_locations_or_credentials(self):
        runtime = EngineeringRuntime("synthetic-management")
        runtime.state = lambda: {"user_id": "synthetic-user", "enabled": True, "credential_epoch": 1,
            "bootstrap_generation": 1, "bootstrap_secret_id": "private-vault-reference",
            "rotation_state": "ready", "revoked_at": None}
        runtime._sql = lambda *args: [{"count": 0}]
        status = runtime.public_status()
        self.assertNotIn("private-vault-reference", repr(status))
        self.assertFalse(status["personal_controller_session_used"])
        self.assertEqual(status["controller_memberships"], 0)

    def test_bootstrap_delivery_uses_only_audited_private_rpc(self):
        runtime = EngineeringRuntime("synthetic-management")
        runtime.state = lambda: {"user_id": "synthetic-user", "enabled": True, "revoked_at": None, "rotation_state": "ready"}
        runtime._api_keys = lambda: {"service_role": "synthetic-administration"}
        runtime._sql = lambda *args, **kwargs: self.fail("No unrestricted Vault view read")
        observed = []
        runtime._http = lambda *args: (observed.append(args) or (200, {"ok": True, "credential": "synthetic-private-bootstrap"}))
        self.assertEqual(runtime._bootstrap_key(), "synthetic-private-bootstrap")
        self.assertEqual(observed[0][1], BASE + "/rest/v1/rpc/sandy_engineering_runtime_bootstrap")
        self.assertEqual(observed[0][2], "synthetic-administration")

if __name__ == "__main__":
    unittest.main()
