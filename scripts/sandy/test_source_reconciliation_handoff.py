"""Offline security contracts for metadata-only reconciliation handoff."""
import unittest
from source_reconciliation_handoff import render

class HandoffTests(unittest.TestCase):
    def test_mismatch_report_is_metadata_only(self):
        comparison = {"schema_version":1, "project_ref":"zmqlyygzqoidkcwdysok",
                      "function_slug":"sandy-agenda", "production_parity_certified":False,
                      "comparison":"requires_source_reconciliation",
                      "files":[{"path":"index.ts", "status":"hash_mismatch"}]}
        marker, body = render(comparison, "1", "39040558347")
        self.assertIn("hash_mismatch: 1", body)
        self.assertIn("NOT certified production parity", body)
        self.assertIn("sandy-reconciliation-evidence:1:sandy-agenda:39040558347", marker)
        self.assertNotIn("source contents", body.lower())

    def test_cannot_certify_parity(self):
        comparison = {"schema_version":1, "project_ref":"zmqlyygzqoidkcwdysok",
                      "function_slug":"sandy-agenda", "production_parity_certified":True, "files":[]}
        with self.assertRaises(ValueError):
            render(comparison, "1", "39040558347")

    def test_invalid_run_identity_rejected(self):
        comparison = {"schema_version":1, "project_ref":"zmqlyygzqoidkcwdysok",
                      "function_slug":"sandy-agenda", "production_parity_certified":False, "files":[]}
        with self.assertRaises(ValueError):
            render(comparison, "1;echo unsafe", "39040558347")

if __name__ == "__main__":
    unittest.main()
