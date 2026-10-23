#!/usr/bin/env python3
"""Activate only the existing read-only durable dispatcher. No new job/grant,
Owner session, provider write, function redeploy or customer message is created.
Reuse the existing private worker service transport, encrypted in Vault.
"""
import argparse,json,os,re,subprocess,uuid,urllib.request,urllib.error
from pathlib import Path
from release_gcp_admin_read import Installer,digest,quote
from release_web_canary import ROOT,Blocked,original_sources,private_write,NoRedirect
VERSION='20261024003000'
MIGRATION='supabase/migrations/'+VERSION+'_sandy_durable_dispatch_schedule.sql'
COMPONENT='sandy-orchestration-dispatch-schedule'
GUARD_VERSION='20261024003100'
GUARD_MIGRATION='supabase/migrations/'+GUARD_VERSION+'_sandy_dispatch_transport_guard.sql'
SLUG='sandy-orchestration-api'
SOURCE_FILES={'sandy-orchestration-api/index.ts':'fcfcf09aa2f5cd2b76e95efdc1dd70213170dcceda9db395e21ef0c81e10de54','_shared/sandy_api_protocol.ts':'c34abd69fcd244c21f307149468eff436ad653ca26a8d5b1e2f60d9d6d4f43a8'}

def inspect_worker(r):
 metadata=json.loads(r.api('GET','/functions/'+SLUG));body=r.api('GET','/functions/'+SLUG+'/body')
 if metadata.get('version')!=15 or metadata.get('status')!='ACTIVE' or metadata.get('verify_jwt') is not True or {p:digest(v) for p,v in original_sources(body).items()}!=SOURCE_FILES:
  raise Blocked('existing_durable_dispatcher_source_or_configuration_drift')
 return metadata,body

def private_rpc(r,key,action,body):
 # Existing service-role key is private worker transport/configuration only.
 # It is never used as a customer/Owner bearer or persisted in artifacts/SQL.
 url='https://zmqlyygzqoidkcwdysok.supabase.co/rest/v1/rpc/'+action
 req=urllib.request.Request(url,method='POST',data=json.dumps(body).encode(),headers={'authorization':'Bearer '+key,'apikey':key,'content-type':'application/json'})
 try:
  with urllib.request.build_opener(NoRedirect()).open(req,timeout=30) as response:
   raw=response.read(32769)
   if len(raw)>32768:raise Blocked('private_binding_response_limit')
   value=json.loads(raw)
 except urllib.error.HTTPError as error:
  # Read only fixed PostgREST classification, never message/details/hint or a
  # reflected request body. A 404 is conclusive non-dispatch, not a write retry.
  classification=''
  try:
   code=json.loads(error.read(32768)).get('code','')
   if isinstance(code,str) and re.fullmatch('PGRST[0-9]{3}',code):classification='_'+code
  except Exception:pass
  raise Blocked('private_binding_http_'+str(error.code)+classification) from None
 except Blocked:raise
 except Exception:raise Blocked('private_binding_outcome_unknown_reconcile_no_retry') from None
 if value!={'ok':True,'bound':True,'authority_expanded':False}:raise Blocked('private_binding_not_verified')


