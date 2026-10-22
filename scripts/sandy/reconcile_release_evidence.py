#!/usr/bin/env python3
"""Reconcile source contracts, an installed gateway map and read-only live evidence.

Never turns source presence, registry flags or deployment metadata into a passed
functional test. The 161 broad acceptance gates must be attested separately.
"""
from __future__ import annotations
import argparse
import copy
import json
from collections import Counter
from pathlib import Path

ORCHESTRATION_SCOPE = {
    'orchestration.operations.enqueue': [3], 'orchestration.plans.validate': [10],
    'orchestration.plans.execute': [11], 'orchestration.plans.get': [11],
    'orchestration.jobs.get': [4], 'orchestration.jobs.events': [5],
    'orchestration.jobs.cancel': [6], 'orchestration.jobs.retry': [7],
}
POLICY_SCOPE = {
    'system.audit.list': [9], 'system.audit.verify': [9], 'system.audit.checkpoint': [9],
    'system.credentials.issue': [144], 'system.credentials.revoke': [144],
    'system.execution.get': [4],
}
LIFECYCLE_SCOPE = {'system.lifecycle.get': [4, 8], 'system.lifecycle.verify': [8],
                   'system.lifecycle.poll': [34], 'system.lifecycle.compensate': [8]}
LEGACY_SCOPE = {
    'cloud.targets.list': [26], 'cloud.video.target_status': [26, 150],
    'deployment.functions.register': [83, 155], 'deployment.jobs.status': [4],
    'deployment.jobs.approve_read': [3, 155], 'deployment.jobs.execute': [3, 11, 155],
    'deployment.management.deploy_smoke': [83, 155],
    'deployment.management.preflight': [10, 155],
    'deployment.management.release.preflight': [10, 155],
    'deployment.video.provision_policy': [150, 155],
    'github.job.reconcile': [128, 155], 'github.write.preflight': [114, 155],
    'supabase.management.verify': [83, 155],
    'google_cloud.cloud_run.permissions': [17, 60], 'google_cloud.cloud_run.status': [60],
    'google_cloud.iam.grant_deployment': [17], 'google_cloud.iam.project_policy_read': [17],
    'google_cloud.iam.runtime_create': [19], 'google_cloud.iam.runtime_prepare': [17, 19],
    'google_cloud.vm.status': [26], 'google_cloud.vm.bootstrap_probe': [35],
    'google_cloud.vm.bootstrap_status': [44], 'google_cloud.vm.service_status': [40],
    'google_cloud.mcp.cloud_run_deploy': [60, 155],
    'google_cloud.mcp.container_build': [63, 155],
    'google_cloud.mcp.registry_writer_grant': [17, 63, 155],
    'google_cloud.mcp.public_ingress': [17, 60, 155],
    'video.network.preflight': [47, 50, 150], 'video.osconfig.access': [17, 43, 150],
    'video.osconfig.agent_status': [43, 150], 'video.osconfig.enable': [15, 43, 150],
    'video.osconfig.permissions': [17, 43, 150],
    'video.osconfig.policy_preflight': [39, 43, 150],
    'video.osconfig.vm_prepare': [28, 43, 150],
    'video.ssh.iam_grant': [22, 35, 150], 'video.ssh.preflight': [35, 36, 150],
}
EXTRA_SCOPE = {'deployment.jobs.request': [3, 11]}
PRIVATE_PLANNING_SCOPE = {
    'agent.missions.plan.prepare': [154, 155, 160],
    'agent.missions.questions.review': [154, 155, 160],
}
# These seven handlers report recorded Controller metadata. They do not execute
# provider operations or independently attest the core/platform capabilities.
CONTROLLER_METADATA_OPERATIONS = frozenset({
    'system.capabilities', 'system.catalog', 'system.connections',
    'system.coverage', 'system.operation_catalog', 'system.operation_status',
    'system.runtime',
})


