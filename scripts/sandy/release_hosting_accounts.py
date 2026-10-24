#!/usr/bin/env python3
"""Exact Owner-gated hosting release. No policy, IAM, gateway or DNS changes."""
import argparse, base64, gzip, json, os, subprocess, uuid
from pathlib import Path
from check_hosting_release_candidate import MANIFEST, SOURCE, PIN, ROOT, sha, verify
from release_gcp_admin_read import Installer, quote
from release_web_canary import Blocked, original_sources
CHANGE='e6d65289-ce3d-41bd-8b1e-086f89ffa813'
TARGET='sandy-customer-provisioning-api'
CHECKS={'offline-control','api-contract-tests','provider-response-contract-tests','supabase-gap-contract-tests','vm-protocol-contract-tests','examiner-evidence-tests','offline-contract-tests','sandy-runtime-release-checks'}
def source(p): return subprocess.check_output(['git','show',SOURCE+':'+p],cwd=ROOT)
def admission(r):
    rows=r.sql(f"""SELECT EXISTS(SELECT 1 FROM public.sandy_engineering_changes c
      JOIN public.sandy_engineering_change_events e ON e.change_id=c.id
      JOIN public.sandy_controller_admins a ON a.auth_user_id=e.actor AND a.enabled AND a.role='owner'
      JOIN auth.users u ON u.id=a.auth_user_id
      WHERE c.id='{CHANGE}' AND c.status IN ('approved','implementing') AND c.risk='high'
      AND c.scope @> '["supabase:{TARGET}","supabase:migration:20261024010000","supabase:migration:20261024010010"]'::jsonb
      AND position('{SOURCE}' in c.expected_behavior)>0 AND position('{PIN}' in c.expected_behavior)>0
      AND e.event_type='status_changed' AND e.detail->>'to'='approved'
      AND position('{SOURCE}' in e.detail->>'reason')>0 AND position('{PIN}' in e.detail->>'reason')>0
      AND coalesce(u.raw_app_meta_data->>'sandy_engineering_test','false')<>'true') AS admitted""",True)
    if rows != [{'admitted':True}]: raise Blocked('genuine_exact_Owner_approval_required')
def inspect(r,m,after=False):
    meta=json.loads(r.api('GET','/functions/'+TARGET));body=r.api('GET','/functions/'+TARGET+'/body')
    files=original_sources(body);f=m['function']
    expected=f['after_files' if after else 'before_files'];actual={n:sha(b) for n,b in files.items()}
    checks={'active':meta.get('status')=='ACTIVE','jwt_enabled':meta.get('verify_jwt') is True,
        'no_import_map':meta.get('import_map') is not True,
        'version_matches':meta.get('version')==f['expected_prior_version']+int(after),
        'modules_match':actual==expected,'bundle_matches':after or sha(body)==f['prior_bundle_sha256']}
    if not all(checks.values()):
        # Only bounded metadata and digests: never source bodies, credentials or responses.
        detail={'checks':checks,'observed_version':meta.get('version'),
            'expected_version':f['expected_prior_version']+int(after),'observed_bundle_sha256':sha(body),
            'missing_modules':sorted(set(expected)-set(actual)),
            'unexpected_module_count':len(set(actual)-set(expected)),
            'changed_modules':{n:actual[n] for n in expected if n in actual and actual[n]!=expected[n]}}
        raise Blocked('live_preimage_changed_or_outcome_unknown:'+json.dumps(detail,sort_keys=True))
    return meta,body,files
def protected():
    if os.environ.get('GITHUB_ACTIONS')!='true' or os.environ.get('GITHUB_REF')!='refs/heads/main' or os.environ.get('GITHUB_REPOSITORY')!='ausstyle/web-staging':
        raise Blocked('protected_main_workflow_required')
def verify_ci(head):
    data=json.loads(subprocess.check_output(['gh','api',f'repos/ausstyle/web-staging/commits/{head}/check-runs?per_page=100']))
    latest={}
    for row in data['check_runs']:
        if row['head_sha']==head and row['name'] in CHECKS and row['id']>latest.get(row['name'],{}).get('id',0): latest[row['name']]=row
    if set(latest)!=CHECKS or any(r['conclusion']!='success' for r in latest.values()): raise Blocked('exact_source_CI_required')
