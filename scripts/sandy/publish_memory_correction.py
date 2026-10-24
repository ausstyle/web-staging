#!/usr/bin/env python3
"""Publish one already verified existing operation, then test ordinary customer MCP.

Protected project release quality state only; no customer/Owner authority, grant,
provider permission, handler or schema changes. Default is read-only preflight.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import uuid
from release_gcp_admin_read import Installer,quote
from release_web_canary import Blocked,ROOT,private_write
from release_memory_private_correction import load,functions,schema_components
from memory_acceptance_evidence import fetch_run_evidence
from verify_memory_normal_mcp import NormalMemoryAcceptance

OP='memory.fact_correct'

def sha(value):return hashlib.sha256(value).hexdigest()
def uuid_text(value):return str(uuid.UUID(value))
def row(r):
    rows=r.sql("SELECT operation,handler,permission_scope,is_mutation,input_schema,output_schema,api_exposed,ai_exposed,verified,error_contract->>'contract_sha256' contract_sha256,last_test_result->'memory_normal_publication' publication FROM public.sandy_operation_registry WHERE operation='memory.fact_correct'",True)
    if len(rows)!=1:raise Blocked('one_existing_memory_operation_required')
    return rows[0]

def fixed_contract(entry,m):
    if (entry['operation']!=OP or entry['handler']!='sandy-memory-centre' or entry['permission_scope']!='memory:write'
        or entry['is_mutation'] is not True or entry['contract_sha256']!=m['private_readiness']['contract_sha256']
        or entry['input_schema']!=m['ordinary_publication_contract']['input_schema'] or entry['output_schema']!=m['ordinary_publication_contract']['output_schema']):raise Blocked('reviewed_typed_memory_handler_required')

def verify_private_database(r,m,report,provider):
    observed=functions(r,m,True);schema_components(r,m,True)
    for slug,(meta,body,_) in observed.items():
        observed_proof=report['installed_source'][slug]
        if observed_proof!={'deployment_id':'zmqlyygzqoidkcwdysok_'+meta['id']+'_'+str(meta['version']),'bundle_sha256':sha(body),'version':meta['version']}:raise Blocked('actual_deployment_must_equal_private_execution_proof')
    artifact=uuid_text(report['readiness_id']);actor=uuid_text(report['fixture_user_ids'][0]);customer=uuid_text(report['fixture_customer_ids'][0]);q=quote
    artifacts=r.sql("SELECT a.id,a.change_id,a.metadata,encode(sha256(convert_to(to_jsonb(a)::text,'UTF8')),'hex') sha FROM public.sandy_engineering_artifacts a WHERE a.id="+q(artifact)+" AND artifact_type='configuration' AND target='memory.fact_correct' AND rollback_strategy='manual_review' AND metadata->>'kind'='runtime_private_certification'",True)
    if len(artifacts)!=1:raise Blocked('original_bound_private_artifact_required')
    a=artifacts[0];metadata=a['metadata']
    if metadata.get('release_commit')!=provider['run_source_commit'] or metadata.get('fixture_user_id')!=actor or metadata.get('fixture_customer_id')!=customer or metadata.get('contract_sha256')!=m['private_readiness']['contract_sha256']:raise Blocked('private_fixture_source_contract_mismatch')
    audits=r.sql("SELECT id,event_type,detail FROM public.sandy_engineering_change_events WHERE change_id="+q(a['change_id'])+" AND actor IS NULL AND detail->>'artifact_id'="+q(artifact)+" AND event_type IN('memory_private_readiness_installed','memory_private_readiness_revoked') ORDER BY id",True)
    if not any(x['event_type']=='memory_private_readiness_installed' and x['detail'].get('artifact_sha256')==a['sha'] for x in audits) or not any(x['event_type']=='memory_private_readiness_revoked' for x in audits):raise Blocked('immutable_independent_install_and_retirement_required')
    receipts=[]
    for receipt in report['verified_mutation_receipts']:
        mutation=uuid_text(receipt['mutation_id'])
        rows=r.sql("SELECT mutation_id,auth_user_id,customer_id,operation,arguments_sha256,encode(sha256(convert_to(result::text,'UTF8')),'hex') result_sha256 FROM public.sandy_customer_mutation_receipts WHERE mutation_id="+q(mutation),True)
        if rows!=[receipt] or receipt['auth_user_id']!=actor or receipt['customer_id']!=customer or receipt['operation']!=OP:raise Blocked('actual_atomic_receipt_must_match_protected_MCP_report')
        receipts.append(receipt)
    users=','.join(q(uuid_text(x)) for x in report['fixture_user_ids'])
    retirement=r.sql('SELECT (SELECT count(*) FROM auth.users WHERE id IN('+users+') AND banned_until>clock_timestamp()) banned,(SELECT count(*) FROM auth.sessions WHERE user_id IN('+users+')) sessions,(SELECT count(*) FROM auth.refresh_tokens WHERE user_id IN('+users+')) refresh_tokens,(SELECT count(*) FROM public.sandy_memory_portal_accounts WHERE auth_user_id IN('+users+')) portals',True)
    if retirement!=[{'banned':2,'sessions':0,'refresh_tokens':0,'portals':0}]:raise Blocked('all_private_fixture_sessions_must_be_retired')
    return a,{'schema_version':1,'operation':OP,**provider,'artifact_id':artifact,'fixture_user_id':actor,'fixture_customer_id':customer,'contract_sha256':m['private_readiness']['contract_sha256'],'installed_source':report['installed_source'],'MCP_response_sha256s':[x['response_sha256'] for x in report['calls']],'mutation_receipts':receipts,'provider_readback_verified':True,'foreign_and_scope_denials_verified':True,'idempotency_verified':True,'revocation_verified':True,'fixture_retirement_verified':True}

def protected_event(r,artifact,detail):
    payload={'artifact_id':artifact['id'],'reason':'Private quality allowance remains revoked; protected source-linked execution evidence recorded.',**detail}
    rows=r.sql("INSERT INTO public.sandy_engineering_change_events(change_id,event_type,actor,detail) VALUES("+quote(artifact['change_id'])+",'memory_private_readiness_revoked',NULL,"+quote(json.dumps(payload))+"::jsonb) RETURNING id,occurred_at")
    if len(rows)!=1:raise Blocked('independent_immutable_proof_event_required')
    return rows[0]['id']

def source_check():
    source=os.environ.get('GITHUB_SHA','')
    if os.environ.get('GITHUB_ACTIONS')!='true' or os.environ.get('GITHUB_REF')!='refs/heads/main' or not re.fullmatch('[a-f0-9]{40}',source) or subprocess.check_output(['git','rev-parse','HEAD'],cwd=ROOT,text=True).strip()!=source:raise Blocked('protected_committed_main_publication_required')
    manifest='docs/sandy-engineering/evaluations/memory-correction-adapter-release.json'
    if subprocess.check_output(['git','show',source+':'+manifest],cwd=ROOT)!=(ROOT/manifest).read_bytes():raise Blocked('reviewed_publication_manifest_required')
    for name in ['engineering_runtime.py','test_engineering_customer_boundary.py','release_web_canary.py','release_gcp_admin_read.py','publish_memory_correction.py','memory_acceptance_evidence.py','verify_memory_normal_mcp.py','verify_memory_private_mcp.py','release_memory_private_correction.py','customer_service_acceptance.py']:
        path='scripts/sandy/'+name
        if subprocess.check_output(['git','show',source+':'+path],cwd=ROOT)!=(ROOT/path).read_bytes():raise Blocked('reviewed_publication_source_required')
    return source

def verify_published_schema(r,m):
    """Ordinary accepted state for IAP composition; private schema() stays closed."""
    schema_components(r,m,True)
    return verify_publication_evidence(r,m)

def verify_publication_evidence(r,m):
    """Compose with another reviewed release's own source/schema validation."""
    entry=row(r);fixed_contract(entry,m);proof=entry.get('publication')
    if any(entry[k] is not True for k in ('api_exposed','ai_exposed','verified')) or not isinstance(proof,dict) or proof.get('state')!='accepted':raise Blocked('normal_memory_publication_acceptance_required')
    event_id=proof.get('normal_proof_event_id')
    if not isinstance(event_id,int):raise Blocked('immutable_normal_memory_proof_required')
    events=r.sql("SELECT detail FROM public.sandy_engineering_change_events WHERE id="+str(event_id)+" AND event_type='memory_private_readiness_revoked' AND actor IS NULL",True)
    expected={k:v for k,v in proof.items() if k!='normal_proof_event_id'}
    if len(events)!=1 or events[0]['detail'].get('memory_normal_publication')!=expected:raise Blocked('publication_metadata_cannot_substitute_immutable_proof')
    private_id=proof.get('private_proof_event_id')
    if not isinstance(private_id,int) or not r.sql("SELECT id FROM public.sandy_engineering_change_events WHERE id="+str(private_id)+" AND event_type='memory_private_readiness_revoked' AND actor IS NULL AND detail->'memory_private_MCP_proof'->>'report_sha256'="+quote(proof['private_report_sha256']),True):raise Blocked('immutable_private_execution_proof_required')
    if proof.get('normal_customer_MCP_verified') is not True or proof.get('private_header_used') is not False or proof.get('fixture_retirement_verified') is not True or len(proof.get('ordinary_receipt_ids',[]))!=3 or len(set(proof.get('ordinary_receipt_ids',[])))!=3:raise Blocked('ordinary_no_header_MCP_verification_required')
    receipts=','.join(quote(uuid_text(x)) for x in proof['ordinary_receipt_ids']);users=','.join(quote(uuid_text(x)) for x in proof.get('ordinary_fixture_user_ids',[]))
    if len(proof.get('ordinary_fixture_user_ids',[]))!=2 or len(set(proof['ordinary_fixture_user_ids']))!=2:raise Blocked('ordinary_fixture_retirement_required')
    if r.sql('SELECT count(*)::int n FROM public.sandy_customer_mutation_receipts WHERE mutation_id IN('+receipts+') AND auth_user_id IN('+users+') AND operation='+quote(OP),True)!=[{'n':3}]:raise Blocked('ordinary_actual_provider_receipts_required')
    retirement=r.sql('SELECT (SELECT count(*) FROM auth.users WHERE id IN('+users+') AND banned_until>clock_timestamp()) banned,(SELECT count(*) FROM auth.sessions WHERE user_id IN('+users+')) sessions,(SELECT count(*) FROM public.sandy_memory_portal_accounts WHERE auth_user_id IN('+users+')) portals',True)
    if retirement!=[{'banned':2,'sessions':0,'portals':0}]:raise Blocked('ordinary_fixture_sessions_not_retired')
    return proof

