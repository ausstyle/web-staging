"""Safety and reproducibility checks for additive provider constituents."""
import hashlib,json,unittest
from pathlib import Path
from provider_scope_expansion import DEDICATED_PROVIDER_READS,resource_assignments
from build_provider_operations import SENSITIVE,EXPANSION_SENSITIVE
ROOT=Path(__file__).resolve().parents[2]
BASE=ROOT/'supabase/functions/sandy-provider-operation-api'
class ExpansionContractsTest(unittest.TestCase):
 @classmethod
 def setUpClass(cls):
  cls.baseline=json.loads((BASE/'contracts.json').read_text())['operations']
  cls.expanded=json.loads((BASE/'expansion_contracts.json').read_text())['operations']
 def test_baseline_is_frozen_except_source_attested_contract_revisions(self):
  reviewed=json.loads((BASE/'reviewed_contract_revisions.json').read_text())
  self.assertEqual(reviewed['baseline_catalogue_sha256'],'ce94c1a10b4ceb0e61123ccc563cec05b08190a6089233e8a535ee4c0abb18ef')
  self.assertEqual(hashlib.sha256((BASE/'contracts.json').read_bytes()).hexdigest(),reviewed['reviewed_catalogue_sha256'])
  revisions=reviewed['revisions'];self.assertEqual([r['operation'] for r in revisions],['github.files.content.get'])
  for revision in revisions:
   operation=next(o for o in self.baseline if o['operation']==revision['operation'])
   self.assertEqual(operation['contract_sha256'],revision['after_contract_sha256'])
   migration=(ROOT/revision['migration']).read_text()
   self.assertIn(revision['before_contract_sha256'],migration);self.assertIn(revision['after_contract_sha256'],migration)
  data=json.loads((BASE/'contracts.json').read_text());data['operations']=[o for o in self.baseline if o['operation'] not in {r['operation'] for r in revisions}]
  unchanged=hashlib.sha256(json.dumps(data,sort_keys=True,separators=(',',':'),ensure_ascii=False).encode()).hexdigest()
  self.assertEqual(unchanged,reviewed['unchanged_catalogue_without_revisions_sha256'])
  self.assertEqual(unchanged,'fef01b4c0eb2d6af5a0f377377324dc85a0ede0e2c8f9614c848119abb3e0e3e')
  self.assertEqual(len(self.baseline),595)
 def test_additions_are_unique_closed_and_do_not_duplicate_installed_provider_reads(self):
  ids={o['operation'] for o in self.baseline};providers={o['provider_operation_id'] for o in self.baseline}
  for o in self.expanded:
   self.assertNotIn(o['operation'],ids);ids.add(o['operation'])
   self.assertNotIn(o['provider_operation_id'],providers);providers.add(o['provider_operation_id'])
   self.assertNotIn(o['provider_operation_id'],DEDICATED_PROVIDER_READS)
   self.assertFalse(o['api_exposed']);self.assertFalse(o['verified']);self.assertTrue(o['requires_grant']);self.assertTrue(o['sensitive'])
   self.assertRegex(o['operation'],r'^[a-z][a-z0-9_.-]{2,100}$')
   unsigned={k:v for k,v in o.items() if k!='contract_sha256'}
   self.assertEqual(hashlib.sha256(json.dumps(unsigned,sort_keys=True,separators=(',',':'),ensure_ascii=False).encode()).hexdigest(),o['contract_sha256'])
 def test_wildcards_include_managed_groups_and_descendant_lifecycles(self):
  assigned=resource_assignments()
  self.assertEqual(assigned[('compute','instanceGroupManagers')][0],45)
  self.assertEqual(assigned[('compute','regionInstanceGroupManagers')][0],45)
  self.assertEqual(assigned[('compute','regionTargetHttpsProxies')][0],57)
  provider_ids={o['provider_operation_id'] for o in self.expanded}
  for name in ['compute.instanceGroupManagers.applyUpdatesToInstances','run.projects.locations.jobs.executions.cancel','cloudkms.projects.locations.keyRings.cryptoKeys.cryptoKeyVersions.destroy','pubsub.projects.subscriptions.acknowledge','cloudtasks.projects.locations.queues.tasks.create']:
   self.assertIn(name,provider_ids)
 def test_new_projections_suppress_credentials_media_and_signed_url_fields(self):
  def walk(schema):
   if not isinstance(schema,dict):return
   for key,child in schema.get('properties',{}).items():
    self.assertFalse(SENSITIVE.search(key),key);self.assertFalse(EXPANSION_SENSITIVE.search(key),key);walk(child)
   for key in ['items','additionalProperties']:
    if isinstance(schema.get(key),dict):walk(schema[key])
   for key in ['anyOf','oneOf','allOf']:
    for child in schema.get(key,[]):walk(child)
  for o in self.expanded:
   if o['kind']=='typed_projection':
    walk(o['result_schema'])
    for schema in o['public_defs'].values():walk(schema)
 def test_shards_have_bounded_plaintext_and_literal_local_imports(self):
  shards=json.loads((BASE/'expansion_shard_manifest.json').read_text())
  self.assertTrue(shards);self.assertLess(sum(s['source_bytes'] for s in shards),2*1024*1024)
  source=(BASE/'expansion.ts').read_text()
  for s in shards:
   self.assertLessEqual(s['plaintext_bytes'],1024*1024);self.assertLessEqual(s['operations'],48)
   self.assertIn(f'import("./expansion_shards/{s["shard"]}.ts")',source)
  self.assertNotRegex(source,r'import\("https?://')
if __name__=='__main__':unittest.main()
