import json
from pathlib import Path
import unittest
ROOT=Path(__file__).resolve().parents[2]
def read(p):return json.loads((ROOT/p).read_text())
class GcpReviewTests(unittest.TestCase):
 def test_descriptor_identity_without_erasing_bound_transports(self):
  report=read('docs/sandy-api/canonical-gcp-review-20261024.json');cache={};n=0
  for f in report['families']:
   for row in f['required_operations']:
    if 'source_file' not in row:continue
    p=row['source_file']
    if p not in cache:
     data=read(p);ops=data.get('operations',[]) if isinstance(data,dict) else data;cache[p]={o['operation']:o for o in ops}
    for key in ['method','path','provider_operation_id','kind','contract_sha256']:
     if key in row:self.assertEqual(row[key],cache[p][row['operation']][key])
    if row['operation'].endswith(('.bound','.capture','.media')):n+=1
  self.assertGreater(n,20)
 def test_real_listing_restore_and_missing_query_are_required(self):
  p=read('docs/sandy-api/scope-operation-disposition.json')['explicit_family_required_operations']
  self.assertIn('gcp.projects.list_filtered',p['14']);self.assertNotIn('gcp.projects.list',p['14'])
  self.assertIn('gcp.disks.create',p['32']);self.assertNotIn('gcp.snapshots.restore',p['32'])
  self.assertIn('gcp.logging.query',p['67']);self.assertIn('system.credentials.provider.reconcile',p['20'])
 def test_all_reviewed_families_retain_acceptance_obligations(self):
  report=read('docs/sandy-api/canonical-gcp-review-20261024.json');p=read('docs/sandy-api/scope-operation-disposition.json')
  self.assertEqual(len(report['families']),41)
  for f in report['families']:
   k=str(f['family']);self.assertFalse(f['fully_accepted']);self.assertNotIn(k,p['family_acceptance'])
   self.assertEqual(p['explicit_family_required_operations'][k],sorted(r['operation'] for r in f['required_operations']))
   self.assertEqual(p['unresolved_family_capabilities'][k],f['unresolved_capabilities']);self.assertTrue(f['unresolved_capabilities'])
if __name__=='__main__':unittest.main()
