#!/usr/bin/env python3
"""One source-pinned identity replay boundary repair; never redeploys handlers."""
import argparse
import json
import os
from pathlib import Path
import re
import subprocess
from release_gcp_admin_read import Installer,digest,quote
from release_web_canary import ROOT,Blocked,private_write
from release_runtime_slice import track

MANIFEST=ROOT/'docs/sandy-engineering/evaluations/onboarding-receipt-scope-release.json'
VERSION='20261024004400'
FUNCTION='public.sandy_customer_onboarding_execute(text,jsonb,uuid)'

def load():
    m=json.loads(MANIFEST.read_bytes());raw=(ROOT/m['migration']).read_bytes()
    if m['function']!=FUNCTION or m['migration']!='supabase/migrations/20261024004400_sandy_onboarding_receipt_scope.sql' or digest(raw)!=m['migration_sha256']:raise Blocked('fixed_reviewed_onboarding_boundary_required')
    return m,raw

def inspect(r,m,installed=False):
    expected=m['original_execution_surface'];slug=expected['function']
    meta=json.loads(r.api('GET','/functions/'+slug));body=r.api('GET','/functions/'+slug+'/body')
    if meta.get('version')!=expected['version'] or meta.get('verify_jwt') is not True or meta.get('status')!='ACTIVE' or digest(body)!=expected['bundle_sha256']:raise Blocked('existing_application_source_drift_requires_reconciliation')
    snapshot=r.sql("SELECT p.oid::text,encode(sha256(convert_to(p.prosrc,'UTF8')),'hex') source_sha256,pg_get_functiondef(p.oid) definition,p.prosecdef,p.proconfig,p.proacl::text acl,has_function_privilege('authenticated',p.oid,'EXECUTE') customer,has_function_privilege('anon',p.oid,'EXECUTE') anon,has_function_privilege('service_role',p.oid,'EXECUTE') service FROM pg_proc p WHERE p.oid='public.sandy_customer_onboarding_execute(text,jsonb,uuid)'::regprocedure",True)
    if len(snapshot)!=1:raise Blocked('existing_onboarding_function_required')
    row=snapshot[0]
    if row['source_sha256']!=m['candidate_prosrc_sha256' if installed else 'before_prosrc_sha256'] or row['prosecdef'] is not True or row['proconfig']!=['search_path=pg_catalog, pg_temp'] or row['acl']!='{postgres=X/postgres,authenticated=X/postgres}' or row['customer'] is not True or row['anon'] or row['service']:raise Blocked('onboarding_source_or_privilege_drift')
    history=r.sql("SELECT version,statements FROM supabase_migrations.schema_migrations WHERE version='20261024004400'",True)
    if history!=([{'version':VERSION,'statements':[(ROOT/m['migration']).read_text()]}] if installed else []):raise Blocked('onboarding_migration_state_requires_reconciliation_no_replay')
    return row

def source_check(m):
    sha=os.environ.get('GITHUB_SHA','')
    if os.environ.get('GITHUB_ACTIONS')!='true' or os.environ.get('GITHUB_REF')!='refs/heads/main' or not re.fullmatch('[a-f0-9]{40}',sha) or subprocess.check_output(['git','rev-parse','HEAD'],cwd=ROOT,text=True).strip()!=sha:raise Blocked('protected_committed_main_release_required')
    for p in [MANIFEST.relative_to(ROOT).as_posix(),m['migration'],'scripts/sandy/release_onboarding_receipt_scope.py','scripts/sandy/verify_onboarding_receipt_scope.py','scripts/sandy/release_gcp_admin_read.py','scripts/sandy/release_web_canary.py','scripts/sandy/release_runtime_slice.py']:
        if subprocess.check_output(['git','show',sha+':'+p],cwd=ROOT)!=(ROOT/p).read_bytes():raise Blocked('reviewed_release_source_required')
    return sha

def flags(r):
    return r.sql("SELECT operation,handler,permission_scope,api_exposed,ai_exposed,verified,error_contract->>'contract_sha256' contract_sha256 FROM public.sandy_operation_registry WHERE operation IN('customer.onboarding.ensure','customer.onboarding.update','customer.identity.get') ORDER BY operation",True)

