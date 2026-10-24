#!/usr/bin/env python3
"""Exact-source additive receipt telemetry installation; no authority or outcome promotion."""
import argparse,json,os,re,subprocess,uuid
from pathlib import Path
from release_gcp_admin_read import Installer,digest,quote
from release_web_canary import ROOT,Blocked,private_write
from release_runtime_slice import inspect,source_check,track
VERSION='20261024005000'
MIGRATION='supabase/migrations/'+VERSION+'_sandy_runtime_model_receipt_metrics.sql'
MANIFEST=ROOT/'docs/sandy-engineering/evaluations/runtime-slices/sandy-agent-runtime-v4.json'
GUARD='public.sandy_runtime_conversation_receipt_guard()'
BEFORE='d67fca3362ed7a1e216014a8bc71f6ea'
AFTER='0f077a547cdac1aa9329c0c78dfd3205'
CONSTRAINT='f1a41a1a7c11525ba45b8e30c3c20c6c'
SOURCE_REPAIR='supabase/migrations/20261024005100_sandy_runtime_entrypoint_source_profile.sql'
SOURCE_REPAIR_GUARD='d6f53d143f87e6ad294fc3754efb3c8f'

def state(r):
 rows=r.sql("SELECT pg_get_functiondef(oid) definition,md5(pg_get_functiondef(oid)) definition_md5,oid,proowner,proacl::text acl,prosecdef,proconfig FROM pg_proc WHERE oid="+quote(GUARD)+"::regprocedure",True)
 if len(rows)!=1:raise Blocked('receipt_guard_unavailable')
 return rows[0]

def invariants(r):
 return r.sql("SELECT c.relrowsecurity rls,c.relforcerowsecurity forced_rls,c.relacl::text acl,(SELECT jsonb_agg(to_jsonb(p) ORDER BY policyname) FROM pg_policies p WHERE schemaname='public' AND tablename='sandy_runtime_conversation_audit') policies,(SELECT jsonb_agg(pg_get_triggerdef(t.oid) ORDER BY t.tgname) FROM pg_trigger t WHERE t.tgrelid=c.oid AND NOT t.tgisinternal) triggers FROM pg_class c WHERE c.oid='public.sandy_runtime_conversation_audit'::regclass",True)

def expected_definition(before):
 old="ARRAY['state','provider_response_id','response_sha256','error','finished_at']"
 if before.count(old)!=2 or before.count("IF NEW.state<>'started' OR NEW.provider_response_id IS NOT NULL OR NEW.response_sha256 IS NOT NULL THEN")!=1:raise Blocked('receipt_guard_patch_anchors_changed')
 return before.replace(old,"ARRAY['state','provider_response_id','response_sha256','error','finished_at','model_metrics']").replace("IF NEW.state<>'started' OR NEW.provider_response_id IS NOT NULL OR NEW.response_sha256 IS NOT NULL THEN","IF NEW.state<>'started' OR NEW.provider_response_id IS NOT NULL OR NEW.response_sha256 IS NOT NULL OR NEW.model_metrics IS NOT NULL THEN")

def verify(r,sql):
 rows=r.sql("SELECT statements FROM supabase_migrations.schema_migrations WHERE version='"+VERSION+"'",True)
 col=r.sql("SELECT data_type,is_nullable FROM information_schema.columns WHERE table_schema='public' AND table_name='sandy_runtime_conversation_audit' AND column_name='model_metrics'",True)
 constraint=r.sql("SELECT md5(pg_get_constraintdef(oid)) definition_md5 FROM pg_constraint WHERE conrelid='public.sandy_runtime_conversation_audit'::regclass AND conname='sandy_runtime_model_metrics_shape' AND convalidated",True)
 s=state(r)
 repair=r.sql("SELECT statements FROM supabase_migrations.schema_migrations WHERE version='20261024005100'",True)
 expected_guard=AFTER
 if repair:
  if repair!=[{'statements':[(ROOT/SOURCE_REPAIR).read_text()]}]:raise Blocked('runtime_source_repair_history_changed')
  expected_guard=SOURCE_REPAIR_GUARD
 if rows!=[{'statements':[sql]}] or col!=[{'data_type':'jsonb','is_nullable':'YES'}] or constraint!=[{'definition_md5':CONSTRAINT}] or s['definition_md5']!=expected_guard:raise Blocked('receipt_metrics_installation_readback_failed')
 return {'migration':VERSION,'installed':True,'historical_usage_backfilled':False,'functional_acceptance_passed':False,'authority_expanded':False}

