import json
from pathlib import Path
import unittest
ROOT=Path(__file__).resolve().parents[2]
def read(p):return json.loads((ROOT/p).read_text())
class SupabaseReviewTests(unittest.TestCase):
 def test_descriptor_identity_and_shared_metadata_reads(self):
  report=read('docs/sandy-api/canonical-supabase-review-20261024.json');cache={}
  for f in report['families']:
   for row in f['required_operations']:
    if 'source_file' not in row:continue
    p=row['source_file']
    if p not in cache:
     data=read(p);ops=data.get('operations',[]) if isinstance(data,dict) else data;cache[p]={o['operation']:o for o in ops}
    for key in ['method','path','provider_operation_id','kind','contract_sha256']:
     if key in row:self.assertEqual(row[key],cache[p][row['operation']][key])
  p=read('docs/sandy-api/scope-operation-disposition.json')['explicit_family_required_operations']
  for f,op in [(80,'supabase.branches.list'),(87,'supabase.backups.list'),(91,'supabase.schema.tables.list'),(99,'supabase.database.locks.list'),(101,'supabase.database.cron.jobs.list'),(108,'supabase.database.replication.publications.create')]:self.assertIn(op,p[str(f)])
 def test_complete_prior_97_family_partition_preserves_gaps(self):
  expected={1,2,3,4,5,6,7,8,9,10,11,14,16,17,20,21,22,25,32,41,42,43,44,45,46,47,48,49,50,51,52,53,54,55,56,57,58,59,60,61,62,63,64,65,66,67,68,69,70,71,73,74,77,78,80,81,87,91,92,93,94,95,96,97,98,99,100,101,102,104,105,106,107,108,109,111,112,114,120,121,122,123,124,126,130,131,132,133,134,135,136,137,138,139,140,141,142}
  names=['canonical-label-milestone-tag-review','canonical-github-review','canonical-core-review','canonical-gcp-review','canonical-supabase-review'];seen=[]
  policy=read('docs/sandy-api/scope-operation-disposition.json')
  for name in names:
   for f in read('docs/sandy-api/'+name+'-20261024.json')['families']:
    seen.append(f['family']);self.assertFalse(f['fully_accepted']);self.assertNotIn(str(f['family']),policy['family_acceptance'])
    self.assertNotEqual(policy['implementation_review'][str(f['family'])]['code_status'],'implemented_for_reviewed_authorized_targets')
  self.assertEqual(set(seen),expected);self.assertEqual(len(seen),97)
if __name__=='__main__':unittest.main()