def mapped_requirements(contract):
    explicit = contract['requirement_ids']
    if explicit:
        return explicit, 'explicit_contract_requirement_metadata'
    operation, group = contract['operation'], contract['group']
    if group == 'customer_atomic_mutations':
        return [{'tasks': 153, 'calendar': 148, 'files': 156}[operation.split('.')[0]]], 'reviewed_domain_contract'
    if group == 'customer_keys':
        return [144], 'reviewed_domain_contract'
    if group == 'orchestration':
        return ORCHESTRATION_SCOPE[operation], 'reviewed_canonical_route_contract'
    if group == 'policy':
        return POLICY_SCOPE[operation], 'reviewed_policy_contract'
    if group == 'provider_lifecycle':
        return LIFECYCLE_SCOPE[operation], 'reviewed_provider_lifecycle_contract'
    if group == 'mcp_diagnostic':
        return [1, 2, 155], 'reviewed_discovery_diagnostic_not_provider_execution'
    if group == 'system_metadata' and operation in CONTROLLER_METADATA_OPERATIONS:
        return [155], 'reviewed_recorded_controller_metadata_not_core_or_provider_verification'
    if group == 'provider_artifact_delivery' and operation == 'provider.artifacts.read_private':
        # The compiled operation admits only the fixed Artifact Registry file
        # adapter and five GitHub Actions downloads. This is custody delivery,
        # not implementation/verification of every constituent in those families.
        return [63, 128, 129], 'reviewed_six_class_private_delivery_not_live_provider_verification'
    if group == 'legacy_application':
        if operation in LEGACY_SCOPE:
            return LEGACY_SCOPE[operation], 'reviewed_fixed_compatibility_contract'
        if operation.startswith('engineering.models.'):
            return [155, 160], 'reviewed_fixed_compatibility_contract'
        if operation.startswith('engineering.rollback.'):
            return [8, 155], 'reviewed_fixed_compatibility_contract'
        # These are fixed Engineering/Controller deployment diagnostics and
        # workflows. They are not broad provider-family implementations.
        return [155], 'reviewed_engineering_compatibility_surface'
    raise ValueError('Unmapped source contract: ' + operation)


