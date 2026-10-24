import json,unittest
from unittest import mock
import reconcile_existing_iap_candidate as r
import diagnose_iap_routing as routing
class ExistingCandidate(unittest.TestCase):
 def test_cloud_read_denial_never_prints_arbitrary_error_or_credentials(self):
  result=mock.Mock(returncode=1,stderr='PERMISSION_DENIED private-token-DO-NOT-PRINT',stdout='')
  with mock.patch.object(r.subprocess,'run',return_value=result),self.assertRaisesRegex(r.Blocked,'^gcloud_permission_denied$'):r.cloud('logging','read','fixture')
 def test_logs_retain_only_safe_request_metadata(self):
  row={'timestamp':'fixture','severity':'ERROR','httpRequest':{'status':404,'requestMethod':'GET','requestUrl':'PRIVATE','requestHeaders':'PRIVATE'},'textPayload':'PRIVATE','jsonPayload':{'token':'PRIVATE'}}
  with mock.patch.object(r,'cloud',return_value=[row]):value=r.logs()
  self.assertNotIn('PRIVATE',json.dumps(value));self.assertEqual(value['health_requests'][0]['http_status'],404)
 def test_unavailable_log_permission_is_precise_and_does_not_expand_IAM(self):
  with mock.patch.object(r,'cloud',side_effect=r.Blocked('gcloud_permission_denied')):value=r.logs()
  self.assertEqual(value,{'available':False,'error':'gcloud_permission_denied','attempted_operation':'logging.entries.list'})
 def test_readback_uses_fixed_existing_candidate_and_immutable_original_traffic(self):
  proof={'image_digest':'image@sha256:'+r.IMAGE,'source_sha256':r.WORKER_HASH}
  original=mock.Mock();original.__truediv__=mock.Mock(return_value=mock.Mock(read_text=mock.Mock(return_value='{"original":"traffic"}')))
  with mock.patch.object(r,'service',return_value={'status':{'traffic':[]}}),mock.patch.object(r,'revision',return_value={'actual':'revision'}),mock.patch.object(r,'worker_manifest',return_value={'source_sha256':r.WORKER_HASH}),mock.patch.object(r,'validate',return_value=proof) as validate:
   result,_,_=r.readback(original)
  self.assertFalse(result['new_candidate_created']);self.assertFalse(result['bindings_changed']);self.assertEqual(result['IAM_changes'],0)
  self.assertEqual(validate.call_args.args[:6],({'original':'traffic'},{'status':{'traffic':[]}},{'actual':'revision'},r.SOURCE,r.RUN,r.ATTEMPT))
 def test_actual_acceptance_path_explicitly_selects_only_reviewed_MCP24_readback(self):
  proof={'passed':True,'url':'https://fixed.invalid','source_sha256':r.WORKER_HASH,'revision':r.REVISION}
  management=mock.Mock();management.api.return_value=json.dumps([{'name':name,'value':r.digest(value.encode())} for name,value in zip(r.NAMES,[proof['url'],proof['source_sha256'],proof['revision']])]).encode()
  with mock.patch.object(r,'readback',return_value=(proof,{},{})),mock.patch.object(r,'load',return_value=({},None,'migration')),mock.patch.object(r,'verify_installed',return_value={'passed':True,'preserved_MCP_metadata_version':24}) as installed:
   result,_,_=r.verify(management,None)
  installed.assert_called_once_with(management,{},'migration',post_binding_readback=True)
  self.assertEqual(result['preserved_MCP_metadata_version'],24);management.upload.assert_not_called();management.sql.assert_not_called()
 def test_notices_are_bounded_and_escape_annotation_controls(self):
  import io
  output=io.StringIO()
  with mock.patch('sys.stdout',output):r.notice('fixed',{'status':404,'classification':'http_not_found'})
  self.assertIn('::notice title=fixed::',output.getvalue());self.assertIn('404',output.getvalue())
  with self.assertRaisesRegex(r.Blocked,'bounded_safe_notice_required'):r.notice('fixed',{'huge':'x'*12001})
 def test_wrong_candidate_image_stops_acceptance(self):
  original=mock.MagicMock();(original/'before.json').read_text.return_value='{}'
  with mock.patch.object(r,'service'),mock.patch.object(r,'revision'),mock.patch.object(r,'worker_manifest',return_value={'source_sha256':r.WORKER_HASH}),mock.patch.object(r,'validate',return_value={'image_digest':'image@sha256:wrong'}),self.assertRaisesRegex(r.Blocked,'existing_candidate_image_mismatch'):r.readback(original)
