#!/usr/bin/env python3
"""Source-pinned schema-only readiness classification repair, never redeployment."""
import argparse
import json
import os
from pathlib import Path
import re
import subprocess
from release_gcp_admin_read import Installer,digest,quote
from release_web_canary import Blocked,ROOT,private_write
from release_memory_private_correction import load,functions,schema,source_check,MANIFEST
from release_runtime_slice import track

VERSION='20261024004210'

def preflight(r,m,installed=False):
    observed=functions(r,m,True);schema(r,m,True)
    repair=m['readiness_classification_repair'];path=ROOT/repair['migration'];raw=path.read_bytes()
    if digest(raw)!=repair['migration_sha256']:raise Blocked('reviewed_readiness_repair_source_changed')
    history=r.sql("SELECT version,statements FROM supabase_migrations.schema_migrations WHERE version='20261024004210'",True)
    if history!=([{'version':VERSION,'statements':[raw.decode()]}] if installed else []):raise Blocked('readiness_repair_state_requires_reconciliation_no_replay')
    active=r.sql("SELECT count(*)::int active FROM public.sandy_engineering_change_events i JOIN public.sandy_engineering_artifacts a ON a.id=(i.detail->>'artifact_id')::uuid WHERE i.event_type='memory_private_readiness_installed' AND (a.metadata->>'expires_at')::timestamptz>clock_timestamp() AND NOT EXISTS(SELECT 1 FROM public.sandy_engineering_change_events e WHERE e.event_type='memory_private_readiness_revoked' AND e.detail->>'artifact_id'=a.id::text)",True)
    if active!=[{'active':0}]:raise Blocked('retire_existing_readiness_before_repair')
    return observed,raw


