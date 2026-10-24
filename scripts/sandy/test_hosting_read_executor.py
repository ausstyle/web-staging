import base64,copy,gzip,json,unittest
from unittest.mock import patch
from contextlib import ExitStack
import release_hosting_read as x
from release_web_canary import Blocked
CHANGE='11111111-1111-4111-8111-111111111111'
class Fake:
    holder='test-holder'
    def __init__(self):self.queries=[];self.uploads=[];self.states={t:'before' for t in x.TARGETS};self.database='before';self.fail_upload=None;self.prior=False;self.drift_on_upload=False;self.recoveries=[];self.owners=0;self.events=[]
    def sql(self,q,read_only=False):
        self.queries.append((q,read_only))
        if 'AS n FROM' in q:return [{'n':int(self.prior)}]
        if 'SELECT version FROM' in q:return []
        if 'AS admitted' in q:return [{'admitted':True}]
        if 'AS held' in q:return [{'held':len(x.COMPONENTS)}]
        return []
    def upload(self,t,files,verify):
        self.uploads.append(t)
        if self.fail_upload==t:raise Blocked('unknown')
        self.states[t]='candidate' if self.states[t]=='before' else 'restored'
        if self.drift_on_upload:self.states[x.GATEWAY]='foreign'
        return b'{}'
