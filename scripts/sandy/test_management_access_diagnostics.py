import base64
import contextlib
import io
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import management_access_diagnostics as access
from inspect_api_production import HttpResult
import owner_repair_diagnostics
import release_owner_session_repair as release


class Tests(unittest.TestCase):
    def transport(self, denied=None, visible=True, missing_privilege=None):
        calls=[]
        def request(method,url,headers,body):
            calls.append((method,url,body))
            self.assertEqual(headers['authorization'],'Bearer fixture-private-token')
            if method=='POST':self.assertTrue(body['query'].lstrip().upper().startswith('SELECT'))
            if denied==url:return HttpResult(403,{'message':'fixture-private-provider-error'},'provider_request_denied')
            if url==access.ACCOUNT_BASE+'/projects':return HttpResult(200,[{'id':access.PROJECT_REF}] if visible else [{'id':'fixture-private-other-project'}])
            if url==access.MANAGEMENT_BASE:return HttpResult(200,{'id':access.PROJECT_REF,'database_password':'fixture-private-password'})
            if url.endswith('/functions/sandy-engineering-control'):return HttpResult(200,{'version':51,'private_source':'fixture-private-source'})
            if body=={'query':'SELECT 1::integer AS management_read_probe;'}:return HttpResult(201,[{'management_read_probe':1}])
            if body=={'query':access.PRIVILEGE_QUERY}:return HttpResult(201,[{k:k!=missing_privilege for k in access.PRIVILEGES}])
            raise AssertionError('unexpected diagnostic endpoint')
        return request,calls

    def diagnose(self,**options):
        transport,calls=self.transport(**options)
        result=access.diagnose_access({'SANDY_SUPABASE_MANAGEMENT_TOKEN':'fixture-private-token','GITHUB_ACTIONS':'true'},transport)
        self.assertNotIn('fixture-private',json.dumps(result))
        self.assertFalse(result['production_writes_dispatched'])
        self.assertFalse(result['function_deploy_permission_verified'])
        return result,calls

    def test_read_only_probes_keep_existing_binding_and_do_not_claim_write_authority(self):
        result,calls=self.diagnose()
        self.assertTrue(result['ok']);self.assertEqual(result['conclusion'],'management_reads_verified')
        self.assertEqual(result['credential_binding'],'sandy-production/SUPABASE_ACCESS_TOKEN')
        self.assertEqual(len(calls),5);self.assertTrue(result['database_query_access_verified'])

    def test_distinguishes_project_exclusion_from_database_endpoint_denial(self):
        result,calls=self.diagnose(denied=access.MANAGEMENT_BASE+'/database/query')
        self.assertEqual(result['conclusion'],'database_query_access_denied')
        self.assertTrue(result['target_project_metadata_verified']);self.assertEqual(len(calls),4)
        self.assertEqual(result['probes']['database_select']['http_status'],403)
        result,_=self.diagnose(visible=False,denied=access.MANAGEMENT_BASE)
        self.assertEqual(result['conclusion'],'target_project_not_visible')

    def test_missing_database_privilege_stops_without_attempting_a_write(self):
        result,calls=self.diagnose(missing_privilege='migration_history_insert')
        self.assertEqual(result['conclusion'],'database_object_privileges_missing')
        self.assertFalse(result['ok']);self.assertFalse(result['database_privileges']['migration_history_insert'])
        self.assertTrue(all(method=='GET' or body['query'].startswith('SELECT') for method,url,body in calls))

    def test_missing_binding_never_uses_an_unrelated_credential(self):
        def never(*args):raise AssertionError('unexpected credential substitution')
        result=access.diagnose_access({'SANDY_CONTROLLER_ACCESS_TOKEN':'fixture-private-owner'},never)
        self.assertEqual(result['conclusion'],'credential_binding_missing')

    def test_project_api_credentials_are_identified_without_exporting_claims(self):
        claims=base64.urlsafe_b64encode(json.dumps({'role':'service_role','private':'fixture-private-claim'}).encode()).decode().rstrip('=')
        self.assertEqual(access.credential_kind('fixture.'+claims+'.fixture'),'project_api_jwt_format')
        self.assertEqual(access.credential_kind('sbp_fixture-private-token'),'management_token_format')
        self.assertEqual(access.credential_kind('sb_secret_fixture-private-token'),'project_api_key_format')

    def test_public_annotation_contains_only_bounded_codes_and_permission_booleans(self):
        result,_=self.diagnose(denied=access.MANAGEMENT_BASE+'/database/query')
        result['private']='fixture-private';result['probes']['fixture-private']={'http_status':403}
        result['database_privileges']={'fixture-private':True,'release_audit_insert':False}
        line=owner_repair_diagnostics.github_annotation({'ok':False,'mode':'management_access_diagnostics','management_access':result})
        self.assertNotIn('fixture-private',line);self.assertIn('database_query_access_denied',line)
        self.assertIn('release_audit_insert',line)

    def test_diagnostic_cli_cannot_enter_the_release_path(self):
        output=io.StringIO()
        with tempfile.TemporaryDirectory() as temp:
            out=Path(temp)/'new'
            with patch.object(release,'candidate',return_value=({}, {}, b'')),patch.object(access,'diagnose_access',return_value={'ok':False,'conclusion':'database_query_access_denied'}),patch.object(release,'run') as run,patch.object(release,'upload') as upload,contextlib.redirect_stdout(output):
                status=release.main(['--diagnose-access','--evidence-dir',str(out)])
            run.assert_not_called();upload.assert_not_called();self.assertEqual(status,1)
            value=json.loads((out/'redacted-access.json').read_text())
            self.assertTrue(value['read_only']);self.assertFalse(value['approval_written'])
            self.assertFalse(value['migration_dispatched']);self.assertFalse(value['function_upload_dispatched'])
            self.assertEqual((out/'redacted-access.json').stat().st_mode&0o777,0o600)

if __name__=='__main__':unittest.main()
