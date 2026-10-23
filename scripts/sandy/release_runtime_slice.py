#!/usr/bin/env python3
"""Release a reviewed Runtime slice through the authorized project administrator.

This is deployment transport, never workload/Owner authorization. It cannot edit
grants, migrations, secrets, IAM or Cloud Run traffic. Default is read-only.
"""
import argparse
import json
import os
from pathlib import Path
import re
import subprocess
import uuid

from release_gcp_admin_read import Installer, digest, quote
from release_web_canary import Blocked, ROOT, original_sources, private_write

# Reviewed components only. A manifest cannot select arbitrary targets/modules.
MODULES = {
    'sandy-agent-runtime-v4': {
        'sandy-agent-runtime-v4/index.ts',
        '_shared/sandy-agent-operations/runtime_records.ts',
        '_shared/sandy-agent-operations/runtime_memory.ts',
        '_shared/sandy-agent-operations/runtime_model_policy.ts',
        '_shared/sandy-agent-operations/identity.ts',
        '_shared/sandy-agent-operations/runtime_conversation.ts',
        '_shared/sandy-agent-operations/runtime_conversation_v4_transport.ts',
    },
    'sandy-examiner-full-cycle': {
        'sandy-examiner-full-cycle/index.ts',
        'sandy-examiner-full-cycle/evidence.ts',
        'sandy-examiner-full-cycle/judge.ts',
        'sandy-examiner-full-cycle/selection.ts',
        '_shared/sandy-executive/receipt.ts',
        '_shared/sandy-executive/outcome.ts',
        '_shared/sandy-executive/assessment.ts',
    },
    'sandy-vm-protocol-api': {'sandy-vm-protocol-api/winrm.ts'},
    'sandy-master-computer': {
        'sandy-master-computer/index.ts',
        '_shared/sandy-agent-operations/worker_computer_identity.ts',
    },
    'sandy-email-runtime-canary': {
        'sandy-email-runtime-canary/index.ts', 'sandy-email-runtime-canary/outcome.ts',
        'sandy-email-runtime-canary/history.ts', '_shared/sandy-executive/outcome.ts',
        '_shared/sandy-executive/history.ts', '_shared/sandy-executive/assessment.ts',
    },
    'sandy-voice-account-context': {
        'sandy-voice-account-context/index.ts', 'sandy-voice-account-context/executive.ts',
        '_shared/sandy-executive/rollout.ts', '_shared/sandy-executive/history.ts',
        '_shared/sandy-executive/outcome.ts', '_shared/sandy-agent-operations/voice_source.ts',
        '_shared/sandy-executive/temporal_context.ts',
    },
    'sandy-engineering-oidc-ingest': {
        'sandy-engineering-oidc-ingest/index.ts',
        'sandy-engineering-oidc-ingest/examiner_scope.ts',
        'sandy-engineering-oidc-ingest/email_fixture.ts',
        'sandy-engineering-oidc-ingest/worker_transport.ts',
        '_shared/sandy-executive/email_shadow_fixture.ts',
    },
}

# These inspected legacy services have exactly one flat source module. Only
# separately allowlisted modules and reviewed manifests can activate a target.
# This is not arbitrary entrypoint rewriting or permission to lose other files.
NORMALIZED_TARGETS = {'sandy-master-computer', 'sandy-email-runtime-canary', 'sandy-voice-account-context', 'sandy-engineering-oidc-ingest'}
FLAT_INDEX_LAYOUT = 'reviewed-flat-index-to-namespaced-v1'
FLAT_REVISIONS = {'sandy-master-computer': (27, True),
                  'sandy-email-runtime-canary': (18, False),
                  'sandy-voice-account-context': (20, False),
                  'sandy-engineering-oidc-ingest': (92, False)}


def hashes(files):
    return {p: digest(v) for p, v in sorted(files.items())}


def valid_map(value):
    return (isinstance(value, dict) and 1 <= len(value) <= 256
            and all(isinstance(p, str) and re.fullmatch(r'[A-Za-z0-9_./-]+', p)
                    and not p.startswith('/') and '..' not in p.split('/')
                    and isinstance(h, str) and re.fullmatch('[a-f0-9]{64}', h)
                    for p, h in value.items()))


def validate(m):
    slug = m.get('function')
    if (m.get('kind') != 'reviewed-runtime-slice-v1' or slug not in MODULES
            or not isinstance(m.get('version'), int) or isinstance(m['version'], bool) or m['version'] < 1
            or not isinstance(m.get('verify_jwt'), bool)
            or not isinstance(m.get('body_sha256'), str)
            or not re.fullmatch('[a-f0-9]{64}', m['body_sha256'])
            or not valid_map(m.get('before_files')) or not valid_map(m.get('replacements'))
            or not set(m['replacements']) <= MODULES[slug]):
        raise Blocked('reviewed_bounded_runtime_manifest_required')
    if slug in NORMALIZED_TARGETS:
        if (m.get('source_layout') != FLAT_INDEX_LAYOUT
                or (m['version'], m['verify_jwt']) != FLAT_REVISIONS[slug]
                or set(m['before_files']) != {'index.ts'}
                or set(m['replacements']) != MODULES[slug]):
            raise Blocked('exact_reviewed_flat_source_layout_required')
    elif m.get('source_layout') is not None or slug + '/index.ts' not in m['before_files']:
        raise Blocked('reviewed_bounded_runtime_manifest_required')
    if any(m['before_files'].get(p) == h for p, h in m['replacements'].items()):
        raise Blocked('unchanged_module_not_a_release')
    return slug


