#!/usr/bin/env python3
"""Audit-only late callback repair. Preserve advanced engineering cycle state,
receipts and verification gates; never rerun code generation or provider work.
"""
import argparse,json,os,re,subprocess,uuid
from pathlib import Path
from release_gcp_admin_read import Installer,digest,quote
from release_web_canary import ROOT,Blocked,private_write
VERSION='20261024003300';MIGRATION='supabase/migrations/'+VERSION+'_sandy_superseded_architect_outcomes.sql'
FIXTURE='scripts/sandy/fixtures/autonomous-record-event-v1.sql'
SIGNATURE='public.sandy_autonomous_engineering_record_event(text,text,text,jsonb)'
COMPONENT='sandy-autonomous-engineering-cycle-events'
PREIMAGE='1915230f2ce611be12253604b71d54dfd1394cc6d797517a4ef0bcd20a715322'

def candidate(sql):
 original=(ROOT/FIXTURE).read_text().split('$function$')[1]
 if digest(original.encode())!=PREIMAGE:raise Blocked('inspected_cycle_RPC_preimage_changed')
 match=re.search(r"definition:=replace\(definition,'((?:''|[^'])*)',\s*'((?:''|[^'])*)'\);",sql,re.S)
 if not match:raise Blocked('fixed_cycle_RPC_patch_required')
 old,new=(part.replace("''","'") for part in match.groups())
 if original.count(old)!=1:raise Blocked('fixed_cycle_RPC_anchor_changed')
 return original.replace(old,new,1)

def function(r):
 rows=r.sql("SELECT prosrc,prosecdef,proconfig,proacl::text acl,pg_get_functiondef(p.oid) definition FROM pg_proc p WHERE p.oid='"+SIGNATURE+"'::regprocedure",True)
 if len(rows)!=1:raise Blocked('existing_cycle_RPC_required')
 return rows[0]

def verify(r,sql):
 history=r.sql("SELECT statements FROM supabase_migrations.schema_migrations WHERE version='"+VERSION+"'",True)
 if history!=[{'statements':[sql]}]:raise Blocked('installed_superseded_callback_migration_source_mismatch')
 row=function(r)
 if row['prosrc']!=candidate(sql) or row['prosecdef'] is not True or row['proconfig']!=['search_path=public, pg_temp']:raise Blocked('installed_cycle_callback_source_mismatch')
 return {'installed_source_verified':True,'migration':VERSION,'audit_only_late_outcomes':True,'code_generation_rerun':False,'production_acceptance_inferred':False,'Edge_deployments':0}

