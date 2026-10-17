"""Offline metadata-only manifest tests."""
import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

SCRIPT = Path(__file__).with_name("source_audit_manifest.py")

class SourceManifestTests(unittest.TestCase):
    def test_metadata_only(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory) / "sandy-test"
            root.mkdir()
            (root / "index.ts").write_text("const example = 1;")
            r = subprocess.run([sys.executable, str(SCRIPT), str(root)], text=True, capture_output=True)
            self.assertEqual(r.returncode, 0, r.stderr)
            data = json.loads(r.stdout)
            self.assertEqual(data["function_slug"], "sandy-test")
            self.assertFalse(data["production_parity_certified"])
            self.assertFalse(data["source_contents_included"])
            self.assertEqual(len(data["files"]), 1)
            self.assertNotIn("const example", r.stdout)

    def test_wrong_slug_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory) / "sandy-test"
            root.mkdir()
            (root / "index.ts").write_text("x")
            env = dict(os.environ, SLUG="sandy-other")
            r = subprocess.run([sys.executable, str(SCRIPT), str(root)], env=env, capture_output=True)
            self.assertNotEqual(r.returncode, 0)

if __name__ == "__main__":
    unittest.main()