class TwoPhaseReadback(unittest.TestCase):
 def test_initial_and_final_share_output_without_clobber_or_exclusive_create_failure(self):
  import tempfile
  from pathlib import Path
  with tempfile.TemporaryDirectory() as directory:
   out=Path(directory)
   with mock.patch.object(r,'verify',return_value=({'passed':True},{},{})),mock.patch.object(r,'readback',return_value=({'passed':True},{},{})),mock.patch.object(r,'logs',return_value={'available':False,'error':'gcloud_permission_denied'}),mock.patch.object(r,'notice') as notice:
    r.phase(None,out);r.phase(None,out,True)
   self.assertTrue((out/'initial-health-request-logs.json').exists());self.assertTrue((out/'final-health-request-logs.json').exists())
   self.assertTrue((out/'iap-final-provider-readback.json').exists());self.assertEqual(notice.call_count,4)
 def test_known_logging_denial_is_not_probed_again_in_diagnostics(self):
  import tempfile
  from pathlib import Path
  with tempfile.TemporaryDirectory() as directory,mock.patch.object(r,'verify',return_value=({'passed':True},{},{})),mock.patch.object(r,'logs') as logs,mock.patch.object(r,'notice'):
   root=Path(directory);r.phase(None,root,skip_known_log_permission=True)
   value=json.loads((root/'initial-health-request-logs.json').read_text())
  logs.assert_not_called();self.assertTrue(value['read_skipped']);self.assertEqual(value['evidence_run_id'],'40049214245')
 def test_unexpected_failure_records_only_bounded_class_not_exception_payload(self):
  import tempfile
  from pathlib import Path
  with tempfile.TemporaryDirectory() as directory,mock.patch.object(r,'notice'):
   value=r.failure(Path(directory),True,FileExistsError('PRIVATE_SIGNED_URL_OR_SECRET'))
  self.assertEqual(value['exception_class'],'FileExistsError');self.assertNotIn('PRIVATE',json.dumps(value))

class RoutingDiagnostics(unittest.TestCase):
 def test_only_provider_allowlisted_ingress_and_routes_are_recorded(self):
  value={'metadata':{'annotations':{'run.googleapis.com/ingress':'internal','run.googleapis.com/default-url-disabled':'true','PRIVATE':'SECRET','run.googleapis.com/urls':'["https://fixed.a.run.app","https://other.invalid?token=SECRET"]'}},'status':{'url':'https://fixed.a.run.app','traffic':[{'revisionName':r.REVISION,'tag':'sandy-iap-repair-review','url':'https://fixed.a.run.app'}],'conditions':[{'type':'Ready','status':'True','message':'PRIVATE_PAYLOAD'}]},'spec':{'secret':'SECRET'}}
  result=routing.routing(value);text=json.dumps(result)
  self.assertNotIn('PRIVATE',text);self.assertNotIn('SECRET',text);self.assertEqual(result['application_requests_sent'],0)
  self.assertEqual(result['annotations']['run.googleapis.com/ingress'],'internal');self.assertEqual(result['annotations']['run.googleapis.com/default-url-disabled'],'true')
  self.assertEqual(result['provider_default_urls'],['https://fixed.a.run.app'])
 def test_prior_artifact_recovers_health_and_persisted_proof_without_raw_payload(self):
  import tempfile
  from pathlib import Path
  with tempfile.TemporaryDirectory() as directory:
   root=Path(directory)
   (root/'iap-closed-acceptance.json').write_text(json.dumps({'health':{'http_status':404,'classification':'http_not_found','content_type':'text/html','body_format':'non_json','response_body_recorded':False},'private':'SECRET'}))
   (root/'iap-final-provider-readback.json').write_text(json.dumps({'passed':True,'revision':r.REVISION,'source_commit':r.SOURCE,'image_digest':'image@sha256:'+r.IMAGE,'production_traffic_unchanged':True,'original_candidate_tag_preserved':True}))
   (root/'health-request-logs.json').write_text('{}');result=routing.prior_artifact(root)
  self.assertTrue(result['prior_final_provider_proof_persisted']);self.assertTrue(result['prior_shared_health_filename_present']);self.assertEqual(result['prior_health']['http_status'],404);self.assertNotIn('SECRET',json.dumps(result))

class AcceptanceOnlyWorkflow(unittest.TestCase):
 def test_fixed_original_run_and_always_final_readback_without_mutation_commands(self):
  source=(r.ROOT/'.github/workflows/sandy-iap-existing-candidate-acceptance.yml').read_text()
  for forbidden in ['gcloud run deploy','update-traffic','set-iam-policy','bind_iap_transport_runtime.py','--deploy']:
   self.assertNotIn(forbidden,source)
  self.assertIn('run-id: 40047740407',source);self.assertIn(r.SOURCE,source)
  self.assertIn("if: ${{ always() && steps.auth.outcome == 'success' }}",source)
  self.assertIn('--final',source);self.assertIn('sandy-engineering-mcp-deploy',source)
  self.assertEqual(source.count('--skip-known-log-permission'),2)
  self.assertIn('default: diagnostics',source);self.assertIn("if: ${{ inputs.mode == 'acceptance' }}",source)
  self.assertIn('scripts/sandy/diagnose_iap_routing.py',source)
if __name__=='__main__':unittest.main()
