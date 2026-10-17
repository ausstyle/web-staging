import unittest
from reassess_after_exact_source import act

class ReassessmentTests(unittest.TestCase):
    def fixture(self, status="hash_match"):
        m={"schema_version":1,"project_ref":"zmqlyygzqoidkcwdysok","function_slug":"sandy-agenda",
           "production_parity_certified":False,"files":[{"path":"index.ts","bytes":1,"sha256":"a"*64}]}
        c={"schema_version":1,"project_ref":"zmqlyygzqoidkcwdysok","function_slug":"sandy-agenda",
           "production_parity_certified":False,"comparison":"exact_snapshot_match" if status=="hash_match" else "requires_source_reconciliation",
           "files":[{"path":"index.ts","status":status}]}
        return m,c

    def test_hash_mismatch_does_not_dispatch(self):
        m,c=self.fixture("hash_mismatch")
        calls=[]
        self.assertIn("no automatic",act(m,c,"1","ausstyle/web-staging","",calls.append))
        self.assertFalse(calls)

    def test_new_exact_hash_dispatches_once(self):
        m,c=self.fixture()
        calls=[]
        self.assertIn("Requested Architect",act(m,c,"1","ausstyle/web-staging","",calls.append))
        self.assertEqual(len(calls),2)
        self.assertEqual(calls[0][1:3],["workflow","run"])
        prior=calls[1][-1]
        other=[]
        self.assertIn("already submitted",act(m,c,"1","ausstyle/web-staging",prior,other.append))
        self.assertFalse(other)

    def test_untrusted_project_rejected(self):
        m,c=self.fixture()
        m["project_ref"]="wrong"
        with self.assertRaises(ValueError):
            act(m,c,"1","ausstyle/web-staging","",lambda x: None)
