#!/usr/bin/env python3
"""One fixed provider response repair, using the existing Owner-approved release
model. Never changes grants, approval status, JWT configuration or other modules.
Preparation is read-only. Deployment requires a genuine scoped Owner audit and
the exact private manifest; the acting workload cannot supply its own approval.
"""
import argparse
import base64
import gzip
import hashlib
import json
import os
import re
from pathlib import Path
import subprocess
import uuid

from release_gcp_admin_read import Installer
from release_web_canary import Blocked, ROOT, original_sources, private_write

TARGET = 'sandy-provider-operation-api'
SOURCE = '53556941f600c7ec625067a74d37bbcffa8bd400'
ENTRY = TARGET + '/index.ts'
ENTRY_SHA = '48c12dcc8b92da177d651196ad3fcb26678263ec009ba822f34ee9fc3bb3acd4'
PRIOR_VERSION = 30
PRIOR_BUNDLE_SHA = '896a964ff35577f62e6d49c590ce1d2262bddda3eb24d39f3bc59aaf13941480'
CHECKS = {'provider-response-contract-tests', 'api-contract-tests',
          'supabase-gap-contract-tests', 'vm-protocol-contract-tests',
          'examiner-evidence-tests', 'offline-contract-tests'}
BACKUP_CHUNK_BYTES = 128 * 1024


def sha(value):
    return hashlib.sha256(value).hexdigest()


def canonical(value):
    return json.dumps(value, sort_keys=True, separators=(',', ':')).encode()


def quote(value):
    return "'" + str(value).replace("'", "''") + "'"


def pinned_entry():
    value = subprocess.check_output(['git', 'show', SOURCE + ':supabase/functions/' + ENTRY], cwd=ROOT)
    if sha(value) != ENTRY_SHA:
        raise Blocked('immutable_fix_source_changed')
    return value


def source_map(files):
    return {name: sha(value) for name, value in sorted(files.items())}


def prepare(metadata, before, entry):
    if (metadata.get('slug') != TARGET or metadata.get('status') != 'ACTIVE'
            or metadata.get('version') != PRIOR_VERSION or sha(before) != PRIOR_BUNDLE_SHA
            or not isinstance(metadata.get('verify_jwt'), bool)
            or sha(entry) != ENTRY_SHA):
        raise Blocked('bounded_existing_function_required')
    files = original_sources(before)
    if metadata.get('import_map') is True or metadata.get('import_map_path'):
        raise Blocked('existing_import_map_requires_explicit_preserving_upload')
    if ENTRY not in files or files[ENTRY] == entry:
        raise Blocked('fix_already_installed_or_entry_missing_reconcile_no_retry')
    after = {**files, ENTRY: entry}
    return {'kind': 'owner-approved-provider-response-fix-v1', 'function': TARGET,
            'project_ref': 'zmqlyygzqoidkcwdysok', 'source_commit': SOURCE,
            'expected_prior_version': metadata['version'],
            'verify_jwt': metadata['verify_jwt'], 'prior_bundle_sha256': sha(before),
            'before_files': source_map(files), 'after_files': source_map(after),
            'rollback': 'Restore the private captured original bundle only while the deployed modules match this exact candidate; retain JWT configuration and verify every restored module.'}


def validate_manifest(manifest):
    if (manifest.get('kind') != 'owner-approved-provider-response-fix-v1'
            or manifest.get('function') != TARGET or manifest.get('source_commit') != SOURCE
            or manifest.get('project_ref') != 'zmqlyygzqoidkcwdysok'
            or not isinstance(manifest.get('verify_jwt'), bool)
            or not isinstance(manifest.get('expected_prior_version'), int)
            or manifest['expected_prior_version'] != PRIOR_VERSION
            or manifest.get('prior_bundle_sha256') != PRIOR_BUNDLE_SHA):
        raise Blocked('fixed_release_manifest_required')
    old, new = manifest.get('before_files'), manifest.get('after_files')
    if (not isinstance(old, dict) or not isinstance(new, dict) or set(old) != set(new)
            or new.get(ENTRY) != ENTRY_SHA
            or [name for name in old if old[name] != new[name]] != [ENTRY]):
        raise Blocked('only_the_pinned_entrypoint_may_change')
    # Validate all private digest/path material before it is used for recovery.
    if (not re.fullmatch('[a-f0-9]{64}', str(manifest.get('prior_bundle_sha256', '')))
            or any(not re.fullmatch('[-A-Za-z0-9_./]+', name) or '..' in name
                   or name.startswith('/') or not re.fullmatch('[a-f0-9]{64}', str(pin))
                   for mapping in [old, new] for name, pin in mapping.items())):
        raise Blocked('invalid_private_source_manifest')
    return sha(canonical(manifest))


