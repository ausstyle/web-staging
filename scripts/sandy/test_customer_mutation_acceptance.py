import io,json,tempfile,unittest,zipfile
from pathlib import Path
from unittest.mock import Mock
from verify_customer_mutation_private_mcp import CustomerMutationAcceptance,fixture_docx,storage_object_absent
class CustomerMutationAcceptanceTests(unittest.TestCase):
 def test_real_tiny_DOCX_contains_only_fixed_synthetic_content(self):
  raw=fixture_docx();self.assertLessEqual(len(raw),2048)
  with zipfile.ZipFile(io.BytesIO(raw)) as z:
   self.assertEqual(set(z.namelist()),{'[Content_Types].xml','_rels/.rels','word/document.xml'})
   self.assertIn(b'No customer data',z.read('word/document.xml'))
 def test_storage_cleanup_distinguishes_missing_object_from_auth_or_transport_failure(self):
  self.assertTrue(storage_object_absent(400,b'{"statusCode":"404","error":"not_found","message":"Object not found"}'))
  for status,body in [(403,b'{"statusCode":"403","error":"AccessDenied"}'),(400,b'{"statusCode":"400","error":"InvalidJWT"}'),(404,b'proxy route missing')]:self.assertFalse(storage_object_absent(status,body))
 def runner(self):
  r=CustomerMutationAcceptance.__new__(CustomerMutationAcceptance);r.nonce='1'*32;r.fixtures=[];r.report={};r.save=Mock();r.keys={'service_role':'private.provider.fixture','anon':'public.fixture'};r.r=Mock();return r
 def test_storage_administration_cannot_choose_an_unowned_path_or_external_target(self):
  r=self.runner();f={'customer':'10000000-0000-4000-8000-000000000001','blob_path':'another-customer/file.docx'};r.fixtures=[f]
  with self.assertRaisesRegex(RuntimeError,'exact_owned_storage_fixture_required'):r.storage(f,'read')
  r.r._opener.open.assert_not_called()
 def test_provider_fixture_secret_never_becomes_customer_auth_or_user_visible_evidence(self):
  r=self.runner();f={'customer':'10000000-0000-4000-8000-000000000001','token':'normal.customer.jwt'};f['blob_path']='customer_mutation_fixtures/'+f['customer']+'/'+r.nonce+'.docx';r.fixtures=[f]
  response=io.BytesIO(b'synthetic fixture');response.status=200;r.r._opener.open.return_value=response
  status,_=r.storage(f,'read');self.assertEqual(status,200)
  request=r.r._opener.open.call_args.args[0];self.assertEqual(request.get_header('Authorization'),'Bearer private.provider.fixture')
  self.assertTrue(request.full_url.startswith('https://zmqlyygzqoidkcwdysok.supabase.co/storage/v1/object/authenticated/sandy-task-artifacts/customer_mutation_fixtures/'))
  self.assertNotIn('private.provider.fixture',json.dumps(r.report));self.assertNotIn('normal.customer.jwt',json.dumps(r.report))
  with self.assertRaisesRegex(RuntimeError,'storage_fixture_action_denied'):r.storage(f,'arbitrary_request')
if __name__=='__main__':unittest.main()