def run(r,m,raw,deploy=False):
    before=inspect(r,m);registry=flags(r)
    if not deploy:return {'preflight_passed':True,'mutations':0,'handler_redeployments':0}
    source=source_check(m);r.out.mkdir(mode=0o700,parents=True,exist_ok=False)
    private_write(r.out,'before-rpc.json',json.dumps(before).encode());private_write(r.out,'before-registry.json',json.dumps(registry).encode());private_write(r.out,'manifest.json',MANIFEST.read_bytes())
    private_write(r.out,'recovery.json',json.dumps({'forward_repair_only':True,'do_not_restore_missing_binding_receipt_disclosure':True,'preserve_receipts_audit_and_customer_data':True,'no_automatic_retry':True,'known_candidate_source':m['candidate_prosrc_sha256']}).encode())
    change=track(r,{'function':'sandy-customer-provisioning-api','replacements':{'onboarding_receipt_scope':digest(raw)}},source)
    r.sql("DO $$ BEGIN INSERT INTO public.sandy_engineering_component_leases(component,holder,change_id,expected_source_sha256,expires_at) VALUES('sandy-customer-onboarding-rpc',"+quote(r.holder)+","+quote(change)+","+quote(m['before_prosrc_sha256'])+",clock_timestamp()+interval '10 minutes') ON CONFLICT(component) DO UPDATE SET holder=EXCLUDED.holder,change_id=EXCLUDED.change_id,expected_source_sha256=EXCLUDED.expected_source_sha256,expires_at=EXCLUDED.expires_at,acquired_at=clock_timestamp() WHERE public.sandy_engineering_component_leases.expires_at<=clock_timestamp();IF NOT FOUND THEN RAISE EXCEPTION 'component already leased';END IF;END $$")
    dispatched=verified=False
    try:
        inspect(r,m)
        if r.sql("SELECT count(*)::int held FROM public.sandy_engineering_component_leases WHERE component='sandy-customer-onboarding-rpc' AND holder="+quote(r.holder)+" AND change_id="+quote(change)+" AND expires_at>clock_timestamp()",True)!=[{'held':1}]:raise Blocked('onboarding_source_lease_lost')
        r.sql("INSERT INTO public.sandy_engineering_change_events(change_id,event_type,actor,detail) VALUES("+quote(change)+",'onboarding_receipt_scope_dispatch',NULL,"+quote(json.dumps({'source_commit':source,'github_run_id':os.environ.get('GITHUB_RUN_ID'),'Owner_authority_created':False,'customer_records_changed':False,'handler_redeployments':0}))+"::jsonb)")
        dispatched=True
        sql=re.sub(r'\bBEGIN;','',raw.decode(),count=1);sql=re.sub(r'COMMIT;\s*$','',sql)
        r.sql('BEGIN;'+sql+"INSERT INTO supabase_migrations.schema_migrations(version,statements,name,created_by,idempotency_key) VALUES('20261024004400',ARRAY["+quote(raw.decode())+"],'sandy_onboarding_receipt_scope','protected_github_management_release','sandy-onboarding-receipt-scope-20261024004400');COMMIT;")
        after=inspect(r,m,True)
        if after['oid']!=before['oid'] or after['acl']!=before['acl'] or flags(r)!=registry:raise Blocked('unrelated_identity_permissions_or_catalogue_changed')
        result={'source_commit':source,'tracking_change_id':change,'migration':VERSION,'RPC_source_verified':True,'function_OID_and_ACL_preserved':True,'handler_redeployments':0,'registry_changes':0,'customer_record_changes':0,'actual_MCP_acceptance_verified':False}
        r.sql("INSERT INTO public.sandy_engineering_change_events(change_id,event_type,actor,detail) VALUES("+quote(change)+",'onboarding_receipt_scope_source_verified',NULL,"+quote(json.dumps(result))+"::jsonb)")
        verified=True;return result
    except Exception:
        if dispatched:
            try:r.sql("INSERT INTO public.sandy_engineering_change_events(change_id,event_type,actor,detail) VALUES("+quote(change)+",'onboarding_receipt_scope_outcome_unknown',NULL,'{\"automatic_retry\":false,\"reconcile_before_retry\":true}'::jsonb)")
            except Exception:pass
        raise
    finally:
        if not dispatched or verified:r.sql("DELETE FROM public.sandy_engineering_component_leases WHERE component='sandy-customer-onboarding-rpc' AND holder="+quote(r.holder)+" AND change_id="+quote(change))

def main():
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--deploy',action='store_true');p.add_argument('--verify-installed',action='store_true');p.add_argument('--evidence-dir',required=True,type=Path);a=p.parse_args()
    if a.deploy and a.verify_installed:p.error('choose release or readback')
    r=Installer(a.evidence_dir/'private-custody');result={'passed':False}
    try:
        m,raw=load()
        if a.verify_installed:inspect(r,m,True);result.update(installed_source_verified=True,mutations=0)
        else:result.update(run(r,m,raw,a.deploy))
        result['passed']=True
    except Exception as e:result.update(error=str(e) if isinstance(e,Blocked) else 'release_failed_or_unknown_reconcile_before_retry',last_management_request=r.last_request,automatic_retry=False)
    a.evidence_dir.mkdir(parents=True,exist_ok=True);private_write(a.evidence_dir,'redacted-receipt.json',json.dumps(result,indent=2).encode());print('::notice title=Onboarding receipt scope release::'+json.dumps(result));return 0 if result['passed'] else 1
if __name__=='__main__':raise SystemExit(main())
