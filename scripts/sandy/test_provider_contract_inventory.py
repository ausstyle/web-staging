import unittest
from provider_contract_inventory import candidates, classify, reconcile, scope_rows, runtime_candidates


class ProviderContractInventoryTests(unittest.TestCase):
    def test_gcp_nested_methods_keep_required_parameters_and_source_identity(self):
        schema = {"name": "compute", "resources": {"instances": {"methods": {
            "get": {"id": "compute.instances.get", "path": "projects/{project}/zones/{zone}/instances/{instance}",
                    "httpMethod": "GET", "parameters": {"instance": {"type": "string", "required": True}},
                    "response": {"$ref": "Instance"}, "scopes": ["compute.readonly"]}}}}}
        result = candidates("gcp", schema, "checksum")
        self.assertEqual(result[0]["candidate_id"], "gcp.compute.instances.get")
        self.assertEqual(result[0]["requirement_ids"], [26])
        self.assertTrue(result[0]["provider_contract"]["parameters"]["instance"]["required"])
        self.assertEqual(result[0]["source_sha256"], "checksum")
        self.assertFalse(result[0]["registration_eligible"])

    def test_openapi_path_parameters_and_operation_body_are_both_preserved(self):
        schema = {"paths": {"/repos/{owner}/{repo}/contents/{path}": {
            "parameters": [{"name": "owner", "in": "path", "required": True}],
            "put": {"operationId": "repos/create-or-update-file-contents", "parameters": [{"name": "path", "in": "path", "required": True}],
                    "requestBody": {"required": True, "content": {"application/json": {"schema": {"$ref": "#/components/schemas/write"}}}},
                    "responses": {"201": {"description": "Created"}}}}}}
        item = candidates("github", schema, "checksum")[0]
        self.assertEqual(item["requirement_ids"], [117])
        self.assertEqual(len(item["provider_contract"]["parameters"]), 2)
        self.assertEqual(item["http_method"], "PUT")
        self.assertFalse(item["executable"])

    def test_sensitive_security_subfamilies_are_not_misclassified_as_generic_repositories(self):
        self.assertEqual(classify("github", "/repos/{owner}/{repo}/environments/{environment_name}/secrets/{secret_name}", "get"), [136])
        self.assertEqual(classify("github", "/repos/{owner}/{repo}/actions/secrets", "get"), [134])
        self.assertEqual(classify("github", "/repos/{owner}/{repo}/code-scanning/alerts", "get"), [142])
        self.assertEqual(classify("supabase", "/v1/projects/{ref}/secrets", "get"), [84])
        self.assertEqual(classify("gcp", "iam.projects.serviceAccounts.keys", "create"), [20])

    def test_missing_operation_identity_and_identifier_collisions_fail_loudly(self):
        with self.assertRaises(ValueError):
            candidates("github", {"paths": {"/test": {"get": {}}}}, "checksum")
        with self.assertRaises(ValueError):
            candidates("github", {"paths": {"/one": {"get": {"operationId": "same"}}, "/two": {"post": {"operationId": "same"}}}}, "checksum")

    def test_every_requirement_remains_incomplete_even_when_provider_candidates_exist(self):
        text = "\n".join(f"{i}. requirement {i}" for i in range(1, 162))
        rows = reconcile(scope_rows(text), [{"candidate_id": "gcp.compute.instances.get", "requirement_ids": [26]}])
        self.assertEqual(len(rows), 161)
        self.assertEqual(rows[25]["provider_candidate_ids"], ["gcp.compute.instances.get"])
        self.assertFalse(any(row["complete"] for row in rows))
        self.assertEqual(rows[142]["provider_candidate_ids"], [])
        with self.assertRaises(ValueError):
            scope_rows("1. only one requirement")
        self.assertEqual(len(scope_rows("1. unrelated gate\n## Core orchestration\n" + text + "\n## Acceptance\n1. another unrelated item")), 161)

    def test_live_registry_metadata_never_becomes_an_executor_or_completeness_attestation(self):
        report = {"observations": {"operation_registry": {"state": "observed", "complete": True, "data": [
            {"operation": "tasks.list", "handler": "sandy-operations-api", "input_schema": {}, "verified": True}]}}}
        result = runtime_candidates(report, "checksum")
        self.assertEqual(result[0]["requirement_ids"], [153])
        self.assertTrue(result[0]["registry_verified"])
        self.assertFalse(result[0]["executable"])
        self.assertEqual(result[0]["provider_contract"]["input_schema"], {})
        report["observations"]["operation_registry"]["complete"] = False
        with self.assertRaises(ValueError):
            runtime_candidates(report, "checksum")


if __name__ == "__main__":
    unittest.main()
