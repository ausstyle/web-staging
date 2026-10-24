#!/usr/bin/env python3
"""Protected source-attested certification of one existing memory operation.

Every tools/call uses a normal isolated customer session. Management administers
fixtures, the short-lived readiness record, and independent readback only. This
never changes catalogue flags, standing grants, Owner roles or production traffic.
"""
import argparse,datetime,hashlib,json,os,re,subprocess,urllib.error,urllib.request,uuid
from pathlib import Path
from customer_service_acceptance import Acceptance,passing_read
from engineering_runtime import BASE
from release_gcp_admin_read import Installer
from release_web_canary import ROOT,original_sources
from release_memory_private_correction import schema

MANIFEST=ROOT/'docs/sandy-engineering/evaluations/memory-correction-adapter-release.json'
def digest(value):return hashlib.sha256(value).hexdigest()
class PrivateMemoryAcceptance(Acceptance):
 def __init__(self,output):
  super().__init__(output);self.readiness=None;self.change=None;self.retired=False
  self.facts=[str(uuid.uuid4()) for _ in range(3)];self.nonce=uuid.uuid4().hex
  self.prefix='memory_cert_'+self.nonce+':'
  self.report.update(kind='private_source_attested_normal_customer_MCP',global_exposure_changed=False,standing_delegations_changed=False,Owner_authority_claimed=False,model_turns=0,normal_customer_operations_only=True)
 def source(self):
  manifest=json.loads(MANIFEST.read_text());admin=Installer(self.output.parent/'management-source-readback');observed={}
  for slug,expected in manifest['functions'].items():
   meta=json.loads(admin.api('GET','/functions/'+slug));body=admin.api('GET','/functions/'+slug+'/body');files=original_sources(body)
   self.check(slug+'_actual_candidate_source',meta.get('status')=='ACTIVE' and meta.get('verify_jwt') is expected['verify_jwt'] and {n:digest(v) for n,v in files.items()}==expected['candidate_files'])
   observed[slug]={'deployment_id':'zmqlyygzqoidkcwdysok_'+meta['id']+'_'+str(meta['version']),'bundle_sha256':digest(body),'version':meta['version']}
  schema(admin,manifest,True)
  self.check('classification_repair_independently_installed',admin.sql("SELECT version FROM supabase_migrations.schema_migrations WHERE version='20261024004210'",True)==[{'version':'20261024004210'}])
  self.report['installed_source']=observed;self.save();return manifest,observed
 def prepare(self):
  if os.environ.get('GITHUB_ACTIONS')!='true' or os.environ.get('GITHUB_REF')!='refs/heads/main':raise RuntimeError('protected_main_project_release_required')
  sha=os.environ.get('GITHUB_SHA','')
  if not re.fullmatch('[a-f0-9]{40}',sha) or subprocess.check_output(['git','rev-parse','HEAD'],cwd=ROOT,text=True).strip()!=sha:raise RuntimeError('committed_project_release_source_required')
  manifest,source=self.source()
  if subprocess.check_output(['git','show',sha+':'+str(MANIFEST.relative_to(ROOT))],cwd=ROOT)!=MANIFEST.read_bytes():raise RuntimeError('committed_source_manifest_required')
  self.report['source_commit']=sha;super().prepare();q=self.r._quote;fixture=self.fixtures[0]
  for i,fact in enumerate(self.facts):
   self.r._sql('INSERT INTO public.email_ai_profile_facts(id,customer_id,category,fact_key,fact_value,confidence,status,last_observed_at) VALUES('+','.join(q(v) for v in [fact,fixture['customer'],'other','private_certification:'+self.nonce+':'+str(i),'old fixture '+str(i),'explicit','active'])+',clock_timestamp())')
  self.readiness=str(uuid.uuid4());expires=(datetime.datetime.now(datetime.timezone.utc)+datetime.timedelta(minutes=15)).isoformat()
  metadata={'kind':'runtime_private_certification','schema_version':1,'operation':'memory.fact_correct','fixture_user_id':fixture['user'],'fixture_customer_id':fixture['customer'],'release_commit':sha,'api_bundle_sha256':source['sandy-operation-api']['bundle_sha256'],'api_deployment_id':source['sandy-operation-api']['deployment_id'],'contract_sha256':manifest['private_readiness']['contract_sha256'],'idempotency_prefix':self.prefix,'fact_ids':self.facts,'max_mutations':3,'budget_units':0,'expires_at':expires}
  # Proposed engineering tracking is not an Owner approval or delegation. The
  # independent protected project release supplies only rollout-quality custody.
  rows=self.r._sql("INSERT INTO public.sandy_engineering_changes(title,problem,expected_behavior,change_purpose,feature_improvement,scope,regression_rules,acceptance_criteria,risk,requested_by,idempotency_key,status) SELECT 'Certify existing private memory correction','Global unverified operation must stay unpublished during certification','Exact fresh fixture only, normal Auth and original customer rights remain mandatory','SANDY-ENG-0006 protected certification','Actual MCP transaction and independent DB readback','[\"sandy-operation-api\",\"sandy-api-mcp\"]','[\"No global flags or Owner/standing grant changes\"]','[\"Positive, rejected, replayed and revoked normal-customer MCP requests\"]','normal',i.user_id,'memory-private-'||gen_random_uuid()::text,'proposed' FROM public.sandy_engineering_test_identities i JOIN auth.users u ON u.id=i.user_id WHERE u.email='sandy-engineering-test@sandy-ai.internal' AND i.enabled AND i.revoked_at IS NULL RETURNING id")
  if len(rows)!=1:raise RuntimeError('source_tracking_identity_unavailable')
  self.change=str(uuid.UUID(rows[0]['id']))
  rows=self.r._sql('BEGIN;INSERT INTO public.sandy_engineering_artifacts(id,change_id,artifact_type,target,before_ref,after_ref,rollback_strategy,rollback_notes,metadata) VALUES('+','.join(q(v) for v in [self.readiness,self.change,'configuration','memory.fact_correct',manifest['functions']['sandy-operation-api']['before_bundle_sha256'],source['sandy-operation-api']['bundle_sha256'],'manual_review','Retire this quality allowance; preserve Auth, normal record ownership and independent audit.'])+','+q(json.dumps(metadata))+'::jsonb);'
   +"INSERT INTO public.sandy_engineering_change_events(change_id,event_type,actor,detail) SELECT change_id,'memory_private_readiness_installed',NULL,jsonb_build_object('artifact_id',id,'artifact_sha256',encode(sha256(convert_to(to_jsonb(a)::text,'UTF8')),'hex'),'release_commit',metadata->>'release_commit','api_bundle_sha256',metadata->>'api_bundle_sha256','api_deployment_id',metadata->>'api_deployment_id','contract_sha256',metadata->>'contract_sha256') FROM public.sandy_engineering_artifacts a WHERE id="+q(self.readiness)+" RETURNING id;COMMIT;")
  self.report.update(readiness_id=self.readiness,readiness_audit_ids=[x['id'] for x in rows if 'id' in x],readiness_expires_at=expires)
  self.check('protected_readiness_independent_source_event',len(self.r._sql("SELECT e.id FROM public.sandy_engineering_change_events e JOIN public.sandy_engineering_artifacts a ON a.id=(e.detail->>'artifact_id')::uuid WHERE a.id="+q(self.readiness)+" AND e.actor IS NULL AND e.event_type='memory_private_readiness_installed' AND e.detail->>'artifact_sha256'=encode(sha256(convert_to(to_jsonb(a)::text,'UTF8')),'hex')",True))==1)
 def rpc(self,fixture,method,params):
  if not(self.readiness and method=='tools/call' and params.get('name')=='memory.fact_correct'):return super().rpc(fixture,method,params)
  request=urllib.request.Request(BASE+'/functions/v1/sandy-api-mcp',method='POST',headers={'authorization':'Bearer '+fixture['token'],'apikey':self.keys['anon'],'content-type':'application/json','x-sandy-certification-id':self.readiness},data=json.dumps({'jsonrpc':'2.0','id':str(uuid.uuid4()),'method':method,'params':params}).encode())
  try:response=self.r._opener.open(request,timeout=120)
  except urllib.error.HTTPError as error:response=error
  with response:status,raw=response.status,response.read(2500001)
  if len(raw)>2500000:raise RuntimeError('private_MCP_response_limit')
  return status,json.loads(raw)
 def mutation(self,index,value,key):return self.call(self.fixtures[0],'memory.fact_correct',{'id':self.facts[index],'confirm':True,'new_value':value,'idempotency_key':self.prefix+key})
 def receipt(self,mutation_id):
  q=self.r._quote;fixture=self.fixtures[0]
  return self.r._sql('SELECT mutation_id,auth_user_id,customer_id,operation,arguments_sha256,encode(sha256(convert_to(result::text,\'UTF8\')),\'hex\') result_sha256,result FROM public.sandy_customer_mutation_receipts WHERE mutation_id='+q(mutation_id)+' AND auth_user_id='+q(fixture['user'])+' AND customer_id='+q(fixture['customer']),True)
 def retire(self):
  if not self.readiness or not self.change or self.retired:return
  q=self.r._quote
  installed=self.r._sql("SELECT id FROM public.sandy_engineering_change_events WHERE event_type='memory_private_readiness_installed' AND detail->>'artifact_id'="+q(self.readiness),True)
  if not installed:
   self.retired=True;self.report['readiness_never_installed']=True;self.save();return
  self.r._sql("INSERT INTO public.sandy_engineering_change_events(change_id,event_type,actor,detail) VALUES("+q(self.change)+",'memory_private_readiness_revoked',NULL,jsonb_build_object('artifact_id',"+q(self.readiness)+",'reason','Private fixture certification finished or interrupted'))")
  self.retired=True;self.report['readiness_retired']=True;self.save()
 def exercise(self):
  fixture=self.fixtures[0];q=self.r._quote
  first,payload=self.mutation(0,'corrected fixture value','correct')
  self.check('actual_MCP_correction_receipt',passing_read(first,payload) and payload.get('item',{}).get('original_status')=='superseded')
  mutation=payload['mutation_id'];rows=self.receipt(mutation)
  self.check('independent_atomic_provider_receipt',len(rows)==1 and rows[0]['result']==payload and rows[0]['operation']=='memory.fact_correct')
  self.report['verified_mutation_receipts']=[{k:v for k,v in rows[0].items() if k!='result'}]
  readback=self.r._sql('SELECT f.status original_status,n.status corrected_status,n.supersedes_fact_id,r.corrected_value FROM public.email_ai_profile_facts f JOIN public.email_ai_profile_facts n ON n.supersedes_fact_id=f.id JOIN public.sandy_memory_rejected_facts r ON r.original_fact_id=f.id WHERE f.id='+q(self.facts[0])+' AND f.customer_id='+q(fixture['customer']),True)
  self.check('independent_original_action_base_row_readback',len(readback)==1 and readback[0]['original_status']=='superseded' and readback[0]['corrected_status']=='active' and readback[0]['corrected_value']=='corrected fixture value')
  replay,replayed=self.mutation(0,'corrected fixture value','correct');self.check('same_key_replay_no_second_effect',passing_read(replay,replayed) and replayed.get('mutation_id')==mutation and replayed.get('reused') is True)
  conflict,_=self.mutation(0,'different fixture value','correct');self.check('same_key_changed_arguments_denied',conflict.get('api_status')==409 and conflict.get('is_error') is True)
  wrong,_=self.call(self.fixtures[1],'memory.fact_correct',{'id':self.facts[0],'confirm':True,'new_value':'wrong fixture','idempotency_key':self.prefix+'foreign'});self.check('other_normal_fixture_cannot_use_readiness',wrong.get('api_status')==403 and wrong.get('is_error') is True)
  wrong,_=self.call(fixture,'memory.fact_correct',{'id':str(uuid.uuid4()),'confirm':True,'new_value':'out of scope','idempotency_key':self.prefix+'out_of_scope'});self.check('out_of_scope_fact_denied',wrong.get('api_status')==403 and wrong.get('is_error') is True)
  for index,value,key,status in [(1,None,'reject','rejected'),(2,'old fixture 2','unchanged','active')]:
   result,body=self.mutation(index,value,key);self.check('actual_MCP_'+key,passing_read(result,body) and body.get('item',{}).get('status')==status)
   rows=self.receipt(body['mutation_id']);self.check('independent_'+key+'_receipt',len(rows)==1 and rows[0]['result']==body);self.report['verified_mutation_receipts'].append({k:v for k,v in rows[0].items() if k!='result'})
  budget,_=self.mutation(0,'one beyond budget','exhausted');self.check('bounded_mutation_budget_enforced',budget.get('api_status')==429 and budget.get('is_error') is True)
  self.retire();revoked,_=self.mutation(0,'corrected fixture value','correct');self.check('revocation_blocks_even_successful_key_replay',revoked.get('api_status')==403 and revoked.get('is_error') is True)
  flags=self.r._sql("SELECT api_exposed,ai_exposed,verified FROM public.sandy_operation_registry WHERE operation='memory.fact_correct'",True)
  self.check('catalogue_stays_globally_closed_and_unverified',flags==[{'api_exposed':False,'ai_exposed':False,'verified':False}])
 def cleanup(self):
  retirement_error=None
  try:self.retire()
  except Exception as error:retirement_error=type(error).__name__;self.report['cleanup']['readiness_retirement_error']=retirement_error
  q=self.r._quote
  for fixture in self.fixtures:
   if fixture.get('customer'):
    customer=q(fixture['customer']);owned=self.r._sql('SELECT display_name,google_drive_folder_status FROM public.email_customers WHERE id='+customer,True)
    if owned!=[{'display_name':'Isolated Sandy API service acceptance','google_drive_folder_status':'excluded'}]:raise RuntimeError('fixture_cleanup_ownership_not_proved')
    self.r._auth_admin('PUT','users/'+fixture['user'],{'ban_duration':'876000h'})
    self.r._sql('BEGIN;DELETE FROM auth.refresh_tokens WHERE user_id='+q(fixture['user'])+';DELETE FROM auth.sessions WHERE user_id='+q(fixture['user'])+';UPDATE public.sandy_memory_settings SET enabled=false,learning_enabled=false,proactive_enabled=false,updated_at=clock_timestamp() WHERE customer_id='+customer+';DELETE FROM public.email_ai_profile_facts WHERE customer_id='+customer+';DELETE FROM public.sandy_task_pins WHERE customer_id='+customer+';DELETE FROM public.sandy_tasks WHERE customer_id='+customer+';DELETE FROM public.sandy_calendar_events WHERE customer_id='+customer+';DELETE FROM public.sandy_timezone_profiles WHERE customer_id='+customer+';DELETE FROM public.sandy_agenda_access WHERE customer_id='+customer+';DELETE FROM public.sandy_memory_portal_accounts WHERE auth_user_id='+q(fixture['user'])+';COMMIT;')
   # Retain and ban only these newly created fixture Auth records because the
   # original immutable mutation ledger has an Auth FK with ON DELETE CASCADE.
   # Deleting Auth would erase the actual execution receipt. No password saved.
   elif fixture.get('user'):
    self.r._auth_admin('PUT','users/'+fixture['user'],{'ban_duration':'876000h'})
    self.r._sql('BEGIN;DELETE FROM auth.refresh_tokens WHERE user_id='+q(fixture['user'])+';DELETE FROM auth.sessions WHERE user_id='+q(fixture['user'])+';COMMIT;')
  if self.fixtures:
   ids=','.join(q(f['user']) for f in self.fixtures)
   rows=self.r._sql('SELECT (SELECT count(*) FROM auth.sessions WHERE user_id IN('+ids+')) sessions,(SELECT count(*) FROM public.sandy_memory_portal_accounts WHERE auth_user_id IN('+ids+')) portal_accounts,(SELECT count(*) FROM auth.users WHERE id IN('+ids+') AND banned_until>clock_timestamp()) banned_fixtures',True)[0]
   self.report['cleanup'].update(rows,complete=not retirement_error and rows=={'sessions':0,'portal_accounts':0,'banned_fixtures':len(self.fixtures)},immutable_receipts_and_audit_preserved=True,synthetic_Auth_and_customer_rows_retained_for_receipt_FKs=True)
  self.save()
 def run(self):
  try:self.prepare();self.exercise()
  except Exception as error:
   self.report['runner_error']=type(error).__name__
   if isinstance(error,RuntimeError) and re.fullmatch('[A-Za-z0-9_]+',str(error)):self.report['runner_error_code']=str(error)
  finally:
   try:self.cleanup()
   except Exception as error:self.report['cleanup'].update(complete=False,error_class=type(error).__name__)
  self.report['complete']=not self.report.get('runner_error') and all(x['passed'] for x in self.report['checks']) and self.report['cleanup'].get('complete') is True;self.save()
  print('::notice title=Private normal-customer MCP certification::'+json.dumps({'complete':self.report['complete'],'readiness_id':self.readiness,'checks':self.report['checks'],'calls':self.report['calls'],'verified_mutation_receipts':self.report.get('verified_mutation_receipts',[]),'cleanup':self.report['cleanup']}));return self.report['complete']
if __name__=='__main__':
 p=argparse.ArgumentParser(description=__doc__);p.add_argument('--output',required=True,type=Path);a=p.parse_args();raise SystemExit(0 if PrivateMemoryAcceptance(a.output).run() else 1)
