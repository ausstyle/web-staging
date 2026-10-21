"""Safety invariants for the reviewed, pinned provider catalogue."""
import hashlib
import json
from pathlib import Path
import unittest

from build_provider_operations import Schemas, migration

ROOT = Path(__file__).resolve().parents[2]
CATALOGUE = ROOT / 'supabase/functions/sandy-provider-operation-api/contracts.json'

class ProviderContractsTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.catalogue = json.loads(CATALOGUE.read_text())
        cls.operations = {item['operation']: item for item in cls.catalogue['operations']}

    def test_every_record_is_independently_hashed_and_unique(self):
        self.assertGreaterEqual(len(self.operations), 356)
        self.assertEqual(len(self.operations), len(self.catalogue['operations']))
        for item in self.operations.values():
            unsigned = {key: value for key, value in item.items() if key != 'contract_sha256'}
            digest = hashlib.sha256(json.dumps(unsigned, sort_keys=True, separators=(',', ':'), ensure_ascii=False).encode()).hexdigest()
            self.assertEqual(digest, item['contract_sha256'], item['operation'])

    def test_mutations_and_sensitive_reads_cannot_be_exposed_by_generation(self):
        for item in self.operations.values():
            if item['is_mutation'] or item['sensitive']:
                self.assertTrue(item['requires_grant'], item['operation'])
                self.assertFalse(item['api_exposed'], item['operation'])
                self.assertFalse(item['ai_exposed'], item['operation'])
            self.assertFalse(item['verified'], item['operation'])

    def test_fixed_provider_identity_cannot_be_supplied_by_caller(self):
        for item in self.operations.values():
            public = item['input_schema'].get('properties', {}).get('path', {}).get('properties', {})
            self.assertFalse(set(public) & set(item['fixed_bindings']), item['operation'])
            if item['provider'] == 'supabase':
                self.assertEqual(item['fixed_bindings']['ref'], 'zmqlyygzqoidkcwdysok')
            if item['provider'] == 'github':
                self.assertEqual(item['fixed_bindings']['owner'], 'ausstyle')
                self.assertEqual(item['fixed_bindings']['repo'], 'web-staging')
            self.assertFalse({'url', 'host', 'authorization', 'token'} & set(item['input_schema']['properties']))

    def test_no_purchase_upgrade_private_key_or_secret_download_routes(self):
        for item in self.operations.values():
            self.assertFalse(item['provider'] == 'supabase' and '/billing' in item['path'])
            self.assertNotIn('/addons', item['path'])
            self.assertNotIn('generateAccessToken', item['path'])
            self.assertNotIn('generateIdToken', item['path'])
            if item['provider'] == 'gcp':
                self.assertFalse(item['operation'].endswith('keys.create') and 'service_accounts' in item['operation'])
                self.assertFalse(item['operation'].endswith('versions.access'))
        self.assertEqual(self.operations['supabase.domains.delete']['fixed_query'], {'remove_addon': 'false'})

    def test_domain_lifecycle_is_present_without_plan_purchase(self):
        for action in ['inspect', 'create', 'reverify', 'activate', 'delete']:
            self.assertIn('supabase.domains.' + action, self.operations)
        sql = migration(self.catalogue)
        self.assertIn('existing_custom_domain_entitlement', sql)
        self.assertIn('ON CONFLICT (operation) DO NOTHING', sql)
        self.assertNotIn('DO UPDATE', sql)

    def test_discovery_annotations_are_not_validation_keywords(self):
        normalized = Schemas({}).normalize({'type': 'integer', 'minimum': '0', 'maximum': '100', 'required': True, 'enumDescriptions': ['explanation'], 'repeated': True})
        self.assertEqual(normalized, {'type': 'integer', 'minimum': 0, 'maximum': 100})

    def test_discovery_same_url_template_keeps_distinct_method_bindings(self):
        self.assertEqual(self.operations['gcp.projects.get']['provider_operation_id'], 'cloudresourcemanager.projects.get')
        self.assertEqual(self.operations['gcp.folders.get']['provider_operation_id'], 'cloudresourcemanager.folders.get')
        self.assertEqual(self.operations['gcp.organizations.get']['provider_operation_id'], 'cloudresourcemanager.organizations.get')
        self.assertEqual(self.operations['gcp.projects.get']['fixed_bindings']['name'], 'projects/elaborate-haven-511518-a5')

    def test_file_semantic_aliases_do_not_mutate_upsert_contract(self):
        upsert = self.operations['github.files.upsert']['input_schema']['properties']['body']
        update = self.operations['github.files.update']['input_schema']['properties']['body']
        create = self.operations['github.files.create']['input_schema']['properties']['body']
        self.assertNotIn('sha', upsert['required'])
        self.assertIn('sha', update['required'])
        self.assertEqual(create['not'], {'required': ['sha']})

    def test_local_refs_keep_cycles_without_network_resolution(self):
        schema = Schemas({'components': {'schemas': {'Node': {'type': 'object', 'properties': {'next': {'$ref': '#/components/schemas/Node'}}}}}})
        self.assertEqual(schema.normalize({'$ref': '#/components/schemas/Node'}), {'$ref': '#/$defs/Node'})
        self.assertEqual(schema.defs['Node']['properties']['next'], {'$ref': '#/$defs/Node'})
        with self.assertRaises(ValueError):
            schema.normalize({'$ref': 'https://attacker.invalid/schema'})

if __name__ == '__main__':
    unittest.main()
