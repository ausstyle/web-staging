#!/usr/bin/env python3
"""Reviewed API64 hooks; preserve IAP/MCP/worker sources and default read-only.

No Owner/grant/IAM changes, global exposure or automatic mutation retries. The
private readiness allowance is created only by the separate authenticated test.
"""
import argparse
import json
import os
from pathlib import Path
import re
import subprocess

from release_gcp_admin_read import Installer, digest, quote
from release_runtime_slice import track
from release_web_canary import Blocked, ROOT, original_sources, private_write
from customer_mutation_source_patch import patch_api

MANIFEST = ROOT/'docs/sandy-engineering/evaluations/customer-mutation-private-release.json'
SLUGS = ('sandy-api-mcp', 'sandy-task-analysis-worker', 'sandy-operation-api')
VERSIONS = ('20261024004500',)
CONFIDENCE = '55580a2e2c228ab373a65659d5304da42e36d2425a577eb90bc537f294f84b50'


def hashes(files):
    return {p: digest(v) for p,v in files.items()}


def load():
    m = json.loads(MANIFEST.read_bytes())
    if set(m['functions']) != set(SLUGS) or m.get('flags_enabled') is not False:
        raise Blocked('fixed_unpublished_correction_release_required')
    api=m['functions']['sandy-operation-api'];mcp=m['functions']['sandy-api-mcp'];worker=m['functions']['sandy-task-analysis-worker']
    changed={p for p,h in api['candidate_files'].items() if api['before_files'].get(p)!=h}
    if (api['before_version']!=64 or mcp['before_version']!=24 or worker['before_version']!=21 or api.get('redeploy') is not True
        or any(e.get('redeploy') is not False or e['candidate_files']!=e['before_files'] for e in [mcp,worker])
        or changed!={'sandy-operation-api/index.ts','sandy-operation-api/customer_mutations.ts','sandy-operation-api/task_cancellation_certification.ts','sandy-operation-api/customer_mutation_certification.ts'}):
        raise Blocked('only_reviewed_API64_hooks_MCP_and_worker_preserved')
    if digest((ROOT/'scripts/sandy/fixtures/customer_mutation_contracts_v1.json').read_bytes())!=m['contract_spec_sha256'] or digest((ROOT/'docs/sandy-engineering/evaluations/iap-repair-transport-release.json').read_bytes())!=m['preserved_IAP_manifest_sha256']:raise Blocked('reviewed_contract_or_IAP_preservation_manifest_changed')
    migrations = {}
    for p,h in m['migrations'].items():
        if not re.fullmatch(r'supabase/migrations/20261024004500_sandy_customer_mutation_private_certification[.]sql',p):
            raise Blocked('fixed_reviewed_migrations_required')
        raw = (ROOT/p).read_bytes()
        if digest(raw) != h: raise Blocked('migration_source_changed')
        migrations[p] = raw
    if len(migrations) != 1: raise Blocked('one_reviewed_migration_required')
    return m,migrations


def source_check(m):
    sha = os.environ.get('GITHUB_SHA','')
    if (os.environ.get('GITHUB_ACTIONS') != 'true' or os.environ.get('GITHUB_REF') != 'refs/heads/main'
            or not re.fullmatch('[a-f0-9]{40}',sha)
            or subprocess.check_output(['git','rev-parse','HEAD'],cwd=ROOT,text=True).strip() != sha):
        raise Blocked('protected_committed_main_release_required')
    paths = [MANIFEST.relative_to(ROOT).as_posix(), *m['migrations'],
             'scripts/sandy/release_customer_task_guard.py',
             'docs/sandy-engineering/evaluations/customer-task-guard-release.json',
             'supabase/migrations/20261024022000_sandy_customer_task_guard_commit.sql',
             'scripts/sandy/release_customer_mutation_certification.py','scripts/sandy/customer_mutation_source_patch.py',
             'scripts/sandy/release_gcp_admin_read.py','scripts/sandy/release_web_canary.py',
             'scripts/sandy/release_runtime_slice.py','scripts/sandy/verify_customer_mutation_private_mcp.py',
             '.github/workflows/sandy-customer-mutation-certification.yml',
             'docs/sandy-engineering/evaluations/memory-correction-adapter-release.json',
             'supabase/migrations/20261024004210_sandy_memory_readiness_artifact_classification.sql',
             'scripts/sandy/publish_memory_correction.py','scripts/sandy/verify_memory_normal_mcp.py',
             'scripts/sandy/memory_acceptance_evidence.py',
             'scripts/sandy/fixtures/customer_mutation_contracts_v1.json',
             'scripts/sandy/verify_memory_private_mcp.py','scripts/sandy/customer_service_acceptance.py',
             'docs/sandy-engineering/evaluations/onboarding-receipt-scope-release.json',
             'supabase/migrations/20261024004400_sandy_onboarding_receipt_scope.sql',
             'docs/sandy-engineering/evaluations/task-cancel-adapter-release.json',
             'docs/sandy-engineering/evaluations/iap-repair-transport-release.json',
             'scripts/sandy/release_memory_private_correction.py']
    for slug,e in m['functions'].items():
        paths += ['supabase/functions/'+p for p,h in e['candidate_files'].items()
                  if e['before_files'].get(p) != h and not (slug=='sandy-operation-api' and p==slug+'/index.ts')]
    for p in paths:
        if subprocess.check_output(['git','show',sha+':'+p],cwd=ROOT) != (ROOT/p).read_bytes():
            raise Blocked('committed_release_source_mismatch')
    return sha


