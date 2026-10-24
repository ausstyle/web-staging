"""One normal isolated customer's existing task queue; at most one paid model call."""
import argparse,datetime,hashlib,json,os,re,time,uuid
from pathlib import Path
from runtime_web_memory_acceptance import RuntimeMemoryAcceptance
from release_gcp_admin_read import Installer,quote
from release_web_canary import ROOT,Blocked
from release_task_analysis_model import load,schema,committed,CAP
import release_runtime_slice as slices
from engineering_runtime import BASE
class TaskAnalysisAcceptance(RuntimeMemoryAcceptance):
 def __init__(self,output):
  super().__init__(output);self.policy_before=None;self.canary=None;self.change=None
  self.report.update(kind='normal_customer_governed_task_analysis',model_turn_budget=1,external_provider_mutations_requested=0,provider_execution_verified=False)
 def source(self):
  m,s,sql=load();schema(self.admin,m,sql);meta,body,files=slices.inspect(self.admin,s,True)
  a=m['agenda_source'];am=json.loads(self.admin.api('GET','/functions/sandy-agenda'));ab=self.admin.api('GET','/functions/sandy-agenda/body')
  from release_web_canary import original_sources
  self.check('actual_normal_customer_agenda_source',am['version']==a['version'] and am['verify_jwt']==a['verify_jwt'] and hashlib.sha256(ab).hexdigest()==a['body_sha256'] and {k:hashlib.sha256(v).hexdigest() for k,v in original_sources(ab).items()}==a['files'])
  return {'version':meta['version'],'entrypoint_sha256':hashlib.sha256(files['sandy-task-analysis-worker/index.ts']).hexdigest(),'bundle_sha256':hashlib.sha256(body).hexdigest()}
 def prepare(self):
  self.admin=Installer(self.output.parent/'private-source');m,_,_=load();committed(m);self.initial_source=self.source();self.report.update(source_readback=self.initial_source,source_commit=os.environ['GITHUB_SHA'],github_run_id=os.environ['GITHUB_RUN_ID']);self.save();super().prepare()
  f=self.fixtures[0];q=self.r._quote
  records=self.admin.sql("SELECT change_id FROM public.sandy_engineering_change_events WHERE event_type='runtime_slice_source_verified' AND detail->>'function'='sandy-task-analysis-worker' AND detail->>'source_commit'="+q(os.environ['GITHUB_SHA'])+' ORDER BY id DESC LIMIT 1',True)
  self.check('protected_existing_worker_release',len(records)==1);self.change=records[0]['change_id']
  policy=self.admin.sql("SELECT enabled,execution_limits FROM public.sandy_openai_context_policies WHERE capability='"+CAP+"'",True)
  self.check('disabled_unassigned_staged_policy',len(policy)==1 and policy[0]['enabled'] is False and 'canary_customer_id' not in policy[0]['execution_limits'] and policy[0]['execution_limits'].get('rollout_stage')=='legacy_staging')
  self.policy_before=policy[0]['execution_limits'];self.canary=f['customer'];self.canary_limits={**self.policy_before,'canary_customer_id':f['customer'],'canary_expires_at':(datetime.datetime.now(datetime.timezone.utc)+datetime.timedelta(minutes=14)).isoformat(),'customer_requests_daily':1,'canary_source_commit':os.environ['GITHUB_SHA']}
  # No workload API can write its own policy. This project-administrator release
  # configures only the already verified fresh isolated customer, before create.
  safe=self.admin.sql('SELECT c.display_name,c.google_drive_folder_status,u.raw_user_meta_data->>\'sandy_api_isolated_session_test\' fixture,m.enabled,m.learning_enabled,m.proactive_enabled FROM public.email_customers c JOIN public.sandy_memory_settings m ON m.customer_id=c.id JOIN public.sandy_memory_portal_accounts p ON p.customer_id=c.id JOIN auth.users u ON u.id=p.auth_user_id WHERE c.id='+q(f['customer'])+' AND u.id='+q(f['user'])+' AND p.revoked_at IS NULL',True)
  self.check('fresh_isolated_canary_owner',safe==[{'display_name':'Isolated Sandy API service acceptance','google_drive_folder_status':'excluded','fixture':'true','enabled':False,'learning_enabled':False,'proactive_enabled':False}])
  self.admin.sql("DO $$ BEGIN UPDATE public.sandy_openai_context_policies SET execution_limits="+q(json.dumps(self.canary_limits))+"::jsonb WHERE capability='"+CAP+"' AND enabled=false AND execution_limits="+q(json.dumps(self.policy_before))+"::jsonb;IF NOT FOUND THEN RAISE EXCEPTION 'canary policy drift';END IF;END $$")
  self.admin.sql("INSERT INTO public.sandy_engineering_change_events(change_id,event_type,actor,detail) VALUES('"+self.change+"','task_model_isolated_cohort_installed',NULL,"+q(json.dumps({'fixture_customer_id':f['customer'],'source_commit':os.environ['GITHUB_SHA'],'expires_at':self.canary_limits['canary_expires_at'],'model_request_ceiling':1,'Owner_authority_created':False}))+"::jsonb)")
 def create(self,title):
  request=None;f=self.fixtures[0]
  status,body=self.r._http('POST',BASE+'/functions/v1/sandy-agenda?action=create',f['token'],{'title':title,'details':'Synthetic isolated model configuration acceptance; no contact or delivery requested.','priority':'normal'},self.keys['anon'])
  self.check('normal_authenticated_task_create',status==200 and body.get('ok') is True and bool(body.get('id')))
  task=str(uuid.UUID(body['id']));q=self.r._quote;queue=[]
  for _ in range(40):
   queue=self.admin.sql('SELECT state,attempts,last_error,processed_at FROM public.sandy_task_analysis_queue WHERE task_id='+q(task)+' AND customer_id='+q(f['customer']),True)
   if queue and queue[0]['state'] in ['complete','failed','skipped']:break
   time.sleep(1)
  self.check('existing_private_worker_queue_completed',len(queue)==1 and queue[0]['state']=='complete' and queue[0]['processed_at'] is not None)
  self.report.setdefault('queue_receipts',[]).append({'task_id':task,**queue[0]});self.save();return task,request
 def exercise(self):
  task,request=self.create('Call Alice tomorrow at 3pm AEST');f=self.fixtures[0];q=self.r._quote
  rows=self.admin.sql("SELECT id,execution_status,request_id,provider_response_id,verified_success,request_sha256,meta FROM public.sandy_openai_request_audit WHERE capability='"+CAP+"' AND customer_id="+q(f['customer'])+' AND source_reference='+q(task),True)
  self.check('exactly_one_actual_completed_model_receipt',len(rows)==1 and rows[0]['execution_status']=='succeeded' and bool(rows[0]['provider_response_id']) and rows[0]['verified_success'] is False)
  r=rows[0];metrics=r['meta'].get('model_metrics') or {};usage=metrics.get('usage') or {};result=r['meta'].get('result') or {}
  self.check('receipt_matches_actual_worker_entrypoint',r['meta'].get('source_sha256')==self.initial_source['entrypoint_sha256'] and r['meta'].get('gateway_http_status')==200)
  self.check('received_actual_bounded_provider_usage',metrics.get('source')=='received_provider_envelope' and type(usage.get('input_tokens')) is int and usage['input_tokens']>0 and type(usage.get('output_tokens')) is int and 0<usage['output_tokens']<=512 and type(metrics.get('request_duration_ms')) is int and metrics['request_duration_ms']>=0 and metrics.get('provider_effect_verified') is False)
  if metrics.get('cost_basis')!='estimated_exact_model_verified_rate':self.check('unknown_model_cost_is_NULL',metrics.get('estimated_cost_usd') is None and metrics.get('rate_verified_at') is None)
  else:
   rates=self.admin.sql('SELECT input_usd_per_million,cached_input_usd_per_million,output_usd_per_million FROM public.email_ai_model_rates WHERE model_name='+q(metrics['model_returned']),True);self.check('exact_returned_model_rate_available',len(rates)==1)
   rate=rates[0];cached=usage['cached_input_tokens'];cost=((usage['input_tokens']-cached)*float(rate['input_usd_per_million'])+cached*float(rate['cached_input_usd_per_million'] or 0)+usage['output_tokens']*float(rate['output_usd_per_million']))/1e6
   self.check('independent_estimated_cost',abs(cost-float(metrics['estimated_cost_usd']))<=1e-9)
  actual=self.admin.sql('SELECT title,contact_name,start_at,priority,metadata,created_at FROM public.sandy_tasks WHERE id='+q(task)+' AND customer_id='+q(f['customer']),True)
  self.check('single_owned_task_readback',len(actual)==1);t=actual[0]
  self.check('requested_typed_configuration_applied',t['title']=='Call Alice tomorrow at 3pm AEST' and t['contact_name']=='Alice' and t['priority']=='normal' and t['metadata'].get('task_ai_extraction_only') is True and result.get('hour')==15 and result.get('minute')==0 and result.get('timezone')=='AEST')
  created=datetime.datetime.fromisoformat(t['created_at'].replace('Z','+00:00'));date=(created+datetime.timedelta(hours=10,days=1)).date();expected=datetime.datetime.combine(date,datetime.time(5),datetime.timezone.utc)
  self.check('independent_clock_configuration',datetime.datetime.fromisoformat(t['start_at'].replace('Z','+00:00'))==expected)
  literal,_=self.create('"Sandy model analysis literal acceptance"')
  count=self.admin.sql("SELECT count(*)::int n FROM public.sandy_openai_request_audit WHERE capability='"+CAP+"' AND customer_id="+q(f['customer']),True);self.check('literal_has_no_additional_model_admission',count==[{'n':1}])
  status,_=self.r._http('POST',BASE+'/rest/v1/rpc/sandy_task_model_admit',f['token'],{'p_task_id':task,'p_customer_id':f['customer'],'p_source_sha256':'0'*64,'p_request_canonical':'{}'},self.keys['anon']);self.check('customer_cannot_call_private_model_admission',status==403)
  self.report.update(model_receipt_id=r['id'],model_metrics=metrics,provider_response_id=r['provider_response_id'],request_sha256=r['request_sha256'],source_readback=self.initial_source,typed_task_configuration_verified=True,unknown_replay_verified='isolated_PostgreSQL_and_transport_tests_only',literal_task_id=literal,nonliteral_task_id=task,provider_execution_verified=True)
  self.check('source_preserved_through_canary',self.source()==self.initial_source)
 def cleanup(self):
  policy_error=None
  try:
   if self.policy_before is not None and self.canary:
    q=self.r._quote;self.admin.sql("DO $$ BEGIN UPDATE public.sandy_openai_context_policies SET execution_limits="+q(json.dumps(self.policy_before))+"::jsonb WHERE capability='"+CAP+"' AND enabled=false AND execution_limits="+q(json.dumps(self.canary_limits))+"::jsonb;IF NOT FOUND THEN RAISE EXCEPTION 'canary policy drift requires reconciliation';END IF;END $$")
    self.report['isolated_cohort_removed']=True
  except Exception:
   policy_error=True;self.report['isolated_cohort_cleanup_requires_reconciliation']=True
  finally:
   super().cleanup()
  if self.fixtures:
   users=','.join(self.r._quote(f['user']) for f in self.fixtures)
   remaining=self.admin.sql('SELECT count(*)::int n FROM auth.refresh_tokens WHERE user_id IN('+users+')',True)
   self.report['cleanup']['refresh_tokens_retired']=remaining==[{'n':0}];self.save()
   if remaining!=[{'n':0}]:raise RuntimeError('fixture_refresh_tokens_not_retired')
  if policy_error:raise RuntimeError('isolated_cohort_cleanup_requires_reconciliation')
 def run(self):
  result=super().run()
  if result:
   detail={'source_commit':os.environ['GITHUB_SHA'],'github_run_id':os.environ['GITHUB_RUN_ID'],'entrypoint_sha256':self.initial_source['entrypoint_sha256'],'model_receipt_id':self.report['model_receipt_id'],'fixture_customer_id':self.fixtures[0]['customer'],'fixture_user_id':self.fixtures[0]['user'],'complete':True,'fixture_retired':True,'model_calls':1,'typed_task_configuration_verified':True,'unknown_replay_verification':'isolated_tests_only','report_sha256':hashlib.sha256(self.output.read_bytes()).hexdigest()}
   self.admin.sql("INSERT INTO public.sandy_engineering_change_events(change_id,event_type,actor,detail) VALUES('"+self.change+"','task_model_isolated_acceptance_verified',NULL,"+quote(json.dumps(detail))+"::jsonb)")
  return result
if __name__=='__main__':
 p=argparse.ArgumentParser(description=__doc__);p.add_argument('--output',required=True,type=Path);a=p.parse_args();test=TaskAnalysisAcceptance(a.output)
 try:passed=test.run()
 except Exception as e:passed=False;print('::error title=Task model canary::'+json.dumps({'error_class':type(e).__name__,'raw_details_included':False}))
 raise SystemExit(0 if passed else 1)
