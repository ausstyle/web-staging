import copy
from datetime import datetime, timezone
import unittest
from build_delegation_acceptance_plan import build_plan

class DelegationPlanTests(unittest.TestCase):
    def setUp(self):
        self.families = [{'requirement_id': n, 'requirement': 'family', 'registered_operation_ids': []} for n in range(1,162)]
        self.families[0]['registered_operation_ids'] = ['read','closed','restricted','missing','fixture','customer']
        self.rows = [{'operation': name,'api_exposed': True,'ai_exposed': True,'provider':'github','operation_class':'metadata_read'} for name in ['read','closed','restricted','fixture','customer']]
        self.rows[1]['ai_exposed'] = False
        self.rows[2]['operation_class'] = 'restricted'
        self.rows[4]['operation_class'] = None
        self.policy = {'version':6,'expires_at':'2026-11-01T00:00:00+00:00','revoked_at':None,'policy':{'classes':{'github':['metadata_read']},'resources':{'github':['ausstyle/web-staging']}}}
        self.now = datetime(2026,10,24,tzinfo=timezone.utc)
    def plan(self, policy=None):
        return build_plan(self.families,self.rows,{},policy or self.policy,['fixture'],self.now)
    def test_distinguishes_closed_restricted_fixture_unknown_and_missing_without_acceptance(self):
        p=self.plan();self.assertEqual(len(p['families']),161)
        d=p['families'][0]['operation_disposition']
        self.assertEqual(d['exposed_class_candidate_not_execution_authority'],['read'])
        self.assertEqual(d['closed_exposure'],['closed'])
        self.assertEqual(d['outside_current_standing_classes'],['restricted'])
        self.assertEqual(d['missing_registry'],['missing'])
        self.assertEqual(d['exact_legacy_fixture_only'],['fixture'])
        self.assertEqual(d['separate_authority_or_mapping_review'],['customer'])
        self.assertFalse(any(r['fully_accepted'] for r in p['families']))
    def test_expiry_revocation_and_missing_resource_cannot_yield_candidates(self):
        for field,value in [('expires_at','2026-10-23T00:00:00+00:00'),('revoked_at','2026-10-23T00:00:00+00:00')]:
            p=copy.deepcopy(self.policy);p[field]=value
            self.assertNotIn('exposed_class_candidate_not_execution_authority',self.plan(p)['families'][0]['operation_disposition'])
        p=copy.deepcopy(self.policy);p['policy']['resources']={}
        self.assertNotIn('exposed_class_candidate_not_execution_authority',self.plan(p)['families'][0]['operation_disposition'])
    def test_rejects_duplicate_or_missing_families(self):
        self.families[-1]=self.families[0]
        with self.assertRaisesRegex(ValueError,'161_unique'):self.plan()