def reconcile(prior, source, live, gateway_ids=None):
    result = copy.deepcopy(prior)
    requirements = result['requirements']
    if len(requirements) != 161 or {r['requirement_id'] for r in requirements} != set(range(1, 162)):
        raise ValueError('Expected every original requirement exactly once')
    baseline_deployed = result.setdefault('baseline_deployed_gateway_operation_ids', sorted({
        op for row in requirements for op in row['installed_gateway_operation_ids']}))
    source_ids = {c['operation'] for c in source['contracts']}
    if len(source_ids) != len(source['contracts']):
        raise ValueError('Duplicate source contract')
    mappings = {}
    for row in requirements:
        for operation in row.get('registered_operation_ids', []):
            if operation not in source_ids:
                mappings.setdefault(operation, set()).add(row['requirement_id'])
    basis = {}
    for contract in source['contracts']:
        operation = contract['operation']
        ids, method = mapped_requirements(contract)
        if any(type(n) is not int or not 1 <= n <= 161 for n in ids):
            raise ValueError('Invalid mapped requirement: ' + operation)
        mappings.setdefault(operation, set()).update(ids)
        basis[operation] = method
    for operation, ids in EXTRA_SCOPE.items():
        mappings.setdefault(operation, set()).update(ids)
    for operation, ids in PRIVATE_PLANNING_SCOPE.items():
        if operation not in source_ids:
            mappings.setdefault(operation, set()).update(ids)
            basis[operation] = 'reviewed_private_worker_contract_not_public_gateway_or_model_verification'
    registry = live['registry']
    registered = {r['operation']: r for r in registry['operations']}
    deployed = set(live.get('deployed_gateway_operation_ids', baseline_deployed))
    source_gateway = set(gateway_ids) if gateway_ids is not None else None
    for row in requirements:
        identity = row['requirement_id']
        row['registered_operation_ids'] = sorted(op for op in registered if identity in mappings.get(op, set()))
        row['installed_gateway_operation_ids'] = sorted(op for op in deployed if identity in mappings.get(op, set()))
        row['historical_registry_verified_operation_ids'] = sorted(op for op, r in registered.items() if r['verified'] and identity in mappings.get(op, set()))
        row['source_contract_operation_ids'] = sorted(op for op in source_ids if identity in mappings[op])
        row['source_gateway_operation_ids'] = None if source_gateway is None else sorted(op for op in source_gateway if identity in mappings.get(op, set()))
        row['complete'] = False
        row['acceptance_state'] = 'not_complete'
    result.update({
        'runtime_registry_rows': registry['rows'],
        'schema_and_runtime_candidates': result['provider_schema_candidates'] + registry['rows'],
        'completed_requirements': 0,
        'requirements_with_candidate_evidence': sum(bool(r['provider_schema_candidate_count'] or r['registered_operation_ids'] or r['source_contract_operation_ids']) for r in requirements),
        'requirements_with_typed_source_contracts': sum(bool(r['source_contract_operation_ids']) for r in requirements),
        'requirements_with_typed_source_or_deployed_gateway_contracts': sum(bool(r['source_contract_operation_ids'] or r['installed_gateway_operation_ids']) for r in requirements),
        'installed_gateway_operation_mappings': len(deployed),
        'source_gateway_operation_mappings': None if source_gateway is None else len(source_gateway),
        'typed_source_contract_count': len(source_ids),
        'source_contract_groups': source['groups'],
        'source_contracts_not_in_deployed_gateway': sorted(source_ids - deployed),
        'unmapped_registered_operation_ids': sorted(set(registered) - set(mappings)),
        'unmapped_source_gateway_operation_ids': None if source_gateway is None else sorted(source_gateway - set(mappings)),
        'historically_verified_registry_operations': registry['verified_operations'],
        'live_evidence_captured_at_utc': live['captured_at_utc'],
        'live_evidence_source_head': live['local_head'],
        'evidence_semantics': {
            'typed_source_contract_count': 'Working-tree typed records, including disabled and dependency-blocked operations; not a count of functional implementations or deployments.',
            'installed_gateway_operation_mappings': 'IDs installed in the source-attested deployed gateway, including closed mutations; not completed requirements.',
            'source_gateway_operation_mappings': 'IDs in the current composed working-tree gateway; null means not yet captured.',
            'historically_verified_registry_operations': 'Existing registry flags preserved; no fresh deployed-user-path attestation is inferred.',
            'completion': 'All161 platform-wide acceptance gates remain unmet; source/registry/deployment evidence alone cannot set complete=true.',
            'controller_metadata': 'Seven reviewed recorded-Controller metadata handlers map only to requirement155; no independent core/platform/provider execution is inferred.',
            'provider_artifact_delivery': 'The single bounded private-delivery contract maps to its explicit Artifact Registry/Actions source-family requirements63/128/129; it neither completes those families nor verifies a live download.',
            'private_planning_registry_addendum': 'Two reviewed10070 private worker contracts map to requirements154/155/160. An explicit pinned export may include them in typed source records; registry-only fallback never adds them to that count or to public gateway IDs.',
        },
        'source_mapping_basis': basis,
    })
    quota_ids = sorted(c['operation'] for c in source['contracts'] if 16 in c['requirement_ids'])
    for missing in result.get('unavailable_schema_sources', []):
        if missing.get('provider') == 'gcp-cloudquotas':
            missing['alternative_contract_source_handler_operation_ids'] = quota_ids
            missing['alternative_contract_source_handler_state'] = (
                'source_attested_gateway_mapping_not_functional_verification'
                if quota_ids and set(quota_ids).issubset(deployed)
                else 'source_only_or_pending_gateway_mapping_not_functional_verification'
            )
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--reconciliation', type=Path, required=True)
    parser.add_argument('--source-contracts', type=Path, required=True)
    parser.add_argument('--live-evidence', type=Path, required=True)
    parser.add_argument('--source-gateway-ids', type=Path)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    source = json.loads(args.source_contracts.read_text())
    gateway = json.loads(args.source_gateway_ids.read_text()) if args.source_gateway_ids else source.get('installed_operation_ids')
    if isinstance(gateway, dict):
        gateway = gateway.get('installed_operation_ids', gateway.get('operations'))
    if gateway is not None and (not isinstance(gateway, list) or any(not isinstance(x, str) for x in gateway)):
        parser.error('Gateway IDs must be a JSON string array or installed_operation_ids object')
    result = reconcile(json.loads(args.reconciliation.read_text()), source, json.loads(args.live_evidence.read_text()), gateway)
    args.output.write_text(json.dumps(result, indent=2) + '\n')
    print(json.dumps({k: result[k] for k in ['scope_requirements', 'runtime_registry_rows', 'completed_requirements', 'typed_source_contract_count', 'installed_gateway_operation_mappings', 'source_gateway_operation_mappings', 'requirements_with_typed_source_contracts']}))


if __name__ == '__main__':
    main()
