import copy,json,unittest
from pathlib import Path
from check_hosting_api_activation import load,patch,activation_sql,Blocked,PATHS,sha
class ActivationTests(unittest.TestCase):
 def setUp(self):
  self.before={'sandy-operation-api/index.ts':b'identity gates unchanged','sandy-customer-provisioning-api/gateway.ts':b'old routing','regional.ts':b'expiring west8'}
  self.new={p:p.encode() for p in PATHS};after={**self.before,**self.new}
  self.m={'gateway':{'files':{p:sha(b) for p,b in self.before.items()}},'handler':{'files':{p:sha(b) for p,b in self.new.items()}},'replacement_files':list(PATHS),'after_files':{p:sha(b) for p,b in after.items()}}
 def test_preserves_entrypoint_and_regional_modules(self):
  result=patch(self.m,self.before,self.new.__getitem__)
  for p in set(self.before)-PATHS:self.assertEqual(result[p],self.before[p])
 def test_concurrent_gateway_change_blocks(self):
  with self.assertRaisesRegex(Blocked,'gateway_modules_drift'):patch(self.m,{**self.before,'regional.ts':b'concurrent'},self.new.__getitem__)
 def test_wrong_handler_contract_blocks(self):
  with self.assertRaisesRegex(Blocked,'handler_contract_source_changed'):patch(self.m,self.before,lambda p:b'wrong')
 def test_extra_replacement_blocks(self):
  self.m['replacement_files'].append('regional.ts')
  with self.assertRaisesRegex(Blocked,'replacement_scope_changed'):patch(self.m,self.before,self.new.__getitem__)
 def test_exact_manifest_and_api_only_activation(self):
  m=load();sql=activation_sql(m)
  self.assertEqual(sql.count('SET api_exposed=true'),2)
  self.assertNotIn('SET ai_exposed',sql);self.assertNotIn('SET verified',sql)
  self.assertIn('FOR UPDATE',sql);self.assertIn('IS DISTINCT FROM',sql)
 def test_existing_exposure_is_not_overwritten(self):
  m=load();m['registry'][0]['ai_exposed']=True
  with self.assertRaisesRegex(Blocked,'inactive_registry_required'):activation_sql(m)
if __name__=='__main__':unittest.main()

class ReleaseTests(unittest.TestCase):
 def test_owner_gate_is_read_only_and_exact(self):
  from release_hosting_api_activation import owner,PIN
  class Fake:
   def sql(self,q,read_only=False):
    assert read_only and PIN in q and 'API-only hosting activation' in q
    return [{'admitted':False}]
  with self.assertRaisesRegex(Blocked,'exact_authenticated_Owner'):owner(Fake(),'00000000-0000-4000-8000-000000000001')
 def test_unprotected_deploy_never_reads_or_writes_database(self):
  from unittest.mock import patch as mockpatch
  from release_hosting_api_activation import run
  class Fake:
   def sql(self,*a,**k):raise AssertionError('database touched')
  with mockpatch.dict('os.environ',{},clear=True):
   with self.assertRaisesRegex(Blocked,'protected_main_required'):run(Fake(),'deploy','00000000-0000-4000-8000-000000000001')
 def test_partial_upload_does_not_activate_or_auto_retry(self):
  from unittest.mock import patch as mockpatch
  import release_hosting_api_activation as rel
  class Fake:
   holder='test';out=Path('/tmp')
   def __init__(self):self.events=[]
   def api(self,*a,**k):return b'before'
   def sql(self,q,read_only=False):
    self.events.append(q)
    if 'count(*)' in q:return [{'n':2 if 'leases' in q else 0}]
    return []
  r=Fake();m=load();m['gateway']['bundle_sha256']=sha(b'before')
  with mockpatch.object(rel,'load',return_value=m),mockpatch.object(rel,'protected'),mockpatch.object(rel,'owner'),mockpatch.object(rel,'inspect',return_value={}),mockpatch('release_hosting_accounts.store_recovery',return_value='00000000-0000-4000-8000-000000000002'),mockpatch.object(rel,'upload',side_effect=RuntimeError('uncertain')) as upload:
   with self.assertRaisesRegex(RuntimeError,'uncertain'):rel.run(r,'deploy','00000000-0000-4000-8000-000000000001')
   self.assertEqual(upload.call_count,1)
  self.assertFalse(any('SET api_exposed' in q for q in r.events))
  self.assertFalse(any('DELETE FROM' in q for q in r.events))

class InputTests(unittest.TestCase):
 def test_pasted_owner_and_artifact_uuid_whitespace(self):
  from release_hosting_api_activation import input_uuid
  value='2ed107d8-07b3-4458-a4f7-e03739214b6c'
  self.assertEqual(input_uuid('    '+value+'\n','owner_change_id'),value)
  self.assertEqual(input_uuid(' '+value+' ','artifact'),value)
 def test_bad_uuid_reports_input_error_before_effects(self):
  from release_hosting_api_activation import input_uuid
  for value in [None,'','bad','2ed107d8-07b3- 4458-a4f7-e03739214b6c']:
   with self.assertRaisesRegex(Blocked,'invalid_owner_change_id_uuid'):input_uuid(value,'owner_change_id')

class AutomaticTests(unittest.TestCase):
 def test_prior_intent_never_replays_partial_or_finished_release(self):
  from release_hosting_api_activation import run
  class Fake:
   def sql(self,q,read_only=False):
    assert read_only and 'hosting_api_intent' in q
    return [{'n':1}]
  result=run(Fake(),'auto','2ed107d8-07b3-4458-a4f7-e03739214b6c')
  self.assertTrue(result['automatic_dispatch_skipped']);self.assertEqual(result['mutations'],0)
 def test_automatic_owner_cannot_be_substituted(self):
  from release_hosting_api_activation import run
  with self.assertRaisesRegex(Blocked,'fixed_auto_owner_required'):run(None,'auto','other')
 def test_trigger_preserves_successful_exact_revision_and_environment(self):
  from release_web_canary import ROOT
  s=(ROOT/'.github/workflows/sandy-hosting-api-activation.yml').read_text()
  for marker in ['workflow_run:','Sandy engineering regression checks',"conclusion == 'success'",'head_repository.full_name','head_sha || github.sha','environment: sandy-production','cancel-in-progress: false','2ed107d8-07b3-4458-a4f7-e03739214b6c']:self.assertIn(marker,s)
