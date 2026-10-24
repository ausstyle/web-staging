"""Plan 161-family acceptance from a captured policy and registry, without writes.

Class eligibility is only a candidate: target, identity, input, provider rights,
exposure, fixtures and actual invocation still decide execution. Never turn this
plan into a grant or count its candidates as accepted operations.
"""
import argparse
from collections import Counter
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path


def build_plan(requirements, registry, disposition, delegation, fixture_operations, observed_at):
    if sorted(r['requirement_id'] for r in requirements) != list(range(1, 162)):
        raise ValueError('exactly_161_unique_families_required')
    rows = {r['operation']: r for r in registry}
    if len(rows) != len(registry):
        raise ValueError('duplicate_registry_operation')
    policy = delegation.get('policy', {})
    active = (not delegation.get('revoked_at')
              and datetime.fromisoformat(delegation['expires_at']) > observed_at)
    classes = policy.get('classes', {}) if active else {}
    exclusions = set(disposition.get('standalone_mcp_tools_not_required', {}))
    exclusions.update(disposition.get('supporting_diagnostic_families', {}))
    result = []
    for family in requirements:
        ident = str(family['requirement_id'])
        reviewed = ident in disposition.get('explicit_family_required_operations', {})
        names = set(disposition.get('explicit_family_required_operations', {}).get(
            ident, family.get('registered_operation_ids', []))) - exclusions
        buckets = {}
        for name in sorted(names):
            row = rows.get(name)
            if not row:
                reason = 'missing_registry'
            elif row.get('api_exposed') is not True or row.get('ai_exposed') is not True:
                reason = 'closed_exposure'
            elif not active:
                reason = 'delegation_inactive'
            elif name in fixture_operations:
                reason = 'exact_legacy_fixture_only'
            elif name in {'system.execution.get', 'system.lifecycle.get', 'system.lifecycle.verify', 'system.lifecycle.compensate'}:
                reason = 'own_receipt_or_conditionally_authorized_recovery'
            elif not row.get('operation_class'):
                reason = 'separate_authority_or_mapping_review'
            elif row['operation_class'] in classes.get(row.get('provider'), []) and policy.get('resources', {}).get(row.get('provider')):
                reason = 'exposed_class_candidate_not_execution_authority'
            else:
                reason = 'outside_current_standing_classes'
            buckets.setdefault(reason, []).append(name)
        result.append({'family_id': int(ident), 'requirement': family['requirement'],
                       'constituents_reviewed': reviewed,
                       'unreviewed_candidates_are_not_scope_expansion': not reviewed,
                       'fully_accepted': False,
                       'current_contract_successes': [name for name in sorted(names) if rows.get(name, {}).get('current_success')],
                       'operation_disposition': buckets})
    return {'observed_at_utc': observed_at.isoformat(), 'delegation_version': delegation['version'],
            'delegation_expires_at': delegation['expires_at'], 'delegation_active': active,
            'targets': policy.get('resources', {}), 'classes': policy.get('classes', {}),
            'permissions_modified': False, 'acceptance_inferred': False,
            'family_counts_by_overlapping_disposition': dict(Counter(k for f in result for k in f['operation_disposition'])),
            'families': result}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--registry', type=Path, required=True)
    parser.add_argument('--delegation', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    root = Path(__file__).resolve().parents[2]
    sources = {'requirements': root / 'docs/sandy-api/scope-reconciliation.json',
               'disposition': root / 'docs/sandy-api/scope-operation-disposition.json',
               'fixture': root / 'supabase/functions/sandy-operation-api/engineering_identity_policy.json',
               'registry': args.registry, 'delegation': args.delegation}
    inputs = {key: json.loads(path.read_text()) for key, path in sources.items()}
    delegations = inputs['delegation']
    if len(delegations) != 1:
        raise ValueError('select_one_workload_delegation_explicitly')
    report = build_plan(inputs['requirements']['requirements'], inputs['registry'], inputs['disposition'],
                        delegations[0], inputs['fixture']['operations'], datetime.now(timezone.utc))
    report['source_sha256'] = {key: hashlib.sha256(path.read_bytes()).hexdigest() for key, path in sources.items()}
    args.output.write_text(json.dumps(report, indent=2) + '\n')
    print(json.dumps(report['family_counts_by_overlapping_disposition'], sort_keys=True))


if __name__ == '__main__':
    main()