def verify(r,sql,require_active=True):
 inspect_worker(r)
 history=r.sql("SELECT statements FROM supabase_migrations.schema_migrations WHERE version='"+VERSION+"'",True)
 if history!=[{'statements':[sql]}]:raise Blocked('installed_migration_source_mismatch')
 expected=dict(re.findall(r'CREATE FUNCTION public\.(\w+)\([^$]*?AS \$\$(.*?)\$\$;',sql,re.S))
 guard=r.sql("SELECT statements FROM supabase_migrations.schema_migrations WHERE version='"+GUARD_VERSION+"'",True)
 if guard:
  guard_sql=(ROOT/GUARD_MIGRATION).read_text()
  if guard!=[{'statements':[guard_sql]}]:raise Blocked('installed_transport_guard_source_mismatch')
  reviewed=dict(re.findall(r'CREATE (?:OR REPLACE )?FUNCTION public\.(\w+)\([^$]*?AS \$\$(.*?)\$\$;',guard_sql,re.S))
  expected.update(reviewed)
 actual=r.sql("SELECT proname,prosrc,prosecdef,proconfig FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND proname IN ("+','.join(quote(name) for name in expected)+")",True)
 if len(actual)!=len(expected) or any(x['prosrc']!=expected[x['proname']] or not x['prosecdef'] or x['proconfig']!=['search_path=pg_catalog, pg_temp'] for x in actual):raise Blocked('installed_private_worker_source_mismatch')
 state=r.sql("SELECT enabled,transport_secret_id IS NOT NULL credential_bound,release_change_id,source_commit FROM public.sandy_orch_worker_control WHERE singleton",True)
 if len(state)!=1:raise Blocked('private_timer_configuration_missing')
 if require_active and (not state[0]['enabled'] or not state[0]['credential_bound'] or not state[0]['release_change_id'] or not re.fullmatch('[a-f0-9]{40}',str(state[0]['source_commit']))):raise Blocked('private_timer_not_activated')
 cron=r.sql("SELECT jobname,schedule,command,active FROM cron.job WHERE jobname='sandy-orchestration-dispatch-every-minute'",True)
 if cron!=[{'jobname':'sandy-orchestration-dispatch-every-minute','schedule':'* * * * *','command':'SELECT public.sandy_orch_worker_tick()','active':True}]:raise Blocked('fixed_credential_free_schedule_mismatch')
 acl=r.sql("SELECT has_function_privilege('anon','public.sandy_orch_worker_tick()','EXECUTE') anon_tick,has_function_privilege('authenticated','public.sandy_orch_worker_tick()','EXECUTE') user_tick,has_function_privilege('service_role','public.sandy_orch_worker_tick()','EXECUTE') service_tick,has_table_privilege('service_role','public.sandy_orch_worker_control','UPDATE') service_configuration,has_function_privilege('authenticated','public.sandy_orch_worker_bind_transport(text)','EXECUTE') user_credential_binding",True)
 if acl!=[{'anon_tick':False,'user_tick':False,'service_tick':False,'service_configuration':False,'user_credential_binding':False}]:raise Blocked('private_timer_privileges_mismatch')
 return {'installed_source_verified':True,'timer_active':state[0]['enabled'],'transport_bound':state[0]['credential_bound'],'transport_guard_verified':bool(guard),'cadence':'every minute','existing_worker_version':15,'migration':VERSION,'tracking_change_id':state[0]['release_change_id'],'source_commit':state[0]['source_commit'],'jobs_created':0,'authority_expanded':False,'provider_execution_verified':False,'programme_code_execution_verified':False}

def install_transport_guard(r):
 if os.environ.get('GITHUB_ACTIONS')!='true' or os.environ.get('GITHUB_REF')!='refs/heads/main':raise Blocked('protected_main_release_required')
 source=os.environ.get('GITHUB_SHA','');sql=(ROOT/GUARD_MIGRATION).read_text();base_sql=(ROOT/MIGRATION).read_text()
 if not re.fullmatch('[a-f0-9]{40}',source) or subprocess.check_output(['git','show',source+':'+GUARD_MIGRATION],cwd=ROOT)!=sql.encode():raise Blocked('committed_transport_guard_required')
 if r.sql("SELECT version FROM supabase_migrations.schema_migrations WHERE version='"+GUARD_VERSION+"'",True):raise Blocked('transport_guard_already_installed_reconcile_no_replay')
 state=verify(r,base_sql,require_active=False)
 if state['timer_active'] or state['transport_bound']:raise Blocked('reviewed_disabled_unbound_timer_required')
 tracking='740a56f8-a582-419f-a4d9-9440af5e57f9';holder='durable-transport-guard-'+uuid.uuid4().hex
 r.sql(f"DO $$ BEGIN INSERT INTO public.sandy_engineering_component_leases(component,holder,change_id,expected_source_sha256,expires_at) VALUES('{COMPONENT}','{holder}','{tracking}','{digest(sql.encode())}',clock_timestamp()+interval '10 minutes') ON CONFLICT(component) DO UPDATE SET holder=EXCLUDED.holder,change_id=EXCLUDED.change_id,expected_source_sha256=EXCLUDED.expected_source_sha256,expires_at=EXCLUDED.expires_at,acquired_at=clock_timestamp() WHERE public.sandy_engineering_component_leases.expires_at<=clock_timestamp();IF NOT FOUND THEN RAISE EXCEPTION 'component already leased';END IF;END $$")
 try:
  core=sql[sql.index('BEGIN;')+6:sql.rindex('COMMIT;')]
  r.stage='install_additive_transport_guard'
  r.sql("BEGIN;SELECT pg_advisory_xact_lock(hashtext('sandy-durable-transport-guard-install'));"+core+"INSERT INTO supabase_migrations.schema_migrations(version,statements,name,created_by,idempotency_key) VALUES('"+GUARD_VERSION+"',ARRAY["+quote(sql)+"],'sandy_dispatch_transport_guard','protected_github_management_release','sandy-durable-transport-guard-v2');INSERT INTO public.sandy_engineering_change_events(change_id,event_type,actor,detail) VALUES('"+tracking+"','durable_dispatch_transport_guard_installed',NULL,jsonb_build_object('source_commit','"+source+"','authority_expanded',false,'credential_bound',false));COMMIT;")
  result=verify(r,base_sql,require_active=False)
  return {**result,'migration':GUARD_VERSION,'transport_guard_installed':True,'original_migration_reapplied':False,'authority_expanded':False,'Edge_deployments':0}
 finally:r.sql(f"DELETE FROM public.sandy_engineering_component_leases WHERE component='{COMPONENT}' AND holder='{holder}'")