def apply(r,m,mutate=False):
    before,raw=preflight(r,m)
    if not mutate:return {'preflight_passed':True,'mutations':0,'functions_redeployed':0}
    source=source_check(m)
    for path in ['scripts/sandy/repair_memory_readiness_custody.py','scripts/sandy/verify_memory_private_mcp.py',m['readiness_classification_repair']['migration']]:
        if subprocess.check_output(['git','show',source+':'+path],cwd=ROOT)!=(ROOT/path).read_bytes():raise Blocked('committed_forward_repair_source_required')
    r.out.mkdir(mode=0o700,parents=True,exist_ok=False)
    custody=r.sql("SELECT oid::text,proname,pg_get_functiondef(oid) definition,proacl::text acl FROM pg_proc WHERE oid IN('public.sandy_guard_memory_private_readiness_event()'::regprocedure,'public.sandy_api_memory_private_readiness(uuid,text,text,uuid,text)'::regprocedure) ORDER BY proname",True)
    private_write(r.out,'before-guard-functions.json',json.dumps(custody).encode());private_write(r.out,'manifest.json',MANIFEST.read_bytes())
    private_write(r.out,'recovery.json',json.dumps({'do_not_reinstall_or_redeploy':True,'preimage':'before-guard-functions.json','revoke_only_recorded_readiness':True,'preserve_receipts_and_audit':True,'forward_repair_or_restore_only_if_current_sources_match_manifest':m['readiness_classification_repair']['candidate_sources']}).encode())
    change=track(r,{'function':'sandy-operation-api','replacements':{'memory_readiness_artifact_classification':digest(raw)}},source)
    lease='BEGIN;'
    for slug,x in before.items():
        lease+=f"DO $$ BEGIN INSERT INTO public.sandy_engineering_component_leases(component,holder,change_id,expected_source_sha256,expires_at) VALUES('{slug}',{quote(r.holder)},'{change}','{digest(x[1])}',clock_timestamp()+interval '10 minutes') ON CONFLICT(component) DO UPDATE SET holder=EXCLUDED.holder,change_id=EXCLUDED.change_id,expected_source_sha256=EXCLUDED.expected_source_sha256,expires_at=EXCLUDED.expires_at,acquired_at=clock_timestamp() WHERE public.sandy_engineering_component_leases.expires_at<=clock_timestamp();IF NOT FOUND THEN RAISE EXCEPTION 'component already leased';END IF;END $$;"
    r.sql(lease+'COMMIT;');dispatched=verified=False
    try:
        preflight(r,m)
        if r.sql(f"SELECT count(*)::int held FROM public.sandy_engineering_component_leases WHERE holder={quote(r.holder)} AND change_id='{change}' AND expires_at>clock_timestamp()",True)!=[{'held':2}]:raise Blocked('source_lease_lost')
        r.sql(f"INSERT INTO public.sandy_engineering_change_events(change_id,event_type,actor,detail) VALUES('{change}','memory_readiness_classification_repair_dispatch',NULL,{quote(json.dumps({'source_commit':source,'github_run_id':os.environ.get('GITHUB_RUN_ID'),'functions_redeployed':0,'Owner_authority_claimed':False,'global_flags_changed':False}))}::jsonb)")
        dispatched=True
        sql=re.sub(r'\bBEGIN;','',raw.decode(),count=1);sql=re.sub(r'COMMIT;\s*$','',sql)
        r.sql('BEGIN;'+sql+f"INSERT INTO supabase_migrations.schema_migrations(version,statements,name,created_by,idempotency_key) VALUES('{VERSION}',ARRAY[{quote(raw.decode())}],'sandy_memory_readiness_artifact_classification','protected_github_management_release','memory-readiness-classification-{VERSION}');COMMIT;")
        preflight(r,m,True)
        after=r.sql("SELECT oid::text,proname,proacl::text acl FROM pg_proc WHERE oid IN('public.sandy_guard_memory_private_readiness_event()'::regprocedure,'public.sandy_api_memory_private_readiness(uuid,text,text,uuid,text)'::regprocedure) ORDER BY proname",True)
        if after!=[{k:v for k,v in x.items() if k!='definition'} for x in custody]:raise Blocked('function_OID_or_ACL_changed')
        result={'source_commit':source,'tracking_change_id':change,'migration':VERSION,'source_and_ACL_verified':True,'function_OIDs_preserved':True,'functions_redeployed':0,'API_version':61,'MCP_version':23,'global_flags_changed':False,'new_grants':0,'traffic_changed':False,'actual_MCP_acceptance_claimed':False}
        r.sql(f"INSERT INTO public.sandy_engineering_change_events(change_id,event_type,actor,detail) VALUES('{change}','memory_readiness_classification_repair_verified',NULL,{quote(json.dumps(result))}::jsonb)")
        verified=True;return result
    except Exception:
        if dispatched:
            try:r.sql(f"INSERT INTO public.sandy_engineering_change_events(change_id,event_type,actor,detail) VALUES('{change}','memory_readiness_repair_outcome_unknown',NULL,'{{\"reconcile_before_retry\":true,\"automatic_retry\":false}}'::jsonb)")
            except Exception:pass
        raise
    finally:
        if not dispatched or verified:r.sql(f"DELETE FROM public.sandy_engineering_component_leases WHERE holder={quote(r.holder)} AND change_id='{change}'")


def main():
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--apply',action='store_true');p.add_argument('--verify-installed',action='store_true');p.add_argument('--evidence-dir',required=True,type=Path);a=p.parse_args()
    if a.apply and a.verify_installed:p.error('choose repair or readback')
    r=Installer(a.evidence_dir/'private-preimages');result={'passed':False}
    try:
        m,_=load()
        if a.verify_installed:preflight(r,m,True);result.update(source_verified=True,mutations=0,functions_redeployed=0)
        else:result.update(apply(r,m,a.apply))
        result['passed']=True
    except Exception as e:result.update(error=str(e) if isinstance(e,Blocked) else 'repair_failed_or_unknown_reconcile_before_retry',last_management_request=r.last_request,automatic_retry=False)
    a.evidence_dir.mkdir(parents=True,exist_ok=True);private_write(a.evidence_dir,'redacted-receipt.json',json.dumps(result,indent=2).encode());print('::notice title=Readiness custody repair::'+json.dumps(result));return 0 if result['passed'] else 1
if __name__=='__main__':raise SystemExit(main())
