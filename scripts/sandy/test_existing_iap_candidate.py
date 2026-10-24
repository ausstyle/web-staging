import json,unittest
from unittest import mock
import reconcile_existing_iap_candidate as r
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
 def test_notices_are_bounded_and_escape_annotation_controls(self):
  import io
  output=io.StringIO()
  with mock.patch('sys.stdout',output):r.notice('fixed',{'status':404,'classification':'http_not_found'})
  self.assertIn('::notice title=fixed::',output.getvalue());self.assertIn('404',output.getvalue())
  with self.assertRaisesRegex(r.Blocked,'bounded_safe_notice_required'):r.notice('fixed',{'huge':'x'*12001})
 def test_wrong_candidate_image_stops_acceptance(self):
  original=mock.MagicMock();(original/'before.json').read_text.return_value='{}'
  with mock.patch.object(r,'service'),mock.patch.object(r,'revision'),mock.patch.object(r,'worker_manifest',return_value={'source_sha256':r.WORKER_HASH}),mock.patch.object(r,'validate',return_value={'image_digest':'image@sha256:wrong'}),self.assertRaisesRegex(r.Blocked,'existing_candidate_image_mismatch'):r.readback(original)
class AcceptanceOnlyWorkflow(unittest.TestCase):
 def test_fixed_original_run_and_always_final_readback_without_mutation_commands(self):
  source=(r.ROOT/'.github/workflows/sandy-iap-existing-candidate-acceptance.yml').read_text()
  for forbidden in ['gcloud run deploy','update-traffic','set-iam-policy','bind_iap_transport_runtime.py','--deploy']:
   self.assertNotIn(forbidden,source)
  self.assertIn('run-id: 40047740407',source);self.assertIn(r.SOURCE,source)
  self.assertIn("if: ${{ always() && steps.auth.outcome == 'success' }}",source)
  self.assertIn('--final',source);self.assertIn('sandy-engineering-mcp-deploy',source)
if __name__=='__main__':unittest.main()
