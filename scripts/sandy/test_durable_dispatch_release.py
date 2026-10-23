"""Configuration-only recovery tests; all inputs synthetic, no credentials/network."""
import unittest
from unittest.mock import patch
from release_durable_dispatch_schedule import configure_existing,Blocked

class DurableDispatchRecoveryTests(unittest.TestCase):
 def test_configuration_recovery_preserves_installed_migration_and_existing_tracking(self):
  calls=[]
  class Fixture:
   stage=''
   def sql(self,query,read_only=False):
    calls.append(('sql',query))
    if query.startswith('SELECT id FROM'):return [{'id':'10000000-0000-4000-8000-000000000001'}]
    if query.startswith('SELECT EXISTS('):return [{'verified':True}]
    return []
   def api(self,*args):return b'[{"name":"service_role","api_key":"synthetic-private-transport"}]'
  with patch('release_durable_dispatch_schedule.verify',side_effect=[{'timer_active':False,'transport_bound':True},{'timer_active':True}]),patch('release_durable_dispatch_schedule.inspect_worker'),patch('release_durable_dispatch_schedule.private_rpc') as binding:
   result=configure_existing(Fixture(),'synthetic-migration','10000000-0000-4000-8000-000000000001','a'*40,bind_transport=False)
  binding.assert_not_called();self.assertTrue(result['configuration_only']);self.assertFalse(result['migrations_reapplied'])
  text=str(calls);self.assertNotIn('synthetic-private-transport',text);self.assertNotIn('CREATE ',text);self.assertNotIn('schema_migrations',text);self.assertNotIn('INSERT INTO public.sandy_engineering_changes(',text)
  self.assertTrue(any('durable_dispatch_private_transport_verified' in query for kind,query in calls))
 def test_active_timer_is_reconciled_not_replayed(self):
  with patch('release_durable_dispatch_schedule.verify',return_value={'timer_active':True}),patch('release_durable_dispatch_schedule.private_rpc') as binding:
   with self.assertRaisesRegex(Blocked,'timer_already_active_reconcile_no_replay'):configure_existing(object(),'sql','10000000-0000-4000-8000-000000000001','a'*40)
  binding.assert_not_called()
 def test_wrong_existing_change_is_denied_before_binding(self):
  class Fixture:
   def sql(self,*args):return []
  with patch('release_durable_dispatch_schedule.verify',return_value={'timer_active':False}),patch('release_durable_dispatch_schedule.private_rpc') as binding:
   with self.assertRaisesRegex(Blocked,'existing_exact_timer_tracking_record_required'):configure_existing(Fixture(),'sql','10000000-0000-4000-8000-000000000001','a'*40)
  binding.assert_not_called()
if __name__=='__main__':unittest.main()
