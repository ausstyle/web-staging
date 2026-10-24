import json,tempfile,unittest
from pathlib import Path
from runtime_model_metrics_acceptance import ModelMetricsAcceptance

class FakeRuntime:
 source='actual-entry-digest'
 def _quote(self,x):return "'"+x+"'"
 def _sql(self,query,readonly):
  if 'FROM public.sandy_runtime_conversation_audit' in query:return [{'id':'receipt','round':0,'state':'succeeded','source_runtime':'sandy-agent-runtime-v4','source_sha256':self.source,'selected_model':'alias','provider_response_id':'actual-model-response','response_sha256':'actual-response-digest','model_metrics':self.metrics}]
  if 'email_ai_model_rates' in query:return [{'model_name':'dated-model','input_usd_per_million':1,'cached_input_usd_per_million':0.1,'output_usd_per_million':2,'verified_at':'2026-10-23T00:00:00Z'}]
  return [{'n':0}]

class Harness(ModelMetricsAcceptance):
 def __init__(self,output,metrics):
  self.output=output;self.r=FakeRuntime();self.r.metrics=metrics;self.fixtures=[{'customer':'isolated'}];self.report={'checks':[],'web_calls':[]};self.calls=0
 def source(self):return {'entrypoint_sha256':'actual-entry-digest','bundle_sha256':'independent-bundle-digest'}
 def conversation(self,f):return 'conversation'
 def workspace(self,f,action,body):
  self.calls+=1
  return 200,{'ok':True,'task_id':'task','response':'TELEMETRY_ACCEPTANCE_42'}

class AcceptanceTests(unittest.TestCase):
 def metrics(self):return {'source':'received_provider_envelope','model_returned':'dated-model','request_duration_ms':50,'usage':{'input_tokens':100,'output_tokens':10,'cached_input_tokens':0},'estimated_cost_usd':None,'cost_basis':'unavailable_exact_fresh_rate','rate_verified_at':None,'provider_effect_verified':False}
 def test_single_real_turn_path_preserves_unknown_cost(self):
  with tempfile.TemporaryDirectory() as d:
   h=Harness(Path(d)/'report.json',self.metrics());h.exercise();self.assertEqual(h.calls,1);self.assertTrue(all(c['passed'] for c in h.report['checks']))
 def test_received_usage_is_required_and_unknown_price_cannot_be_zero(self):
  for patch in [{'usage':None},{'estimated_cost_usd':0},{'provider_effect_verified':True},{'request_duration_ms':True},{'usage':{**self.metrics()['usage'],'input_tokens':True}}]:
   with tempfile.TemporaryDirectory() as d:
    h=Harness(Path(d)/'report.json',{**self.metrics(),**patch})
    with self.assertRaises(RuntimeError):h.exercise()
 def test_stale_receipt_source_does_not_pass_current_bundle_readback(self):
  with tempfile.TemporaryDirectory() as d:
   h=Harness(Path(d)/'report.json',self.metrics());h.r.source='stale-source'
   with self.assertRaisesRegex(RuntimeError,'receipt_source_matches_independent_entrypoint'):h.exercise()
 def test_exact_rate_cost_is_independently_recalculated(self):
  with tempfile.TemporaryDirectory() as d:
   h=Harness(Path(d)/'report.json',{**self.metrics(),'cost_basis':'estimated_exact_model_verified_rate','rate_verified_at':'2026-10-23T00:00:00Z','estimated_cost_usd':0.00012});h.exercise();self.assertEqual(h.calls,1)
if __name__=='__main__':unittest.main()
