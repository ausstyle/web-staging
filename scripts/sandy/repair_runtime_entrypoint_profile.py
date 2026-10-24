#!/usr/bin/env python3
"""Exact source-profile forward repair; never upload/reinstall Runtime or history."""
import argparse,json,os,subprocess
from pathlib import Path
from release_gcp_admin_read import Installer,digest,quote
from release_web_canary import ROOT,Blocked,private_write
from release_runtime_slice import inspect,source_check,track
from release_runtime_model_metrics import state,invariants,verify as verify_metrics
VERSION='20261024005100'
MIGRATION='supabase/migrations/'+VERSION+'_sandy_runtime_entrypoint_source_profile.sql'
MANIFEST=ROOT/'docs/sandy-engineering/evaluations/runtime-slices/sandy-agent-runtime-v4.json'
OLD='3aadfb520f651e9a6807cbb24b5d4409fcfbb25fb69fe5d72036916e44db8679'
CURRENT='f4f15732b13e21d9fbd76de8173aac71672e4a5a49e8d17baf0884abe967f796'
BEFORE_GUARD='0f077a547cdac1aa9329c0c78dfd3205';AFTER_GUARD='d6f53d143f87e6ad294fc3754efb3c8f'
BEFORE_CONSTRAINT='b007a0775302338a02eda2db3cef777e';AFTER_CONSTRAINT='c1249cc1558dd67e515c2b3c1b564500'

def profile(r):
 rows=r.sql("SELECT md5(pg_get_constraintdef(oid)) md5,pg_get_constraintdef(oid) definition FROM pg_constraint WHERE conrelid='public.sandy_runtime_conversation_audit'::regclass AND conname='sandy_runtime_conversation_fixed_source_profile' AND convalidated",True)
 if len(rows)!=1:raise Blocked('fixed_source_constraint_unavailable')
 return rows[0]

def registry(r):
 rows=r.sql("SELECT api_exposed,ui_exposed,ai_exposed,verified,handler,error_contract FROM public.sandy_operation_registry WHERE operation='agent.runtime.conversation.respond'",True)
 if len(rows)!=1 or any(rows[0][x] for x in ['api_exposed','ui_exposed','ai_exposed','verified']) or rows[0]['handler']!='internal:agent.runtime.conversation.respond@1.0.0':raise Blocked('closed_runtime_registry_boundary_changed')
 return rows[0]

def preserved(r):
 return {'table':invariants(r),'other_constraints':r.sql("SELECT conname,pg_get_constraintdef(oid) definition FROM pg_constraint WHERE conrelid='public.sandy_runtime_conversation_audit'::regclass AND conname<>'sandy_runtime_conversation_fixed_source_profile' ORDER BY conname",True)}

def preflight(r,m,installed=False):
 meta,body,files=inspect(r,m,True)
 if digest(files['sandy-agent-runtime-v4/index.ts'])!=CURRENT:raise Blocked('exact_runtime36_entrypoint_required')
 verify_metrics(r,(ROOT/'supabase/migrations/20261024005000_sandy_runtime_model_receipt_metrics.sql').read_text())
 raw=(ROOT/MIGRATION).read_text();history=r.sql("SELECT statements FROM supabase_migrations.schema_migrations WHERE version='"+VERSION+"'",True)
 if history!=([{'statements':[raw]}] if installed else []):raise Blocked('source_profile_repair_reconcile_no_replay')
 s=state(r);p=profile(r);reg=registry(r)
 if s['definition_md5']!=(AFTER_GUARD if installed else BEFORE_GUARD) or p['md5']!=(AFTER_CONSTRAINT if installed else BEFORE_CONSTRAINT) or reg['error_contract'].get('v4_profile',{}).get('source_sha256')!=(CURRENT if installed else OLD):raise Blocked('exact_source_profile_state_required')
 return meta,body,s,p,reg

