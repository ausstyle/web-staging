"""Offline source-free diff summary security tests."""
import tempfile
import unittest
from pathlib import Path
from source_diff_summary import summarize

class DiffSummaryTests(unittest.TestCase):
    def test_line_counts_without_source(self):
        with tempfile.TemporaryDirectory() as tmp:
            prod,repo=Path(tmp)/"production/sandy-test",Path(tmp)/"repository/sandy-test"
            prod.mkdir(parents=True)
            repo.mkdir(parents=True)
            (prod/"index.ts").write_text("export const confidential = 'production-only';\n")
            (repo/"index.ts").write_text("export const confidential = 'outdated';\n")
            m={"function_slug":"sandy-test","project_ref":"zmqlyygzqoidkcwdysok",
               "production_parity_certified":False,"files":[{"path":"index.ts","status":"hash_mismatch"}]}
            screen={"function_slug":"sandy-test","publication_authorized":False}
            data=summarize(prod,repo,m,screen)
            self.assertEqual(data["files"][0]["added_lines"],1)
            self.assertEqual(data["files"][0]["removed_lines"],1)
            self.assertNotIn("production-only",str(data))
            self.assertFalse(data["publication_authorized"])

    def test_rejects_publication_authorized(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp)/"sandy-test"
            root.mkdir()
            with self.assertRaises(ValueError):
                summarize(root,root,{"function_slug":"sandy-test","project_ref":"zmqlyygzqoidkcwdysok","production_parity_certified":False,"files":[]},{"function_slug":"sandy-test","publication_authorized":True})
