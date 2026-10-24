#!/usr/bin/env python3
"""Source-preserving protected custody/job installation. No Cloud Run, grant or IAM changes."""
import argparse,copy,json,os,re,subprocess,uuid
from pathlib import Path
from release_gcp_admin_read import Installer,digest,quote
from release_web_canary import ROOT,Blocked,original_sources,private_write
from prepare_iap_repair_transport import patch,patch_gateway,verify_candidate
from verify_iap_transport_installation import verify as verify_prerequisite
import release_memory_private_correction as memory_release
import release_task_cancel_certification as cancel_release
MANIFEST=ROOT/'docs/sandy-engineering/evaluations/iap-repair-transport-release.json'
PROPOSAL='52d56740-59c8-4db1-b7e6-a137c7699b86';VERSION='20261024006000'
SOURCE_PATHS=['sandy-engineering-control/iap_repair.ts','sandy-engineering-control/iap_repair_jobs.ts','sandy-operation-api/iap_repair_authorization.ts','_shared/sandy_iap_repair_contract.ts']
def load():
 m=json.loads(MANIFEST.read_text());pin=m.get('reviewed_source_commit','')
 if m.get('version')!=1 or m.get('existing_proposal_id')!=PROPOSAL or set(m['functions'])!={'sandy-engineering-control','sandy-operation-api'} or not re.fullmatch('[a-f0-9]{40}',pin):raise Blocked('bounded_reviewed_release_manifest_required')
 sources={}
 for p in SOURCE_PATHS:
  value=subprocess.check_output(['git','show',pin+':supabase/functions/'+p],cwd=ROOT)
  if value!=(ROOT/'supabase/functions'/p).read_bytes():raise Blocked('reviewed_handler_source_changed')
  sources[p]=value
 migration=(ROOT/m['migration']).read_text()
 if digest(migration.encode())!=m['migration_sha256'] or subprocess.check_output(['git','show',pin+':'+m['migration']],cwd=ROOT)!=migration.encode():raise Blocked('reviewed_migration_changed')
 return m,sources,migration
def memory_prerequisite(r,m):
 # Compose the reviewed, now-published memory capability with the exact later
 # shared mutation RPC. Reuse both strict validators instead of requiring the
 # obsolete closed-memory rollout state or copying provider execution logic.
 if digest(memory_release.MANIFEST.read_bytes())!=m.get('preserved_memory_release_manifest_sha256') or digest(cancel_release.MANIFEST.read_bytes())!=m.get('preserved_cancellation_release_manifest_sha256'):
  raise Blocked('reviewed_memory_release_manifest_changed')
 memory,_=memory_release.load();cancel,_=cancel_release.load()
 composed=copy.deepcopy(memory)
 composed['shared_rpc_after_private_readiness_prosrc_sha256']=cancel['shared_rpc_after_private_readiness_prosrc_sha256']
 memory_release.schema_components(r,composed,installed=True)
 cancel_release.schema(r,cancel,installed=True)
 slug='sandy-api-mcp';expected=cancel['functions'][slug]
 meta=json.loads(r.api('GET','/functions/'+slug));files=original_sources(r.api('GET','/functions/'+slug+'/body'))
 if (meta.get('status')!='ACTIVE' or meta.get('verify_jwt') is not True
  or meta.get('version')!=expected['before_version']
  or {p:digest(v) for p,v in files.items()}!=expected['candidate_files']):
  raise Blocked('preserved_memory_MCP_source_or_ingress_changed')
 retired=r.sql("SELECT count(*)::int unretired FROM public.sandy_engineering_artifacts a WHERE a.artifact_type='configuration' AND a.metadata->>'kind' IN('runtime_private_certification','runtime_task_cancel_certification') AND EXISTS(SELECT 1 FROM public.sandy_engineering_change_events e WHERE e.event_type IN('memory_private_readiness_installed','task_cancel_private_readiness_installed') AND e.detail->>'artifact_id'=a.id::text) AND (NOT EXISTS(SELECT 1 FROM public.sandy_engineering_change_events e WHERE e.event_type IN('memory_private_readiness_revoked','task_cancel_private_readiness_revoked') AND e.detail->>'artifact_id'=a.id::text) OR EXISTS(SELECT 1 FROM auth.sessions s WHERE s.user_id=(a.metadata->>'fixture_user_id')::uuid) OR EXISTS(SELECT 1 FROM public.sandy_memory_portal_accounts p WHERE p.auth_user_id=(a.metadata->>'fixture_user_id')::uuid) OR NOT EXISTS(SELECT 1 FROM auth.users u WHERE u.id=(a.metadata->>'fixture_user_id')::uuid AND u.banned_until>clock_timestamp()))",True)
 if retired!=[{'unretired':0}]:raise Blocked('private_acceptance_requires_full_retirement_before_IAP_release')
 return cancel