def run(r,apply=False,installed=False):
 m=json.loads(MANIFEST.read_bytes());meta,body,before,old_profile,old_registry=preflight(r,m,installed)
 if installed:return {'installed_source_profile_verified':True,'Runtime_version':meta['version'],'functions_redeployed':0,'mutations':0}
 if not apply:return {'preflight_passed':True,'functions_redeployed':0,'mutations':0}
 sha=source_check(m,MANIFEST)
 paths=[MIGRATION,'scripts/sandy/repair_runtime_entrypoint_profile.py','scripts/sandy/release_runtime_model_metrics.py','scripts/sandy/runtime_model_metrics_acceptance.py','.github/workflows/sandy-runtime-entrypoint-profile-repair.yml']
 for p in paths:
  if subprocess.check_output(['git','show',sha+':'+p],cwd=ROOT)!=(ROOT/p).read_bytes():raise Blocked('committed_source_profile_repair_required')
 prior=preserved(r);r.out.mkdir(parents=True,exist_ok=False,mode=0o700)
 private_write(r.out,'before-guard.json',json.dumps(before).encode());private_write(r.out,'before-constraint.json',json.dumps(old_profile).encode());private_write(r.out,'before-registry.json',json.dumps(old_registry).encode());private_write(r.out,'before-preserved.json',json.dumps(prior).encode());private_write(r.out,'runtime36.json',json.dumps(meta).encode())
 private_write(r.out,'rollback-guidance.txt',b'No automatic retry or Runtime upload. Keep05000 and all history. This repair admits only the exact deployed36entrypoint for newv4 receipts. Restoring old constraint alone blocks Runtime36; recover source+profile together from exact reviewed preimages only if current source hashes match. Never rewrite historical receipts or weaken source allowlists.\n')
 cid=track(r,m,sha);holder=r.holder;component='sandy-agent-runtime-v4'
 r.sql(f"DO $$ BEGIN INSERT INTO public.sandy_engineering_component_leases(component,holder,change_id,expected_source_sha256,expires_at) VALUES('{component}','{holder}','{cid}','{digest(body)}',clock_timestamp()+interval '10 minutes') ON CONFLICT(component) DO UPDATE SET holder=EXCLUDED.holder,change_id=EXCLUDED.change_id,expected_source_sha256=EXCLUDED.expected_source_sha256,expires_at=EXCLUDED.expires_at,acquired_at=clock_timestamp() WHERE public.sandy_engineering_component_leases.expires_at<=clock_timestamp();IF NOT FOUND THEN RAISE EXCEPTION 'component already leased';END IF;END $$")
 dispatched=verified=False
 try:
  if preflight(r,m)!= (meta,body,before,old_profile,old_registry) or preserved(r)!=prior:raise Blocked('source_or_security_changed_before_repair')
  if r.sql(f"SELECT count(*)::int held FROM public.sandy_engineering_component_leases WHERE component='{component}' AND holder='{holder}' AND change_id='{cid}' AND expires_at>clock_timestamp()",True)!=[{'held':1}]:raise Blocked('runtime_source_lease_lost')
  r.sql(f"INSERT INTO public.sandy_engineering_change_events(change_id,event_type,actor,detail) VALUES('{cid}','runtime_entrypoint_profile_repair_dispatch',NULL,{quote(json.dumps({'source_commit':sha,'github_run_id':os.environ.get('GITHUB_RUN_ID'),'actor_kind':'project_management_release','Runtime_version':meta['version'],'entrypoint_sha256':CURRENT,'functions_redeployed':0,'authority_expanded':False}))}::jsonb)")
  raw=(ROOT/MIGRATION).read_text();core=raw[raw.index('BEGIN;')+6:raw.rindex('COMMIT;')];dispatched=True;r.stage='repair_exact_source_profile'
  r.sql("BEGIN;"+core+"INSERT INTO supabase_migrations.schema_migrations(version,statements,name,created_by,idempotency_key) VALUES('"+VERSION+"',ARRAY["+quote(raw)+"],'sandy_runtime_entrypoint_source_profile','protected_github_management_release','runtime-entrypoint-profile-v1');COMMIT;")
  _,_,after,_,after_registry=preflight(r,m,True)
  expected=json.loads(json.dumps(old_registry));expected['error_contract']['v4_profile']['source_sha256']=CURRENT
  if after_registry!=expected or preserved(r)!=prior or {k:v for k,v in before.items() if k not in ['definition','definition_md5']}!={k:v for k,v in after.items() if k not in ['definition','definition_md5']}:raise Blocked('receipt_security_or_registry_preservation_failed')
  result={'source_commit':sha,'tracking_change_id':cid,'migration':VERSION,'Runtime_version':meta['version'],'entrypoint_sha256':CURRENT,'source_profile_verified':True,'new_v4_legacy_hash_denied':True,'history_rewritten':False,'RLS_ACL_triggers_preserved':True,'functions_redeployed':0,'authority_expanded':False,'model_execution_verified':False}
  verified=True;r.sql(f"INSERT INTO public.sandy_engineering_change_events(change_id,event_type,actor,detail) VALUES('{cid}','runtime_entrypoint_profile_repair_verified',NULL,{quote(json.dumps(result))}::jsonb)");return result
 except Exception:
  if dispatched:
   try:r.sql(f"INSERT INTO public.sandy_engineering_change_events(change_id,event_type,actor,detail) VALUES('{cid}','runtime_entrypoint_profile_repair_unknown',NULL,'{{\"reconcile_before_retry\":true,\"automatic_retry\":false}}'::jsonb)")
   except Exception:pass
  raise
 finally:
  if not dispatched or verified:r.sql(f"DELETE FROM public.sandy_engineering_component_leases WHERE component='{component}' AND holder='{holder}'")

def main():
 p=argparse.ArgumentParser();g=p.add_mutually_exclusive_group();g.add_argument('--apply',action='store_true');g.add_argument('--verify-installed',action='store_true');p.add_argument('--evidence-dir',type=Path,required=True);a=p.parse_args();r=Installer(a.evidence_dir/'private-preimages');report={'passed':False}
 try:report.update(run(r,a.apply,a.verify_installed),passed=True)
 except Exception as e:report.update(error=str(e) if isinstance(e,Blocked) else 'source_profile_repair_failed_or_unknown_reconcile_before_retry',stage=r.stage,last_management_request=r.last_request)
 a.evidence_dir.mkdir(parents=True,exist_ok=True);private_write(a.evidence_dir,'source-profile-repair.json',json.dumps(report,indent=2).encode());print('::notice title=Runtime exact source profile::'+json.dumps(report));return 0 if report['passed'] else 1
if __name__=='__main__':raise SystemExit(main())
