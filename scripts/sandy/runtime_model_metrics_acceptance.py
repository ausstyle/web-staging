#!/usr/bin/env python3
"""One genuine normal-customer web model turn; receipt telemetry, never outcome promotion."""
import argparse,hashlib,json,re,uuid
from pathlib import Path
from runtime_web_memory_acceptance import RuntimeMemoryAcceptance
from release_gcp_admin_read import Installer
from release_runtime_slice import inspect
from release_web_canary import ROOT

MANIFEST=ROOT/'docs/sandy-engineering/evaluations/runtime-slices/sandy-agent-runtime-v4.json'

class ModelMetricsAcceptance(RuntimeMemoryAcceptance):
 def __init__(self,output):
  super().__init__(output)
  self.report.update(kind='normal_customer_runtime_model_metrics_acceptance',model_turn_budget=1,model_or_connected_provider_work_requested=True,external_provider_mutations_requested=0)
 def source(self):
  manifest=json.loads(MANIFEST.read_bytes());admin=Installer(self.output.parent/'private-source-readback')
  meta,body,files=inspect(admin,manifest,installed=True)
  entry=hashlib.sha256(files['sandy-agent-runtime-v4/index.ts']).hexdigest()
  transport=files['_shared/sandy-agent-operations/runtime_conversation_v4_transport.ts'].decode()
  pins=re.findall(r'sourceSha256: "([a-f0-9]{64})"',transport)
  self.check('actual_entrypoint_matches_compiled_receipt_pin',pins==[entry] and entry==manifest['before_files']['sandy-agent-runtime-v4/index.ts'])
  source={'deployed_version':meta['version'],'entrypoint_sha256':entry,'bundle_sha256':hashlib.sha256(body).hexdigest(),'all_bundled_module_digests_verified':True,'receipt_source_sha256_identifies':'sandy-agent-runtime-v4/index.ts','functional_outcome_verified':False}
  self.report['source_readback']=source;self.save();return source
 def exercise(self):
  source=self.source()
  f=self.fixtures[0];conversation=self.conversation(f);request='runtime_metrics_'+uuid.uuid4().hex
  status,body=self.workspace(f,'ask',{'conversation_id':conversation,'request_id':request,'question':'Analyze the arithmetic 19 + 23 and reply exactly TELEMETRY_ACCEPTANCE_42. Do not use tools, contact anyone or change records.','timezone':'UTC'})
  safe={'http_status':status,'task_id':body.get('task_id'),'request_id':request,'response_sha256':hashlib.sha256(json.dumps(body,sort_keys=True).encode()).hexdigest(),'expected_marker_present':'TELEMETRY_ACCEPTANCE_42' in str(body.get('response',''))}
  self.report['web_calls'].append(safe);self.save()
  self.check('normal_customer_provider_response',status==200 and body.get('ok') is True and safe['expected_marker_present'])
  q=self.r._quote
  rounds=self.r._sql('SELECT id,round,state,source_runtime,source_sha256,selected_model,provider_response_id,response_sha256,model_metrics FROM public.sandy_runtime_conversation_audit WHERE task_id='+q(body['task_id'])+' ORDER BY round',True)
  safe['conversation_receipts']=rounds;self.save()
  self.check('exactly_one_paid_round',len(rounds)==1)
  for r in rounds:
   m=r.get('model_metrics') or {};u=m.get('usage') or {}
   self.check('actual_provider_receipt',r['state']=='succeeded' and r['source_runtime']=='sandy-agent-runtime-v4' and bool(r['provider_response_id']) and bool(r['response_sha256']))
   self.check('receipt_source_matches_independent_entrypoint',r['source_sha256']==source['entrypoint_sha256'])
   self.check('received_usage_and_duration',m.get('source')=='received_provider_envelope' and isinstance(m.get('model_returned'),str) and type(m.get('request_duration_ms')) is int and m['request_duration_ms']>=0 and type(u.get('input_tokens')) is int and u['input_tokens']>0 and type(u.get('output_tokens')) is int and u['output_tokens']>0 and m.get('provider_effect_verified') is False)
   if m.get('cost_basis')=='estimated_exact_model_verified_rate':
    rates=self.r._sql('SELECT model_name,input_usd_per_million,cached_input_usd_per_million,output_usd_per_million,verified_at FROM public.email_ai_model_rates WHERE model_name='+q(m['model_returned']),True)
    self.check('exact_returned_model_rate',len(rates)==1 and rates[0]['model_name']==m['model_returned'] and m.get('rate_verified_at') is not None)
    rate=rates[0];cached=u['cached_input_tokens'];expected=((u['input_tokens']-cached)*float(rate['input_usd_per_million'])+cached*float(rate['cached_input_usd_per_million'] or 0)+u['output_tokens']*float(rate['output_usd_per_million']))/1e6
    self.check('independent_estimated_cost_readback',abs(expected-float(m['estimated_cost_usd']))<=0.000000001)
   else:self.check('unknown_cost_remains_NULL',m.get('estimated_cost_usd') is None and m.get('rate_verified_at') is None)
  mutations=self.r._sql('SELECT count(*) n FROM public.sandy_agent_operation_audit a JOIN public.sandy_operation_registry r ON r.operation=a.operation WHERE a.task_id='+q(body['task_id'])+' AND r.is_mutation',True)
  self.check('no_mutating_operations_executed',mutations==[{'n':0}])
  self.check('source_preserved_through_acceptance',self.source()==source)
  self.report['functional_outcome_verification_claimed']=False

if __name__=='__main__':
 p=argparse.ArgumentParser(description=__doc__);p.add_argument('--output',type=Path,required=True);a=p.parse_args();raise SystemExit(0 if ModelMetricsAcceptance(a.output).run() else 1)
