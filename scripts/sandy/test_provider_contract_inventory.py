import hashlib
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from provider_contract_inventory import candidates, classify, reconcile, scope_rows, runtime_candidates, supplemental_candidates


QUOTA_SERVICE = '''syntax = "proto3";
package google.api.cloudquotas.v1;
// rpc Commented(Request) returns (Response) { option (google.api.http) = { get: "/fake" }; }
/* Misleading braces } { and a quoted "//" must be ignored. */
service CloudQuotas {
  option (google.api.default_host) = "cloudquotas.googleapis.com";
  option (google.api.oauth_scopes) = "https://www.googleapis.com/auth/cloud-platform";
  rpc ListQuotaInfos(ListQuotaInfosRequest) returns (ListQuotaInfosResponse) {
    option (google.api.http) = {
      get: "/v1/{parent=projects/*/locations/*/services/*}/quotaInfos"
      additional_bindings { get: "/v1/{parent=folders/*/locations/*/services/*}/quotaInfos" }
    };
  }
  rpc UpdateQuotaPreference(UpdateQuotaPreferenceRequest) returns (QuotaPreference) {
    option (google.api.http) = {
      patch: "/v1/{quota_preference.name=projects/*/locations/*/quotaPreferences/*}"
      body: "quota_preference"
      additional_bindings {
        patch: "/v1/{quota_preference.name=organizations/*/locations/*/quotaPreferences/*}"
        body: "quota_preference"
      }
    };
    option (google.api.method_signature) = "quota_preference,update_mask";
  }
}
message ListQuotaInfosRequest { string parent = 1; }
message ListQuotaInfosResponse { repeated QuotaInfo quota_infos = 1; }
message UpdateQuotaPreferenceRequest { QuotaPreference quota_preference = 1; }
'''
QUOTA_RESOURCES = '''syntax = "proto3";
package google.api.cloudquotas.v1;
message QuotaInfo { string name = 1; }
message QuotaPreference { string name = 1; }
'''


def quota_fixture(root, service=QUOTA_SERVICE, resources=QUOTA_RESOURCES):
    sources = []
    for name, content in [("cloudquotas", service), ("resources", resources)]:
        raw = content.encode()
        filename = "gcp-cloudquotas-v1-" + name + ".proto"
        (root / filename).write_bytes(raw)
        sources.append({"format": "protobuf", "cache_file": filename, "bytes": len(raw),
                        "sha256": hashlib.sha256(raw).hexdigest(),
                        "source": "https://raw.githubusercontent.com/googleapis/googleapis/" + "a" * 40 + "/google/api/cloudquotas/v1/" + name + ".proto"})
    return {"provider": "gcp-cloudquotas", "state": "unavailable", "alternative_contract_sources": sources,
            "alternative_contract_service": "google.api.cloudquotas.v1.CloudQuotas"}


