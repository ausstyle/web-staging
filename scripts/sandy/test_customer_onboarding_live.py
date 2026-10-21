"""Real normal-customer Auth and MCP onboarding tests with bounded fixture cleanup.

Uses Management access for authorized fixture administration and independent
readback only. Actual operations use normal customer JWTs; tokens/passwords are
never persisted. Exposure is enabled only after three direct production handler
checks pass, then the MCP pathway is verified and recorded.
"""
import argparse
import datetime
import hashlib
import json
from pathlib import Path
import secrets
import sys
import uuid
from engineering_runtime import EngineeringRuntime, BASE
from test_engineering_customer_boundary import REVIEWED_TRIGGERS

ROOT = Path(__file__).resolve().parents[2]
OPS = ['customer.onboarding.ensure','customer.onboarding.update','customer.identity.get']

def run(output):
    runtime=EngineeringRuntime();keys=runtime._api_keys();service,anon=keys['service_role'],keys['anon']
    report={'normal_auth_sessions':True,'service_role_substituted_for_user':False,'tests':[],'customers':[], 'cleanup':{},'complete':False}
    users=[];customers=[];tokens=[]
    def save():
        output.parent.mkdir(parents=True,exist_ok=True);output.write_text(json.dumps(report,indent=2)+'\n')
    def check(name,condition,detail=None):
        report['tests'].append({'name':name,'passed':bool(condition),**({} if detail is None else {'detail':detail})});save()
        if not condition:raise RuntimeError('onboarding_live_check_failed:'+name)
    def call(token,op,args,rid=None,mcp=False):
        rid=rid or str(uuid.uuid4())
        if mcp:
            body={'jsonrpc':'2.0','id':rid,'method':'tools/call','params':{'name':op,'arguments':{'__sandy_execution':{'request_id':rid},'arguments':args}}};slug='sandy-api-mcp'
        else:body={'operation':op,'arguments':args,'request_id':rid,'channel':'api'};slug='sandy-customer-provisioning-api'
        status,value=runtime._http('POST',BASE+'/functions/v1/'+slug,token,body,anon)
        if not mcp:return status,value
        result=value.get('result',{});env=json.loads(result.get('content',[{}])[0].get('text','{}'))
        payload=result.get('structuredContent',{})
        return env.get('status',status),payload if result.get('isError') is False else env.get('result',{})
    try:
        rows=runtime._sql("SELECT n.nspname schema_name,c.relname table_name,t.tgname,t.tgenabled,pg_get_triggerdef(t.oid) definition,pg_get_functiondef(t.tgfoid) function_source FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE NOT t.tgisinternal AND (n.nspname='auth' AND c.relname='users' OR n.nspname='public' AND c.relname IN('email_customers','email_customer_addresses','sandy_memory_settings','sandy_memory_portal_accounts')) ORDER BY n.nspname,c.relname,t.tgname",True)
        fields=['schema_name','table_name','tgname','tgenabled','definition','function_source']
        digest=hashlib.sha256(json.dumps(sorted(tuple(x[k] for k in fields) for x in rows),separators=(',',':'),ensure_ascii=False).encode()).hexdigest()
        check('existing_customer_triggers_match_reviewed_safe_fixtures',digest==REVIEWED_TRIGGERS)
        for _ in range(2):
            email='sandy-onboarding-live-'+str(uuid.uuid4())+'@example.invalid';password=secrets.token_urlsafe(42)
            user=runtime._auth_admin('POST','users',{'email':email,'password':password,'email_confirm':True,'user_metadata':{'sandy_api_isolated_session_test':True}});users.append(user['id'])
            status,session=runtime._http('POST',BASE+'/auth/v1/token?grant_type=password',anon,{'email':email,'password':password},anon);password=None
            check('normal_password_auth_'+str(len(users)),status==200 and session.get('user',{}).get('role')=='authenticated')
            tokens.append(session['access_token']);session=None
        check('no_controller_memberships',runtime._sql('SELECT count(*) n FROM public.sandy_controller_admins WHERE auth_user_id IN ('+','.join(runtime._quote(x) for x in users)+')',True)==[{'n':0}])
        status,result=call(tokens[0],OPS[0],{'display_name':'Isolated onboarding verification'})
        check('direct_verified_enrollment',status==200 and result.get('created') is True)
        customer=result['customer_id'];customers.append(customer);report['customers']=customers.copy();save()
        status,result=call(tokens[0],OPS[1],{'expected_version':result['version'],'organisation_name':'Isolated onboarding organisation'})
        check('direct_progressive_onboarding',status==200 and result.get('phase')=='ready');version=result['version']
        status,result=call(tokens[0],OPS[2],{})
        check('direct_canonical_identity',status==200 and result.get('customer_id')==customer and result.get('memory_customer_id')==customer)
        # All installed operations now have genuine production normal-session
        # execution evidence. Only these exact contracts are enabled for MCP tests.
        contracts=json.loads((ROOT/'supabase/functions/sandy-customer-provisioning-api/contracts.json').read_text())
        q='BEGIN;DO $verify$ DECLARE n integer; BEGIN '
        for operation in OPS:
            evidence={'recorded_at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'evidence_level':'actual_production_normal_customer_handler_and_database','mcp_end_to_end_verified':False,'customer_isolation_test_pending':True,'source_commit':'46b678b8b314b2115de93a484daa771fba9a500e'}
            q+="UPDATE public.sandy_operation_registry SET api_exposed=true,ai_exposed=true,verified=true,implementation_state='deployed',last_verified_at=now(),last_test_result=coalesce(last_test_result,'{}'::jsonb)||jsonb_build_object('customer_onboarding_20261021',"+runtime._quote(json.dumps(evidence))+"::jsonb),updated_at=now() WHERE operation="+runtime._quote(operation)+" AND error_contract->>'contract_sha256'="+runtime._quote(contracts[operation]['contract_sha256'])+";GET DIAGNOSTICS n=ROW_COUNT;IF n<>1 THEN RAISE EXCEPTION 'onboarding contract drift';END IF;"
        runtime._sql(q+' END $verify$;COMMIT;')
        status,discovery=runtime._http('POST',BASE+'/functions/v1/sandy-api-mcp',tokens[1],{'jsonrpc':'2.0','id':'onboarding-preportal-discovery','method':'tools/list','params':{}},anon)
        names=[t['name'] for t in discovery.get('result',{}).get('tools',[])]
        check('mcp_preportal_discovery_and_schemas',status==200 and sorted(names)==sorted(OPS) and all(t.get('inputSchema') for t in discovery['result']['tools']))
        status,result=call(tokens[1],OPS[2],{},mcp=True)
        check('second_customer_cannot_read_first_before_enrollment',status==409 and result.get('error')=='onboarding_required')
        rid=str(uuid.uuid4());args={'display_name':'Second isolated onboarding customer'}
        status,result=call(tokens[1],OPS[0],args,rid,True)
        check('mcp_verified_enrollment',status==200 and result.get('created') is True)
        second=result['customer_id'];customers.append(second);report['customers']=customers.copy();save();check('different_customers_remain_isolated',second!=customer)
        status,result=call(tokens[1],OPS[0],args,rid,True)
        check('mcp_idempotent_enrollment',status==200 and result.get('reused') is True and result.get('customer_id')==second)
        status,result=call(tokens[1],OPS[0],{'display_name':'conflicting request'},rid,True)
        check('mcp_idempotency_conflict',status==409 and result.get('error')=='request_id_conflict')
        status,result=call(tokens[0],OPS[2],{},mcp=True)
        check('mcp_identity_propagation',status==200 and result.get('customer_id')==customer and set(c['channel'] for c in result['channels'])=={'email','web','api'})
        status,result=call(tokens[0],OPS[1],{'expected_version':version,'display_name':'Verified progressive profile'},mcp=True)
        check('mcp_progressive_update',status==200 and result.get('display_name')=='Verified progressive profile')
        status,result=call(tokens[0],OPS[1],{'expected_version':1,'display_name':'stale'},mcp=True)
        check('mcp_stale_version_denial',status==409 and result.get('error')=='onboarding_version_conflict')
        status,result=call(tokens[1],OPS[2],{'customer_id':customer},mcp=True)
        check('mcp_cross_customer_selector_denied',status==400)
        runtime._sql('UPDATE public.sandy_memory_portal_accounts SET revoked_at=clock_timestamp() WHERE auth_user_id='+runtime._quote(users[1])+' AND customer_id='+runtime._quote(second))
        status,result=call(tokens[1],OPS[0],args,rid,True)
        check('mcp_revoked_receipt_replay_denied',status==403 and result.get('error')=='customer_access_revoked')
        check('no_automatic_drive_or_learning',runtime._sql('SELECT count(*) n FROM public.email_customers c LEFT JOIN public.sandy_client_drive_provisioning d ON d.customer_id=c.id LEFT JOIN public.sandy_memory_settings m ON m.customer_id=c.id WHERE c.id IN ('+','.join(runtime._quote(x) for x in customers)+") AND (c.google_drive_folder_status<>'excluded' OR d.customer_id IS NOT NULL OR coalesce(m.learning_enabled,false) OR coalesce(m.proactive_enabled,false))",True)==[{'n':0}])
        report['complete']=True
    finally:
        for token in tokens:
            status,_=runtime._http('POST',BASE+'/auth/v1/logout?scope=local',token,{},anon)
            report['cleanup'].setdefault('logout_statuses',[]).append(status)
        if users:
            actors=','.join(runtime._quote(x) for x in users)
            rows=runtime._sql('SELECT customer_id FROM public.sandy_memory_portal_accounts WHERE auth_user_id IN ('+actors+')',True)
            # Enumerate identities created even if a response check failed.
            customers=list(set(customers+[x['customer_id'] for x in rows]));report['customers']=customers
            if customers:
                ids=','.join(runtime._quote(x) for x in customers)
                runtime._sql('BEGIN;DELETE FROM public.sandy_customer_onboarding_receipts WHERE actor_id IN ('+actors+');DELETE FROM public.sandy_memory_portal_accounts WHERE auth_user_id IN ('+actors+');DELETE FROM public.sandy_memory_settings WHERE customer_id IN ('+ids+');DELETE FROM public.email_customer_addresses WHERE customer_id IN ('+ids+');DELETE FROM public.email_customers WHERE id IN ('+ids+');COMMIT;')
            for user in users:runtime._auth_admin('DELETE','users/'+user)
            counts=runtime._sql('SELECT (SELECT count(*) FROM auth.users WHERE id IN ('+actors+')) auth_users,(SELECT count(*) FROM public.sandy_memory_portal_accounts WHERE auth_user_id IN ('+actors+')) portal_accounts,(SELECT count(*) FROM public.sandy_customer_onboarding_receipts WHERE actor_id IN ('+actors+')) receipts',True)[0]
            report['cleanup']['remaining']=counts
            check('fixture_auth_portal_and_receipts_cleaned',all(n==0 for n in counts.values()))
        tokens.clear();save()
    if report['complete']:
        report['passed']=sum(t['passed'] for t in report['tests']);report['failed']=sum(not t['passed'] for t in report['tests']);save()
        digest=hashlib.sha256(output.read_bytes()).hexdigest()
        evidence={'recorded_at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'evidence_level':'actual_normal_customer_MCP_to_Sandy_API_to_application_database','mcp_end_to_end_verified':True,'normal_password_sessions':2,'service_role_substituted_for_user':False,'controller_memberships':0,'tests_passed':report['passed'],'tests_failed':report['failed'],'source_commit':'46b678b8b314b2115de93a484daa771fba9a500e','evidence_sha256':digest,'fixtures_cleaned':True,'automatic_provider_resources_provisioned':0,'scope_limitation':'verified email/web/API identity and existing verified WhatsApp projection; no identity merge or new provider authorization'}
        runtime._sql("UPDATE public.sandy_operation_registry SET last_test_result=last_test_result||jsonb_build_object('customer_onboarding_20261021',"+runtime._quote(json.dumps(evidence))+"::jsonb),last_verified_at=now(),updated_at=now() WHERE operation IN ("+','.join(runtime._quote(x) for x in OPS)+')')
        print(json.dumps({'complete':True,'passed':report['passed'],'failed':report['failed'],'cleanup':report['cleanup']}))

if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--output',type=Path,required=True);run(parser.parse_args().output)
