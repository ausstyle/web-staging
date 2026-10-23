#!/usr/bin/env python3
"""Source-preserving, schema-only correction repair; never creates consent/grants."""
import argparse,json,os,re,subprocess,uuid
from pathlib import Path
from release_gcp_admin_read import Installer,digest,quote
from release_web_canary import ROOT,Blocked,private_write
VERSION='20261024004000'
MIGRATION='supabase/migrations/'+VERSION+'_sandy_memory_correction_confidence.sql'
SIGNATURE='sandy_private.correct_customer_fact(uuid,uuid,text)'
BEFORE='625992b76d2eedf3d8169f27902e18c39860157c961e0113714f98856ddf3f34'
AFTER='55580a2e2c228ab373a65659d5304da42e36d2425a577eb90bc537f294f84b50'
COMPONENT='sandy-memory-correction'
def function_state(r):
 rows=r.sql("SELECT pg_get_functiondef(oid) definition,encode(sha256(convert_to(prosrc,'UTF8')),'hex') source_sha256,oid,proowner,proacl::text acl,prosecdef,proconfig,has_function_privilege('anon',oid,'EXECUTE') anon_execute,has_function_privilege('authenticated',oid,'EXECUTE') authenticated_execute,has_function_privilege('service_role',oid,'EXECUTE') service_execute FROM pg_proc WHERE oid="+quote(SIGNATURE)+"::regprocedure",True)
 if len(rows)!=1:raise Blocked('memory_correction_function_unavailable')
 s=rows[0]
 if s['prosecdef'] or s['proconfig']!=['search_path=""'] or s['anon_execute'] or s['authenticated_execute'] or not s['service_execute']:raise Blocked('memory_correction_privilege_boundary_changed')
 return s
def preserved_state(r):
 return r.sql("SELECT 'constraint' kind,conname name,pg_get_constraintdef(oid) definition FROM pg_constraint WHERE conrelid='public.email_ai_profile_facts'::regclass UNION ALL SELECT 'trigger',tgname,pg_get_triggerdef(oid)||pg_get_functiondef(tgfoid) FROM pg_trigger WHERE tgrelid='public.email_ai_profile_facts'::regclass AND NOT tgisinternal UNION ALL SELECT 'wrapper','sandy_memory_correct_fact',pg_get_functiondef('public.sandy_memory_correct_fact(uuid,uuid,text)'::regprocedure) ORDER BY kind,name",True)
def verify(r,sql):
 s=function_state(r)
 if s['source_sha256']!=AFTER:raise Blocked('installed_correction_source_mismatch')
 history=r.sql("SELECT statements FROM supabase_migrations.schema_migrations WHERE version='"+VERSION+"'",True)
 if len(history)!=1 or history[0]['statements']!=[sql]:raise Blocked('installed_correction_history_mismatch')
 return {'installed_source_verified':True,'migration':VERSION,'source_sha256':AFTER,'invoker_and_service_only_RPC_preserved':True,'customer_acceptance_verified':False}
