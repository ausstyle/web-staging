#!/usr/bin/env python3
"""Bounded V4 release under the existing genuinely approved ENG0001 change.

This does not grant delegation or approve a child change. The existing project
administrator deploys only approved V4/WhatsApp targets; Control records source, tests and receipts using
the normal engineering identity. Security-policy/Controller releases keep their
separate protected workflow. Default mode performs read-only preflight.
"""
import argparse
import json
from pathlib import Path
import subprocess
import uuid
from engineering_control_client import control
from read_edge_originals import whatsapp_original_sources
from release_delegated_runtime import load_manifest, upload, digest
from release_web_canary import Release, Blocked, check_live, original_sources, private_write, ROOT

CHANGE='7edbee5b-4185-4f6b-b7b1-b41899d4dfc8'
SLUG='sandy-agent-runtime-v4'
TARGETS={SLUG,'sandy-whatsapp-webhook'}
BRANCH='engineering/sandy-unified-intelligence-20261021'

def verify_ci(source, tested):
    if len(tested)!=40 or any(c not in '0123456789abcdef' for c in tested):raise Blocked('invalid_tested_commit')
    subprocess.run(['git','merge-base','--is-ancestor',source,tested],cwd=ROOT,check=True)
    changed=subprocess.check_output(['git','diff','--name-only',source,tested],cwd=ROOT,text=True).splitlines()
    if any(not p.startswith('docs/sandy-engineering/evaluations/') or not p.endswith(('.json','.md')) for p in changed):raise Blocked('ci_did_not_test_exact_executable_source')
    result=json.loads(subprocess.check_output(['gh','api',f'repos/ausstyle/web-staging/commits/{tested}/check-runs'],cwd=ROOT))
    checks=[c for c in result.get('check_runs',[]) if c.get('app',{}).get('slug')=='github-actions' and c.get('head_sha')==tested]
    required={'offline-contract-tests','examiner-evidence-tests','sandy-runtime-release-checks','api-contract-tests','vm-protocol-contract-tests'}
    if not all(any(c.get('name')==name and c.get('status')=='completed' and c.get('conclusion')=='success' for c in checks) for name in required):raise Blocked('independent_latest_source_ci_required')
    if any(c.get('conclusion') in ('failure','timed_out','action_required') for c in checks):raise Blocked('current_ci_failure')

class ApprovedRuntime(Release):
    def __init__(self,m,files,out,pin,tested):
        super().__init__(m,files,out);self.pin=pin;self.tested=tested
    def admission(self,lease=False):
        m=self.manifest
        slug=m.get('function')
        if slug not in TARGETS or m.get('change_id')!=CHANGE or m.get('branch')!=BRANCH:raise Blocked('only_existing_eng0001_v4_scope_supported')
        status,current=control({'action':'get','change_id':CHANGE},self.credential)
        if status!=200 or current.get('change',{}).get('status')!='approved' or slug not in current.get('change',{}).get('scope',[]):raise Blocked('existing_control_scope_not_approved')
        proof=self.sql(f"""SELECT EXISTS(SELECT 1 FROM public.sandy_engineering_changes c
          JOIN public.sandy_engineering_change_events e ON e.change_id=c.id
          JOIN public.sandy_controller_admins a ON a.auth_user_id=e.actor AND a.enabled AND a.role='owner'
          JOIN auth.users u ON u.id=e.actor AND coalesce(u.raw_app_meta_data->>'sandy_engineering_test','false')<>'true'
          WHERE c.id='{CHANGE}' AND c.status='approved' AND c.risk='normal' AND c.scope ? '{slug}'
          AND c.scope ? 'github:ausstyle/web-staging:{BRANCH}'
          AND e.event_type='status_changed' AND e.detail->>'to'='approved'
          AND e.detail->>'reason'=c.expected_behavior) AS admitted""")
        if proof!=[{'admitted':True}]:raise Blocked('genuine_existing_owner_scope_not_verified')
        if not any(t.get('outcome')=='passed' and t.get('evidence',{}).get('manifest_sha256')==self.pin and t.get('evidence',{}).get('source_commit')==m['source_commit'] and t.get('evidence',{}).get('ci_commit')==self.tested for t in current.get('tests',[])):raise Blocked('pinned_candidate_test_evidence_required')
        if lease and self.sql(f"SELECT count(*)::integer AS held FROM public.sandy_engineering_component_leases WHERE component='{slug}' AND holder='{self.holder}' AND change_id='{CHANGE}' AND expires_at>clock_timestamp()")!=[{'held':1}]:raise Blocked('component_lease_lost')

def verify_release_harness(source):
    for name in ('scripts/sandy/release_eng0001_v4.py','scripts/sandy/read_edge_originals.py'):
        committed=subprocess.check_output(['git','show',source+':'+name],cwd=ROOT)
        if (ROOT/name).read_bytes()!=committed:raise Blocked('release_harness_changed_after_ci')

