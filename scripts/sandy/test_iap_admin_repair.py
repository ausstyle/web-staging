import copy
import tempfile
from pathlib import Path
import unittest
from unittest.mock import patch
from types import ModuleType, SimpleNamespace
import json
import datetime
EXPIRY = (datetime.datetime.now(datetime.timezone.utc) + datetime.timedelta(hours=1)).strftime("%Y-%m-%dT%H:%M:%SZ")
from iap_admin_repair import (Admin, MEMBER, ROLE, RepairError, apply, candidate, connection_env, plan,
    ADMIN_ALIAS, ADMIN_ACCOUNT, RUNTIME_ACCOUNT, TOKEN_LIFETIME, impersonation_credentials, verify_administrator)


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
    def keyless_source(self, principal=RUNTIME_ACCOUNT, module="google.auth.identity_pool"):
        cls = type("FixtureCredentials", (), {"__module__": module})
        value = cls(); value.service_account_email = principal
        return value

    def test_exact_keyless_runtime_chain_uses_short_lived_SDK_impersonation(self):
        source = self.keyless_source(); observed = []
        def factory(**args):observed.append(args);return "fixture-result"
        self.assertEqual(impersonation_credentials(source, factory), "fixture-result")
        self.assertIs(observed[0]["source_credentials"], source)
        self.assertEqual(observed[0]["target_principal"], ADMIN_ACCOUNT)
        self.assertEqual(observed[0]["lifetime"], TOKEN_LIFETIME)
        self.assertEqual(observed[0]["target_scopes"], ["https://www.googleapis.com/auth/cloud-platform"])

    def test_wrong_sources_and_static_keys_are_not_substituted(self):
        for source in [self.keyless_source(MEMBER.split(":",1)[1]),
                       self.keyless_source(module="google.oauth2.service_account"),
                       self.keyless_source(ADMIN_ACCOUNT, "google.oauth2.service_account")]:
            with self.assertRaises(RepairError):impersonation_credentials(source, lambda **args:self.fail("unexpected impersonation"))

    def test_configured_impersonated_ADC_preserves_chain_and_refuses_key_backing(self):
        credentials = self.keyless_source(ADMIN_ACCOUNT, "google.auth.impersonated_credentials")
        credentials._source_credentials = self.keyless_source()
        self.assertIs(impersonation_credentials(credentials, lambda **args:self.fail("unexpected second impersonation")), credentials)
        credentials._source_credentials = self.keyless_source(module="google.oauth2.service_account")
        with self.assertRaises(RepairError):impersonation_credentials(credentials, lambda **args:self.fail("unexpected impersonation"))

    def test_issuance_proof_reports_expiry_without_a_token_or_exception_text(self):
        admin = object.__new__(Admin);admin.alias=ADMIN_ALIAS;admin.principal=ADMIN_ACCOUNT
        class Credentials:
            expiry = datetime.datetime.now(datetime.timezone.utc) + datetime.timedelta(minutes=30)
            token = "PRIVATE_TOKEN_MUST_NEVER_LEAK"
            def refresh(self, request):pass
        admin._credentials=Credentials();admin._auth_request=object()
        proof=admin.refresh_identity()
        self.assertTrue(proof["issuance_verified"]);self.assertLessEqual(proof["remaining_seconds"],1800)
        self.assertNotIn("PRIVATE_TOKEN",json.dumps(proof))
        admin._credentials.refresh=lambda request:(_ for _ in ()).throw(ValueError("PRIVATE_TOKEN_MUST_NEVER_LEAK"))
        with self.assertRaisesRegex(RepairError,"^keyless_administrator_token_issuance_unavailable$"):admin.refresh_identity()

    def verification_fixture(self):
        admin = AdminFixture();admin.alias=ADMIN_ALIAS;admin.principal=ADMIN_ACCOUNT;admin.receipts=[]
        admin.refresh_identity=lambda:{"issuance_verified":True,"token_recorded":False}
        def request(method,url,body=None):
            admin.calls.append((method,url))
            if url.startswith("https://run.googleapis.com/"):
                return {"template":{"serviceAccount":RUNTIME_ACCOUNT},"latestReadyRevision":"fixture-ready"}
            if url.startswith("https://iam.googleapis.com/") and ":getIamPolicy" in url:
                self.assertEqual(method,"GET");self.assertTrue(url.endswith("options.requestedPolicyVersion=3"))
                return {"etag":"account-etag","bindings":[{"role":"roles/iam.serviceAccountTokenCreator","members":["serviceAccount:"+RUNTIME_ACCOUNT]}]}
            if url.startswith("https://iam.googleapis.com/") and method=="GET":return {"email":ADMIN_ACCOUNT,"disabled":False}
            if url.startswith("https://cloudresourcemanager.googleapis.com/") and url.endswith(":getIamPolicy"):
                return {"etag":"project-etag","bindings":[{"role":"roles/iap.admin","members":["serviceAccount:"+ADMIN_ACCOUNT]}]}
            if url.endswith(":testIamPermissions"):return {"permissions":body["permissions"]}
            raise AssertionError("unexpected provider operation")
        admin.request=request
        return admin

    def test_preflight_checks_actual_identity_grant_roles_and_effective_target_permissions(self):
        admin=self.verification_fixture();result=verify_administrator(admin)
        self.assertTrue(result["ok"]);self.assertEqual(result["deployed_runtime_identity"],RUNTIME_ACCOUNT)
        self.assertTrue(result["direct_token_creator_binding_verified"])
        self.assertEqual([(t["vm_name"],t["port"]) for t in result["targets"]],[("sandy-video",22),("sandy-windows",5986)])
        self.assertTrue(all(not t["missing_permissions"] for t in result["targets"]))
        self.assertFalse(any("setIamPolicy" in str(c) for c in admin.calls))
        self.assertEqual(result["IAM_changes"],0)

    def test_preflight_does_not_treat_project_role_names_as_effective_IAP_authority(self):
        admin=self.verification_fixture();original=admin.request
        admin.request=lambda method,url,body=None:{"permissions":[]} if url.endswith(":testIamPermissions") else original(method,url,body)
        result=verify_administrator(admin)
        self.assertFalse(result["ok"]);self.assertTrue(all(t["missing_permissions"] for t in result["targets"]))

    def test_runtime_mismatch_stops_read_only_before_IAP(self):
        admin=self.verification_fixture();original=admin.request
        admin.request=lambda method,url,body=None:{"template":{"serviceAccount":"unrelated@example.test"}} if url.startswith("https://run.googleapis.com/") else original(method,url,body)
        with self.assertRaisesRegex(RepairError,"deployed_MCP_runtime_identity_mismatch"):verify_administrator(admin)
        self.assertFalse(any(c[0]=="read" for c in admin.calls))

    def test_SDK_uses_only_selected_credentials_and_sanitizes_renewal_failure(self):
        observed = []
        class Credentials:
            service_account_email = "authorized-admin@example.test"
            def before_request(self, *args):
                raise RuntimeError("PRIVATE_TOKEN_MUST_NEVER_LEAK")
        google = ModuleType("google"); google.__path__ = []
        auth = ModuleType("google.auth"); auth.__path__ = []; google.auth = auth
        def load(path, **kwargs):
            observed.append((path, kwargs["scopes"])); return Credentials(), "fixed-project"
        auth.load_credentials_from_file = load
        transport = ModuleType("google.auth.transport"); transport.__path__ = []
        request = ModuleType("google.auth.transport.requests"); request.Request = lambda **kwargs: object()
        requests = ModuleType("requests"); requests.Session = lambda: SimpleNamespace(verify=True)
        with tempfile.TemporaryDirectory() as directory:
            manifest = Path(directory) / "manifest.json"
            manifest.write_text(json.dumps({"version": 1, "connections": [{"alias": "authorized-admin", "provider_kind": "gcp", "config_dir": "fixture-config", "configuration_name": "fixture-profile", "credentials_file": "fixture-selector-only"}]}))
            with patch.dict("sys.modules", {"google": google, "google.auth": auth, "google.auth.transport": transport, "google.auth.transport.requests": request, "requests": requests}), patch.dict("os.environ", {"OIC_MANIFEST_PATH": str(manifest)}):
                admin = Admin("authorized-admin")
                self.assertEqual(admin.principal, "authorized-admin@example.test")
                with self.assertRaisesRegex(RepairError, "^GCP_administrator_token_renewal_unavailable$"):
                    admin.policy("sandy-video")
        self.assertEqual(observed, [("fixture-selector-only", ["https://www.googleapis.com/auth/cloud-platform"])])

    def test_preserves_every_existing_binding_condition_and_audit(self):
        policy = AdminFixture().value
        policy["auditConfigs"] = [{"service": "allServices", "auditLogConfigs": [{"logType": "ADMIN_READ"}]}]
        before = copy.deepcopy(policy)
        for name, port in [("sandy-video", 22), ("sandy-windows", 5986)]:
            after, changed = candidate(policy, name, EXPIRY)
            self.assertTrue(changed); self.assertEqual(policy, before)
            self.assertEqual(after["bindings"][:-1], before["bindings"])
            self.assertEqual(after["auditConfigs"], before["auditConfigs"])
            self.assertEqual(after["etag"], before["etag"])
            self.assertEqual(after["bindings"][-1]["condition"]["expression"], f'destination.port == {port} && request.time < timestamp("{EXPIRY}")')
            self.assertEqual(after["bindings"][-1]["members"], [MEMBER])

    def test_exact_existing_binding_is_idempotent(self):
        after, _ = candidate(AdminFixture().value, "sandy-video", EXPIRY)
        again, changed = candidate(after, "sandy-video", EXPIRY)
        self.assertFalse(changed); self.assertEqual(after, again)

    def test_does_not_bypass_an_existing_restrictive_condition(self):
        for condition in [None, {"expression": "destination.port == 9999", "title": "restricted"}]:
            value = {"etag": "known", "bindings": [{"role": ROLE, "members": [MEMBER]}]}
            if condition: value["bindings"][0]["condition"] = condition
            with self.assertRaisesRegex(RepairError, "administrator_review"):
                candidate(value, "sandy-video", EXPIRY)

    def test_requires_target_etag_and_supported_policy_shape(self):
        for name, policy in [("other", {"etag": "known"}), ("sandy-video", {}), ("sandy-video", {"etag": "known", "unexpected": True})]:
            with self.assertRaises(RepairError): candidate(policy, name, EXPIRY)

    def test_unbounded_expired_and_malformed_grants_never_reach_provider(self):
        for expiry in [None, "", "2020-01-01T00:00:00Z", "not-a-time", '2026-10-30T21:17:00Z") || true',
                       (datetime.datetime.now(datetime.timezone.utc)+datetime.timedelta(days=31)).strftime("%Y-%m-%dT%H:%M:%SZ")]:
            admin = AdminFixture()
            with self.assertRaisesRegex(RepairError, "future_UTC_expiry"):
                plan(admin, "sandy-video", expiry)
            self.assertEqual(admin.calls, [])

    def test_expired_or_legacy_saved_plan_cannot_be_applied(self):
        admin = AdminFixture(); saved = plan(admin, "sandy-video", EXPIRY);admin.calls=[]
        for patch in [{"expires_at":"2020-01-01T00:00:00Z"},{"schema":"sandy-fixed-IAP-repair-v1"}]:
            with tempfile.TemporaryDirectory() as directory:
                with self.assertRaises(RepairError):apply(admin,{**saved,**patch},Path(directory)/"attempt.json")
            self.assertEqual(admin.calls,[])

    def test_connection_must_be_explicit_without_fallback(self):
        for manifest in [{"version": 1, "connections": []}, {"version": 1, "connections": [{"provider_kind": "gcp", "alias": "different"}]}, {"version": 2}]:
            with self.assertRaises(RepairError): connection_env("authorized-admin", manifest)

    def test_apply_checks_preimage_before_any_write(self):
        admin = AdminFixture(); saved = plan(admin, "sandy-video", EXPIRY)
        admin.value["etag"] = "changed"
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / "attempt.json"
            with self.assertRaisesRegex(RepairError, "preimage_changed"): apply(admin, saved, output)
            self.assertFalse(output.exists())
        self.assertFalse(any(c[0] == "POST" for c in admin.calls))

    def test_apply_independently_reads_back_and_never_replays_saved_attempt(self):
        admin = AdminFixture(); saved = plan(admin, "sandy-windows", EXPIRY)
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
