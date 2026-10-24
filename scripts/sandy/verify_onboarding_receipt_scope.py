#!/usr/bin/env python3
"""Normal MCP identity replay acceptance on fresh isolated, unlinked fixtures.

Management only administers/verifies these fixture records. Each operation under
test uses the actual customer session; no channel verification or merge is made.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import uuid
from customer_service_acceptance import Acceptance,passing_read
from verify_memory_private_mcp import PrivateMemoryAcceptance
from release_gcp_admin_read import Installer
from release_web_canary import ROOT
from release_onboarding_receipt_scope import load,inspect,flags

OPS=['customer.identity.get','customer.onboarding.ensure','customer.onboarding.update']
class IdentityReceiptAcceptance(PrivateMemoryAcceptance):
    def __init__(self,output):
        super().__init__(output);self.receipts=[]
        self.report.update(kind='ordinary_customer_MCP_identity_receipt_scope',verified_channel_records_created=0,customer_merges_performed=0,registry_flags_changed=False)
    def prepare(self):
        source=os.environ.get('GITHUB_SHA','')
        if os.environ.get('GITHUB_ACTIONS')!='true' or os.environ.get('GITHUB_REF')!='refs/heads/main' or not re.fullmatch('[a-f0-9]{40}',source) or subprocess.check_output(['git','rev-parse','HEAD'],cwd=ROOT,text=True).strip()!=source:raise RuntimeError('protected_committed_main_acceptance_required')
        self.report['source_commit']=source;m,_=load();self.admin=Installer(self.output.parent/'source-custody');inspect(self.admin,m,True);self.registry_before=flags(self.admin)
        releases=self.admin.sql("SELECT change_id FROM public.sandy_engineering_change_events WHERE event_type='onboarding_receipt_scope_source_verified' AND detail->>'migration'='20261024004400' ORDER BY id DESC LIMIT 1",True)
        if len(releases)!=1 or {x['operation'] for x in self.registry_before}!=set(OPS):raise RuntimeError('reviewed_existing_onboarding_release_required')
        self.release_change=releases[0]['change_id'];self.report['RPC_source_sha256']=m['candidate_prosrc_sha256']
        Acceptance.prepare(self)
    def ledger(self):
        fixture=self.fixtures[0];q=self.r._quote
        requests=','.join(q(x['request']) for x in self.receipts)
        return self.r._sql("SELECT request_id,operation,input_sha256,encode(sha256(convert_to(result::text,'UTF8')),'hex') result_sha256 FROM public.sandy_customer_onboarding_receipts WHERE actor_id="+q(fixture['user'])+' AND request_id IN('+requests+') ORDER BY request_id',True)
    def exercise(self):
        fixture=self.fixtures[0];q=self.r._quote
        result,payload=self.call(fixture,OPS[0],{},request_id=(rid:=str(uuid.uuid4())));self.check('normal_identity_read',passing_read(result,payload) and payload.get('customer_id')==fixture['customer'])
        self.receipts.append({'operation':OPS[0],'arguments':{},'request':rid})
        args={'display_name':'Isolated Sandy API service acceptance'}
        result,payload=self.call(fixture,OPS[1],args,request_id=(rid:=str(uuid.uuid4())));self.check('fresh_existing_identity_no_duplicate',passing_read(result,payload) and payload.get('created') is False and payload.get('customer_id')==fixture['customer'])
        self.receipts.append({'operation':OPS[1],'arguments':args,'request':rid})
        args={'expected_version':payload['version'],'organisation_name':'Isolated identity replay acceptance'}
        result,payload=self.call(fixture,OPS[2],args,request_id=(rid:=str(uuid.uuid4())));self.check('normal_progressive_onboarding',passing_read(result,payload) and payload.get('phase')=='ready')
        self.receipts.append({'operation':OPS[2],'arguments':args,'request':rid})
        before=self.ledger();self.check('three_actual_immutable_onboarding_receipts',len(before)==3)
        for receipt in self.receipts:
            result,payload=self.call(fixture,receipt['operation'],receipt['arguments'],request_id=receipt['request']);self.check('current_binding_replay_'+receipt['operation'],passing_read(result,payload) and payload.get('reused') is True and payload.get('customer_id')==fixture['customer'])
        # This deletes only this fresh isolated fixture's binding, after proving
        # marker/owner. It never revokes or rebinds any existing customer's account.
        owned=self.r._sql('SELECT c.display_name,c.google_drive_folder_status FROM public.sandy_memory_portal_accounts p JOIN public.email_customers c ON c.id=p.customer_id WHERE p.auth_user_id='+q(fixture['user'])+' AND p.customer_id='+q(fixture['customer']),True)
        self.check('isolated_binding_owner_proved',owned==[{'display_name':'Isolated Sandy API service acceptance','google_drive_folder_status':'excluded'}])
        self.r._sql('DELETE FROM public.sandy_memory_portal_accounts WHERE auth_user_id='+q(fixture['user'])+' AND customer_id='+q(fixture['customer']))
        for receipt in self.receipts:
            result,payload=self.call(fixture,receipt['operation'],receipt['arguments'],request_id=receipt['request']);self.check('absent_binding_receipt_denied_'+receipt['operation'],result.get('api_status')==409 and result.get('error')=='onboarding_required' and result.get('executed') is False and fixture['customer'] not in json.dumps(payload))
        self.check('denials_do_not_rewrite_receipts',self.ledger()==before)
        result,payload=self.call(fixture,OPS[0],{});self.check('fresh_identity_requires_binding',result.get('api_status')==409 and result.get('error')=='onboarding_required')
        result,payload=self.call(fixture,OPS[1],{'display_name':'Isolated Sandy API service acceptance'});self.check('fresh_normal_verified_enrollment_preserved',passing_read(result,payload) and payload.get('created') is False and payload.get('customer_id')==fixture['customer'])
        self.r._sql('UPDATE public.sandy_memory_portal_accounts SET revoked_at=clock_timestamp() WHERE auth_user_id='+q(fixture['user'])+' AND customer_id='+q(fixture['customer']))
        for receipt in self.receipts:
            result,_=self.call(fixture,receipt['operation'],receipt['arguments'],request_id=receipt['request']);self.check('explicit_revocation_receipt_denied_'+receipt['operation'],result.get('api_status')==403 and result.get('error')=='customer_access_revoked')
        result,_=self.call(fixture,OPS[1],{'display_name':'Isolated Sandy API service acceptance'});self.check('fresh_enrollment_cannot_override_explicit_revocation',result.get('api_status')==403 and result.get('error')=='customer_access_revoked')
        self.check('all_original_receipts_preserved',self.ledger()==before);self.report['verified_onboarding_receipts']=before
        self.check('no_permissions_or_registry_flags_changed',flags(self.admin)==self.registry_before)
    def run(self):
        try:self.prepare();self.exercise()
        except Exception as error:
            self.report['runner_error']=type(error).__name__
            if isinstance(error,RuntimeError) and re.fullmatch('[A-Za-z0-9_]+',str(error)):self.report['runner_error_code']=str(error)
        finally:
            try:self.cleanup()
            except Exception as error:self.report['cleanup'].update(complete=False,error_class=type(error).__name__)
        self.report['complete']=not self.report.get('runner_error') and all(c['passed'] for c in self.report['checks']) and self.report['cleanup'].get('complete') is True;self.save()
        if self.report['complete']:
            try:
                m,_=load();inspect(self.admin,m,True)
                self.check('final_existing_contract_and_visibility_preserved',flags(self.admin)==self.registry_before)
                proof_path=self.output.with_name('onboarding-execution-proof.json');proof_path.write_bytes(json.dumps(self.report,indent=2).encode())
                evidence={'surface':'normal_authenticated_MCP_to_existing_onboarding_RPC','source_commit':self.report['source_commit'],'RPC_source_sha256':self.report['RPC_source_sha256'],'report_sha256':hashlib.sha256(proof_path.read_bytes()).hexdigest(),'report_artifact':proof_path.name,'normal_MCP_verified':True,'missing_binding_receipt_denied':True,'revocation_denied':True,'fresh_normal_enrollment_preserved':True,'receipts_immutable':True,'fixture_retirement_verified':True,'customer_merges':0,'verified_channels_created':0,'registry_flags_changed':False,'mismatched_binding_live_tested':False,'mismatched_binding_test_boundary':'isolated_PostgreSQL_only'}
                q=self.r._quote;sql='BEGIN;DO $evidence$ DECLARE n integer;BEGIN '
                for entry in self.registry_before:
                    sql+="UPDATE public.sandy_operation_registry SET last_test_result=coalesce(last_test_result,'{}')||jsonb_build_object('onboarding_receipt_scope_20261024',"+q(json.dumps(evidence))+"::jsonb),last_verified_at=clock_timestamp(),updated_at=clock_timestamp() WHERE operation="+q(entry['operation'])+" AND handler="+q(entry['handler'])+" AND permission_scope="+q(entry['permission_scope'])+" AND error_contract->>'contract_sha256'="+q(entry['contract_sha256'])+''.join(' AND '+k+' IS '+('TRUE' if entry[k] else 'FALSE') for k in ['api_exposed','ai_exposed','verified'])+";GET DIAGNOSTICS n=ROW_COUNT;IF n<>1 THEN RAISE EXCEPTION 'existing onboarding contract drift';END IF;"
                sql+='END $evidence$;'
                sql+="INSERT INTO public.sandy_engineering_change_events(change_id,event_type,actor,detail) VALUES("+q(self.release_change)+",'onboarding_receipt_scope_acceptance_verified',NULL,"+q(json.dumps(evidence))+"::jsonb);COMMIT;"
                self.r._sql(sql)
                self.report['evidence_recorded']=True;self.save()
                # Existing row evidence is updated only after actual normal-session
                # checks and fixture retirement; exposure and grants never change.

            except Exception as error:
                self.report.update(complete=False,evidence_error_class=type(error).__name__);self.save()

        print('::notice title=Onboarding identity replay acceptance::'+json.dumps({'complete':self.report['complete'],'checks':self.report['checks'],'calls':self.report['calls'],'cleanup':self.report['cleanup']}));return self.report['complete']
if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--output',required=True,type=Path);a=p.parse_args();raise SystemExit(0 if IdentityReceiptAcceptance(a.output).run() else 1)