def upload(r,files):
    boundary='hosting-'+uuid.uuid4().hex
    parts=[f'--{boundary}\r\nContent-Disposition: form-data; name="metadata"\r\nContent-Type: application/json\r\n\r\n'.encode()+json.dumps({'name':TARGET,'entrypoint_path':TARGET+'/index.ts','verify_jwt':True}).encode()+b'\r\n']
    for name,b in files.items(): parts.append(f'--{boundary}\r\nContent-Disposition: form-data; name="file"; filename="{name}"\r\nContent-Type: application/typescript\r\n\r\n'.encode()+b+b'\r\n')
    parts.append(f'--{boundary}--\r\n'.encode())
    return r.api('POST','/functions/deploy?slug='+TARGET,b''.join(parts),'multipart/form-data; boundary='+boundary)
def event(r,kind,detail):
    r.sql(f"INSERT INTO public.sandy_engineering_change_events(change_id,event_type,actor,detail) VALUES('{CHANGE}',{quote(kind)},NULL,{quote(json.dumps(detail))}::jsonb)")
def migrations(r,m):
    chunks=[]
    for path in m['migrations']:
        sql=source(path).decode().strip();start=sql.index('BEGIN;')+6
        version=Path(path).name.split('_')[0]
        chunks.append(sql[start:-len('COMMIT;')])
        chunks.append(f"INSERT INTO supabase_migrations.schema_migrations(version,statements,name) VALUES('{version}',ARRAY[{quote(sql)}],'hosting_logical_account_protected_release');")
    r.sql("BEGIN; SELECT pg_advisory_xact_lock(hashtext('sandy-hosting-account-migrations')); "+'\n'.join(chunks)+' COMMIT;')
def empty_schema(r):
    rows=r.sql("SELECT to_regclass('public.sandy_hosting_accounts') IS NULL AND NOT EXISTS(SELECT 1 FROM supabase_migrations.schema_migrations WHERE version IN ('20261024010000','20261024010010')) AND NOT EXISTS(SELECT 1 FROM public.sandy_operation_registry WHERE operation IN ('hosting.accounts.create','hosting.accounts.get')) AS clean",True)
    if rows!=[{'clean':True}]: raise Blocked('schema_already_present_reconcile_before_retry')
def run(r,mode):
    verify(MANIFEST.read_bytes(),source);m=json.loads(MANIFEST.read_bytes());admission(r)
    if mode=='reconcile':
        meta,_,_=inspect(r,m,True)
        return {'source_verified':True,'version':meta['version'],'customer_acceptance_passed':False}
    inspect(r,m);empty_schema(r)
    if mode=='preflight': return {'preflight_passed':True,'deployed':False,'manifest_sha256':PIN}
    protected();verify_ci(SOURCE)
    # Validate the executor and workflow checkout as well as immutable product source.
    subprocess.check_call(['git','diff','--exit-code','HEAD'],cwd=ROOT,stdout=subprocess.DEVNULL)
    r.sql(f"""DO $$ BEGIN INSERT INTO public.sandy_engineering_component_leases(component,holder,change_id,expected_source_sha256,expires_at)
    VALUES('{TARGET}',{quote(r.holder)},'{CHANGE}','{m['function']['prior_bundle_sha256']}',clock_timestamp()+interval '15 minutes')
    ON CONFLICT(component) DO UPDATE SET holder=EXCLUDED.holder,change_id=EXCLUDED.change_id,expected_source_sha256=EXCLUDED.expected_source_sha256,expires_at=EXCLUDED.expires_at,acquired_at=clock_timestamp()
    WHERE public.sandy_engineering_component_leases.expires_at<=clock_timestamp(); IF NOT FOUND THEN RAISE EXCEPTION 'component already leased'; END IF; END $$;""")
    try:
        admission(r);meta,body,files=inspect(r,m);empty_schema(r)
        if r.sql(f"SELECT count(*)::integer n FROM public.sandy_engineering_change_events WHERE change_id='{CHANGE}' AND event_type='hosting_release_intent'",True)!=[{'n':0}]: raise Blocked('prior_dispatch_requires_reconciliation_no_retry')
        artifact=store_recovery(r,m,CHANGE,meta['version'],body,PIN)
        event(r,'hosting_release_intent',{'source_commit':SOURCE,'manifest_sha256':PIN,'recovery_artifact_id':artifact,'github_run_id':os.environ.get('GITHUB_RUN_ID'),'automatic_retry':False})
        migrations(r,m);admission(r);inspect(r,m)
        if r.sql(f"SELECT count(*)::integer held FROM public.sandy_engineering_component_leases WHERE component='{TARGET}' AND holder={quote(r.holder)} AND change_id='{CHANGE}' AND expires_at>clock_timestamp()",True)!=[{'held':1}]: raise Blocked('lease_lost')
        for name in m['function']['replacement_files']: files[name]=source('supabase/functions/'+name)
        upload(r,files);meta,_,_=inspect(r,m,True)
        if r.sql("SELECT count(*)::integer n FROM public.sandy_operation_registry WHERE operation IN ('hosting.accounts.create','hosting.accounts.get') AND NOT api_exposed AND NOT ui_exposed AND NOT ai_exposed AND NOT verified",True)!=[{'n':2}]:raise Blocked('inactive_contract_postcondition_failed')
        result={'source_commit':SOURCE,'manifest_sha256':PIN,'version':meta['version'],'recovery_artifact_id':artifact,'source_verified':True,'customer_acceptance_passed':False,'approval_written':False,'gateway_deployed':False}
        event(r,'hosting_release_source_verified',result);return result
    finally:
        r.sql(f"DELETE FROM public.sandy_engineering_component_leases WHERE component='{TARGET}' AND holder={quote(r.holder)} AND change_id='{CHANGE}'")

