import json
from pathlib import Path
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch
import release_eng0001_v4 as release

class Tests(unittest.TestCase):
    def context(self):
        m={'function':release.SLUG,'change_id':release.CHANGE,'branch':release.BRANCH,'source_commit':'a'*40}
        r=SimpleNamespace(manifest=m,pin='b'*64,tested='c'*40,credential='fixture',holder='fixture',sql=lambda q:[{'admitted':True}])
        value={'change':{'status':'approved','scope':[release.SLUG]},'tests':[{'outcome':'passed','evidence':{'manifest_sha256':r.pin,'source_commit':m['source_commit'],'ci_commit':r.tested}}]}
        return r,value
    def test_existing_scope_requires_both_real_owner_provenance_and_exact_candidate_evidence(self):
        r,value=self.context()
        with patch.object(release,'control',return_value=(200,value)):
            release.ApprovedRuntime.admission(r)
            r.sql=lambda q:[{'admitted':False}]
            with self.assertRaisesRegex(release.Blocked,'genuine_existing_owner_scope_not_verified'):release.ApprovedRuntime.admission(r)
        r,value=self.context();value['tests'][0]['evidence']['manifest_sha256']='wrong'
        with patch.object(release,'control',return_value=(200,value)),self.assertRaisesRegex(release.Blocked,'pinned_candidate_test_evidence_required'):
            release.ApprovedRuntime.admission(r)
    def test_whatsapp_requires_its_actual_approved_target_scope(self):
        r,value=self.context();r.manifest['function']='sandy-whatsapp-webhook'
        with patch.object(release,'control',return_value=(200,value)),self.assertRaisesRegex(release.Blocked,'existing_control_scope_not_approved'):
            release.ApprovedRuntime.admission(r)
        value['change']['scope'].append('sandy-whatsapp-webhook')
        with patch.object(release,'control',return_value=(200,value)):release.ApprovedRuntime.admission(r)
    def test_other_components_cannot_reuse_the_runtime_program_scope(self):
        r,_=self.context();r.manifest['function']='sandy-examiner-full-cycle'
        with self.assertRaisesRegex(release.Blocked,'only_existing_eng0001_v4_scope_supported'):release.ApprovedRuntime.admission(r)
    def test_a_scope_revocation_prevents_administrative_dispatch(self):
        r,value=self.context();value['change']['status']='cancelled'
        with patch.object(release,'control',return_value=(200,value)),self.assertRaisesRegex(release.Blocked,'existing_control_scope_not_approved'):
            release.ApprovedRuntime.admission(r)
    def transport(self,out):
        r,_=self.context();r.evidence=Path(out);r.sources={'index.ts':b'approved'};r.queries=[]
        r.manifest.update(expected_prior_version=30,prior_bundle_sha256=release.digest(b'before'),rollback='Restore captured prior source under a fresh lease.')
        r.admission=lambda lease=False:None
        r.sql=lambda q:r.queries.append(q) or []
        r.api=lambda method,path: b'before' if path.endswith('/body') else json.dumps({'slug':release.SLUG,'version':30,'status':'ACTIVE','verify_jwt':False}).encode()
        return r
    def test_unknown_upload_outcome_keeps_its_lease_and_never_retries(self):
        with tempfile.TemporaryDirectory() as out:
            r=self.transport(out)
            with patch.object(release,'verify_ci'),patch.object(release,'verify_release_harness'),patch.object(release,'original_sources',return_value=r.sources),patch.object(release,'upload',side_effect=release.Blocked('provider_outcome_unknown')) as upload:
                with self.assertRaisesRegex(release.Blocked,'provider_outcome_unknown'):release.run(r,True)
            self.assertEqual(upload.call_count,1)
            self.assertFalse(any(q.startswith('DELETE') for q in r.queries))
    def test_legacy_channel_original_source_drift_stops_before_upload(self):
        with tempfile.TemporaryDirectory() as out:
            r=self.transport(out);r.manifest.update(function='sandy-whatsapp-webhook',prior_original_files={'index.ts':'wrong'})
            r.api=lambda method,path:b'before' if path.endswith('/body') else json.dumps({'slug':'sandy-whatsapp-webhook','version':30,'status':'ACTIVE','verify_jwt':False}).encode()
            with patch.object(release,'verify_ci'),patch.object(release,'verify_release_harness'),patch.object(release,'whatsapp_original_sources',return_value=r.sources),patch.object(release,'upload') as upload:
                with self.assertRaisesRegex(release.Blocked,'original_prior_channel_source_not_verified'):release.run(r,True)
            upload.assert_not_called();self.assertFalse(r.queries)
    def test_changed_deployed_source_stops_before_lease_or_upload(self):
        with tempfile.TemporaryDirectory() as out:
            r=self.transport(out);r.manifest['expected_prior_version']=29
            with patch.object(release,'verify_ci'),patch.object(release,'verify_release_harness'),patch.object(release,'upload') as upload:
                with self.assertRaisesRegex(release.Blocked,'published_source_or_configuration_changed'):release.run(r,True)
            upload.assert_not_called();self.assertFalse(r.queries)

if __name__=='__main__':unittest.main()
