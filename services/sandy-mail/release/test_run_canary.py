import copy
import datetime as dt
import hashlib
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch
import run_canary as r

class CanaryReleaseTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.addCleanup(self.tmp.cleanup)
        self.binary=Path(self.tmp.name)/'fixture';self.binary.write_bytes(b'synthetic test executable bytes')
        self.output=Path(self.tmp.name)/'receipt.json'
        self.now=dt.datetime(2026,10,24,tzinfo=dt.timezone.utc)
        self.m=dict(version=1,project=r.PROJECT,region='us-central1',instance='sandy-mail-canary-us1',connection_name=f'{r.PROJECT}:us-central1:sandy-mail-canary-us1',database='sandy_mail_canary',bucket=r.PROJECT+'-sandy-mail-canary-us1',source_commit='a'*40,binary_sha256=hashlib.sha256(self.binary.read_bytes()).hexdigest(),scope=r.SCOPE,runtime_service_account='sandy-mail-canary@'+r.PROJECT+'.iam.gserviceaccount.com')
        self.o=dict(observed_at=self.now.isoformat(),instance=dict(project=r.PROJECT,name=self.m['instance'],connectionName=self.m['connection_name'],region='us-central1',state='RUNNABLE',databaseVersion='POSTGRES_17',settings=dict(availabilityType='REGIONAL')),database=dict(name=self.m['database'],project=r.PROJECT,instance=self.m['instance']),bucket=dict(name=self.m['bucket'],location='US-CENTRAL1',iamConfiguration=dict(uniformBucketLevelAccess=dict(enabled=True),publicAccessPrevention='enforced'),versioning=dict(enabled=True)),runtime_service_account=self.m['runtime_service_account'],canonical_read_receipt_ids=['mock-sql-read','mock-bucket-read'])
    def result(self):
        return dict(environment='cloudsql-canary',database=self.m['database'],configured_cloudsql_connection=self.m['connection_name'],configured_gcs_bucket=self.m['bucket'],scope=r.SCOPE,external_messages_sent=0,raw_byte_equal=True,message=dict(security_state='quarantined',attachments=[dict(sha256=r.ATTACHMENT_HASH)],receipt=dict(receipt_id='synthetic-mock-receipt',release_ref=self.m['source_commit'],delivery_id='synthetic-first-001',raw=dict(sha256=r.RAW_HASH,size=1101,generation=1),recovery_ledger=dict(generation=2),attachment_count=1)))
    def test_validation_never_claims_authority(self):
        self.assertEqual(r.validate(self.m,self.o,self.binary,self.now),dict(preconditions_validated=True,authorization_granted_by_runner=False,cloud_writes=0))
    def test_rejects_target_drift_and_security_preconditions(self):
        changes=[('m','project','another-project'),('m','database','production'),('m','source_commit','main'),('m','binary_sha256','0'*64),('m','scope',dict(r.SCOPE,Mailbox='other')),('o','observed_at',(self.now-dt.timedelta(hours=1)).isoformat()),('o','database',dict(self.o['database'],instance='other')),('o','canonical_read_receipt_ids',[]),('o','runtime_service_account','other')]
        for target,key,value in changes:
            with self.subTest(target=target,key=key):
                m,o=copy.deepcopy(self.m),copy.deepcopy(self.o)
                (m if target=='m' else o)[key]=value
                with self.assertRaises(r.GateError):r.validate(m,o,self.binary,self.now)
        for change in ('old_pg','zonal','public','no_versioning','wrong_region'):
            with self.subTest(change=change):
                o=copy.deepcopy(self.o)
                if change=='old_pg':o['instance']['databaseVersion']='POSTGRES_16'
                if change=='zonal':o['instance']['settings']['availabilityType']='ZONAL'
                if change=='public':o['bucket']['iamConfiguration']['publicAccessPrevention']='inherited'
                if change=='no_versioning':o['bucket']['versioning']['enabled']=False
                if change=='wrong_region':o['bucket']['location']='EU'
                with self.assertRaises(r.GateError):r.validate(self.m,o,self.binary,self.now)
    def test_rejects_receipt_corruption(self):
        for change in ('source','raw','attachment','quarantine','replay','provider'):
            with self.subTest(change=change):
                v=self.result()
                if change=='source':v['message']['receipt']['release_ref']='b'*40
                if change=='raw':v['message']['receipt']['raw']['sha256']='0'*64
                if change=='attachment':v['message']['attachments'][0]['sha256']='0'*64
                if change=='quarantine':v['message']['security_state']='clean'
                if change=='replay':v['message']['receipt']['receipt_id']='different'
                if change=='provider':v['configured_gcs_bucket']='other'
                with self.assertRaises(r.GateError):r.verify_result(v,self.m,'synthetic-mock-receipt')
    @patch.dict(os.environ,{'MAIL_MIGRATOR_DSN':'test-only-migrator','MAIL_RUNTIME_DSN':'test-only-runtime'})
    def test_fixed_sequence_and_credential_separation(self):
        actions=[]
        def invoke(args,**kw):
            action=args[1];actions.append(action)
            self.assertNotIn('MAIL_MIGRATOR_DSN',kw['env']);self.assertNotIn('MAIL_RUNTIME_DSN',kw['env'])
            expected='test-only-migrator' if action in ('migrate','seed-synthetic') else 'test-only-runtime'
            self.assertEqual(kw['env']['MAIL_DATABASE_DSN'],expected)
            value=self.result()
            if action in ('migrate','seed-synthetic'):value=dict(environment='cloudsql-canary',database=self.m['database'],migration_applied=action=='migrate',synthetic_seeded=action=='seed-synthetic')
            return subprocess.CompletedProcess(args,0,json.dumps(value),'')
        result=r.execute(self.m,self.binary,self.output,invoke)
        self.assertEqual(actions,['migrate','seed-synthetic','ingest','read','ingest','read'])
        self.assertFalse(result['independent_provider_acceptance'])
        self.assertNotIn('test-only-',self.output.read_text())
    @patch.dict(os.environ,{'MAIL_MIGRATOR_DSN':'test-only-migrator','MAIL_RUNTIME_DSN':'test-only-runtime'})
    def test_unknown_writes_stop_without_retry_or_secret_log(self):
        for timeout in (False,True):
            calls=[]
            def invoke(args,**kw):
                calls.append(args)
                if timeout:raise subprocess.TimeoutExpired(args,180,stderr='sensitive-do-not-log')
                return subprocess.CompletedProcess(args,1,'','sensitive-do-not-log')
            with self.assertRaises(r.GateError):r.execute(self.m,self.binary,self.output,invoke)
            self.assertEqual(len(calls),1)
            self.assertEqual(json.loads(self.output.read_text())['state'],'unknown_outcome')
            self.assertNotIn('sensitive-do-not-log',self.output.read_text())

if __name__=='__main__':unittest.main()
