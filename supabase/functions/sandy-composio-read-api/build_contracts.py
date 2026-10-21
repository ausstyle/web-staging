"""Two original customer operations; private profiles are separately reviewed source."""
import hashlib,json,pathlib
HERE=pathlib.Path(__file__).resolve().parent
ROOT=HERE.parents[2]
def canon(v):return json.dumps(v,sort_keys=True,separators=(',',':'),ensure_ascii=False)
def obj(properties,required):return {'type':'object','properties':properties,'required':required,'additionalProperties':False}
uid={'type':'string','format':'uuid'}
company={'type':['string','null'],'format':'uuid'}
sha={'type':['string','null'],'pattern':'^[a-f0-9]{64}$'}
slug={'type':'string','pattern':'^[a-z0-9_-]{2,80}$','maxLength':80}
profile={'type':'string','pattern':'^[a-z0-9_-]{3,100}$','maxLength':100}
toolkit=obj({'toolkit_slug':slug,'company_id':company,'provider_confirmed_active':{'type':'boolean'},'read_profiles':{'type':'array','maxItems':100,'items':profile}},['toolkit_slug','company_id','provider_confirmed_active','read_profiles'])
result=obj({'toolkits':{'type':'array','maxItems':100,'items':toolkit},'data':{'type':['object','null'],'maxProperties':100},'profile_id':{'type':['string','null'],'maxLength':100},'result_sha256':sha,'provider_verified':{'type':'boolean'},'source':{'const':'composio_customer_read_service'},'payload_stored':{'const':False}},['toolkits','data','profile_id','result_sha256','provider_verified','source','payload_stored'])
records=[]
for name,inp in [('composio.discover_toolkits',obj({'company_id':company},[])),('composio.execute_read',obj({'profile_id':profile,'company_id':company,'arguments':{'type':'object','maxProperties':100}},['profile_id','company_id','arguments']))]:
 o={'operation':name,'handler':'sandy-composio-read-api','contract_version':'1.0.0','authorization':'portal','owns_user_admission':True,'is_mutation':False,'sensitive':True,'requires_approval':False,'requires_grant':True,'requires_real_user_session':True,'api_key_delegable':False,'permission_scope':'connections:read','input_schema':inp}
 o['output_schema']=obj({'ok':{'const':True},'operation':{'const':name},'contract_version':{'const':'1.0.0'},'request_id':uid,'admission_id':uid,'request_state':{'enum':['observed','replayed']},'executed':{'type':['boolean','null']},'reconciliation_required':{'type':'boolean'},'result':result},['ok','operation','contract_version','request_id','admission_id','request_state','executed','reconciliation_required','result'])
 o['contract_sha256']=hashlib.sha256(canon(o).encode()).hexdigest();records.append(o)
(HERE/'contracts.json').write_text(json.dumps(records,indent=2)+'\n')
baseline=json.loads((HERE/'registry_before.json').read_text())
lines=['-- Two original Composio customer IDs; all exposure remains closed.','BEGIN;']
for o in records:
 raw=canon(o).replace("'","''");old=next(x for x in baseline if x['operation']==o['operation']);old={k:old[k] for k in ['handler','permission_scope','is_mutation','input_schema','output_schema','api_exposed','ai_exposed','verified']};old=canon(old).replace("'","''")
 lines.append("INSERT INTO public.sandy_composio_read_contracts VALUES('"+o['operation']+"','"+raw+"'::jsonb);")
 lines.append("DO $guard$ BEGIN IF NOT EXISTS(SELECT 1 FROM public.sandy_operation_registry r WHERE operation='"+o['operation']+"' AND(SELECT jsonb_object_agg(k,to_jsonb(r)->k) FROM unnest(ARRAY['handler','permission_scope','is_mutation','input_schema','output_schema','api_exposed','ai_exposed','verified'])k)='"+old+"'::jsonb) THEN RAISE EXCEPTION 'reviewed_composio_registry_baseline_required';END IF;END $guard$;")
 err=canon({k:o[k] for k in ['contract_sha256','requires_approval','requires_grant','requires_real_user_session','api_key_delegable']}).replace("'","''")
 lines.append("UPDATE public.sandy_operation_registry SET handler='sandy-composio-read-api',permission_scope='connections:read',input_schema='"+canon(o['input_schema']).replace("'","''")+"'::jsonb,output_schema='"+canon(o['output_schema']).replace("'","''")+"'::jsonb,error_contract='"+err+"'::jsonb,is_mutation=false,api_exposed=false,ai_exposed=false,ui_exposed=false,verified=false,implementation_state='implemented_unverified',last_verified_at=NULL WHERE operation='"+o['operation']+"';")
lines+=['COMMIT;'];(ROOT/'supabase/migrations/20261021010830_sandy_composio_read_contracts.sql').write_text('\n'.join(lines)+'\n')
print(json.dumps({'operations':len(records),'reviewed_provider_profiles_installed':0}))
