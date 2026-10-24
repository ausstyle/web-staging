#!/usr/bin/env python3
"""One new normal-customer web inspection; no replay of prior mutation/memory suites."""
import argparse,hashlib,json,os,uuid
from pathlib import Path
from runtime_model_metrics_acceptance import ModelMetricsAcceptance,safe_failure_classification
from runtime_channel_activity_acceptance import ChannelActivityAcceptance

class CapabilityAcceptance(ChannelActivityAcceptance):
 def __init__(self,output):
  super().__init__(output)
  self.report.update(kind='normal_customer_capability_acceptance',model_turn_budget=4,external_provider_mutations_requested=0,old_acceptance_effects_repeated=0)
 def retire(self):pass # No temporary mutation-readiness grant is created by this read test.
 def exercise(self):
  source=self.source();f=self.fixtures[0];q=self.r._quote
  conversation=self.conversation(f);request='runtime_capability_'+uuid.uuid4().hex
  def oracle():
   return self.r._sql("SELECT count(*) total_modules,count(*) FILTER (WHERE last_tested_at IS NULL OR last_tested_at>now() OR last_tested_at<=now()-interval '24 hours') unverified_modules FROM public.sandy_module_status",True)[0]
  before=oracle()
  self.check('catalogue_within_tool_limit',0<before['total_modules']<250)
  prompt='Call inspect_sandy_operational_state with domain capabilities. Return only a JSON object with total_modules (number of entries in modules) and unverified_modules (number of entries whose stale is true). Do not treat unverified modules as operational. Do not send messages, change records, research or call other tools.'
  status,body=self.workspace(f,'ask',{'conversation_id':conversation,'request_id':request,'question':prompt,'timezone':'UTC'})
  self.report['web_calls'].append({'http_status':status,'task_id':body.get('task_id'),'request_id':request,'response_sha256':hashlib.sha256(json.dumps(body,sort_keys=True).encode()).hexdigest()});self.save()
  self.check('normal_customer_web_response',status==200 and body.get('ok') is True)
  text=str(body.get('response','')).strip()
  if text.startswith('```json') and text.endswith('```'):text=text[7:-3].strip()
  try:answer=json.loads(text)
  except ValueError:answer=None
  after=oracle()
  self.check('catalogue_stable_through_read',before==after)
  self.check('model_answer_matches_independent_freshness_counts',answer==after)
  task=body['task_id']
  audits=self.r._sql('SELECT id,operation,principal_kind,customer_id,state FROM public.sandy_agent_operation_audit WHERE task_id='+q(task),True)
  self.check('actual_scoped_inspection_receipt',any(a['operation']=='agent.runtime.operational.capabilities' and a['state']=='succeeded' and a['customer_id']==f['customer'] and a['principal_kind']=='trusted_runtime' for a in audits))
  self.check('only_read_operation_requested',all(a['operation'] in ['agent.runtime.operational.capabilities','agent.runtime.conversation.respond','agent.runtime.connections.preflight'] for a in audits))
  rounds=self.r._sql('SELECT id,round,state,source_runtime,source_sha256,provider_response_id,response_sha256 FROM public.sandy_runtime_conversation_audit WHERE task_id='+q(task)+' ORDER BY round',True)
  self.check('bounded_actual_model_receipts',1<=len(rounds)<=4 and all(r['state']=='succeeded' and r['source_runtime']=='sandy-agent-runtime-v4' and r['source_sha256']==source['entrypoint_sha256'] and r['provider_response_id'] and r['response_sha256'] for r in rounds))
  self.report.update(independent_counts=after,inspection_receipts=audits,model_receipts=rounds,acceptance_scope='normal web capability freshness inspection; invalid timestamps and unavailable catalogues verified by isolated fault integration, not production fault injection');self.save()
  self.check('source_preserved',self.source()==source)

def main():
 p=argparse.ArgumentParser(description=__doc__);p.add_argument('--output',type=Path,required=True);args=p.parse_args()
 runner=CapabilityAcceptance(args.output);passed=runner.run()
 proof={'passed':passed,'source_commit':os.environ.get('GITHUB_SHA'),'report_sha256':hashlib.sha256(args.output.read_bytes()).hexdigest(),'scope':runner.report.get('acceptance_scope'),'inspection_receipts':runner.report.get('inspection_receipts',[]),'model_receipts':runner.report.get('model_receipts',[]),'cleanup':runner.report.get('cleanup'),'failure':safe_failure_classification(runner.report) if not passed else None,'old_effects_repeated':0}
 q=runner.r._quote
 rows=runner.r._sql("INSERT INTO public.sandy_engineering_change_events(change_id,event_type,actor,detail) SELECT change_id,'runtime_capability_acceptance',NULL,"+q(json.dumps(proof))+"::jsonb FROM public.sandy_engineering_change_events WHERE event_type='runtime_slice_dispatch' AND detail->>'source_commit'="+q(os.environ.get('GITHUB_SHA',''))+" ORDER BY id DESC LIMIT 1 RETURNING id")
 print('::notice title=Capability freshness acceptance::'+json.dumps({'passed':passed,'event_id':rows[0]['id'] if len(rows)==1 else None,'failure':proof['failure']}))
 return 0 if passed and len(rows)==1 else 1
if __name__=='__main__':raise SystemExit(main())
