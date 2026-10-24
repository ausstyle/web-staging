"""Source-preserved task-model schema/worker activation; no paid requests or scope grants."""
import argparse,json,os,re,subprocess,uuid
from pathlib import Path
from release_gcp_admin_read import Installer,digest,quote
from release_web_canary import ROOT,Blocked,private_write
import release_runtime_slice as slices
from prepare_task_analysis_model import candidate
MANIFEST=ROOT/'docs/sandy-engineering/evaluations/task-analysis-model-admission.json'
SLICE=ROOT/'docs/sandy-engineering/evaluations/runtime-slices/sandy-task-analysis-worker.json'
VERSION='20261024005200';CAP='task.configuration.extract';SLUG='sandy-task-analysis-worker'
FUNCTIONS={'sandy_task_model_mode':'uuid,uuid','sandy_task_model_admit':'uuid,uuid,text,text','sandy_task_model_finish':'uuid,text,text,text,jsonb,jsonb,integer','sandy_task_model_audit_guard':''}
def load():
 m=json.loads(MANIFEST.read_bytes());s=json.loads(SLICE.read_bytes());sql=(ROOT/m['migration']).read_text()
 if digest(sql.encode())!=m['migration_sha256'] or s['replacements']!=m['candidate_files'] or s['before_files']!=m['before_files'] or s['version']!=m['before_version']:raise Blocked('reviewed_task_model_manifest_changed')
 slices.validate(s)
 return m,s,sql

def invariants(r):
 return r.sql("SELECT c.relname,c.relrowsecurity,c.relforcerowsecurity,c.relacl::text acl,(SELECT jsonb_agg(to_jsonb(p) ORDER BY policyname) FROM pg_policies p WHERE p.schemaname='public' AND p.tablename=c.relname) policies,(SELECT jsonb_agg(pg_get_triggerdef(t.oid) ORDER BY t.tgname) FROM pg_trigger t WHERE t.tgrelid=c.oid AND NOT t.tgisinternal AND t.tgname<>'sandy_task_model_custody') triggers,has_table_privilege('service_role',c.oid,'UPDATE') service_update,has_table_privilege('authenticated',c.oid,'SELECT') customer_read FROM pg_class c WHERE c.oid IN('public.sandy_openai_request_audit'::regclass,'public.sandy_openai_context_policies'::regclass) ORDER BY c.relname",True)
def schema(r,m,sql):
 if r.sql("SELECT statements FROM supabase_migrations.schema_migrations WHERE version='"+VERSION+"'",True)!=[{'statements':[sql]}]:raise Blocked('task_model_migration_history_mismatch')
 for name,args in FUNCTIONS.items():
  body=re.search(r'CREATE FUNCTION public\.'+name+r'\([^;]+?AS \$\$(.*?)\$\$;',sql,re.S)
  if not body:raise Blocked('reviewed_task_model_function_source_missing')
  rows=r.sql("SELECT encode(sha256(convert_to(p.prosrc,'UTF8')),'hex') source,pg_get_userbyid(p.proowner) owner,p.prosecdef,p.proconfig,has_function_privilege('anon',p.oid,'EXECUTE') anon,has_function_privilege('authenticated',p.oid,'EXECUTE') customer,has_function_privilege('service_role',p.oid,'EXECUTE') service FROM pg_proc p WHERE p.oid="+quote('public.'+name+'('+args+')')+'::regprocedure',True)
  if rows!=[{'source':digest(body[1].encode()),'owner':'postgres','prosecdef':name!='sandy_task_model_audit_guard','proconfig':['search_path=pg_catalog, pg_temp'],'anon':False,'customer':False,'service':name!='sandy_task_model_audit_guard'}]:raise Blocked('task_model_source_owner_or_ACL_changed')
 if invariants(r)!=m['database_invariants']:raise Blocked('existing_model_RLS_ACL_policy_or_trigger_changed')
 rows=r.sql("SELECT t.tgenabled,pg_get_triggerdef(t.oid) definition FROM pg_trigger t WHERE t.tgrelid='public.sandy_openai_request_audit'::regclass AND t.tgname='sandy_task_model_custody'",True)
 if len(rows)!=1 or rows[0]['tgenabled']!='O' or 'BEFORE INSERT OR DELETE OR UPDATE' not in rows[0]['definition'] or 'sandy_task_model_audit_guard()' not in rows[0]['definition']:raise Blocked('task_model_custody_trigger_changed')
 return {'migration':VERSION,'schema_source_and_permissions_verified':True}
