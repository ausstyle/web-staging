"""Deterministic, executable-only onboarding catalogue extension."""
import hashlib,json
from pathlib import Path
ROOT=Path(__file__).resolve().parent
obj=lambda p,r=None:{'type':'object','properties':p,'required':list(p) if r is None else r,'additionalProperties':False}
string={'type':'string','minLength':1,'maxLength':160}
output=obj({'ok':{'const':True},'contract_version':{'const':'1.0.0'},'customer_id':{'type':'string','format':'uuid'},'created':{'type':'boolean'},'reused':{'type':'boolean'},'phase':{'enum':['verified','ready']},'version':{'type':'integer','minimum':0},'display_name':{'type':['string','null']},'organisation_name':{'type':['string','null']},'channels':{'type':'array','items':obj({'channel':{'enum':['email','web','api','whatsapp']},'subject':{'type':'string'},'verified':{'const':True}})},'permissions_source':{'const':'existing_verified_portal_and_channel_grants'},'memory_customer_id':{'type':'string','format':'uuid'},'automatic_provisioning':{'const':False}})
operations={}
for name,mutation,props,required,description in [
 ('customer.onboarding.ensure',True,{'display_name':string},[], 'Enroll the verified Auth email in its existing canonical customer identity, or create one isolated customer if none exists. No automatic provisioning or implicit account merge.'),
 ('customer.onboarding.update',True,{'display_name':string,'organisation_name':string,'expected_version':{'type':'integer','minimum':1,'maximum':999999999}},['expected_version'],'Progressively update the current customer profile with optimistic concurrency. Organisation name is profile metadata and grants no organisation permissions.'),
 ('customer.identity.get',False,{},[],'Read the current canonical customer and existing verified email, web/API and nonexpired WhatsApp channels. No other customer selector is accepted.')]:
 c={'operation':name,'contract_version':'1.0.0','handler':'sandy-customer-provisioning-api','permission_scope':'customer:'+('write' if mutation else 'read'),'is_mutation':mutation,'input_schema':obj(props,required),'output_schema':output,'description':description};c['contract_sha256']=hashlib.sha256(json.dumps(c,sort_keys=True,separators=(',',':')).encode()).hexdigest();operations[name]=c
(ROOT/'contracts.json').write_text(json.dumps(operations,indent=2)+'\n')
q=['-- Installed handlers start unexposed; genuine production verification enables them.','BEGIN;']
quote=lambda x:"'"+str(x).replace("'","''")+"'"
j=lambda x:quote(json.dumps(x,separators=(',',':')))+'::jsonb'
for name,c in operations.items():
 error={'contract_sha256':c['contract_sha256'],'requires_real_user_session':True,'api_key_delegable':False,'requires_approval':False}
 values=[quote(name),"'customer'",quote(c['description']),quote(c['permission_scope']),str(c['is_mutation']).lower(),j(c['input_schema']),j(c['output_schema']),quote(c['handler']), 'false','false','false','false',"'awaiting_deployment'","'ausstyle/web-staging'","'supabase/functions/sandy-customer-provisioning-api/index.ts'",j(['verified_normal_Supabase_Auth_email','existing_canonical_customer_and_portal','migration_20261021130000']),j(error),j({'automatic':False,'idempotency':'actor/request UUID with exact operation and input hash; uncertain outcome requires receipt reconciliation'}),j({'automatic':False,'policy':'profile updates use versioned forward corrections; canonical identities are never automatically merged or deleted'})]
 q.append('INSERT INTO public.sandy_operation_registry(operation,domain,description,permission_scope,is_mutation,input_schema,output_schema,handler,api_exposed,ui_exposed,ai_exposed,verified,implementation_state,source_repository,source_path,dependencies,error_contract,retry_policy,rollback_policy) VALUES('+','.join(values)+');')
q.append('COMMIT;');(ROOT.parents[1]/'migrations/20261021130010_sandy_customer_onboarding_contracts.sql').write_text('\n'.join(q)+'\n')
