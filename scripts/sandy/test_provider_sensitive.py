"""Private protocol compile checks against pinned sources, no network execution."""
import hashlib
import json
from pathlib import Path
import unittest
import tempfile
from provider_schema_fixtures import restore_fixtures
import importlib.util
import jsonschema

ROOT=Path(__file__).resolve().parents[2]
spec=importlib.util.spec_from_file_location('private_compiler',ROOT/'scripts/sandy/build_provider_sensitive.py')
compiler=importlib.util.module_from_spec(spec)
spec.loader.exec_module(compiler)


class SensitiveProtocols(unittest.TestCase):
    def test_rebuild_is_exactly_pinned_and_deterministic(self):
        actual=json.loads((ROOT/'supabase/functions/sandy-provider-sensitive-api/provider_contracts.json').read_text())
        with tempfile.TemporaryDirectory() as directory:
            restore_fixtures(directory)
            rebuilt=compiler.compile_protocols(Path(directory))
        self.assertEqual(actual,rebuilt)
        self.assertEqual(len(actual),18)
        self.assertEqual(len({x['provider_operation_id'] for x in actual}),18)

    def test_all54_public_provider_schemas_are_valid_draft7(self):
        ops=json.loads((ROOT/'supabase/functions/sandy-provider-sensitive-api/contracts.json').read_text())
        self.assertEqual(len(ops),18)
        for op in ops:
            for field in ['input_schema','output_schema','provider_response_schema']:
                jsonschema.Draft7Validator.check_schema(op[field])
            self.assertTrue(op['requires_approval'])
            self.assertFalse(op['api_key_delegable'])

    def test_compact_gateway_and_source_inventory_claim_no_provider_attestation(self):
        source=(ROOT/'supabase/functions/sandy-provider-sensitive-api/gateway.ts').read_text()
        self.assertNotIn('contracts.ts',source)
        report=json.loads((ROOT/'docs/sandy-api/provider-sensitive-coverage.json').read_text())
        self.assertEqual(report['methods'],18)
        self.assertFalse(report['provider_called'])
        self.assertFalse(report['auth_session_tested'])
        self.assertFalse(report['all_161_requirements_completed'])


if __name__=='__main__': unittest.main()
