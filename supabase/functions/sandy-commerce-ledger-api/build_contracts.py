"""Fixed provider-neutral commerce contracts. No provider or network access."""
import json,hashlib,pathlib
root=pathlib.Path(__file__).resolve().parent
s=lambda n=240,min=1:{'type':'string','minLength':min,'maxLength':n}
u={'type':'string','format':'uuid'};b={'type':'boolean'};dt={'type':'string','format':'date-time'}
minor={'type':'string','pattern':'^(0|[1-9][0-9]{0,18})$'};signed={'type':'string','pattern':'^-?(0|[1-9][0-9]{0,18})$'}
code={'type':'string','pattern':'^[a-z][a-z0-9_.:-]{1,79}$'};currency={'type':'string','pattern':'^[A-Z]{3}$'}
page={'limit':{'type':'integer','minimum':1,'maximum':100},'after_id':u};version={'type':'integer','minimum':1}
obj=lambda props,req=():{'type':'object','properties':props,'required':list(req),'additionalProperties':False}
ops=[]
def add(op,mutation=False,props=None,required=(),owner=False,sensitive=True):
 props=dict(props or {})
 if mutation:props['idempotency_key']=u;required=(*required,'idempotency_key')
 money_fields=['amount_minor','unit_minor','debit_minor','credit_minor','subtotal_minor','tax_minor','discount_minor','total_minor','recorded_balance_minor','recorded_delta_minor']
 resource={'type':'object','properties':{**{k:{'type':'string','pattern':'^-?(0|[1-9][0-9]*)$','maxLength':80} for k in money_fields},'id':u,'account_id':u,'entry_id':u,'statement_id':u,'version':{'type':'integer','minimum':0},'currency':currency,'minor_unit_exponent':{'type':'integer','minimum':0,'maximum':3}},'additionalProperties':True}
 nested={'type':'array','maxItems':50,'items':{'type':'object','properties':{**{k:{'type':'string','pattern':'^-?(0|[1-9][0-9]*)$','maxLength':80} for k in money_fields},'id':u,'account_id':u,'quantity':{'type':'integer','minimum':1,'maximum':100000}},'additionalProperties':True}}
 resource['properties'].update({'items':nested,'lines':nested})
 output=obj({'ok':{'const':True},'operation':{'const':op},'contract_version':{'const':'1.0.0'},'request_id':u,'admission_id':u,'request_state':{'type':'string','enum':['observed','accepted','replayed','unknown']},'executed':{'type':['boolean','null']},'reconciliation_required':b,'result':obj({'item':{'anyOf':[resource,{'type':'null'}]},'items':{'type':'array','maxItems':100,'items':resource},'next_cursor':{'type':['string','null']},'possibly_truncated':b,'changed':b,'source':{'const':'internal_commerce_records'},'payment_executed':{'const':False},'provider_verified':{'const':False}},['item','items','next_cursor','possibly_truncated','changed','source','payment_executed','provider_verified'])},['ok','operation','contract_version','request_id','admission_id','request_state','executed','reconciliation_required','result'])
 row={'operation':op,'version':'1.0.0','handler':'sandy-commerce-ledger-api','authorization':'owner' if owner else 'portal','is_mutation':mutation,'consumes_provider_units':False,'sensitive':sensitive,'requires_approval':owner and (mutation or sensitive),'permission_scope':('system:' if owner else 'commerce:')+('write' if mutation else 'read'),'input_schema':obj(props,required),'output_schema':output,'requirement_ids':([158,159] if op.startswith('commerce.consent.') else [158,161] if op.startswith(('commerce.configuration.','commerce.plans.','commerce.prices.','commerce.executions.')) else [159,161] if op.startswith('commerce.entitlements.') else [158]),'description':op+': actual provider-neutral internal state; no processor charge, payout, tax attestation, paid invoice or provider settlement is implied.'}
 if op=='commerce.executions.get':row['authorization']='authenticated'
 row['contract_sha256']=hashlib.sha256(json.dumps(row,sort_keys=True,separators=(',',':'),ensure_ascii=False).encode()).hexdigest();ops.append(row)
add('commerce.configuration.get');add('commerce.configuration.update',True,{'currency':currency,'minor_unit_exponent':{'type':'integer','minimum':0,'maximum':3},'invoice_prefix':{'type':'string','pattern':'^[A-Z0-9-]{1,16}$'},'default_terms_days':{'type':'integer','minimum':0,'maximum':365},'expected_version':{'type':'integer','minimum':0}},['currency','minor_unit_exponent','invoice_prefix','default_terms_days','expected_version'])
add('commerce.consent.get');add('commerce.consent.set',True,{'terms_version':code,'invoice_forwarding_allowed':b,'automatic_renewal_recorded':b,'expires_at':dt},['terms_version','invoice_forwarding_allowed','automatic_renewal_recorded','expires_at']);add('commerce.consent.revoke',True)
for action in ['list','get','create','update','close']:
 p=page if action=='list' else {'account_id':u};req=() if action=='list' else ('account_id',)
 if action=='create':p={'code':code,'name':s(240),'kind':{'type':'string','enum':['asset','liability','equity','income','expense']}};req=tuple(p)
 if action=='update':p={**p,'name':s(240),'expected_version':version};req=tuple(p)
 if action=='close':p={**p,'expected_version':version};req=tuple(p)
 if action=='list':p={**p,'search':s(240),'kind':{'type':'string','enum':['asset','liability','equity','income','expense']},'active':b}
 add('commerce.accounts.'+action,action in ['create','update','close'],p,req)
