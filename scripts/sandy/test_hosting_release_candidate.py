import json
import subprocess
import unittest
from check_hosting_release_candidate import MANIFEST, ROOT, SOURCE, verify
class CandidateTests(unittest.TestCase):
    def read(self, p):
        return subprocess.check_output(['git', 'show', SOURCE + ':' + p], cwd=ROOT)
    def test_reviewed_source_preserves_live_modules_and_auth(self):
        result=verify(MANIFEST.read_bytes(),self.read)
        self.assertTrue(result['offline_integrity_passed'])
        self.assertFalse(result['owner_authorization_verified'])
        self.assertFalse(result['deployed'])
    def test_manifest_edits_never_authorize_new_targets(self):
        m=json.loads(MANIFEST.read_bytes());m['function']['verify_jwt']=False
        with self.assertRaisesRegex(ValueError,'reviewed_manifest_changed'):
            verify(json.dumps(m).encode(),self.read)
    def test_changed_source_requires_new_review(self):
        with self.assertRaisesRegex(ValueError,'source_digest_mismatch'):
            verify(MANIFEST.read_bytes(),lambda p:b'changed source')
if __name__=='__main__':unittest.main()
