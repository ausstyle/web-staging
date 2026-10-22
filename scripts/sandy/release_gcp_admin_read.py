#!/usr/bin/env python3
"""Protected installation of the existing owner-authorized fixed GCP read.

Pins the deployed Control base, new modules, migrations, source and workflow.
No owner approval/grant mutation, candidate build, traffic change or IAM write.
"""
import argparse, base64, hashlib, json, os, re, subprocess, uuid
from pathlib import Path
from release_owner_session_repair import Repair, quote
from release_web_canary import ROOT, Blocked, original_sources, private_write
from release_delegated_runtime import upload
from gcp_admin_control_patch import patch
MANIFEST=ROOT/'docs/sandy-engineering/evaluations/gcp-admin-read-release.json'
CHANGE='6a419c3c-1a04-4e1b-9c5f-6f1a9abd5719'
SLUG='sandy-engineering-control'
BINDING='SANDY_GCP_ADMIN_WORKER_URL'
VERSION='sandy-engineering-mcp-api-39849886412-4'
digest=lambda b:hashlib.sha256(b).hexdigest()

def candidate():
 raw=MANIFEST.read_bytes();m=json.loads(raw);source=m['source_commit']
 if not re.fullmatch('[a-f0-9]{40}',source) or m['change_id']!=CHANGE or m['base_version']!=51 or m['gateway_version']!=57:
  raise Blocked('fixed_administrator_release_required')
 subprocess.run(['git','merge-base','--is-ancestor',source,'HEAD'],cwd=ROOT,check=True,stdout=subprocess.DEVNULL)
 artifacts={}
 for path,pin in m['artifacts'].items():
  if not re.fullmatch('[a-zA-Z0-9_./-]+',path) or '..' in path or path.startswith('/'):raise Blocked('invalid_release_path')
  value=subprocess.check_output(['git','show',source+':'+path],cwd=ROOT)
  if digest(value)!=pin or (ROOT/path).read_bytes()!=value:raise Blocked('immutable_release_artifact_changed')
  artifacts[path]=value
 if m['worker_url']!='https://sandy-api-review---sandy-engineering-mcp-4pqn6jsfxq-ew.a.run.app':raise Blocked('fixed_worker_required')
 return m,digest(raw),artifacts

def approval(r):
 rows=r.sql(f"""SELECT EXISTS(SELECT 1 FROM public.sandy_engineering_changes c
 JOIN public.sandy_engineering_change_events e ON e.change_id=c.id
 JOIN public.sandy_controller_admins a ON a.auth_user_id=e.actor AND a.enabled AND a.role='owner'
 JOIN auth.users u ON u.id=e.actor AND coalesce(u.raw_app_meta_data->>'sandy_engineering_test','false')<>'true'
 WHERE c.id='{CHANGE}' AND c.status='approved' AND c.risk='high' AND c.scope ? 'google_cloud'
 AND e.event_type='status_changed' AND e.detail->>'to'='approved'
 AND e.detail->>'reason' LIKE '%read-only identity preflight%') AS admitted""")
 if rows!=[{'admitted':True}]:raise Blocked('existing_genuine_administrator_approval_required')

def inspect(r,m):
 meta=json.loads(r.api('GET','/functions/'+SLUG));raw=r.api('GET','/functions/'+SLUG+'/body')
 if meta.get('version')!=m['base_version'] or meta.get('status')!='ACTIVE' or meta.get('verify_jwt') is not False or digest(raw)!=m['base_bundle_sha256']:
  raise Blocked('controller_base_changed_no_overwrite')
 gateway=json.loads(r.api('GET','/functions/sandy-operation-api'));gateway_body=r.api('GET','/functions/sandy-operation-api/body')
 if gateway.get('version')!=m['gateway_version'] or digest(gateway_body)!=m['gateway_bundle_sha256']:raise Blocked('gateway_changed_no_dispatch')
 return meta,raw

