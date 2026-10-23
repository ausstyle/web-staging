import json
import unittest
from unittest.mock import Mock
from email_shadow_acceptance import EmailShadowAcceptance, fingerprint


class EmailShadowAcceptanceTests(unittest.TestCase):
    def test_trigger_fingerprint_is_order_independent_and_source_sensitive(self):
        rows = [{'name': 'b', 'source': 'second'}, {'name': 'a', 'source': 'first'}]
        self.assertEqual(fingerprint(rows, ['name', 'source']), fingerprint(rows[::-1], ['name', 'source']))
        self.assertNotEqual(fingerprint(rows, ['name', 'source']), fingerprint([{'name': 'a', 'source': 'changed'}, rows[0]], ['name', 'source']))

    def test_staging_handoff_contains_no_token_and_never_queues_or_claims_provider_execution(self):
        runner = EmailShadowAcceptance.__new__(EmailShadowAcceptance)
        runner.r = Mock(); runner.r._quote.side_effect = lambda v: "'" + v + "'"
        runner.r._sql.side_effect = [[{'provider_key': 'openai'}], [], [{'n': 0}]]
        runner.r._http.return_value = (204, None)
        runner.keys = {'anon': 'fixture-project-key'}
        runner.fixtures = [{'user': 'fixture-user', 'customer': 'fixture-customer', 'token': 'private-fixture-session'}]
        runner.source_id, runner.draft_id, runner.thread_id = 'source', 'draft', 'thread'
        runner.report = {'checks': []}; runner.save = Mock(); runner.review_triggers = Mock(); runner.prepare = Mock()
        self.assertTrue(runner.stage())
        self.assertNotIn('private-fixture-session', json.dumps(runner.report))
        self.assertNotIn('token', runner.report['staged_fixtures'][0])
        query = runner.r._sql.call_args_list[1].args[0]
        self.assertIn("'incoming'", query)
        self.assertIn("body_text) VALUES('source','fixture-customer','thread','sandy-runtime-fixture','incoming'", query)
        self.assertIn("body_text='Reply exactly EMAIL_SHADOW_ACCEPTANCE.", query)
        self.assertIn('synthetic_fixture_background_work_unexpected', query)
        self.assertNotIn('DISABLE TRIGGER', query)
        self.assertIn("'sandy-synthetic-baseline','generated',NULL", query)
        self.assertEqual(runner.r._http.call_count, 1)
        self.assertTrue(runner.r._http.call_args.args[1].endswith('/auth/v1/logout?scope=local'))


if __name__ == '__main__':
    unittest.main()
