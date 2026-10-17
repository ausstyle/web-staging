import tempfile
import unittest
from pathlib import Path
from source_publication_gate import review

class SourcePublicationGateTests(unittest.TestCase):
    def test_sensitive_token_never_emitted(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)/"sandy-test"
            root.mkdir()
            (root/"index.ts").write_text('const password = "very-secret-credential";')
            result = review(root, {"function_slug":"sandy-test","project_ref":"zmqlyygzqoidkcwdysok"})
            self.assertEqual(result["risk_screen"],"review_required_sensitive_pattern")
            self.assertFalse(result["publication_authorized"])
            self.assertNotIn("very-secret-credential",str(result))
    def test_clean_is_not_automatically_authorized(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)/"sandy-test"
            root.mkdir()
            (root/"index.ts").write_text("export const add = (a,b) => a+b;")
            result = review(root, {"function_slug":"sandy-test","project_ref":"zmqlyygzqoidkcwdysok"})
            self.assertEqual(result["risk_screen"],"preliminary_scan_only")
            self.assertFalse(result["publication_authorized"])
    def test_wrong_project_rejected(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)/"sandy-test"
            root.mkdir()
            with self.assertRaises(ValueError):
                review(root, {"function_slug":"sandy-test","project_ref":"other"})
