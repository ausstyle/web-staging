import json, unittest
from unittest.mock import patch
import release_hosting_accounts as h
class Fake:
    def __init__(self,rows):self.rows=rows;self.calls=[]
    def sql(self,q,read_only=False):self.calls.append((q,read_only));return self.rows
    def api(self,*args):self.calls.append(args);return b'{}'
class BoundaryTests(unittest.TestCase):
    def test_owner_gate_reads_only_and_rejects_missing_audit(self):
        r=Fake([{'admitted':False}])
        with self.assertRaisesRegex(h.Blocked,'genuine_exact_Owner'):h.admission(r)
        self.assertTrue(all(read for _,read in r.calls))
        q=r.calls[0][0]
        for required in [h.PIN,h.SOURCE,"a.role='owner'","e.actor","sandy_engineering_test","supabase:migration:20261024010000"]:self.assertIn(required,q)
    def test_upload_preserves_jwt_and_only_fixed_target(self):
        r=Fake([]);h.upload(r,{'sandy-customer-provisioning-api/index.ts':b'fixture'})
        args=r.calls[0];self.assertEqual(args[1],'/functions/deploy?slug=sandy-customer-provisioning-api');self.assertIn(b'"verify_jwt": true',args[2])
    def test_existing_schema_is_not_replayed(self):
        with self.assertRaisesRegex(h.Blocked,'schema_already_present'):h.empty_schema(Fake([{'clean':False}]))
    def test_unapproved_run_never_reaches_provider_or_migrations(self):
        r=Fake([{'admitted':False}])
        with self.assertRaises(h.Blocked):h.run(r,'deploy')
        self.assertEqual(len(r.calls),1)
    def test_deploy_requires_protected_main(self):
        with patch.dict(h.os.environ,{},clear=True):
            with self.assertRaisesRegex(h.Blocked,'protected_main'):h.protected()
    def test_upload_unknown_outcome_is_never_retried(self):
        r=Fake([])
        with patch.object(r,'api',side_effect=h.Blocked('unknown')) as api:
            with self.assertRaises(h.Blocked):h.upload(r,{})
            self.assertEqual(api.call_count,1)
class LiveVersionTests(unittest.TestCase):
    def test_only_exact_v12_before_and_v13_after_are_accepted(self):
        body=b'synthetic';m={'function':{'expected_prior_version':12,'before_files':{},'after_files':{},'prior_bundle_sha256':h.sha(body)}}
        for version,after,allowed in [(10,False,False),(12,False,True),(13,False,False),(12,True,False),(13,True,True),(14,True,False)]:
            r=Fake([])
            r.api=lambda method,path: json.dumps({'status':'ACTIVE','verify_jwt':True,'version':version}).encode() if not path.endswith('/body') else body
            with patch.object(h,'original_sources',return_value={}):
                if allowed:self.assertEqual(h.inspect(r,m,after)[0]['version'],version)
                else:
                    with self.assertRaises(h.Blocked):h.inspect(r,m,after)

class RecoveryTests(unittest.TestCase):
    def test_missing_recovery_cannot_write(self):
        r=Fake([])
        with patch.object(h,'admission'),patch.object(h,'protected'),patch.object(h,'inspect'):
            with self.assertRaisesRegex(h.Blocked,'recovery_artifact_not_found'):
                h.rollback(r,'10000000-0000-4000-8000-000000000001')
        self.assertTrue(all(read for _,read in r.calls))
    def test_wrong_manifest_recovery_cannot_write(self):
        r=Fake([{'metadata':{'manifest_sha256':'wrong','bundle_transfer_state':'complete'}}])
        with patch.object(h,'admission'),patch.object(h,'protected'),patch.object(h,'inspect'):
            with self.assertRaisesRegex(h.Blocked,'recovery_not_verified'):
                h.rollback(r,'10000000-0000-4000-8000-000000000001')
        self.assertTrue(all(read for _,read in r.calls))

class ExecutionTests(unittest.TestCase):
    def exercise(self, prior=0, upload_error=False):
        r=Fake([]);r.holder='fixture-holder';order=[]
        def sql(q,read_only=False):
            order.append(q)
            if "event_type='hosting_release_intent'" in q:return [{'n':prior}]
            if 'SELECT count(*)::integer held' in q:return [{'held':1}]
            if 'NOT api_exposed' in q:return [{'n':2}]
            return []
        r.sql=sql
        def upload(*a):
            order.append('UPLOAD')
            if upload_error:raise h.Blocked('unknown upload')
        with patch.object(h,'admission'),patch.object(h,'inspect',return_value=({'version':13},b'body',{})),patch.object(h,'empty_schema'),patch.object(h,'protected'),patch.object(h,'verify_ci'),patch.object(h.subprocess,'check_call'),patch.object(h,'store_recovery',side_effect=lambda *a:order.append('BACKUP') or 'fixture-backup'),patch.object(h,'migrations',side_effect=lambda *a:order.append('MIGRATIONS')),patch.object(h,'upload',side_effect=upload):
            try:result=h.run(r,'deploy')
            except h.Blocked as e:result=str(e)
        return result,order
    def test_recovery_and_intent_precede_migrations_and_upload(self):
        result,order=self.exercise()
        self.assertTrue(result['source_verified'])
        self.assertLess(order.index('BACKUP'),order.index('MIGRATIONS'))
        intent=next(i for i,q in enumerate(order) if "VALUES('" in q and "'hosting_release_intent'" in q)
        self.assertLess(intent,order.index('MIGRATIONS'))
        self.assertLess(order.index('MIGRATIONS'),order.index('UPLOAD'))
    def test_prior_intent_blocks_repeated_effects(self):
        result,order=self.exercise(prior=1)
        self.assertIn('prior_dispatch',result)
        self.assertNotIn('MIGRATIONS',order);self.assertNotIn('UPLOAD',order)
    def test_unknown_upload_has_no_second_attempt_or_success_audit(self):
        result,order=self.exercise(upload_error=True)
        self.assertIn('unknown',result);self.assertEqual(order.count('UPLOAD'),1)
        self.assertFalse(any("'hosting_release_source_verified'" in q for q in order))

if __name__=='__main__':unittest.main()
