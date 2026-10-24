#!/usr/bin/env python3
"""Add receipt-aware recovery to the existing queue. No provider/Owner dispatch."""
import argparse,json,os,re,subprocess,uuid
from pathlib import Path
from release_gcp_admin_read import Installer,digest,quote
from release_web_canary import ROOT,Blocked,private_write
from release_runtime_slice import inspect
VERSION='20261024005300'
MIGRATION='supabase/migrations/'+VERSION+'_sandy_known_read_receipt_recovery.sql'
FIXTURE='scripts/sandy/fixtures/orchestration-claim-workload-v1.sql'
SIGNATURE='public.sandy_orch_claim(uuid,integer,integer)'
PREIMAGE='a035a008fce93bfcb3876a7f4adc202e7a8863d0429b5ca4515c12d8bd361910'
HELPER='public.sandy_orch_known_expired_workload_read(uuid)'
MANIFEST='docs/sandy-engineering/evaluations/runtime-slices/sandy-orchestration-api.json'
COMPONENT='sandy-orchestration-api'
WORKER_VERSION=18  # Secret propagation revision; exact accepted API17 module hashes are unchanged.

def inspect_worker(r):
 m=json.loads((ROOT/MANIFEST).read_bytes());m['version']=WORKER_VERSION-1
 return inspect(r,m,True)

def candidate(sql):
 original=(ROOT/FIXTURE).read_text().split('$function$')[1]
 if digest(original.encode())!=PREIMAGE:raise Blocked('reviewed_claim_preimage_changed')
 old=re.search(r'old:=\$old\$(.*?)\$old\$;',sql,re.S)
 new=re.search(r'replacement:=\$replacement\$(.*?)\$replacement\$;',sql,re.S)
 if not old or not new or original.count(old[1])!=1 or original.count('until_time timestamptz;')!=1:raise Blocked('reviewed_claim_patch_anchors_required')
 return original.replace('until_time timestamptz;','until_time timestamptz; known_receipt jsonb;',1).replace(old[1],new[1],1)

def function(r):
 rows=r.sql("SELECT prosrc,prosecdef,proconfig,proacl::text acl,pg_get_functiondef(oid) definition FROM pg_proc WHERE oid="+quote(SIGNATURE)+"::regprocedure",True)
 if len(rows)!=1:raise Blocked('existing_workload_claim_required')
 return rows[0]

def verify(r,sql):
 history=r.sql("SELECT statements FROM supabase_migrations.schema_migrations WHERE version='"+VERSION+"'",True)
 row=function(r)
 helper=r.sql("SELECT prosrc,prosecdef,proconfig,has_function_privilege('anon',oid,'EXECUTE') anon,has_function_privilege('authenticated',oid,'EXECUTE') authenticated,has_function_privilege('service_role',oid,'EXECUTE') service FROM pg_proc WHERE oid="+quote(HELPER)+"::regprocedure",True)
 expected=re.search(r'CREATE FUNCTION public.sandy_orch_known_expired_workload_read.*?AS \$\$(.*?)\$\$;',sql,re.S)[1]
 if history!=[{'statements':[sql]}] or row['prosrc']!=candidate(sql) or not row['prosecdef'] or row['proconfig']!=['search_path=pg_catalog, pg_temp'] or len(helper)!=1 or helper[0]!={'prosrc':expected,'prosecdef':True,'proconfig':['search_path=pg_catalog, pg_temp'],'anon':False,'authenticated':False,'service':False}:raise Blocked('known_read_recovery_source_or_permissions_mismatch')
 return {'migration':VERSION,'installed_source_verified':True,'known_success_prevents_automatic_replay':True,'missing_output_requires_reconciliation':True,'provider_operations':0,'Edge_deployments':0,'functional_acceptance_passed':False}

