#!/usr/bin/env python3
"""Verify the bounded hosting candidate offline. Never authorizes or deploys."""
import hashlib
import json
from pathlib import Path
import subprocess
ROOT = Path(__file__).resolve().parents[2]
MANIFEST = ROOT / 'docs/sandy-engineering/evaluations/hosting-logical-account-release-candidate.json'
SOURCE = '1dee65da7b68f12d147d11e3f02befae06416ef2'
PIN = '8f4995fe40f523f06a372fa5de08a8ff802960108f4e7435245e2f618f2c51b2'
REPLACEMENTS = {'sandy-customer-provisioning-api/index.ts', 'sandy-customer-provisioning-api/gateway.ts', 'sandy-customer-provisioning-api/hosting_accounts.json'}
def sha(b): return hashlib.sha256(b).hexdigest()
def verify(raw, read):
    if sha(raw) != PIN:
        raise ValueError('reviewed_manifest_changed')
    m = json.loads(raw); f = m['function']
    if m['source_commit'] != SOURCE or m['project_ref'] != 'zmqlyygzqoidkcwdysok' or f['slug'] != 'sandy-customer-provisioning-api' or f['expected_prior_version'] != 12 or f['verify_jwt'] is not True:
        raise ValueError('bounded_target_required')
    if any(m[k] is not False for k in ['operation_exposure', 'gateway_release', 'provider_effects', 'billing_effects']):
        raise ValueError('logical_only_release_required')
    if set(f['replacement_files']) != REPLACEMENTS or set(f['after_files']) != set(f['before_files']) | REPLACEMENTS:
        raise ValueError('preserve_deployed_modules_required')
    for name, pin in f['before_files'].items():
        if name not in REPLACEMENTS and f['after_files'][name] != pin:
            raise ValueError('unrelated_module_changed')
    for name in REPLACEMENTS:
        if sha(read('supabase/functions/' + name)) != f['after_files'][name]:
            raise ValueError('source_digest_mismatch')
    for name, pin in m['migrations'].items():
        value = read(name)
        if sha(value) != pin or not value.strip().endswith(b'COMMIT;') or b'BEGIN;' not in value:
            raise ValueError('migration_digest_mismatch')
    return {'source_commit': SOURCE, 'manifest_sha256': PIN, 'offline_integrity_passed': True,
            'deployed': False, 'owner_authorization_verified': False,
            'live_customer_acceptance_passed': False, 'preserved_jwt_verification': True}
if __name__ == '__main__':
    print(json.dumps(verify(MANIFEST.read_bytes(), lambda p: subprocess.check_output(['git', 'show', SOURCE + ':' + p], cwd=ROOT))))