def store_recovery(r, manifest, change, version, body, pin):
    """Keep one private recovery row; bound every Management request and verify
    the complete compressed bytes in PostgreSQL before permitting dispatch.
    A partial/uncertain append never authorizes an upload or an automatic retry.
    """
    packed = gzip.compress(body, mtime=0)
    encoded = base64.b64encode(packed).decode()
    recovery = {'kind': 'private-hosting-release-rollback-v1', 'manifest_sha256': pin,
                'bundle_gzip_base64': '', 'bundle_transfer_state': 'writing',
                'compressed_sha256': sha(packed), 'compressed_base64_bytes': len(encoded)}
    r.stage = 'private_recovery_create'
    rows = r.sql(f"""INSERT INTO public.sandy_engineering_artifacts
      (change_id,artifact_type,target,before_ref,rollback_strategy,rollback_notes,metadata)
      VALUES('{change}','edge_function','{TARGET}','version:{version}',
      'redeploy_prior',{quote(manifest['rollback'])},{quote(json.dumps(recovery))}::jsonb) RETURNING id""")
    if len(rows) != 1:
        raise Blocked('private_recovery_row_not_confirmed_no_upload')
    artifact = str(uuid.UUID(rows[0]['id']))
    for offset in range(0, len(encoded), (128 * 1024)):
        chunk = encoded[offset:offset + (128 * 1024)]
        r.stage = 'private_recovery_append'
        rows = r.sql(f"""UPDATE public.sandy_engineering_artifacts SET metadata=jsonb_set(
          metadata,'{{bundle_gzip_base64}}',to_jsonb((metadata->>'bundle_gzip_base64')||{quote(chunk)}))
          WHERE id='{artifact}' AND change_id='{change}' AND target='{TARGET}'
          AND metadata->>'manifest_sha256'='{pin}' AND metadata->>'bundle_transfer_state'='writing'
          AND length(metadata->>'bundle_gzip_base64')={offset} RETURNING id""")
        if rows != [{'id': artifact}]:
            raise Blocked('private_recovery_append_not_confirmed_no_upload')
    r.stage = 'private_recovery_verify'
    rows = r.sql(f"""UPDATE public.sandy_engineering_artifacts SET metadata=jsonb_set(
      metadata,'{{bundle_transfer_state}}','"complete"'::jsonb)
      WHERE id='{artifact}' AND change_id='{change}' AND target='{TARGET}'
      AND metadata->>'manifest_sha256'='{pin}' AND metadata->>'bundle_transfer_state'='writing'
      AND length(metadata->>'bundle_gzip_base64')={len(encoded)}
      AND encode(extensions.digest(decode(metadata->>'bundle_gzip_base64','base64'),'sha256'),'hex')='{sha(packed)}'
      RETURNING id""")
    if rows != [{'id': artifact}]:
        raise Blocked('private_recovery_digest_not_verified_no_upload')
    return artifact


