import json
from pathlib import Path
from types import SimpleNamespace
import tempfile
import unittest
from unittest.mock import Mock, patch
from verify_engineering_workload import Verification, POLICY, ROOT


class WorkloadVerificationTests(unittest.TestCase):
    def fixture(self, output, extra=()):
        check = Verification.__new__(Verification)
        check.output = output
        check.components = {'migration'}
        check.state = {'steps': {}}
        names = POLICY['operations'] + list(extra)
        check.runtime = SimpleNamespace(
            invoke=Mock(return_value=(200, {'result': {'tools': [{'name': name, 'inputSchema': {'type': 'object'}} for name in names]}})),
            _sql=Mock(side_effect=[[{'restored': True}], [{'marker': 'sandy_mcp_fixture_end_to_end_20261021'}], [{'restored': True}]]),
            public_status=Mock(return_value={'controller_memberships': 0}))
        check.call = Mock(return_value={})
        check.github = Mock(side_effect=AssertionError('GitHub component was not selected'))
        check.deploy_args = Mock(side_effect=AssertionError('Function deployment was not selected'))
        return check

    def test_selected_database_regression_never_redeploys_functions_or_changes_secrets(self):
        with tempfile.TemporaryDirectory() as tmp:
            optional = json.loads((ROOT / 'supabase/functions/sandy-operation-api/engineering_vm_read_policy.json').read_text())['operations']
            check = self.fixture(Path(tmp) / 'proof.json', optional)
            check.run()
            self.assertEqual([call.args[0] for call in check.call.call_args_list], ['migration_up', 'migration_down'])
            self.assertTrue(check.state['migration_restored'])
            self.assertTrue(check.state['complete'])
            self.assertFalse(check.state['VM_diagnostics_performed'])
            check.github.assert_not_called()
            check.deploy_args.assert_not_called()

    def test_unexpected_workload_tool_fails_before_any_fixture_mutation(self):
        with tempfile.TemporaryDirectory() as tmp:
            check = self.fixture(Path(tmp) / 'proof.json', ['supabase.projects.delete'])
            with self.assertRaises(AssertionError):
                check.run()
            check.call.assert_not_called()

    def test_independent_GitHub_read_uses_configured_CLI_auth_without_exposing_error_output(self):
        check = Verification.__new__(Verification)
        with patch('verify_engineering_workload.subprocess.run', return_value=SimpleNamespace(returncode=0, stdout='{"sha":"fixture"}')) as cli:
            self.assertEqual(check.github('git/ref/heads/fixture')['sha'], 'fixture')
            self.assertEqual(cli.call_args.args[0][:2], ['gh', 'api'])
        with patch('verify_engineering_workload.subprocess.run', return_value=SimpleNamespace(returncode=1, stdout='private upstream body')):
            with self.assertRaisesRegex(RuntimeError, '^github_independent_readback_failed$'):
                check.github('git/ref/heads/fixture')

class GitHubRecoveryTests(unittest.TestCase):
    def test_ambiguous_write_restores_only_the_owned_fixture_through_mcp_then_reads_back(self):
        import base64
        with tempfile.TemporaryDirectory() as tmp:
            check = Verification.__new__(Verification)
            check.output = Path(tmp) / 'proof.json'
            check.state = {'steps': {}, 'original_github': {'content': base64.b64encode(b'original').decode()}}
            check.require_github_receipts = True
            check.github = Mock(side_effect=[{'content': base64.b64encode(b'Sandy engineering fixture machine verified\n').decode(), 'sha': 'a'*40}, {'content': base64.b64encode(b'original').decode()}])
            check.call = Mock()
            check.recover_github_fixture()
            self.assertEqual(check.call.call_args.args[1], 'github.files.update')
            self.assertEqual(check.call.call_args.args[2]['body']['sha'], 'a'*40)
            self.assertTrue(check.state['failure_recovery_independently_verified'])
            self.assertTrue(check.require_github_receipts)

    def test_recovery_refuses_to_overwrite_a_foreign_concurrent_change(self):
        import base64
        check = Verification.__new__(Verification)
        check.state = {'original_github': {'content': base64.b64encode(b'original').decode()}}
        check.github = Mock(return_value={'content': base64.b64encode(b'foreign change').decode(), 'sha': 'a'*40})
        check.call = Mock()
        with self.assertRaisesRegex(RuntimeError, '^github_recovery_current_content_not_owned$'):
            check.recover_github_fixture()
        check.call.assert_not_called()


if __name__ == '__main__':
    unittest.main()
