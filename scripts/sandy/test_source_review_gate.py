import unittest
from source_review_gate import assess

def fixtures():
    manifest={"function_slug":"sandy-agenda","project_ref":"zmqlyygzqoidkcwdysok","source_contents_included":False}
    comp={"function_slug":"sandy-agenda","project_ref":"zmqlyygzqoidkcwdysok","files":[{"path":"index.ts","status":"hash_mismatch"}]}
    screen={"function_slug":"sandy-agenda","source_contents_included":False,"publication_authorized":False,"risk_screen":"preliminary_scan_only"}
    packet={"function_slug":"sandy-agenda","project_ref":"zmqlyygzqoidkcwdysok","production_parity_certified":False}
    return manifest,comp,screen,packet

class TestGate(unittest.TestCase):
    def test_mismatch_stays_blocked(self):
        report=assess(*fixtures())
        self.assertEqual(report["review_status"],"source_diff_review_required")
        self.assertFalse(report["publication_authorized"])
        self.assertFalse(report["production_parity_certified"])
    def test_clean_snapshot_still_needs_review(self):
        f=list(fixtures())
        f[1]["files"][0]["status"]="hash_match"
        self.assertFalse(assess(*f)["publication_authorized"])
    def test_sensitive_pattern_requires_review(self):
        f=list(fixtures())
        f[2]["risk_screen"]="review_required_sensitive_pattern"
        self.assertEqual(assess(*f)["review_status"],"security_review_required")
    def test_identity_mismatch_fails_closed(self):
        f=list(fixtures())
        f[3]["function_slug"]="sandy-other"
        with self.assertRaises(ValueError):
            assess(*f)