def run(r,deploy):
    m=r.manifest;slug=m['function'];guard={**m,'slug':slug};modules=original_sources if slug==SLUG else whatsapp_original_sources;verify_ci(m['source_commit'],r.tested);r.admission()
    verify_release_harness(m['source_commit'])
    meta=r.api('GET','/functions/'+slug);before=r.api('GET','/functions/'+slug+'/body');check_live(guard,json.loads(meta),before)
    if slug!='sandy-agent-runtime-v4' and ({p:digest(v) for p,v in modules(before).items()}!=m.get('prior_original_files')):raise Blocked('original_prior_channel_source_not_verified')
    if not deploy:return {'preflight_passed':True,'existing_owner_scope_verified':True,'deployed':False}
    private_write(r.evidence,'before-metadata.json',meta);private_write(r.evidence,'before.body',before)
    private_write(r.evidence,'rollback-modules.json',json.dumps({p:digest(v) for p,v in modules(before).items()}).encode())
    r.sql(f"""DO $$ BEGIN INSERT INTO public.sandy_engineering_component_leases(component,holder,change_id,expected_source_sha256,expires_at)
    VALUES('{slug}','{r.holder}','{CHANGE}','{m['prior_bundle_sha256']}',clock_timestamp()+interval '10 minutes')
    ON CONFLICT(component) DO UPDATE SET holder=EXCLUDED.holder,change_id=EXCLUDED.change_id,expected_source_sha256=EXCLUDED.expected_source_sha256,expires_at=EXCLUDED.expires_at,acquired_at=clock_timestamp()
    WHERE public.sandy_engineering_component_leases.expires_at<=clock_timestamp();IF NOT FOUND THEN RAISE EXCEPTION 'component already leased';END IF;END $$;""")
    dispatched=False;verified=False
    try:
        r.admission(True);verify_ci(m['source_commit'],r.tested)
        check_live(guard,json.loads(r.api('GET','/functions/'+slug)),r.api('GET','/functions/'+slug+'/body'))
        dispatched=True
        private_write(r.evidence,'provider-receipt.json',upload(r,m,r.sources))
        after=r.api('GET','/functions/'+slug+'/body');actual=json.loads(r.api('GET','/functions/'+slug));private_write(r.evidence,'after.body',after)
        if actual.get('version')!=m['expected_prior_version']+1 or actual.get('status')!='ACTIVE' or actual.get('verify_jwt') is not False or modules(after)!=r.sources:raise Blocked('deployment_outcome_requires_source_reconciliation_no_retry')
        verified=True
        result={'change_id':CHANGE,'function':slug,'authorization_basis':'existing_genuine_owner_approved_runtime_scope','source_commit':m['source_commit'],'manifest_sha256':r.pin,'ci_commit':r.tested,'deployed_version':actual['version'],'bundle_sha256':digest(after),'original_modules_verified':len(r.sources),'rollback_captured':True,'rollback_exercised':False,'approval_created':False,'standing_policy_changed':False,'customer_records_edited':False,'functional_acceptance_passed':False}
        r.sql(f"INSERT INTO public.sandy_engineering_change_events(change_id,event_type,actor,detail) VALUES('{CHANGE}','approved_runtime_source_verified',NULL,'"+json.dumps({'actor_kind':'project_management_release','evidence':result}).replace("'","''")+"'::jsonb)")
        private_write(r.evidence,'redacted-receipt.json',json.dumps(result,indent=2).encode())
        status,_=control({'action':'artifact','change_id':CHANGE,'artifact_type':'edge_function','target':slug,'before_ref':'version:'+str(m['expected_prior_version']),'after_ref':'version:'+str(actual['version']),'rollback_strategy':'redeploy_prior','rollback_notes':m['rollback'],'metadata':result},r.credential)
        if status!=201:raise Blocked('source_deployed_artifact_recording_failed_do_not_replay')
        return result
    finally:
        if not dispatched or verified:r.sql(f"DELETE FROM public.sandy_engineering_component_leases WHERE component='{slug}' AND holder='{r.holder}' AND change_id='{CHANGE}'")

if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('manifest',type=Path);p.add_argument('--ci-commit',required=True);p.add_argument('--deploy',action='store_true');p.add_argument('--evidence-dir',type=Path);args=p.parse_args()
    m,files,pin=load_manifest(args.manifest);out=args.evidence_dir or Path('/tmp')/('eng0001-v4-'+uuid.uuid4().hex)
    if out.resolve().is_relative_to(ROOT):raise Blocked('private_evidence_outside_repository_required')
    if args.deploy:out.mkdir(mode=0o700)
    print(json.dumps(run(ApprovedRuntime(m,files,out,pin,args.ci_commit),args.deploy)))