def committed(m):
 source=os.environ.get('GITHUB_SHA','')
 if os.environ.get('GITHUB_ACTIONS')!='true' or os.environ.get('GITHUB_REF')!='refs/heads/main' or not re.fullmatch('[a-f0-9]{40}',source):raise Blocked('protected_main_release_required')
 paths=[MANIFEST.relative_to(ROOT).as_posix(),SLICE.relative_to(ROOT).as_posix(),m['migration'],'scripts/sandy/release_task_analysis_model.py','scripts/sandy/task_analysis_model_acceptance.py','.github/workflows/sandy-task-analysis-model-validation.yml']+['supabase/functions/'+x for x in m['candidate_files']]
 for path in paths:
  if subprocess.check_output(['git','show',source+':'+path],cwd=ROOT)!=(ROOT/path).read_bytes():raise Blocked('committed_task_model_release_required')
 return source

def install(r,deploy=False):
 m,s,sql=load();slices.inspect(r,s)
 if r.sql("SELECT version FROM supabase_migrations.schema_migrations WHERE version='"+VERSION+"'",True):raise Blocked('schema_already_installed_use_source_resume_or_acceptance_only')
 if invariants(r)!=m['database_invariants']:raise Blocked('model_policy_audit_preimage_changed')
 if not deploy:return {'preflight_passed':True,'installed':False}
 source=committed(m);change=slices.track(r,s,source);holder=r.holder
 r.out.mkdir(parents=True,exist_ok=False,mode=0o700)
 r.sql("DO $$ BEGIN INSERT INTO public.sandy_engineering_component_leases(component,holder,change_id,expected_source_sha256,expires_at) VALUES('"+SLUG+"',"+quote(holder)+",'"+change+"','"+s['body_sha256']+"',clock_timestamp()+interval '10 minutes') ON CONFLICT(component) DO UPDATE SET holder=EXCLUDED.holder,change_id=EXCLUDED.change_id,expected_source_sha256=EXCLUDED.expected_source_sha256,expires_at=EXCLUDED.expires_at WHERE public.sandy_engineering_component_leases.expires_at<=clock_timestamp();IF NOT FOUND THEN RAISE EXCEPTION 'component leased';END IF;END $$")
 dispatched=verified=False
 try:
  slices.inspect(r,s)
  if invariants(r)!=m['database_invariants']:raise Blocked('policy_audit_preimage_changed')
  r.stage='install_disabled_task_model_policy';dispatched=True
  core=sql[sql.index('BEGIN;')+6:sql.rindex('COMMIT;')]
  r.sql('BEGIN;'+core+"INSERT INTO supabase_migrations.schema_migrations(version,statements,name,created_by,idempotency_key) VALUES('"+VERSION+"',ARRAY["+quote(sql)+"],'sandy_task_model_admission','protected_project_management_release','sandy-task-model-v1');COMMIT;")
  result=schema(r,m,sql);verified=True
  r.sql("INSERT INTO public.sandy_engineering_change_events(change_id,event_type,actor,detail) VALUES('"+change+"','task_model_disabled_schema_verified',NULL,"+quote(json.dumps({**result,'source_commit':source,'actor_kind':'project_management_release','policy_enabled':False,'paid_calls':0,'Owner_authority_created':False}))+"::jsonb)")
  return {**result,'tracking_change_id':change,'policy_enabled':False,'provider_execution_verified':False}
 finally:
  if not dispatched or verified:r.sql("DELETE FROM public.sandy_engineering_component_leases WHERE component='"+SLUG+"' AND holder="+quote(holder))
