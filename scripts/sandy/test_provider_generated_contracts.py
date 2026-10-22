"""Individual contract gates reused across the reviewed provider engine.

These checks prove contract integrity, not provider permissions or side effects.
Live acceptance remains representative, with independent high-risk readback.
"""
import hashlib
import json
from pathlib import Path
import unittest
from jsonschema import Draft7Validator

ROOT = Path(__file__).resolve().parents[2]
BASE = ROOT / "supabase/functions/sandy-provider-operation-api"


class GeneratedProviderContracts(unittest.TestCase):
    def test_every_compiled_contract_has_typed_reviewed_provenance_and_policy(self):
        manifest = json.loads((ROOT / "docs/sandy-api/provider-schema-manifest.json").read_text())
        sources = {row["source"]: row["sha256"] for row in manifest if row.get("state") == "downloaded"}
        for row in manifest:
            sources.update({source["source"]: source["sha256"] for source in row.get("alternative_contract_sources", [])})
        seen = set()
        count = 0
        for filename in ("contracts.json", "expansion_contracts.json"):
            for operation in json.loads((BASE / filename).read_text())["operations"]:
                name = operation["operation"]
                with self.subTest(operation=name):
                    self.assertNotIn(name, seen)
                    seen.add(name)
                    self.assertEqual(sources[operation["source"]], operation["source_sha256"])
                    unsigned = {key: value for key, value in operation.items() if key != "contract_sha256"}
                    digest = hashlib.sha256(json.dumps(unsigned, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode()).hexdigest()
                    self.assertEqual(operation["contract_sha256"], digest)
                    self.assertIn(operation["provider"], {"gcp", "github", "supabase"})
                    self.assertTrue(operation["provider_operation_id"])
                    self.assertTrue(operation["permission_scope"])
                    for policy in ("is_mutation", "requires_grant", "requires_cost_approval", "sensitive"):
                        self.assertIs(type(operation[policy]), bool)
                    self.assertTrue(operation["path"].startswith("/"))
                    self.assertNotIn("://", operation["path"])
                    self.assertFalse(operation["input_schema"]["additionalProperties"])
                    schemas = [operation["input_schema"], operation["output_schema"],
                               {**operation["result_schema"], "$defs": operation["public_defs"]}]
                    schemas += [{**schema, "$defs": operation["$defs"]}
                                for schema in operation["response_schemas"].values()]
                    for schema in schemas:
                        Draft7Validator.check_schema(schema)
                    count += 1
        self.assertEqual(count, 1738)