def verify_ci(checks):
    latest = {}
    for row in checks:
        if row.get('name') in CHECKS and row.get('head_sha') == SOURCE:
            previous = latest.get(row['name'])
            if previous is None or row['id'] > previous['id']:
                latest[row['name']] = row
    if set(latest) != CHECKS or any(row.get('status') != 'completed'
                                   or row.get('conclusion') != 'success' for row in latest.values()):
        raise Blocked('independent_exact_source_CI_required')


def github_ci():
    rows = json.loads(subprocess.check_output(
        ['gh', 'api', f'repos/ausstyle/web-staging/commits/{SOURCE}/check-runs?per_page=100'],
        text=True))
    verify_ci(rows['check_runs'])


def owner_admission(r, change, pin):
    change = str(uuid.UUID(change))
    if not re.fullmatch('[a-f0-9]{64}', pin):
        raise Blocked('exact_release_manifest_digest_required')
    rows = r.sql(f"""SELECT EXISTS(SELECT 1 FROM public.sandy_engineering_changes c
      JOIN public.sandy_engineering_change_events e ON e.change_id=c.id
      JOIN public.sandy_controller_admins a ON a.auth_user_id=e.actor AND a.enabled AND a.role='owner'
      JOIN auth.users u ON u.id=a.auth_user_id
      WHERE c.id='{change}' AND c.status IN ('approved','implementing')
      AND jsonb_typeof(c.scope)='array' AND c.scope ? '{TARGET}' AND c.risk IN ('low','normal')
      AND position('{SOURCE}' in c.expected_behavior)>0 AND position('{pin}' in c.expected_behavior)>0
      AND coalesce(u.raw_app_meta_data->>'sandy_engineering_test','false')<>'true'
      AND e.event_type='status_changed' AND e.detail->>'to'='approved'
      AND position('{SOURCE}' in e.detail->>'reason')>0 AND position('{pin}' in e.detail->>'reason')>0
      ) AS admitted""", True)
    if rows != [{'admitted': True}]:
        raise Blocked('genuine_Owner_approval_for_exact_function_source_and_manifest_required')


def inspect(r, manifest, restored=False):
    metadata = json.loads(r.api('GET', '/functions/' + TARGET))
    before = r.api('GET', '/functions/' + TARGET + '/body')
    files = original_sources(before)
    expected = manifest['after_files'] if restored else manifest['before_files']
    version = manifest['expected_prior_version'] + int(restored)
    if (metadata.get('version') != version or metadata.get('status') != 'ACTIVE'
            or metadata.get('verify_jwt') != manifest['verify_jwt']
            or metadata.get('import_map') is True or metadata.get('import_map_path')
            or source_map(files) != expected
            or not restored and sha(before) != manifest['prior_bundle_sha256']):
        raise Blocked('live_source_or_configuration_changed_no_upload')
    return metadata, before, files


