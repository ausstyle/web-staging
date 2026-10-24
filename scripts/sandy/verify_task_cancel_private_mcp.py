#!/usr/bin/env python3
"""Source-attested isolated cancellation via normal customer MCP; no model work.

Requires the reviewed 04300 release and an exact independently read-back release
manifest. Does not install functions, migrations, public flags or permissions.
"""
import argparse,datetime,json,os,re,subprocess,urllib.error,urllib.request,uuid
from pathlib import Path
from customer_service_acceptance import Acceptance,passing_read
from verify_memory_private_mcp import PrivateMemoryAcceptance,digest
from release_gcp_admin_read import Installer
from release_web_canary import ROOT,original_sources
from engineering_runtime import BASE
CONTRACT='d14a757c041f6f6658d50093aa6de841f8300da480a7db76e6936dd8f44ddedf'
class PrivateTaskCancellationAcceptance(PrivateMemoryAcceptance):
 def __init__(self,output,manifest):
  super().__init__(output);self.manifest=manifest.resolve();self.prefix='task_cancel_cert_'+self.nonce+':'
  self.report.update(kind='private_normal_customer_MCP_task_cancellation',model_or_connected_provider_work_requested=False,mission_lifecycle_accepted=False)
 def prepare(self):
  if os.environ.get('GITHUB_ACTIONS')!='true' or os.environ.get('GITHUB_REF')!='refs/heads/main':raise RuntimeError('protected_main_project_release_required')
  sha=os.environ.get('GITHUB_SHA','')
  if not re.fullmatch('[a-f0-9]{40}',sha) or subprocess.check_output(['git','rev-parse','HEAD'],cwd=ROOT,text=True).strip()!=sha:raise RuntimeError('committed_project_release_source_required')
  if subprocess.check_output(['git','show',sha+':'+str(self.manifest.relative_to(ROOT))],cwd=ROOT)!=self.manifest.read_bytes():raise RuntimeError('committed_source_manifest_required')
  manifest=json.loads(self.manifest.read_text());admin=Installer(self.output.parent/'task-cancel-source-readback');observed={}
  for slug in ['sandy-operation-api','sandy-api-mcp']:
   expected=manifest['functions'][slug];meta=json.loads(admin.api('GET','/functions/'+slug));body=admin.api('GET','/functions/'+slug+'/body');files=original_sources(body)
   self.check(slug+'_actual_candidate_source',meta.get('status')=='ACTIVE' and meta.get('verify_jwt') is expected['verify_jwt'] and {n:digest(v) for n,v in files.items()}==expected['candidate_files'])
   observed[slug]={'deployment_id':'zmqlyygzqoidkcwdysok_'+meta['id']+'_'+str(meta['version']),'bundle_sha256':digest(body),'version':meta['version']}
  self.report.update(installed_source=observed,source_commit=sha);self.save()
  schema=self.r._sql("SELECT to_regprocedure('public.sandy_api_task_cancel_private_readiness(uuid,text,text,uuid,text)') IS NOT NULL ready",True)
  if schema!=[{'ready':True}]:raise RuntimeError('reviewed_task_cancel_profile_not_installed')
  Acceptance.prepare(self);q=self.r._quote;fixture=self.fixtures[0]
  self.readiness=str(uuid.uuid4());expires=(datetime.datetime.now(datetime.timezone.utc)+datetime.timedelta(minutes=15)).isoformat()
  metadata={'kind':'runtime_task_cancel_certification','schema_version':1,'operation':'tasks.update','fixture_user_id':fixture['user'],'fixture_customer_id':fixture['customer'],'release_commit':sha,'api_bundle_sha256':observed['sandy-operation-api']['bundle_sha256'],'api_deployment_id':observed['sandy-operation-api']['deployment_id'],'contract_sha256':CONTRACT,'idempotency_prefix':self.prefix,'task_ids':[fixture['task']],'max_mutations':1,'budget_units':0,'expires_at':expires}
  rows=self.r._sql("INSERT INTO public.sandy_engineering_changes(title,problem,expected_behavior,change_purpose,feature_improvement,scope,regression_rules,acceptance_criteria,risk,requested_by,idempotency_key,status) SELECT 'Certify isolated customer task cancellation','Unverified writes must remain gated','Normal customer cancellation and receipt only','SANDY Runtime protected certification','One exact own fixture cancellation','[\"sandy-operation-api\",\"sandy-api-mcp\"]','[\"No global flag, grant or Owner changes\"]','[\"Actual MCP receipt, replay, isolation and revocation\"]','normal',i.user_id,'task-cancel-private-'||gen_random_uuid()::text,'proposed' FROM public.sandy_engineering_test_identities i JOIN auth.users u ON u.id=i.user_id WHERE u.email='sandy-engineering-test@sandy-ai.internal' AND i.enabled AND i.revoked_at IS NULL RETURNING id")
  if len(rows)!=1:raise RuntimeError('source_tracking_identity_unavailable')
  self.change=str(uuid.UUID(rows[0]['id']))
  self.r._sql('BEGIN;INSERT INTO public.sandy_engineering_artifacts(id,change_id,artifact_type,target,rollback_strategy,metadata) VALUES('+','.join(q(v) for v in [self.readiness,self.change,'configuration','tasks.update','manual_review'])+','+q(json.dumps(metadata))+"::jsonb);INSERT INTO public.sandy_engineering_change_events(change_id,event_type,actor,detail) SELECT change_id,'task_cancel_private_readiness_installed',NULL,jsonb_build_object('artifact_id',id,'artifact_sha256',encode(sha256(convert_to(to_jsonb(a)::text,'UTF8')),'hex'),'release_commit',metadata->>'release_commit','api_bundle_sha256',metadata->>'api_bundle_sha256','api_deployment_id',metadata->>'api_deployment_id','contract_sha256',metadata->>'contract_sha256') FROM public.sandy_engineering_artifacts a WHERE id="+q(self.readiness)+';COMMIT;')
  self.report.update(readiness_id=self.readiness,readiness_expires_at=expires,readiness_api_deployment_id=observed['sandy-operation-api']['deployment_id'])
  evidence=self.r._sql("SELECT e.id FROM public.sandy_engineering_change_events e JOIN public.sandy_engineering_artifacts a ON a.id=(e.detail->>'artifact_id')::uuid WHERE a.id="+q(self.readiness)+" AND e.actor IS NULL AND e.event_type='task_cancel_private_readiness_installed' AND e.detail->>'artifact_sha256'=encode(sha256(convert_to(to_jsonb(a)::text,'UTF8')),'hex')",True)
  self.check('independent_protected_readiness_readback',len(evidence)==1)
  self.report['readiness_audit_ids']=[e['id'] for e in evidence];self.save()
 def rpc(self,fixture,method,params):
  if not(self.readiness and method=='tools/call' and params.get('name')=='tasks.update'):return Acceptance.rpc(self,fixture,method,params)
  request=urllib.request.Request(BASE+'/functions/v1/sandy-api-mcp',method='POST',headers={'authorization':'Bearer '+fixture['token'],'apikey':self.keys['anon'],'content-type':'application/json','x-sandy-certification-id':self.readiness},data=json.dumps({'jsonrpc':'2.0','id':str(uuid.uuid4()),'method':method,'params':params}).encode())
  try:response=self.r._opener.open(request,timeout=120)
  except urllib.error.HTTPError as error:response=error
  with response:status,raw=response.status,response.read(2500001)
  if len(raw)>2500000:raise RuntimeError('private_MCP_response_limit')
  return status,json.loads(raw)
 def retire(self):
  if not self.readiness or not self.change or self.retired:return
  q=self.r._quote
  exists=self.r._sql('SELECT id FROM public.sandy_engineering_artifacts WHERE id='+q(self.readiness)+' AND change_id='+q(self.change),True)
  if exists:self.r._sql("INSERT INTO public.sandy_engineering_change_events(change_id,event_type,actor,detail) VALUES("+q(self.change)+",'task_cancel_private_readiness_revoked',NULL,jsonb_build_object('artifact_id',"+q(self.readiness)+",'reason','Isolated certification retired'))")
  self.retired=True;self.report['readiness_retired']=True;self.save()
 def exercise(self):
  f=self.fixtures[0];args={'id':f['task'],'status':'cancelled','idempotency_key':self.prefix+'cancel'}
  for fields in [{**args,'status':'completed'},{**args,'title':'not permitted'}]:
   denied,_=self.call(f,'tasks.update',fields);self.check('non_cancellation_fields_denied_'+str(len(self.report['checks'])),denied.get('api_status')==403 and denied.get('is_error') is True)
  result,payload=self.call(f,'tasks.update',args)
  self.check('actual_normal_customer_MCP_cancellation',passing_read(result,payload) and payload.get('item',{}).get('status')=='cancelled')
  rows=self.receipt(payload['mutation_id']);self.check('independent_atomic_cancellation_receipt',len(rows)==1 and rows[0]['result']==payload and rows[0]['operation']=='tasks.update')
  self.report['verified_mutation_receipts']=[{k:v for k,v in rows[0].items() if k!='result'}]
  q=self.r._quote;rows=self.r._sql('SELECT status FROM public.sandy_tasks WHERE id='+q(f['task'])+' AND customer_id='+q(f['customer']),True);self.check('independent_cancelled_row_readback',rows==[{'status':'cancelled'}])
  replay,body=self.call(f,'tasks.update',args);self.check('idempotent_replay_same_receipt',passing_read(replay,body) and body.get('mutation_id')==payload['mutation_id'] and body.get('reused') is True)
  denied,_=self.call(self.fixtures[1],'tasks.update',args);self.check('foreign_customer_denied',denied.get('api_status')==403 and denied.get('is_error') is True)
  self.retire();denied,_=self.call(f,'tasks.update',args);self.check('revocation_blocks_replay',denied.get('api_status')==403 and denied.get('is_error') is True)
  flags=self.r._sql("SELECT verified FROM public.sandy_operation_registry WHERE operation='tasks.update'",True);self.check('no_global_verification_claim',flags==[{'verified':False}])
if __name__=='__main__':
 p=argparse.ArgumentParser(description=__doc__);p.add_argument('--output',required=True,type=Path);p.add_argument('--manifest',required=True,type=Path);a=p.parse_args();raise SystemExit(0 if PrivateTaskCancellationAcceptance(a.output,a.manifest).run() else 1)
