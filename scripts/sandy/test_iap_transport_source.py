import unittest
from prepare_iap_repair_transport import patch,verify_candidate,Blocked,SLUG,MODULE,ANCHOR,ROUTE
class SourcePreservation(unittest.TestCase):
 def setUp(self):self.files={SLUG+'/index.ts':('import "old";\n'+ANCHOR+'\nexistingControl();').encode(),SLUG+'/gcp_admin_read.ts':b'preserved read acceptance'}
 def test_patch_retains_all_unrelated_modules_and_source(self):
  result=patch(self.files,b'reviewed callback',b'reviewed jobs',b'reviewed contract');self.assertEqual(result[SLUG+'/gcp_admin_read.ts'],self.files[SLUG+'/gcp_admin_read.ts']);self.assertIn(ROUTE.encode(),result[SLUG+'/index.ts']);self.assertTrue(verify_candidate(result,dict(result)));self.assertEqual(result[MODULE],b'reviewed callback')
 def test_generic_engineering_job_routes_are_not_captured_by_iap_specialization(self):
  self.assertIn('&&isIapRepairControlRequest(b)',ROUTE)
  self.assertNotIn('["implementation_request","execute_job","job_status"].includes(action)',ROUTE)
 def test_changed_anchor_or_existing_implementation_refuses_overwrite(self):
  for files in [{SLUG+'/index.ts':b'changed'},self.files|{MODULE:b'already installed'}]:
   with self.assertRaises(Blocked):patch(files,b'candidate',b'jobs',b'contract')
 def test_independent_readback_requires_exact_full_module_map(self):
  expected=patch(self.files,b'candidate',b'jobs',b'contract')
  for actual in [expected|{SLUG+'/gcp_admin_read.ts':b'changed'},dict(self.files),expected|{'unexpected':b'code'}]:
   with self.assertRaises(Blocked):verify_candidate(expected,actual)
if __name__=='__main__':unittest.main()
