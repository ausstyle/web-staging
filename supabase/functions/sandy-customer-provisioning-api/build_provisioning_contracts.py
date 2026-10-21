"""Materialize typed existing-provider workspace operations, with a compact manifest.
SQL migrations are immutable; only the initial unapplied migration is emitted.
"""
import hashlib,json
from pathlib import Path
ROOT=Path(__file__).resolve().parent
obj=lambda p,r=None:{'type':'object','properties':p,'required':list(p) if r is None else r,'additionalProperties':False}
uuid={'type':'string','format':'uuid'};nullable_uuid={'type':['string','null'],'format':'uuid'};date={'type':'string','format':'date-time'}
integer={'type':'integer','minimum':0};version={'type':'integer','minimum':1};key={'type':'string','pattern':'^[A-Za-z0-9][A-Za-z0-9_.-]{0,79}$'}
resource=obj({'id':uuid,'customer_id':uuid,'feature_key':{'type':'string'},'adapter':{'const':'supabase.workspace'},'provider':{'const':'supabase'},'project_ref':{'const':'zmqlyygzqoidkcwdysok'},'provider_resource_id':{'type':'string','pattern':'^public\\.sandy_workspace_[a-f0-9]{32}$'},'state':{'enum':['ready','drifted','decommissioned']},'version':version,'storage_bytes_limit':integer,'logical_storage_bytes':integer,'provider_storage_bytes':{'type':['integer','null'],'minimum':0},'estimated_purchase_cost_microusd':{'const':0},'actual_cost_microusd':{'type':['integer','null'],'minimum':0},'cost_source':{'const':'not_individually_reported'},'created_at':date,'verified_at':{'type':['string','null'],'format':'date-time'},'updated_at':date,'decommissioned_at':{'type':['string','null'],'format':'date-time'}})
job=obj({'id':uuid,'customer_id':uuid,'plan_id':nullable_uuid,'kind':{'enum':['provision','decommission','recover']},'state':{'enum':['succeeded','failed','unknown']},'resource_ids':{'type':'array','items':uuid},'error_code':{'type':['string','null']},'execution_mode':{'const':'synchronous_transaction'},'created_at':date,'completed_at':date})
plan=obj({'id':uuid,'template_key':{'type':'string'},'snapshot_sha256':{'type':'string','pattern':'^[a-f0-9]{64}$'},'expires_at':date,'steps':{'type':'array','minItems':1,'maxItems':10,'items':obj({'feature_key':{'type':'string'},'feature_version':version,'policy_version':version,'storage_bytes_limit':integer,'existing_resource_id':nullable_uuid})},'estimated_purchase_cost_microusd':{'const':0},'actual_provider_cost_known':{'const':False}})
results={
 'features':obj({'features':{'type':'array','items':obj({'feature_key':{'type':'string'},'adapter':{'const':'supabase.workspace'},'enabled':{'type':'boolean'},'version':version,'description':{'type':'string'},'entitled':{'type':'boolean'}})}}),
 'templates':obj({'templates':{'type':'array','items':obj({'template_key':{'type':'string'},'version':version,'feature_keys':{'type':'array','items':{'type':'string'}}})}}),
 'plan':obj({'plan':plan}),'job':obj({'job':job}),'resources':obj({'resources':{'type':'array','items':resource}}),
 'observation':obj({'resource':resource,'effect_confirmed':{'type':'boolean'}}),'lifecycle':obj({'resource':resource,'job':job,'effect_confirmed':{'const':True}}),
 'record':obj({'resource_id':uuid,'record':obj({'key':key,'value':{'type':'object'},'version':version})}),
 'record_write':obj({'resource_id':uuid,'key':key,'version':version}),'record_delete':obj({'resource_id':uuid,'key':key,'deleted':{'const':True}}),
}
base=obj({'ok':{'const':True},'contract_version':{'const':'1.0.0'},'executed':{'const':True},'request_state':{'const':'succeeded'},'request_id':uuid,'reused':{'type':'boolean'},'reconciliation_required':{'const':False},'result':{} })
specs=[
 ('customer.provisioning.features.list',False,{},'features','List installed feature definitions and the current customer’s existing commerce entitlements. Listing does not enable a feature.'),
 ('customer.provisioning.templates.list',False,{},'templates','List enabled reusable provisioning templates. Every constituent still requires an active feature entitlement and quota policy.'),
 ('customer.provisioning.plan',True,{'template_key':{'type':'string','pattern':'^[a-z][a-z0-9_.-]{2,79}$'}},'plan','Persist a five-minute immutable provisioning plan after checking every feature, entitlement, resource limit and purchase budget. No resource is created.'),
 ('customer.provisioning.execute',True,{'plan_id':uuid,'plan_sha256':{'type':'string','pattern':'^[a-f0-9]{64}$'}},'job','Revalidate the immutable plan and provision actual isolated database workspace tables transactionally. Return a persisted completed job only after provider metadata and access controls are verified. No new project or purchase.'),
 ('customer.provisioning.jobs.get',False,{'job_id':uuid},'job','Read a current-customer provisioning/recovery/decommission job; another customer’s job returns not found. Current adapter execution is a synchronous database transaction.'),
 ('customer.resources.list',False,{},'resources','List owned resources, actual provider identifiers, configuration, verification status, storage usage and costs. Unreported provider billing is null, never presented as zero.'),
 ('customer.resources.reconcile',True,{'resource_id':uuid},'observation','Inspect the real resource, ownership marker, column types, RLS and privileges. Record drift truthfully; never recreate an absent table automatically.'),
 ('customer.resources.recover',True,{'resource_id':uuid,'expected_version':version},'lifecycle','Restore security configuration on the exact owned existing workspace under version control, verify it, and persist a recovery job. Missing or mismatched resources require investigation.'),
 ('customer.resources.decommission',True,{'resource_id':uuid,'expected_version':version,'delete_data':{'const':True}},'lifecycle','Explicitly delete the exact owned workspace and its data under version control, verify provider absence, release resource usage and persist a decommission job. No automatic cascading deletion.'),
 ('customer.workspace.records.get',False,{'resource_id':uuid,'key':key},'record','Read a record from the exact owned workspace through Sandy API. Retained customer data remains readable when new provisioning/writes are disabled.'),
 ('customer.workspace.records.upsert',True,{'resource_id':uuid,'key':key,'value':{'type':'object','maxProperties':1000},'expected_version':integer},'record_write','Create or update an owned JSON record with optimistic concurrency, current entitlement and logical storage quotas. Return metadata; record data is not copied into mutation receipts.'),
 ('customer.workspace.records.delete',True,{'resource_id':uuid,'key':key,'expected_version':version},'record_delete','Delete an owned record with optimistic concurrency, including during retention after feature disablement.'),
]
operations={};entries=[]
for name,mutation,inputs,result_type,description in specs:
 output={**base,'properties':{**base['properties'],'result':results[result_type]}}
 c={'operation':name,'contract_version':'1.0.0','handler':'sandy-customer-provisioning-api','permission_scope':'customer:'+('write' if mutation else 'read'),'is_mutation':mutation,'requires_portal':True,'input_schema':obj(inputs),'output_schema':output,'description':description}
 c['contract_sha256']=hashlib.sha256(json.dumps(c,sort_keys=True,separators=(',',':'),ensure_ascii=False).encode()).hexdigest();operations[name]=c
 entries.append({k:v for k,v in c.items() if k!='output_schema'}|{'result_schema':result_type})
