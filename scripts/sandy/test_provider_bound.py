"""Pinned-source, schema and frozen-boundary checks without provider execution."""
import importlib.util
import json
from pathlib import Path
import sys
import unittest
import tempfile
from provider_schema_fixtures import restore_fixtures
import jsonschema
ROOT=Path(__file__).resolve().parents[2]
sys.path.insert(0,str(ROOT/'scripts/sandy'))
spec=importlib.util.spec_from_file_location('bound_compiler',ROOT/'scripts/sandy/build_provider_bound.py')
module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)


class Bound(unittest.TestCase):
    def test_48_deterministic_distinct_provider_methods(self):
        current=json.loads((ROOT/'supabase/functions/sandy-provider-bound-api/provider_contracts.json').read_text())
        with tempfile.TemporaryDirectory() as directory:
            restore_fixtures(directory)
            self.assertEqual(current,module.build(Path(directory)))
        self.assertEqual(len(current),48)
        self.assertEqual(len({x['operation'] for x in current}),48)
        self.assertEqual(len({x['provider_operation_id'] for x in current}),48)

    def test_all_schemas_are_draft7_and_new_contracts_require_owner_approval(self):
        current=json.loads((ROOT/'supabase/functions/sandy-provider-bound-api/contracts.json').read_text())
        for op in current:
            for schema in [op['input_schema'],op['output_schema'],*[dict(v,**{'$defs':op['$defs']}) for v in op['response_schemas'].values()]]:
                jsonschema.Draft7Validator.check_schema(schema)
            self.assertTrue(op['requires_approval']);self.assertFalse(op['api_key_delegable'])

    def test_64_binding_inventory_methods_reconciled_without_package_duplication(self):
        report=json.loads((ROOT/'docs/sandy-api/provider-binding-coverage.json').read_text())
        self.assertEqual(report['new_bound_methods'],48)
        self.assertEqual(report['existing_package_method_variants'],16)
        self.assertEqual(len({x['provider_operation_id'] for x in report['existing_package_variants']}),16)
        self.assertFalse(report['provider_called']);self.assertFalse(report['auth_session_tested'])
        self.assertFalse(report['all_161_requirements_completed'])
        gateway=(ROOT/'supabase/functions/sandy-provider-bound-api/gateway.ts').read_text()
        self.assertNotIn('contracts.ts',gateway)


if __name__=='__main__':unittest.main()