def source_resume(r,deploy=False):
 m,s,sql=load();schema(r,m,sql);slices.inspect(r,s)
 policy=r.sql("SELECT enabled,execution_limits->>'canary_customer_id' canary,execution_limits->>'rollout_stage' stage FROM public.sandy_openai_context_policies WHERE capability='"+CAP+"'",True)
 if policy!=[{'enabled':False,'canary':None,'stage':'legacy_staging'}]:raise Blocked('disabled_unassigned_canary_policy_required')
 if r.sql("SELECT count(*)::int n FROM public.sandy_task_analysis_queue WHERE state='processing'",True)!=[{'n':0}]:raise Blocked('existing_customer_analysis_inflight_wait_without_replay')
 if deploy:committed(m)
 return slices.release(r,s,deploy,SLICE)
def rollback_source(r,preimages):
 m,s,sql=load();committed(m);schema(r,m,sql);slices.inspect(r,s,True)
 body=(preimages/'before.body').read_bytes()
 if digest(body)!=s['body_sha256']:raise Blocked('captured_original_body_required')
 from release_web_canary import original_sources
 files=original_sources(body)
 if {p:digest(v) for p,v in files.items()}!=s['before_files'] or set(files)!={'index.ts'}:raise Blocked('exact_original_flat_source_required')
 if r.sql("SELECT enabled FROM public.sandy_openai_context_policies WHERE capability='"+CAP+"'",True)!=[{'enabled':False}]:raise Blocked('bounded_cohort_active_no_automatic_rollback')
 records=r.sql("SELECT change_id FROM public.sandy_engineering_change_events WHERE event_type='runtime_slice_source_verified' AND detail->>'function'='"+SLUG+"' AND detail->>'source_commit'="+quote(os.environ['GITHUB_SHA'])+' ORDER BY id DESC LIMIT 1',True)
 if len(records)!=1:raise Blocked('reviewed_source_dispatch_receipt_required')
 cid=records[0]['change_id'];holder=r.holder
 # A model's unknown outcome is never an ordinary failed/retryable job. The
 # same protected canary must independently retire every own fixture queue and
 # session before legacy code can return; its immutable reservations remain.
 proof_path=preimages.parent.parent/'task-model-acceptance/receipt.json'
 proof=json.loads(proof_path.read_bytes());cleanup=proof.get('cleanup',{})
 if proof.get('kind')!='normal_customer_governed_task_analysis' or proof.get('source_commit')!=os.environ['GITHUB_SHA'] or proof.get('github_run_id')!=os.environ['GITHUB_RUN_ID'] or cleanup.get('complete') is not True or cleanup.get('refresh_tokens_retired') is not True or proof.get('isolated_cohort_removed') is not True:raise Blocked('retired_own_canary_required_before_legacy_source_rollback')
 customers=[str(uuid.UUID(v)) for v in proof.get('fixture_customer_ids',[])];users=[str(uuid.UUID(v)) for v in proof.get('fixture_user_ids',[])]
 if len(customers)!=2 or len(users)!=2 or len(set(customers))!=2 or len(set(users))!=2:raise Blocked('exact_two_own_canary_fixtures_required')
 cids=','.join(quote(v) for v in customers);uids=','.join(quote(v) for v in users)
 retired=r.sql("SELECT (SELECT count(*) FROM public.email_customers WHERE id IN("+cids+") AND display_name='Isolated Sandy API service acceptance' AND google_drive_folder_status='excluded') isolated_customers,(SELECT count(*) FROM public.sandy_task_analysis_queue WHERE customer_id IN("+cids+")) queue,(SELECT count(*) FROM public.sandy_tasks WHERE customer_id IN("+cids+")) tasks,(SELECT count(*) FROM auth.users WHERE id IN("+uids+")) users,(SELECT count(*) FROM auth.sessions WHERE user_id IN("+uids+")) sessions,(SELECT count(*) FROM auth.refresh_tokens WHERE user_id IN("+uids+")) refresh,(SELECT count(*) FROM public.sandy_memory_portal_accounts WHERE auth_user_id IN("+uids+")) portals",True)
 if retired!=[{'isolated_customers':2,'queue':0,'tasks':0,'users':0,'sessions':0,'refresh':0,'portals':0}]:raise Blocked('own_canary_queue_or_auth_may_replay_do_not_restore_legacy')
 if r.sql("SELECT enabled,execution_limits?'canary_customer_id' canary FROM public.sandy_openai_context_policies WHERE capability='"+CAP+"'",True)!=[{'enabled':False,'canary':False}]:raise Blocked('retired_canary_policy_required_before_rollback')
 # Lost final callbacks are labelled unknown, never failed or succeeded. Their
 # reservation/result history is retained, and no task/queue survives to replay.
 r.sql("UPDATE public.sandy_openai_request_audit SET execution_status='unknown',meta=meta||jsonb_build_object('result',NULL,'response_sha256',NULL,'model_metrics',NULL,'gateway_http_status',NULL,'finished_at',clock_timestamp()) WHERE capability='"+CAP+"' AND customer_id IN("+cids+") AND execution_status='started' AND meta->>'source_sha256'="+quote(m['candidate_files']['sandy-task-analysis-worker/index.ts']))
 r.sql("DO $$ BEGIN INSERT INTO public.sandy_engineering_component_leases(component,holder,change_id,expected_source_sha256,expires_at) VALUES('"+SLUG+"',"+quote(holder)+","+quote(cid)+",'"+digest(body)+"',clock_timestamp()+interval '10 minutes') ON CONFLICT(component) DO UPDATE SET holder=EXCLUDED.holder,change_id=EXCLUDED.change_id,expected_source_sha256=EXCLUDED.expected_source_sha256,expires_at=EXCLUDED.expires_at WHERE public.sandy_engineering_component_leases.expires_at<=clock_timestamp();IF NOT FOUND THEN RAISE EXCEPTION 'component leased';END IF;END $$")
 dispatched=verified=False
 try:
  slices.inspect(r,s,True);boundary='sandy-task-rollback-'+uuid.uuid4().hex
  meta={'name':SLUG,'entrypoint_path':'index.ts','verify_jwt':s['verify_jwt']}
  parts=[('--'+boundary+'\r\nContent-Disposition: form-data; name="metadata"\r\nContent-Type: application/json\r\n\r\n').encode()+json.dumps(meta).encode()+b'\r\n']
  parts.append(('--'+boundary+'\r\nContent-Disposition: form-data; name="file"; filename="index.ts"\r\nContent-Type: application/typescript\r\n\r\n').encode()+files['index.ts']+b'\r\n');parts.append(('--'+boundary+'--\r\n').encode())
  r.stage='restore_exact_original_task_worker';dispatched=True;r.api('POST','/functions/deploy?slug='+SLUG,b''.join(parts),'multipart/form-data; boundary='+boundary)
  restored=json.loads(r.api('GET','/functions/'+SLUG));actual=original_sources(r.api('GET','/functions/'+SLUG+'/body'))
  if restored.get('version')!=s['version']+2 or restored.get('verify_jwt')!=s['verify_jwt'] or {p:digest(v) for p,v in actual.items()}!=s['before_files']:raise Blocked('task_worker_rollback_unknown_reconcile_no_retry')
  verified=True
  detail={'original_source_restored':True,'version':restored['version'],'all_audits_and_additive_schema_retained':True,'provider_execution_verified':False,'own_fixture_queue_and_Auth_retired':True,'unknown_receipts_preserved_without_replay':True}
  r.sql("INSERT INTO public.sandy_engineering_change_events(change_id,event_type,actor,detail) VALUES("+quote(cid)+",'task_model_canary_source_rollback_verified',NULL,"+quote(json.dumps(detail))+"::jsonb)")
  return detail
 finally:
  if not dispatched or verified:r.sql("DELETE FROM public.sandy_engineering_component_leases WHERE component='"+SLUG+"' AND holder="+quote(holder))