line=obj({'account_id':u,'debit_minor':minor,'credit_minor':minor,'description':s(1000,0)},['account_id','debit_minor','credit_minor'])
lines={'type':'array','minItems':2,'maxItems':50,'items':line}
for action in ['list','get','create','update','delete','post','reverse']:
 p=page if action=='list' else {'entry_id':u};req=() if action=='list' else ('entry_id',)
 if action=='create':p={'description':s(2000),'external_reference':s(160),'effective_at':dt,'lines':lines};req=tuple(p)
 if action=='update':p={**p,'description':s(2000),'external_reference':s(160),'effective_at':dt,'lines':lines,'expected_version':version};req=tuple(p)
 if action in ['delete','post']:p={**p,'expected_version':version};req=tuple(p)
 if action=='reverse':p={**p,'description':s(2000),'effective_at':dt};req=tuple(p)
 if action=='list':p={**p,'search':s(240),'state':{'type':'string','enum':['draft','posted']},'from_at':dt,'to_at':dt}
 add('commerce.entries.'+action,action not in ['list','get'],p,req)
add('commerce.reports.trial_balance',False,{**page,'as_of':dt});add('commerce.reports.account_ledger',False,{'account_id':u,**page,'from_at':dt,'to_at':dt},['account_id']);add('commerce.reports.income_expense',False,{**page,'from_at':dt,'to_at':dt})
statementline=obj({'external_reference':s(160),'effective_at':dt,'amount_minor':signed,'description':s(1000,0)},['external_reference','effective_at','amount_minor'])
for action in ['list','get','import','delete']:
 p=page if action=='list' else {'statement_id':u};req=() if action=='list' else ('statement_id',)
 if action=='import':p={'account_id':u,'source_reference':s(160),'lines':{'type':'array','minItems':1,'maxItems':50,'items':statementline}};req=tuple(p)
 if action=='list':p={**p,'account_id':u,'search':s(160)}
 add('commerce.statements.'+action,action in ['import','delete'],p,req)
for action in ['preview','run','get','list','review']:
 p=page if action=='list' else {'statement_id':u} if action in ['preview','run'] else {'reconciliation_id':u};req=() if action=='list' else tuple(p)
 if action=='review':p={**p,'expected_version':version,'confirm_internal_match':{'const':True}};req=tuple(p)
 if action=='list':p={**p,'statement_id':u,'state':{'type':'string','enum':['proposed_internal','reviewed_internal']}}
 add('commerce.reconciliation.'+action,action in ['run','review'],p,req)
item=obj({'description':s(1000),'quantity':{'type':'integer','minimum':1,'maximum':100000},'unit_minor':minor},['description','quantity','unit_minor'])
invoicefields={'counterparty_name':s(240),'external_reference':s(160),'items':{'type':'array','minItems':1,'maxItems':50,'items':item},'tax_minor':minor,'discount_minor':minor,'due_at':dt}
for action in ['list','get','create','update','issue','void','reconcile_forwarding_status']:
 p=page if action=='list' else {'invoice_id':u};req=() if action=='list' else ('invoice_id',)
 if action=='create':p=invoicefields;req=tuple(p)
 if action=='update':p={**p,**invoicefields,'expected_version':version};req=tuple(p)
 if action in ['issue','void']:p={**p,'expected_version':version};req=tuple(p)
 if action=='reconcile_forwarding_status':p={**p,'source_message_id':u};req=tuple(p)
 if action=='list':p={**p,'search':s(240),'state':{'type':'string','enum':['draft','issued_internal','void']},'forwarding_status':{'type':'string','enum':['not_observed','claimed','sending','submitted','verified','needs_review','failed','unknown']},'due_before':dt}
 add('commerce.invoices.'+action,action not in ['list','get'],p,req)
add('commerce.invoices.forwarding_status.get',False,{'invoice_id':u,**page},['invoice_id'])
for action in ['list','get','create','update','archive']:
 p=page if action=='list' else {'plan_id':u};req=() if action=='list' else ('plan_id',)
 if action=='create':p={'code':code,'name':s(240),'description':s(4000)};req=tuple(p)
 if action=='update':p={**p,'name':s(240),'description':s(4000),'expected_version':version};req=tuple(p)
 if action=='archive':p={**p,'expected_version':version};req=tuple(p)
 if action=='list':p={**p,'search':s(240),'active':b}
 add('commerce.plans.'+action,action not in ['list','get'],p,req,True)