def configure_existing(r,sql,change,source,bind_transport=True):
 # Configuration-only recovery after an installation has already committed.
 # Never replay the migration, create a new tracking record or redeploy code.
 state=verify(r,sql,require_active=False)
 if state['timer_active']:raise Blocked('timer_already_active_reconcile_no_replay')
 change=str(uuid.UUID(change))
 tracking=r.sql("SELECT id FROM public.sandy_engineering_changes WHERE id="+quote(change)+" AND title='Activate existing durable read dispatcher timer' AND status='proposed' AND expected_behavior='Resume only already admitted fenced read jobs; no authority or job creation' AND requested_by IN(SELECT user_id FROM public.sandy_engineering_test_identities)",True)
 if tracking!=[{'id':change}]:raise Blocked('existing_exact_timer_tracking_record_required')
 if bind_transport:
  # The exposed Management API legacy key is not necessarily the actual private
  # worker environment binding. Never substitute or overwrite that credential.
  raise Blocked('trusted_runtime_transport_binding_required')
 if state.get('transport_guard_verified') is not True:raise Blocked('independent_transport_guard_required')
 if state.get('transport_bound') is not True:raise Blocked('trusted_runtime_transport_not_bound')
 # Only the trusted existing OIDC bridge may establish and test this transport;
 # activation reads non-secret state and never exports or rotates credentials.
 verified=r.sql("SELECT EXISTS(SELECT 1 FROM public.sandy_engineering_change_events WHERE change_id="+quote(change)+" AND event_type='durable_dispatch_private_transport_verified' AND detail->>'worker_http_status'='200' AND detail->>'jobs_claimed'='0' AND detail->>'worker_source_sha256'='"+SOURCE_FILES[SLUG+'/index.ts']+"') verified",True)
 if verified!=[{'verified':True}]:raise Blocked('independent_trusted_runtime_transport_evidence_required')
 inspect_worker(r)
 r.stage='activate_existing_dispatcher_timer'
 r.sql(f"BEGIN;UPDATE public.sandy_orch_worker_control SET enabled=true,release_change_id='{change}',source_commit='{source}',updated_at=clock_timestamp() WHERE singleton AND NOT enabled;INSERT INTO public.sandy_engineering_change_events(change_id,event_type,actor,detail) VALUES('{change}','durable_dispatch_timer_activated',NULL,jsonb_build_object('source_commit','{source}','existing_worker_version',15,'jobs_created',0,'authority_expanded',false,'provider_execution_verified',false));COMMIT;")
 return {**verify(r,sql),'configuration_only':True,'migrations_reapplied':False,'Edge_deployments':0}


