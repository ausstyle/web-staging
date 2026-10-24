import unittest
from release_iap_transport import inspect,Blocked
class ReadOnlyGuard:
 def __init__(self,stage):self.stage=stage;self.calls=[]
 def sql(self,q,read_only=False):
  if not read_only:raise AssertionError('preflight attempted a database mutation')
  self.calls.append(q)
  if 'schema_migrations' in q:return [{'version':'20261024006000'}] if self.stage=='installed' else []
  if 'pg_proc' in q:return [{'proname':'sandy_iap_repair_claim'}] if self.stage=='partial' else []
  if 'SELECT operation,input_schema' in q:return []
  raise AssertionError('unexpected preflight query')
 def read(self,*_):raise AssertionError('must stop before function access')
class RefuseUnsafeReplay(unittest.TestCase):
 def test_existing_migration_or_partial_schema_never_reinstalls_or_redeploys(self):
  for stage,error in [('installed','already_installed_reconcile_read_only_no_replay'),('partial','existing_partial_custody_schema_requires_reconciliation')]:
   r=ReadOnlyGuard(stage)
   with self.assertRaisesRegex(Blocked,error):inspect(r,{'rpc_source_sha256':{'sandy_iap_repair_claim':'fixture'}},{})
   self.assertLessEqual(len(r.calls),2)
 def test_changed_existing_contract_stops_before_source_or_authority_changes(self):
  r=ReadOnlyGuard('contract-drift')
  with self.assertRaisesRegex(Blocked,'existing_engineering_contract_changed'):inspect(r,{'rpc_source_sha256':{'sandy_iap_repair_claim':'fixture'},'registry_before':[{'reviewed':True}]},{})
if __name__=='__main__':unittest.main()
