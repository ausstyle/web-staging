import unittest
from unittest.mock import Mock
from mission_truth_acceptance import MissionTruthAcceptance


class MissionTruthAcceptanceTests(unittest.TestCase):
    def test_retirement_uses_normal_customer_cancellation_and_preserves_durable_receipts(self):
        runner = MissionTruthAcceptance.__new__(MissionTruthAcceptance)
        fixture = {'user': 'fixture-user', 'customer': 'fixture-customer', 'token': 'private-fixture-token', 'task': 'seed-task', 'event': 'seed-calendar-event'}
        runner.fixtures = [fixture]; runner.mission_id = 'actual-mission'; runner.nonce = 'nonce'
        runner.keys = {'anon': 'project-key'}; runner.report = {'cleanup': {}}; runner.save = Mock()
        runner.r = Mock(); runner.r._quote.side_effect = lambda value: "'" + value + "'"
        runner.r._http.return_value = (204, None)
        runner.r._sql.side_effect = [[{'display_name': 'Isolated Sandy API service acceptance', 'google_drive_folder_status': 'excluded'}], [], [], [{'users': 0, 'sessions': 0, 'portal_accounts': 0}]]
        runner.call = Mock(return_value=({'api_status': 200}, {}))
        runner.cleanup()
        self.assertEqual(runner.call.call_args.args[:2], (fixture, 'tasks.update'))
        self.assertEqual(runner.call.call_args.args[2]['id'], 'actual-mission')
        self.assertEqual(runner.call.call_args.args[2]['status'], 'cancelled')
        queries = [call.args[0] for call in runner.r._sql.call_args_list]
        self.assertFalse(any('DELETE FROM public.sandy_mission' in query for query in queries))
        self.assertFalse(any('DELETE FROM public.email_customers' in query for query in queries))
        self.assertTrue(any("state='queued'" in query and "error='isolated_fixture_retired'" in query for query in queries))
        self.assertFalse(any("state='running'" in query for query in queries))
        self.assertTrue(runner.report['cleanup']['immutable_mission_receipts_preserved'])
        self.assertTrue(runner.report['cleanup']['complete'])
        self.assertNotIn('private-fixture-token', str(runner.report))

    def test_cleanup_refuses_unknown_customer_before_task_or_queue_maintenance(self):
        runner = MissionTruthAcceptance.__new__(MissionTruthAcceptance)
        runner.fixtures = [{'user': 'fixture-user', 'customer': 'existing-customer'}]
        runner.mission_id = 'mission'; runner.report = {'cleanup': {}}; runner.save = Mock()
        runner.r = Mock(); runner.r._quote.side_effect = lambda value: "'" + value + "'"
        runner.r._sql.return_value = [{'display_name': 'Existing customer', 'google_drive_folder_status': 'excluded'}]
        with self.assertRaisesRegex(RuntimeError, 'mission_fixture_cleanup_ownership_not_proved'):
            runner.cleanup()
        self.assertEqual(runner.r._sql.call_count, 1)
        runner.r._auth_admin.assert_not_called()


if __name__ == '__main__':
    unittest.main()
