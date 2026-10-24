import unittest
from release_computer_eligibility import patch,files,ROOT,BASELINE,SLUG,SOURCE,digest
from release_web_canary import Blocked
class ComputerReleaseTests(unittest.TestCase):
 def test_exact_preserved_source_and_generated_candidate(self):
  original=(ROOT/BASELINE).read_bytes();self.assertEqual(digest(original),SOURCE)
  candidate=patch(original)
  # Preserve the already-installed v59 candidate independently of later releases.
  self.assertEqual(digest(candidate),'23f538b1347955091e121d08bed6385b5d8a123a5fdbfa9582ba2f342f29537d')
  self.assertEqual(candidate.count(b'await computerFetch('),6)
  self.assertEqual(candidate.count(b'await fetch('),2) # existing Windows tick + admitted fetch delegate
  self.assertEqual(set(files()),{SLUG+'/index.ts',SLUG+'/eligibility.ts','_shared/sandy-agent-operations/worker_computer_identity.ts'})
 def test_drift_and_repeated_patching_are_refused(self):
  for value in [b'changed',patch((ROOT/BASELINE).read_bytes())]:
   with self.assertRaises(Blocked):patch(value)
if __name__=='__main__':unittest.main()