def run(r,deploy=False,installed=False):
 sql=(ROOT/MIGRATION).read_text()
 if installed:return verify(r,sql)
 if r.sql("SELECT version FROM supabase_migrations.schema_migrations WHERE version='"+VERSION+"'",True):raise Blocked('already_installed_reconcile_no_replay')
 before=function_state(r);invariants=preserved_state(r)
 if before['source_sha256']!=BEFORE:raise Blocked('reviewed_memory_correction_source_changed')
 if not deploy:return {'preflight_passed':True,'migration_sha256':digest(sql.encode()),'deployed':False}
 if os.environ.get('GITHUB_ACTIONS')!='true' or os.environ.get('GITHUB_REF')!='refs/heads/main':raise Blocked('protected_main_release_required')
 sha=os.environ.get('GITHUB_SHA','')
 if not re.fullmatch('[a-f0-9]{40}',sha):raise Blocked('source_commit_required')
 for path in [MIGRATION,'scripts/sandy/release_memory_correction.py','.github/workflows/sandy-memory-correction-release.yml']:
  if subprocess.check_output(['git','show',sha+':'+path],cwd=ROOT)!=(ROOT/path).read_bytes():raise Blocked('committed_release_source_required')
 r.out.mkdir(parents=True,exist_ok=False,mode=0o700)
 private_write(r.out,'before-function.json',json.dumps(before).encode());private_write(r.out,'before-definition.sql',before['definition'].encode());private_write(r.out,'preserved-schema.json',json.dumps(invariants).encode());private_write(r.out,'migration.sql',sql.encode())
 private_write(r.out,'rollback-guidance.txt',b'Before-definition.sql is the exact preimage, but restoring it reintroduces the known correction constraint failure. Prefer forward repair. Never undo already committed customer corrections, delete audit, or restore consent/grants. Reconcile installed source/history before any recovery.\n')
 holder='memory-correction-'+uuid.uuid4().hex
 change=r.sql("INSERT INTO public.sandy_engineering_changes(title,problem,expected_behavior,change_purpose,feature_improvement,scope,regression_rules,acceptance_criteria,risk,requested_by,idempotency_key,status) SELECT 'Repair existing memory correction confidence domain','Changed-value customer correction violates existing confidence constraint','Existing normal customer correction succeeds atomically without changing authorization','SANDY-ENG-0006 source-pinned repair','Preserve supersession and rejection provenance','[\"sandy-memory-centre\"]','[\"No grants, consent, customer rewrites or Edge redeployment\"]','[\"Exact function source and ACL readback, then normal authenticated fixture acceptance\"]','normal',i.user_id,'memory-correction-install-'||gen_random_uuid()::text,'proposed' FROM public.sandy_engineering_test_identities i JOIN auth.users u ON u.id=i.user_id WHERE u.email='sandy-engineering-test@sandy-ai.internal' AND i.enabled AND i.revoked_at IS NULL RETURNING id")
 if len(change)!=1:raise Blocked('engineering_tracking_identity_unavailable')
 cid=str(uuid.UUID(change[0]['id']))
 r.sql(f"DO $$ BEGIN INSERT INTO public.sandy_engineering_component_leases(component,holder,change_id,expected_source_sha256,expires_at) VALUES('{COMPONENT}','{holder}','{cid}','{BEFORE}',clock_timestamp()+interval '10 minutes') ON CONFLICT(component) DO UPDATE SET holder=EXCLUDED.holder,change_id=EXCLUDED.change_id,expected_source_sha256=EXCLUDED.expected_source_sha256,expires_at=EXCLUDED.expires_at,acquired_at=clock_timestamp() WHERE public.sandy_engineering_component_leases.expires_at<=clock_timestamp();IF NOT FOUND THEN RAISE EXCEPTION 'component already leased';END IF;END $$")
 try:
  if function_state(r)!=before or preserved_state(r)!=invariants:raise Blocked('memory_correction_or_schema_changed_before_dispatch')
  core=sql[sql.index('BEGIN;')+6:sql.rindex('COMMIT;')]
  r.stage='install_source_pinned_memory_correction'
  r.sql("BEGIN;SELECT pg_advisory_xact_lock(hashtext('sandy-memory-correction-install'));"+core+"INSERT INTO supabase_migrations.schema_migrations(version,statements,name,created_by,idempotency_key) VALUES('"+VERSION+"',ARRAY["+quote(sql)+"],'sandy_memory_correction_confidence','protected_github_management_release','sandy-memory-correction-v1');COMMIT;")
  result=verify(r,sql);after=function_state(r)
  if {k:v for k,v in after.items() if k not in ['definition','source_sha256']}!={k:v for k,v in before.items() if k not in ['definition','source_sha256']} or preserved_state(r)!=invariants:raise Blocked('memory_correction_preservation_readback_failed')
  result.update({'source_commit':sha,'tracking_change_id':cid,'rollback_preimage_captured':True,'existing_schema_and_wrapper_preserved':True})
  r.sql(f"INSERT INTO public.sandy_engineering_change_events(change_id,event_type,actor,detail) VALUES('{cid}','memory_correction_source_installed',NULL,{quote(json.dumps(result))}::jsonb)")
  return result
 finally:r.sql(f"DELETE FROM public.sandy_engineering_component_leases WHERE component='{COMPONENT}' AND holder='{holder}'")
if __name__=='__main__':
 p=argparse.ArgumentParser();g=p.add_mutually_exclusive_group();g.add_argument('--deploy',action='store_true');g.add_argument('--verify-installed',action='store_true');p.add_argument('--evidence-dir',required=True);a=p.parse_args();root=Path(a.evidence_dir);r=Installer(root/'source-preservation');report={'passed':False,'consent_changes':0,'grants_changed':0,'Edge_deployments':0,'customer_records_changed':0}
 try:report.update(run(r,a.deploy,a.verify_installed),passed=True)
 except Exception as e:report.update(error=str(e) if isinstance(e,Blocked) else 'release_failed_or_unknown_reconcile_before_retry',stage=r.stage,last_management_request=r.last_request)
 root.mkdir(parents=True,exist_ok=True);private_write(root,'memory-correction-release.json',json.dumps(report,indent=2).encode());print('::notice title=Memory correction release::'+json.dumps(report));raise SystemExit(0 if report['passed'] else 1)
