import json
import unittest
from inspect_api_production import HttpResult, PROJECT_REF
from verify_deployed_api import BASE, MANAGEMENT, BOUNDED_METADATA, verify

MANAGEMENT_KEY = "fixture-management-secret"
SERVICE_KEY = "fixture-service-secret"
ANON_KEY = "fixture-anon-key"
USER_TOKEN = "fixture-actual-user-session"


class DeployedApiVerificationTests(unittest.TestCase):
    def test_proxy_denial_is_recorded_before_any_credential_lookup(self):
        calls = []

        def request(method, url, headers, body):
            calls.append((method, url, headers, body))
            return HttpResult(None, failure="network_proxy_denied")

        report = verify({"SANDY_SUPABASE_MANAGEMENT_TOKEN": MANAGEMENT_KEY,
                         "SANDY_CONTROLLER_ACCESS_TOKEN": USER_TOKEN}, request)
        self.assertFalse(report["complete"])
        self.assertEqual(len(calls), 1)
        self.assertNotIn("authorization", calls[0][2])
        self.assertEqual(report["tests"][0]["outcome"], "blocked")
        self.assertEqual(report["tests"][0]["blocker"], "network_proxy_denied")
        for secret in (MANAGEMENT_KEY, USER_TOKEN):
            self.assertNotIn(secret, json.dumps(report))

    def fake(self, *, leak=False, empty_catalogue=False, invalid_json=False):
        calls = []

        def request(method, url, headers, body):
            calls.append((method, url, headers, body))
            if method == "GET" and url.startswith(BASE):
                return HttpResult(401, {"error": "authentication_required"})
            if url == MANAGEMENT + "/api-keys":
                self.assertEqual(headers.get("authorization"), "Bearer " + MANAGEMENT_KEY)
                return HttpResult(200, [{"name": "service_role", "api_key": SERVICE_KEY}, {"name": "anon", "api_key": ANON_KEY}])
            if url == BASE + "sandy-operation-api":
                if headers.get("authorization") == "Bearer " + SERVICE_KEY:
                    return HttpResult(401, {"error": "invalid_identity"})
                self.assertEqual(headers.get("authorization"), "Bearer " + USER_TOKEN)
                return HttpResult(200, {"ok": True, "operations": [] if empty_catalogue else [
                    {"operation": "engineering.preflight", "executable": True}]})
            if "authorization" not in headers:
                return HttpResult(401, {})
            if url == BASE + "sandy-api-mcp":
                self.assertEqual(headers.get("authorization"), "Bearer " + USER_TOKEN)
                result = {"tools": [] if empty_catalogue else [{"name": "engineering.preflight"}]} if body["method"] == "tools/list" else {
                    "isError": False, "structuredContent": {"ok": True}}
                return HttpResult(200, {"jsonrpc": "2.0", "id": body["id"], "result": result})
            self.assertEqual(url, BASE + "sandy-provider-read-api")
            self.assertEqual(headers.get("authorization"), "Bearer " + SERVICE_KEY)
            operation = body["operation"]
            if operation == "supabase.domains.get":
                return HttpResult(424, {"error": "provider_entitlement_required"})
            if operation == "supabase.branches.get":
                return HttpResult(404, {"error": "provider_query_failed", "upstream_status": 404})
            if invalid_json and operation == "supabase.project.health":
                return HttpResult(200, failure="invalid_json_response")
            result = {"id": PROJECT_REF} if operation == "supabase.projects.get" else []
            if operation == "supabase.functions.secrets.list":
                result = [{"name": "EXAMPLE", **({"value": "fixture-must-not-escape"} if leak else {})}]
            return HttpResult(200, {"ok": True, "project_id": PROJECT_REF, "result": result, **({"result_limit": BOUNDED_METADATA[operation], "possibly_truncated": False} if operation in BOUNDED_METADATA else {})})

        return request, calls

    def test_real_user_session_is_distinct_from_internal_service_authentication(self):
        request, calls = self.fake()
        report = verify({"SANDY_SUPABASE_MANAGEMENT_TOKEN": MANAGEMENT_KEY,
                         "SANDY_CONTROLLER_ACCESS_TOKEN": USER_TOKEN}, request)
        by_name = {row["test"]: row for row in report["tests"]}
        self.assertEqual(by_name["authenticated_mcp_api_preflight_execution"]["outcome"], "passed")
        self.assertEqual(by_name["gateway_rejects_service_key_as_user_session"]["outcome"], "passed")
        self.assertEqual(by_name["supabase.domains.get"]["outcome"], "blocked")
        self.assertFalse(report["complete"])
        for _, url, headers, body in calls:
            if body and body.get("method") == "tools/call":
                self.assertEqual(url, BASE + "sandy-api-mcp")
                self.assertEqual(headers["authorization"], "Bearer " + USER_TOKEN)
        for secret in (MANAGEMENT_KEY, SERVICE_KEY, ANON_KEY, USER_TOKEN):
            self.assertNotIn(secret, json.dumps(report))

    def test_internal_keys_cannot_be_supplied_as_a_user_session(self):
        for credential in (SERVICE_KEY, ANON_KEY, MANAGEMENT_KEY):
            request, calls = self.fake()
            report = verify({"SANDY_SUPABASE_MANAGEMENT_TOKEN": MANAGEMENT_KEY,
                             "SANDY_CONTROLLER_ACCESS_TOKEN": credential}, request)
            self.assertEqual(report["tests"][-1]["outcome"], "failed")
            self.assertEqual(report["tests"][-1]["layer"], "configuration")
            self.assertFalse(any(body and body.get("method") == "tools/call" for _, _, _, body in calls))

    def test_missing_controller_session_defers_only_user_path_tests(self):
        request, _ = self.fake()
        report = verify({"SANDY_SUPABASE_MANAGEMENT_TOKEN": MANAGEMENT_KEY}, request)
        self.assertTrue(any(row["test"] == "supabase.projects.get" and row["outcome"] == "passed" for row in report["tests"]))
        self.assertEqual(report["tests"][-1]["blocker"], "controller_user_session_unavailable")

    def test_secret_projection_violation_and_empty_catalogues_cannot_pass(self):
        request, _ = self.fake(leak=True, empty_catalogue=True)
        report = verify({"SANDY_SUPABASE_MANAGEMENT_TOKEN": MANAGEMENT_KEY,
                         "SANDY_CONTROLLER_ACCESS_TOKEN": USER_TOKEN}, request)
        by_name = {row["test"]: row for row in report["tests"]}
        for name in ("supabase.functions.secrets.list", "authenticated_api_catalogue", "authenticated_mcp_catalogue"):
            self.assertEqual(by_name[name]["outcome"], "failed")
        self.assertNotIn("fixture-must-not-escape", json.dumps(report))

    def test_invalid_provider_json_is_a_failure_not_an_external_blocker(self):
        request, _ = self.fake(invalid_json=True)
        report = verify({"SANDY_SUPABASE_MANAGEMENT_TOKEN": MANAGEMENT_KEY}, request)
        row = next(row for row in report["tests"] if row["test"] == "supabase.project.health")
        self.assertEqual(row["outcome"], "failed")
        self.assertNotIn("blocker", row)


if __name__ == "__main__":
    unittest.main()
