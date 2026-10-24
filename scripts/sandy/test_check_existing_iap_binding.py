import unittest
from check_existing_iap_binding import assess,PREVIOUS
from bind_iap_transport_runtime import NAMES
from release_gcp_admin_read import digest
from release_web_canary import Blocked

def prior():
    return [{'name':n,'value':digest(PREVIOUS[n].encode('utf-8'))} for n in NAMES]

class ExistingIapPreflightTests(unittest.TestCase):
    def test_unbound_can_deploy(self):
        self.assertEqual(assess([{'name':'unrelated','value':'abc'}]),
                         {'ready':True,'reason':'no_existing_iap_binding'})
    def test_previous_valid_binding_blocks_new_candidate(self):
        result=assess(prior())
        self.assertFalse(result['ready'])
        self.assertEqual(result['binding_count'],3)
        self.assertTrue(result['matching_previous_verified_candidate'])
        self.assertEqual(result['reason'],'existing_previous_iap_candidate_requires_reconciliation')
    def test_partial_binding_blocks_new_candidate(self):
        result=assess(prior()[:1])
        self.assertFalse(result['ready'])
        self.assertFalse(result['binding_complete'])
        self.assertFalse(result['matching_previous_verified_candidate'])
    def test_changed_binding_blocks_new_candidate(self):
        x=prior();x[0]['value']='0'*64
        result=assess(x)
        self.assertFalse(result['ready'])
        self.assertFalse(result['matching_previous_verified_candidate'])
    def test_unrelated_secrets_ignored(self):
        x=prior()+[{'name':'SUPABASE_SERVICE_ROLE_KEY','value':'REDACTED'}]
        self.assertEqual(assess(x)['binding_count'],3)
    def test_malformed_inventory_fails_closed(self):
        for value in (None,{},[{'name':'present'}],['unexpected']):
            with self.assertRaises(Blocked):
                assess(value)

if __name__=='__main__':
    unittest.main()
