#!/usr/bin/env python3
"""One new normal-customer web inspection; no replay of prior mutation/memory suites."""
import argparse,hashlib,json,os,uuid
from pathlib import Path
from runtime_model_metrics_acceptance import ModelMetricsAcceptance,safe_failure_classification
from verify_memory_private_mcp import PrivateMemoryAcceptance

class ChannelActivityAcceptance(ModelMetricsAcceptance):
 def __init__(self,output):
  super().__init__(output)
  self.report.update(kind='normal_customer_channel_activity_acceptance',model_turn_budget=4,external_provider_mutations_requested=0,old_acceptance_effects_repeated=0)
 def retire(self):pass # No temporary mutation-readiness grant is created by this read test.
 def exercise(self):
  source=self.source();f=self.fixtures[0];q=self.r._quote
  conversation=self.conversation(f);request='runtime_channels_'+uuid.uuid4().hex
  prompt='Call inspect_sandy_operational_state with domain communication_activity. Return only a JSON object containing the exact counts object from that tool. Preserve null for unknown counts. Do not send messages, change records, research or call other tools.'
  status,body=self.workspace(f,'ask',{'conversation_id':conversation,'request_id':request,'question':prompt,'timezone':'UTC'})
  self.report['web_calls'].append({'http_status':status,'task_id':body.get('task_id'),'request_id':request,'response_sha256':hashlib.sha256(json.dumps(body,sort_keys=True).encode()).hexdigest()});self.save()
  self.check('normal_customer_web_response',status==200 and body.get('ok') is True)
  text=str(body.get('response','')).strip()
  if text.startswith('```json') and text.endswith('```'):text=text[7:-3].strip()
  try:answer=json.loads(text)
  except ValueError:answer=None
  # Fresh isolated customer: this question is the single persisted web turn;
  # no voice/WhatsApp/email fixture messages were created by this acceptance.
  baseline=self.r._sql('SELECT (SELECT count(*) FROM public.sandy_web_turns WHERE customer_id='+q(f['customer'])+') web,(SELECT count(*) FROM public.sandy_voice_transcript_turns WHERE owner_customer_id='+q(f['customer'])+" AND role='user') voice,(SELECT count(*) FROM public.email_messages WHERE customer_id="+q(f['customer'])+" AND direction='incoming') email,(SELECT count(*) FROM public.sandy_whatsapp_identities WHERE customer_id="+q(f['customer'])+" AND verification_status='verified') whatsapp_ids,(SELECT count(*) FROM public.email_customer_addresses WHERE customer_id="+q(f['customer'])+" AND verified_at IS NOT NULL) addresses",True)[0]
  self.check('isolated_count_oracle',baseline['web']==1 and baseline['voice']==0 and baseline['email']==0 and baseline['whatsapp_ids']==0)
  expected={'web_messages':1,'whatsapp_inbound_verified_identity':0,'voice_user_turns':0,'email_incoming_customer_linked':0,'email_authored_by_verified_customer':0 if baseline['addresses'] else None}
  self.check('model_answer_matches_independent_channel_counts',answer==expected or answer=={'counts':expected})
  task=body['task_id']
  audits=self.r._sql('SELECT id,operation,principal_kind,customer_id,state FROM public.sandy_agent_operation_audit WHERE task_id='+q(task),True)
  self.check('actual_scoped_inspection_receipt',any(a['operation']=='agent.runtime.operational.communication' and a['state']=='succeeded' and a['customer_id']==f['customer'] and a['principal_kind']=='trusted_runtime' for a in audits))
  self.check('only_read_operation_requested',all(a['operation'] in ['agent.runtime.operational.communication','agent.runtime.conversation.respond','agent.runtime.connections.preflight'] for a in audits))
  rounds=self.r._sql('SELECT id,round,state,source_runtime,source_sha256,provider_response_id,response_sha256 FROM public.sandy_runtime_conversation_audit WHERE task_id='+q(task)+' ORDER BY round',True)
  self.check('bounded_actual_model_receipts',1<=len(rounds)<=4 and all(r['state']=='succeeded' and r['source_runtime']=='sandy-agent-runtime-v4' and r['source_sha256']==source['entrypoint_sha256'] and r['provider_response_id'] and r['response_sha256'] for r in rounds))
  self.report.update(independent_counts=expected,inspection_receipts=audits,model_receipts=rounds,acceptance_scope='normal web channel-count inspection; unavailable counts proven by isolated fault integration, not production fault injection');self.save()
  self.check('source_preserved',self.source()==source)
 def cleanup(self):
  # Retain banned Auth/customer rows for immutable audit FKs, as in the finite
  # mutation cleanup. No Auth deletion or original receipt purge.
  PrivateMemoryAcceptance.cleanup(self)
  q=self.r._quote
  for f in self.fixtures:
   if f.get('customer'):
    self.r._sql('BEGIN;DELETE FROM public.sandy_web_turns WHERE customer_id='+q(f['customer'])+';DELETE FROM public.sandy_web_conversations WHERE customer_id='+q(f['customer'])+';COMMIT;')
  self.report['cleanup']['web_fixtures_retired']=True;self.save()

def main():
 p=argparse.ArgumentParser(description=__doc__);p.add_argument('--output',type=Path,required=True);args=p.parse_args()
 runner=ChannelActivityAcceptance(args.output);passed=runner.run()
 proof={'passed':passed,'source_commit':os.environ.get('GITHUB_SHA'),'report_sha256':hashlib.sha256(args.output.read_bytes()).hexdigest(),'scope':runner.report.get('acceptance_scope'),'inspection_receipts':runner.report.get('inspection_receipts',[]),'model_receipts':runner.report.get('model_receipts',[]),'cleanup':runner.report.get('cleanup'),'failure':safe_failure_classification(runner.report) if not passed else None,'old_effects_repeated':0}
 q=runner.r._quote
 rows=runner.r._sql("INSERT INTO public.sandy_engineering_change_events(change_id,event_type,actor,detail) SELECT change_id,'runtime_channel_activity_acceptance',NULL,"+q(json.dumps(proof))+"::jsonb FROM public.sandy_engineering_change_events WHERE event_type='runtime_slice_dispatch' AND detail->>'source_commit'="+q(os.environ.get('GITHUB_SHA',''))+" ORDER BY id DESC LIMIT 1 RETURNING id")
 print('::notice title=Channel activity acceptance::'+json.dumps({'passed':passed,'event_id':rows[0]['id'] if len(rows)==1 else None,'failure':proof['failure']}))
 return 0 if passed and len(rows)==1 else 1
if __name__=='__main__':raise SystemExit(main())
