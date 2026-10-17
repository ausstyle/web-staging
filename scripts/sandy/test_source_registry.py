"""Offline source-registry contract tests; no external API or credentials."""
import unittest
from source_registry import assess

class RegistryTests(unittest.TestCase):
    def test_present_does_not_imply_production_parity(self):
        entries=[{"type":"edge_function","name":"sandy-test","path":"supabase/functions/sandy-test/index.ts","verified_production_parity":False}]
        result=assess([{"type":"edge_function","name":"sandy-test"}],entries)
        self.assertEqual(result[0]["status"],"repository_present_unverified")

    def test_absence_requests_retrieval_not_approval(self):
        result=assess([{"type":"database_routine","name":"sandy_untracked"}],[])
        self.assertEqual(result[0]["status"],"requires_authorized_retrieval")

    def test_invalid_dependency_ignored(self):
        self.assertEqual(assess([{"type":"edge_function","name":"../bad name"}],[]),[])

if __name__=="__main__":
    unittest.main()
