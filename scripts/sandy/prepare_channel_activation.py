"""Capture fixed-channel preimages and prepare immutable activation manifests.

Read-only default and sole mode. Does not deploy, grant authority, alter a route,
register an operation, send a message or create a voice session. The separate
existing protected release path must validate CI, delegation and component leases.
"""
from __future__ import annotations
import argparse
import hashlib
import json
from pathlib import Path, PurePosixPath
import re
import subprocess
from release_gcp_admin_read import Installer
from release_web_canary import Blocked, ROOT, original_sources, private_write

TARGETS = {
    'sandy-email-runtime-canary': {'version': 18, 'before_source_sha256': '0a42ec2fc2de66ba164903433dd75f86c5adb5078ab39eb8e7a58b8bbc04569f'},
    'sandy-voice-account-context': {'version': 20, 'before_source_sha256': '42bc5f63127468a24a0e2ce5eaa1dfbe74b38ae86dc49120d6df9f298268cb44'},
}

def digest(value):
    return hashlib.sha256(value).hexdigest()


def committed_sources(commit, slug):
    if slug not in TARGETS or not re.fullmatch('[a-f0-9]{40}', commit):
        raise Blocked('fixed_channel_and_immutable_commit_required')
    files = {}
    def visit(name):
        if name in files:
            return
        if name.startswith('/') or '..' in PurePosixPath(name).parts:
            raise Blocked('channel_source_path_invalid')
        try:
            value = subprocess.check_output(['git', 'show', commit + ':supabase/functions/' + name], cwd=ROOT, stderr=subprocess.DEVNULL)
        except subprocess.CalledProcessError:
            raise Blocked('committed_channel_dependency_missing') from None
        files[name] = value
        for dependency in re.findall(r'''(?:\bfrom\s*|\bimport\s*(?:\(\s*)?)["'](\.[^"']+)["']''', value.decode()):
            parts = []
            for part in (PurePosixPath(name).parent / dependency).parts:
                if part == '..':
                    if not parts: raise Blocked('channel_dependency_escapes_functions')
                    parts.pop()
                elif part != '.':
                    parts.append(part)
            visit('/'.join(parts))
    visit(slug + '/index.ts')
    return files


def check_before(slug, meta, files):
    expected = TARGETS.get(slug)
    if not expected or meta.get('version') != expected['version'] or meta.get('status') != 'ACTIVE' or meta.get('verify_jwt') is not False:
        raise Blocked('channel_live_revision_changed_reconcile_before_retry')
    if len(files) != 1 or next(iter(files)) != 'index.ts' or digest(files['index.ts']) != expected['before_source_sha256']:
        raise Blocked('channel_live_original_modules_changed_reconcile_before_retry')


def prepare(commit, output, slugs=None):
    if output.resolve().is_relative_to(ROOT):
        raise Blocked('channel_rollback_capture_must_be_outside_repository')
    output.mkdir(mode=0o700, parents=True, exist_ok=False)
    reader = Installer(output)
    reports = []
    for slug in slugs or TARGETS:
        candidates = committed_sources(commit, slug)
        meta_raw = reader.api('GET', '/functions/' + slug)
        body = reader.api('GET', '/functions/' + slug + '/body')
        meta = json.loads(meta_raw)
        originals = original_sources(body)
        check_before(slug, meta, originals)
        directory = output / slug; directory.mkdir(mode=0o700)
        private_write(directory, 'before-metadata.json', meta_raw)
        private_write(directory, 'before.body', body)
        manifest = {
            'source_commit': commit, 'function': slug, 'expected_prior_version': meta['version'],
            'prior_bundle_sha256': digest(body), 'verify_jwt': False,
            'prior_original_files': {name: digest(value) for name, value in originals.items()},
            'files': {name: digest(value) for name, value in candidates.items()},
            'rollback': 'Restore preserved exact original modules with matching source/version and a fresh component lease; retain all customer state, delivery receipts, consent and immutable audits. Reconcile unknown provider outcomes before retry.',
            'functional_acceptance_passed': False,
        }
        private_write(directory, 'activation-manifest.json', json.dumps(manifest, indent=2).encode())
        reports.append({'function': slug, 'source_commit': commit, 'previous_version': meta['version'], 'module_count': len(candidates), 'source_preimage_captured': True, 'deployed': False})
    return reports


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source-commit', required=True)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--only', choices=list(TARGETS), nargs='+')
    args = parser.parse_args()
    try:
        print(json.dumps({'ok': True, 'channels': prepare(args.source_commit, args.output, args.only), 'provider_operations_executed': 0}))
    except Blocked as error:
        print(json.dumps({'ok': False, 'error': str(error), 'deployed': False}))
        raise SystemExit(1)
