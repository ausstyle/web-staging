import contextlib
import io
import json
from pathlib import Path
import tempfile
import unittest
import urllib.error
from unittest.mock import patch
import owner_repair_diagnostics as diagnostics
import release_owner_session_repair as release
import test_owner_repair_release as release_fixtures
Transport=release_fixtures.Transport

class Tests(unittest.TestCase):
    def test_only_allowlisted_guards_and_postgres_codes_are_public(self):
        secret='fixture-credential-and-private-source'
        self.assertEqual(diagnostics.failure_details(release.Blocked(secret)),{'failure_code':'release_guard_rejected'})
        self.assertEqual(diagnostics.failure_details(KeyError(secret)),{'failure_code':'required_configuration_or_field_missing'})
        self.assertEqual(diagnostics.provider_sqlstate(json.dumps({'code':secret,'message':secret}).encode()),None)
        for raw in [json.dumps({'code':'42501','message':secret}).encode(),('ERROR: 42703: '+secret).encode()]:
            self.assertIn(diagnostics.provider_sqlstate(raw),('42501','42703'))
        self.assertEqual(diagnostics.failure_details(release.Blocked('approved_manifest_changed')),{'failure_code':'approved_manifest_changed'})
    def test_management_error_discards_messages_headers_and_request_contents(self):
        body=b'{"message":"ERROR: 42501: fixture-private-source-and-credential"}'
        r=release.Repair(None)
        with patch.dict('os.environ',{'SANDY_SUPABASE_MANAGEMENT_TOKEN':'fixture-token'}):
            for path in ('/database/query','/functions/sandy-engineering-control'):
                error=urllib.error.HTTPError('https://unused.invalid',400,'fixture-private-source',{'secret':'fixture-token'},io.BytesIO(body))
                with patch.object(r.opener,'open',side_effect=error):
                    with self.assertRaises(diagnostics.ManagementFailure) as caught:r.api('POST',path,b'fixture-private-query')
                result=diagnostics.failure_details(caught.exception)
                self.assertEqual(result['http_status'],400)
                self.assertEqual(result.get('sqlstate'),'42501' if path=='/database/query' else None)
                self.assertNotIn('fixture',json.dumps(result))
    def test_cli_reports_the_precise_safe_stage_without_exception_text(self):
        r=release.Repair(None)
        def failed(*args):
            r.stage='approval_verification';raise diagnostics.ManagementFailure(403)
        output=io.StringIO()
        with patch.object(release,'candidate',return_value=({}, {}, b'')),patch.object(release,'Repair',return_value=r),patch.object(release,'run',side_effect=failed),contextlib.redirect_stdout(output):
            code=release.main([])
        value=json.loads(output.getvalue());self.assertEqual(code,1);self.assertEqual(value['stage'],'approval_verification');self.assertEqual(value['failure_code'],'management_http_403_no_automatic_retry')
        self.assertFalse(value['migration_dispatched']);self.assertFalse(value['function_upload_dispatched']);self.assertTrue(value['read_only'])
    def test_failed_migration_never_uploads_or_discards_the_unknown_outcome_lease(self):
        with tempfile.TemporaryDirectory() as temp:
            r=Transport(Path(temp));sql=r.sql
            def failed(query):
                if query.startswith('BEGIN; SELECT pg_advisory'):raise diagnostics.ManagementFailure(400,'42501')
                return sql(query)
            r.sql=failed
            with patch.dict('os.environ',{'GITHUB_ACTIONS':'true'}),patch.object(release,'upload') as upload:
                with self.assertRaises(diagnostics.ManagementFailure):release.run(r,release_fixtures.Tests().manifest(),{},b'BEGIN; COMMIT;',True)
            upload.assert_not_called();self.assertEqual(r.stage,'migration_transaction');self.assertTrue(r.migration_dispatched)
            self.assertFalse(any(q.startswith('DELETE') for q in r.queries))
    def test_unknown_upload_is_never_retried_and_retains_the_lease(self):
        with tempfile.TemporaryDirectory() as temp:
            r=Transport(Path(temp))
            with patch.dict('os.environ',{'GITHUB_ACTIONS':'true'}),patch.object(release,'upload',side_effect=TimeoutError('fixture-secret')) as upload:
                with self.assertRaises(TimeoutError):release.run(r,release_fixtures.Tests().manifest(),{},b'BEGIN; COMMIT;',True)
            self.assertEqual(upload.call_count,1);self.assertTrue(r.function_upload_dispatched)
            self.assertEqual(r.stage,'function_upload');self.assertFalse(any(q.startswith('DELETE') for q in r.queries))
    def test_cleanup_error_never_masks_the_original_guard_failure(self):
        with tempfile.TemporaryDirectory() as temp:
            r=Transport(Path(temp));sql=r.sql
            def admission(lease=False):
                if lease:raise release.Blocked('release_lease_lost')
            def cleanup(query):
                if query.startswith('DELETE'):raise diagnostics.ManagementFailure(503)
                return sql(query)
            r.sql=cleanup;r.admission=admission
            with patch.dict('os.environ',{'GITHUB_ACTIONS':'true'}):
                with self.assertRaisesRegex(release.Blocked,'release_lease_lost'):release.run(r,release_fixtures.Tests().manifest(),{},b'BEGIN; COMMIT;',True)
            self.assertEqual(r.cleanup_failure['http_status'],503)
    def reconciliation(self):
        r=Transport(None);sql=r.sql
        def readonly(query):
            if not query.lower().startswith('select'):raise AssertionError('mutation during read-only reconciliation')
            if "AS present" in query:return [{'present':False}]
            return []
        r.sql=readonly
        return r
    def test_reconciliation_is_select_get_only_and_detects_partial_state(self):
        r=self.reconciliation()
        with patch.object(release,'original_sources',return_value={'index.ts':b'old'}),patch.object(release,'upload') as upload:
            result=release.reconcile(r,release_fixtures.Tests().manifest(),{},b'approved')
        self.assertTrue(result['clean_retry_preconditions_verified']);self.assertFalse(result['function_upload_dispatched']);upload.assert_not_called()
        sql=r.sql
        r.sql=lambda q:[{'column_name':'standing_revision'}] if 'SELECT column_name' in q else sql(q)
        with patch.object(release,'original_sources',return_value={}):result=release.reconcile(r,release_fixtures.Tests().manifest(),{},b'approved')
        self.assertFalse(result['clean_retry_preconditions_verified']);self.assertEqual(result['state'],'requires_reconciliation')
    def test_same_credential_reconciliation_reports_denial_without_changing_production(self):
        r=self.reconciliation();r.admission=lambda *a:(_ for _ in ()).throw(diagnostics.ManagementFailure(403))
        with patch.object(release,'original_sources',return_value={}):result=release.reconcile(r,release_fixtures.Tests().manifest(),{},b'approved')
        self.assertFalse(result['ok']);self.assertEqual(result['observations']['approval_verification']['http_status'],403)
        self.assertFalse(result['migration_dispatched']);self.assertFalse(result['function_upload_dispatched'])
    def test_failure_artifact_contains_safe_codes_only(self):
        with tempfile.TemporaryDirectory() as temp:
            out=Path(temp)/'new';r=release.Repair(out)
            def fail(*args):r.stage='migration_transaction';r.migration_dispatched=True;raise diagnostics.ManagementFailure(400,'42501')
            output=io.StringIO()
            with patch.object(release,'candidate',return_value=({}, {}, b'')),patch.object(release,'Repair',return_value=r),patch.object(release,'run',side_effect=fail),contextlib.redirect_stdout(output):
                status=release.main(['--deploy','--evidence-dir',str(out)])
            self.assertEqual(status,1);value=json.loads((out/'redacted-failure.json').read_text())
            self.assertEqual(value['sqlstate'],'42501');self.assertEqual(value['stage'],'migration_transaction')
            self.assertEqual((out/'redacted-failure.json').stat().st_mode&0o777,0o600)
if __name__=='__main__':unittest.main()