def run(r,deploy=False,installed=False):
 sql=(ROOT/MIGRATION).read_text();m=json.loads(MANIFEST.read_bytes())
 if installed:return verify(r,sql)
 if r.sql("SELECT version FROM supabase_migrations.schema_migrations WHERE version='"+VERSION+"'",True):raise Blocked('already_installed_reconcile_no_replay')
 inspect(r,m);before=state(r);preserved=invariants(r);expected=expected_definition(before['definition'])
 if before['definition_md5']!=BEFORE:raise Blocked('receipt_guard_source_changed')
 if not deploy:return {'preflight_passed':True,'runtime_version':m['version'],'migration_sha256':digest(sql.encode()),'deployed':False}
 sha=source_check(m,MANIFEST)
 for path in [MIGRATION,'scripts/sandy/release_runtime_model_metrics.py','.github/workflows/sandy-runtime-model-metrics-release.yml']:
  if subprocess.check_output(['git','show',sha+':'+path],cwd=ROOT)!=(ROOT/path).read_bytes():raise Blocked('committed_metrics_release_required')
 r.out.mkdir(parents=True,exist_ok=False,mode=0o700)
 private_write(r.out,'before-guard.sql',before['definition'].encode());private_write(r.out,'before-state.json',json.dumps(before).encode());private_write(r.out,'preserved-policy.json',json.dumps(preserved).encode());private_write(r.out,'migration.sql',sql.encode())
 private_write(r.out,'rollback-guidance.txt',b'For Runtime rollback restore the source-preserved Runtime35 bundle only after exact current-module readback. Keep additive column, terminal metrics and immutable audit. Do not restore old guard while telemetry callers are active; it would reject new terminal updates. Do not delete usage, receipts or audit. No automatic retry after uncertain SQL response; reconcile history and source first.\n')
 cid=track(r,m,sha);holder='model-metrics-'+uuid.uuid4().hex;component='sandy-agent-runtime-v4'
 r.sql(f"DO $$ BEGIN INSERT INTO public.sandy_engineering_component_leases(component,holder,change_id,expected_source_sha256,expires_at) VALUES('{component}','{holder}','{cid}','{m['body_sha256']}',clock_timestamp()+interval '10 minutes') ON CONFLICT(component) DO UPDATE SET holder=EXCLUDED.holder,change_id=EXCLUDED.change_id,expected_source_sha256=EXCLUDED.expected_source_sha256,expires_at=EXCLUDED.expires_at,acquired_at=clock_timestamp() WHERE public.sandy_engineering_component_leases.expires_at<=clock_timestamp();IF NOT FOUND THEN RAISE EXCEPTION 'component already leased';END IF;END $$")
 dispatched=verified=False
 try:
  inspect(r,m)
  if state(r)!=before or invariants(r)!=preserved:raise Blocked('receipt_guard_or_policies_changed')
  core=sql[sql.index('BEGIN;')+6:sql.rindex('COMMIT;')];r.stage='install_exact_receipt_metrics';dispatched=True
  r.sql("BEGIN;SELECT pg_advisory_xact_lock(hashtext('sandy-runtime-model-metrics'));"+core+"INSERT INTO supabase_migrations.schema_migrations(version,statements,name,created_by,idempotency_key) VALUES('"+VERSION+"',ARRAY["+quote(sql)+"],'sandy_runtime_model_receipt_metrics','protected_github_management_release','sandy-runtime-model-metrics-v1');COMMIT;")
  result=verify(r,sql);after=state(r)
  if after['definition']!=expected or {k:v for k,v in before.items() if k not in ['definition','definition_md5']}!={k:v for k,v in after.items() if k not in ['definition','definition_md5']} or invariants(r)!=preserved:raise Blocked('receipt_privilege_or_source_preservation_failed')
  verified=True;result.update(source_commit=sha,tracking_change_id=cid,existing_RLS_ACL_triggers_preserved=True)
  r.sql(f"INSERT INTO public.sandy_engineering_change_events(change_id,event_type,actor,detail) VALUES('{cid}','runtime_model_metrics_schema_verified',NULL,{quote(json.dumps(result))}::jsonb)")
  return result
 finally:
  if not dispatched or verified:r.sql(f"DELETE FROM public.sandy_engineering_component_leases WHERE component='{component}' AND holder='{holder}'")

if __name__=='__main__':
 p=argparse.ArgumentParser();g=p.add_mutually_exclusive_group();g.add_argument('--deploy',action='store_true');g.add_argument('--verify-installed',action='store_true');p.add_argument('--evidence-dir',required=True);a=p.parse_args();out=Path(a.evidence_dir);r=Installer(out/'source-preservation');report={'passed':False}
 try:report.update(run(r,a.deploy,a.verify_installed),passed=True)
 except Exception as e:report.update(error=str(e) if isinstance(e,Blocked) else 'release_failed_or_unknown_reconcile_before_retry',stage=r.stage,last_management_request=r.last_request)
 out.mkdir(parents=True,exist_ok=True);private_write(out,'model-metrics-schema-release.json',json.dumps(report,indent=2).encode());print('::notice title=Receipt metrics schema::'+json.dumps(report));raise SystemExit(0 if report['passed'] else 1)
