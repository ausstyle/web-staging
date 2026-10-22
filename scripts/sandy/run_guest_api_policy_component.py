"""Exercise guest standing authorization in one database ROLLBACK transaction.

This administrative fixture runner never invokes a VM, applies a migration,
changes a standing grant or certifies an operation. A successful SQL request
must return the suite's explicit assertion count, rather than an empty response.
"""
import argparse
import datetime
import hashlib
import json
from pathlib import Path

from engineering_runtime import EngineeringRuntime, MANAGEMENT

ROOT = Path(__file__).resolve().parents[2]
MIGRATION = ROOT / 'supabase/migrations/20261022170000_sandy_guest_standing_dispatch.sql'
SUITES = ('sandy_guest_standing_dispatch_rollback',
          'sandy_standing_session_binding_rollback',
          'sandy_standing_engineering_rollback')


def transaction_body(path):
    return '\n'.join(line for line in path.read_text().splitlines()
                     if line.strip() not in ('BEGIN;', 'COMMIT;', 'ROLLBACK;'))


def run(output, deployed=False, bounded=False):
    runtime = EngineeringRuntime()
    migration = (ROOT / 'supabase/migrations/20261022173000_sandy_bounded_guest_policy.sql'
                 if bounded else MIGRATION)
    suites = ('sandy_bounded_guest_policy_rollback',) + SUITES if bounded else SUITES
    report = {'observed_at': datetime.datetime.now(datetime.timezone.utc).isoformat(),
              'kind': 'database_boundary_fixtures_full_rollback',
              'migration_sha256': hashlib.sha256(migration.read_bytes()).hexdigest(),
              'candidate_installed_inside_rollback': not deployed,
              'provider_execution': False, 'VM_acceptance': False, 'suites': []}
    for name in suites:
        path = ROOT / 'supabase/tests' / (name + '.sql')
        query = "BEGIN; SET LOCAL lock_timeout='3s'; SET LOCAL statement_timeout='45s';\n"
        if not deployed:
            query += transaction_body(migration) + '\n'
        query += transaction_body(path) + '\nROLLBACK;'
        status, body = runtime._http('POST', MANAGEMENT + '/database/query',
                                    runtime._management,
                                    {'query': query, 'read_only': False})
        checks = (body[0].get('checks') if isinstance(body, list) and len(body) == 1
                  and isinstance(body[0], dict) else None)
        passed = status == 201 and type(checks) is int and checks > 0
        report['suites'].append({'name': name, 'source_sha256': hashlib.sha256(path.read_bytes()).hexdigest(),
                                 'HTTP_status': status, 'passed': passed,
                                 'database_assertions': checks, 'rolled_back': passed})
        output.write_text(json.dumps(report, indent=2) + '\n')
        if not passed:
            raise RuntimeError('guest_policy_database_fixture_failed:' + name)
    return report


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', required=True, type=Path)
    parser.add_argument('--deployed', action='store_true',
                        help='Test already-installed functions without reinstalling the candidate.')
    parser.add_argument('--bounded', action='store_true',
                        help='Include the bounded file/package/service policy candidate and suite.')
    args = parser.parse_args()
    print(json.dumps(run(args.output, args.deployed, args.bounded)))
