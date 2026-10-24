"""Configuration-only recovery tests; all inputs synthetic, no credentials/network."""
import unittest
import tempfile,os
from pathlib import Path
import release_durable_dispatch_schedule as release
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
  with patch('release_durable_dispatch_schedule.verify',side_effect=[{'timer_active':False,'transport_bound':True,'transport_guard_verified':True},{'timer_active':True}]),patch('release_durable_dispatch_schedule.inspect_worker'),patch('release_durable_dispatch_schedule.private_rpc') as binding:
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

class ModernTransportReleaseTests(unittest.TestCase):
 def test_modern_install_records_only_additive03400_and_preserves_rollback(self):
  calls=[]
  with tempfile.TemporaryDirectory() as temporary:
   class Fixture:
    stage='';out=Path(temporary)/'source-preservation'
    def sql(self,query,read_only=False):
     calls.append(query)
     if query.startswith('SELECT pg_get_functiondef'):return [{'definition':'CREATE FUNCTION fixture_a() RETURNS void LANGUAGE sql AS $$SELECT$$'}, {'definition':'CREATE FUNCTION fixture_b() RETURNS void LANGUAGE sql AS $$SELECT$$'}]
     return []
   sql=(release.ROOT/release.MODERN_MIGRATION).read_bytes()
   state={'timer_active':False,'transport_bound':False,'transport_guard_verified':True}
   with patch.dict(os.environ,{'GITHUB_ACTIONS':'true','GITHUB_REF':'refs/heads/main','GITHUB_SHA':'a'*40}),patch.object(release.subprocess,'check_output',return_value=sql),patch.object(release,'verify',return_value=state):
    result=release.install_transport_guard(Fixture(),modern=True)
   self.assertEqual(result['migration'],'20261024003400');self.assertEqual(result['Edge_deployments'],0)
   self.assertTrue((Fixture.out/'rollback-modern-transport.sql').exists())
   mutations=[q for q in calls if q.startswith('BEGIN;')]
   self.assertEqual(len(mutations),1)
   self.assertIn("VALUES('20261024003400',ARRAY[",mutations[0])
   self.assertNotIn("VALUES('20261024003100',ARRAY[",mutations[0])
   self.assertNotIn('SET enabled=true',mutations[0]);self.assertNotIn('vault.create_secret(',mutations[0].split('CREATE OR REPLACE FUNCTION')[0])
 def test_modern_guard_already_installed_is_not_replayed(self):
  class Fixture:
   def sql(self,*args):return [{'version':release.MODERN_VERSION}]
  with patch.dict(os.environ,{'GITHUB_ACTIONS':'true','GITHUB_REF':'refs/heads/main','GITHUB_SHA':'a'*40}),patch.object(release.subprocess,'check_output',return_value=(release.ROOT/release.MODERN_MIGRATION).read_bytes()):
   with self.assertRaisesRegex(Blocked,'already_installed_reconcile_no_replay'):release.install_transport_guard(Fixture(),modern=True)