def functions(r,m,installed=False):
    observed={}
    for slug in SLUGS:
        e=m['functions'][slug];meta=json.loads(r.api('GET','/functions/'+slug))
        body=r.api('GET','/functions/'+slug+'/body');files=original_sources(body)
        if (meta.get('status')!='ACTIVE' or meta.get('slug')!=slug or meta.get('verify_jwt') is not e['verify_jwt']
                or meta.get('version')!=e['before_version']+int(installed and e['redeploy'])
                or meta.get('import_map') or meta.get('import_map_path')
                or hashes(files)!=e['candidate_files' if installed else 'before_files']
                or not installed and digest(body)!=e['before_bundle_sha256']):
            raise Blocked('function_source_drift_reconcile_before_retry')
        observed[slug]=(meta,body,files)
    return observed


def schema(r,m,installed=False):
    row=r.sql("SELECT p.oid::text row_oid,encode(sha256(convert_to(p.prosrc,'UTF8')),'hex') sha,p.prosecdef,p.proconfig,pg_get_functiondef(p.oid) definition,p.proacl::text acl,has_function_privilege('authenticated',p.oid,'EXECUTE') customer,has_function_privilege('anon',p.oid,'EXECUTE') anon,has_function_privilege('service_role',p.oid,'EXECUTE') service FROM pg_proc p WHERE p.oid='public.sandy_api_customer_mutation(text,jsonb,text)'::regprocedure",True)[0]
    expected=m['shared_rpc_after_private_readiness_prosrc_sha256' if installed else 'shared_rpc_before_prosrc_sha256']
    if installed:
        from release_customer_task_guard import state
        expected=state(r)
    if row['sha']!=expected or not row['prosecdef'] or row['proconfig']!=['search_path=pg_catalog, pg_temp'] or not row['customer'] or row['anon'] or row['service']:
        raise Blocked('shared_RPC_source_or_security_drift')
    # Preserve the existing memory repair and immutable acceptance infrastructure.
    prior=json.loads((ROOT/'docs/sandy-engineering/evaluations/memory-correction-adapter-release.json').read_bytes())
    from publish_memory_correction import verify_publication_evidence
    verify_publication_evidence(r,prior)
    repair=prior['readiness_classification_repair'];raw=(ROOT/repair['migration']).read_text()
    history=r.sql("SELECT statements FROM supabase_migrations.schema_migrations WHERE version='20261024004210'",True)
    if history!=[{'statements':[raw]}]:raise Blocked('04210_repair_must_be_installed_without_replay')
    existing=r.sql("SELECT proname,encode(sha256(convert_to(prosrc,'UTF8')),'hex') sha,prosecdef,proconfig,pg_get_userbyid(proowner) owner FROM pg_proc WHERE oid IN('public.sandy_guard_memory_private_readiness_event()'::regprocedure,'public.sandy_api_memory_private_readiness(uuid,text,text,uuid,text)'::regprocedure) ORDER BY proname",True)
    if existing!=repair['candidate_sources']:raise Blocked('existing_memory_readiness_source_drift')
    active=r.sql("SELECT count(*)::int active FROM public.sandy_engineering_change_events i JOIN public.sandy_engineering_artifacts a ON a.id=(i.detail->>'artifact_id')::uuid WHERE i.event_type IN('memory_private_readiness_installed','task_cancel_private_readiness_installed','customer_mutation_private_readiness_installed') AND (a.metadata->>'expires_at')::timestamptz>clock_timestamp() AND NOT EXISTS(SELECT 1 FROM public.sandy_engineering_change_events e WHERE e.event_type IN('memory_private_readiness_revoked','task_cancel_private_readiness_revoked','customer_mutation_private_readiness_revoked') AND e.detail->>'artifact_id'=a.id::text)",True)
    if active!=[{'active':0}]:raise Blocked('retire_existing_private_acceptance_before_release')
    history=r.sql("SELECT version,statements FROM supabase_migrations.schema_migrations WHERE version='20261024004500'",True)
    expected=[{'version':'20261024004500','statements':[(ROOT/p).read_text()]} for p in m['migrations']] if installed else []
    if history!=expected:raise Blocked('migration_state_requires_reconciliation_no_reinstall')
    onboarding=json.loads((ROOT/'docs/sandy-engineering/evaluations/onboarding-receipt-scope-release.json').read_bytes())
    identity=r.sql("SELECT encode(sha256(convert_to(prosrc,'UTF8')),'hex') sha,prosecdef,proconfig,proacl::text acl FROM pg_proc WHERE oid='public.sandy_customer_onboarding_execute(text,jsonb,uuid)'::regprocedure",True)
    if identity!=[{'sha':onboarding['candidate_prosrc_sha256'],'prosecdef':True,'proconfig':['search_path=pg_catalog, pg_temp'],'acl':'{postgres=X/postgres,authenticated=X/postgres}'}]:raise Blocked('independent_onboarding_replay_repair_required')
    if r.sql("SELECT statements FROM supabase_migrations.schema_migrations WHERE version='20261024004400'",True)!=[{'statements':[(ROOT/onboarding['migration']).read_text()]}]:raise Blocked('onboarding_repair_history_required_no_reinstall')
    cancellation=json.loads((ROOT/'docs/sandy-engineering/evaluations/task-cancel-adapter-release.json').read_bytes())
    old=r.sql("SELECT proname,encode(sha256(convert_to(prosrc,'UTF8')),'hex') sha,prosecdef,proconfig,pg_get_userbyid(proowner) owner FROM pg_proc WHERE oid IN('public.sandy_guard_task_cancel_private_readiness_event()'::regprocedure,'public.sandy_api_task_cancel_private_readiness(uuid,text,text,uuid,text)'::regprocedure) ORDER BY proname",True)
    if old!=cancellation['private_schema_sources']:raise Blocked('narrow_cancellation_custody_source_changed')
    spec=json.loads((ROOT/'scripts/sandy/fixtures/customer_mutation_contracts_v1.json').read_bytes())
    entries=r.sql("SELECT operation,handler,permission_scope,is_mutation,api_exposed,ai_exposed,verified,input_schema,output_schema FROM public.sandy_operation_registry WHERE operation IN('tasks.create','tasks.update','tasks.complete','tasks.archive','calendar.create','calendar.update','calendar.cancel','files.rename','files.set_description','files.archive') ORDER BY operation",True)
    if len(entries)!=10:raise Blocked('existing_ten_operations_required')
    for e in entries:
        descriptor={k:e[k] for k in ['operation','handler','permission_scope','is_mutation','input_schema','output_schema']}
        h=digest(json.dumps(descriptor,sort_keys=True,separators=(',',':'),ensure_ascii=False).encode())
        if h!=spec['contracts'].get(e['operation']) or e['api_exposed'] is not True or e['ai_exposed'] is not True or e['verified'] is not False:raise Blocked('reviewed_unverified_contract_flags_must_not_change')
    if installed:
        names=['sandy_customer_mutation_contracts_v1','sandy_customer_mutation_fixture_owned','sandy_customer_mutation_fixture_set_valid','sandy_guard_customer_mutation_private_readiness_event','sandy_api_customer_mutation_private_readiness']
        protected=r.sql("SELECT proname,encode(sha256(convert_to(prosrc,'UTF8')),'hex') sha,prosecdef,proconfig,pg_get_userbyid(proowner) owner FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname=ANY(ARRAY["+','.join(quote(x) for x in names)+"]) ORDER BY proname",True)
        if protected!=m['private_schema_sources']:raise Blocked('customer_mutation_profile_source_drift')
        trigger=r.sql("SELECT tgenabled,tgtype::int type,tgisinternal internal,tgfoid='public.sandy_guard_customer_mutation_private_readiness_event()'::regprocedure fixed_guard FROM pg_trigger WHERE tgrelid='public.sandy_engineering_change_events'::regclass AND tgname='sandy_customer_mutation_private_readiness_event_guard'",True)
        if trigger!=[{'tgenabled':'O','type':31,'internal':False,'fixed_guard':True}]:raise Blocked('readiness_guard_trigger_drift')
        security=r.sql("SELECT has_function_privilege('authenticated','public.sandy_api_customer_mutation_private_readiness(uuid,text,text,text,jsonb,text)','EXECUTE') customer,has_function_privilege('anon','public.sandy_api_customer_mutation_private_readiness(uuid,text,text,text,jsonb,text)','EXECUTE') anon,has_function_privilege('service_role','public.sandy_api_customer_mutation_private_readiness(uuid,text,text,text,jsonb,text)','EXECUTE') service",True)
        if security!=[{'customer':True,'anon':False,'service':False}]:raise Blocked('readiness_RPC_ACL_drift')
    return row