def registry(r):
 return r.sql("SELECT operation,input_schema,handler,is_mutation,api_exposed,ai_exposed,verified,permission_scope FROM public.sandy_operation_registry WHERE operation IN ('engineering.implementation.request','engineering.job.execute') ORDER BY operation",True)
def preserved(r):
 return r.sql("""SELECT g.admin_read_revision,encode(extensions.digest(g.admin_read_policy::text,'sha256'),'hex') read_policy_sha256,
 g.iap_repair_revision,g.iap_repair_policy IS NULL no_iap_grant,
 (SELECT version FROM public.sandy_engineering_standing_delegations d WHERE d.identity_user_id=g.identity_user_id) canary_revision,
 (SELECT encode(extensions.digest(policy::text,'sha256'),'hex') FROM public.sandy_engineering_standing_delegations d WHERE d.identity_user_id=g.identity_user_id) canary_policy_sha256,
 encode(extensions.digest(pg_get_functiondef('public.sandy_engineering_guard_owner_delegation_event()'::regprocedure),'sha256'),'hex') read_audit_guard_sha256,
 encode(extensions.digest(pg_get_functiondef('public.sandy_engineering_guard_iap_repair_owner_event()'::regprocedure),'sha256'),'hex') iap_owner_audit_guard_sha256,
 (SELECT count(*)::int FROM public.sandy_engineering_identity_events WHERE actor_kind='controller_owner' AND detail->>'boundary'='gcp_iap_repair_delegation') owner_iap_events
 FROM public.sandy_engineering_control_grants g JOIN auth.users u ON u.id=g.identity_user_id WHERE u.email='sandy-engineering-test@sandy-ai.internal'""",True)
def candidate(slug,files,sources):
 if slug=='sandy-engineering-control':return patch(files,sources['sandy-engineering-control/iap_repair.ts'],sources['sandy-engineering-control/iap_repair_jobs.ts'],sources['_shared/sandy_iap_repair_contract.ts'])
 return patch_gateway(files,sources['sandy-operation-api/iap_repair_authorization.ts'],sources['_shared/sandy_iap_repair_contract.ts'])
def inspect(r,m,sources):
 if r.sql("SELECT version FROM supabase_migrations.schema_migrations WHERE version='"+VERSION+"'",True):raise Blocked('already_installed_reconcile_read_only_no_replay')
 if r.sql("SELECT proname FROM pg_proc JOIN pg_namespace n ON n.oid=pronamespace WHERE n.nspname='public' AND proname IN("+','.join(quote(n) for n in m['rpc_source_sha256'])+")",True):raise Blocked('existing_partial_custody_schema_requires_reconciliation')
 if registry(r)!=m['registry_before']:raise Blocked('existing_engineering_contract_changed')
 state=preserved(r)
 if len(state)!=1 or state[0]['admin_read_revision']!=1 or state[0]['canary_revision']!=6 or state[0]['iap_repair_revision']!=0 or not state[0]['no_iap_grant'] or state[0]['owner_iap_events']!=0:raise Blocked('reviewed_existing_authority_state_required')
 memory=memory_prerequisite(r,m)
 if m['functions']['sandy-operation-api']['before_files']!=memory['functions']['sandy-operation-api']['candidate_files']:
  raise Blocked('reviewed_API_preimage_must_preserve_installed_memory_modules')
 before={};after={}
 for slug,expected in m['functions'].items():
  before[slug]=r.read(slug,expected);after[slug]=candidate(slug,before[slug][2],sources)
  if {k:digest(v) for k,v in after[slug].items()}!=expected['candidate_files']:raise Blocked('reviewed_candidate_module_map_changed')
 return before,after,state
