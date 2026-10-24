#!/usr/bin/env python3
"""Source-preserving activation of normal engineering workload durable reads.
No standing grant, Owner identity, provider write, catalogue expansion or new queue.
"""
import argparse,json,os,re,subprocess,uuid
from pathlib import Path
from release_gcp_admin_read import Installer,digest,quote
from release_web_canary import ROOT,Blocked,original_sources,private_write
from release_durable_dispatch_schedule import inspect_worker,SOURCE_FILES
SLUG='sandy-orchestration-api';VERSION='20261024003200'
MIGRATION='supabase/migrations/'+VERSION+'_sandy_delegated_durable_reads.sql'
NEW_MODULE=SLUG+'/workload_reads.ts'
SIGNATURES=['sandy_orch_workload_snapshot(text)','sandy_orch_workload_job_current(uuid)','sandy_orch_admit_workload_read(text,text,text,timestamptz)','sandy_orch_resolve_workload_dispatch(uuid,uuid,uuid)','sandy_orch_workload_receipt_matches(uuid,uuid,uuid)','sandy_orch_workload_job(uuid,boolean)']

def candidate(before):
 files=dict(before);entry=SLUG+'/index.ts';source=files[entry].decode()
 anchor='      let body: ObjectValue | undefined, httpStatus: number | null = null;'
 if source.count(anchor)!=1 or NEW_MODULE in files:raise Blocked('reviewed_existing_dispatcher_anchor_required')
 source='import { runWorkloadRead } from "./workload_reads.ts";\n'+source.replace(anchor,'      if (claim.principal_kind === "engineering_workload") return await runWorkloadRead(dependencies, claim, workerId);\n'+anchor)
 reviewed=(ROOT/'supabase/functions'/entry).read_bytes()
 if reviewed!=source.encode():raise Blocked('candidate_entry_not_exact_preserving_patch')
 files[entry]=reviewed;files[NEW_MODULE]=(ROOT/'supabase/functions'/NEW_MODULE).read_bytes();return files

def before_state(r):
 return r.sql("SELECT g.admin_read_revision,g.admin_read_policy,g.iap_repair_revision,g.iap_repair_policy,d.version canary_revision,d.policy canary_policy FROM public.sandy_engineering_control_grants g JOIN public.sandy_engineering_standing_delegations d ON d.identity_user_id=g.identity_user_id",True)

def verify(r,sql):
 history=r.sql("SELECT statements FROM supabase_migrations.schema_migrations WHERE version='"+VERSION+"'",True)
 if history!=[{'statements':[sql]}]:raise Blocked('installed_delegated_migration_source_mismatch')
 metadata=json.loads(r.api('GET','/functions/'+SLUG));files=original_sources(r.api('GET','/functions/'+SLUG+'/body'))
 expected={**SOURCE_FILES,SLUG+'/index.ts':digest((ROOT/'supabase/functions'/SLUG/'index.ts').read_bytes()),NEW_MODULE:digest((ROOT/'supabase/functions'/NEW_MODULE).read_bytes())}
 if metadata.get('status')!='ACTIVE' or metadata.get('verify_jwt') is not True or metadata.get('version',0)<=15 or {p:digest(v) for p,v in files.items()}!=expected:raise Blocked('deployed_workload_dispatcher_source_mismatch')
 expected_rpc=dict(re.findall(r'CREATE FUNCTION public\.(\w+)\([^$]*?AS \$\$(.*?)\$\$;',sql,re.S))
 actual=r.sql("SELECT proname,prosrc,prosecdef,proconfig FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND proname IN("+','.join(quote(name) for name in expected_rpc)+")",True)
 if len(actual)!=len(expected_rpc) or any(row['prosrc']!=expected_rpc[row['proname']] or not row['prosecdef'] or row['proconfig']!=['search_path=pg_catalog, pg_temp'] for row in actual):raise Blocked('deployed_workload_RPC_source_mismatch')
 original=(ROOT/'supabase/migrations/20261020231000_sandy_durable_orchestration.sql').read_text()
 expected_queue={name:re.search(r'CREATE FUNCTION public\.'+name+r'\(.*?AS \$\$(.*?)\$\$;',original,re.S).group(1) for name in ['sandy_orch_claim','sandy_orch_finish']}
 expected_queue['sandy_orch_claim']=expected_queue['sandy_orch_claim'].replace('IF NOT public.sandy_orch_owner(record_row.actor_id) THEN','IF NOT public.sandy_orch_workload_job_current(record_row.id) THEN').replace("'lease_until',until_time));","'lease_until',until_time,'principal_kind',(SELECT principal_kind FROM public.sandy_orch_jobs WHERE id=record_row.id)));")
 expected_queue['sandy_orch_finish']=expected_queue['sandy_orch_finish'].replace("admission->>'actor_id' IS DISTINCT FROM job.actor_id::text","(admission->>'actor_id' IS DISTINCT FROM job.actor_id::text AND NOT public.sandy_orch_workload_receipt_matches(job.id,p_execution_admission_id,p_dispatch_id))")
 expected_queue['sandy_orch_finish']=expected_queue['sandy_orch_finish'].replace(' -- This migration is additive and may precede the shared execution policy.'," IF job.principal_kind='engineering_workload' AND p_outcome='succeeded' AND p_execution_admission_id IS NULL THEN\n  RETURN jsonb_build_object('ok',false,'error','execution_admission_required','http_status',409);\n END IF;\n -- This migration is additive and may precede the shared execution policy.")
 queue=r.sql("SELECT proname,prosrc FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND proname IN('sandy_orch_claim','sandy_orch_finish')",True)
 if len(queue)!=2 or any(row['prosrc']!=expected_queue[row['proname']] for row in queue):raise Blocked('existing_queue_RPC_preserving_patch_mismatch')
 acl=r.sql("SELECT has_function_privilege('service_role','public.sandy_orch_admit_workload_read(text,text,text,timestamptz)','EXECUTE') service_admission,has_function_privilege('anon','public.sandy_orch_admit_workload_read(text,text,text,timestamptz)','EXECUTE') anonymous_admission,has_function_privilege('authenticated','public.sandy_orch_admit_workload_read(text,text,text,timestamptz)','EXECUTE') workload_admission,has_function_privilege('authenticated','public.sandy_orch_resolve_workload_dispatch(uuid,uuid,uuid)','EXECUTE') public_claim,has_function_privilege('service_role','public.sandy_orch_resolve_workload_dispatch(uuid,uuid,uuid)','EXECUTE') private_claim",True)
 if acl!=[{'service_admission':False,'anonymous_admission':False,'workload_admission':True,'public_claim':False,'private_claim':True}]:raise Blocked('deployed_workload_RPC_privileges_mismatch')
 return {'installed_source_verified':True,'function':SLUG,'version':metadata['version'],'migration':VERSION,'all_modules_verified':True,'Owner_identity_substitution':False,'provider_execution_verified':False}

