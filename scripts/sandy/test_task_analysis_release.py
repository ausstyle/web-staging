import json,subprocess,sys,tempfile,unittest
from pathlib import Path
from unittest.mock import patch
import release_task_analysis_model as r
import release_runtime_slice as slices
class TaskAnalysisRelease(unittest.TestCase):
 def test_both_manifests_and_fixed_source_allowlist_agree(self):
  m,s,sql=r.load();self.assertEqual(slices.validate(s),'sandy-task-analysis-worker');self.assertFalse(m['policy_installed_enabled']);self.assertEqual(s['version'],21)
  for table in m['database_invariants']:
   self.assertTrue(table['relrowsecurity']);self.assertFalse(table['service_update']);self.assertFalse(table['customer_read'])
 def test_all_new_rpc_sources_are_exactly_extractable_not_merely_names(self):
  import re,hashlib
  _,_,sql=r.load()
  for name in r.FUNCTIONS:
   body=re.search(r'CREATE FUNCTION public\.'+name+r'\([^;]+?AS \$\$(.*?)\$\$;',sql,re.S);self.assertIsNotNone(body);self.assertGreater(len(body[1]),100)
 def test_actual_argparse_commands_accept_only_reviewed_flags_without_network(self):
  script=r.ROOT/'scripts/sandy/release_task_analysis_model.py'
  for action in ['schema','source','verify','rollout','rollback-source']:
   result=subprocess.run([sys.executable,str(script),'--action',action,'--evidence-dir','/tmp/not-written','--help'],capture_output=True,text=True)
   self.assertEqual(result.returncode,0,result.stderr)
  bad=subprocess.run([sys.executable,str(script),'--manifest','not-an-argument'],capture_output=True,text=True);self.assertEqual(bad.returncode,2)
 def test_workflow_stages_canary_before_separately_requested_rollout(self):
  text=(r.ROOT/'.github/workflows/sandy-task-analysis-model-validation.yml').read_text()
  self.assertIn('resume-source-and-canary',text);self.assertIn("inputs.action == 'bounded-rollout'",text);self.assertIn("steps.source.outcome == 'success' && steps.canary.outcome == 'failure'",text)
  self.assertIn("format('sandy-task-analysis-model-pr-{0}', github.event.pull_request.number)",text);self.assertIn('sandy-engineering-mcp-deploy',text)
  self.assertNotIn('--manifest',text)
 def test_rollout_denies_non_successful_or_wrong_workflow_before_any_mutation(self):
  class Fake:
   def sql(self,*args,**kwargs):raise AssertionError('no database write before protected proof')
  for data in [{'conclusion':'failure'},{'conclusion':'success','event':'workflow_dispatch','path':'.github/workflows/other.yml','head_branch':'main'}]:
   with patch.object(r,'committed'),patch.object(r,'schema'),patch.object(r.slices,'inspect'),patch.object(r.subprocess,'run',return_value=type('Result',(),{'returncode':0,'stdout':json.dumps(data)})()):
    with self.assertRaisesRegex(r.Blocked,'protected_task_model_canary'):r.rollout(Fake(),'40000000001')
 def test_unknown_canary_cannot_replay_through_legacy_rollback_when_queue_survives(self):
  import copy
  from release_web_canary import digest
  m,source,_=r.load();source=copy.deepcopy(source);body=b'isolated-eszip-placeholder';source['body_sha256']=digest(body)
  original={'index.ts':(r.ROOT/'scripts/sandy/testing/fixtures/task-analysis-worker-v20.ts').read_bytes()}
  class Fake:
   holder='isolated';writes=[]
   def sql(self,query,read_only=False):
    if query.startswith('SELECT enabled FROM'):return [{'enabled':False}]
    if 'SELECT change_id' in query:return [{'change_id':'10000000-0000-4000-8000-000000000001'}]
    if 'isolated_customers' in query:return [{'isolated_customers':2,'queue':1,'tasks':0,'users':0,'sessions':0,'refresh':0,'portals':0}]
    self.writes.append(query);raise AssertionError('must deny before custody mutation or source rollback')
   def api(self,*args):raise AssertionError('must not restore legacy while queue survives')
  with tempfile.TemporaryDirectory() as temp:
   base=Path(temp);pre=base/'task-model-source/private';pre.mkdir(parents=True);(pre/'before.body').write_bytes(body);out=base/'task-model-acceptance';out.mkdir()
   proof={'kind':'normal_customer_governed_task_analysis','source_commit':'a'*40,'github_run_id':'40000000001','cleanup':{'complete':True,'refresh_tokens_retired':True},'isolated_cohort_removed':True,'fixture_customer_ids':['20000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000002'],'fixture_user_ids':['30000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000002']};(out/'receipt.json').write_text(json.dumps(proof))
   with patch.object(r,'load',return_value=(m,source,'')),patch.object(r,'committed'),patch.object(r,'schema'),patch.object(r.slices,'inspect'),patch('release_web_canary.original_sources',return_value=original),patch.dict('os.environ',{'GITHUB_SHA':'a'*40,'GITHUB_RUN_ID':'40000000001'}):
    with self.assertRaisesRegex(r.Blocked,'queue_or_auth_may_replay'):r.rollback_source(Fake(),pre)
 def test_canary_requests_existing_normal_customer_queue_not_service_as_customer(self):
  text=(r.ROOT/'scripts/sandy/task_analysis_model_acceptance.py').read_text()
  self.assertIn("/functions/v1/sandy-agenda?action=create',f['token']",text);self.assertIn('time.sleep(1)',text);self.assertIn("'customer_requests_daily':1",text)
  self.assertNotIn('/functions/v1/sandy-task-analysis-worker',text);self.assertNotIn('OPENAI_API_KEY',text);self.assertNotIn('client_request_id',text)
if __name__=='__main__':unittest.main()
