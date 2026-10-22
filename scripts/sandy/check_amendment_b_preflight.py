#!/usr/bin/env python3
"""Read-only reconciliation of the frozen Amendment B release against production.

Report all prerequisites before entering a protected release. Never apply SQL,
create approval events, reinterpret occupied migration versions or upload source.
"""
import argparse
import hashlib
import json
from pathlib import Path
import uuid
from release_amendment_b import Amendment, candidate, inspect as inspect_sources
from release_owner_session_repair import candidate as repair_candidate, HISTORY_VERSION
from release_web_canary import Blocked


def inspect(change):
    manifest, pin, declaration, _, migrations = candidate()
    _, _, repair_sql = repair_candidate()
    expected = {Path(p).name.split('_')[0]: value for p, value in migrations.items()}
    expected[HISTORY_VERSION] = repair_sql.decode()
    release = Amendment(None, change, manifest, pin, declaration)
    blockers = []
    try:
        release.admission()
    except Blocked as error:
        if str(error) != 'genuine_owner_approval_of_release_and_declaration_required':
            raise
        blockers.append({'kind': 'genuine_pinned_owner_approval_not_recorded'})
    versions = ','.join("'" + version + "'" for version in expected)
    for row in release.sql('SELECT version,name,statements FROM supabase_migrations.schema_migrations WHERE version IN (' + versions + ')'):
        actual = row.get('statements')
        if not isinstance(actual, list) or len(actual) != 1 or actual[0] != expected[row['version']]:
            blockers.append({'kind': 'migration_version_occupied_by_other_source', 'version': row['version'], 'existing_name': row['name'], 'expected_sql_sha256': hashlib.sha256(expected[row['version']].encode()).hexdigest()})
        elif row['version'] != HISTORY_VERSION:
            blockers.append({'kind': 'migration_already_applied_reconcile_before_retry', 'version': row['version']})
    for function in manifest['functions']:
        current = json.loads(release.api('GET', '/functions/' + function['slug']))
        if current.get('version') != function['expected_prior_version']:
            blockers.append({'kind': 'source_prerequisite_requires_reconciliation', 'function': function['slug'], 'expected_version': function['expected_prior_version'], 'actual_version': current.get('version')})
    if not blockers:
        inspect_sources(release)
    return {'change_id': change, 'source_commit': manifest['source_commit'], 'manifest_sha256': pin, 'read_only': True, 'ready': not blockers, 'blockers': blockers, 'deployment_started': False, 'approval_written': False}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--change-id', required=True, type=uuid.UUID)
    args = parser.parse_args()
    result = inspect(str(args.change_id))
    print(json.dumps(result, indent=2))
    raise SystemExit(0 if result['ready'] else 2)