def publish(r,m,run_id,out,mutate=False):
    report,provider=fetch_run_evidence(run_id);artifact,proof=verify_private_database(r,m,report,provider);entry=row(r);fixed_contract(entry,m)
    if any(entry[k] is not False for k in ('api_exposed','ai_exposed','verified')):raise Blocked('existing_publication_requires_independent_readback_no_replay')
    if not mutate:return {'preflight_passed':True,'private_proof_verified':True,'mutations':0}
    source=source_check();out.mkdir(parents=True,exist_ok=False,mode=0o700);private_write(out,'private-proof.json',json.dumps(proof,indent=2).encode());private_write(out,'publication-before.json',json.dumps(entry).encode())
    private_event=protected_event(r,artifact,{'memory_private_MCP_proof':proof});attempt=str(uuid.uuid4());state={'state':'pending_ordinary_acceptance','attempt_id':attempt,'source_commit':source,'private_proof_event_id':private_event,'private_report_sha256':provider['report_sha256'],'contract_sha256':entry['contract_sha256'],'installed_source':proof['installed_source']}
    lease='BEGIN;'
    for slug,observed in proof['installed_source'].items():
        lease+=f"DO $$ BEGIN INSERT INTO public.sandy_engineering_component_leases(component,holder,change_id,expected_source_sha256,expires_at) VALUES('{slug}',{quote(r.holder)},{quote(artifact['change_id'])},{quote(observed['bundle_sha256'])},clock_timestamp()+interval '15 minutes') ON CONFLICT(component) DO UPDATE SET holder=EXCLUDED.holder,change_id=EXCLUDED.change_id,expected_source_sha256=EXCLUDED.expected_source_sha256,expires_at=EXCLUDED.expires_at,acquired_at=clock_timestamp() WHERE public.sandy_engineering_component_leases.expires_at<=clock_timestamp();IF NOT FOUND THEN RAISE EXCEPTION 'component already leased';END IF;END $$;"
    r.sql(lease+'COMMIT;')
    changed=False;accepted=False
    try:
        verify_private_database(r,m,report,provider)
        if r.sql('SELECT count(*)::int held FROM public.sandy_engineering_component_leases WHERE holder='+quote(r.holder)+' AND change_id='+quote(artifact['change_id'])+' AND expires_at>clock_timestamp()',True)!=[{'held':2}]:raise Blocked('publication_component_lease_lost')
        changed=True
        rows=r.sql("UPDATE public.sandy_operation_registry SET api_exposed=true,ai_exposed=true,verified=true,last_test_result=coalesce(last_test_result,'{}')||jsonb_build_object('memory_normal_publication',"+quote(json.dumps(state))+"::jsonb),updated_at=clock_timestamp() WHERE operation='memory.fact_correct' AND handler='sandy-memory-centre' AND permission_scope='memory:write' AND is_mutation AND NOT api_exposed AND NOT ai_exposed AND NOT verified AND error_contract->>'contract_sha256'="+quote(entry['contract_sha256'])+" AND input_schema="+quote(json.dumps(entry['input_schema']))+"::jsonb AND output_schema="+quote(json.dumps(entry['output_schema']))+"::jsonb RETURNING operation")
        if rows!=[{'operation':OP}]:raise Blocked('single_reviewed_registry_row_compare_and_swap_required')
        normal=NormalMemoryAcceptance(out/'ordinary-normal-MCP.json');ok=normal.run()
        if not ok:raise Blocked('ordinary_MCP_acceptance_failed_restore_closed_flags')
        ordinary=normal.report
        state.update(state='accepted',ordinary_report_sha256=sha((out/'ordinary-normal-MCP.json').read_bytes()),normal_customer_MCP_verified=True,private_header_used=False,ordinary_receipt_ids=[x['mutation_id'] for x in ordinary['verified_mutation_receipts']],ordinary_fixture_user_ids=ordinary['fixture_user_ids'],fixture_retirement_verified=ordinary['cleanup']['complete'])
        event=protected_event(r,artifact,{'memory_normal_publication':state});state['normal_proof_event_id']=event
        rows=r.sql("UPDATE public.sandy_operation_registry SET last_verified_at=clock_timestamp(),last_test_result=coalesce(last_test_result,'{}')||jsonb_build_object('memory_normal_publication',"+quote(json.dumps(state))+"::jsonb),updated_at=clock_timestamp() WHERE operation='memory.fact_correct' AND last_test_result->'memory_normal_publication'->>'attempt_id'="+quote(attempt)+" AND api_exposed AND ai_exposed AND verified RETURNING operation")
        if rows!=[{'operation':OP}]:raise Blocked('publication_evidence_compare_and_swap_failed')
        verify_published_schema(r,m);accepted=True
        return {'accepted':True,'operation':OP,'normal_proof_event_id':event,'private_proof_event_id':private_event,'ordinary_MCP_without_private_header':True,'handler_or_permissions_changed':False,'functions_redeployed':0}
    finally:
        if changed and not accepted:
            # Restore only this attempt's three publication flags. Never erase a
            # receipt, immutable proof, prior evidence or provider effect.
            r.sql("UPDATE public.sandy_operation_registry SET api_exposed=false,ai_exposed=false,verified=false,last_test_result=jsonb_set(coalesce(last_test_result,'{}'),'{memory_normal_publication,state}','\"rolled_back_after_failed_ordinary_acceptance\"'),updated_at=clock_timestamp() WHERE operation='memory.fact_correct' AND last_test_result->'memory_normal_publication'->>'attempt_id'="+quote(attempt))
        r.sql('DELETE FROM public.sandy_engineering_component_leases WHERE holder='+quote(r.holder)+' AND change_id='+quote(artifact['change_id']))