def rollout(r,accepted_run):
 import tempfile
 m,s,sql=load();committed(m);schema(r,m,sql);slices.inspect(r,s,True)
 if not re.fullmatch('[1-9][0-9]{5,20}',accepted_run):raise Blocked('exact_accepted_canary_run_required')
 result=subprocess.run(['gh','api','repos/ausstyle/web-staging/actions/runs/'+accepted_run],capture_output=True,text=True)
 if result.returncode:raise Blocked('accepted_canary_run_unavailable')
 run=json.loads(result.stdout)
 if run.get('conclusion')!='success' or run.get('event')!='workflow_dispatch' or run.get('path')!='.github/workflows/sandy-task-analysis-model-validation.yml' or run.get('head_branch')!='main':raise Blocked('successful_protected_task_model_canary_required')
 with tempfile.TemporaryDirectory(prefix='sandy-task-model-proof-') as temp:
  result=subprocess.run(['gh','run','download',accepted_run,'--repo','ausstyle/web-staging','--name','task-analysis-model-'+accepted_run,'--dir',temp],capture_output=True,text=True)
  if result.returncode:raise Blocked('immutable_canary_artifact_unavailable')
  found=list(Path(temp).rglob('receipt.json'))
  if len(found)!=1:raise Blocked('single_canary_receipt_artifact_required')
  raw=found[0].read_bytes();proof=json.loads(raw)
 if proof.get('kind')!='normal_customer_governed_task_analysis' or proof.get('complete') is not True or proof.get('cleanup',{}).get('complete') is not True or proof.get('cleanup',{}).get('refresh_tokens_retired') is not True or proof.get('provider_execution_verified') is not True or proof.get('typed_task_configuration_verified') is not True or proof.get('model_turn_budget')!=1:raise Blocked('completed_retired_task_model_canary_required')
 events=r.sql("SELECT change_id,detail FROM public.sandy_engineering_change_events WHERE event_type='task_model_isolated_acceptance_verified' AND detail->>'github_run_id'="+quote(accepted_run),True)
 if len(events)!=1:raise Blocked('independent_task_model_canary_audit_required')
 e=events[0]['detail']
 if e.get('source_commit')!=run['head_sha'] or e.get('report_sha256')!=digest(raw) or e.get('model_receipt_id')!=proof.get('model_receipt_id') or e.get('fixture_retired') is not True or e.get('complete') is not True:raise Blocked('source_bound_canary_audit_artifact_mismatch')
 subprocess.run(['git','merge-base','--is-ancestor',run['head_sha'],os.environ['GITHUB_SHA']],cwd=ROOT,check=True)
 receipts=r.sql("SELECT execution_status,provider_response_id,verified_success,meta->>'source_sha256' source,meta->'model_metrics'->'usage' usage FROM public.sandy_openai_request_audit WHERE capability='"+CAP+"' AND id="+quote(str(uuid.UUID(e['model_receipt_id'])))+' AND customer_id='+quote(str(uuid.UUID(e['fixture_customer_id']))),True)
 entry=m['candidate_files']['sandy-task-analysis-worker/index.ts']
 if len(receipts)!=1 or receipts[0]['execution_status']!='succeeded' or receipts[0]['source']!=entry or receipts[0]['verified_success'] is not False or receipts[0]['provider_response_id']!=proof.get('provider_response_id') or not isinstance(receipts[0]['usage'],dict):raise Blocked('real_model_receipt_readback_required')
 user=quote(str(uuid.UUID(e['fixture_user_id'])))
 if r.sql('SELECT (SELECT count(*) FROM auth.users WHERE id='+user+') users,(SELECT count(*) FROM auth.sessions WHERE user_id='+user+') sessions,(SELECT count(*) FROM auth.refresh_tokens WHERE user_id='+user+') refresh,(SELECT count(*) FROM public.sandy_memory_portal_accounts WHERE auth_user_id='+user+') portals',True)!=[{'users':0,'sessions':0,'refresh':0,'portals':0}]:raise Blocked('canary_auth_retirement_required')
 r.sql("BEGIN;SET LOCAL lock_timeout='2s';SET LOCAL statement_timeout='10s';LOCK TABLE public.sandy_task_analysis_queue IN SHARE MODE;DO $$ BEGIN IF EXISTS(SELECT 1 FROM public.sandy_task_analysis_queue WHERE state='processing') THEN RAISE EXCEPTION 'legacy_customer_analysis_inflight_reconcile_before_rollout';END IF;UPDATE public.sandy_openai_context_policies SET enabled=true,execution_limits=jsonb_set(execution_limits,'{rollout_stage}','\"enforced\"'::jsonb),updated_at=clock_timestamp() WHERE capability='"+CAP+"' AND enabled=false AND execution_limits->>'rollout_stage'='legacy_staging' AND NOT execution_limits?'canary_customer_id' AND execution_limits->>'entrypoint_sha256'="+quote(entry)+";IF NOT FOUND THEN RAISE EXCEPTION 'bounded rollout policy drift';END IF;END $$;INSERT INTO public.sandy_engineering_change_events(change_id,event_type,actor,detail) VALUES("+quote(events[0]['change_id'])+",'task_model_bounded_cohort_enabled',NULL,"+quote(json.dumps({'accepted_run':accepted_run,'source_commit':os.environ['GITHUB_SHA'],'provider_effect_claimed':False,'authority_expanded':False,'hard_output_tokens':512,'customer_requests_daily':100,'unknown_model_cost_NULL':True}))+"::jsonb);COMMIT;")
 observed=r.sql("SELECT enabled,execution_limits->>'rollout_stage' stage FROM public.sandy_openai_context_policies WHERE capability='"+CAP+"'",True)
 if observed!=[{'enabled':True,'stage':'enforced'}]:raise Blocked('bounded_rollout_outcome_unknown_reconcile_no_retry')
 return {'bounded_cohort_enabled':True,'canary_run':accepted_run,'new_paid_requests_in_this_step':0,'authority_expanded':False}

