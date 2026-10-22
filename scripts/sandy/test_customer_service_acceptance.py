import unittest
from customer_service_acceptance import unpack, passing_read, fixture_contains


class CustomerServiceAcceptanceTests(unittest.TestCase):
    def test_transport_success_does_not_hide_API_denial(self):
        raw = {'result': {'isError': True, 'content': [{'text': '{"status":403,"result":{"error":"customer_access_required","executed":false}}'}]}}
        result, payload = unpack(200, raw)
        self.assertEqual(result['api_status'], 403)
        self.assertEqual(result['error'], 'customer_access_required')
        self.assertFalse(passing_read(result, payload))

    def test_accepted_unknown_or_empty_acknowledgment_never_proves_a_read(self):
        success = {'http_status': 200, 'api_status': 200, 'is_error': False, 'executed': True}
        self.assertTrue(passing_read(success, {'ok': True}))
        self.assertFalse(passing_read(success, {}))
        self.assertFalse(passing_read({**success, 'executed': None}, {'ok': True}))
        self.assertFalse(passing_read({**success, 'api_status': 202, 'executed': False}, {'ok': True}))

    def test_nonempty_fixture_read_also_requires_foreign_fixture_absence(self):
        self.assertTrue(fixture_contains({'items': [{'id': 'owned-id'}]}, 'owned-id', ['foreign-id']))
        self.assertFalse(fixture_contains({'items': []}, 'owned-id', ['foreign-id']))
        self.assertFalse(fixture_contains({'items': [{'id': 'owned-id'}, {'id': 'foreign-id'}]}, 'owned-id', ['foreign-id']))


if __name__ == '__main__':
    unittest.main()
