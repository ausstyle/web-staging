"""Deterministic, executable-only onboarding catalogue extension."""
import hashlib,json
from pathlib import Path
ROOT=Path(__file__).resolve().parent
obj=lambda p,r=None:{'type':'object','properties':p,'required':list(p) if r is None else r,'additionalProperties':False}
string={'type':'string','minLength':1,'maxLength':160}
output=obj({'ok':{'const':True},'contract_version':{'const':'1.0.0'},'executed':{'const':True},'request_state':{'const':'succeeded'},'request_id':{'type':'string','format':'uuid'},'reconciliation_required':{'const':False},'customer_id':{'type':'string','format':'uuid'},'created':{'type':'boolean'},'reused':{'type':'boolean'},'phase':{'enum':['verified','ready']},'version':{'type':'integer','minimum':0},'display_name':{'type':['string','null']},'organisation_name':{'type':['string','null']},'channels':{'type':'array','items':obj({'channel':{'enum':['email','web','api','whatsapp']},'subject':{'type':'string'},'verified':{'const':True}})},'permissions_source':{'const':'existing_verified_portal_and_channel_grants'},'memory_customer_id':{'type':'string','format':'uuid'},'automatic_provisioning':{'const':False}})
operations={}
for name,mutation,props,required,description in [
 ('customer.onboarding.ensure',True,{'display_name':string},[], 'Enroll the verified Auth email in its existing canonical customer identity, or create one isolated customer if none exists. No automatic provisioning or implicit account merge.'),
 ('customer.onboarding.update',True,{'display_name':string,'organisation_name':string,'expected_version':{'type':'integer','minimum':1,'maximum':999999999}},['expected_version'],'Progressively update the current customer profile with optimistic concurrency. Organisation name is profile metadata and grants no organisation permissions.'),
 ('customer.identity.get',False,{},[],'Read the current canonical customer and existing verified email, web/API and nonexpired WhatsApp channels. No other customer selector is accepted.')]:
 c={'operation':name,'contract_version':'1.0.0','handler':'sandy-customer-provisioning-api','permission_scope':'customer:'+('write' if mutation else 'read'),'is_mutation':mutation,'input_schema':obj(props,required),'output_schema':output,'description':description};c['contract_sha256']=hashlib.sha256(json.dumps(c,sort_keys=True,separators=(',',':')).encode()).hexdigest();operations[name]=c
(ROOT/'contracts.json').write_text(json.dumps(operations,indent=2)+'\n')
# SQL migration files are immutable ledger sources and are intentionally not
# regenerated when an executable contract receives a versioned correction.
