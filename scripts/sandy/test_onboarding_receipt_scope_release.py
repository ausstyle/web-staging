import hashlib
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import Mock,patch
import release_onboarding_receipt_scope as release
from release_web_canary import Blocked
from verify_onboarding_receipt_scope import IdentityReceiptAcceptance

class ReceiptScopeReleaseTests(unittest.TestCase):
    def fixture(self):
        m,raw=release.load();m=json.loads(json.dumps(m));body=b'fixture-application-preimage';m['original_execution_surface']['bundle_sha256']=hashlib.sha256(body).hexdigest()
        row={'oid':'162208','source_sha256':m['before_prosrc_sha256'],'definition':'CREATE OR REPLACE FUNCTION fixture...','prosecdef':True,'proconfig':['search_path=pg_catalog, pg_temp'],'acl':'{postgres=X/postgres,authenticated=X/postgres}','customer':True,'anon':False,'service':False}
        r=Mock();r.holder='fixture-release-holder';r.api.side_effect=[json.dumps({'version':10,'verify_jwt':True,'status':'ACTIVE'}).encode(),body];r.sql.side_effect=[[row],[]]
        return r,m,raw,row
    def test_exact_preimage_readback_is_read_only(self):
        r,m,_,_=self.fixture();release.inspect(r,m)
        self.assertTrue(all(c.args[1] is True for c in r.sql.call_args_list));r.upload.assert_not_called()
    def test_changed_function_or_privileges_stop_before_mutation(self):
        for field,value in [('source_sha256','wrong'),('service',True),('anon',True),('customer',False),('prosecdef',False)]:
            r,m,_,row=self.fixture();row[field]=value
            with self.assertRaisesRegex(Blocked,'onboarding_source_or_privilege_drift'):release.inspect(r,m)
            self.assertTrue(all(c.args[1] is True for c in r.sql.call_args_list));r.upload.assert_not_called()
    def test_installed_history_does_not_trigger_reinstallation(self):
        r,m,_,row=self.fixture();r.sql.side_effect=[[row],[{'version':'20261024004400','statements':['already installed']}]]
        with self.assertRaisesRegex(Blocked,'onboarding_migration_state_requires_reconciliation_no_replay'):release.inspect(r,m)
        self.assertTrue(all(c.args[1] is True for c in r.sql.call_args_list));r.upload.assert_not_called()
    def test_default_preflight_never_writes_or_creates_customer(self):
        r,m,raw,row=self.fixture()
        with patch.object(release,'inspect',return_value=row),patch.object(release,'flags',return_value=[]):result=release.run(r,m,raw)
        self.assertEqual(result['mutations'],0);r.sql.assert_not_called();r.upload.assert_not_called()
    def test_local_source_cannot_execute_protected_release(self):
        with patch.dict(os.environ,{},clear=True),self.assertRaisesRegex(Blocked,'protected_committed_main_release_required'):release.source_check({})
    def test_unknown_migration_outcome_is_not_retried_or_rolled_back_to_vulnerable_source(self):
        r,m,raw,row=self.fixture();r.sql.reset_mock();r.sql.side_effect=None
        def sql(query,read_only=False):
            if 'count(*)::int held' in query:return [{'held':1}]
            if query.startswith('BEGIN;'):raise Blocked('management_request_failed_or_unknown_outcome_no_retry')
            return []
        r.sql.side_effect=sql
        with tempfile.TemporaryDirectory() as tmp,patch.object(release,'inspect',return_value=row),patch.object(release,'flags',return_value=[]),patch.object(release,'source_check',return_value='a'*40),patch.object(release,'track',return_value='00000000-0000-4000-8000-000000000001'):
            r.out=Path(tmp)/'custody'
            with self.assertRaises(Blocked):release.run(r,m,raw,True)
            self.assertTrue((r.out/'before-rpc.json').exists());self.assertTrue(json.loads((r.out/'recovery.json').read_text())['forward_repair_only'])
        queries=[c.args[0] for c in r.sql.call_args_list]
        self.assertEqual(sum(q.startswith('BEGIN;') for q in queries),1)
        self.assertTrue(any('onboarding_receipt_scope_outcome_unknown' in q for q in queries));self.assertFalse(any('DELETE FROM public.sandy_engineering_component_leases' in q for q in queries));r.upload.assert_not_called()

class ReceiptScopeAcceptanceTests(unittest.TestCase):
    def test_normal_MCP_uses_actual_customer_session_without_certification(self):
        a=IdentityReceiptAcceptance.__new__(IdentityReceiptAcceptance);a.r=Mock();a.keys={'anon':'public-key'};a.readiness=None
        a.rpc({'token':'normal-fixture-user-token'},'tools/call',{'name':'customer.identity.get','arguments':{}})
        args=a.r._http.call_args.args;self.assertEqual(args[2],'normal-fixture-user-token');self.assertEqual(args[4],'public-key');self.assertNotIn('certification',json.dumps(args[3]));a.r._opener.open.assert_not_called()
    def test_failed_source_or_cleanup_cannot_mark_registry_evidence_verified(self):
        a=IdentityReceiptAcceptance.__new__(IdentityReceiptAcceptance);a.r=Mock();a.report={'checks':[],'calls':[],'cleanup':{}};a.save=Mock();a.prepare=Mock(side_effect=RuntimeError('source_preimage_failed'));a.exercise=Mock();a.cleanup=Mock()
        self.assertFalse(a.run());a.exercise.assert_not_called();a.r._sql.assert_not_called()

if __name__=='__main__':unittest.main()
