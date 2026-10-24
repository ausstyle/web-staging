import io
import json
import tempfile
import unittest
import urllib.error
import zipfile
from pathlib import Path
from unittest.mock import Mock,patch
import memory_acceptance_evidence as evidence
import publish_memory_correction as publication
from release_memory_private_correction import load
from release_web_canary import Blocked
from verify_memory_normal_mcp import NormalMemoryAcceptance


def report():
    return {'source_commit':'b'*40,'complete':True,'kind':'private_source_attested_normal_customer_MCP','checks':[{'name':x,'passed':True} for x in sorted(evidence.REQUIRED)],'cleanup':{'complete':True,'sessions':0,'portal_accounts':0,'banned_fixtures':2,'immutable_receipts_and_audit_preserved':True},'readiness_retired':True,'service_key_as_customer':False,'Owner_authority_claimed':False,'global_exposure_changed':False,'verified_mutation_receipts':[{'mutation_id':'00000000-0000-4000-8000-000000000001'},{'mutation_id':'00000000-0000-4000-8000-000000000002'},{'mutation_id':'00000000-0000-4000-8000-000000000003'}],'calls':[{'operation':'memory.fact_correct','response_sha256':'a'*64,'api_status':200,'executed':True},{'operation':'memory.fact_correct','response_sha256':'b'*64,'api_status':403,'is_error':True},{'operation':'memory.fact_correct','response_sha256':'c'*64,'api_status':409,'is_error':True}]}

class Response(io.BytesIO):
    status=200

class EvidenceTests(unittest.TestCase):
    def test_missing_or_self_claimed_proof_is_rejected(self):
        for key,value in [('complete',False),('Owner_authority_claimed',True),('service_key_as_customer',True),('readiness_retired',False),('verified_mutation_receipts',[])]:
            r=report();r[key]=value
            with self.assertRaises(Blocked):evidence.validate_report(r)
        r=report();r['verified_mutation_receipts'][1]=r['verified_mutation_receipts'][0]
        with self.assertRaisesRegex(Blocked,'three_distinct_actual_mutation_receipts_required'):evidence.validate_report(r)
        r=report();r['checks']=[]
        with self.assertRaises(Blocked):evidence.validate_report(r)

    def test_successful_protected_artifact_is_bound_to_source_and_no_token_follows_redirect(self):
        r=report();archive=io.BytesIO()
        with zipfile.ZipFile(archive,'w') as z:z.writestr('normal-customer-MCP.json',json.dumps(r))
        opener=Mock();run={'status':'completed','conclusion':'success','event':'workflow_dispatch','head_branch':'main','path':evidence.WORKFLOW,'head_sha':'b'*40,'repository':{'full_name':evidence.REPO}}
        opener.open.side_effect=[Response(json.dumps(run).encode()),Response(json.dumps({'artifacts':[{'name':'memory-correction-custody-40044186092','expired':False,'id':123}]}).encode()),urllib.error.HTTPError('https://api.github.com',302,'redirect',{'location':'https://productionresultssa1.blob.core.windows.net/protected-fixture'},None),Response(archive.getvalue())]
        actual,provider=evidence.fetch_run_evidence(40044186092,'never-log-token',opener)
        self.assertEqual(actual,r);self.assertEqual(provider['artifact_id'],123)
        self.assertIsNone(opener.open.call_args.args[0].get_header('Authorization'))
        self.assertEqual(len(provider['report_sha256']),64)

    def test_non_main_or_failed_run_cannot_publish_even_if_report_says_success(self):
        for field,value in [('head_branch','feature'),('conclusion','failure'),('event','pull_request')]:
            run={'status':'completed','conclusion':'success','event':'workflow_dispatch','head_branch':'main','path':evidence.WORKFLOW,'head_sha':'b'*40,'repository':{'full_name':evidence.REPO}};run[field]=value
            opener=Mock();opener.open.return_value=Response(json.dumps(run).encode())
            with self.assertRaisesRegex(Blocked,'successful_protected_main_acceptance_required'):evidence.fetch_run_evidence(40044186092,'token',opener)
            self.assertEqual(opener.open.call_count,1)

    def test_arbitrary_artifact_host_is_not_an_authenticated_HTTP_executor(self):
        run={'status':'completed','conclusion':'success','event':'workflow_dispatch','head_branch':'main','path':evidence.WORKFLOW,'head_sha':'b'*40,'repository':{'full_name':evidence.REPO}}
        opener=Mock();opener.open.side_effect=[Response(json.dumps(run).encode()),Response(json.dumps({'artifacts':[{'name':'memory-correction-custody-40044186092','expired':False,'id':123}]}).encode()),urllib.error.HTTPError('https://api.github.com',302,'redirect',{'location':'https://unrelated.invalid/path'},None)]
        with self.assertRaisesRegex(Blocked,'untrusted_GitHub_artifact_location'):evidence.fetch_run_evidence(40044186092,'token',opener)
        self.assertEqual(opener.open.call_count,3)