def run(r,deploy=False,installed=False):
 sql=(ROOT/MIGRATION).read_text()
 if installed:return verify(r,sql)
 metadata,body=inspect_worker(r);original=original_sources(body);files=candidate(original)
 if r.sql("SELECT version FROM supabase_migrations.schema_migrations WHERE version='"+VERSION+"'",True):raise Blocked('delegated_migration_already_installed_reconcile_no_replay')
 timer=r.sql("SELECT enabled,transport_secret_id IS NOT NULL credential_bound FROM public.sandy_orch_worker_control WHERE singleton",True)
 if timer!=[{'enabled':True,'credential_bound':True}]:raise Blocked('verified_existing_timer_must_be_active_before_workload_release')
 state=before_state(r)
 if len(state)!=1 or state[0]['admin_read_revision']!=1 or state[0]['canary_revision']!=6:raise Blocked('existing_grants_changed_reconcile_before_release')
 if not deploy:return {'source_preservation_preflight_passed':True,'prior_version':15,'candidate_modules':{p:digest(v) for p,v in files.items()},'migration_sha256':digest(sql.encode())}
 if os.environ.get('GITHUB_ACTIONS')!='true' or os.environ.get('GITHUB_REF')!='refs/heads/main':raise Blocked('protected_main_release_required')
 source=os.environ.get('GITHUB_SHA','')
 if not re.fullmatch('[a-f0-9]{40}',source):raise Blocked('committed_source_required')
 for name,value in {MIGRATION:sql.encode(),'supabase/functions/'+SLUG+'/index.ts':files[SLUG+'/index.ts'],'supabase/functions/'+NEW_MODULE:files[NEW_MODULE]}.items():
  if subprocess.check_output(['git','show',source+':'+name],cwd=ROOT)!=value:raise Blocked('immutable_release_source_mismatch')
 r.out.mkdir(parents=True,exist_ok=False,mode=0o700);private_write(r.out,'worker-before.body',body);private_write(r.out,'worker-before.json',json.dumps(metadata).encode());private_write(r.out,'preserved-grants.json',json.dumps(state).encode())
 rpc_before=r.sql("SELECT proname,pg_get_functiondef(p.oid) definition FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND proname IN('sandy_orch_claim','sandy_orch_finish')",True);private_write(r.out,'queue-RPC-before.json',json.dumps(rpc_before).encode())
 private_write(r.out,'rollback-fence.sql',b"-- First fence/drain new workload dispatch; retain queue, admissions, receipts and effects.\nUPDATE public.sandy_orch_worker_control SET enabled=false WHERE singleton;\nREVOKE ALL ON FUNCTION public.sandy_orch_admit_workload_read(text,text,text,timestamptz) FROM authenticated;\n-- Restore private captured worker/RPC preimages only after current source matches this candidate. Never replay completed provider effects.\n")
 tracking=r.sql("INSERT INTO public.sandy_engineering_changes(title,problem,expected_behavior,change_purpose,feature_improvement,scope,regression_rules,acceptance_criteria,risk,requested_by,idempotency_key,status) SELECT 'Normal workload durable metadata reads','Durable queue only supports Controller Owner admission','Persist read jobs for existing standing engineering identity; renew normal sessions at dispatch through MCP and Sandy API','SANDY-ENG-0004 durable authorised continuation','Reuse queue, scoped policy, real receipts and cancellation without Owner substitution','[\"sandy-orchestration-api\"]','[\"No grant expansion, Owner sessions, provider writes or catalogue growth\"]','[\"Actual queued Github read, receipt readback, idempotency, retirement and cancellation\"]','normal',i.user_id,'delegated-durable-read-'||gen_random_uuid()::text,'proposed' FROM public.sandy_engineering_test_identities i JOIN auth.users u ON u.id=i.user_id WHERE u.email='sandy-engineering-test@sandy-ai.internal' RETURNING id")
 cid=str(uuid.UUID(tracking[0]['id']));holder='delegated-durable-read-'+uuid.uuid4().hex
 r.sql(f"DO $$ BEGIN INSERT INTO public.sandy_engineering_component_leases(component,holder,change_id,expected_source_sha256,expires_at) VALUES('{SLUG}','{holder}','{cid}','{digest(body)}',clock_timestamp()+interval '10 minutes') ON CONFLICT(component) DO UPDATE SET holder=EXCLUDED.holder,change_id=EXCLUDED.change_id,expected_source_sha256=EXCLUDED.expected_source_sha256,expires_at=EXCLUDED.expires_at,acquired_at=clock_timestamp() WHERE public.sandy_engineering_component_leases.expires_at<=clock_timestamp();IF NOT FOUND THEN RAISE EXCEPTION 'component already leased';END IF;END $$")
 try:
  inspect_worker(r)
  if before_state(r)!=state:raise Blocked('existing_grants_changed_before_install')
  core=sql[sql.index('BEGIN;')+6:sql.rindex('COMMIT;')];r.stage='install_additive_workload_queue_boundary'
  r.sql("BEGIN;SELECT pg_advisory_xact_lock(hashtext('sandy-delegated-durable-read-install'));"+core+"INSERT INTO supabase_migrations.schema_migrations(version,statements,name,created_by,idempotency_key) VALUES('"+VERSION+"',ARRAY["+quote(sql)+"],'sandy_delegated_durable_reads','protected_github_management_release','sandy-delegated-durable-reads-v1');COMMIT;")
  r.stage='upload_preserved_orchestration_worker';r.upload(SLUG,files,True)
  result=verify(r,sql)
  if before_state(r)!=state:raise Blocked('prior_grants_changed_reconciliation_required')
  r.sql(f"INSERT INTO public.sandy_engineering_change_events(change_id,event_type,actor,detail) VALUES('{cid}','delegated_durable_read_source_installed',NULL,jsonb_build_object('source_commit','{source}','function_version',{result['version']},'Owner_identity_substitution',false,'provider_writes',0,'grant_changes',0))")
  return {**result,'tracking_change_id':cid,'source_commit':source,'rollback_prepared':True,'existing_grants_preserved':True}
 finally:r.sql(f"DELETE FROM public.sandy_engineering_component_leases WHERE component='{SLUG}' AND holder='{holder}'")

if __name__=='__main__':
 p=argparse.ArgumentParser();g=p.add_mutually_exclusive_group();g.add_argument('--deploy',action='store_true');g.add_argument('--verify-installed',action='store_true');p.add_argument('--evidence-dir',required=True);a=p.parse_args();root=Path(a.evidence_dir);r=Installer(root/'source-preservation');report={'passed':False,'grant_changes':0,'provider_writes':0,'catalogue_entries_added':0}
 try:report.update(run(r,a.deploy,a.verify_installed),passed=True)
 except Exception as e:report.update(error=str(e) if isinstance(e,Blocked) else 'release_failed_or_unknown_reconcile_before_retry',stage=r.stage,last_management_request=r.last_request)
 root.mkdir(parents=True,exist_ok=True);private_write(root,'delegated-durable-release.json',json.dumps(report,indent=2).encode());print('::notice title=Delegated durable read release::'+json.dumps(report));raise SystemExit(0 if report['passed'] else 1)
