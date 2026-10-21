"""Pinned-source metadata checks, not provider/runtime verification."""
import hashlib
import json
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[2]
CACHE = Path('/workspace/sandy-api-deliverables/provider-schemas')


def walk(resources):
    for entry in resources.values():
        yield from entry.get('methods', {}).values()
        yield from walk(entry.get('resources', {}))


class Supplement(unittest.TestCase):
    def setUp(self):
        self.ops = json.loads((ROOT / 'supabase/functions/sandy-provider-supplement-api/contracts.json').read_text())

    def test_28_distinct_pinned_methods_and_sources(self):
        manifest = json.loads((ROOT / 'docs/sandy-api/provider-schema-manifest.json').read_text())
        sources = {row.get('source'): row for row in manifest if row.get('state') == 'downloaded'}
        self.assertEqual(len(self.ops), 28)
        self.assertEqual(len({op['provider_operation_id'] for op in self.ops}), 28)
        for op in self.ops:
            source = sources[op['source']]
            self.assertEqual(source['sha256'], op['source_sha256'])
            raw = (CACHE / (source['provider'] + '.json')).read_bytes()
            self.assertEqual(hashlib.sha256(raw).hexdigest(), source['sha256'])
            doc = json.loads(raw)
            methods = list(walk(doc['resources'])) if op['provider'] == 'gcp' else [
                entry for path in doc['paths'].values() for method, entry in path.items()
                if method in {'get', 'post', 'put', 'patch', 'delete', 'head'}]
            self.assertIn(op['provider_operation_id'], [entry.get('id', entry.get('operationId')) for entry in methods])

    def test_remaining_inventory_is_not_claimed_provider_verified(self):
        coverage = json.loads((ROOT / 'docs/sandy-api/provider-supplement-coverage.json').read_text())
        self.assertEqual(coverage['fully_implemented_bounded_adapters'], 22)
        self.assertEqual(coverage['partial_adapters'], 6)
        self.assertFalse(coverage['provider_execution_performed'])
        self.assertFalse(coverage['all_161_requirements_completed'])
        for op in coverage['operations']:
            self.assertFalse(op['verified'])
            self.assertFalse(op['api_exposed'])

    def test_catalogue_does_not_import_complete_schemas(self):
        gateway = (ROOT / 'supabase/functions/sandy-provider-supplement-api/gateway.ts').read_text()
        scope = (ROOT / 'supabase/functions/sandy-provider-supplement-api/scope_from_descriptor.ts').read_text()
        self.assertNotIn('contracts.ts', gateway)
        self.assertNotIn('contracts.ts', scope)
        sql = (ROOT / 'supabase/migrations/20261021008400_sandy_provider_supplement.sql').read_text()
        self.assertIn("'source_ready'", sql)
        self.assertNotIn('ON CONFLICT', sql)


if __name__ == '__main__':
    unittest.main()