def resume_configuration(r,change,activate_bound=False):
 if os.environ.get('GITHUB_ACTIONS')!='true' or os.environ.get('GITHUB_REF')!='refs/heads/main':raise Blocked('protected_main_release_required')
 source=os.environ.get('GITHUB_SHA','');sql=(ROOT/MIGRATION).read_text()
 if not re.fullmatch('[a-f0-9]{40}',source) or subprocess.check_output(['git','show',source+':'+MIGRATION],cwd=ROOT)!=sql.encode():raise Blocked('committed_migration_required')
 return configure_existing(r,sql,change,source,bind_transport=not activate_bound)


def run(r,deploy=False,installed=False):
 sql=(ROOT/MIGRATION).read_text()
 if installed:return verify(r,sql)
 meta,body=inspect_worker(r)
 if r.sql("SELECT version FROM supabase_migrations.schema_migrations WHERE version='"+VERSION+"'",True) or r.sql("SELECT to_regclass('public.sandy_orch_worker_control') IS NOT NULL exists",True)!=[{'exists':False}] or r.sql("SELECT jobid FROM cron.job WHERE jobname='sandy-orchestration-dispatch-every-minute'",True):raise Blocked('already_installed_reconcile_no_replay')
 if not deploy:return {'preflight_passed':True,'existing_worker_version':15,'migration_sha256':digest(sql.encode()),'Edge_deployments':0}
 if os.environ.get('GITHUB_ACTIONS')!='true' or os.environ.get('GITHUB_REF')!='refs/heads/main':raise Blocked('protected_main_release_required')
 source=os.environ.get('GITHUB_SHA','')
 if not re.fullmatch('[a-f0-9]{40}',source) or subprocess.check_output(['git','show',source+':'+MIGRATION],cwd=ROOT)!=sql.encode():raise Blocked('committed_migration_required')
 r.out.mkdir(parents=True,exist_ok=False,mode=0o700)
 private_write(r.out,'worker-before.body',body);private_write(r.out,'worker-before.json',json.dumps(meta).encode())
 private_write(r.out,'rollback-disable.sql',b"BEGIN; UPDATE public.sandy_orch_worker_control SET enabled=false,updated_at=clock_timestamp() WHERE singleton; SELECT cron.alter_job(jobid,active:=false) FROM cron.job WHERE jobname='sandy-orchestration-dispatch-every-minute'; COMMIT;\n-- Retain queue, admissions, receipts and audit history. Never replay provider effects.\n")
 tracking=r.sql("INSERT INTO public.sandy_engineering_changes(title,problem,expected_behavior,change_purpose,feature_improvement,scope,regression_rules,acceptance_criteria,risk,requested_by,idempotency_key,status) SELECT 'Activate existing durable read dispatcher timer','Accepted read plans have no recurring dispatcher','Resume only already admitted fenced read jobs; no authority or job creation','SANDY-ENG-0004 supported durable continuation','Use existing queue and dispatcher with private credential-free cron','[\"sandy-orchestration-api\"]','[\"No grants, Owner sessions, provider writes or customer messages\"]','[\"Source, ACL, cron and live empty-queue readback\"]','normal',i.user_id,'durable-dispatch-install-'||gen_random_uuid()::text,'proposed' FROM public.sandy_engineering_test_identities i JOIN auth.users u ON u.id=i.user_id WHERE u.email='sandy-engineering-test@sandy-ai.internal' RETURNING id")
 cid=str(uuid.UUID(tracking[0]['id']));holder='durable-dispatch-'+uuid.uuid4().hex
 r.sql(f"DO $$ BEGIN INSERT INTO public.sandy_engineering_component_leases(component,holder,change_id,expected_source_sha256,expires_at) VALUES('{COMPONENT}','{holder}','{cid}','{digest(sql.encode())}',clock_timestamp()+interval '10 minutes') ON CONFLICT(component) DO UPDATE SET holder=EXCLUDED.holder,change_id=EXCLUDED.change_id,expected_source_sha256=EXCLUDED.expected_source_sha256,expires_at=EXCLUDED.expires_at,acquired_at=clock_timestamp() WHERE public.sandy_engineering_component_leases.expires_at<=clock_timestamp();IF NOT FOUND THEN RAISE EXCEPTION 'component already leased';END IF;END $$")
 try:
  inspect_worker(r)
  core=sql[sql.index('BEGIN;')+6:sql.rindex('COMMIT;')]
  r.stage='install_disabled_timer'
  r.sql("BEGIN;SELECT pg_advisory_xact_lock(hashtext('sandy-durable-dispatch-install'));"+core+"INSERT INTO supabase_migrations.schema_migrations(version,statements,name,created_by,idempotency_key) VALUES('"+VERSION+"',ARRAY["+quote(sql)+"],'sandy_durable_dispatch_schedule','protected_github_management_release','sandy-durable-dispatch-v1');COMMIT;")
  return {**configure_existing(r,sql,cid,source),'rollback_prepared':True}
 finally:r.sql(f"DELETE FROM public.sandy_engineering_component_leases WHERE component='{COMPONENT}' AND holder='{holder}'")