def candidate(m, before):
    validate(m)
    if hashes(before) != m['before_files']:
        raise Blocked('all_original_modules_must_match')
    result = dict(before)
    if m['function'] in NORMALIZED_TARGETS:
        del result['index.ts']
    for p, pin in m['replacements'].items():
        raw = (ROOT / 'supabase/functions' / p).read_bytes()
        if digest(raw) != pin:
            raise Blocked('replacement_digest_changed')
        result[p] = raw
    return result


def installed_hashes(m):
    result = dict(m['before_files'])
    if m['function'] in NORMALIZED_TARGETS:
        del result['index.ts']
    return {**result, **m['replacements']}


def inspect(r, m, installed=False):
    slug = validate(m)
    meta = json.loads(r.api('GET', '/functions/' + slug))
    body = r.api('GET', '/functions/' + slug + '/body')
    files = original_sources(body)
    expected = installed_hashes(m) if installed else m['before_files']
    if (meta.get('slug') != slug or meta.get('status') != 'ACTIVE'
            or meta.get('verify_jwt') != m['verify_jwt']
            or meta.get('version') != m['version'] + int(installed)
            or meta.get('import_map') is True or meta.get('import_map_path')
            or hashes(files) != expected
            or not installed and digest(body) != m['body_sha256']):
        raise Blocked('live_source_or_configuration_drift_reconcile_no_retry')
    return meta, body, files


def source_check(m, manifest_path):
    source = os.environ.get('GITHUB_SHA', '')
    if (os.environ.get('GITHUB_ACTIONS') != 'true'
            or os.environ.get('GITHUB_REF') != 'refs/heads/main'
            or not re.fullmatch('[a-f0-9]{40}', source)):
        raise Blocked('verified_main_release_workflow_required')
    # Both release harness and every changed module must be the tested commit.
    expected_manifest = ROOT / 'docs/sandy-engineering/evaluations/runtime-slices' / (m['function'] + '.json')
    if manifest_path.resolve() != expected_manifest.resolve():
        raise Blocked('fixed_reviewed_manifest_path_required')
    for path in [manifest_path.resolve().relative_to(ROOT).as_posix(), 'scripts/sandy/release_runtime_slice.py',
                 'scripts/sandy/release_gcp_admin_read.py',
                 'scripts/sandy/release_web_canary.py'] + [
                     'supabase/functions/' + p for p in m['replacements']]:
        if subprocess.check_output(['git', 'show', source + ':' + path], cwd=ROOT) != (ROOT/path).read_bytes():
            raise Blocked('source_commit_mismatch')
    return source


def track(r, m, source):
    scope = json.dumps([m['function']])
    key = 'runtime-slice-' + digest(json.dumps(m, sort_keys=True).encode())
    rows = r.sql(f"""INSERT INTO public.sandy_engineering_changes
      (title,problem,expected_behavior,change_purpose,feature_improvement,scope,
       regression_rules,acceptance_criteria,risk,requested_by,idempotency_key,status)
      SELECT 'Reviewed Runtime slice: {m['function']}',
      'Existing Runtime behavior fails a bounded safety or reliability contract',
      {quote('Exact source '+source+'; candidate '+json.dumps(m['replacements'],sort_keys=True))},
      'SANDY Runtime Master Scope authorized implementation',
      'Repair existing execution using shared modules and preserved customer state',
      {quote(scope)}::jsonb,'["No grants, IAM, credentials or production traffic changes"]'::jsonb,
      '["Exact deployed source readback; independent behavior acceptance recorded separately"]'::jsonb,
      'normal',i.user_id,{quote(key)},'proposed'
      FROM public.sandy_engineering_test_identities i JOIN auth.users u ON u.id=i.user_id
      WHERE u.email='sandy-engineering-test@sandy-ai.internal' AND i.enabled AND i.revoked_at IS NULL
      ON CONFLICT(requested_by,idempotency_key) WHERE idempotency_key IS NOT NULL
      DO UPDATE SET updated_at=public.sandy_engineering_changes.updated_at RETURNING id""")
    if len(rows) != 1:
        raise Blocked('tracking_identity_unavailable')
    return str(uuid.UUID(rows[0]['id']))