def rollback(r,artifact):
    artifact=str(uuid.UUID(artifact));verify(MANIFEST.read_bytes(),source);m=json.loads(MANIFEST.read_bytes())
    admission(r);protected();inspect(r,m,True)
    rows=r.sql(f"SELECT metadata FROM public.sandy_engineering_artifacts WHERE id='{artifact}' AND change_id='{CHANGE}' AND target='{TARGET}'",True)
    if len(rows)!=1:raise Blocked('recovery_artifact_not_found')
    recovery=rows[0]['metadata']
    if recovery.get('manifest_sha256')!=PIN or recovery.get('bundle_transfer_state')!='complete':raise Blocked('recovery_not_verified')
    packed=base64.b64decode(recovery['bundle_gzip_base64'],validate=True)
    if sha(packed)!=recovery['compressed_sha256']:raise Blocked('recovery_digest_mismatch')
    body=gzip.decompress(packed)
    if sha(body)!=m['function']['prior_bundle_sha256']:raise Blocked('prior_bundle_mismatch')
    files=original_sources(body)
    if {n:sha(b) for n,b in files.items()}!=m['function']['before_files']:raise Blocked('recovery_modules_mismatch')
    r.sql(f"""DO $$ BEGIN INSERT INTO public.sandy_engineering_component_leases(component,holder,change_id,expected_source_sha256,expires_at)
      VALUES('{TARGET}',{quote(r.holder)},'{CHANGE}','{PIN}',clock_timestamp()+interval '15 minutes')
      ON CONFLICT(component) DO UPDATE SET holder=EXCLUDED.holder,change_id=EXCLUDED.change_id,expires_at=EXCLUDED.expires_at
      WHERE public.sandy_engineering_component_leases.expires_at<=clock_timestamp();IF NOT FOUND THEN RAISE EXCEPTION 'component already leased';END IF;END $$;""")
    try:
        admission(r);inspect(r,m,True)
        if r.sql(f"SELECT count(*)::integer n FROM public.sandy_engineering_change_events WHERE change_id='{CHANGE}' AND event_type='hosting_rollback_intent'",True)!=[{'n':0}]:raise Blocked('prior_rollback_requires_reconciliation')
        event(r,'hosting_rollback_intent',{'recovery_artifact_id':artifact,'source_commit':SOURCE,'manifest_sha256':PIN})
        upload(r,files)
        meta=json.loads(r.api('GET','/functions/'+TARGET));restored=original_sources(r.api('GET','/functions/'+TARGET+'/body'))
        if meta.get('version')!=m['function']['expected_prior_version']+2 or meta.get('verify_jwt') is not True or meta.get('status')!='ACTIVE' or restored!=files:raise Blocked('rollback_outcome_unknown_no_retry')
        result={'rolled_back':True,'version':meta['version'],'account_data_preserved':True,'customer_acceptance_passed':False}
        event(r,'hosting_rollback_source_verified',result);return result
    finally:
        r.sql(f"DELETE FROM public.sandy_engineering_component_leases WHERE component='{TARGET}' AND holder={quote(r.holder)} AND change_id='{CHANGE}'")

if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--mode',choices=['preflight','deploy','reconcile','rollback'],default='preflight');parser.add_argument('--recovery-artifact');args=parser.parse_args()
    try:
        r=Installer(Path('/tmp'))
        print(json.dumps(rollback(r,args.recovery_artifact) if args.mode=='rollback' else run(r,args.mode)))
    except (Blocked,ValueError,KeyError,OSError,subprocess.CalledProcessError) as e:
        print(json.dumps({'ok':False,'error':str(e) if isinstance(e,Blocked) else 'release_blocked_or_unknown_outcome','automatic_retry':False,'approval_written':False}));raise SystemExit(1)
