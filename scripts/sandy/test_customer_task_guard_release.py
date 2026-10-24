import unittest
from unittest.mock import Mock,patch
import release_customer_task_guard as repair
import release_customer_mutation_certification as original
from release_web_canary import Blocked

class RepairReleaseTests(unittest.TestCase):
 def test_preflight_has_no_effects(self):
  r=Mock();m,_=repair.load()
  with patch.object(original,'functions'),patch.object(original,'schema'),patch.object(repair,'state',return_value=m['before_rpc_sha256']):
   self.assertEqual(repair.run(r),{'preflight_passed':True,'deployed':False,'Edge_deployments':0})
  r.sql.assert_not_called();r.upload.assert_not_called()
 def test_installed_repair_is_not_replayed(self):
  r=Mock();m,_=repair.load()
  with patch.object(original,'functions'),patch.object(original,'schema'),patch.object(repair,'state',return_value=m['after_rpc_sha256']):
   with self.assertRaisesRegex(Blocked,'already_installed'):repair.run(r,True)
  r.sql.assert_not_called();r.upload.assert_not_called()
 def test_drift_stops_before_any_mutation(self):
  r=Mock()
  with patch.object(original,'functions',side_effect=Blocked('source_drift')):
   with self.assertRaises(Blocked):repair.run(r,True)
  r.sql.assert_not_called();r.upload.assert_not_called()
 def test_finite_acceptance_requires_repair_history(self):
  r=Mock();r.sql.return_value=[]
  with self.assertRaisesRegex(Blocked,'repair_required'):repair.state(r,True)
 def test_mismatched_history_never_counts_as_installed(self):
  r=Mock();r.sql.return_value=[{'statements':['different SQL']}]
  with self.assertRaisesRegex(Blocked,'history_drift'):repair.state(r,True)

if __name__=='__main__':unittest.main()
