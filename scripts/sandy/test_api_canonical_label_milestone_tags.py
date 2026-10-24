"""Constituent review must retain shared lifecycle handlers without claiming acceptance."""
import json
from pathlib import Path
import unittest
ROOT=Path(__file__).resolve().parents[2]
def read(p): return json.loads((ROOT/p).read_text())
class ReviewTests(unittest.TestCase):
 def setUp(self):
  self.review=read('docs/sandy-api/canonical-label-milestone-tag-review-20261024.json')
  self.policy=read('docs/sandy-api/scope-operation-disposition.json')
 def test_sources_and_mapping_have_exact_contract_identity(self):
  for f in self.review['families']:
   names=[]
   for item in f['required_operations']:
    contracts={o['operation']:o for o in read(item['source_file'])['operations']}
    source=contracts[item['operation']]
    for key in ['method','path','provider_operation_id','contract_sha256']:self.assertEqual(item[key],source[key])
    names.append(item['operation'])
   self.assertEqual(len(names),len(set(names)))
   self.assertEqual(sorted(names),self.policy['explicit_family_required_operations'][str(f['family'])])
 def test_shared_constituents_are_not_omitted_as_optional_aliases(self):
  required=self.policy['explicit_family_required_operations']
  self.assertTrue({'github.issues.add_labels','github.issues.remove_label','github.issues.remove_all_labels','github.issues.set_labels'}<=set(required['121']))
  self.assertTrue({'github.issues.get','github.issues.update','github.issues.list_labels_for_milestone'}<=set(required['122']))
  self.assertTrue({'github.git.create_tag','github.git.get_tag','github.refs.create','github.refs.get','github.refs.update','github.refs.delete'}<=set(required['124']))
 def test_review_does_not_certify_implementation_or_live_acceptance(self):
  self.assertEqual(self.review['live_provider_calls'],0)
  for f in self.review['families']:
   key=str(f['family']);self.assertFalse(f['fully_accepted'])
   self.assertNotIn(key,self.policy['family_acceptance'])
   self.assertNotEqual(self.policy['implementation_review'][key]['code_status'],'implemented_for_reviewed_authorized_targets')
if __name__=='__main__': unittest.main()