def main():
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--acceptance-run-id');p.add_argument('--publish',action='store_true');p.add_argument('--verify-existing',action='store_true');p.add_argument('--evidence-dir',required=True,type=Path);a=p.parse_args()
    if a.publish and a.verify_existing:p.error('choose publication or independent readback')
    if not a.verify_existing and not a.acceptance_run_id:p.error('exact successful private acceptance run required')
    r=Installer(a.evidence_dir/'private-source-custody');result={'passed':False}
    try:
        m,_=load()
        if a.verify_existing:functions(r,m,True);verify_published_schema(r,m);result.update(ordinary_publication_verified=True,mutations=0)
        else:result.update(publish(r,m,a.acceptance_run_id,a.evidence_dir/'publication',a.publish))
        result['passed']=True
    except Exception as error:result.update(error=str(error) if isinstance(error,Blocked) else 'publication_failed_or_unknown_reconcile_before_retry',automatic_retry=False,last_management_request=r.last_request)
    a.evidence_dir.mkdir(parents=True,exist_ok=True);private_write(a.evidence_dir,'redacted-receipt.json',json.dumps(result,indent=2).encode());print('::notice title=Ordinary memory correction publication::'+json.dumps(result));return 0 if result['passed'] else 1
if __name__=='__main__':raise SystemExit(main())