class PublicationTests(unittest.TestCase):
    def entry(self):
        m,_=load();return m,{'operation':'memory.fact_correct','handler':'sandy-memory-centre','permission_scope':'memory:write','is_mutation':True,'api_exposed':False,'ai_exposed':False,'verified':False,'publication':None,'contract_sha256':m['private_readiness']['contract_sha256'],**m['ordinary_publication_contract']}

    def test_unchanged_hash_does_not_hide_changed_input_or_permission(self):
        for key,value in [('input_schema',{}),('output_schema',{}),('permission_scope','admin:write'),('handler','arbitrary-handler')]:
            m,entry=self.entry();entry[key]=value
            with self.assertRaisesRegex(Blocked,'reviewed_typed_memory_handler_required'):publication.fixed_contract(entry,m)

    def test_preflight_does_not_insert_proof_or_change_flags(self):
        m,entry=self.entry();r=Mock()
        with patch.object(publication,'fetch_run_evidence',return_value=({},{})),patch.object(publication,'verify_private_database',return_value=({},{})),patch.object(publication,'row',return_value=entry),patch.object(publication,'protected_event') as event:
            result=publication.publish(r,m,40044186092,Path('/tmp/unused-memory-publication'),False)
        self.assertEqual(result['mutations'],0);r.sql.assert_not_called();r.upload.assert_not_called();event.assert_not_called()

    def test_failed_ordinary_execution_restores_only_own_flags_and_preserves_receipts(self):
        m,entry=self.entry();r=Mock();r.holder='fixture-lease-holder'
        artifact={'id':'00000000-0000-4000-8000-000000000001','change_id':'00000000-0000-4000-8000-000000000002'}
        proof={'installed_source':{'sandy-operation-api':{'bundle_sha256':'a'*64},'sandy-api-mcp':{'bundle_sha256':'b'*64}}}
        def sql(query,read_only=False):
            if 'count(*)::int held' in query:return [{'held':2}]
            if 'RETURNING operation' in query:return [{'operation':'memory.fact_correct'}]
            return []
        r.sql.side_effect=sql;normal=Mock();normal.run.return_value=False
        with tempfile.TemporaryDirectory() as tmp,patch.object(publication,'fetch_run_evidence',return_value=({}, {'report_sha256':'c'*64})),patch.object(publication,'verify_private_database',return_value=(artifact,proof)),patch.object(publication,'row',return_value=entry),patch.object(publication,'source_check',return_value='d'*40),patch.object(publication,'protected_event',return_value=123),patch.object(publication,'NormalMemoryAcceptance',return_value=normal):
            with self.assertRaisesRegex(Blocked,'ordinary_MCP_acceptance_failed_restore_closed_flags'):publication.publish(r,m,40044186092,Path(tmp)/'publication',True)
        queries='\n'.join(c.args[0] for c in r.sql.call_args_list)
        self.assertIn('SET api_exposed=false,ai_exposed=false,verified=false',queries)
        self.assertIn("last_test_result->'memory_normal_publication'->>'attempt_id'",queries)
        self.assertNotIn('DELETE FROM public.sandy_customer_mutation_receipts',queries)
        self.assertNotIn('DELETE FROM public.sandy_engineering_change_events',queries)
        self.assertNotIn('permission_scope=',queries.split('SET api_exposed=false')[1])
        r.upload.assert_not_called()

    def test_mutable_registry_proof_cannot_replace_protected_event(self):
        m,entry=self.entry();entry.update(api_exposed=True,ai_exposed=True,verified=True,publication={'state':'accepted','normal_proof_event_id':123});r=Mock();r.sql.return_value=[]
        with patch.object(publication,'row',return_value=entry),self.assertRaisesRegex(Blocked,'publication_metadata_cannot_substitute_immutable_proof'):publication.verify_publication_evidence(r,m)

    def test_normal_customer_RPC_uses_no_certification_or_management_header(self):
        a=NormalMemoryAcceptance.__new__(NormalMemoryAcceptance);a.r=Mock();a.keys={'anon':'public-key'};a.readiness=None;fixture={'token':'normal-user-token'}
        a.rpc(fixture,'tools/call',{'name':'memory.fact_correct','arguments':{'confirm':True}})
        args=a.r._http.call_args.args
        self.assertEqual(args[2],'normal-user-token');self.assertEqual(args[4],'public-key')
        self.assertNotIn('certification',json.dumps(args[3]));a.r._opener.open.assert_not_called()

if __name__=='__main__':unittest.main()