def verify_installed(r,m,migration):
 report=verify_prerequisite(r)
 memory_prerequisite(r,m)
 for slug,expected in m['functions'].items():
  meta=json.loads(r.api('GET','/functions/'+slug));files=original_sources(r.api('GET','/functions/'+slug+'/body'))
  if meta.get('version',0)<=expected['version'] or meta.get('verify_jwt')!=expected['verify_jwt'] or {k:digest(v) for k,v in files.items()}!=expected['candidate_files']:raise Blocked('installed_full_source_or_ingress_mismatch')
 expected_registry=copy.deepcopy(m['registry_before'])
 variants=re.search(r"jsonb_build_array\(old\)\|\|'(.*?)'::jsonb",migration,re.S)
 if not variants:raise Blocked('reviewed_typed_job_schema_required')
 for row in expected_registry:
  if row['operation']=='engineering.implementation.request':row['input_schema']={'oneOf':[row['input_schema']]+json.loads(variants[1])}
 if registry(r)!=expected_registry:raise Blocked('installed_job_contract_or_existing_flags_changed')
 return {**report,'full_module_maps_independently_verified':True,'existing_verification_and_exposure_flags_preserved':True,'memory_schema_MCP_and_private_controls_preserved':True,'provider_execution_verified':False}
def run(r,m,sources,migration,deploy=False):
 before,after,state=inspect(r,m,sources)
 if not deploy:return {'passed':True,'preflight_passed':True,'installed':False,'IAM_changes':0,'grant_changes':0,'functions_before':{s:x[0]['version'] for s,x in before.items()}}
 if os.environ.get('GITHUB_ACTIONS')!='true' or os.environ.get('GITHUB_REF')!='refs/heads/main':raise Blocked('protected_main_release_required')
 sha=os.environ.get('GITHUB_SHA','')
 if not re.fullmatch('[a-f0-9]{40}',sha) or subprocess.check_output(['git','rev-parse','HEAD'],cwd=ROOT,text=True).strip()!=sha:raise Blocked('committed_release_source_required')
 r.out.mkdir(parents=True,exist_ok=False,mode=0o700);r.holder='iap-transport-'+uuid.uuid4().hex
 private_write(r.out,'reviewed-manifest.json',MANIFEST.read_bytes());private_write(r.out,'migration.sql',migration.encode());private_write(r.out,'preserved-authority-state.json',json.dumps(state).encode())
 for slug,(meta,body,_) in before.items():private_write(r.out,slug+'.before.body',body);private_write(r.out,slug+'.before.metadata.json',json.dumps(meta).encode())
 private_write(r.out,'rollback-stop-new-admission.sql',b'-- Preserve finish callbacks/custody/audit and reconcile every claimed outcome before code rollback.\nREVOKE ALL ON FUNCTION public.sandy_iap_repair_prepare_job(uuid,uuid,integer,uuid,text,uuid,text,text,text),public.sandy_iap_repair_job_admit(uuid,uuid,integer,uuid,text,text) FROM service_role;\n')
 private_write(r.out,'rollback-plan.txt',b'Stop new admissions. Reconcile claimed/unknown provider outcomes. Restore the exact preserved Control/API module maps and original JWT settings. Restore only the reviewed implementation-request schema if unchanged. Retain additive SQL, custody and audit. No automatic IAM rollback or production traffic change. New runtime bindings/candidate are a separate release.\n')
 leases=['BEGIN;']
 for slug,(_,body,_) in before.items():
  leases.append(f"DO $$ BEGIN INSERT INTO public.sandy_engineering_component_leases(component,holder,change_id,expected_source_sha256,expires_at) VALUES('{slug}','{r.holder}','{PROPOSAL}','{digest(body)}',clock_timestamp()+interval '15 minutes') ON CONFLICT(component) DO UPDATE SET holder=EXCLUDED.holder,change_id=EXCLUDED.change_id,expected_source_sha256=EXCLUDED.expected_source_sha256,expires_at=EXCLUDED.expires_at,acquired_at=clock_timestamp() WHERE public.sandy_engineering_component_leases.expires_at<=clock_timestamp();IF NOT FOUND THEN RAISE EXCEPTION 'component already leased';END IF;END $$;")
 r.sql('\n'.join(leases+['COMMIT;']))
 try:
  inspect(r,m,sources)
  r.sql("INSERT INTO public.sandy_engineering_change_events(change_id,event_type,actor,detail) VALUES('"+PROPOSAL+"','iap_transport_install_started',NULL,"+quote(json.dumps({'source_commit':sha,'reviewed_manifest_sha256':digest(MANIFEST.read_bytes()),'authorization_basis':'existing_authorized_protected_release','Owner_approval_recorded':False,'grant_changes':0,'IAM_changes':0}))+"::jsonb)")
  core=migration[migration.index('BEGIN;')+6:migration.rindex('COMMIT;')]
  r.stage='install_new_custody_schema'
  r.sql("BEGIN;SELECT pg_advisory_xact_lock(hashtext('sandy-iap-repair-custody-install'));"+core+"INSERT INTO supabase_migrations.schema_migrations(version,statements,name,created_by,idempotency_key) VALUES('"+VERSION+"',ARRAY["+quote(migration)+"],'sandy_iap_repair_custody','protected_github_management_release','sandy-iap-repair-custody-v1');COMMIT;")
  for slug in ['sandy-engineering-control','sandy-operation-api']:
   r.stage='install_'+slug;r.read(slug,m['functions'][slug])
   if r.sql("SELECT count(*)::int held FROM public.sandy_engineering_component_leases WHERE holder="+quote(r.holder)+" AND expires_at>clock_timestamp()",True)!=[{'held':2}]:raise Blocked('source_lease_lost')
   if preserved(r)!=state:raise Blocked('independent_authority_changed_reconcile_before_dispatch')
   memory_prerequisite(r,m)
   private_write(r.out,slug+'.upload-receipt.json',r.upload(slug,after[slug],m['functions'][slug]['verify_jwt']))
   meta=json.loads(r.api('GET','/functions/'+slug));body=r.api('GET','/functions/'+slug+'/body');private_write(r.out,slug+'.after.metadata.json',json.dumps(meta).encode());private_write(r.out,slug+'.after.body',body)
   if meta.get('version')!=m['functions'][slug]['version']+1 or meta.get('status')!='ACTIVE' or meta.get('verify_jwt')!=m['functions'][slug]['verify_jwt']:raise Blocked('deployment_unknown_outcome_reconcile_no_retry')
   verify_candidate(after[slug],original_sources(body))
  result=verify_installed(r,m,migration)
  if preserved(r)!=state:raise Blocked('existing_authority_or_owner_audit_changed')
  result.update(installed=True,source_commit=sha,existing_proposal_id=PROPOSAL,rollback_prepared=True,Cloud_Run_changes=0,production_traffic_changes=0,IAM_changes=0,grant_changes=0)
  r.sql("INSERT INTO public.sandy_engineering_change_events(change_id,event_type,actor,detail) VALUES('"+PROPOSAL+"','iap_transport_source_installed',NULL,"+quote(json.dumps(result))+"::jsonb)")
  return result
 finally:r.sql("DELETE FROM public.sandy_engineering_component_leases WHERE holder="+quote(r.holder)+" AND change_id='"+PROPOSAL+"'")
if __name__=='__main__':
 p=argparse.ArgumentParser();g=p.add_mutually_exclusive_group();g.add_argument('--deploy',action='store_true');g.add_argument('--verify-installed',action='store_true');p.add_argument('--evidence-dir',required=True);a=p.parse_args();out=Path(a.evidence_dir);r=Installer(out/'source-preservation')
 try:
  m,sources,migration=load();report=verify_installed(r,m,migration) if a.verify_installed else run(r,m,sources,migration,a.deploy)
 except Blocked as e:report={'passed':False,'error':str(e),'stage':r.stage,'last_management_request':r.last_request,'automatic_retry':False,'IAM_changes':0,'grant_changes':0}
 except Exception:report={'passed':False,'error':'source_install_failed_or_unknown_reconcile_before_retry','stage':r.stage,'last_management_request':r.last_request,'automatic_retry':False,'IAM_changes':0,'grant_changes':0}
 out.mkdir(parents=True,exist_ok=True);private_write(out,'iap-transport-release.json',json.dumps(report,indent=2).encode());print('::notice title=Protected IAP transport installation::'+json.dumps(report));raise SystemExit(0 if report.get('passed') else 1)