class ProviderContractInventoryTests(unittest.TestCase):
    def test_new_installed_retry_and_catalogue_reads_are_linked_without_being_certified(self):
        mappings = {
            "deployment.jobs.retry": 7, "supabase.schema.views.list": 91,
            "supabase.schema.materialized_views.list": 91, "supabase.schema.triggers.list": 92,
            "supabase.schema.constraints.list": 93, "supabase.schema.types.list": 93,
            "supabase.schema.extensions.list": 93, "supabase.database.roles.list": 94,
            "supabase.database.grants.list": 94, "supabase.database.default_privileges.list": 94,
            "supabase.database.rls.policies.list": 95, "supabase.database.locks.list": 99,
            "supabase.database.cron.jobs.list": 101,
        }
        report = {"observations": {"operation_registry": {"state": "observed", "complete": True,
                    "data": [{"operation": operation} for operation in mappings]}}}
        linked = runtime_candidates(report, "fixture-source-checksum")
        self.assertEqual(len(linked), len(mappings))
        for candidate in linked:
            self.assertEqual(candidate["requirement_ids"], [mappings[candidate["provider_operation_id"]]])
            self.assertFalse(candidate["executable"])
            self.assertFalse(candidate["registration_eligible"])

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

    def test_pinned_proto_http_bindings_and_message_provenance_are_review_candidates_only(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = quota_fixture(root)
            result = supplemental_candidates(source, root)
        self.assertEqual([row["method"] for row in result], ["ListQuotaInfos", "UpdateQuotaPreference"])
        self.assertEqual(result[0]["candidate_id"], "gcp.cloudquotas.ListQuotaInfos")
        self.assertEqual(result[0]["provider_contract"]["scopes"], ["https://www.googleapis.com/auth/cloud-platform"])
        self.assertEqual(result[1]["provider_contract"]["http_bindings"][1], {
            "method": "PATCH", "path": "/v1/{quota_preference.name=organizations/*/locations/*/quotaPreferences/*}", "body": "quota_preference"})
        self.assertEqual(result[1]["provider_contract"]["response"], {
            "protobuf_message": "google.api.cloudquotas.v1.QuotaPreference", "cache_file": "gcp-cloudquotas-v1-resources.proto"})
        for row in result:
            self.assertEqual(row["requirement_ids"], [16])
            self.assertEqual(row["source_kind"], "supplemental_protobuf")
            self.assertEqual(row["provider_contract"]["source_contracts"], source["alternative_contract_sources"])
            self.assertFalse(row["discovery_observed"])
            self.assertFalse(row["executable"])
            self.assertFalse(row["registration_eligible"])

    def test_advertised_proto_methods_and_paths_are_validated_against_source_content(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = quota_fixture(root)
            actual = supplemental_candidates(source, root)
            source["alternative_contract_methods"] = [
                {"rpc": row["method"], "http_bindings": [{key: binding[key] for key in ["method", "path"]}
                 for binding in row["provider_contract"]["http_bindings"]]} for row in actual]
            self.assertEqual(len(supplemental_candidates(source, root)), 2)
            source["alternative_contract_methods"][0]["http_bindings"][0]["path"] = "/invented"
            with self.assertRaisesRegex(ValueError, "do not match pinned source"):
                supplemental_candidates(source, root)

    def test_every_supplemental_file_is_verified_before_inventory_uses_it(self):
        for corruption in ["service", "resources", "bytes"]:
            with self.subTest(corruption=corruption), tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                source = quota_fixture(root)
                if corruption == "bytes":
                    source["alternative_contract_sources"][1]["bytes"] += 1
                else:
                    index = 0 if corruption == "service" else 1
                    path = root / source["alternative_contract_sources"][index]["cache_file"]
                    path.write_bytes(path.read_bytes() + b'// changed\n')
                with self.assertRaisesRegex(ValueError, "mismatch"):
                    supplemental_candidates(source, root)

    def test_unsupported_or_ambiguous_proto_contracts_fail_closed(self):
        variants = [
            QUOTA_SERVICE.replace('get: "/v1/{parent=projects/*/locations/*/services/*}/quotaInfos"', 'custom { kind: "GET" path: "/custom" }'),
            QUOTA_SERVICE.replace('folders/*/locations/*/services/*', 'projects/*/locations/*/services/*'),
            QUOTA_SERVICE.replace('rpc UpdateQuotaPreference(', 'rpc ListQuotaInfos('),
            QUOTA_SERVICE.replace('cloudquotas.googleapis.com', 'wrong.googleapis.com'),
            QUOTA_SERVICE.replace('message ListQuotaInfosRequest', 'message MissingRequest'),
            QUOTA_SERVICE + '/* unfinished comment',
            QUOTA_SERVICE + 'message Unbalanced {',
            QUOTA_SERVICE.replace('syntax = "proto3";', '// syntax = "proto3";'),
        ]
        for service in variants:
            with self.subTest(service=service[-80:]), tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                source = quota_fixture(root, service)
                with self.assertRaises(ValueError):
                    supplemental_candidates(source, root)

    def test_report_accounts_for_proto_even_when_discovery_remains_unavailable(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = quota_fixture(root)
            (root / "manifest.json").write_text(json.dumps([source]))
            scope = root / "scope.md"
            scope.write_text("\n".join(f"{number}. requirement {number}" for number in range(1, 162)))
            report = root / "report.json"
            subprocess.run([sys.executable, str(Path(__file__).with_name("provider_contract_inventory.py")),
                            "--schemas", str(root), "--scope", str(scope), "--output", str(report)],
                           check=True, capture_output=True, text=True)
            result = json.loads(report.read_text())
        self.assertEqual(result["candidate_count"], 2)
        self.assertEqual(result["unavailable_sources"], [source])
        self.assertEqual(len(result["requirements"][15]["provider_candidate_ids"]), 2)
        self.assertFalse(result["runtime_registration_performed"])
        self.assertEqual(result["completed_requirements"], 0)


if __name__ == "__main__":
    unittest.main()
