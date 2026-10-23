#!/usr/bin/env python3
"""Install independent proposal/Owner authorization boundary. Never establish a grant or call Google."""
import argparse,json,os,re,subprocess,uuid
from pathlib import Path
from release_gcp_admin_read import Installer,digest,quote
from release_web_canary import ROOT,Blocked,private_write
MIGRATION='supabase/migrations/20261024001000_sandy_iap_repair_authorization.sql'
VERSION='20261024001000'
COMPONENT='sandy-iap-repair-authorization'
SIGNATURES=['sandy_iap_repair_template()','sandy_engineering_guard_iap_repair_owner_event()','sandy_engineering_submit_iap_repair_proposal()','sandy_engineering_get_iap_repair_proposal()','sandy_engineering_set_iap_repair_delegation(boolean,timestamptz,integer,uuid)','sandy_engineering_resolve_iap_repair(uuid,uuid,integer)']
def state(r):
 return r.sql("SELECT admin_read_revision,admin_read_policy,(SELECT version FROM public.sandy_engineering_standing_delegations d WHERE d.identity_user_id=g.identity_user_id) canary_revision,encode(extensions.digest(pg_get_functiondef('public.sandy_engineering_guard_owner_delegation_event()'::regprocedure),'sha256'),'hex') read_audit_guard_sha256 FROM public.sandy_engineering_control_grants g",True)
def verify(r,sql):
 history=r.sql("SELECT statements FROM supabase_migrations.schema_migrations WHERE version='"+VERSION+"'",True)
 if len(history)!=1 or history[0]['statements']!=[sql]:raise Blocked('installed_migration_source_mismatch')
 expected=dict(re.findall(r'CREATE FUNCTION public\.(\w+)\([^$]*?AS \$\$(.*?)\$\$;',sql,re.S))
 actual=r.sql("SELECT proname,prosrc,prosecdef,proconfig FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND proname IN ("+','.join(quote(x) for x in expected)+")",True)
 if len(expected)!=6 or len(actual)!=6 or any(x['prosrc']!=expected[x['proname']] or not x['prosecdef'] or x['proconfig']!=['search_path=pg_catalog, pg_temp'] for x in actual):raise Blocked('RPC_source_or_search_path_mismatch')
 acl=r.sql("SELECT has_function_privilege('service_role','public.sandy_engineering_set_iap_repair_delegation(boolean,timestamptz,integer,uuid)','EXECUTE') service_can_grant,has_column_privilege('service_role','public.sandy_engineering_control_grants','iap_repair_policy','UPDATE') service_can_expand,has_function_privilege('authenticated','public.sandy_engineering_set_iap_repair_delegation(boolean,timestamptz,integer,uuid)','EXECUTE') owner_RPC_reachable,has_function_privilege('anon','public.sandy_engineering_submit_iap_repair_proposal()','EXECUTE') anonymous_can_submit,EXISTS(SELECT 1 FROM pg_trigger WHERE tgname='sandy_iap_repair_owner_audit_guard' AND tgenabled='O') audit_guard_enabled",True)
 if acl!=[{'service_can_grant':False,'service_can_expand':False,'owner_rpc_reachable':True,'anonymous_can_submit':False,'audit_guard_enabled':True}]:raise Blocked('independent_authority_privileges_not_verified')
 return {'installed_source_verified':True,'migration':VERSION,'privileges_verified':True}