class Tests(unittest.TestCase):
    def harness(self,r):
        stack=ExitStack();self.addCleanup(stack.close)
        m={'functions':{t:{'after_files':x.source_map({'candidate.ts':b'new'}),'prior_bundle_sha256':'a'*64} for t in x.TARGETS},'database':{'prior_contract_records_sha256':'b'*64}}
        def inspect_function(r,m,t):return (r.states[t],{'version':63 if t==x.GATEWAY else 31},b'old',{'old.ts':b'old'})
        def owner(r,c):r.owners+=1
        def store(r,m,c,t,o,rows):r.recoveries.append(t)
        def event(r,c,k,d):
            r.events.append((k,d))
            if k=='dispatch_started':r.prior=True
        def mutate(r,m,c,rows,rollback):r.database='before' if rollback else 'candidate'
        for name,fn in [('owner',owner),('ci',lambda:None),('inspect_function',inspect_function),('contracts',lambda r: r.database),('contract_state',lambda m,rows:rows),('source_file',lambda n:b'pinned'),('build_candidate',lambda *args:{'candidate.ts':b'new'}),('store_recovery',store),('read_recovery',lambda *args:({'old.ts':b'old'},'before')),('event',event),('mutate_contracts',mutate)]:stack.enter_context(patch.object(x,name,fn))
        return m
    def test_forward_stores_both_backups_before_upload_and_verifies(self):
        r=Fake();m=self.harness(r);result=x.execute(r,m,CHANGE,'deploy')
        self.assertEqual(r.uploads,list(x.TARGETS));self.assertEqual(r.recoveries,list(x.TARGETS));self.assertEqual(r.database,'candidate');self.assertGreaterEqual(r.owners,5);self.assertFalse(result['functional_acceptance_passed'])
        self.assertTrue(any('BEGIN;' in q and all(t in q for t in x.COMPONENTS) for q,_ in r.queries))
    def test_unknown_upload_has_no_retry_and_no_migration(self):
        r=Fake();r.fail_upload=x.GATEWAY;m=self.harness(r)
        with self.assertRaises(Blocked):x.execute(r,m,CHANGE,'deploy')
        self.assertEqual(r.uploads,list(x.TARGETS));self.assertEqual(r.database,'before');self.assertTrue(r.prior)
        with self.assertRaises(Blocked):x.execute(r,m,CHANGE,'deploy')
        self.assertEqual(len(r.uploads),2)
    def test_concurrent_runtime_change_stops_second_upload(self):
        r=Fake();r.drift_on_upload=True;m=self.harness(r)
        with self.assertRaisesRegex(Blocked,'concurrent_shared'):x.execute(r,m,CHANGE,'deploy')
        self.assertEqual(r.uploads,[x.PROVIDER]);self.assertEqual(r.database,'before')
    def test_old_or_future_shared_gateway_preimage_is_refused(self):
        for state in ['foreign','candidate','restored']:
            r=Fake();r.states[x.GATEWAY]=state;m=self.harness(r)
            with self.assertRaises(Blocked):x.execute(r,m,CHANGE,'deploy')
            self.assertFalse(r.uploads)
    def test_full_rollback_reverses_functions_and_contracts(self):
        r=Fake();r.states={t:'candidate' for t in x.TARGETS};r.database='candidate';m=self.harness(r)
        x.execute(r,m,CHANGE,'rollback');self.assertEqual(r.uploads,list(reversed(x.TARGETS)));self.assertEqual(r.database,'before');self.assertFalse(r.recoveries)
    def test_partial_forward_rollback_restores_only_changed_function(self):
        r=Fake();r.states[x.PROVIDER]='candidate';m=self.harness(r)
        x.execute(r,m,CHANGE,'rollback');self.assertEqual(r.uploads,[x.PROVIDER]);self.assertEqual(r.database,'before')
    def test_rollback_refuses_foreign_or_already_restored_source(self):
        for state in ['foreign','restored']:
            r=Fake();r.states[x.GATEWAY]=state;m=self.harness(r)
            with self.assertRaises(Blocked):x.execute(r,m,CHANGE,'rollback')
            self.assertFalse(r.uploads)
    def test_no_dispatch_when_owner_denies_or_lease_lost(self):
        for hook in ['owner','lease']:
            r=Fake();m=self.harness(r)
            with patch.object(x,hook,side_effect=Blocked('denied')):
                with self.assertRaises(Blocked):x.execute(r,m,CHANGE,'deploy')
            self.assertFalse(r.uploads)
    def test_recovery_failure_cannot_upload(self):
        r=Fake();m=self.harness(r)
        with patch.object(x,'store_recovery',side_effect=Blocked('incomplete')):
            with self.assertRaises(Blocked):x.execute(r,m,CHANGE,'deploy')
        self.assertFalse(r.uploads);self.assertFalse(r.prior)
    def test_owner_gate_is_read_only_exact_and_bounded(self):
        r=Fake();x.owner(r,CHANGE);q,readonly=r.queries[-1]
        self.assertTrue(readonly)
        for value in [x.SOURCE,x.PIN,*x.TARGETS,x.MIGRATION,"interval '24 hours'","a.role='owner'","sandy_engineering_test","bounded source and contract rollback"]:self.assertIn(value,q)
        with patch.object(r,'sql',return_value=[{'admitted':False}]):
            with self.assertRaises(Blocked):x.owner(r,CHANGE)
    def test_ci_requires_all_latest_successful_exact_head_checks(self):
        rows=[{'id':i,'name':n,'head_sha':x.SOURCE,'status':'completed','conclusion':'success'} for i,n in enumerate(x.CHECKS)]
        x.verify_ci(rows,x.SOURCE,x.CHECKS)
        for changed in [rows[:-1],[{**r,'head_sha':'0'*40} for r in rows],rows+[{**rows[0],'id':999,'conclusion':'failure'}]]:
            with self.assertRaises(Blocked):x.verify_ci(changed,x.SOURCE,x.CHECKS)
    def test_manifest_tampering_is_refused(self):
        for m in [{},{'source_commit':x.SOURCE},{'functions':{x.GATEWAY:{'expected_prior_version':61}}}]:
            with self.assertRaises(Blocked):x.validate_manifest(m)
    def test_contract_classification_requires_full_preimage_not_only_hash(self):
        old=[{'operation':op,'input_schema':{'properties':{}},'error_contract':{'contract_sha256':'a'*64,'other':'preserve'}} for op in sorted(x.NEW_HASHES)]
        m={'database':{'prior_contract_records_sha256':x.sha(x.canonical(old)),'prior_contract_hashes':{op:'a'*64 for op in x.NEW_HASHES}}}
        self.assertEqual(x.contract_state(m,old),'before');new=copy.deepcopy(old)
        for row in new:
            row['error_contract']['contract_sha256']=x.NEW_HASHES[row['operation']]
            if row['operation'].endswith('.list'):row['input_schema']['properties']['region']={'enum':['europe-west1','europe-west8'],'type':'string'}
        self.assertEqual(x.contract_state(m,new),'candidate');new[0]['error_contract']['other']='foreign';self.assertEqual(x.contract_state(m,new),'foreign')
    def test_private_recovery_rejects_incomplete_corrupt_or_duplicate_artifacts(self):
        body=b'original bundle';packed=gzip.compress(body);files={'original.ts':b'original'}
        m={'functions':{x.PROVIDER:{'prior_bundle_sha256':x.sha(body),'before_files':x.source_map(files)}}}
        valid={'metadata':{'bundle_gzip_base64':base64.b64encode(packed).decode(),'compressed_sha256':x.sha(packed),'prior_contract_records':'before'}}
        with patch.object(x,'original_sources',return_value=files),patch.object(x,'contract_state',return_value='before'):
            r=Fake()
            with patch.object(r,'sql',return_value=[valid]):self.assertEqual(x.read_recovery(r,m,CHANGE,x.PROVIDER)[0],files)
            corrupted=copy.deepcopy(valid);corrupted['metadata']['compressed_sha256']='0'*64
            for rows in [[],[valid,valid],[corrupted]]:
                with patch.object(r,'sql',return_value=rows):
                    with self.assertRaises(Blocked):x.read_recovery(r,m,CHANGE,x.PROVIDER)
        r=Fake()
        with patch.object(r,'sql',return_value=[{'id':'existing'}]):
            with self.assertRaisesRegex(Blocked,'existing_recovery'):x.store_recovery(r,m,CHANGE,x.PROVIDER,('before',{'version':32},body,files),[])
    def test_source_inspection_rejects_identical_bytes_at_unreviewed_version(self):
        body=b'bundle';files={'original.ts':b'original'}
        m={'functions':{x.GATEWAY:{'expected_prior_version':65,'prior_bundle_sha256':x.sha(body),'before_files':x.source_map(files),'after_files':x.source_map({'new.ts':b'new'})}}}
        class R:
            version=65
            def api(self,method,path):return body if path.endswith('/body') else json.dumps({'version':self.version,'status':'ACTIVE','verify_jwt':True,'slug':x.GATEWAY}).encode()
        r=R()
        with patch.object(x,'original_sources',return_value=files):
            self.assertEqual(x.inspect_function(r,m,x.GATEWAY)[0],'before')
            for version in [61,62,63,64,66,68]:
                r.version=version;self.assertEqual(x.inspect_function(r,m,x.GATEWAY)[0],'foreign')
            r.version=67;self.assertEqual(x.inspect_function(r,m,x.GATEWAY)[0],'restored')
    def test_capture_real_baseline_versions_are_32_and_65(self):
        self.assertEqual(x.BASELINES[x.PROVIDER][0],32);self.assertEqual(x.BASELINES[x.GATEWAY][0],65)
if __name__=='__main__':unittest.main()