def run(r,deploy=False,installed=False):
 sql=(ROOT/MIGRATION).read_text();after=candidate(sql)
 if installed:return verify(r,sql)
 metadata,body,_=inspect_worker(r)
 before=function(r)
 if digest(before['prosrc'].encode())!=PREIMAGE or not before['prosecdef'] or before['proconfig']!=['search_path=pg_catalog, pg_temp']:raise Blocked('existing_claim_source_changed')
 if r.sql("SELECT version FROM supabase_migrations.schema_migrations WHERE version='"+VERSION+"'",True):raise Blocked('recovery_guard_already_installed_reconcile_no_replay')
 if not deploy:return {'preflight_passed':True,'API_version':metadata['version'],'claim_preimage_sha256':PREIMAGE,'claim_candidate_sha256':digest(after.encode()),'provider_operations':0}
 source=os.environ.get('GITHUB_SHA','')
 if os.environ.get('GITHUB_ACTIONS')!='true' or os.environ.get('GITHUB_REF')!='refs/heads/main' or not re.fullmatch('[a-f0-9]{40}',source):raise Blocked('protected_committed_main_release_required')
 for path in [MIGRATION,FIXTURE,MANIFEST,'scripts/sandy/release_known_read_recovery.py','scripts/sandy/verify_known_read_recovery.py','.github/workflows/sandy-delegated-durable-read-release.yml']:
  if subprocess.check_output(['git','show',source+':'+path],cwd=ROOT)!=(ROOT/path).read_bytes():raise Blocked('committed_recovery_source_required')
 r.out.mkdir(parents=True,exist_ok=False,mode=0o700)
 private_write(r.out,'claim-before.json',json.dumps(before).encode());private_write(r.out,'unchanged-worker.json',json.dumps(metadata).encode());private_write(r.out,'unchanged-worker.body',body)
 rollback="BEGIN;DO $$ BEGIN IF (SELECT encode(sha256(convert_to(prosrc,'UTF8')),'hex') FROM pg_proc WHERE oid='"+SIGNATURE+"'::regprocedure) IS DISTINCT FROM '"+digest(after.encode())+"' THEN RAISE EXCEPTION 'current_recovery_source_changed';END IF;END $$;\n"+before['definition']+";\nDROP FUNCTION "+HELPER+";COMMIT;\n-- Preserve all queue, provider, attempt and audit history. Never replay provider effects.\n"
 private_write(r.out,'rollback-claim.sql',rollback.encode())
 tracking=r.sql("INSERT INTO public.sandy_engineering_changes(title,problem,expected_behavior,change_purpose,feature_improvement,scope,regression_rules,acceptance_criteria,risk,requested_by,idempotency_key,status) SELECT 'Reconcile canonical provider evidence before durable read retry','An expired lease can replay an already observed provider read when durable completion was lost','Retain bound evidence without replay or fabricated durable output','SANDY-ENG-0004 durable recovery','Known provider success requires output reconciliation rather than an automatic duplicate read','[\"sandy-orchestration-api\"]','[\"No Owner substitution, grant, quota, mutation retry or provider request\"]','[\"Exact claim/ACL preservation and expired canonical read fault injection\"]','normal',i.user_id,'known-read-recovery-'||gen_random_uuid()::text,'proposed' FROM public.sandy_engineering_test_identities i JOIN auth.users u ON u.id=i.user_id WHERE u.email='sandy-engineering-test@sandy-ai.internal' RETURNING id")
 cid=str(uuid.UUID(tracking[0]['id']));holder='known-read-recovery-'+uuid.uuid4().hex
 r.sql(f"DO $$ BEGIN INSERT INTO public.sandy_engineering_component_leases(component,holder,change_id,expected_source_sha256,expires_at) VALUES('{COMPONENT}','{holder}','{cid}','{PREIMAGE}',clock_timestamp()+interval '10 minutes') ON CONFLICT(component) DO UPDATE SET holder=EXCLUDED.holder,change_id=EXCLUDED.change_id,expected_source_sha256=EXCLUDED.expected_source_sha256,expires_at=EXCLUDED.expires_at,acquired_at=clock_timestamp() WHERE public.sandy_engineering_component_leases.expires_at<=clock_timestamp();IF NOT FOUND THEN RAISE EXCEPTION 'component already leased';END IF;END $$")
 dispatched=verified=False
 try:
  if function(r)!=before:raise Blocked('claim_changed_before_install')
  inspect_worker(r)
  core=sql[sql.index('BEGIN;')+6:sql.rindex('COMMIT;')];dispatched=True;r.stage='install_known_read_receipt_recovery'
  r.sql(f"BEGIN;DO $$ BEGIN PERFORM 1 FROM public.sandy_engineering_component_leases WHERE component='{COMPONENT}' AND holder='{holder}' AND change_id='{cid}' AND expires_at>clock_timestamp() FOR UPDATE;IF NOT FOUND THEN RAISE EXCEPTION 'recovery_lease_lost';END IF;END $$;"+core+"INSERT INTO supabase_migrations.schema_migrations(version,statements,name,created_by,idempotency_key) VALUES('"+VERSION+"',ARRAY["+quote(sql)+"],'sandy_known_read_receipt_recovery','protected_github_management_release','known-read-recovery-v1');COMMIT;")
  result=verify(r,sql)
  if function(r)['acl']!=before['acl']:raise Blocked('claim_permissions_changed')
  result.update(source_commit=source,tracking_change_id=cid,API_version=metadata['version'],existing_claim_permissions_preserved=True)
  r.sql(f"INSERT INTO public.sandy_engineering_change_events(change_id,event_type,actor,detail) VALUES('{cid}','known_read_receipt_recovery_installed',NULL,{quote(json.dumps(result))}::jsonb)")
  verified=True;return result
 finally:
  if not dispatched or verified:r.sql(f"DELETE FROM public.sandy_engineering_component_leases WHERE component='{COMPONENT}' AND holder='{holder}'")

if __name__=='__main__':
 p=argparse.ArgumentParser();g=p.add_mutually_exclusive_group();g.add_argument('--deploy',action='store_true');g.add_argument('--verify-installed',action='store_true');p.add_argument('--evidence-dir',type=Path,required=True);a=p.parse_args();r=Installer(a.evidence_dir/'source-preservation');report={'passed':False,'provider_operations':0,'grant_changes':0,'Edge_deployments':0}
 try:report.update(run(r,a.deploy,a.verify_installed),passed=True)
 except Exception as e:report.update(error=str(e) if isinstance(e,Blocked) else 'recovery_installation_failed_or_unknown_reconcile_before_retry',stage=r.stage,last_management_request=r.last_request)
 a.evidence_dir.mkdir(parents=True,exist_ok=True);private_write(a.evidence_dir,'known-read-recovery.json',json.dumps(report,indent=2).encode());print('::notice title=Known read recovery::'+json.dumps(report));raise SystemExit(0 if report['passed'] else 1)
