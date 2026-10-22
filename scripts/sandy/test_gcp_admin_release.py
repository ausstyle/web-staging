import hashlib,json,unittest
from gcp_admin_control_patch import patch,ANCHOR
from release_gcp_admin_read import migrations_sql,run
from release_web_canary import Blocked
class GuardTests(unittest.TestCase):
 def test_missing_existing_owner_audit_prevents_every_provider_dispatch(self):
  class Denied:
   def sql(self,q):return [{'admitted':False}]
   def api(self,*args):raise AssertionError('No API dispatch is permitted')
  with self.assertRaises(Blocked):run(Denied(),{},'pin',{},True)
 def test_patch_preserves_original_routes_and_rejects_stale_or_already_patched_base(self):
  source=b'const unchanged = "fixture";\n'+ANCHOR.encode()+b'\nreturn original_route();'
  result=patch(source)
  self.assertIn(b'return original_route();',result)
  self.assertTrue(result.endswith(source[source.index(ANCHOR.encode()):]));self.assertEqual(result.count(b'handleGcpAdminRead(db'),1)
  for bad in [result,source+ANCHOR.encode(),b'changed entrypoint']:
   with self.assertRaises(ValueError):patch(bad)
 def test_migration_history_and_sql_share_one_locked_transaction_and_original_sql(self):
  path='supabase/migrations/20261023001500_fixture.sql';sql=b'-- header\n-- second header\nBEGIN; SELECT 1; COMMIT;\n'
  result=migrations_sql({'migrations':[path]},{path:sql})
  self.assertIn('pg_advisory_xact_lock',result);self.assertIn('SELECT 1;',result);self.assertIn("'20261023001500'",result)
  self.assertTrue(result.endswith('COMMIT;'));self.assertIn(sql.decode().replace("'","''"),result)
  with self.assertRaises(Blocked):migrations_sql({'migrations':[path]},{path:b'SELECT 1;'})
if __name__=='__main__':unittest.main()
