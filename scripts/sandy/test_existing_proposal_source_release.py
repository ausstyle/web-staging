"""Exact-source release and snapshot contracts; no credentials/provider calls."""
import json,unittest
from unittest.mock import patch
import release_existing_proposal_source_sync as release
from release_runtime_slice import source_snapshot,Blocked,digest

class ExistingProposalSourceReleaseTests(unittest.TestCase):
 def test_patch_preserves_existing_target_review_and_never_admits_architect_or_risk(self):
  sql=(release.ROOT/release.MIGRATION).read_text();after=release.candidate(sql)
  self.assertIn("h.target_function is not null",after)
  self.assertIn("status='waiting_evidence'",after)
  self.assertNotIn("phase='architect'",after)
  self.assertNotIn("risk_level=",after)
  self.assertNotIn('attempt_count=',after)
  self.assertIn('on conflict(event_key) do nothing',after)
  self.assertIn("'independent_source_review_complete',false",sql)
  self.assertIn("'capability_accepted',false",sql)
 def test_drifted_scan_preimage_or_patch_anchor_is_rejected(self):
  sql=(release.ROOT/release.MIGRATION).read_text()
  with patch.object(release,'PREIMAGE','0'*64):
   with self.assertRaises(release.Blocked):release.candidate(sql)
  with self.assertRaises(release.Blocked):release.candidate(sql.replace('$old$  return jsonb_build_object','$old$  NOT AN ANCHOR return jsonb_build_object'))
 def test_source_snapshot_contains_only_hashes_configuration_and_fixed_identity(self):
  slug='sandy-agent-runtime-v4';code=b'private-source-body-not-output';files={slug+'/index.ts':code,'_shared/reviewed.ts':b'helper'}
  result=source_snapshot(slug,{'slug':slug,'status':'ACTIVE','version':38,'verify_jwt':True},b'bundle',files)
  self.assertNotIn(code.decode(),json.dumps(result));self.assertEqual(result['entrypoint_sha256'],digest(code));self.assertEqual(result['module_digests'][slug+'/index.ts'],digest(code))
  self.assertEqual(result['contract'],'reviewed-runtime-source-snapshot-v1')
  for metadata in [{'slug':slug,'status':'ACTIVE','version':True,'verify_jwt':True},{'slug':slug,'status':'FAILED','version':38,'verify_jwt':True}]:
   with self.assertRaises(Blocked):source_snapshot(slug,metadata,b'bundle',files)
 def test_source_sync_mode_preserves_independent_recovery_and_skips_provider_calls(self):
  source=(release.ROOT/'.github/workflows/sandy-delegated-durable-read-release.yml').read_text()
  for step in ['Install source-preserved worker','Independently verify every installed','Verify actual scheduled workload']:
   section=source.split('- name: '+step,1)[1].split('- name:',1)[0];self.assertIn('!inputs.proposal_source_sync_only',section)
  self.assertIn("test \"$RECOVERY:$SOURCE_SYNC\" != 'true:true'",source)
  self.assertIn('release_existing_proposal_source_sync.py --deploy',source)
  self.assertIn('environment: sandy-production',source)