def run(r,deploy=False,installed=False):
 sql=(ROOT/MIGRATION).read_text();candidate(sql)
 if installed:return verify(r,sql)
 row=function(r)
 if digest(row['prosrc'].encode())!=PREIMAGE or row['prosecdef'] is not True or row['proconfig']!=['search_path=public, pg_temp']:raise Blocked('existing_cycle_callback_source_changed')
 if r.sql("SELECT version FROM supabase_migrations.schema_migrations WHERE version='"+VERSION+"'",True):raise Blocked('callback_repair_already_installed_reconcile_no_replay')
 if not deploy:return {'preflight_passed':True,'migration_sha256':digest(sql.encode()),'existing_RPC_sha256':PREIMAGE}
 if os.environ.get('GITHUB_ACTIONS')!='true' or os.environ.get('GITHUB_REF')!='refs/heads/main':raise Blocked('protected_main_release_required')
 source=os.environ.get('GITHUB_SHA','')
 if not re.fullmatch('[a-f0-9]{40}',source):raise Blocked('committed_source_required')
 for name,value in [(MIGRATION,sql.encode()),(FIXTURE,(ROOT/FIXTURE).read_bytes())]:
  if subprocess.check_output(['git','show',source+':'+name],cwd=ROOT)!=value:raise Blocked('committed_exact_callback_source_required')
 r.out.mkdir(parents=True,exist_ok=False,mode=0o700);private_write(r.out,'callback-before.json',json.dumps(row).encode());private_write(r.out,'rollback-restore-RPC.sql',(row['definition']+';\n-- Preserve all prior cycle state, provider receipts and newly recorded callback audits.\n').encode())
 tracking=r.sql("INSERT INTO public.sandy_engineering_changes(title,problem,expected_behavior,change_purpose,feature_improvement,scope,regression_rules,acceptance_criteria,risk,requested_by,idempotency_key,status) SELECT 'Audit superseded Architect callbacks without cycle regression','A late verified Architect outcome is rejected after the earlier PR reaches verification','Retain late outcome evidence while preserving all advanced state and production gates','SANDY-ENG-0004 callback durability','Recovery without rerunning code generation or pretending production acceptance','[\"sandy-engineering-oidc-ingest\"]','[\"No cycle regression, Owner session, grant or provider action\"]','[\"Exact source/ACL preservation and immutable audit-only late callback\"]','normal',i.user_id,'superseded-architect-repair-'||gen_random_uuid()::text,'proposed' FROM public.sandy_engineering_test_identities i JOIN auth.users u ON u.id=i.user_id WHERE u.email='sandy-engineering-test@sandy-ai.internal' RETURNING id")
 cid=str(uuid.UUID(tracking[0]['id']));holder='superseded-architect-'+uuid.uuid4().hex
 r.sql(f"DO $$ BEGIN INSERT INTO public.sandy_engineering_component_leases(component,holder,change_id,expected_source_sha256,expires_at) VALUES('{COMPONENT}','{holder}','{cid}','{PREIMAGE}',clock_timestamp()+interval '10 minutes') ON CONFLICT(component) DO UPDATE SET holder=EXCLUDED.holder,change_id=EXCLUDED.change_id,expected_source_sha256=EXCLUDED.expected_source_sha256,expires_at=EXCLUDED.expires_at,acquired_at=clock_timestamp() WHERE public.sandy_engineering_component_leases.expires_at<=clock_timestamp();IF NOT FOUND THEN RAISE EXCEPTION 'component already leased';END IF;END $$")
 try:
  if function(r)!=row:raise Blocked('cycle_callback_changed_before_install')
  core=sql[sql.index('BEGIN;')+6:sql.rindex('COMMIT;')];r.stage='install_audit_only_callback_repair'
  r.sql("BEGIN;SELECT pg_advisory_xact_lock(hashtext('sandy-superseded-architect-install'));"+core+"INSERT INTO supabase_migrations.schema_migrations(version,statements,name,created_by,idempotency_key) VALUES('"+VERSION+"',ARRAY["+quote(sql)+"],'sandy_superseded_architect_outcomes','protected_github_management_release','sandy-superseded-architect-v1');COMMIT;")
  result=verify(r,sql);after=function(r)
  if after['acl']!=row['acl']:raise Blocked('existing_cycle_RPC_permissions_changed')
  r.sql(f"INSERT INTO public.sandy_engineering_change_events(change_id,event_type,actor,detail) VALUES('{cid}','superseded_architect_audit_repair_installed',NULL,jsonb_build_object('source_commit','{source}','production_acceptance_inferred',false,'code_generation_rerun',false,'provider_operations',0))")
  return {**result,'tracking_change_id':cid,'source_commit':source,'existing_RPC_permissions_preserved':True,'rollback_prepared':True}
 finally:r.sql(f"DELETE FROM public.sandy_engineering_component_leases WHERE component='{COMPONENT}' AND holder='{holder}'")

if __name__=='__main__':
 p=argparse.ArgumentParser();g=p.add_mutually_exclusive_group();g.add_argument('--deploy',action='store_true');g.add_argument('--verify-installed',action='store_true');p.add_argument('--evidence-dir',required=True);a=p.parse_args();root=Path(a.evidence_dir);r=Installer(root/'source-preservation');report={'passed':False,'grant_changes':0,'provider_operations':0,'code_generation_rerun':False}
 try:report.update(run(r,a.deploy,a.verify_installed),passed=True)
 except Exception as e:report.update(error=str(e) if isinstance(e,Blocked) else 'callback_repair_failed_or_unknown_reconcile_before_retry',stage=r.stage,last_management_request=r.last_request)
 root.mkdir(parents=True,exist_ok=True);private_write(root,'superseded-architect-release.json',json.dumps(report,indent=2).encode());print('::notice title=Superseded Architect callback repair::'+json.dumps(report));raise SystemExit(0 if report['passed'] else 1)