def migrations_sql(m,artifacts):
 pieces=["BEGIN; SELECT pg_advisory_xact_lock(hashtext('sandy-gcp-admin-read-migration')); SET LOCAL lock_timeout='5s';"]
 for path in m['migrations']:
  sql=artifacts[path].decode();core=re.sub(r'\A(?:\s*--[^\n]*\n)*\s*','',sql)
  if not core.strip().startswith('BEGIN;') or not core.strip().endswith('COMMIT;'):raise Blocked('transactional_migration_required')
  core=core.strip()[len('BEGIN;'):-len('COMMIT;')]
  version=Path(path).name.split('_')[0]
  if not re.fullmatch('[0-9]{14}',version):raise Blocked('migration_identifier_invalid')
  pieces.append(core)
  pieces.append(f"INSERT INTO supabase_migrations.schema_migrations(version,statements,name,created_by,idempotency_key) VALUES('{version}',ARRAY[{quote(sql)}],'{Path(path).stem}','protected_gcp_admin_read_release','gcp-admin-{CHANGE}-{version}');")
 return '\n'.join(pieces+['COMMIT;'])

def run(r,m,pin,artifacts,deploy):
 approval(r);meta,raw=inspect(r,m)
 versions=','.join(quote(Path(p).name.split('_')[0]) for p in m['migrations'])
 if r.sql(f"SELECT version FROM supabase_migrations.schema_migrations WHERE version IN ({versions})"):
  raise Blocked('migration_already_recorded_reconcile_before_resume')
 if r.sql("SELECT oid FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname LIKE 'sandy_gcp_admin_read_%'"):
  raise Blocked('administrator_schema_already_present_reconcile')
 secrets=json.loads(r.api('GET','/secrets'))
 if any(x.get('name')==BINDING for x in secrets):raise Blocked('worker_binding_already_present_reconcile')
 files=original_sources(raw)
 if {p:digest(b) for p,b in files.items()}!=m['base_files']:raise Blocked('base_original_modules_changed')
 files[SLUG+'/index.ts']=patch(files[SLUG+'/index.ts'])
 if digest(files[SLUG+'/index.ts'])!=m['patched_entrypoint_sha256']:raise Blocked('patched_entrypoint_mismatch')
 files[SLUG+'/gcp_admin_read.ts']=artifacts['supabase/functions/'+SLUG+'/gcp_admin_read.ts']
 sql=migrations_sql(m,artifacts)
 if not deploy:return {'preflight_passed':True,'owner_approval_verified':True,'manifest_sha256':pin,'source_commit':m['source_commit'],'deployed':False}
 if os.environ.get('GITHUB_ACTIONS')!='true' or os.environ.get('GITHUB_REF')!='refs/heads/main':raise Blocked('protected_main_release_required')
 private_write(r.evidence,'control.before.body',raw);private_write(r.evidence,'control.before-metadata.json',json.dumps(meta).encode())
 components=['sandy-engineering-control','sandy-gcp-admin-read-schema','sandy-gcp-admin-read-binding']
 r.sql('BEGIN;'+''.join(f"""DO $$ BEGIN INSERT INTO public.sandy_engineering_component_leases(component,holder,change_id,expected_source_sha256,expires_at)
 VALUES('{c}','{r.holder}','{CHANGE}','{m['base_bundle_sha256']}',clock_timestamp()+interval '15 minutes')
 ON CONFLICT(component) DO UPDATE SET holder=EXCLUDED.holder,change_id=EXCLUDED.change_id,expected_source_sha256=EXCLUDED.expected_source_sha256,expires_at=EXCLUDED.expires_at,acquired_at=clock_timestamp()
 WHERE public.sandy_engineering_component_leases.expires_at<=clock_timestamp();IF NOT FOUND THEN RAISE EXCEPTION 'component already leased';END IF;END $$;""" for c in components)+'COMMIT;')
 def guard():
  approval(r);inspect(r,m)
  if r.sql(f"SELECT count(*)::integer AS held FROM public.sandy_engineering_component_leases WHERE holder='{r.holder}' AND change_id='{CHANGE}' AND expires_at>clock_timestamp()")!=[{'held':3}]:raise Blocked('administrator_release_lease_lost')
 try:
  guard();r.stage='recovery_capture'
  recovery={'source_commit':m['source_commit'],'manifest_sha256':pin,'base_version':51,'base_bundle_sha256':m['base_bundle_sha256'],
   'private_rollback_eszip_base64':base64.b64encode(raw).decode(),'new_binding_previously_absent':True,
   'strategy':'Restore the captured original Control modules and delete only the newly installed worker binding; leave additive DDL inert.'}
  r.sql(f"INSERT INTO public.sandy_engineering_change_events(change_id,event_type,actor,detail) VALUES('{CHANGE}','gcp_admin_read_recovery_captured',NULL,{quote(json.dumps(recovery))}::jsonb)")
  guard();r.stage='migration';r.sql(sql)
  installed_history=r.sql(f"SELECT version,statements FROM supabase_migrations.schema_migrations WHERE version IN ({versions})")
  if {x['version']:x['statements'] for x in installed_history}!={Path(p).name.split('_')[0]:[artifacts[p].decode()] for p in m['migrations']}:
   raise Blocked('migration_history_readback_mismatch')
  permissions=r.sql("SELECT count(*)::integer AS installed,bool_and(NOT has_function_privilege('anon',oid,'EXECUTE') AND NOT has_function_privilege('authenticated',oid,'EXECUTE')) AS private FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname LIKE 'sandy_gcp_admin_read_%'")
  if permissions!=[{'installed':6,'private':True}]:raise Blocked('administrator_schema_permissions_unverified')
  # Exactly one dispatch per mutation. Unknown outcomes are reconciled, not replayed.
  guard();r.stage='worker_binding';r.api('POST','/secrets',json.dumps([{'name':BINDING,'value':m['worker_url']}]).encode())
  installed=json.loads(r.api('GET','/secrets'))
  if not any(x.get('name')==BINDING and x.get('digest')==digest(m['worker_url'].encode()) for x in installed):raise Blocked('worker_binding_digest_unverified')
  guard();r.stage='controller_upload';private_write(r.evidence,'control.provider-receipt.json',upload(r,{'function':SLUG},files))
  after=r.api('GET','/functions/'+SLUG+'/body');after_meta=json.loads(r.api('GET','/functions/'+SLUG));private_write(r.evidence,'control.after.body',after)
  if after_meta.get('version')!=52 or after_meta.get('status')!='ACTIVE' or after_meta.get('verify_jwt') is not False or original_sources(after)!=files:
   raise Blocked('controller_deployment_unknown_no_retry')
  gateway=json.loads(r.api('GET','/functions/sandy-operation-api'))
  if gateway.get('version')!=57 or digest(r.api('GET','/functions/sandy-operation-api/body'))!=m['gateway_bundle_sha256']:raise Blocked('gateway_invariant_changed')
  # Capture source-level forward-recovery evidence. Rollback removes the new
  # binding and redeploys the captured Control bundle; additive DDL may remain.
  result={'change_id':CHANGE,'source_commit':m['source_commit'],'manifest_sha256':pin,'controller_version':52,'gateway_version':57,
   'source_parity_verified':True,'migration_versions':[Path(p).name.split('_')[0] for p in m['migrations']],
   'worker_binding_digest_verified':True,'standing_grant_mutated':False,'owner_approval_created':False,'IAM_changes':0,
   'candidate_deployed':False,'production_traffic_changed':False,'rollback_captured':True,'rollback_exercised':False,'provider_verification_passed':False}
  r.sql(f"INSERT INTO public.sandy_engineering_change_events(change_id,event_type,actor,detail) VALUES('{CHANGE}','gcp_admin_read_source_verified',NULL,{quote(json.dumps(result))}::jsonb)")
  private_write(r.evidence,'release-receipt.json',json.dumps(result,indent=2).encode());return result
 finally:r.sql(f"DELETE FROM public.sandy_engineering_component_leases WHERE holder='{r.holder}' AND change_id='{CHANGE}'")

def main():
 p=argparse.ArgumentParser(description=__doc__);p.add_argument('--deploy',action='store_true');p.add_argument('--evidence-dir',type=Path,required=True);a=p.parse_args()
 out=a.evidence_dir.resolve();r=None
 try:
  if out.is_relative_to(ROOT):raise Blocked('private_recovery_outside_repository_required')
  out.mkdir(mode=0o700,parents=True,exist_ok=True);m,pin,artifacts=candidate();r=Repair(out);r.stage='preflight'
  print(json.dumps({'ok':True,**run(r,m,pin,artifacts,a.deploy)}));return 0
 except Exception as e:
  code=str(e) if isinstance(e,Blocked) and re.fullmatch('[a-z0-9_]+',str(e)) else 'administrator_release_blocked_or_unknown'
  print(json.dumps({'ok':False,'error':code,'stage':getattr(r,'stage','source_verification'),'automatic_retry':False,'production_state_requires_reconciliation':bool(a.deploy)}));return 1
if __name__=='__main__':raise SystemExit(main())
