import contextlib,io,json,tempfile,unittest
from pathlib import Path
from unittest.mock import patch
import repair_runtime_entrypoint_profile as repair
from runtime_model_metrics_acceptance import safe_failure_classification
from release_web_canary import Blocked
class RepairTests(unittest.TestCase):
 def test_exact_profile_readback_requires_one_validated_constraint(self):
  class R:
   def sql(self,*a):return []
  with self.assertRaises(Blocked):repair.profile(R())
 def test_source_only_workflow_never_uploads_or_reinstalls_runtime_or05000(self):
  source=Path('.github/workflows/sandy-runtime-entrypoint-profile-repair.yml').read_text()
  self.assertNotIn('release_runtime_slice.py --deploy',source)
  self.assertNotIn('release_runtime_model_metrics.py --deploy',source)
  self.assertIn('repair_runtime_entrypoint_profile.py --verify-installed',source)
  self.assertLess(source.index('Verify source, profile'),source.index('One normal customer turn'))
 def test_actual_repair_cli_accepts_apply_and_readback_without_network(self):
  with tempfile.TemporaryDirectory() as out:
   for flag,expected in [('--apply',(True,False)),('--verify-installed',(False,True))]:
    folder=Path(out)/flag[2:];fake=type('Installer',(),{'stage':'stubbed','last_request':None})()
    with patch('sys.argv',['repair_runtime_entrypoint_profile.py',flag,'--evidence-dir',str(folder)]),patch.object(repair,'Installer',return_value=fake),patch.object(repair,'run',return_value={'verified':True}) as run,contextlib.redirect_stdout(io.StringIO()):
     self.assertEqual(repair.main(),0);self.assertEqual(run.call_args.args[1:],expected)
 def test_failure_annotation_is_classified_without_response_or_arbitrary_error_text(self):
  result=safe_failure_classification({'runner_error':'RuntimeError','runner_error_code':'normal_customer_provider_response','checks':[{'name':'normal_customer_provider_response','passed':False},{'name':'secret-token/password','passed':False}],'cleanup':{'complete':True},'raw_body':'private customer output','exception':'Bearer private-token'})
  self.assertEqual(result['error_class'],'RuntimeError');self.assertEqual(result['error_code'],'normal_customer_provider_response');self.assertEqual(result['failed_checks'],['normal_customer_provider_response']);self.assertFalse(result['provider_response_contents_included'])
  self.assertNotIn('private',json.dumps(result));self.assertNotIn('secret',json.dumps(result))
if __name__=='__main__':unittest.main()
