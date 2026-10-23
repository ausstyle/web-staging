import unittest
from unittest.mock import Mock
from runtime_web_memory_acceptance import RuntimeMemoryAcceptance


class RuntimeWebMemoryAcceptanceTests(unittest.TestCase):
    def bare(self):
        runner = RuntimeMemoryAcceptance.__new__(RuntimeMemoryAcceptance)
        runner.r = Mock()
        runner.r._quote.side_effect = lambda value: "'" + value + "'"
        runner.keys = {'anon': 'fixture-project-key'}
        runner.report = {'checks': [], 'cleanup': {}}
        runner.fixtures = [{'user': 'fixture-user', 'customer': 'fixture-customer', 'token': 'fixture-user-token'}]
        runner.save = Mock()
        return runner

    def test_workspace_never_substitutes_management_or_service_bearer(self):
        runner = self.bare()
        runner.workspace(runner.fixtures[0], 'ask', {'question': 'Fixture'})
        args = runner.r._http.call_args.args
        self.assertEqual(args[2], 'fixture-user-token')
        self.assertEqual(args[4], 'fixture-project-key')
        self.assertTrue(args[1].endswith('/functions/v1/sandy-workspace?action=ask'))

    def test_cleanup_refuses_unproved_customer_ownership(self):
        runner = self.bare()
        runner.r._http.return_value = (204, None)
        runner.r._sql.return_value = [{'display_name': 'Existing customer', 'google_drive_folder_status': 'excluded'}]
        with self.assertRaisesRegex(RuntimeError, 'fixture_cleanup_ownership_not_proved'):
            runner.cleanup()
        runner.r._auth_admin.assert_not_called()
        self.assertEqual(runner.r._sql.call_count, 1)

    def test_cleanup_preserves_immutable_receipts_and_retires_auth(self):
        runner = self.bare()
        runner.r._quote.side_effect = lambda value: "'" + value + "'"
        runner.r._http.return_value = (204, None)
        runner.r._sql.side_effect = [
            [{'display_name': 'Isolated Sandy API service acceptance', 'google_drive_folder_status': 'excluded'}],
            [], [{'users': 0, 'sessions': 0, 'portal_accounts': 0}],
        ]
        runner.cleanup()
        query = runner.r._sql.call_args_list[1].args[0]
        self.assertNotIn('DELETE FROM public.sandy_agent_operation_audit', query)
        self.assertNotIn('DELETE FROM public.sandy_runtime_conversation_audit', query)
        self.assertNotIn('DELETE FROM public.email_customers', query)
        self.assertIn('enabled=false,learning_enabled=false,proactive_enabled=false', query)
        runner.r._auth_admin.assert_called_once_with('DELETE', 'users/fixture-user')
        self.assertTrue(runner.report['cleanup']['complete'])
        self.assertTrue(runner.report['cleanup']['immutable_audits_preserved'])


if __name__ == '__main__':
    unittest.main()
