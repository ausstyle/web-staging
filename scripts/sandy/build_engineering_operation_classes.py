"""Classify installed, versioned provider contracts; never create registry operations.

Transport descriptors, not caller operation prefixes, establish routine classes.
Unknown writes, entitlement/cost changes and security operations fail closed.
"""
import argparse
import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SOURCES = ['sandy-provider-operation-api/contracts.json',
           'sandy-provider-operation-api/expansion_contracts.json',
           'sandy-legacy-compatibility-api/provider_contracts.json']


def classify(op):
    provider, method, path = op['provider'], op['method'], op['path']
    if op.get('requires_cost_approval') or op.get('binding_kind') or op.get('secondary_binding_kind'):
        return 'restricted'
    if provider == 'github':
        if not path.startswith('/repos/{owner}/{repo}/') and path != '/repos/{owner}/{repo}':
            return 'restricted'
        if method == 'GET':
            if '/git/blobs/' in path:
                return 'restricted'
            if op.get('kind') == 'file_content':
                return 'source_read'
            if op.get('sensitive'):
                return 'restricted'
            return 'metadata_read'
        if '/contents/' in path and method in ('PUT', 'DELETE'):
            return 'code_write'
        # Ref deletion has no provider compare-and-swap or preserved old head.
        # It needs a separately reviewed destructive/recovery policy.
        if '/git/' in path and method in ('POST', 'PATCH'):
            return 'git_write'
        if path == '/repos/{owner}/{repo}/pulls' and method == 'POST':
            return 'pull_request_write'
        return 'restricted'
    if provider == 'supabase' and not path.startswith('/v1/projects/{ref}'):
        return 'restricted'
    if provider in ('gcp', 'supabase') and (method == 'GET' or op.get('semantic_read') is True):
        # Secret values, signed URLs, raw backups, Auth configuration and arbitrary
        # database queries are not routine metadata reads.
        if any(word in (path + ' ' + op['operation']).lower() for word in
               ('secret', 'token', 'credential', 'apikey', 'api_key', 'signed', 'download', 'backup', 'config/auth', 'sql', 'query')):
            return 'restricted'
        return 'metadata_read'
    return 'restricted'


def build():
    rows = {}
    for source in SOURCES:
        raw = json.loads((ROOT / 'supabase/functions' / source).read_text())
        operations = raw['operations'] if isinstance(raw, dict) else raw
        for op in operations:
            rows[op['operation']] = {'operation': op['operation'], 'provider': op['provider'],
                'operation_class': classify(op), 'method': op['method'], 'path': op['path'],
                'is_mutation': op['is_mutation'], 'contract_sha256': op['contract_sha256'],
                'source_path': 'supabase/functions/' + source}
    return sorted(rows.values(), key=lambda r: r['operation'])


if __name__ == '__main__':
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--output', type=Path, required=True)
    args = p.parse_args()
    rows = build()
    args.output.write_text(json.dumps(rows, separators=(',', ':')) + '\n')
    print(json.dumps({'reviewed_contracts': len(rows),
        'manifest_sha256': hashlib.sha256(args.output.read_bytes()).hexdigest(),
        'registry_operations_added': 0}))