for action in ['list','get','create','archive']:
 p={**page,'plan_id':u} if action=='list' else {'price_id':u};req=('plan_id',) if action=='list' else ('price_id',)
 if action=='create':p={'plan_id':u,'currency':currency,'minor_unit_exponent':{'type':'integer','minimum':0,'maximum':3},'unit_minor':minor,'interval':{'type':'string','enum':['one_time','month','year']}};req=tuple(p)
 if action=='list':p={**p,'currency':currency,'interval':{'type':'string','enum':['one_time','month','year']},'active':b}
 add('commerce.prices.'+action,action in ['create','archive'],p,req,True)
add('commerce.entitlements.list',False,{**page,'feature_key':code,'enabled':b});add('commerce.entitlements.check',False,{'feature_key':code},['feature_key'])
add('commerce.entitlements.grant',True,{'customer_id':u,'feature_key':code,'expires_at':dt,'reason':s(1000)},['customer_id','feature_key','expires_at','reason'],True);add('commerce.entitlements.revoke',True,{'customer_id':u,'feature_key':code,'reason':s(1000)},['customer_id','feature_key','reason'],True)
add('commerce.processor.capabilities',False,owner=True,sensitive=False);add('commerce.audit.list',False,{**page,'operation':{'type':'string','pattern':'^commerce[.][a-z_.]+$','maxLength':120},'from_at':dt,'to_at':dt});add('commerce.executions.get',False,{'request_id':u},['request_id'])
(root/'contracts.json').write_text(json.dumps({'version':'1.0.0','operations':ops},indent=2)+'\n');print(json.dumps({'operations':len(ops),'reads':sum(not o['is_mutation'] for o in ops),'mutations':sum(o['is_mutation'] for o in ops)}))

# The migration is the authored SQL source. Only this bounded catalogue block
# and its registry companion are regenerated; functions/DDL are never rewritten.
repo=root.parents[2]
migrations=repo/'supabase/migrations'
boundary=migrations/'20261021009100_sandy_commerce_internal_ledger.sql'
q=lambda v:"'"+str(v).replace("'","''")+"'"
start='-- BEGIN GENERATED COMMERCE CONTRACTS'
end='-- END GENERATED COMMERCE CONTRACTS'
text=boundary.read_text()
if text.count(start)!=1 or text.count(end)!=1:raise RuntimeError('commerce_catalogue_markers_required')
rows='\n'.join('INSERT INTO public.sandy_commerce_contracts VALUES('+q(o['operation'])+','+q(json.dumps(o,separators=(',',':'),ensure_ascii=False))+'::jsonb);' for o in ops)
boundary.write_text(text.split(start)[0]+start+'\n'+rows+'\n'+end+text.split(end)[1])
rows=[]
for o in ops:
 error={'version':'1.0.0','contract_sha256':o['contract_sha256'],'requires_approval':o['requires_approval'],'api_key_delegable':False,'requirement_ids':o['requirement_ids'],'requires_real_user_session':True,'source_review_only':True,'provider_neutral_internal_records_only':True,'processor_configured':False,'payment_executed':False,'provider_verified':False,'pci_boundary':'no_cardholder_or_processor_secret_fields','stable_uuid_idempotency':o['is_mutation']}
 vals=[q(o['operation']),"'commerce'",q(o['description']),q(o['permission_scope']),str(o['is_mutation']).lower(),q(json.dumps(o['input_schema']))+'::jsonb',q(json.dumps(o['output_schema']))+'::jsonb',"'sandy-commerce-ledger-api'",'false','false','false','false',"'awaiting_deployment'","'ausstyle/web-staging'","'supabase/functions/sandy-commerce-ledger-api/index.ts'",q(json.dumps(['actual_confirmed_user_JWT','current_portal_tenant_or_exact_owner_approval','explicit_commercial_configuration','live_verification_before_exposure']))+'::jsonb',q(json.dumps(error))+'::jsonb',q(json.dumps({'automatic':False,'safe_to_retry':False,'idempotency':'retrieve the exact existing attempt; never duplicate internal posting'}))+'::jsonb',q(json.dumps({'applicable':False,'journal':'posted entries use explicit reversal; financial audit/consent/entitlement history is retained'}))+'::jsonb']
 rows.append('INSERT INTO public.sandy_operation_registry(operation,domain,description,permission_scope,is_mutation,input_schema,output_schema,handler,api_exposed,ui_exposed,ai_exposed,verified,implementation_state,source_repository,source_path,dependencies,error_contract,retry_policy,rollback_policy) VALUES('+','.join(vals)+');')
(migrations/'20261021009110_sandy_commerce_internal_contracts.sql').write_text('-- Internal records are not processor payment/settlement evidence.\nBEGIN;\n'+'\n'.join(rows)+'\nCOMMIT;\n')