def main():
 p=argparse.ArgumentParser(description=__doc__);p.add_argument('--action',choices=['schema','source','verify','rollout','rollback-source'],default='schema');p.add_argument('--deploy',action='store_true');p.add_argument('--evidence-dir',required=True,type=Path);p.add_argument('--accepted-run');p.add_argument('--preimage-dir',type=Path);a=p.parse_args();r=Installer(a.evidence_dir/'private');report={'passed':False}
 try:
  if a.action=='schema':result=install(r,a.deploy)
  elif a.action=='source':result=source_resume(r,a.deploy)
  elif a.action=='rollback-source':
   if not a.deploy or a.preimage_dir is None:raise Blocked('captured_source_rollback_dispatch_required')
   result=rollback_source(r,a.preimage_dir)
  elif a.action=='rollout':
   if not a.deploy:raise Blocked('explicit_protected_rollout_dispatch_required')
   result=rollout(r,a.accepted_run or '')
  else:
   m,s,sql=load();result=schema(r,m,sql);slices.inspect(r,s,True)
  report.update(result,passed=True)
 except Exception as e:report.update(error=str(e) if isinstance(e,Blocked) else 'task_model_release_failed_or_unknown_reconcile_before_retry',stage=r.stage)
 a.evidence_dir.mkdir(parents=True,exist_ok=True);private_write(a.evidence_dir,'task-model-release.json',json.dumps(report,indent=2).encode());print('::notice title=Task model release::'+json.dumps(report));return 0 if report['passed'] else 1
if __name__=='__main__':raise SystemExit(main())
