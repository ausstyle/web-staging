"""Actual normal-customer MCP -> API -> Supabase workspace lifecycle tests.
Only isolated fixture customers receive temporary, audited feature entitlements.
No service-role key is used as a customer. Provider resources are checked and
explicitly decommissioned. Unknown mutations are never automatically replayed.
"""
import argparse
import datetime
import hashlib
import json
from pathlib import Path
import secrets
import subprocess
import uuid
from engineering_runtime import EngineeringRuntime,BASE,MANAGEMENT
from test_engineering_customer_boundary import REVIEWED_TRIGGERS

ROOT=Path(__file__).resolve().parents[2]
SOURCE=subprocess.check_output(['git','rev-parse','HEAD'],cwd=ROOT,text=True).strip()
MANIFEST=json.loads((ROOT/'supabase/functions/sandy-customer-provisioning-api/provisioning_manifest.json').read_text())
OPS=[c['operation'] for c in MANIFEST['operations']]

class LiveProvisioning:
    def __init__(self,output):
        self.output=output;self.r=EngineeringRuntime();self.keys=self.r._api_keys();self.users=[];self.tokens=[];self.customers=[];self.resources=[];self.configuration=None;self.hook="sandy_provisioning_fixture_"+uuid.uuid4().hex
        self.report={'source_test_commit':SOURCE,'deployed_source_commit':'e46fe92f91e24cd7763d4a9a542f27f96c1e30a2','gateway_source_commit':'a4b3aa09ca3bb52f41436daeb0f2b7abe6447aa9','normal_password_sessions':True,'service_role_substituted_for_user':False,'tests':[],'calls':[],'resources':[],'cleanup':{},'complete':False}

    def fixture_sql(self,sql):
        return self.r._sql(sql.replace("sandy_test_provisioning_completion_failure",self.hook))

    def save(self):
        self.output.parent.mkdir(parents=True,exist_ok=True);self.output.write_text(json.dumps(self.report,indent=2)+'\n')

    def check(self,name,condition):
        self.report['tests'].append({'name':name,'passed':bool(condition)});self.save()
        if not condition:raise RuntimeError('provisioning_live_check_failed:'+name)

    def call(self,index,operation,args,mcp=False,rid=None):
        rid=rid or str(uuid.uuid4());token=self.tokens[index]
        if mcp:
            body={'jsonrpc':'2.0','id':rid,'method':'tools/call','params':{'name':operation,'arguments':{'__sandy_execution':{'request_id':rid},'arguments':args}}};slug='sandy-api-mcp'
        else:body={'operation':operation,'arguments':args,'request_id':rid,'channel':'api'};slug='sandy-customer-provisioning-api'
        status,value=self.r._http('POST',BASE+'/functions/v1/'+slug,token,body,self.keys['anon'])
        if mcp:
            result=value.get('result',{});env=json.loads(result.get('content',[{}])[0].get('text','{}'));api_status=env.get('status',status)
            payload=result.get('structuredContent',{}) if result.get('isError') is False else env.get('result',{})
            self.report['calls'].append({'operation':operation,'request_id':rid,'channel':'mcp','http_status':status,'api_status':api_status,'is_error':result.get('isError'),'executed':env.get('result',{}).get('executed'),'error':payload.get('error'),'job_id':payload.get('job_id')})
        else:
            api_status=status;payload=value
            self.report['calls'].append({'operation':operation,'request_id':rid,'channel':'api','http_status':status,'executed':payload.get('executed'),'error':payload.get('error'),'job_id':payload.get('job_id')})
        self.save();return api_status,payload

    def require(self,index,operation,args,mcp=False,rid=None):
        status,result=self.call(index,operation,args,mcp,rid)
        self.check(('mcp.' if mcp else 'api.')+operation,status==200 and result.get('ok') is True and result.get('executed') is True)
        return result.get('result',result)

    def setup(self):
        for slug,version in [('sandy-operation-api',29),('sandy-customer-provisioning-api',3)]:
            status,metadata=self.r._http('GET',MANAGEMENT+'/functions/'+slug,self.r._management)
            self.check('reviewed_deployment_active.'+slug,status==200 and metadata.get('status')=='ACTIVE' and metadata.get('version')==version and metadata.get('verify_jwt') is True)
        rows=self.r._sql("SELECT n.nspname schema_name,c.relname table_name,t.tgname,t.tgenabled,pg_get_triggerdef(t.oid) definition,pg_get_functiondef(t.tgfoid) function_source FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE NOT t.tgisinternal AND (n.nspname='auth' AND c.relname='users' OR n.nspname='public' AND c.relname IN('email_customers','email_customer_addresses','sandy_memory_settings','sandy_memory_portal_accounts')) ORDER BY n.nspname,c.relname,t.tgname",True)
        fields=['schema_name','table_name','tgname','tgenabled','definition','function_source'];digest=hashlib.sha256(json.dumps(sorted(tuple(x[k] for k in fields) for x in rows),separators=(',',':'),ensure_ascii=False).encode()).hexdigest()
        self.check('existing_customer_triggers_reviewed',digest==REVIEWED_TRIGGERS)
        config=self.r._sql("SELECT (SELECT enabled FROM public.sandy_provisioning_features WHERE feature_key='database.workspace') feature_enabled,(SELECT enabled FROM public.sandy_provisioning_templates WHERE template_key='customer.workspace') template_enabled",True)[0]
        self.check('test_features_initially_disabled',config=={'feature_enabled':False,'template_enabled':False});self.configuration=config
        for _ in range(2):
            email='sandy-provisioning-live-'+str(uuid.uuid4())+'@example.invalid';password=secrets.token_urlsafe(42)
            user=self.r._auth_admin('POST','users',{'email':email,'password':password,'email_confirm':True,'user_metadata':{'sandy_api_isolated_session_test':True}});self.users.append(user['id'])
            status,session=self.r._http('POST',BASE+'/auth/v1/token?grant_type=password',self.keys['anon'],{'email':email,'password':password},self.keys['anon']);password=None
            self.check('normal_password_session_'+str(len(self.users)),status==200 and session.get('user',{}).get('role')=='authenticated');self.tokens.append(session['access_token']);session=None
            result=self.require(len(self.tokens)-1,'customer.onboarding.ensure',{'display_name':'Isolated provisioning acceptance customer'})
            self.customers.append(result['customer_id']);self.report['customers']=self.customers.copy();self.save()
        self.check('no_controller_memberships',self.r._sql('SELECT count(*) n FROM public.sandy_controller_admins WHERE auth_user_id IN ('+','.join(self.r._quote(x) for x in self.users)+')',True)==[{'n':0}])
        status,result=self.call(0,'customer.provisioning.plan',{'template_key':'customer.workspace'})
        self.check('disabled_template_denied',status==403 and result.get('error')=='provisioning_template_unavailable')
        self.r._sql("BEGIN;UPDATE public.sandy_provisioning_features SET enabled=true WHERE feature_key='database.workspace';UPDATE public.sandy_provisioning_templates SET enabled=true WHERE template_key='customer.workspace';COMMIT;")
        self.report['enabled_configuration_versions']=self.r._sql("SELECT (SELECT version FROM public.sandy_provisioning_features WHERE feature_key='database.workspace') feature_version,(SELECT version FROM public.sandy_provisioning_templates WHERE template_key='customer.workspace') template_version",True)[0]
        status,result=self.call(0,'customer.provisioning.plan',{'template_key':'customer.workspace'})
        self.check('missing_feature_entitlement_denied',status==403 and result.get('error')=='provisioning_feature_not_entitled')
        for customer in self.customers:
            self.r._sql("BEGIN;INSERT INTO public.sandy_commerce_entitlements(customer_id,feature_key,expires_at,reason) VALUES("+self.r._quote(customer)+",'database.workspace',clock_timestamp()+interval '1 hour','Owner-authorized isolated normal-customer provisioning acceptance fixture');INSERT INTO public.sandy_provisioning_customer_policies(customer_id,feature_key,enabled) VALUES("+self.r._quote(customer)+",'database.workspace',true);COMMIT;")

    def plan(self,index,mcp=False):
        return self.require(index,'customer.provisioning.plan',{'template_key':'customer.workspace'},mcp)['plan']

    def resource_readback(self,resource_id):
        rows=self.r._sql('SELECT r.*,to_regclass(r.provider_resource_id) IS NOT NULL provider_exists,public.sandy_provisioning_workspace_verified(r.id) provider_acl_verified FROM public.sandy_customer_resources r WHERE r.id='+self.r._quote(resource_id),True)
        self.check('independent_provider_resource_and_acl_readback',len(rows)==1 and rows[0]['customer_id'] in self.customers and rows[0]['provider_exists'] and rows[0]['provider_acl_verified'])
        self.report.setdefault('resource_readbacks',[]).append({k:rows[0][k] for k in ['id','customer_id','provider_resource_id','state','version','provider_exists','provider_acl_verified','actual_cost_microusd']});self.save()
        return rows[0]

    def run(self):
        try:
            self.setup()
            self.require(0,'customer.provisioning.features.list',{});self.require(0,'customer.provisioning.templates.list',{})
            plan=self.plan(0);rid=str(uuid.uuid4());args={'plan_id':plan['id'],'plan_sha256':plan['snapshot_sha256']}
            job=self.require(0,'customer.provisioning.execute',args,rid=rid)['job'];self.check('direct_job_truthfully_completed',job['state']=='succeeded' and job['execution_mode']=='synchronous_transaction')
            resource=job['resource_ids'][0];self.resources.append(resource);self.report['resources']=self.resources.copy();self.save();actual=self.resource_readback(resource)
            self.require(0,'customer.provisioning.jobs.get',{'job_id':job['id']});self.require(0,'customer.resources.list',{})
            self.require(0,'customer.workspace.records.upsert',{'resource_id':resource,'key':'fixture','value':{'hello':'Sandy','padding':'x'*1024},'expected_version':0})
            record=self.require(0,'customer.workspace.records.get',{'resource_id':resource,'key':'fixture'})['record'];self.check('actual_stored_json_result',record['value']['hello']=='Sandy' and record['version']==1)
            self.require(0,'customer.resources.reconcile',{'resource_id':resource})
            self.r._sql('ALTER TABLE public.'+'sandy_workspace_'+resource.replace('-','')+' DISABLE ROW LEVEL SECURITY')
            observation=self.require(0,'customer.resources.reconcile',{'resource_id':resource});self.check('actual_drift_detected',observation['resource']['state']=='drifted' and observation['effect_confirmed'] is False)
            self.require(0,'customer.resources.recover',{'resource_id':resource,'expected_version':observation['resource']['version']})
            self.require(0,'customer.workspace.records.delete',{'resource_id':resource,'key':'fixture','expected_version':1})
            actual=self.resource_readback(resource);self.require(0,'customer.resources.decommission',{'resource_id':resource,'expected_version':actual['version'],'delete_data':True})
            self.check('direct_provider_decommission_confirmed',self.r._sql('SELECT to_regclass('+self.r._quote(actual['provider_resource_id'])+') IS NULL absent',True)==[{'absent':True}])
            # Every new operation has now executed with a genuine normal customer
            # session against the real production DB. Enable exact tested pins.
            query='BEGIN;DO $verify$ DECLARE n integer; BEGIN '
            for contract in MANIFEST['operations']:
                evidence={'recorded_at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'evidence_level':'actual_normal_customer_production_handler_and_database_provider','mcp_end_to_end_verified':False,'source_commit':self.report['deployed_source_commit'],'scope':'supabase.workspace adapter in existing project; no purchase or external provider allocation'}
                query+="UPDATE public.sandy_operation_registry SET api_exposed=true,ai_exposed=true,verified=true,implementation_state='deployed',last_verified_at=now(),last_test_result=coalesce(last_test_result,'{}'::jsonb)||jsonb_build_object('customer_provisioning_20261021',"+self.r._quote(json.dumps(evidence))+"::jsonb),updated_at=now() WHERE operation="+self.r._quote(contract['operation'])+" AND error_contract->>'contract_sha256'="+self.r._quote(contract['contract_sha256'])+";GET DIAGNOSTICS n=ROW_COUNT;IF n<>1 THEN RAISE EXCEPTION 'provisioning contract drift';END IF;"
            self.r._sql(query+' END $verify$;COMMIT;')
            status,discovery=self.r._http('POST',BASE+'/functions/v1/sandy-api-mcp',self.tokens[0],{'jsonrpc':'2.0','id':'provisioning-discovery','method':'tools/list','params':{}},self.keys['anon']);tools=discovery.get('result',{}).get('tools',[])
            self.check('all_twelve_mcp_tools_discovered_with_schemas',status==200 and set(OPS)<=set(t['name'] for t in tools) and all(t.get('inputSchema') for t in tools if t['name'] in OPS))
            self.require(0,'customer.provisioning.features.list',{},True);self.require(0,'customer.provisioning.templates.list',{},True)
            plan=self.plan(0,True);rid=str(uuid.uuid4());args={'plan_id':plan['id'],'plan_sha256':plan['snapshot_sha256']};job=self.require(0,'customer.provisioning.execute',args,True,rid)['job'];resource=job['resource_ids'][0];self.resources.append(resource);self.report['resources']=self.resources.copy();self.save();actual=self.resource_readback(resource)
            same=self.require(0,'customer.provisioning.execute',args,True,rid)['job'];self.check('mcp_provision_idempotency',same['id']==job['id'])
            self.require(0,'customer.provisioning.jobs.get',{'job_id':job['id']},True);listing=self.require(0,'customer.resources.list',{},True);self.check('owned_resource_in_registry',any(r['id']==resource and r['actual_cost_microusd'] is None for r in listing['resources']))
            self.require(0,'customer.workspace.records.upsert',{'resource_id':resource,'key':'fixture','value':{'hello':'Sandy','padding':'x'*1024},'expected_version':0},True)
            record=self.require(0,'customer.workspace.records.get',{'resource_id':resource,'key':'fixture'},True)['record'];self.check('mcp_actual_record_result',record['value']['hello']=='Sandy')
            status,result=self.call(1,'customer.workspace.records.get',{'resource_id':resource,'key':'fixture'},True);self.check('cross_customer_record_denied',status==404 and result.get('error')=='customer_resource_not_found')
            status,result=self.call(1,'customer.provisioning.jobs.get',{'job_id':job['id']},True);self.check('cross_customer_job_denied',status==404 and result.get('error')=='provisioning_job_not_found')
            self.r._sql('UPDATE public.sandy_provisioning_customer_policies SET storage_bytes_limit=65536 WHERE customer_id='+self.r._quote(self.customers[0]))
            status,result=self.call(0,'customer.workspace.records.upsert',{'resource_id':resource,'key':'large','value':{'data':'x'*65000},'expected_version':0},True);self.check('current_storage_quota_enforced',status==429 and result.get('error')=='workspace_storage_quota_exceeded')
            self.r._sql('ALTER TABLE public.sandy_workspace_'+resource.replace('-','')+' DISABLE ROW LEVEL SECURITY')
            observation=self.require(0,'customer.resources.reconcile',{'resource_id':resource},True);self.check('mcp_actual_drift_truthful',observation['resource']['state']=='drifted' and observation['effect_confirmed'] is False)
            status,result=self.call(0,'customer.workspace.records.get',{'resource_id':resource,'key':'fixture'},True);self.check('drifted_resource_access_denied',status==409 and result.get('error')=='resource_reconciliation_required')
            recovered=self.require(0,'customer.resources.recover',{'resource_id':resource,'expected_version':observation['resource']['version']},True);self.check('mcp_actual_recovery_verified',recovered['effect_confirmed'] and self.resource_readback(resource)['provider_acl_verified'])
            self.require(0,'customer.workspace.records.delete',{'resource_id':resource,'key':'fixture','expected_version':1},True)
            actual=self.resource_readback(resource);self.require(0,'customer.resources.decommission',{'resource_id':resource,'expected_version':actual['version'],'delete_data':True},True)
            self.check('mcp_provider_decommission_confirmed',self.r._sql('SELECT to_regclass('+self.r._quote(actual['provider_resource_id'])+') IS NULL absent',True)==[{'absent':True}])
            # Inject one completion failure only for the second isolated customer.
            # Existing application triggers remain enabled and untouched.
            plan=self.plan(1,True);target=self.customers[1]
            self.fixture_sql("BEGIN;CREATE FUNCTION public.sandy_test_provisioning_completion_failure() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,pg_temp AS $fn$ BEGIN IF NEW.customer_id='"+target+"'::uuid AND NEW.state='succeeded' THEN RAISE EXCEPTION 'isolated_provisioning_acceptance_failure';END IF;RETURN NEW;END $fn$;REVOKE ALL ON FUNCTION public.sandy_test_provisioning_completion_failure() FROM PUBLIC,anon,authenticated,service_role;CREATE TRIGGER sandy_test_provisioning_completion_failure BEFORE INSERT ON public.sandy_customer_provisioning_jobs FOR EACH ROW EXECUTE FUNCTION public.sandy_test_provisioning_completion_failure();COMMIT;")
            status,result=self.call(1,'customer.provisioning.execute',{'plan_id':plan['id'],'plan_sha256':plan['snapshot_sha256']},True)
            self.check('mcp_failed_transaction_is_error_with_real_job',status==503 and result.get('error')=='provisioning_transaction_failed' and result.get('executed') is False and bool(result.get('job_id')))
            failed=self.require(1,'customer.provisioning.jobs.get',{'job_id':result['job_id']},True)['job'];self.check('actual_failed_job_status',failed['state']=='failed' and failed['resource_ids']==[])
            self.check('failed_transaction_no_orphan',self.r._sql('SELECT count(*) n FROM public.sandy_customer_resources WHERE customer_id='+self.r._quote(target)+' AND state<>\'decommissioned\'',True)==[{'n':0}])
            self.fixture_sql('DROP TRIGGER sandy_test_provisioning_completion_failure ON public.sandy_customer_provisioning_jobs;DROP FUNCTION public.sandy_test_provisioning_completion_failure();')
            self.report['complete']=True
        finally:self.cleanup()
        self.report['passed']=sum(t['passed'] for t in self.report['tests']);self.report['failed']=sum(not t['passed'] for t in self.report['tests']);self.save();self.record_registry()
        print(json.dumps({'complete':self.report['complete'],'passed':self.report['passed'],'failed':self.report['failed'],'actual_workspace_tables_provisioned':len(self.resources),'cleanup':self.report['cleanup']}))

    def cleanup(self):
        self.fixture_sql('DROP TRIGGER IF EXISTS sandy_test_provisioning_completion_failure ON public.sandy_customer_provisioning_jobs;DROP FUNCTION IF EXISTS public.sandy_test_provisioning_completion_failure();')
        if self.users:
            actors=','.join(self.r._quote(x) for x in self.users)
            bound=self.r._sql('SELECT customer_id FROM public.sandy_memory_portal_accounts WHERE auth_user_id IN ('+actors+')',True)
            self.customers=list(dict.fromkeys(self.customers+[x['customer_id'] for x in bound]));self.report['customers']=self.customers.copy()
        if self.customers:
            ids=','.join(self.r._quote(x) for x in self.customers)
            rows=self.r._sql('SELECT id,customer_id,provider_resource_id,state,version FROM public.sandy_customer_resources WHERE customer_id IN ('+ids+')',True)
            # Recovery is confined to the server-generated, ownership-marked test
            # resources. Any fallback administration is recorded as cleanup only.
            for row in rows:
                if row['state']!='decommissioned':
                    index=self.customers.index(row['customer_id']);status,result=self.call(index,'customer.resources.decommission',{'resource_id':row['id'],'expected_version':row['version'],'delete_data':True},True)
                    if status!=200:
                        expected='public.sandy_workspace_'+row['id'].replace('-','');assert row['provider_resource_id']==expected
                        owned=self.r._sql('SELECT to_regclass('+self.r._quote(expected)+') relation,obj_description(to_regclass('+self.r._quote(expected)+"),'pg_class') marker",True)[0]
                        if owned['relation'] is not None:
                            assert owned['marker']=='sandy_customer_resource:'+row['id']+':'+row['customer_id']
                            self.r._sql('DROP TABLE '+expected)
                        self.report['cleanup'].setdefault('administrative_resource_fallbacks',[]).append(row['id'])
            absent=self.r._sql('SELECT count(*) n FROM public.sandy_customer_resources WHERE customer_id IN ('+ids+') AND to_regclass(provider_resource_id) IS NOT NULL',True)
            self.check('all_fixture_provider_resources_absent',absent==[{'n':0}])
            actors=','.join(self.r._quote(x) for x in self.users)
            self.r._sql('BEGIN;DELETE FROM public.sandy_customer_provisioning_receipts WHERE actor_id IN ('+actors+');DELETE FROM public.sandy_customer_provisioning_jobs WHERE customer_id IN ('+ids+');DELETE FROM public.sandy_customer_provisioning_plans WHERE customer_id IN ('+ids+');DELETE FROM public.sandy_customer_resources WHERE customer_id IN ('+ids+');DELETE FROM public.sandy_provisioning_customer_policies WHERE customer_id IN ('+ids+");DELETE FROM public.sandy_commerce_entitlements WHERE customer_id IN ("+ids+") AND feature_key='database.workspace';DELETE FROM public.sandy_customer_onboarding_receipts WHERE actor_id IN ("+actors+');DELETE FROM public.sandy_memory_portal_accounts WHERE auth_user_id IN ('+actors+');DELETE FROM public.sandy_memory_settings WHERE customer_id IN ('+ids+');DELETE FROM public.email_customer_addresses WHERE customer_id IN ('+ids+');DELETE FROM public.email_customers WHERE id IN ('+ids+');COMMIT;')
        for token in self.tokens:
            status,_=self.r._http('POST',BASE+'/auth/v1/logout?scope=local',token,{},self.keys['anon']);self.report['cleanup'].setdefault('logout_statuses',[]).append(status)
        for user in self.users:self.r._auth_admin('DELETE','users/'+user)
        if self.configuration is not None and self.report.get('enabled_configuration_versions'):
            versions=self.report['enabled_configuration_versions']
            self.r._sql("BEGIN;UPDATE public.sandy_provisioning_features SET enabled=false WHERE feature_key='database.workspace' AND version="+str(int(versions['feature_version']))+";UPDATE public.sandy_provisioning_templates SET enabled=false WHERE template_key='customer.workspace' AND version="+str(int(versions['template_version']))+";COMMIT;")
            self.report['cleanup']['configuration_readback']=self.r._sql("SELECT (SELECT enabled FROM public.sandy_provisioning_features WHERE feature_key='database.workspace') feature_enabled,(SELECT enabled FROM public.sandy_provisioning_templates WHERE template_key='customer.workspace') template_enabled",True)[0]
        if self.users:
            actors=','.join(self.r._quote(x) for x in self.users);counts=self.r._sql('SELECT (SELECT count(*) FROM auth.users WHERE id IN ('+actors+')) auth_users,(SELECT count(*) FROM public.sandy_memory_portal_accounts WHERE auth_user_id IN ('+actors+')) portal_accounts,(SELECT count(*) FROM public.sandy_customer_provisioning_receipts WHERE actor_id IN ('+actors+')) receipts',True)[0];self.report['cleanup']['remaining']=counts;self.check('fixture_sessions_and_receipts_cleaned',all(n==0 for n in counts.values()))
        self.tokens.clear();self.save()

    def record_registry(self):
        if not self.report['complete']:return
        for operation in OPS:
            calls=[c for c in self.report['calls'] if c['operation']==operation and c['channel']=='mcp' and c.get('is_error') is False and c.get('api_status')==200];assert calls,operation
            evidence={'recorded_at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'evidence_level':'actual_normal_customer_MCP_to_Sandy_API_to_Supabase_database_provider','mcp_end_to_end_verified':True,'source_commit':self.report['deployed_source_commit'],'gateway_source_commit':self.report['gateway_source_commit'],'normal_password_sessions':2,'service_role_substituted_for_user':False,'provider_family_complete':False,'adapter_verified':'supabase.workspace','tests_passed':self.report['passed'],'tests_failed':self.report['failed'],'successful_calls':calls,'fixtures_cleaned':True,'actual_workspace_tables_provisioned':len(self.resources),'source_evidence_sha256':hashlib.sha256(self.output.read_bytes()).hexdigest(),'actual_cost_known':False,'no_new_project_or_plan_purchase':True}
            self.r._sql("UPDATE public.sandy_operation_registry SET last_test_result=last_test_result||jsonb_build_object('customer_provisioning_20261021',"+self.r._quote(json.dumps(evidence))+"::jsonb),last_verified_at=now(),updated_at=now() WHERE operation="+self.r._quote(operation))

if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--output',type=Path,required=True);LiveProvisioning(parser.parse_args().output).run()
