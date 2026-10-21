"""Seven fixed legacy system read contracts; no provider/network access."""
import pathlib,json,hashlib
root=pathlib.Path(__file__).resolve().parent;repo=root.parents[2];m=repo/'supabase/migrations'
s=lambda n=240:{'type':'string','maxLength':n};u={'type':'string','format':'uuid'};b={'type':'boolean'};dt={'type':'string','format':'date-time'};nullable_dt={'type':['string','null'],'format':'date-time'};digest={'type':'string','pattern':'^[a-f0-9]{64}$'}
obj=lambda p,req=None:{'type':'object','properties':p,'required':list(p) if req is None else list(req),'additionalProperties':False}
count={'type':'integer','minimum':0,'maximum':9007199254740991};limit={'type':'integer','minimum':1,'maximum':100};operation={'type':'string','pattern':'^[a-z][a-z0-9_.-]{2,239}$'}
registryrow=obj({'operation':operation,'domain':s(120),'permission_scope':s(120),'is_mutation':b,'handler':s(160),'api_exposed':b,'ai_exposed':b,'verified':b,'last_verified_at':nullable_dt,'implementation_state':s(160)})
runtime_cursor=obj({'feature_key':s(240),'scope_fingerprint':digest,'channel':s(80),'checked_at':{'type':'string','maxLength':64,'pattern':'^(none|[0-9]{4}-[0-9]{2}-[0-9]{2}T.*(Z|[+-][0-9]{2}:[0-9]{2}))$'}})
cap_cursor=obj({'feature_key':s(240),'scope_fingerprint':digest,'channel':s(80)})
caprow=obj({'feature_key':s(240),'scope_fingerprint':digest,'channel':s(80),'deployment_version':{'type':['string','null'],'maxLength':240},'implementation_state':s(160),'auth_state':s(160),'health_state':s(160),'checked_at':nullable_dt,'provider_verified':{'const':False}})
connectionrow=obj({'connection_fingerprint':digest,'provider':s(160),'recorded_status':s(160),'company_id':{'type':['string','null'],'format':'uuid'},'updated_at':dt,'provider_verified':{'const':False}})
receipt=obj({'ok':{'const':True},'admission_id':u,'request_id':u,'operation':operation,'request_state':{'type':'string','enum':['admitted','consumed','accepted','succeeded','failed','unknown','rejected']},'accepted':b,'executed':{'type':['boolean','null']},'completed':b,'outcome':{'type':'string','enum':['pending','accepted','succeeded','failed','unknown','rejected']},'provider_http_status':{'type':['integer','null'],'minimum':100,'maximum':599},'provider_request_id_sha256':{'type':['string','null'],'pattern':'^[a-f0-9]{64}$'},'result_sha256':{'type':['string','null'],'pattern':'^[a-f0-9]{64}$'},'reconciliation_required':b,'redispatch_permitted':{'const':False},'created_at':dt,'finished_at':nullable_dt})
ops=[]
def add(op,props,row=None,cursor=s(240),required=(),sensitive=False,item=None):
 result=obj({'items':{'type':'array','maxItems':100,'items':row or {'type':'object'}},'item':(item if item else {'type':'null'}),'next_cursor':{'anyOf':[cursor,{'type':'null'}]},'possibly_truncated':b,'source':{'const':'recorded_metadata'},'provider_verified':{'const':False},'executability_not_implied':{'const':True},'schemas_via':{'const':'Sandy API describe'},'notice':s(600)})
 output=obj({'ok':{'const':True},'operation':{'const':op},'contract_version':{'const':'1.0.0'},'admission_id':u,'request_id':u,'request_state':{'const':'observed'},'executed':{'const':True},'result':result,'reconciliation_required':{'const':False}})
 o={'operation':op,'handler':'sandy-system-metadata-api','version':'1.0.0','permission_scope':'system:read','is_mutation':False,'requires_approval':sensitive,'requires_real_user_session':True,'input_schema':obj(props,required),'output_schema':output,'description':op+': bounded explicit recorded metadata under a genuine owner admission; source flags do not prove current deployment, provider connectivity or original161 completion.'};o['contract_sha256']=hashlib.sha256(json.dumps(o,sort_keys=True,separators=(',',':'),ensure_ascii=False).encode()).hexdigest();ops.append(o)
