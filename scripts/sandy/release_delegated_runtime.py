#!/usr/bin/env python3
"""Run a bounded runtime release after genuine Engineering Control policy admission.

Uses the existing renewable workload and intended Management deployment binding.
Never creates delegation, changes approval status or impersonates an owner. The
server must already grant authorize_release. Default mode performs read-only
source/version checks. A source release is not customer functional acceptance.
"""
from __future__ import annotations
import argparse
import hashlib
import json
from pathlib import Path
import re
import subprocess
import uuid
from engineering_control_client import control
from release_web_canary import Release, Blocked, ROOT, check_live, original_sources, private_write

TARGETS = {'sandy-agent-runtime-v4','sandy-workspace','sandy-email-runtime-canary','email-ai-generate-draft','sandy-whatsapp-webhook','sandy-voice-account-context'}
def digest(raw): return hashlib.sha256(raw).hexdigest()
def load_manifest(path):
    raw=path.read_bytes();m=json.loads(raw);slug=m.get('function')
    if slug not in TARGETS or not re.fullmatch('[a-f0-9]{40}',m.get('source_commit','')) or m.get('verify_jwt') is not False or not isinstance(m.get('files'),dict) or not 1<=len(m['files'])<=256:
        raise Blocked('bounded_runtime_manifest_required')
    files={}
    for name,pin in m['files'].items():
        if not re.fullmatch('[A-Za-z0-9_./-]+',name) or '..' in name or name.startswith('/') or not re.fullmatch('[a-f0-9]{64}',pin):raise Blocked('invalid_manifest_module')
        value=subprocess.check_output(['git','show',m['source_commit']+':supabase/functions/'+name],cwd=ROOT,stderr=subprocess.DEVNULL)
        if digest(value)!=pin:raise Blocked('immutable_source_digest_mismatch')
        files[name]=value
    visited=set()
    def visit(name):
        if name in visited:return
        if name not in files:raise Blocked('manifest_dependency_missing')
        visited.add(name)
        if name.endswith('.json'):return
        for spec in re.findall(r'''(?:\bfrom\s*|\bimport\s*(?:\(\s*)?)["'](\.[^"']+)["']''',files[name].decode()):
            try: dep=(ROOT/'supabase/functions'/name).parent.joinpath(spec).resolve().relative_to(ROOT/'supabase/functions').as_posix()
            except ValueError:raise Blocked('source_dependency_escapes_functions') from None
            visit(dep)
    visit(slug+'/index.ts')
    if visited!=set(files):raise Blocked('unused_manifest_modules')
    return m,files,digest(raw)

def policy_admission(r,change,m,pin):
    status,value=control({'action':'authorize_release','change_id':change},r.credential)
    a=value.get('authorization',{})
    if status!=200 or value.get('ok') is not True or a.get('source_commit')!=m['source_commit'] or a.get('manifest_sha256')!=pin or a.get('change_id')!=change or a.get('state')!='authorized_by_policy':
        raise Blocked('engineering_policy_denied_no_owner_fallback')
    # The actual authenticated server decision supplies grant identity/version.
    uuid.UUID(a['id']);return a

def upload(r,m,files):
    boundary='sandy-'+uuid.uuid4().hex;slug=m['function']
    parts=[f'--{boundary}\r\nContent-Disposition: form-data; name="metadata"\r\nContent-Type: application/json\r\n\r\n'.encode()+json.dumps({'name':slug,'entrypoint_path':slug+'/index.ts','verify_jwt':False}).encode()+b'\r\n']
    for name,value in files.items():parts.append(f'--{boundary}\r\nContent-Disposition: form-data; name="file"; filename="{name}"\r\nContent-Type: application/typescript\r\n\r\n'.encode()+value+b'\r\n')
    parts.append(f'--{boundary}--\r\n'.encode())
    return r.api('POST','/functions/deploy?slug='+slug,b''.join(parts),'multipart/form-data; boundary='+boundary)

