#!/usr/bin/env python3
"""One reviewed API60/MCP22 correction release; default preflight is read-only.

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
from memory_private_source_patch import patch_api, patch_mcp

MANIFEST = ROOT/'docs/sandy-engineering/evaluations/memory-correction-adapter-release.json'
SLUGS = ('sandy-api-mcp', 'sandy-operation-api')
VERSIONS = ('20261024004100', '20261024004200')
CONFIDENCE = '55580a2e2c228ab373a65659d5304da42e36d2425a577eb90bc537f294f84b50'


def hashes(files):
    return {p: digest(v) for p,v in files.items()}


def load():
    m = json.loads(MANIFEST.read_bytes())
    if set(m['functions']) != set(SLUGS) or m.get('flags_enabled') is not False:
        raise Blocked('fixed_unpublished_correction_release_required')
    migrations = {}
    for p,h in m['migrations'].items():
        if not re.fullmatch(r'supabase/migrations/20261024004[12]00_sandy_memory_[a-z_]+[.]sql',p):
            raise Blocked('fixed_reviewed_migrations_required')
        raw = (ROOT/p).read_bytes()
        if digest(raw) != h: raise Blocked('migration_source_changed')
        migrations[p] = raw
    if len(migrations) != 2: raise Blocked('two_reviewed_migrations_required')
    return m,migrations


def source_check(m):
    sha = os.environ.get('GITHUB_SHA','')
    if (os.environ.get('GITHUB_ACTIONS') != 'true' or os.environ.get('GITHUB_REF') != 'refs/heads/main'
            or not re.fullmatch('[a-f0-9]{40}',sha)
            or subprocess.check_output(['git','rev-parse','HEAD'],cwd=ROOT,text=True).strip() != sha):
        raise Blocked('protected_committed_main_release_required')
    paths = [MANIFEST.relative_to(ROOT).as_posix(), *m['migrations'],
             'scripts/sandy/release_memory_private_correction.py','scripts/sandy/memory_private_source_patch.py',
             'scripts/sandy/release_gcp_admin_read.py','scripts/sandy/release_web_canary.py',
             'scripts/sandy/release_runtime_slice.py','scripts/sandy/verify_memory_private_mcp.py']
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
        if (meta.get('status')!='ACTIVE' or meta.get('slug')!=slug or meta.get('verify_jwt') is not True
                or meta.get('version')!=e['before_version']+int(installed)
                or meta.get('import_map') or meta.get('import_map_path')
                or hashes(files)!=e['candidate_files' if installed else 'before_files']
                or not installed and digest(body)!=e['before_bundle_sha256']):
            raise Blocked('function_source_drift_reconcile_before_retry')
        observed[slug]=(meta,body,files)
    return observed


def schema(r,m,installed=False):
    row=r.sql("SELECT encode(sha256(convert_to(p.prosrc,'UTF8')),'hex') sha,p.prosecdef,p.proconfig,pg_get_functiondef(p.oid) definition,p.proacl::text acl,has_function_privilege('authenticated',p.oid,'EXECUTE') customer,has_function_privilege('anon',p.oid,'EXECUTE') anon,has_function_privilege('service_role',p.oid,'EXECUTE') service FROM pg_proc p WHERE p.oid='public.sandy_api_customer_mutation(text,jsonb,text)'::regprocedure",True)[0]
    expected=m['shared_rpc_after_private_readiness_prosrc_sha256' if installed else 'shared_rpc_before_prosrc_sha256']
    if row['sha']!=expected or not row['prosecdef'] or row['proconfig']!=['search_path=pg_catalog, pg_temp'] or not row['customer'] or row['anon'] or row['service']:
        raise Blocked('shared_RPC_source_or_security_drift')
    private=r.sql("SELECT encode(sha256(convert_to(prosrc,'UTF8')),'hex') sha FROM pg_proc WHERE oid='sandy_private.correct_customer_fact(uuid,uuid,text)'::regprocedure",True)
    if private!=[{'sha':CONFIDENCE}]:raise Blocked('confidence_repair_precondition_not_met')
    history=r.sql("SELECT version FROM supabase_migrations.schema_migrations WHERE version IN('20261024004100','20261024004200') ORDER BY version",True)
    if history!=([{'version':v} for v in VERSIONS] if installed else []):
        raise Blocked('migration_state_requires_reconciliation_no_reinstall')
    flags=r.sql("SELECT api_exposed,ai_exposed,verified FROM public.sandy_operation_registry WHERE operation='memory.fact_correct'",True)
    if flags!=[{'api_exposed':False,'ai_exposed':False,'verified':False}]:raise Blocked('private_certification_must_not_change_global_exposure')
    if installed:
        security=r.sql("SELECT has_function_privilege('authenticated','public.sandy_api_memory_private_readiness(uuid,text,text,uuid,text)','EXECUTE') customer,has_function_privilege('anon','public.sandy_api_memory_private_readiness(uuid,text,text,uuid,text)','EXECUTE') anon,has_function_privilege('service_role','public.sandy_api_memory_private_readiness(uuid,text,text,uuid,text)','EXECUTE') service",True)
        if security!=[{'customer':True,'anon':False,'service':False}]:raise Blocked('readiness_RPC_ACL_drift')
    return row


def candidate(m,before):
    result={}
    for slug in SLUGS:
        result[slug]=(patch_api if slug=='sandy-operation-api' else patch_mcp)(before[slug][2])
        if hashes(result[slug])!=m['functions'][slug]['candidate_files']:raise Blocked('candidate_module_digest_mismatch')
    return result


def run(r,m,migrations,deploy=False):
    before=functions(r,m);rpc=schema(r,m);after=candidate(m,before)
    if not deploy:return {'preflight_passed':True,'deployed':False,'mutations':0}
    source=source_check(m)
    r.out.mkdir(mode=0o700,parents=True,exist_ok=False)
    private_write(r.out,'manifest.json',MANIFEST.read_bytes())
    private_write(r.out,'before-shared-RPC.json',json.dumps(rpc).encode())
    contract=r.sql("SELECT input_schema,output_schema,error_contract,api_exposed,ai_exposed,verified FROM public.sandy_operation_registry WHERE operation='memory.fact_correct'",True)
    private_write(r.out,'before-registry.json',json.dumps(contract).encode())
    for slug,(meta,body,_) in before.items():
        private_write(r.out,slug+'.before.body',body)
        private_write(r.out,slug+'.before.json',json.dumps(meta).encode())
    private_write(r.out,'rollback.json',json.dumps({'restore_sources_only_if_current_modules_equal':{s:hashes(v) for s,v in after.items()},'preimages':{s:s+'.before.body' for s in SLUGS},'shared_RPC_preimage':'before-shared-RPC.json','registry_preimage':'before-registry.json','schema_is_additive':True,'preserve_receipts_and_immutable_audit':True,'revoke_readiness_before_recovery':True,'no_automatic_retry_or_schema_down_migration':True}).encode())
    change=track(r,{'function':'sandy-operation-api','replacements':{'memory_private_correction':digest(MANIFEST.read_bytes())}},source)
    lease='BEGIN;'
    for slug in SLUGS:
        lease+=f"DO $$ BEGIN INSERT INTO public.sandy_engineering_component_leases(component,holder,change_id,expected_source_sha256,expires_at) VALUES('{slug}',{quote(r.holder)},'{change}','{m['functions'][slug]['before_bundle_sha256']}',clock_timestamp()+interval '15 minutes') ON CONFLICT(component) DO UPDATE SET holder=EXCLUDED.holder,change_id=EXCLUDED.change_id,expected_source_sha256=EXCLUDED.expected_source_sha256,expires_at=EXCLUDED.expires_at,acquired_at=clock_timestamp() WHERE public.sandy_engineering_component_leases.expires_at<=clock_timestamp();IF NOT FOUND THEN RAISE EXCEPTION 'component already leased';END IF;END $$;"
    r.sql(lease+'COMMIT;');dispatched=False;verified=False
    try:
        functions(r,m);schema(r,m)
        if r.sql(f"SELECT count(*)::int held FROM public.sandy_engineering_component_leases WHERE holder={quote(r.holder)} AND change_id='{change}' AND expires_at>clock_timestamp()",True)!=[{'held':2}]:raise Blocked('source_lease_lost')
        r.sql(f"INSERT INTO public.sandy_engineering_change_events(change_id,event_type,actor,detail) VALUES('{change}','memory_correction_release_dispatch',NULL,{quote(json.dumps({'source_commit':source,'github_run_id':os.environ.get('GITHUB_RUN_ID'),'Owner_authority_claimed':False,'global_flags_changed':False}))}::jsonb)")
        dispatched=True
        statements='BEGIN;'
        for path,raw in sorted(migrations.items()):
            text=raw.decode();text=re.sub(r'\bBEGIN;','',text,count=1);text=re.sub(r'COMMIT;\s*$','',text)
            version=Path(path).name.split('_')[0]
            statements+=text+f"\nINSERT INTO supabase_migrations.schema_migrations(version,statements,name,created_by,idempotency_key) VALUES('{version}',ARRAY[{quote(raw.decode())}],{quote(Path(path).stem[len(version)+1:])},'protected_github_management_release','memory-correction-{version}');"
        r.sql(statements+'COMMIT;')
        for slug in SLUGS:
            private_write(r.out,slug+'.provider-receipt.json',r.upload(slug,after[slug],True))
        installed=functions(r,m,True);schema(r,m,True)
        for slug,(_,body,_) in installed.items():private_write(r.out,slug+'.after.body',body)
        result={'deployed':True,'source_commit':source,'tracking_change_id':change,'versions':{s:x[0]['version'] for s,x in installed.items()},'all_modules_verified':True,'JWT_checks_preserved':True,'global_flags_changed':False,'IAM_or_grants_changed':False,'production_traffic_changed':False,'rollback_preimages_preserved':True,'customer_MCP_acceptance_passed':False}
        r.sql(f"INSERT INTO public.sandy_engineering_change_events(change_id,event_type,actor,detail) VALUES('{change}','memory_correction_release_source_verified',NULL,{quote(json.dumps(result))}::jsonb)")
        verified=True;return result
    except Exception:
        if dispatched:
            try:r.sql(f"INSERT INTO public.sandy_engineering_change_events(change_id,event_type,actor,detail) VALUES('{change}','memory_correction_release_outcome_unknown',NULL,'{{\"reconcile_before_retry\":true,\"automatic_retry\":false}}'::jsonb)")
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
            installed=functions(r,m,True);schema(r,m,True);result.update(source_verified=True,mutations=0,versions={s:x[0]['version'] for s,x in installed.items()})
        else:result.update(run(r,m,migrations,a.deploy))
        result['passed']=True
    except Exception as e:result.update(error=str(e) if isinstance(e,Blocked) else 'release_failed_or_unknown_reconcile_before_retry',last_management_request=r.last_request,automatic_retry=False)
    a.evidence_dir.mkdir(parents=True,exist_ok=True);private_write(a.evidence_dir,'redacted-receipt.json',json.dumps(result,indent=2).encode());print('::notice title=Private memory correction release::'+json.dumps(result));return 0 if result['passed'] else 1
if __name__=='__main__':raise SystemExit(main())
