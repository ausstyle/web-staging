import io,json,tempfile,unittest,zipfile,contextlib
from pathlib import Path
from unittest.mock import Mock,patch
from verify_customer_mutation_private_mcp import CustomerMutationAcceptance,fixture_docx,storage_object_absent,await_storage_absent
class CustomerMutationAcceptanceTests(unittest.TestCase):
 def test_real_tiny_DOCX_contains_only_fixed_synthetic_content(self):
  raw=fixture_docx();self.assertLessEqual(len(raw),2048)
  with zipfile.ZipFile(io.BytesIO(raw)) as z:
   self.assertEqual(set(z.namelist()),{'[Content_Types].xml','_rels/.rels','word/document.xml'})
   self.assertIn(b'No customer data',z.read('word/document.xml'))
 def test_storage_cleanup_distinguishes_missing_object_from_auth_or_transport_failure(self):
  self.assertTrue(storage_object_absent(400,b'{"statusCode":"404","error":"not_found","message":"Object not found"}'))
  for status,body in [(403,b'{"statusCode":"403","error":"AccessDenied"}'),(400,b'{"statusCode":"400","error":"InvalidJWT"}'),(404,b'proxy route missing')]:self.assertFalse(storage_object_absent(status,body))
 def test_compiled_contract_check_reads_pinned_catalog_metadata_without_private_execution(self):
  r=self.runner();expected={'proname':'sandy_customer_mutation_contracts_v1','sha':'a'*64,'prosecdef':False,'proconfig':['search_path=pg_catalog, pg_temp'],'owner':'postgres'}
  with tempfile.TemporaryDirectory() as d:
   r.manifest=Path(d)/'manifest.json';r.manifest.write_text(json.dumps({'private_schema_sources':[expected]}));r.report={'checks':[]}
   r.r._sql.return_value=[expected];r.verify_contract_metadata()
   query=r.r._sql.call_args.args[0]
   self.assertIn('FROM pg_proc',query);self.assertNotIn('SELECT public.sandy_customer_mutation_contracts_v1()',query)
   self.assertIs(r.r._sql.call_args.args[1],True);self.assertTrue(r.report['checks'][-1]['passed'])
   r.r._sql.return_value=[{**expected,'sha':'b'*64}]
   with self.assertRaisesRegex(RuntimeError,'reviewed_existing_ten_compiled_contracts'):r.verify_contract_metadata()
 def test_failed_notice_exposes_safe_code_but_never_raw_sensitive_error(self):
  for error,code in [(RuntimeError('runtime_administration_query_failed'),'runtime_administration_query_failed'),(RuntimeError('Authorization Bearer private.fixture.jwt'),None)]:
   r=self.runner();r.readiness=None;r.change=None;r.retired=False
   r.report={'checks':[],'cleanup':{},'verified_mutation_receipts':[],'exact_capability_scope':{'test':'fixture'}}
   r.prepare=Mock(side_effect=error)
   def cleanup():r.report['cleanup'].update(complete=True,storage_and_fixture_retirement_complete=True)
   r.cleanup=cleanup
   with tempfile.TemporaryDirectory() as d:
    r.output=Path(d)/'report.json';r.save=lambda:r.output.write_text(json.dumps(r.report))
    stdout=io.StringIO()
    with contextlib.redirect_stdout(stdout):self.assertFalse(r.run())
    notice=json.loads(stdout.getvalue().split('::',2)[2]);self.assertEqual(notice['error_class'],'RuntimeError');self.assertEqual(notice['runner_error_code'],code)
    self.assertNotIn('private.fixture.jwt',stdout.getvalue());r.r._sql.assert_not_called()
 def test_delayed_storage_absence_retries_reads_only_and_requires_missing_object(self):
  missing=(400,b'{"statusCode":"404","error":"not_found"}')
  read=Mock(side_effect=[(200,b'old bytes'),(200,b'old bytes'),missing]);pause=Mock()
  await_storage_absent(read,pause);self.assertEqual(read.call_count,3);self.assertEqual(pause.call_count,2)
  read=Mock(return_value=(200,b'old bytes'));pause=Mock()
  with self.assertRaisesRegex(RuntimeError,'storage_fixture_not_retired'):await_storage_absent(read,pause)
  self.assertEqual(read.call_count,7);self.assertEqual(pause.call_count,6)
  for response in [(403,b'forbidden'),(404,b'proxy missing'),(500,b'error')]:
   read=Mock(return_value=response);pause=Mock()
   with self.assertRaisesRegex(RuntimeError,'storage_fixture_state_unknown'):await_storage_absent(read,pause)
   read.assert_called_once();pause.assert_not_called()
 def test_auth_retirement_precedes_potentially_slow_storage_polling(self):
  r=self.runner();r.report={'cleanup':{}};r.retire=Mock();r.r._quote=lambda v:repr(v)
  r.fixtures=[{'customer':'10000000-0000-4000-8000-000000000001','blob_path':'fixture'}]
  r.r._sql.return_value=[{'display_name':'Isolated Sandy API service acceptance','google_drive_folder_status':'excluded'}]
  retired=[]
  def retire_auth(_):retired.append(True)
  def read(*args):
   self.assertEqual(retired,[True]);return 400,b'{"statusCode":"404","error":"not_found"}'
  r.storage=Mock(side_effect=read)
  with patch('verify_customer_mutation_private_mcp.PrivateMemoryAcceptance.cleanup',retire_auth):r.cleanup()
  self.assertTrue(r.report['cleanup']['storage_and_fixture_retirement_complete'])
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