def accept_empty_queue(r):
 # Read back the real trusted-runtime HTTP acceptance, never substitute the
 # unrelated Management API's legacy service binding or export runtime keys.
 result=verify(r,(ROOT/MIGRATION).read_text())
 pending=r.sql("SELECT count(*) count FROM public.sandy_orch_jobs WHERE state IN('queued','leased','running')",True)
 if pending!=[{'count':0}]:raise Blocked('empty_queue_acceptance_requires_no_active_customer_or_owner_jobs')
 evidence=r.sql("SELECT id,created_at FROM public.sandy_engineering_change_events WHERE change_id="+quote(result['tracking_change_id'])+" AND event_type='durable_dispatch_private_transport_verified' AND detail->>'worker_http_status'='200' AND detail->>'jobs_claimed'='0' AND detail->>'worker_source_sha256'='"+SOURCE_FILES[SLUG+'/index.ts']+"' ORDER BY created_at DESC LIMIT 1",True)
 if len(evidence)!=1:raise Blocked('independent_trusted_runtime_transport_evidence_required')
 tick=r.sql("SELECT public.sandy_orch_worker_tick() result")
 if tick!=[{'result':{'ok':True,'state':'idle','provider_executed':False}}]:raise Blocked('idle_timer_acceptance_not_verified')
 return {'private_worker_transport_verified':True,'private_worker_http_status':200,'transport_evidence_event':evidence[0]['id'],'transport_evidence_at':evidence[0]['created_at'],'runtime_key_exported':False,'jobs_claimed':0,'idle_timer_verified':True,'provider_execution_verified':False,'programme_code_execution_verified':False}

if __name__=='__main__':
 p=argparse.ArgumentParser();g=p.add_mutually_exclusive_group();g.add_argument('--deploy',action='store_true');g.add_argument('--install-transport-guard',action='store_true');g.add_argument('--verify-installed',action='store_true');g.add_argument('--accept-empty-queue',action='store_true');g.add_argument('--resume-configuration',metavar='EXISTING_CHANGE_UUID');g.add_argument('--activate-bound-transport',metavar='EXISTING_CHANGE_UUID');p.add_argument('--evidence-dir',required=True);a=p.parse_args();root=Path(a.evidence_dir);r=Installer(root/'source-preservation');report={'passed':False,'grant_changes':0,'provider_writes':0,'Edge_deployments':0}
 try:
  result=install_transport_guard(r) if a.install_transport_guard else resume_configuration(r,a.activate_bound_transport,activate_bound=True) if a.activate_bound_transport else resume_configuration(r,a.resume_configuration) if a.resume_configuration else accept_empty_queue(r) if a.accept_empty_queue else run(r,a.deploy,a.verify_installed)
  report.update(result,passed=True)
 except Exception as e:report.update(error=str(e) if isinstance(e,Blocked) else 'release_failed_or_unknown_reconcile_before_retry',stage=r.stage,last_management_request=r.last_request)
 root.mkdir(parents=True,exist_ok=True);private_write(root,'durable-dispatch-release.json',json.dumps(report,indent=2).encode());print('::notice title=Durable dispatcher timer release::'+json.dumps(report));raise SystemExit(0 if report['passed'] else 1)