def store_recovery(r, manifest, change, version, body, pin):
    """Keep one private recovery row; bound every Management request and verify
    the complete compressed bytes in PostgreSQL before permitting dispatch.
    A partial/uncertain append never authorizes an upload or an automatic retry.
    """
    packed = gzip.compress(body, mtime=0)
    encoded = base64.b64encode(packed).decode()
    recovery = {'kind': 'private-provider-release-rollback-v1', 'manifest_sha256': pin,
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
    for offset in range(0, len(encoded), BACKUP_CHUNK_BYTES):
        chunk = encoded[offset:offset + BACKUP_CHUNK_BYTES]
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


def release(r, manifest, change, rollback_artifact=None):
    pin = validate_manifest(manifest)
    change = str(uuid.UUID(change))
    r.stage = 'independent_source_ci'
    github_ci()
    r.stage = 'owner_approval_verification'
    owner_admission(r, change, pin)
    r.stage = 'component_lease_acquire'
    r.sql(f"""DO $$ BEGIN INSERT INTO public.sandy_engineering_component_leases
      (component,holder,change_id,expected_source_sha256,expires_at)
      VALUES('{TARGET}',{quote(r.holder)},'{change}','{manifest['prior_bundle_sha256']}',clock_timestamp()+interval '10 minutes')
      ON CONFLICT(component) DO UPDATE SET holder=EXCLUDED.holder,change_id=EXCLUDED.change_id,
      expected_source_sha256=EXCLUDED.expected_source_sha256,expires_at=EXCLUDED.expires_at,acquired_at=clock_timestamp()
      WHERE public.sandy_engineering_component_leases.expires_at<=clock_timestamp();
      IF NOT FOUND THEN RAISE EXCEPTION 'component already leased';END IF;END $$;""")
    try:
        r.stage = 'live_source_verification'
        meta, body, files = inspect(r, manifest, bool(rollback_artifact))
        dispatch_key = sha(canonical({'change': change, 'manifest': pin,
                                     'mode': 'rollback' if rollback_artifact else 'deploy'}))
        prior = r.sql(f"SELECT count(*)::integer n FROM public.sandy_engineering_change_events WHERE change_id='{change}' AND event_type='provider_response_fix_upload_started' AND detail->>'dispatch_key'='{dispatch_key}'", True)
        if prior != [{'n': 0}]:
            raise Blocked('existing_dispatch_requires_read_only_reconciliation_no_retry')
        if rollback_artifact:
            artifact = str(uuid.UUID(rollback_artifact))
            rows = r.sql(f"SELECT metadata FROM public.sandy_engineering_artifacts WHERE id='{artifact}' AND change_id='{change}' AND target='{TARGET}'", True)
            if len(rows) != 1 or rows[0]['metadata'].get('manifest_sha256') != pin:
                raise Blocked('private_recovery_artifact_required')
            recovery = rows[0]['metadata']
            if recovery.get('bundle_transfer_state') not in (None, 'complete'):
                raise Blocked('private_recovery_incomplete_no_rollback')
            packed = base64.b64decode(recovery['bundle_gzip_base64'], validate=True)
            import io
            with gzip.GzipFile(fileobj=io.BytesIO(packed)) as stream:
                old = stream.read(32 * 1024 * 1024 + 1)
            if len(old) > 32 * 1024 * 1024 or sha(old) != manifest['prior_bundle_sha256']:
                raise Blocked('private_rollback_digest_mismatch')
            candidate = original_sources(old)
            if source_map(candidate) != manifest['before_files']:
                raise Blocked('private_rollback_modules_mismatch')
        else:
            candidate = {**files, ENTRY: pinned_entry()}
            if source_map(candidate) != manifest['after_files']:
                raise Blocked('candidate_source_mismatch')
            # Keep full source recovery material in the existing private database,
            # never in public Git or GitHub Actions artifacts. No new store/key.
            artifact = store_recovery(r, manifest, change, meta['version'], body, pin)
        # Revalidate authority, exact live source and lease immediately at dispatch.
        r.stage = 'dispatch_guard_verification'
        owner_admission(r, change, pin)
        inspect(r, manifest, bool(rollback_artifact))
        held = r.sql(f"SELECT count(*)::integer held FROM public.sandy_engineering_component_leases WHERE component='{TARGET}' AND holder={quote(r.holder)} AND change_id='{change}' AND expires_at>clock_timestamp()", True)
        if held != [{'held': 1}]:
            raise Blocked('release_lease_lost')
        intent = {'dispatch_key': dispatch_key, 'manifest_sha256': pin,
                  'source_commit': SOURCE, 'recovery_artifact_id': artifact,
                  'actor_kind': 'protected_release_service', 'mode': 'rollback' if rollback_artifact else 'deploy'}
        r.stage = 'durable_upload_intent'
        r.sql(f"INSERT INTO public.sandy_engineering_change_events(change_id,event_type,actor,detail) VALUES('{change}','provider_response_fix_upload_started',NULL,{quote(json.dumps(intent))}::jsonb)")
        r.stage = 'function_upload'
        receipt = r.upload(TARGET, candidate, manifest['verify_jwt'])
        private_write(r.out, 'provider-upload-receipt.json', receipt)
        r.stage = 'post_upload_source_verification'
        observed = json.loads(r.api('GET', '/functions/' + TARGET))
        installed = original_sources(r.api('GET', '/functions/' + TARGET + '/body'))
        if (observed.get('version') != meta['version'] + 1 or observed.get('status') != 'ACTIVE'
                or observed.get('verify_jwt') != manifest['verify_jwt'] or installed != candidate):
            raise Blocked('upload_outcome_unverified_reconcile_do_not_retry')
        result = {'deployed': not bool(rollback_artifact), 'rollback_exercised': bool(rollback_artifact),
                  'function': TARGET, 'version': observed['version'], 'change_id': change,
                  'source_commit': SOURCE, 'manifest_sha256': pin, 'recovery_artifact_id': artifact,
                  'all_modules_verified': True, 'JWT_configuration_preserved': True,
                  'standing_grant_changes': 0, 'approval_status_written': False,
                  'functional_acceptance_passed': False}
        event = 'provider_response_fix_rollback_verified' if rollback_artifact else 'provider_response_fix_source_verified'
        detail = {**result, 'actor_kind': 'protected_release_service',
                  'github_run_id': os.environ.get('GITHUB_RUN_ID')}
        r.sql(f"INSERT INTO public.sandy_engineering_change_events(change_id,event_type,actor,detail) VALUES('{change}','{event}',NULL,{quote(json.dumps(detail))}::jsonb)")
        return result
    except Exception:
        # Lease cleanup is another request; preserve the original safe failure
        # metadata before it can replace last_request with a successful DELETE.
        r.failure_stage = r.stage
        last = getattr(r, 'last_request', None)
        r.failure_request = dict(last) if isinstance(last, dict) else None
        raise
    finally:
        r.sql(f"DELETE FROM public.sandy_engineering_component_leases WHERE component='{TARGET}' AND holder={quote(r.holder)} AND change_id='{change}'")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--manifest', type=Path)
    parser.add_argument('--change-id')
    parser.add_argument('--candidate-change-id')
    parser.add_argument('--prepare', action='store_true')
    parser.add_argument('--deploy', action='store_true')
    parser.add_argument('--reconcile', action='store_true')
    parser.add_argument('--rollback-artifact')
    parser.add_argument('--evidence-dir', type=Path, required=True)
    args = parser.parse_args()
    try:
        out = args.evidence_dir.resolve()
        if out.is_relative_to(ROOT):
            raise Blocked('evidence_must_remain_private_outside_repository')
        out.mkdir(parents=True, exist_ok=True, mode=0o700)
        r = Installer(out)
        r.holder = 'provider-response-fix-' + uuid.uuid4().hex
        if args.prepare:
            if args.deploy or args.rollback_artifact or args.reconcile:
                raise Blocked('preparation_is_read_only')
            github_ci()
            meta = json.loads(r.api('GET', '/functions/' + TARGET))
            body = r.api('GET', '/functions/' + TARGET + '/body')
            manifest = prepare(meta, body, pinned_entry())
            private_write(out, 'release-manifest.json', canonical(manifest))
            result = {'prepared': True, 'deployed': False, 'manifest_sha256': validate_manifest(manifest)}
        else:
            if args.manifest:
                manifest = json.loads(args.manifest.read_bytes())
            elif args.candidate_change_id:
                candidate = str(uuid.UUID(args.candidate_change_id))
                rows = r.sql(f"SELECT evidence->'release_manifest' manifest FROM public.sandy_engineering_tests WHERE change_id='{candidate}' AND outcome='passed' AND evidence->'release_manifest'->>'kind'='owner-approved-provider-response-fix-v1'", True)
                unique = {sha(canonical(x['manifest'])): x['manifest'] for x in rows}
                if len(unique) != 1:
                    raise Blocked('unambiguous_pinned_candidate_manifest_required')
                manifest = next(iter(unique.values()))
            else:
                raise Blocked('private_manifest_required')
            pin = validate_manifest(manifest)
            owner_admission(r, args.change_id, pin)
            if args.reconcile:
                if args.deploy or args.rollback_artifact:
                    raise Blocked('reconciliation_must_be_read_only')
                metadata, _, _ = inspect(r, manifest, restored=True)
                result = {'deployed_source_verified': True, 'deployed_version': metadata['version'],
                          'mutations': 0, 'automatic_retry': False, 'functional_acceptance_passed': False}
            elif args.deploy or args.rollback_artifact:
                result = release(r, manifest, args.change_id, args.rollback_artifact)
            else:
                inspect(r, manifest)
                result = {'preflight_passed': True, 'deployed': False, 'Owner_approval_verified': True}
        private_write(out, 'safe-receipt.json', json.dumps(result, indent=2).encode())
        print(json.dumps({'ok': True, **result}))
        return 0
    except (Blocked, OSError, ValueError, KeyError, TypeError, subprocess.CalledProcessError) as error:
        code = str(error) if isinstance(error, Blocked) else 'provider_release_blocked_or_unknown_outcome'
        failure = {'ok': False, 'error': code, 'automatic_retry': False,
                   'stage': getattr(r, 'failure_stage', r.stage) if 'r' in locals() else 'configuration',
                   'last_management_request': getattr(r, 'failure_request', r.last_request) if 'r' in locals() else None,
                   'approval_status_written': False, 'functional_acceptance_passed': False}
        print(json.dumps(failure))
        if os.environ.get('GITHUB_ACTIONS') == 'true':
            # Check annotations remain readable when signed log downloads are
            # unavailable. Only fixed codes, stage and endpoint/status are used.
            print('::error title=Protected provider release stopped::' + json.dumps(failure))
        return 1


if __name__ == '__main__':
    raise SystemExit(main())
