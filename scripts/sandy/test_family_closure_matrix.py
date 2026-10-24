import copy,unittest
from build_family_closure_matrix import build
class ClosureMatrixTests(unittest.TestCase):
    def plan(self):return {'observed_at_utc':'2026-10-24T00:00:00+00:00','delegation_version':6,'delegation_expires_at':'2026-11-21T00:00:00+00:00','delegation_active':True,'families':[{'family_id':i,'requirement':'test','constituents_reviewed':False,'operation_disposition':{'closed_exposure':['optional_alias']},'current_contract_successes':['read']} for i in range(1,162)]}
    def test_unreviewed_aliases_are_not_blanket_exposure_requests(self):
        p=self.plan();r=build(p);self.assertEqual(r['families'][0]['primary_dependency'],'api_constituent_review');self.assertFalse(r['families'][0]['provider_invocation_recommended']);self.assertFalse(any(f['accepted'] for f in r['families']))
    def test_every_family_has_one_primary_group_and_secondary_dispositions_survive(self):
        r=build(self.plan());ids=[i for group in r['groups'].values() for i in group];self.assertEqual(sorted(ids),list(range(1,162)));self.assertEqual(len(set(ids)),161);self.assertIn('closed_exposure',r['families'][0]['operation_disposition'])
    def test_preserved_denials_and_implementation_gaps_never_become_success(self):
        r=build(self.plan());rows={f['family_id']:f for f in r['families']};self.assertEqual(rows[75]['primary_dependency'],'scope_denial_preserved');self.assertEqual(rows[117]['primary_dependency'],'binary_custody_software_gap');self.assertEqual(rows[118]['primary_dependency'],'immutable_settlement_and_closed_blob_read');self.assertTrue(all(not f['closure_demonstrated'] for f in rows.values()))
    def test_inactive_policy_cannot_be_presented_as_executable_work(self):
        p=self.plan();p['delegation_active']=False;r=build(p);self.assertEqual(set(r['groups']),{'delegation_inactive'});self.assertEqual(len(r['groups']['delegation_inactive']),161)
    def test_duplicate_or_missing_families_refused(self):
        p=self.plan();p['families'][-1]=copy.deepcopy(p['families'][0])
        with self.assertRaises(ValueError):build(p)
        p=self.plan();p['families'].pop()
        with self.assertRaises(ValueError):build(p)
if __name__=='__main__':unittest.main()
