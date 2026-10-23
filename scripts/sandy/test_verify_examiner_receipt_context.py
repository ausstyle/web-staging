"""Safety/fault checks for the actual fixed-pilot acceptance launcher."""
import json,tempfile,unittest
from pathlib import Path
from unittest.mock import patch
from types import SimpleNamespace
import verify_examiner_receipt_context as v
class ExaminerAcceptance(unittest.TestCase):
 def test_local_process_cannot_launch_private_worker(self):
  with patch.dict(v.os.environ,{},clear=True),self.assertRaisesRegex(v.Blocked,'protected_main_workflow_required'):
   v.start(SimpleNamespace(api=lambda *_:self.fail('no private request before trusted workflow')))
 def test_unknown_network_result_never_retries(self):
  class Opener:
   calls=0
   def open(self,*args,**kwargs):self.calls+=1;raise TimeoutError('private-sensitive-error')
  opener=Opener()
  with patch.object(v.urllib.request,'build_opener',return_value=opener):
   with self.assertRaisesRegex(v.Blocked,'outcome_unknown_do_not_retry'):
    v.request({'case_keys':v.CASES},'private-only-test-secret')
  self.assertEqual(opener.calls,1)
 def test_unauthorised_body_not_exposed(self):
  from io import BytesIO
  class Opener:
   def open(self,*args,**kwargs):raise v.urllib.error.HTTPError(v.URL,403,'private',{},BytesIO(b'secret-provider-detail'))
  with patch.object(v.urllib.request,'build_opener',return_value=Opener()):
   self.assertEqual(v.request({},'private-only-test-secret'),(403,{}))
 def test_missing_live_receipts_cannot_pass_from_model_verdicts(self):
  run='production:12345678-1234-4234-8234-123456789012'
  rows=[{'case_key':case,'request_id':'fixture','edge_status':200,'verdict':'pass','mode':'focused_regression_v1','judge_score':5,'judge_http_failed':False,'task_status':'completed','trace_entries':0} for case in v.CASES]
  response=[[{'run_key':run,'status':'complete','attempted':3,'passed':3,'failed':0,'reviews':0,'mode':'focused_regression_v1'}],rows,[],[{'successful_mutations':0}]]
  r=SimpleNamespace(sql=lambda *_:response.pop(0))
  self.assertFalse(v.inspect(r,run)['execution_and_judging_verified'])
 def test_wrong_runtime_or_uncertain_receipts_cannot_pass(self):
  run='production:12345678-1234-4234-8234-123456789012'
  for receipt in [{'source_runtime':'sandy-agent-runtime-v2','source_sha256':'fixture','selected_model':'fixture','state':'succeeded'},{'source_runtime':'sandy-agent-runtime-v4','source_sha256':'fixture','selected_model':'fixture','state':'unknown'}]:
   rows=[{'case_key':case,'edge_status':200,'mode':'focused_regression_v1','judge_score':5,'judge_http_failed':False,'task_status':'completed'} for case in v.CASES]
   response=[[{'run_key':run,'status':'complete'}],rows,[receipt],[{'successful_mutations':0}]]
   self.assertFalse(v.inspect(SimpleNamespace(sql=lambda *_:response.pop(0)),run)['execution_and_judging_verified'])
if __name__=='__main__':unittest.main()