def release(r,change,m,files,pin,out):
    a=policy_admission(r,change,m,pin);slug=m['function'];guard={**m,'slug':slug}
    metadata=r.api('GET','/functions/'+slug);before=r.api('GET','/functions/'+slug+'/body');check_live(guard,json.loads(metadata),before)
    private_write(out,'before-metadata.json',metadata);private_write(out,'before.body',before);private_write(out,'policy-authorization.json',json.dumps(a).encode())
    r.sql(f"""DO $$ BEGIN INSERT INTO public.sandy_engineering_component_leases(component,holder,change_id,expected_source_sha256,expires_at)
    VALUES('{slug}','{r.holder}','{change}','{m['prior_bundle_sha256']}',clock_timestamp()+interval '10 minutes')
    ON CONFLICT(component) DO UPDATE SET holder=EXCLUDED.holder,change_id=EXCLUDED.change_id,expected_source_sha256=EXCLUDED.expected_source_sha256,expires_at=EXCLUDED.expires_at,acquired_at=clock_timestamp()
    WHERE public.sandy_engineering_component_leases.expires_at<=clock_timestamp();IF NOT FOUND THEN RAISE EXCEPTION 'component already leased';END IF;END $$;""")
    try:
        # Policy/revocation, source and lease are checked immediately at dispatch.
        current=policy_admission(r,change,m,pin)
        if current['id']!=a['id']:raise Blocked('authorization_changed')
        meta=json.loads(r.api('GET','/functions/'+slug));body=r.api('GET','/functions/'+slug+'/body');check_live(guard,meta,body)
        held=r.sql(f"SELECT count(*)::integer AS held FROM public.sandy_engineering_component_leases WHERE component='{slug}' AND holder='{r.holder}' AND change_id='{change}' AND expires_at>clock_timestamp()")
        if held!=[{'held':1}]:raise Blocked('component_lease_lost')
        # Exactly one upload; unknown outcomes require readback, never replay.
        receipt=upload(r,m,files);private_write(out,'provider-receipt.json',receipt)
        meta=json.loads(r.api('GET','/functions/'+slug));after=r.api('GET','/functions/'+slug+'/body');private_write(out,'after.body',after)
        if meta.get('version')!=m['expected_prior_version']+1 or meta.get('status')!='ACTIVE' or meta.get('verify_jwt') is not False or original_sources(after)!=files:raise Blocked('unknown_outcome_source_reconciliation_required')
        evidence={'authorization_id':a['id'],'grant_revision':a['grant_revision'],'source_commit':m['source_commit'],'manifest_sha256':pin,'deployed_version':meta['version'],'all_original_modules_verified':True,'rollback_captured':True,'functional_acceptance_passed':False}
        private_write(out,'source-verification.json',json.dumps(evidence,indent=2).encode())
        status,_=control({'action':'artifact','change_id':change,'artifact_type':'edge_function','target':slug,'before_ref':'version:'+str(m['expected_prior_version']),'after_ref':'version:'+str(meta['version']),'rollback_strategy':'redeploy_prior','rollback_notes':m['rollback'],'metadata':evidence},r.credential)
        if status!=201:raise Blocked('deployed_but_artifact_recording_failed_no_replay')
        return evidence
    finally:
        r.sql(f"DELETE FROM public.sandy_engineering_component_leases WHERE component='{slug}' AND holder='{r.holder}' AND change_id='{change}';")

def main():
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('change_id');p.add_argument('manifest',type=Path);p.add_argument('--deploy',action='store_true');p.add_argument('--evidence-dir',type=Path);args=p.parse_args()
    try:
        change=str(uuid.UUID(args.change_id));m,files,pin=load_manifest(args.manifest)
        out=(args.evidence_dir or Path('/workspace/sandy-intelligence-evidence')/('delegated-release-'+uuid.uuid4().hex)).resolve()
        if out.is_relative_to(ROOT):raise Blocked('private_rollback_must_be_outside_repository')
        r=Release(m,{m['function']:files},out)
        if args.deploy:
            out.mkdir(mode=0o700);result=release(r,change,m,files,pin,out)
        else:
            check_live({**m,'slug':m['function']},json.loads(r.api('GET','/functions/'+m['function'])),r.api('GET','/functions/'+m['function']+'/body'));result={'source_preflight_passed':True,'policy_authorization_performed':False}
        print(json.dumps({'ok':True,'deployed':args.deploy,**result}));return 0
    except (Blocked,OSError,ValueError,KeyError,subprocess.CalledProcessError):
        print(json.dumps({'ok':False,'error':'release_blocked_or_unknown_outcome_no_automatic_retry','deployed_source_must_be_reconciled':args.deploy,'functional_acceptance_passed':False}));return 1
if __name__=='__main__':raise SystemExit(main())
