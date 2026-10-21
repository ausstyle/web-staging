"""Evidence mappings must not inflate the original platform acceptance gates."""
import unittest

from reconcile_release_evidence import (
    CONTROLLER_METADATA_OPERATIONS, mapped_requirements, reconcile,
)


class ReleaseEvidence(unittest.TestCase):
    def test_only_reviewed_recorded_metadata_maps_to_controller_requirement(self):
        for operation in CONTROLLER_METADATA_OPERATIONS:
            ids, basis = mapped_requirements({
                'operation': operation, 'group': 'system_metadata',
                'requirement_ids': [],
            })
            self.assertEqual(ids, [155])
            self.assertIn('not_core_or_provider_verification', basis)
        with self.assertRaisesRegex(ValueError, 'Unmapped source contract'):
            mapped_requirements({
                'operation': 'system.future_live_probe',
                'group': 'system_metadata', 'requirement_ids': [],
            })

    def test_private_delivery_retains_explicit_source_family_mapping(self):
        self.assertEqual(mapped_requirements({
            'operation': 'provider.artifacts.read_private',
            'group': 'provider_artifact_delivery',
            'requirement_ids': [63, 128, 129],
        }), ([63, 128, 129], 'explicit_contract_requirement_metadata'))
        ids, basis = mapped_requirements({
            'operation': 'provider.artifacts.read_private',
            'group': 'provider_artifact_delivery', 'requirement_ids': [],
        })
        self.assertEqual(ids, [63, 128, 129])
        self.assertIn('not_live_provider_verification', basis)
        with self.assertRaisesRegex(ValueError, 'Unmapped source contract'):
            mapped_requirements({
                'operation': 'provider.artifacts.future_sensitive_read',
                'group': 'provider_artifact_delivery', 'requirement_ids': [],
            })

    def test_source_deployment_and_historical_flags_cannot_certify_completion(self):
        prior = {
            'provider_schema_candidates': 0,
            'requirements': [{
                'requirement_id': identity,
                'installed_gateway_operation_ids': [],
                'registered_operation_ids': [],
                'provider_schema_candidate_count': 0,
                'complete': True,
            } for identity in range(1, 162)],
        }
        operation = 'system.runtime'
        source = {'groups': [], 'contracts': [{
            'operation': operation, 'group': 'system_metadata',
            'requirement_ids': [],
        }]}
        live = {
            'registry': {'rows': 1, 'operations': [{
                'operation': operation, 'verified': True,
            }], 'verified_operations': [operation]},
            'deployed_gateway_operation_ids': [operation],
            'captured_at_utc': '2026-10-21T00:00:00Z',
            'local_head': 'synthetic-local-fixture',
        }
        result = reconcile(prior, source, live, [operation])
        self.assertEqual(result['completed_requirements'], 0)
        self.assertTrue(all(not row['complete'] for row in result['requirements']))
        touched = [row['requirement_id'] for row in result['requirements']
                   if row['source_contract_operation_ids']]
        self.assertEqual(touched, [155])
        self.assertEqual(result['unmapped_source_gateway_operation_ids'], [])
        self.assertEqual(result['historically_verified_registry_operations'], [operation])
        self.assertTrue(prior['requirements'][0]['complete'])

    def test_private_worker_registry_addendum_does_not_inflate_public_or_export_counts(self):
        prior = {
            'provider_schema_candidates': 0,
            'requirements': [{
                'requirement_id': identity,
                'installed_gateway_operation_ids': [],
                'registered_operation_ids': [],
                'provider_schema_candidate_count': 0,
            } for identity in range(1, 162)],
        }
        operation = 'agent.missions.plan.prepare'
        live = {
            'registry': {'rows': 1, 'operations': [{
                'operation': operation, 'verified': False,
            }], 'verified_operations': []},
            'deployed_gateway_operation_ids': [],
            'captured_at_utc': '2026-10-21T00:00:00Z',
            'local_head': 'synthetic-later-worker-commit',
        }
        result = reconcile(prior, {'groups': [], 'contracts': []}, live, [])
        self.assertEqual(result['typed_source_contract_count'], 0)
        self.assertEqual(result['installed_gateway_operation_mappings'], 0)
        self.assertEqual(result['unmapped_registered_operation_ids'], [])
        touched = [row['requirement_id'] for row in result['requirements']
                   if row['registered_operation_ids']]
        self.assertEqual(touched, [154, 155, 160])
        self.assertEqual(result['completed_requirements'], 0)


if __name__ == '__main__':
    unittest.main()