def run(r,deploy=False,installed=False):
 sql=(ROOT/MIGRATION).read_text()
 if installed:return verify(r,sql)
 if r.sql("SELECT version FROM supabase_migrations.schema_migrations WHERE version='"+VERSION+"'",True):raise Blocked('already_installed_reconcile_no_replay')
 if r.sql("SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name='sandy_engineering_control_grants' AND column_name IN('iap_repair_policy','iap_repair_revision')",True):raise Blocked('existing_policy_columns_reconcile_no_replay')
 before=state(r)
 if len(before)!=1 or before[0]['admin_read_revision']!=1 or before[0]['canary_revision']!=6:raise Blocked('reviewed_existing_state_changed')
 if not deploy:return {'preflight_passed':True,'preserved_state':before,'migration_sha256':digest(sql.encode())}
 if os.environ.get('GITHUB_ACTIONS')!='true' or os.environ.get('GITHUB_REF')!='refs/heads/main':raise Blocked('protected_main_release_required')
 sha=os.environ.get('GITHUB_SHA','')
 if not re.fullmatch('[a-f0-9]{40}',sha) or subprocess.check_output(['git','show',sha+':'+MIGRATION],cwd=ROOT)!=sql.encode():raise Blocked('committed_migration_required')
 r.out.mkdir(parents=True,exist_ok=False,mode=0o700);private_write(r.out,'before-state.json',json.dumps(before).encode());private_write(r.out,'migration.sql',sql.encode())
 rollback='-- Disable new entrypoints if repair is needed; retain all audit/policy state. Never drop used records.\n'+'\n'.join('REVOKE ALL ON FUNCTION public.'+s+' FROM anon,authenticated,service_role;' for s in SIGNATURES)
 private_write(r.out,'rollback-disable-new-entrypoints.sql',rollback.encode())
 holder='iap-authorization-'+uuid.uuid4().hex
 change=r.sql("INSERT INTO public.sandy_engineering_changes(title,problem,expected_behavior,change_purpose,feature_improvement,scope,regression_rules,acceptance_criteria,risk,requested_by,idempotency_key,status) SELECT 'Independent IAP authorization boundary installation','Existing registration cannot record the exact high-risk proposal','Submit only and require separate normal Owner authorization; no provider action by installation','SANDY-ENG-0001 independent protected authorization process','Retain high-risk classification and deny workload self-authorization','[\"sandy-engineering-control\"]','[\"Preserve read revision 1 and canary 6\"]','[\"Exact migration and ACL readback; no grant established\"]','high',i.user_id,'iap-boundary-install-'||gen_random_uuid()::text,'proposed' FROM public.sandy_engineering_test_identities i JOIN auth.users u ON u.id=i.user_id WHERE u.email='sandy-engineering-test@sandy-ai.internal' RETURNING id")
 cid=str(uuid.UUID(change[0]['id']))
 r.sql(f"DO $$ BEGIN INSERT INTO public.sandy_engineering_component_leases(component,holder,change_id,expected_source_sha256,expires_at) VALUES('{COMPONENT}','{holder}','{cid}','{digest(sql.encode())}',clock_timestamp()+interval '10 minutes') ON CONFLICT(component) DO UPDATE SET holder=EXCLUDED.holder,change_id=EXCLUDED.change_id,expected_source_sha256=EXCLUDED.expected_source_sha256,expires_at=EXCLUDED.expires_at,acquired_at=clock_timestamp() WHERE public.sandy_engineering_component_leases.expires_at<=clock_timestamp();IF NOT FOUND THEN RAISE EXCEPTION 'component already leased';END IF;END $$")
 try:
  if state(r)!=before:raise Blocked('parent_or_read_authority_changed')
  core=sql[sql.index('BEGIN;')+6:sql.rindex('COMMIT;')]
  r.stage='install_new_authorization_schema'
  r.sql("BEGIN;SELECT pg_advisory_xact_lock(hashtext('sandy-iap-repair-auth-install'));"+core+"INSERT INTO supabase_migrations.schema_migrations(version,statements,name,created_by,idempotency_key) VALUES('"+VERSION+"',ARRAY["+quote(sql)+"],'sandy_iap_repair_authorization','protected_github_management_release','sandy-iap-repair-authorization-v1');COMMIT;")
  result=verify(r,sql)
  if state(r)!=before:raise Blocked('prior_read_or_canary_authority_changed')
  grants=r.sql("SELECT iap_repair_revision,iap_repair_policy IS NULL no_grant_established FROM public.sandy_engineering_control_grants",True)
  if grants!=[{'iap_repair_revision':0,'no_grant_established':True}]:raise Blocked('unexpected_grant_requires_reconciliation')
  r.sql(f"INSERT INTO public.sandy_engineering_change_events(change_id,event_type,actor,detail) VALUES('{cid}','iap_authorization_boundary_installed',NULL,jsonb_build_object('source_commit','{sha}','grant_established',false,'IAM_changes',0))")
  return {**result,'source_commit':sha,'tracking_change_id':cid,'read_revision_1_and_canary_6_preserved':True,'iap_repair_revision':0,'rollback_prepared':True}
 finally:r.sql(f"DELETE FROM public.sandy_engineering_component_leases WHERE component='{COMPONENT}' AND holder='{holder}'")
if __name__=='__main__':
 p=argparse.ArgumentParser();g=p.add_mutually_exclusive_group();g.add_argument('--deploy',action='store_true');g.add_argument('--verify-installed',action='store_true');p.add_argument('--evidence-dir',required=True);a=p.parse_args();root=Path(a.evidence_dir);r=Installer(root/'source-preservation');report={'passed':False,'grant_established':False,'IAM_changes':0,'Edge_deployments':0,'Cloud_Run_changes':0}
 try:report.update(run(r,a.deploy,a.verify_installed),passed=True)
 except Exception as e:report.update(error=str(e) if isinstance(e,Blocked) else 'release_failed_or_unknown_reconcile_before_retry',stage=r.stage,last_management_request=r.last_request)
 root.mkdir(parents=True,exist_ok=True);private_write(root,'iap-authorization-release.json',json.dumps(report,indent=2).encode());print('::notice title=Independent IAP authorization installation::'+json.dumps(report));raise SystemExit(0 if report['passed'] else 1)