def release(r, m, deploy=False, manifest_path=None):
    slug = validate(m)
    meta, body, before = inspect(r, m)
    after = candidate(m, before)
    if not deploy:
        return {'preflight_passed': True, 'function': slug, 'version': meta['version'],
                'changed_modules': sorted(m['replacements']), 'deployed': False}
    source = source_check(m, manifest_path)
    r.out.mkdir(mode=0o700, parents=True, exist_ok=False)
    private_write(r.out, 'before.body', body)
    private_write(r.out, 'before.json', json.dumps(meta).encode())
    private_write(r.out, 'manifest.json', json.dumps(m, sort_keys=True).encode())
    private_write(r.out, 'rollback.json', json.dumps({
        'function': slug, 'restore': 'before.body', 'verify_jwt': m['verify_jwt'],
        'only_if_current_modules_equal': hashes(after), 'no_automatic_retry': True,
        'original_files': m['before_files'], 'source_layout': m.get('source_layout'),
        'original_metadata': 'before.json'}).encode())
    change = track(r, m, source)
    r.sql(f"""DO $$ BEGIN INSERT INTO public.sandy_engineering_component_leases
      (component,holder,change_id,expected_source_sha256,expires_at)
      VALUES('{slug}',{quote(r.holder)},'{change}','{m['body_sha256']}',clock_timestamp()+interval '10 minutes')
      ON CONFLICT(component) DO UPDATE SET holder=EXCLUDED.holder,change_id=EXCLUDED.change_id,
      expected_source_sha256=EXCLUDED.expected_source_sha256,expires_at=EXCLUDED.expires_at,
      acquired_at=clock_timestamp() WHERE public.sandy_engineering_component_leases.expires_at<=clock_timestamp();
      IF NOT FOUND THEN RAISE EXCEPTION 'component already leased';END IF;END $$""")
    dispatched = verified = False
    try:
        inspect(r, m)
        if r.sql(f"SELECT count(*)::int held FROM public.sandy_engineering_component_leases WHERE component='{slug}' AND holder={quote(r.holder)} AND change_id='{change}' AND expires_at>clock_timestamp()", True) != [{'held': 1}]:
            raise Blocked('component_lease_lost')
        # Record dispatch before the provider request; uncertainty never triggers replay.
        r.sql(f"INSERT INTO public.sandy_engineering_change_events(change_id,event_type,actor,detail) VALUES('{change}','runtime_slice_dispatch',NULL,{quote(json.dumps({'source_commit':source,'actor_kind':'project_management_release','authorization_basis':'explicit_Runtime_implementation_and_deployment_task','github_run_id':os.environ.get('GITHUB_RUN_ID'),'Owner_approval_created':False,'policy_admission_claimed':False}))}::jsonb)")
        dispatched = True
        private_write(r.out, 'provider-receipt.json', r.upload(slug, after, m['verify_jwt']))
        installed, installed_body, _ = inspect(r, m, True)
        private_write(r.out, 'after.body', installed_body)
        verified = True
        result = {'function':slug,'deployed_version':installed['version'],
                  'source_commit':source,'tracking_change_id':change,
                  'all_module_digests_verified':True,'JWT_configuration_preserved':True,
                  'rollback_preimage_preserved':True,'functional_acceptance_passed':False,
                  'IAM_changes':0,'grant_changes':0,'Cloud_Run_traffic_changes':0}
        r.sql(f"INSERT INTO public.sandy_engineering_change_events(change_id,event_type,actor,detail) VALUES('{change}','runtime_slice_source_verified',NULL,{quote(json.dumps(result))}::jsonb)")
        return result
    except Exception:
        if dispatched and not verified:
            # A later operator must see uncertainty even after the lease expires.
            # Never turn an audit transport error into an automatic provider retry.
            try:
                r.sql(f"INSERT INTO public.sandy_engineering_change_events(change_id,event_type,actor,detail) VALUES('{change}','runtime_slice_outcome_unknown',NULL,{quote(json.dumps({'source_commit':source,'function':slug,'reconciliation_required':True,'automatic_retry':False}))}::jsonb)")
            except Exception:
                pass
        raise
    finally:
        if not dispatched or verified:
            r.sql(f"DELETE FROM public.sandy_engineering_component_leases WHERE component='{slug}' AND holder={quote(r.holder)} AND change_id='{change}'")


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('manifest', type=Path)
    p.add_argument('--deploy', action='store_true')
    p.add_argument('--verify-installed', action='store_true')
    p.add_argument('--evidence-dir', type=Path, required=True)
    a = p.parse_args()
    if a.deploy and a.verify_installed:
        p.error('choose deployment or independent readback')
    r = Installer(a.evidence_dir / 'private-preimages')
    report = {'passed':False}
    try:
        m = json.loads(a.manifest.read_bytes())
        if a.verify_installed:
            meta, _, _ = inspect(r, m, True)
            report.update(installed_source_verified=True, function=m['function'], version=meta['version'], mutations=0)
        else:
            report.update(release(r, m, a.deploy, a.manifest))
        report['passed'] = True
    except Exception as e:
        report.update(error=str(e) if isinstance(e, Blocked) else 'release_failed_or_unknown_reconcile_before_retry',
                      last_management_request=r.last_request)
    a.evidence_dir.mkdir(parents=True, exist_ok=True)
    private_write(a.evidence_dir, 'redacted-receipt.json', json.dumps(report, indent=2).encode())
    print('::notice title=Runtime slice release::' + json.dumps(report))
    return 0 if report['passed'] else 1


if __name__ == '__main__':
    raise SystemExit(main())