regpage={'limit':limit,'after_operation':operation,'domain':s(120),'search':s(240),'verified':b,'is_mutation':b}
add('system.catalog',regpage,registryrow)
add('system.operation_catalog',regpage,registryrow)
base={'limit':limit,'feature_key':s(240),'channel':s(80),'health_state':s(160),'checked_after':dt}
add('system.capabilities',{**base,'cursor':cap_cursor},caprow,cap_cursor)
add('system.runtime',{**base,'cursor':runtime_cursor},caprow,runtime_cursor)
add('system.connections',{'customer_id':u,'company_id':u,'provider':s(160),'status':s(160),'limit':limit,'after_fingerprint':digest},connectionrow,digest,['customer_id'],True)
summary=obj({'registered':count,'verified':count,'unverified':count,'api_exposed':count,'ai_exposed':count,'registry_flags_complete':b,'original_161_completion_not_established':{'const':True},'count_scope':{'const':'filtered_registry'}})
add('system.coverage',regpage,obj({'operation':operation,'api_exposed':b,'ai_exposed':b,'verified':b}),item=summary)
add('system.operation_status',{'request_id':u},obj({}),required=['request_id'],item=receipt)
(root/'contracts.json').write_text(json.dumps({'version':'1.0.0','operations':ops},indent=2)+'\n')
q=lambda x:"'"+str(x).replace("'","''")+"'"
p=m/'20261021010700_sandy_system_metadata_boundary.sql';text=p.read_text();start='-- BEGIN GENERATED SYSTEM METADATA CONTRACTS';end='-- END GENERATED SYSTEM METADATA CONTRACTS';assert text.count(start)==text.count(end)==1
inserts='\n'.join('INSERT INTO public.sandy_system_metadata_contracts VALUES('+q(o['operation'])+','+q(json.dumps(o,separators=(',',':')))+'::jsonb);' for o in ops)
p.write_text(text.split(start)[0]+start+'\n'+inserts+'\n'+end+text.split(end)[1])
rows=[]
for o in ops:
 err={'contract_sha256':o['contract_sha256'],'version':'1.0.0','requires_approval':o['requires_approval'],'requires_real_user_session':True,'api_key_delegable':False,'sensitive_response':o['requires_approval'],'recorded_metadata_only':True,'provider_verified':False}
 vals=[q(o['operation']),"'system'",q(o['description']),"'system:read'",'false',q(json.dumps(o['input_schema']))+'::jsonb',q(json.dumps(o['output_schema']))+'::jsonb',"'sandy-system-metadata-api'",'false','false','false','false',"'awaiting_deployment'","'ausstyle/web-staging'","'supabase/functions/sandy-system-metadata-api/index.ts'",q(json.dumps(['genuine_current_owner_session','exact_consumed_once_admission','runtime_project_egress','live_user_session_verification_before_exposure']))+'::jsonb',q(json.dumps(err))+'::jsonb']
 rows.append('INSERT INTO public.sandy_operation_registry(operation,domain,description,permission_scope,is_mutation,input_schema,output_schema,handler,api_exposed,ui_exposed,ai_exposed,verified,implementation_state,source_repository,source_path,dependencies,error_contract) VALUES('+','.join(vals)+') ON CONFLICT(operation) DO UPDATE SET description=excluded.description,permission_scope=excluded.permission_scope,is_mutation=false,input_schema=excluded.input_schema,output_schema=excluded.output_schema,handler=excluded.handler,api_exposed=false,ui_exposed=false,ai_exposed=false,verified=false,implementation_state=excluded.implementation_state,source_repository=excluded.source_repository,source_path=excluded.source_path,dependencies=excluded.dependencies,error_contract=excluded.error_contract;')
(m/'20261021010710_sandy_system_metadata_contracts.sql').write_text('-- Reconcile exactly7 source-present legacy reads; cloud.vm.exec stays unassigned.\nBEGIN;\n'+'\n'.join(rows)+'\nCOMMIT;\n')
print(json.dumps({'operations':len(ops),'mutations':0}))
