import unittest
from unittest import mock
import release_iap_transport as release
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

class PreserveInstalledMemory(unittest.TestCase):
 def fixture(self):
  manifest={'shared_rpc_after_private_readiness_prosrc_sha256':'reviewed04300','functions':{'sandy-api-mcp':{'before_version':23,'candidate_files':{'mcp.ts':release.digest(b'memory'),'protocol.ts':release.digest(b'protocol')}}}}
  r=mock.Mock();r.api.side_effect=[b'{"status":"ACTIVE","verify_jwt":true,"version":23}',b'preserved bundle'];r.sql.return_value=[{'unretired':0}]
  pin=release.digest(b'reviewed memory manifest')
  return r,manifest,{'preserved_memory_release_manifest_sha256':pin,'preserved_cancellation_release_manifest_sha256':pin}
 def guards(self,m,source=b'memory'):
  from contextlib import ExitStack
  stack=ExitStack()
  stack.enter_context(mock.patch.object(release.memory_release.MANIFEST.__class__,'read_bytes',return_value=b'reviewed memory manifest'))
  stack.enter_context(mock.patch.object(release.memory_release,'load',return_value=(m,{})))
  stack.enter_context(mock.patch.object(release.cancel_release,'load',return_value=(m,{})))
  stack.enter_context(mock.patch.object(release,'original_sources',return_value={'mcp.ts':source,'protocol.ts':b'protocol'}))
  return stack
 def test_read_only_memory_and_current_shared_RPC_controls_and_complete_MCP_are_required(self):
  r,m,iap=self.fixture()
  with self.guards(m),mock.patch.object(release.memory_release,'schema_components') as memory,mock.patch.object(release.cancel_release,'schema') as cancellation:
   self.assertEqual(release.memory_prerequisite(r,iap),m)
   memory.assert_called_once_with(r,m,installed=True);cancellation.assert_called_once_with(r,m,installed=True)
  self.assertTrue(all(c.args[1] is True for c in r.sql.call_args_list));r.upload.assert_not_called()
 def test_changed_memory_source_or_unretired_fixture_prevents_release(self):
  for source,unretired,error in [(b'changed',0,'preserved_memory_MCP_source_or_ingress_changed'),(b'memory',1,'private_acceptance_requires_full_retirement')]:
   r,m,iap=self.fixture();r.sql.return_value=[{'unretired':unretired}]
   with self.guards(m,source),mock.patch.object(release.memory_release,'schema_components'),mock.patch.object(release.cancel_release,'schema'),self.assertRaisesRegex(Blocked,error):release.memory_prerequisite(r,iap)
   r.upload.assert_not_called()
 def test_actual_post_secret_metadata24_with_two_unchanged_modules_is_acceptance_only(self):
  r,m,iap=self.fixture();r.api.side_effect=[b'{"status":"ACTIVE","verify_jwt":true,"version":24}',b'unchanged2modulebody']
  with self.guards(m),mock.patch.object(release.memory_release,'schema_components'),mock.patch.object(release.cancel_release,'schema'):
   self.assertEqual(release.memory_prerequisite(r,iap,post_binding_readback=True),m)
  # The same real propagated version must still fail the original installer.
  r,m,iap=self.fixture();r.api.side_effect=[b'{"status":"ACTIVE","verify_jwt":true,"version":24}',b'unchanged2modulebody']
  with self.guards(m),mock.patch.object(release.memory_release,'schema_components'),mock.patch.object(release.cancel_release,'schema'),self.assertRaisesRegex(Blocked,'preserved_memory_MCP_source_or_ingress_changed'):release.memory_prerequisite(r,iap)
  r.upload.assert_not_called()
 def test_post_binding_acceptance_rejects_unreviewed_version_source_and_JWT_drift(self):
  import json
  for version,jwt,source in [(23,True,b'memory'),(25,True,b'memory'),(24,False,b'memory'),(24,True,b'changed')]:
   r,m,iap=self.fixture();r.api.side_effect=[json.dumps({'status':'ACTIVE','verify_jwt':jwt,'version':version}).encode(),b'body']
   with self.guards(m,source),mock.patch.object(release.memory_release,'schema_components'),mock.patch.object(release.cancel_release,'schema'),self.assertRaisesRegex(Blocked,'preserved_memory_MCP_source_or_ingress_changed'):release.memory_prerequisite(r,iap,post_binding_readback=True)
   r.upload.assert_not_called()
 def test_changed_shared_RPC_or_acceptance_proof_stops_before_source_or_upload(self):
  for target in ['schema_components','schema']:
   r,m,iap=self.fixture()
   with self.guards(m),mock.patch.object(release.memory_release,'schema_components',side_effect=Blocked('shared_RPC_source_or_security_drift') if target=='schema_components' else None),mock.patch.object(release.cancel_release,'schema',side_effect=Blocked('immutable_normal_memory_proof_required') if target=='schema' else None),self.assertRaises(Blocked):release.memory_prerequisite(r,iap)
   r.api.assert_not_called();r.upload.assert_not_called()
 def test_changed_reviewed_memory_manifest_stops_before_provider_or_database_read(self):
  r,m,iap=self.fixture()
  with mock.patch.object(release.memory_release.MANIFEST.__class__,'read_bytes',return_value=b'new unreviewed source'),self.assertRaisesRegex(Blocked,'reviewed_memory_release_manifest_changed'):release.memory_prerequisite(r,iap)
  r.api.assert_not_called();r.sql.assert_not_called();r.upload.assert_not_called()

if __name__=='__main__':unittest.main()