manifest={'output_base':base,'result_schemas':results,'operations':entries};(ROOT/'provisioning_manifest.json').write_text(json.dumps(manifest,indent=2,ensure_ascii=False)+'\n')
quote=lambda x:"'"+str(x).replace("'","''")+"'"
j=lambda x:quote(json.dumps(x,separators=(',',':'),ensure_ascii=False))+'::jsonb'
q=['-- Real installed workspace handlers start unexposed pending production tests.','BEGIN;']
for name,c in operations.items():
 error={'contract_sha256':c['contract_sha256'],'requires_real_user_session':True,'api_key_delegable':False,'requires_approval':False,'requirement_ids':[143,159,161]}
 values=[quote(name),"'customer'",quote(c['description']),quote(c['permission_scope']),str(c['is_mutation']).lower(),j(c['input_schema']),j(c['output_schema']),quote(c['handler']),'false','false','false','false',"'awaiting_deployment'","'ausstyle/web-staging'","'supabase/functions/sandy-customer-provisioning-api/index.ts'",j(['verified_customer_portal','existing_commerce_entitlement','enabled_feature_and_template','current_quota_policy','migration_20261021140000']),j(error),j({'automatic':False,'idempotency':'immutable customer plan plus actor/request UUID; unknown transport outcome requires the same receipt or persisted job reconciliation'}),j({'automatic':False,'policy':'provider DDL and job writes are one atomic transaction; recovery/decommission target exact owned resources with version and explicit deletion controls'})]
 q.append('INSERT INTO public.sandy_operation_registry(operation,domain,description,permission_scope,is_mutation,input_schema,output_schema,handler,api_exposed,ui_exposed,ai_exposed,verified,implementation_state,source_repository,source_path,dependencies,error_contract,retry_policy,rollback_policy) VALUES('+','.join(values)+');')
q.append('COMMIT;');migration=ROOT.parents[1]/'migrations/20261021140010_sandy_customer_provisioning_contracts.sql'
if migration.exists() and migration.read_text()!='\n'.join(q)+'\n':
 raise RuntimeError('Refusing to rewrite an existing migration; create an explicit versioned contract correction')
if not migration.exists():migration.write_text('\n'.join(q)+'\n')
