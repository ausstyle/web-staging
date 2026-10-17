import unittest
from dispatch_autonomous_engineering import validate_claim

class DispatchTests(unittest.TestCase):
    def test_idle(self):
        self.assertIsNone(validate_claim({"claimed":False}))

    def test_claim(self):
        payload={"claimed":True,"issue_number":1,
                 "issue_key":"contradiction:no_task_delegation",
                 "lease":"12345678-1234-1234-1234-123456789abc"}
        self.assertEqual(validate_claim(payload)[0],1)

    def test_reject_invalid_claims(self):
        for payload in [
            {},
            {"claimed":True,"issue_number":"1"},
            {"claimed":True,"issue_number":0},
        ]:
            with self.subTest(payload=payload):
                with self.assertRaises(ValueError):
                    validate_claim(payload)
