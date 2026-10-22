#!/usr/bin/env python3
"""Install only the exact approved Control repair via the protected workflow.

No approval/status mutation or policy activation. The pinned old frontend is
excluded because it predates the published engineering panel.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import subprocess
import urllib.request
import urllib.error
import uuid
from release_web_canary import Release, Blocked, ROOT, BASE, NoRedirect, private_write, original_sources
from owner_repair_diagnostics import ManagementFailure, failure_details, provider_sqlstate, github_annotation
from release_delegated_runtime import upload
CHANGE = 'e6c9fb87-db2c-4ed7-ac63-bbdb60aad127'
SOURCE = 'f9958d50b4fd4ebd82f97c8e3be76ad49250a192'
PIN = '24b113ab99c422ab4394ea7895b7679476c38863e259e4c9172ef9647a83a573'
MIGRATION = 'supabase/migrations/20261022010000_sandy_owner_routine_delegation.sql'
# The approved SQL is immutable at SOURCE:MIGRATION. Its old history identifier
# was independently occupied by customer-read projections. Only the history key
# changes; the applied SQL and owner-approved function modules remain exact.
HISTORY_VERSION = '20261022110000'
MANIFEST = 'docs/sandy-engineering/evaluations/p0-owner-session-delegation-source-manifest.json'
digest = lambda b: hashlib.sha256(b).hexdigest()
quote = lambda s: "'" + s.replace("'", "''") + "'"

class Repair(Release):
    def __init__(self, out):
        self.opener = urllib.request.build_opener(NoRedirect())
        self.evidence = out
        self.holder = 'owner-repair-' + uuid.uuid4().hex
        self.stage = 'initialization'
        self.migration_dispatched = False
        self.function_upload_dispatched = False
        self.cleanup_failure = None

    def api(self, method, path, data=None, mime="application/json"):
        request = urllib.request.Request(BASE + path, method=method, data=data, headers={
            "authorization": "Bearer " + os.environ["SANDY_SUPABASE_MANAGEMENT_TOKEN"],
            "content-type": mime,
        })
        try:
            with self.opener.open(request, timeout=55) as response:
                value=response.read(32*1024*1024+1)
                if len(value)>32*1024*1024:raise Blocked('management_response_too_large')
                return value
        except urllib.error.HTTPError as error:
            try:
                with error:raw=error.read(8192)
                state=provider_sqlstate(raw) if path=='/database/query' else None
            except (OSError,ValueError):state=None
            raise ManagementFailure(error.code,state) from None

    def admission(self, lease=False):
        rows = self.sql(f"""SELECT EXISTS(SELECT 1 FROM public.sandy_engineering_changes c
          JOIN public.sandy_engineering_change_events e ON e.change_id=c.id
          JOIN public.sandy_controller_admins a ON a.auth_user_id=e.actor AND a.enabled AND a.role='owner'
          JOIN auth.users u ON u.id=a.auth_user_id
          WHERE c.id='{CHANGE}' AND c.status='approved' AND c.risk='high' AND c.scope ? 'sandy-engineering-control'
          AND position('{SOURCE}' in c.expected_behavior)>0 AND position('{PIN}' in c.expected_behavior)>0
          AND coalesce(u.raw_app_meta_data->>'sandy_engineering_test','false')<>'true'
          AND e.event_type='status_changed' AND e.detail->>'to'='approved'
          AND position('{SOURCE}' in e.detail->>'reason')>0 AND position('{PIN}' in e.detail->>'reason')>0) AS admitted""")
        if rows != [{'admitted': True}]:
            raise Blocked('genuine_pinned_owner_approval_required')
        if lease and self.sql(f"SELECT count(*)::integer AS held FROM public.sandy_engineering_component_leases WHERE component='sandy-engineering-control' AND holder='{self.holder}' AND change_id='{CHANGE}' AND expires_at>clock_timestamp()") != [{'held': 1}]:
            raise Blocked('release_lease_lost')

def candidate():
    raw = (ROOT / MANIFEST).read_bytes()
    if digest(raw) != PIN:
        raise Blocked('approved_manifest_changed')
    m = json.loads(raw)
    if m['source_commit'] != SOURCE:
        raise Blocked('approved_source_changed')
    files = {}
    for name, pin in m['function']['files'].items():
        b = subprocess.check_output(['git', 'show', SOURCE + ':supabase/functions/' + name], cwd=ROOT, stderr=subprocess.DEVNULL)
        if digest(b) != pin:
            raise Blocked('immutable_module_mismatch')
        files[name] = b
    sql = subprocess.check_output(['git', 'show', SOURCE + ':' + MIGRATION], cwd=ROOT, stderr=subprocess.DEVNULL)
    if digest(sql) != m['migration'][MIGRATION]:
        raise Blocked('immutable_migration_mismatch')
    return m, files, sql

def run(r, m, files, migration, deploy):
    r.stage='approval_verification'
    f = m['function']; slug = f['slug']; r.admission()
    r.stage='prior_function_readback'
    before = r.api('GET', '/functions/' + slug + '/body')
    meta = json.loads(r.api('GET', '/functions/' + slug))
    if meta.get('version') != f['expected_prior_version'] or meta.get('status') != 'ACTIVE' or meta.get('verify_jwt') is not False or digest(before) != f['prior_bundle_sha256']:
        raise Blocked('published_source_or_version_changed')
    r.stage='migration_state_readback'
    schema = r.sql("select count(*)::integer AS installed from information_schema.columns where table_schema='public' and table_name='sandy_engineering_delegation_policy' and column_name='standing_authorized_by'")
    if schema != [{'installed': 0}]:
        raise Blocked('migration_already_present_reconcile_before_retry')
    if r.sql(f"SELECT version FROM supabase_migrations.schema_migrations WHERE version='{HISTORY_VERSION}'"):
        raise Blocked('relocated_migration_version_already_present')
    if not deploy:
        r.stage='preflight_verified'
        return {'preflight_passed': True, 'approval_verified': True, 'source_commit': SOURCE, 'manifest_sha256': PIN, 'deployed': False}
    if os.environ.get('GITHUB_ACTIONS') != 'true':
        raise Blocked('existing_protected_github_release_required')
    r.stage='rollback_capture'
    private_write(r.evidence, 'before.body', before)
    private_write(r.evidence, 'before-metadata.json', json.dumps(meta).encode())
    r.stage='component_lease_acquire'
    r.sql(f"""DO $$ BEGIN INSERT INTO public.sandy_engineering_component_leases(component,holder,change_id,expected_source_sha256,expires_at)
      VALUES('{slug}','{r.holder}','{CHANGE}','{f['prior_bundle_sha256']}',clock_timestamp()+interval '15 minutes')
      ON CONFLICT(component) DO UPDATE SET holder=EXCLUDED.holder,change_id=EXCLUDED.change_id,expected_source_sha256=EXCLUDED.expected_source_sha256,expires_at=EXCLUDED.expires_at,acquired_at=clock_timestamp()
      WHERE public.sandy_engineering_component_leases.expires_at<=clock_timestamp();IF NOT FOUND THEN RAISE EXCEPTION 'component already leased';END IF;END $$;""")
    verified=False
    try:
        r.stage='approval_and_lease_recheck'
        r.admission(True)
        core = migration.decode().strip()
        if not core.startswith('BEGIN;') or not core.endswith('COMMIT;'):
            raise Blocked('transactional_migration_required')
        core = core[len('BEGIN;'):-len('COMMIT;')]
        r.stage='migration_transaction'
        r.migration_dispatched=True
        r.sql("BEGIN; SELECT pg_advisory_xact_lock(hashtext('sandy-approved-owner-repair-migration')); " + core +
              " INSERT INTO supabase_migrations.schema_migrations(version,statements,name,created_by,idempotency_key) VALUES('" + HISTORY_VERSION + "',ARRAY[" + quote(migration.decode()) + "],'sandy_owner_routine_delegation','protected_github_owner_repair','owner-repair-" + CHANGE + "'); COMMIT;")
        r.stage='post_migration_source_guard'
        r.admission(True)
        current = json.loads(r.api('GET', '/functions/' + slug))
        body = r.api('GET', '/functions/' + slug + '/body')
        if current.get('version') != meta['version'] or digest(body) != f['prior_bundle_sha256']:
            raise Blocked('source_changed_after_schema_install_no_upload')
        r.stage='function_upload'
        r.function_upload_dispatched=True
        private_write(r.evidence, 'provider-receipt.json', upload(r, {'function': slug}, files))
        r.stage='function_source_verification'
        after = r.api('GET', '/functions/' + slug + '/body')
        current = json.loads(r.api('GET', '/functions/' + slug)); private_write(r.evidence, 'after.body', after)
        if current.get('version') != meta['version'] + 1 or current.get('status') != 'ACTIVE' or current.get('verify_jwt') is not False or original_sources(after) != files:
            raise Blocked('unknown_outcome_no_upload_retry')
        r.stage='migration_postconditions'
        if r.sql("select count(*)::integer n from pg_proc where pronamespace='public'::regnamespace and proname in ('sandy_engineering_set_standing_delegation','sandy_engineering_record_owner_approval','sandy_engineering_apply_standing_delegation')") != [{'n': 3}]:
            raise Blocked('migration_postcondition_failed')
        evidence = {'change_id': CHANGE, 'source_commit': SOURCE, 'manifest_sha256': PIN, 'deployed_version': current['version'], 'original_modules_verified': len(files), 'migration_sha256': digest(migration), 'migration_history_version': HISTORY_VERSION, 'approved_sql_unchanged': True, 'genuine_owner_approval_verified': True, 'approval_status_written': False, 'policy_activated': False, 'frontend_deployed': False, 'customer_channels_changed': False, 'functional_owner_browser_acceptance_passed': False, 'rollback_captured': True, 'rollback_exercised': False}
        r.stage='release_audit_record'
        r.sql(f"INSERT INTO public.sandy_engineering_change_events(change_id,event_type,actor,detail) VALUES('{CHANGE}','protected_owner_repair_source_verified',NULL,jsonb_build_object('actor_kind','protected_github_management_release','evidence',{quote(json.dumps(evidence))}::jsonb,'owner_impersonation',false))")
        verified=True
        r.stage='release_verified'
        return evidence
    finally:
        # Unknown mutation outcomes retain the lease to its TTL for readback.
        if verified or not getattr(r,'migration_dispatched',False):
            try:r.sql(f"DELETE FROM public.sandy_engineering_component_leases WHERE component='{slug}' AND holder='{r.holder}' AND change_id='{CHANGE}'")
            except Exception as cleanup:
                r.cleanup_failure=failure_details(cleanup)
                if verified:raise

def reconcile(r,m,files,migration):
    """All production operations are SELECT or function GET; never call run(deploy=True)."""
    report={'ok':True,'read_only':True,'change_id':CHANGE,'source_commit':SOURCE,'manifest_sha256':PIN,
            'approved_migration_sha256':digest(migration),'approval_written':False,
            'migration_dispatched':False,'function_upload_dispatched':False,'observations':{}}
    def probe(stage,action):
        r.stage=stage
        try:
            value=action();report['observations'][stage]=value;return value
        except Exception as error:
            report['ok']=False;report['observations'][stage]={'ok':False,**failure_details(error)}
            return None
    slug=m['function']['slug']
    def metadata():
        value=json.loads(r.api('GET','/functions/'+slug))
        if not isinstance(value,dict) or type(value.get('version')) is not int or value.get('status') not in ('ACTIVE','INACTIVE','REMOVED','DEPLOYING') or type(value.get('verify_jwt')) is not bool:raise ValueError('invalid_function_metadata')
        return {k:value[k] for k in ('version','status','verify_jwt')}
    meta=probe('function_metadata',metadata)
    def source():
        body=r.api('GET','/functions/'+slug+'/body')
        return {'bundle_sha256':digest(body),'matches_pinned_prior':digest(body)==m['function']['prior_bundle_sha256'],
                'matches_approved_candidate_modules':original_sources(body)==files}
    probe('function_source',source)
    def approval():r.admission();return {'genuine_pinned_owner_approval_verified':True}
    probe('approval_verification',approval)
    probe('migration_history',lambda:r.sql(f"SELECT version,name FROM supabase_migrations.schema_migrations WHERE version='{HISTORY_VERSION}'"))
    probe('migration_columns',lambda:r.sql("SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name='sandy_engineering_delegation_policy' AND column_name IN ('standing_authorized_by','standing_expires_at','standing_revoked_at','standing_config','standing_revision') ORDER BY column_name"))
    def functions():
        rows=r.sql("SELECT proname,prosrc FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname IN ('sandy_engineering_set_standing_delegation','sandy_engineering_record_owner_approval','sandy_engineering_apply_standing_delegation') ORDER BY proname")
        return [{'function':x['proname'],'body_sha256':digest(x['prosrc'].encode())} for x in rows]
    probe('migration_functions',functions)
    probe('migration_event_table',lambda:r.sql("SELECT to_regclass('public.sandy_engineering_delegation_events') IS NOT NULL AS present"))
    probe('component_lease',lambda:r.sql("SELECT component,change_id,expires_at,expires_at>clock_timestamp() AS active FROM public.sandy_engineering_component_leases WHERE component='sandy-engineering-control'"))
    probe('release_events',lambda:r.sql(f"SELECT id,event_type,occurred_at FROM public.sandy_engineering_change_events WHERE change_id='{CHANGE}' ORDER BY id DESC LIMIT 50"))
    if meta:
        # A remote error body must never be mistaken for function metadata.
        report['observations']['function_metadata']={k:meta.get(k) for k in ('version','status','verify_jwt')}
    o=report['observations']
    clean=report['ok'] and meta and meta.get('version')==m['function']['expected_prior_version'] and meta.get('status')=='ACTIVE' and meta.get('verify_jwt') is False and o['function_source']['matches_pinned_prior'] and o['migration_history']==[] and o['migration_columns']==[] and o['migration_functions']==[] and o['migration_event_table']==[{'present':False}] and not any(x['active'] for x in o['component_lease'])
    report['clean_retry_preconditions_verified']=bool(clean)
    report['state']='verified_unchanged_prior_release' if clean else 'requires_reconciliation'
    return report

def emit(result):
    print(json.dumps(result))
    if os.environ.get('GITHUB_ACTIONS')=='true':print(github_annotation(result))

def main(argv=None):
    p = argparse.ArgumentParser(description=__doc__);mode=p.add_mutually_exclusive_group();mode.add_argument('--deploy', action='store_true');mode.add_argument('--reconcile',action='store_true');p.add_argument('--evidence-dir', type=Path); args = p.parse_args(argv)
    out = (args.evidence_dir or Path('/tmp') / ('owner-repair-' + uuid.uuid4().hex)).resolve()
    r=None;stage='candidate_verification'
    try:
        if out.is_relative_to(ROOT):
            raise Blocked('rollback_outside_repository_required')
        if args.deploy or args.reconcile:
            out.mkdir(mode=0o700)
        m, files, sql = candidate();r=Repair(out);result=reconcile(r,m,files,sql) if args.reconcile else run(r,m,files,sql,args.deploy)
        if args.deploy:
            private_write(out, 'redacted-receipt.json', json.dumps(result, indent=2).encode())
        if args.reconcile:private_write(out,'redacted-reconciliation.json',json.dumps(result,indent=2).encode())
        emit(result); return 0 if result.get('ok',True) else 1
    except Exception as error:
        result={'ok':False,'error':'owner_repair_blocked_or_unknown_outcome',**failure_details(error),
                'stage':getattr(r,'stage',stage),'automatic_retry':False,'approval_written':False,
                'migration_dispatched':getattr(r,'migration_dispatched',False),
                'function_upload_dispatched':getattr(r,'function_upload_dispatched',False),
                'read_only':not args.deploy}
        if getattr(r,'cleanup_failure',None):result['cleanup_failure']=r.cleanup_failure
        if (args.deploy or args.reconcile) and out.is_dir():
            try:private_write(out,'redacted-failure.json',json.dumps(result,indent=2).encode())
            except OSError:result['failure_artifact_saved']=False
        emit(result); return 1
if __name__ == '__main__':
    raise SystemExit(main())
