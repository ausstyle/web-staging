"""Source preservation and release-mode tests, no credentials or provider calls."""
import re,unittest
from pathlib import Path
from unittest.mock import patch
import release_known_read_recovery as release

class KnownReadRecoveryReleaseTests(unittest.TestCase):
 def test_exact_claim_patch_preserves_retry_and_authority_branches(self):
  sql=(release.ROOT/release.MIGRATION).read_text()
  original=(release.ROOT/release.FIXTURE).read_text().split('$function$')[1]
  after=release.candidate(sql)
  self.assertEqual(release.digest(original.encode()),release.PREIMAGE)
  self.assertIn("record_row.is_mutation THEN 'needs_reconciliation'",after)
  self.assertIn('attempts>=max_attempts',after)
  self.assertIn('public.sandy_orch_workload_job_current(record_row.id)',after)
  self.assertEqual(after.count("UPDATE public.sandy_orch_jobs SET state='needs_reconciliation'"),1)
  self.assertIn("'durable_result_available',false",after)
  self.assertNotIn("SET state='succeeded'",after)
  self.assertIn('NOT j.is_mutation',sql)
  self.assertIn('public.sandy_orch_workload_receipt_matches(j.id,a.id,t.dispatch_id)',sql)
 def test_corrupted_preimage_and_missing_patch_anchor_fail_closed(self):
  sql=(release.ROOT/release.MIGRATION).read_text()
  with self.assertRaises(release.Blocked):release.candidate(sql.replace('$old$FOR UPDATE','$old$NOT AN ANCHOR FOR UPDATE'))
  with patch.object(release,'PREIMAGE','0'*64):
   with self.assertRaises(release.Blocked):release.candidate(sql)
 def test_existing_protected_workflow_guard_mode_never_reinstalls_or_invokes_provider_acceptance(self):
  source=(release.ROOT/'.github/workflows/sandy-delegated-durable-read-release.yml').read_text()
  self.assertIn('recovery_guard_only:',source)
  for step in ['Install source-preserved worker','Independently verify every installed','Verify actual scheduled workload']:
   section=source.split('- name: '+step,1)[1].split('- name:',1)[0]
   self.assertIn('if: ${{ !inputs.recovery_guard_only',section)
   self.assertNotIn(' || ',section.split('if:',1)[1].splitlines()[0])
  self.assertIn('release_known_read_recovery.py --deploy',source)
  self.assertIn('release_known_read_recovery.py --verify-installed',source)
  self.assertIn('environment: sandy-production',source)
  self.assertNotIn('continue-on-error',source)
 def test_replay_of_installed_guard_is_rejected_before_tracking_or_ddl(self):
  original=(release.ROOT/release.FIXTURE).read_text().split('$function$')[1]
  class Fixture:
   def sql(self,query,*args):
    if 'schema_migrations' in query:return [{'version':release.VERSION}]
    raise AssertionError('No tracking or provider mutation permitted')
  with patch.object(release,'inspect',return_value=({'version':17},b'',{})),patch.object(release,'function',return_value={'prosrc':original,'prosecdef':True,'proconfig':['search_path=pg_catalog, pg_temp']}):
   with self.assertRaisesRegex(release.Blocked,'already_installed_reconcile_no_replay'):release.run(Fixture(),deploy=True)

 def test_production_fault_fixture_is_exact_approved_read_rollback_only(self):
  source=(release.ROOT/'scripts/sandy/verify_known_read_recovery.py').read_text()
  self.assertIn("JOB='d98a23a4-3740-41b5-902c-3cf9be7460da'",source)
  self.assertIn('recovery_fault_acceptance_requires_idle_queue',source)
  self.assertIn('SHARE ROW EXCLUSIVE MODE',source)
  self.assertIn('ROLLBACK;',source)
  self.assertIn('if snapshot(r)!=before:',source)
  self.assertIn("'full_autonomous_code_release_accepted':False",source)
  self.assertNotIn('sandy_orch_admit_workload_read',source)
  self.assertNotIn('sandy-engineering-runtime',source)
