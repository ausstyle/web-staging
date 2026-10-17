"""Deterministic hash reconciliation checks; no Supabase access."""
import hashlib
import tempfile
import unittest
from pathlib import Path
from reconcile_source_audit import reconcile

class ReconciliationTests(unittest.TestCase):
    def manifest(self, payload=b"x"):
        return {"schema_version": 1, "project_ref": "zmqlyygzqoidkcwdysok",
                "function_slug": "sandy-test", "production_parity_certified": False,
                "source_contents_included": False,
                "files": [{"path":"index.ts", "bytes":len(payload),
                           "sha256": hashlib.sha256(payload).hexdigest()}]}

    def test_exact_hash_match_does_not_certify_parity(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)/"supabase/functions/sandy-test"
            root.mkdir(parents=True)
            (root/"index.ts").write_bytes(b"x")
            output = reconcile(self.manifest(), Path(tmp))
            self.assertEqual(output["comparison"], "exact_snapshot_match")
            self.assertFalse(output["production_parity_certified"])

    def test_mismatch_and_missing_are_not_certified(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)/"supabase/functions/sandy-test"
            root.mkdir(parents=True)
            (root/"index.ts").write_bytes(b"y")
            self.assertEqual(reconcile(self.manifest(), Path(tmp))["comparison"],
                             "requires_source_reconciliation")
            (root/"index.ts").unlink()
            self.assertEqual(reconcile(self.manifest(), Path(tmp))["files"][0]["status"],
                             "missing_in_repository")

    def test_path_escape_and_false_certification_rejected(self):
        with tempfile.TemporaryDirectory() as tmp:
            m = self.manifest()
            m["files"][0]["path"] = "../secrets"
            with self.assertRaises(ValueError):
                reconcile(m, Path(tmp))
            m = self.manifest()
            m["production_parity_certified"] = True
            with self.assertRaises(ValueError):
                reconcile(m, Path(tmp))

if __name__ == "__main__":
    unittest.main()
