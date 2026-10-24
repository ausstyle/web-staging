import os,unittest,json
from unittest.mock import Mock,patch
import release_task_cancel_certification as release
import task_cancel_source_patch as source
from release_web_canary import Blocked
class TaskCancelReleaseTests(unittest.TestCase):
 def test_only_api_hooks_and_two_reviewed_modules_change(self):
  m,_=release.load();api=m['functions']['sandy-operation-api'];mcp=m['functions']['sandy-api-mcp']
  changed={p for p in api['candidate_files'] if api['before_files'].get(p)!=api['candidate_files'][p]}
  self.assertEqual(changed,{source.INDEX,*source.REPLACE})
  self.assertEqual(mcp['candidate_files'],mcp['before_files']);self.assertFalse(mcp['redeploy']);self.assertTrue(api['redeploy'])
  self.assertEqual(api['before_version'],61);self.assertEqual(mcp['before_version'],23)
  self.assertEqual(len(api['before_files']),125)
  # main has reviewed but not deployed IAP work; it must never replace live index.
  self.assertNotEqual(api['candidate_files'][source.INDEX],release.digest((release.ROOT/'supabase/functions'/source.INDEX).read_bytes()))
 def test_uncommitted_or_feature_release_cannot_mutate(self):
  for env in [{},{'GITHUB_ACTIONS':'true','GITHUB_REF':'refs/heads/feature','GITHUB_SHA':'a'*40}]:
   with patch.dict(os.environ,env,clear=True),self.assertRaises(Blocked):release.source_check({})
 def test_preflight_never_writes_or_uploads(self):
  r=Mock()
  with patch.object(release,'functions',return_value={}),patch.object(release,'schema'),patch.object(release,'candidate'):
   self.assertEqual(release.run(r,{},{}),{'preflight_passed':True,'deployed':False,'mutations':0})
  r.upload.assert_not_called();r.sql.assert_not_called()
 def test_drift_blocks_before_dispatch(self):
  r=Mock()
  with patch.object(release,'functions',side_effect=Blocked('drift')):
   with self.assertRaises(Blocked):release.run(r,{}, {},True)
  r.sql.assert_not_called();r.upload.assert_not_called()
 def test_acceptance_verifies_source_then_public_memory_before_private_cancellation(self):
  workflow=(release.ROOT/'.github/workflows/sandy-task-cancel-certification.yml').read_text()
  self.assertLess(workflow.index('release_task_cancel_certification.py --verify-installed'),workflow.index('NormalMemoryAcceptance(Path'))
  self.assertLess(workflow.index('NormalMemoryAcceptance(Path'),workflow.index('verify_task_cancel_private_mcp.py --manifest'))
  self.assertNotIn('repair-readiness-and-certify',workflow)
  self.assertNotIn('repair_memory_readiness_custody.py',workflow)
 def test_exact_source_preimage_rejects_arbitrary_index(self):
  with self.assertRaisesRegex(Blocked,'reviewed_API61_preimage_changed'):source.patch_api({source.INDEX:b'arbitrary main'})
 def test_existing_cancellation_module_is_not_reinstalled(self):
  with patch.object(source,'digest',return_value=source.BEFORE_INDEX),self.assertRaisesRegex(Blocked,'already_installed'):
   source.patch_api({source.INDEX:b'fixture','sandy-operation-api/task_cancellation_certification.ts':b'existing'})
if __name__=='__main__':unittest.main()
