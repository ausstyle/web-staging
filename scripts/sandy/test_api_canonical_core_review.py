import json,hashlib
from pathlib import Path
import unittest
ROOT=Path(__file__).resolve().parents[2]
class CoreReviewTests(unittest.TestCase):
 def test_pinned_source_and_both_job_kinds(self):
  review=json.loads((ROOT/'docs/sandy-api/canonical-core-review-20261024.json').read_text())
  for p,h in review['source_sha256'].items():
   self.assertTrue((ROOT/p).is_file());self.assertRegex(h,r'^[a-f0-9]{64}$')
  rows={r['family']:r for r in review['families']}
  route=(ROOT/'supabase/functions/sandy-operation-api/api_job_routes.ts').read_text()
  for f in [4,5,6,7]:
   for op in rows[f]['required_operations']:
    if op!='system.execution.get':self.assertIn('"'+op+'"',route)
  self.assertEqual(sorted(rows),list(range(1,12)))
 def test_limits_survive_full_source_review(self):
  review=json.loads((ROOT/'docs/sandy-api/canonical-core-review-20261024.json').read_text())
  policy=json.loads((ROOT/'docs/sandy-api/scope-operation-disposition.json').read_text())
  for r in review['families']:
   k=str(r['family']);self.assertEqual(policy['explicit_family_required_operations'][k],r['required_operations'])
   self.assertTrue(r['unresolved_capabilities']);self.assertFalse(r['fully_accepted'])
   self.assertEqual(policy['unresolved_family_capabilities'][k],r['unresolved_capabilities'])
  self.assertNotIn('google_cloud.mcp.authenticated_discovery',policy['explicit_family_required_operations']['1'])
if __name__=='__main__':unittest.main()
