import io
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import Mock, patch

import release_memory_private_correction as release
from release_web_canary import Blocked
from verify_memory_private_mcp import PrivateMemoryAcceptance


class MemoryPrivateReleaseTests(unittest.TestCase):
    def test_committed_manifest_has_only_reviewed_migrations_and_global_flags_closed(self):
        m,migrations=release.load()
        self.assertEqual(set(m['functions']),set(release.SLUGS))
        self.assertEqual(len(migrations),2)
        self.assertFalse(m['flags_enabled'])
        self.assertEqual(m['private_readiness']['maximum_mutations'],3)
        self.assertEqual(m['private_readiness']['maximum_minutes'],15)

    def test_source_identity_cannot_be_an_uncommitted_local_or_feature_branch(self):
        for env in [{},{'GITHUB_ACTIONS':'true','GITHUB_REF':'refs/heads/feature','GITHUB_SHA':'a'*40}]:
            with patch.dict(os.environ,env,clear=True),self.assertRaisesRegex(Blocked,'protected_committed_main_release_required'):
                release.source_check({})

    def test_preflight_never_uploads_or_writes(self):
        r=Mock()
        with patch.object(release,'functions',return_value={}),patch.object(release,'schema'),patch.object(release,'candidate'):
            self.assertEqual(release.run(r,{},{}),{'preflight_passed':True,'deployed':False,'mutations':0})
        r.upload.assert_not_called();r.sql.assert_not_called()

    def test_live_drift_stops_before_any_mutation(self):
        r=Mock()
        with patch.object(release,'functions',side_effect=Blocked('function_source_drift_reconcile_before_retry')):
            with self.assertRaises(Blocked):release.run(r,{}, {},True)
        r.sql.assert_not_called();r.upload.assert_not_called()

    def test_partial_upload_has_no_retry_and_retains_lease_for_reconciliation(self):
        m,_=release.load();before={s:({'version':m['functions'][s]['before_version']},b'original',{}) for s in release.SLUGS}
        r=Mock();r.holder='test-release';r.upload.side_effect=Blocked('management_request_failed_or_unknown_outcome_no_retry')
        def sql(query,read_only=False):
            if 'count(*)::int held' in query:return [{'held':2}]
            return []
        r.sql.side_effect=sql
        with tempfile.TemporaryDirectory() as tmp:
            r.out=Path(tmp)/'preimages'
            with patch.object(release,'functions',return_value=before),patch.object(release,'schema',return_value={}),patch.object(release,'candidate',return_value={s:{} for s in release.SLUGS}),patch.object(release,'source_check',return_value='a'*40),patch.object(release,'track',return_value='00000000-0000-4000-8000-000000000001'):
                with self.assertRaises(Blocked):release.run(r,m,{},True)
            self.assertTrue((r.out/'rollback.json').exists())
        self.assertEqual(r.upload.call_count,1)
        queries=[c.args[0] for c in r.sql.call_args_list]
        self.assertTrue(any('outcome_unknown' in q for q in queries))
        self.assertFalse(any('DELETE FROM public.sandy_engineering_component_leases' in q for q in queries))


class MemoryPrivateAcceptanceTests(unittest.TestCase):
    def bare(self):
        a=PrivateMemoryAcceptance.__new__(PrivateMemoryAcceptance)
        a.r=Mock();a.r._quote.side_effect=lambda v:"'"+v+"'";a.keys={'anon':'public-project-key'}
        a.readiness='00000000-0000-4000-8000-000000000001';a.change='00000000-0000-4000-8000-000000000002';a.retired=False
        a.report={'checks':[],'cleanup':{}};a.save=Mock();a.fixtures=[{'user':'fixture-user','customer':'fixture-customer','token':'normal-fixture-token'}]
        return a

    def test_MCP_uses_actual_normal_bearer_and_metadata_header_only(self):
        a=self.bare();response=Mock();response.status=200;response.read.return_value=b'{"result":{}}';response.__enter__=Mock(return_value=response);response.__exit__=Mock(return_value=False);a.r._opener.open.return_value=response
        status,_=a.rpc(a.fixtures[0],'tools/call',{'name':'memory.fact_correct','arguments':{'confirm':True}})
        request=a.r._opener.open.call_args.args[0]
        self.assertEqual(status,200)
        self.assertEqual(request.get_header('Authorization'),'Bearer normal-fixture-token')
        self.assertEqual(request.get_header('Apikey'),'public-project-key')
        self.assertEqual(request.get_header('X-sandy-certification-id'),a.readiness)
        self.assertEqual(json.loads(request.data)['params']['name'],'memory.fact_correct')
        self.assertNotIn('certification',request.data.decode())
        a.r._sql.assert_not_called()

    def test_no_fixture_or_readiness_creation_before_source_identity_check(self):
        a=self.bare();a.source=Mock()
        with patch.dict(os.environ,{},clear=True),self.assertRaisesRegex(RuntimeError,'protected_main_project_release_required'):a.prepare()
        a.source.assert_not_called();a.r._auth_admin.assert_not_called();a.r._sql.assert_not_called()

    def test_cleanup_checks_ownership_and_never_deletes_Auth_or_receipts(self):
        a=self.bare();a.retire=Mock();a.r._http.return_value=(204,None)
        a.r._sql.side_effect=[[{'display_name':'Isolated Sandy API service acceptance','google_drive_folder_status':'excluded'}],[],[{'sessions':0,'portal_accounts':0,'banned_fixtures':1}]]
        a.cleanup()
        queries='\n'.join(c.args[0] for c in a.r._sql.call_args_list)
        for forbidden in ['DELETE FROM auth.users','DELETE FROM public.email_customers','DELETE FROM public.sandy_customer_mutation_receipts','DELETE FROM public.sandy_memory_audit','DELETE FROM public.sandy_engineering_change_events']:
            self.assertNotIn(forbidden,queries)
        a.r._auth_admin.assert_called_once_with('PUT','users/fixture-user',{'ban_duration':'876000h'})
        self.assertTrue(a.report['cleanup']['complete'])
        self.assertTrue(a.report['cleanup']['immutable_receipts_and_audit_preserved'])

    def test_unproved_cleanup_ownership_cannot_ban_or_remove_customer(self):
        a=self.bare();a.retire=Mock();a.r._http.return_value=(204,None);a.r._sql.return_value=[{'display_name':'Existing real customer','google_drive_folder_status':'excluded'}]
        with self.assertRaisesRegex(RuntimeError,'fixture_cleanup_ownership_not_proved'):a.cleanup()
        a.r._auth_admin.assert_not_called();self.assertEqual(a.r._sql.call_count,1)

    def test_retirement_records_independent_audit_without_artifact_edit(self):
        a=self.bare();a.retire();a.retire()
        self.assertEqual(a.r._sql.call_count,1)
        query=a.r._sql.call_args.args[0]
        self.assertIn("'memory_private_readiness_revoked',NULL",query)
        self.assertNotIn('UPDATE ',query);self.assertNotIn('DELETE ',query)
        self.assertTrue(a.retired)


if __name__=='__main__':unittest.main()