def candidate(m,before):
    result={}
    for slug in SLUGS:
        result[slug]=patch_api(before[slug][2]) if slug=='sandy-operation-api' else dict(before[slug][2])
        if hashes(result[slug])!=m['functions'][slug]['candidate_files']:raise Blocked('candidate_module_digest_mismatch')
    return result


def run(r,m,migrations,deploy=False):
    before=functions(r,m);rpc=schema(r,m);after=candidate(m,before)
    if not deploy:return {'preflight_passed':True,'deployed':False,'mutations':0}
    source=source_check(m)
    r.out.mkdir(mode=0o700,parents=True,exist_ok=False)
    private_write(r.out,'manifest.json',MANIFEST.read_bytes())
    private_write(r.out,'before-shared-RPC.json',json.dumps(rpc).encode())
    contract=r.sql("SELECT input_schema,output_schema,error_contract,api_exposed,ai_exposed,verified FROM public.sandy_operation_registry WHERE operation IN('tasks.create','tasks.update','tasks.complete','tasks.archive','calendar.create','calendar.update','calendar.cancel','files.rename','files.set_description','files.archive') ORDER BY operation",True)
    private_write(r.out,'before-registry.json',json.dumps(contract).encode())
    for slug,(meta,body,_) in before.items():
        private_write(r.out,slug+'.before.body',body)
        private_write(r.out,slug+'.before.json',json.dumps(meta).encode())
    private_write(r.out,'rollback.json',json.dumps({'restore_sources_only_if_current_modules_equal':{s:hashes(v) for s,v in after.items()},'preimages':{s:s+'.before.body' for s in SLUGS},'shared_RPC_preimage':'before-shared-RPC.json','registry_preimage':'before-registry.json','schema_is_additive':True,'preserve_receipts_and_immutable_audit':True,'revoke_readiness_before_recovery':True,'no_automatic_retry_or_schema_down_migration':True}).encode())
    change=track(r,{'function':'sandy-operation-api','replacements':{'customer_mutation_certification':digest(MANIFEST.read_bytes())}},source)
    lease='BEGIN;'
    for slug in SLUGS:
        lease+=f"DO $$ BEGIN INSERT INTO public.sandy_engineering_component_leases(component,holder,change_id,expected_source_sha256,expires_at) VALUES('{slug}',{quote(r.holder)},'{change}','{m['functions'][slug]['before_bundle_sha256']}',clock_timestamp()+interval '15 minutes') ON CONFLICT(component) DO UPDATE SET holder=EXCLUDED.holder,change_id=EXCLUDED.change_id,expected_source_sha256=EXCLUDED.expected_source_sha256,expires_at=EXCLUDED.expires_at,acquired_at=clock_timestamp() WHERE public.sandy_engineering_component_leases.expires_at<=clock_timestamp();IF NOT FOUND THEN RAISE EXCEPTION 'component already leased';END IF;END $$;"
    r.sql(lease+'COMMIT;');dispatched=False;verified=False
    try:
        functions(r,m);schema(r,m)
        if r.sql(f"SELECT count(*)::int held FROM public.sandy_engineering_component_leases WHERE holder={quote(r.holder)} AND change_id='{change}' AND expires_at>clock_timestamp()",True)!=[{'held':3}]:raise Blocked('source_lease_lost')
        r.sql(f"INSERT INTO public.sandy_engineering_change_events(change_id,event_type,actor,detail) VALUES('{change}','customer_mutation_release_dispatch',NULL,{quote(json.dumps({'source_commit':source,'github_run_id':os.environ.get('GITHUB_RUN_ID'),'Owner_authority_claimed':False,'global_flags_changed':False}))}::jsonb)")
        dispatched=True
        statements='BEGIN;'
        for path,raw in sorted(migrations.items()):
            text=raw.decode();text=re.sub(r'\bBEGIN;','',text,count=1);text=re.sub(r'COMMIT;\s*$','',text)
            version=Path(path).name.split('_')[0]
            statements+=text+f"\nINSERT INTO supabase_migrations.schema_migrations(version,statements,name,created_by,idempotency_key) VALUES('{version}',ARRAY[{quote(raw.decode())}],{quote(Path(path).stem[len(version)+1:])},'protected_github_management_release','customer-mutation-{version}');"
        r.sql(statements+'COMMIT;')
        for slug in SLUGS:
            if m['functions'][slug]['redeploy']:private_write(r.out,slug+'.provider-receipt.json',r.upload(slug,after[slug],m['functions'][slug]['verify_jwt']))
        installed=functions(r,m,True);after_rpc=schema(r,m,True)
        if after_rpc.get('acl')!=rpc.get('acl') or after_rpc.get('row_oid')!=rpc.get('row_oid'):raise Blocked('canonical_RPC_ACL_changed')
        for slug,(_,body,_) in installed.items():private_write(r.out,slug+'.after.body',body)
        result={'deployed':True,'source_commit':source,'tracking_change_id':change,'versions':{s:x[0]['version'] for s,x in installed.items()},'all_modules_verified':True,'JWT_checks_preserved':True,'global_flags_changed':False,'IAM_or_grants_changed':False,'production_traffic_changed':False,'rollback_preimages_preserved':True,'customer_MCP_acceptance_passed':False}
        r.sql(f"INSERT INTO public.sandy_engineering_change_events(change_id,event_type,actor,detail) VALUES('{change}','customer_mutation_release_source_verified',NULL,{quote(json.dumps(result))}::jsonb)")
        verified=True;return result
    except Exception:
        if dispatched:
            try:r.sql(f"INSERT INTO public.sandy_engineering_change_events(change_id,event_type,actor,detail) VALUES('{change}','customer_mutation_release_outcome_unknown',NULL,'{{\"reconcile_before_retry\":true,\"automatic_retry\":false}}'::jsonb)")
            except Exception:pass
        raise
    finally:
        if not dispatched or verified:r.sql(f"DELETE FROM public.sandy_engineering_component_leases WHERE holder={quote(r.holder)} AND change_id='{change}'")


def main():
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--deploy',action='store_true');p.add_argument('--verify-installed',action='store_true');p.add_argument('--evidence-dir',required=True,type=Path);a=p.parse_args()
    if a.deploy and a.verify_installed:p.error('choose release or readback')
    r=Installer(a.evidence_dir/'private-preimages');result={'passed':False}
    try:
        m,migrations=load()
        if a.verify_installed:
            installed=functions(r,m,True);schema(r,m,True)
            result.update(source_verified=True,mutations=0,versions={s:x[0]['version'] for s,x in installed.items()})
        else:result.update(run(r,m,migrations,a.deploy))
        result['passed']=True
    except Exception as e:result.update(error=str(e) if isinstance(e,Blocked) else 'release_failed_or_unknown_reconcile_before_retry',last_management_request=r.last_request,automatic_retry=False)
    a.evidence_dir.mkdir(parents=True,exist_ok=True);private_write(a.evidence_dir,'redacted-receipt.json',json.dumps(result,indent=2).encode());print('::notice title=Customer mutation source-preserving release::'+json.dumps(result));return 0 if result['passed'] else 1
if __name__=='__main__':raise SystemExit(main())
