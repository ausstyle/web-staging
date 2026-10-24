#!/usr/bin/env python3
"""Read-only fixture reconciliation for run40054539774; optional append-only evidence.

Never deploys, creates fixtures, repeats mutations, deletes data or edits event246.
Fixed identities come from readiness243, onboarding receipts and Storage delete logs.
"""
import argparse,datetime,hashlib,json,urllib.error,urllib.request
from pathlib import Path
from engineering_runtime import EngineeringRuntime,BASE
from verify_customer_mutation_private_mcp import storage_object_absent
ARTIFACT='41ac8a78-a69f-48c3-9864-08a6cbaa1047'
NONCE='a811dfef3c84402fa1c8cdc020813517'
FIXTURES=[('2e96b3f4-4b04-4197-9428-1fad91d5bf6d','4dfd8095-8dc9-40fe-ad9d-f16d71f1295c'),('a23d5660-07ec-46fd-807f-f1ec61d0f472','5430f32f-36c0-41ec-95ad-13eba8cc96e3')]
REPORT_SHA='43a94bd777ecd4f3a65330d7520aa31e0480695e6faf7f2042a0faf2ab244bcc'
def require(value,code):
    if not value:raise RuntimeError(code)
def reconcile(r):
    q=r._quote
    rows=r._sql("SELECT change_id,detail FROM public.sandy_engineering_change_events WHERE id=246 AND event_type='customer_mutation_private_readiness_revoked'",True)
    require(len(rows)==1,'original_proof_missing');row=rows[0];p=row['detail']['customer_mutation_MCP_proof']
    require(row['detail']['artifact_id']==ARTIFACT and p['report_sha256']==REPORT_SHA and p['state']=='partial' and not p['failed_checks'] and p['runner_error'] is None,'original_proof_not_cleanup_only')
    require(p['normal_customer_MCP'] is True and p['global_flags_changed'] is False and len(p['operation_field_evidence'])==23 and len(p['literal_task_analysis_queue'])==1 and p['literal_task_analysis_queue'][0]['state']=='complete','original_functional_evidence_incomplete')
    expected=p['mutation_receipt_ids'];require(len(expected)==len(set(expected))==23,'original_receipts_invalid')
    ids=','.join(q(x) for x in expected)
    receipts=r._sql("SELECT mutation_id,operation FROM public.sandy_customer_mutation_receipts WHERE mutation_id IN("+ids+") AND customer_id="+q(FIXTURES[0][0])+" AND auth_user_id="+q(FIXTURES[0][1]),True)
    require({x['mutation_id'] for x in receipts}==set(expected) and len({x['operation'] for x in receipts})==10,'immutable_receipts_missing')
    retired=r._sql("SELECT id FROM public.sandy_engineering_change_events WHERE id=245 AND event_type='customer_mutation_private_readiness_revoked' AND detail->>'artifact_id'="+q(ARTIFACT),True)
    require(len(retired)==1,'readiness_not_retired')
    evidence={'observed_at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'original_run_id':40054539774,'original_proof_event_id':246,'original_report_sha256':REPORT_SHA,'artifact_id':ARTIFACT,'receipt_count':23,'operation_count':10,'fixtures':[],'effects_repeated':0,'deletions':0,'deployments':0,'global_flags_changed':False,'original_partial_event_preserved':True}
    keys=r._api_keys()
    for customer,user in FIXTURES:
        ownership=r._sql("SELECT c.id FROM public.email_customers c JOIN public.sandy_customer_onboarding_receipts o ON o.result->>'customer_id'=c.id::text WHERE c.id="+q(customer)+" AND c.display_name='Isolated Sandy API service acceptance' AND c.google_drive_folder_status='excluded' AND o.actor_id="+q(user),True)
        require(len(ownership)==1,'fixture_ownership_not_proven')
        count_sql=[]
        for table,col in [('sandy_tasks','customer_id'),('sandy_calendar_events','customer_id'),('sandy_universal_files','owner_customer_id'),('sandy_task_analysis_queue','customer_id'),('sandy_agenda_categories','customer_id'),('sandy_agenda_companies','customer_id'),('sandy_task_pins','customer_id'),('sandy_timezone_profiles','customer_id'),('sandy_agenda_access','customer_id'),('email_ai_profile_facts','customer_id')]:
            count_sql.append('(SELECT count(*) FROM public.'+table+' WHERE '+col+'='+q(customer)+') AS '+table)
        counts=r._sql('SELECT '+','.join(count_sql),True)[0]
        account=r._sql("SELECT banned_until>clock_timestamp() banned,(SELECT count(*) FROM auth.sessions WHERE user_id=u.id) sessions,(SELECT count(*) FROM auth.refresh_tokens WHERE user_id=u.id::text) refresh_tokens,(SELECT count(*) FROM public.sandy_memory_portal_accounts WHERE auth_user_id=u.id) portal_accounts FROM auth.users u WHERE id="+q(user),True)
        require(not any(counts.values()) and account==[{'banned':True,'sessions':0,'refresh_tokens':0,'portal_accounts':0}],'fixture_residuals_present')
        path='customer_mutation_fixtures/'+customer+'/'+NONCE+'.docx'
        objects=r._sql("SELECT count(*) n FROM storage.objects WHERE bucket_id='sandy-task-artifacts' AND name="+q(path),True)
        require(objects==[{'n':0}],'storage_row_present')
        request=urllib.request.Request(BASE+'/storage/v1/object/authenticated/sandy-task-artifacts/'+path,headers={'authorization':'Bearer '+keys['service_role'],'apikey':keys['service_role'],'cache-control':'no-cache'})
        try:response=r._opener.open(request,timeout=30)
        except urllib.error.HTTPError as error:response=error
        with response:status=response.status;payload=response.read(4097)
        require(len(payload)<=4096 and storage_object_absent(status,payload),'provider_object_absence_unverified')
        evidence['fixtures'].append({'customer_id':customer,'user_id':user,'residual_counts':counts,'account':account[0],'storage_rows':0,'storage_http_status':status,'storage_response_sha256':hashlib.sha256(payload).hexdigest(),'provider_object_absent':True})
    evidence['cleanup_complete']=True
    evidence['state']='finite_acceptance_reconciled'
    evidence['scope']='Original ten local customer mutations only; not full Runtime acceptance, external calendar writes, file bytes or nonliteral model enrichment'
    return row['change_id'],evidence

def main():
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--output',type=Path,required=True);parser.add_argument('--record',action='store_true');args=parser.parse_args()
    r=EngineeringRuntime();change,evidence=reconcile(r)
    args.output.write_text(json.dumps(evidence,indent=2)+'\n')
    if args.record:
        # Serialize duplicate evidence writes without altering the original proof.
        q=r._quote
        result=r._sql("BEGIN;SELECT pg_advisory_xact_lock(246,400545);INSERT INTO public.sandy_engineering_change_events(change_id,event_type,actor,detail) SELECT "+q(change)+",'customer_mutation_cleanup_reconciled',NULL,"+q(json.dumps(evidence))+"::jsonb WHERE NOT EXISTS(SELECT 1 FROM public.sandy_engineering_change_events WHERE event_type='customer_mutation_cleanup_reconciled' AND detail->>'original_proof_event_id'='246');COMMIT;SELECT id FROM public.sandy_engineering_change_events WHERE event_type='customer_mutation_cleanup_reconciled' AND detail->>'original_proof_event_id'='246'")
        require(len(result)==1,'reconciliation_evidence_not_recorded');print(json.dumps({'reconciliation_event_id':result[0]['id'],'cleanup_complete':True,'effects_repeated':0}))
    else:print(json.dumps({'cleanup_complete':True,'evidence_written':str(args.output),'effects_repeated':0}))
if __name__=='__main__':main()
