"""Isolated transport tests; these do not establish live production behavior."""
import json
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import tempfile
import threading
import unittest
from unittest.mock import patch
import urllib.error

from inspect_api_production import (
    API_URL, COLUMN_QUERY, HttpResult, MANAGEMENT_BASE, http_transport,
    inspect_production, sanitize, save_report,
)


class ProductionInspectionTests(unittest.TestCase):
    def test_missing_credentials_make_no_authenticated_or_database_calls(self):
        def forbidden(*args):
            self.fail("Missing credentials must not be used for authenticated inspection")
        report = inspect_production({}, forbidden)
        self.assertFalse(report["inspection_complete"])
        self.assertEqual(report["binding_presence"], {"management_binding_present": False, "controller_binding_present": False})
        self.assertEqual(report["observations"]["operation_registry"]["blocker"], "binding_unavailable_in_current_cloud_machine")
        self.assertEqual(report["observations"]["operation_registry"]["required_binding"], "SANDY_SUPABASE_MANAGEMENT_TOKEN")
        self.assertIn("deployed_server_bindings_not_inspected", report["binding_observation_scope"])
        self.assertFalse(report["operations_executed"])
        self.assertEqual(report["production_readiness"], "not_assessed")

    def test_fixed_project_metadata_queries_handle_schema_drift_and_strip_secrets(self):
        calls = []
        management, controller = "private-management-token-value", "private-controller-token-value"
        def transport(method, url, headers, body):
            calls.append((method, url, headers, body))
            if url == MANAGEMENT_BASE + "/functions":
                self.assertEqual(method, "GET")
                return HttpResult(200, [{"slug": "sandy-operation-api", "version": 4, "secret": "must-not-be-saved"}])
            if url == MANAGEMENT_BASE + "/database/query":
                self.assertEqual(method, "POST")
                self.assertEqual(headers["authorization"], "Bearer " + management)
                if body["query"] == COLUMN_QUERY:
                    return HttpResult(200, [{"column_name": x, "data_type": "text"} for x in ("operation", "input_schema", "unexpected_secret_column")])
                self.assertIn('SELECT "operation", "input_schema" FROM public.sandy_operation_registry', body["query"])
                self.assertNotIn("unexpected_secret_column", body["query"])
                self.assertTrue(body["query"].startswith("SELECT "))
                return HttpResult(200, [{"operation": "engineering.preflight", "input_schema": {"example": management, "access_token": controller}, "unexpected_secret_column": "must-not-be-saved"}])
            self.assertEqual(url, API_URL)
            self.assertEqual(body, {"action": "list"})
            self.assertEqual(headers["authorization"], "Bearer " + controller)
            return HttpResult(200, {"ok": True, "operations": [{"operation": "engineering.preflight", "executable": True, "untrusted_extra": "must-not-be-saved"}]})
        report = inspect_production({"SANDY_SUPABASE_MANAGEMENT_TOKEN": management, "SANDY_CONTROLLER_ACCESS_TOKEN": controller}, transport)
        self.assertTrue(report["inspection_complete"])
        serialized = json.dumps(report)
        for secret in (management, controller, "must-not-be-saved"):
            self.assertNotIn(secret, serialized)
        self.assertIn("[REDACTED]", serialized)
        self.assertEqual(len(calls), 4)
        self.assertFalse(report["registry_updated"])

    def test_denial_cannot_be_reported_as_absent_function_or_registry(self):
        def denied(*args):
            return HttpResult(403, failure="network_proxy_denied")
        report = inspect_production({"SANDY_SUPABASE_MANAGEMENT_TOKEN": "present", "SANDY_CONTROLLER_ACCESS_TOKEN": "present"}, denied, probe_connectivity=True)
        self.assertFalse(report["inspection_complete"])
        for observation in report["observations"].values():
            self.assertEqual(observation["state"], "blocked")
            self.assertFalse(observation["production_absence_established"])

    def test_incompatible_schema_does_not_trigger_guessed_registry_select(self):
        queries = []
        def transport(method, url, headers, body):
            if body:
                queries.append(body["query"])
                return HttpResult(200, [{"column_name": "name", "data_type": "text"}])
            return HttpResult(200, [])
        report = inspect_production({"SANDY_SUPABASE_MANAGEMENT_TOKEN": "present"}, transport)
        self.assertEqual(queries, [COLUMN_QUERY])
        self.assertEqual(report["observations"]["operation_registry"]["blocker"], "operation_column_not_observed")

    def test_registry_pagination_retrieves_following_page(self):
        offsets = []
        def transport(method, url, headers, body):
            if not body:
                return HttpResult(200, [])
            if body["query"] == COLUMN_QUERY:
                return HttpResult(200, [{"column_name": "operation"}])
            offsets.append(body["query"].split("OFFSET ")[1])
            return HttpResult(200, [{"operation": f"op.{i}"} for i in range(500)] if len(offsets) == 1 else [{"operation": "op.final"}])
        report = inspect_production({"SANDY_SUPABASE_MANAGEMENT_TOKEN": "present"}, transport)
        registry = report["observations"]["operation_registry"]
        self.assertEqual(offsets, ["0;", "500;"])
        self.assertEqual(registry["row_count"], 501)
        self.assertTrue(registry["complete"])

    def test_arbitrary_transport_exception_does_not_leak_token(self):
        token = "credential-that-must-never-be-logged"
        def broken(*args):
            raise RuntimeError(token)
        report = inspect_production({"SANDY_CONTROLLER_ACCESS_TOKEN": token}, broken)
        self.assertNotIn(token, json.dumps(report))
        self.assertEqual(report["observations"]["api_discovery"]["blocker"], "transport_failed")

    def test_connectivity_probe_has_no_authorization_and_no_mutation(self):
        calls = []
        def transport(method, url, headers, body):
            calls.append((method, url, headers, body))
            self.assertNotIn("authorization", headers)
            return HttpResult(401, failure="provider_request_denied")
        report = inspect_production({}, transport, probe_connectivity=True)
        self.assertEqual(len(calls), 4)
        self.assertEqual(calls[0][0], "GET")
        self.assertEqual(calls[1][3], {"action": "list"})
        self.assertEqual(report["observations"]["api_connectivity"]["state"], "http_response_observed")
        self.assertFalse(report["observations"]["api_connectivity"]["provider_authorization_tested"])

    def test_proxy_denial_is_classified_without_raw_exception(self):
        exception = urllib.error.URLError("Tunnel connection failed: 403 Forbidden sensitive-value")
        with patch("urllib.request.OpenerDirector.open", side_effect=exception):
            result = http_transport("GET", MANAGEMENT_BASE + "/functions", {}, None)
        self.assertEqual(result.status, 403)
        self.assertEqual(result.failure, "network_proxy_denied")
        self.assertNotIn("sensitive-value", repr(result))

    def test_cross_host_redirect_never_forwards_authorization(self):
        requests = []
        class Handler(BaseHTTPRequestHandler):
            def do_GET(self):
                requests.append((self.path, self.headers.get("Authorization")))
                if self.path == "/origin":
                    self.send_response(302)
                    self.send_header("Location", f"http://localhost:{self.server.server_port}/target")
                    self.end_headers()
                else:
                    self.send_response(200)
                    self.end_headers()
                    self.wfile.write(b'{}')

            def log_message(self, *args):
                pass

        server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            with patch.dict("os.environ", {"NO_PROXY": "127.0.0.1,localhost"}):
                result = http_transport(
                    "GET", f"http://127.0.0.1:{server.server_port}/origin",
                    {"authorization": "Bearer unit-test-credential"}, None,
                )
            self.assertEqual(result.status, 302)
            self.assertEqual(result.failure, "redirect_blocked")
            self.assertEqual(requests, [("/origin", "Bearer unit-test-credential")])
            self.assertNotIn("unit-test-credential", repr(result))
        finally:
            server.shutdown()
            server.server_close()
            thread.join(timeout=2)

    def test_output_cannot_write_inside_checkout_or_through_escape_symlink(self):
        with tempfile.TemporaryDirectory() as tmp:
            base = Path(tmp)
            checkout = base / "repository"
            checkout.mkdir()
            external = base / "outside"
            external.mkdir()
            with self.assertRaises(ValueError):
                save_report({}, checkout / "report.json", checkout)
            alias = external / "alias"
            alias.symlink_to(checkout, target_is_directory=True)
            with self.assertRaises(ValueError):
                save_report({}, alias / "report.json", checkout)
            saved = save_report({"ok": True}, external / "report.json", checkout)
            self.assertEqual(json.loads(saved.read_text()), {"ok": True})

    def test_nested_sensitive_fields_and_known_values_are_redacted(self):
        value = {"nested": [{"refresh_token": "hidden", "example": "prefix known-token suffix"}], "authorization": "Bearer arbitrary"}
        clean = json.dumps(sanitize(value, ("known-token",)))
        for secret in ("hidden", "known-token", "Bearer arbitrary"):
            self.assertNotIn(secret, clean)


if __name__ == "__main__":
    unittest.main()
