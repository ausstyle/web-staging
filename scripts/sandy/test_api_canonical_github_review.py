import json
from pathlib import Path
import unittest
ROOT=Path(__file__).resolve().parents[2]
def read(p):return json.loads((ROOT/p).read_text())
class GithubReviewTests(unittest.TestCase):
 def setUp(self):
  self.report=read('docs/sandy-api/canonical-github-review-20261024.json')
  self.policy=read('docs/sandy-api/scope-operation-disposition.json')
 def test_descriptor_identity_and_deliberately_missing_creation(self):
  missing=[];cache={}
  for f in self.report['families']:
   for row in f['required_operations']:
    if not row['source_descriptor_found']:missing.append(row['operation']);continue
    p=row['source_file']
    if p.endswith('.ts'):
     self.assertEqual(p,'supabase/functions/sandy-provider-gap-api/contracts.ts')
     self.assertTrue(row['provider_operation_id']);continue
    if p not in cache:
     data=read(p);ops=data.get('operations',[]) if isinstance(data,dict) else data
     cache[p]={o['operation']:o for o in ops}
    for key in ['method','path','provider_operation_id','kind','contract_sha256']:
     if key in row:self.assertEqual(row[key],cache[p][row['operation']][key])
  self.assertEqual(missing,['github.repos.create'])
 def test_no_review_hides_unresolved_capabilities_or_claims_acceptance(self):
  for f in self.report['families']:
   key=str(f['family'])
   self.assertEqual(sorted(r['operation'] for r in f['required_operations']),self.policy['explicit_family_required_operations'][key])
   self.assertEqual(f['unresolved_capabilities'],self.policy.get('unresolved_family_capabilities',{}).get(key,[]))
   self.assertFalse(f['fully_accepted']);self.assertNotIn(key,self.policy['family_acceptance'])
 def test_aliases_preserve_real_behaviors(self):
  req=self.policy['explicit_family_required_operations']
  self.assertIn('github.repos.update',req['114']);self.assertNotIn('github.repos.archive',req['114'])
  self.assertIn('github.repo_secrets.set',req['134']);self.assertNotIn('github.repo_secrets.rotate',req['134'])
  self.assertTrue({'github.variables.create','github.variables.set'}<=set(req['135']))
  self.assertIn('github.security.code_scanning.alerts.list',req['141'])
if __name__=='__main__':unittest.main()
