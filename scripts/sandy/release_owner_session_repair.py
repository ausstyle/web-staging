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
import uuid
from release_web_canary import Release, Blocked, ROOT, NoRedirect, private_write, original_sources
from release_delegated_runtime import upload
CHANGE = 'e6c9fb87-db2c-4ed7-ac63-bbdb60aad127'
SOURCE = 'f9958d50b4fd4ebd82f97c8e3be76ad49250a192'
PIN = '24b113ab99c422ab4394ea7895b7679476c38863e259e4c9172ef9647a83a573'
MIGRATION = 'supabase/migrations/20261022010000_sandy_owner_routine_delegation.sql'
MANIFEST = 'docs/sandy-engineering/evaluations/p0-owner-session-delegation-source-manifest.json'
digest = lambda b: hashlib.sha256(b).hexdigest()
quote = lambda s: "'" + s.replace("'", "''") + "'"

class Repair(Release):
    def __init__(self, out):
        self.opener = urllib.request.build_opener(NoRedirect())
        self.evidence = out
        self.holder = 'owner-repair-' + uuid.uuid4().hex

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
        b = subprocess.check_output(['git', 'show', SOURCE + ':supabase/functions/' + name], cwd=ROOT)
        if digest(b) != pin:
            raise Blocked('immutable_module_mismatch')
        files[name] = b
    sql = subprocess.check_output(['git', 'show', SOURCE + ':' + MIGRATION], cwd=ROOT)
    if digest(sql) != m['migration'][MIGRATION]:
        raise Blocked('immutable_migration_mismatch')
    return m, files, sql

def run(r, m, files, migration, deploy):
    f = m['function']; slug = f['slug']; r.admission()
    before = r.api('GET', '/functions/' + slug + '/body')
    meta = json.loads(r.api('GET', '/functions/' + slug))
    if meta.get('version') != f['expected_prior_version'] or meta.get('status') != 'ACTIVE' or meta.get('verify_jwt') is not False or digest(before) != f['prior_bundle_sha256']:
        raise Blocked('published_source_or_version_changed')
    schema = r.sql("select count(*)::integer AS installed from information_schema.columns where table_schema='public' and table_name='sandy_engineering_delegation_policy' and column_name='standing_authorized_by'")
    if schema != [{'installed': 0}]:
        raise Blocked('migration_already_present_reconcile_before_retry')
    if not deploy:
        return {'preflight_passed': True, 'approval_verified': True, 'source_commit': SOURCE, 'manifest_sha256': PIN, 'deployed': False}
    if os.environ.get('GITHUB_ACTIONS') != 'true':
        raise Blocked('existing_protected_github_release_required')
    private_write(r.evidence, 'before.body', before)
    private_write(r.evidence, 'before-metadata.json', json.dumps(meta).encode())
    r.sql(f"""DO $$ BEGIN INSERT INTO public.sandy_engineering_component_leases(component,holder,change_id,expected_source_sha256,expires_at)
      VALUES('{slug}','{r.holder}','{CHANGE}','{f['prior_bundle_sha256']}',clock_timestamp()+interval '15 minutes')
      ON CONFLICT(component) DO UPDATE SET holder=EXCLUDED.holder,change_id=EXCLUDED.change_id,expected_source_sha256=EXCLUDED.expected_source_sha256,expires_at=EXCLUDED.expires_at,acquired_at=clock_timestamp()
      WHERE public.sandy_engineering_component_leases.expires_at<=clock_timestamp();IF NOT FOUND THEN RAISE EXCEPTION 'component already leased';END IF;END $$;""")
    try:
        r.admission(True)
        core = migration.decode().strip()
        if not core.startswith('BEGIN;') or not core.endswith('COMMIT;'):
            raise Blocked('transactional_migration_required')
        core = core[len('BEGIN;'):-len('COMMIT;')]
        r.sql("BEGIN; SELECT pg_advisory_xact_lock(hashtext('sandy-approved-owner-repair-migration')); " + core +
              " INSERT INTO supabase_migrations.schema_migrations(version,statements,name,created_by,idempotency_key) VALUES('20261022010000',ARRAY[" + quote(migration.decode()) + "],'sandy_owner_routine_delegation','protected_github_owner_repair','owner-repair-" + CHANGE + "'); COMMIT;")
        r.admission(True)
        current = json.loads(r.api('GET', '/functions/' + slug))
        body = r.api('GET', '/functions/' + slug + '/body')
        if current.get('version') != meta['version'] or digest(body) != f['prior_bundle_sha256']:
            raise Blocked('source_changed_after_schema_install_no_upload')
        private_write(r.evidence, 'provider-receipt.json', upload(r, {'function': slug}, files))
        after = r.api('GET', '/functions/' + slug + '/body')
        current = json.loads(r.api('GET', '/functions/' + slug)); private_write(r.evidence, 'after.body', after)
        if current.get('version') != meta['version'] + 1 or current.get('status') != 'ACTIVE' or current.get('verify_jwt') is not False or original_sources(after) != files:
            raise Blocked('unknown_outcome_no_upload_retry')
        if r.sql("select count(*)::integer n from pg_proc where pronamespace='public'::regnamespace and proname in ('sandy_engineering_set_standing_delegation','sandy_engineering_record_owner_approval','sandy_engineering_apply_standing_delegation')") != [{'n': 3}]:
            raise Blocked('migration_postcondition_failed')
        evidence = {'change_id': CHANGE, 'source_commit': SOURCE, 'manifest_sha256': PIN, 'deployed_version': current['version'], 'original_modules_verified': len(files), 'migration_sha256': digest(migration), 'genuine_owner_approval_verified': True, 'approval_status_written': False, 'policy_activated': False, 'frontend_deployed': False, 'customer_channels_changed': False, 'functional_owner_browser_acceptance_passed': False, 'rollback_captured': True, 'rollback_exercised': False}
        r.sql(f"INSERT INTO public.sandy_engineering_change_events(change_id,event_type,actor,detail) VALUES('{CHANGE}','protected_owner_repair_source_verified',NULL,jsonb_build_object('actor_kind','protected_github_management_release','evidence',{quote(json.dumps(evidence))}::jsonb,'owner_impersonation',false))")
        return evidence
    finally:
        r.sql(f"DELETE FROM public.sandy_engineering_component_leases WHERE component='{slug}' AND holder='{r.holder}' AND change_id='{CHANGE}'")

def main():
    p = argparse.ArgumentParser(description=__doc__); p.add_argument('--deploy', action='store_true'); p.add_argument('--evidence-dir', type=Path); args = p.parse_args()
    out = (args.evidence_dir or Path('/tmp') / ('owner-repair-' + uuid.uuid4().hex)).resolve()
    try:
        if out.is_relative_to(ROOT):
            raise Blocked('rollback_outside_repository_required')
        if args.deploy:
            out.mkdir(mode=0o700)
        m, files, sql = candidate(); result = run(Repair(out), m, files, sql, args.deploy)
        if args.deploy:
            private_write(out, 'redacted-receipt.json', json.dumps(result, indent=2).encode())
        print(json.dumps(result)); return 0
    except (Blocked, OSError, ValueError, KeyError, subprocess.CalledProcessError):
        print(json.dumps({'ok': False, 'error': 'owner_repair_blocked_or_unknown_outcome', 'automatic_retry': False, 'approval_written': False})); return 1
if __name__ == '__main__':
    raise SystemExit(main())
