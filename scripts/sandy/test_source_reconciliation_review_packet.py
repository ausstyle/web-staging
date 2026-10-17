"""Review packets contain only allowlisted metadata, never downloaded source."""
import unittest
from source_reconciliation_review_packet import review_packet

class ReviewPacketTests(unittest.TestCase):
    def test_mismatch_requires_review(self):
        m={"schema_version":1,"project_ref":"zmqlyygzqoidkcwdysok","function_slug":"sandy-agenda",
           "production_parity_certified":False,"files":[{"path":"index.ts","status":"hash_mismatch"}]}
        x=review_packet(m,"1","39040558347")
        self.assertEqual(x["review_status"],"requires_human_source_review")
        self.assertFalse(x["source_contents_included"])
        self.assertFalse(x["production_parity_certified"])

    def test_unsafe_path_rejected(self):
        m={"schema_version":1,"project_ref":"zmqlyygzqoidkcwdysok","function_slug":"sandy-agenda",
           "production_parity_certified":False,"files":[{"path":"../private.ts","status":"hash_mismatch"}]}
        with self.assertRaises(ValueError):
            review_packet(m,"1","39040558347")

    def test_false_parity_rejected(self):
        m={"schema_version":1,"project_ref":"zmqlyygzqoidkcwdysok","function_slug":"sandy-agenda",
           "production_parity_certified":True,"files":[{"path":"index.ts","status":"hash_match"}]}
        with self.assertRaises(ValueError):
            review_packet(m,"1","39040558347")
