import copy,json,re,unittest
from pathlib import Path
from prepare_task_analysis_model import ROOT,BEFORE_SHA,AFTER_SHA,candidate,sha
class TaskAnalysisSource(unittest.TestCase):
 def setUp(self):
  self.original={'index.ts':(ROOT/'scripts/sandy/testing/fixtures/task-analysis-worker-v20.ts').read_bytes()}
 def test_reviewed_actual_preimage_and_full_bundle_pins(self):
  m=json.loads((ROOT/'docs/sandy-engineering/evaluations/task-analysis-model-admission.json').read_text());files=candidate(self.original)
  self.assertEqual({k:sha(v) for k,v in files.items()},m['candidate_files']);self.assertEqual(sha(self.original['index.ts']),BEFORE_SHA)
  self.assertEqual(sha((ROOT/m['migration']).read_bytes()),m['migration_sha256']);self.assertFalse(m['provider_execution_verified']);self.assertFalse(m['policy_installed_enabled'])
 def test_drift_and_unexpected_modules_deny_before_any_upload(self):
  for files in [{**self.original,'other.ts':b''},{'index.ts':self.original['index.ts']+b'\n'}]:
   with self.assertRaisesRegex(ValueError,'preimage'):candidate(files)
 def test_database_guard_and_helper_pin_real_unchanged_entrypoint(self):
  files=candidate(self.original);sql=(ROOT/'supabase/migrations/20261024005200_sandy_task_model_admission.sql').read_text();helper=files['_shared/sandy-agent-operations/task_analysis_model.ts'].decode()
  self.assertEqual(sha(files['sandy-task-analysis-worker/index.ts']),AFTER_SHA);self.assertIn(AFTER_SHA,helper);self.assertGreaterEqual(sql.count(AFTER_SHA),3)
  profile=files['_shared/sandy-agent-operations/task_analysis_profile.ts'].decode();instruction=json.loads(re.search(r'taskAnalysisInstructions = (".*");',profile).group(1));self.assertIn(sha(instruction.encode()),sql)
 def test_customer_worker_auth_queue_and_title_cas_remain_original(self):
  files=candidate(self.original);text=files['sandy-task-analysis-worker/index.ts'].decode()
  for anchor in ['sandy_task_worker_authorized','sandy_task_claim_analysis','p_limit:10','.eq("title",job.source_title)','.eq("customer_id",job.customer_id)','if(literalTaskTitle(title))return null']:
   self.assertIn(anchor,text)
  self.assertEqual(text.count('https://api.openai.com/v1/chat/completions'),1);self.assertIn('if(mode.data==="legacy_staging")return await legacyExtract(title)',text)
if __name__=='__main__':unittest.main()
