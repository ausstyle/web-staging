import unittest
from run_feature_discovery import verify_response


class FeatureDiscoveryRunnerTests(unittest.TestCase):
    def test_success_is_only_a_proposal(self):
        self.assertEqual(verify_response({"ok": True, "created": 1, "assessed": 25}),
                         {"assessed": 25, "created": 1, "proposed_not_deployed": True})

    def test_missing_success_rejected(self):
        with self.assertRaises(RuntimeError):
            verify_response({"status": "queued"})
        with self.assertRaises(RuntimeError):
            verify_response({"ok": False, "created": 0})

    def test_impossible_count_rejected(self):
        with self.assertRaises(RuntimeError):
            verify_response({"ok": True, "created": 99})


if __name__=="__main__":
    unittest.main()
