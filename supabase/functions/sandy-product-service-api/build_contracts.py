import json,hashlib,pathlib
root=pathlib.Path(__file__).resolve().parent
def obj(p={},required=()):return {'type':'object','properties':p,'required':list(required),'additionalProperties':False}
def s(n=200,min=1):return {'type':'string','minLength':min,'maxLength':n}
u={'type':'string','format':'uuid'};dt={'type':'string','format':'date-time'};b={'type':'boolean'};idem={'idempotency_key':u};page={'limit':{'type':'integer','minimum':1,'maximum':100},'after_id':u}
ops=[]
def add(op,executor,auth,mut,props={},req=(),sensitive=False,requirements=(),binding='none',result=None,cost=False):
 if mut:props={**props,**idem};req=(*req,'idempotency_key')
 row={'operation':op,'contract_version':'1.0.0','executor':executor,'authorization':auth,'is_mutation':mut,'sensitive':sensitive,'consumes_provider_units':cost,'binding':binding,'requirement_ids':list(requirements),'input_schema':obj(props,req),'result_schema':result or {'type':'object'},'description':f'{op}: fixed scoped {executor} service; submission, persisted state and independently verified delivery are distinct.'}
 row['contract_sha256']=hashlib.sha256(json.dumps(row,sort_keys=True,separators=(',',':'),ensure_ascii=False).encode()).hexdigest();ops.append(row)
# Actual tenant-owned data, with no caller-selected tenant or administrative credential.
add('customer.profile.get','db','portal',False,requirements=[143,159],result=obj({'id':u,'display_name':s(240,0),'created_at':dt,'updated_at':dt},['id','display_name','created_at','updated_at']))
add('customer.profile.update','db','portal',True,{'display_name':s(240)},['display_name'],requirements=[159])
add('customer.addresses.list','db','portal',False,page,sensitive=True,requirements=[144,159])
for method,mut,props,req in [('list',False,{**page,'state':{'type':'string','enum':['open','closed']},'category':{'type':'string','enum':['account','billing','technical','privacy','other']},'search':s(240)},()),('get',False,{'case_id':u},('case_id',)),('create',True,{'subject':s(240),'details':s(8000),'category':{'type':'string','enum':['account','billing','technical','privacy','other']}},('subject','details','category')),('update',True,{'case_id':u,'subject':s(240),'details':s(8000),'expected_version':{'type':'integer','minimum':1}},('case_id','subject','details','expected_version')),('close',True,{'case_id':u,'expected_version':{'type':'integer','minimum':1}},('case_id','expected_version')),('reopen',True,{'case_id':u,'expected_version':{'type':'integer','minimum':1}},('case_id','expected_version'))]:add('support.cases.'+method,'db','portal',mut,props,req,True,[159])
add('support.comments.list','db','portal',False,{'case_id':u,**page},['case_id'],True,[159]);add('support.comments.create','db','portal',True,{'case_id':u,'body':s(8000)},['case_id','body'],True,[159])
for action in ['list','get','resolve','reopen']:
 p={'limit':page['limit'],'cursor':s(512),'severity':s(32),'resolved':b} if action=='list' else {'file_id':u,'process':{'type':'string','pattern':'^[A-Za-z0-9_.:-]{1,80}$'}}
 add('notifications.file_alerts.'+action,'db','portal',action in ['resolve','reopen'],p,() if action=='list' else ('file_id','process'),False,[157])
for action in ['list','get']:
 add('notifications.improvements.'+action,'db','portal',False,page if action=='list' else {'notification_id':u},() if action=='list' else ('notification_id',),True,[157])
add('notifications.preferences.get','db','portal',False,requirements=[157,161]);add('notifications.preferences.update','db','portal',True,{'email_enabled':b,'whatsapp_enabled':b,'file_alerts_enabled':b},['email_enabled','whatsapp_enabled','file_alerts_enabled'],requirements=[157,161])
# Internal notifications are persisted tenant events, not an external delivery promise.
for action in ['list','get','acknowledge']:
 add('notifications.inbox.'+action,'db','portal',action=='acknowledge',page if action=='list' else {'notification_id':u},() if action=='list' else ('notification_id',),True,[157])
add('notifications.quiet_hours.get','db','portal',False,requirements=[157])
add('notifications.quiet_hours.update','db','portal',True,{'enabled':b,'timezone':s(80),'start_minute':{'type':'integer','minimum':0,'maximum':1439},'end_minute':{'type':'integer','minimum':0,'maximum':1439}},['enabled','timezone','start_minute','end_minute'],requirements=[157])
for action in ['list','update']:
 p={} if action=='list' else {'topic':{'type':'string','enum':['support','file_alerts','improvements']},'enabled':b}
 add('notifications.subscriptions.'+action,'db','portal',action=='update',p,() if action=='list' else ('topic','enabled'),False,[157])
for action in ['list','get','create','update','delete']:
 p=page if action=='list' else {'template_id':u};req=() if action=='list' else ('template_id',)
 if action=='create':p={'name':{'type':'string','pattern':'^[a-z][a-z0-9_]{1,79}$'},'body_text':s(8000)};req=tuple(p)
 if action=='update':p={**p,'body_text':s(8000),'expected_version':{'type':'integer','minimum':1}};req=tuple(p)
 if action=='delete':p={**p,'expected_version':{'type':'integer','minimum':1},'confirm':{'const':True}};req=tuple(p)
 add('notifications.templates.'+action,'db','owner',action in ['create','update','delete'],p,req,False,[157,161])
for action in ['list','get']:
 add('product.configuration.snapshots.'+action,'db','owner',False,page if action=='list' else {'snapshot_id':u},() if action=='list' else ('snapshot_id',),False,[161])
add('product.configuration.providers.list','db','owner',False,requirements=[161]);add('product.configuration.providers.get','db','owner',False,{'provider_key':{'type':'string','pattern':'^[a-z][a-z0-9_]{1,39}$'}},['provider_key'],requirements=[161]);add('product.configuration.providers.update','db','owner',True,{'provider_key':{'type':'string','pattern':'^[a-z][a-z0-9_]{1,39}$'},'model_name':{'type':'string','pattern':'^[A-Za-z0-9_.:/-]{1,160}$'},'enabled':b,'is_default':b,'expected_updated_at':dt},['provider_key','model_name','enabled','is_default','expected_updated_at'],requirements=[161]);add('product.configuration.providers.restore','db','owner',True,{'snapshot_id':u,'expected_updated_at':dt},['snapshot_id','expected_updated_at'],requirements=[161])
# Owner mailbox administration remains bound to the single configured shared mailbox.
for action in ['list','get']:add('graph.mailboxes.'+action,'graph','owner',False,sensitive=True,requirements=[146])
add('graph.messages.set_categories','graph','portal',True,{'message_id':u,'categories':{'type':'array','maxItems':20,'uniqueItems':True,'items':s(80)},'confirm':{'const':True}},['message_id','categories','confirm'],True,[146],binding='message')
for action in ['list','get','add','delete']:
 p={'draft_id':u,**({'cursor':s(4096)} if action=='list' else {})};req=['draft_id']
 if action in ['get','delete']:p['attachment_id']=s(512);req+=['attachment_id']
 if action=='add':p.update({'filename':s(240),'content_type':{'type':'string','pattern':'^[A-Za-z0-9.+-]+/[A-Za-z0-9.+-]+$'},'content_base64':{'type':'string','minLength':4,'maxLength':64000,'pattern':'^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$'}});req+=['filename','content_type','content_base64']
 if action=='delete':p['confirm']={'const':True};req+=['confirm']
 add('graph.drafts.attachments.'+action,'graph','portal',action in ['add','delete'],p,req,True,[146,156],binding='draft')
for action in ['list','get','create','update','delete']:
 p={'cursor':s(4096)} if action=='list' else {} if action=='create' else {'rule_id':s(512)};req=[] if action=='list' else list(p)
 if action in ['create','update']:p.update({'display_name':s(160),'sender_email':{'type':'string','format':'email','maxLength':254},'enabled':b});req=list(p)
 if action=='delete':p['confirm']={'const':True};req+=['confirm']
 add('graph.mail_rules.'+action,'graph','owner',action in ['create','update','delete'],p,req,True,[146])
add('graph.delta.start','graph','owner',True,{'confirm':{'const':True}},['confirm'],True,[146])
add('graph.delta.next','graph','owner',True,{'sync_id':u,'expected_version':{'type':'integer','minimum':1}},['sync_id','expected_version'],True,[146],binding='graph_sync')
for family in ['account','phone']:add('whatsapp.'+family+'.get','whatsapp','owner',False,sensitive=True,requirements=[149])
for action in ['get','download']:add('whatsapp.messages.media.'+action,'whatsapp','portal',False,{'message_id':{'type':'string','pattern':'^[1-9][0-9]{0,18}$'}},['message_id'],True,[149],binding='whatsapp_message')
add('whatsapp.media.upload','whatsapp','portal',True,{'filename':s(240),'content_type':{'type':'string','enum':['image/jpeg','image/png','application/pdf','audio/ogg']},'content_base64':{'type':'string','minLength':4,'maxLength':64000,'pattern':'^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$'}},['filename','content_type','content_base64'],True,[149])
for action in ['get','download']:add('whatsapp.media.'+action,'whatsapp','portal',False,{'media_id':u},['media_id'],True,[149],binding='whatsapp_media')
add('graph.messages.search','graph','owner',False,{'query':s(240),'cursor':s(4096)},['query'],True,[146])
add('graph.drafts.create','graph','portal',True,{'recipient_address_id':u,'subject':s(240),'body_text':s(20000)},['recipient_address_id','subject','body_text'],True,[146],binding='recipient_address')
add('graph.drafts.forward_create','graph','portal',True,{'source_message_id':u,'recipient_address_id':u,'body_text':s(20000)},['source_message_id','recipient_address_id','body_text'],True,[146],binding='source_message')
add('graph.drafts.reply_all_create','graph','portal',True,{'source_message_id':u,'body_text':s(20000)},['source_message_id','body_text'],True,[146],binding='source_message')
# Local mailbox data is partitioned by persisted source ownership; shared mailbox browsing is owner-only.
for action in ['list','get']:
 add('graph.messages.'+action,'db' if action=='list' else 'graph','portal',False,{**page,'search':s(240),'direction':{'type':'string','enum':['incoming','outgoing','inbound','outbound']}} if action=='list' else {'message_id':u},() if action=='list' else ('message_id',),True,[146],binding='message' if action=='get' else 'none')
for action in ['mark_read','delete','move']:
 props={'message_id':u,'confirm':{'const':True}};req=['message_id','confirm']
 if action=='mark_read':props['is_read']=b;req+=['is_read']
 if action=='move':props['destination_folder_id']={'type':'string','enum':['archive','deleteditems']};req+=['destination_folder_id']
 add('graph.messages.'+action,'graph','portal',True,props,req,True,[146],binding='message')
for action in ['list','get','download']:
 p={'message_id':u,**page} if action=='list' else {'attachment_id':u}
 add('graph.attachments.'+action,'db' if action=='list' else 'graph','portal',False,p,['message_id'] if action=='list' else list(p),True,[146,156],binding='none' if action=='list' else 'attachment')
add('graph.drafts.reply_create','graph','portal',True,{'source_message_id':u,'body_text':s(20000)},['source_message_id','body_text'],True,[146],binding='source_message')
for action in ['get','update','delete','confirm_send','verify_sent']:
 p={'draft_id':u};req=['draft_id']
 if action=='update':p['body_text']=s(20000);req+=['body_text']
 if action in ['delete','confirm_send']:p['confirm']={'const':True};req+=['confirm']
 if action=='confirm_send':p.update({'max_provider_units':{'const':1},'expected_version':{'type':'integer','minimum':1},'reviewed_content_sha256':{'type':'string','pattern':'^[a-f0-9]{64}$'}});req+=['max_provider_units','expected_version','reviewed_content_sha256']
 add('graph.drafts.'+action,'graph','portal',action in ['update','delete','confirm_send'],p,req,True,[146],binding='draft',cost=action=='confirm_send')
for action in ['list','get','create','update','delete']:
 p={'cursor':s(4096)} if action=='list' else {'folder_id':s(512)};req=[] if action=='list' else ['folder_id']
 if action in ['create','update']:
  p={'display_name':s(255)} if action=='create' else {**p,'display_name':s(255)};req=list(p)
 if action=='delete':p['confirm']={'const':True};req+=['confirm']
 add('graph.mail_folders.'+action,'graph','owner',action in ['create','update','delete'],p,req,False,[146])
for action in ['get','ensure','delete']:
 add('graph.subscriptions.'+action,'graph','owner',action!='get',{} if action=='get' else {'confirm':{'const':True}},() if action=='get' else ('confirm',),False,[146])
for family in ['messages','identities','topics','requests']:
 add('whatsapp.'+family+'.list','db','portal',False,({'limit':page['limit'],'after_id':{'type':'string','pattern':'^[1-9][0-9]{0,18}$'}} if family=='messages' else {'limit':page['limit'],'after_wa_id':{'type':'string','pattern':'^[0-9]{6,20}$'}} if family=='identities' else page),(),True,[149])
 if family in ['messages','topics','requests']:add('whatsapp.'+family+'.get','db','portal',False,{'id':({'type':'string','pattern':'^[1-9][0-9]{0,18}$'} if family=='messages' else u)},['id'],True,[149])
add('whatsapp.messages.send_text','whatsapp','portal',True,{'text':s(3000),'requested_wa_id':{'type':'string','pattern':'^[0-9]{6,20}$'},'confirm_send':{'const':True},'max_provider_units':{'const':1}},['text','confirm_send','max_provider_units'],True,[149],cost=True)
add('whatsapp.messages.mark_read','whatsapp','portal',True,{'message_id':{'type':'string','pattern':'^[1-9][0-9]{0,18}$'},'confirm':{'const':True}},['message_id','confirm'],True,[149],binding='whatsapp_message')
add('whatsapp.templates.list','whatsapp','owner',False,{'after':s(4096)},requirements=[149]);add('whatsapp.templates.send','whatsapp','portal',True,{'template_name':{'type':'string','pattern':'^[a-z0-9_]{1,512}$'},'language_code':{'type':'string','pattern':'^[a-z]{2}(?:_[A-Z]{2})?$'},'requested_wa_id':{'type':'string','pattern':'^[0-9]{6,20}$'},'confirm_send':{'const':True},'max_provider_units':{'const':1}},['template_name','language_code','confirm_send','max_provider_units'],True,[149],cost=True)
add('commerce.invoice_forward.request','legacy_invoice','portal',True,{'source_message_id':u,'confirm_forward':{'const':True},'max_provider_units':{'const':1}},['source_message_id','confirm_forward','max_provider_units'],True,[158],binding='source_message',cost=True)
add('commerce.invoice_forward.receipt','db','portal',False,{'source_message_id':u},['source_message_id'],True,[158])
add('product.executions.get','receipt','authenticated',False,{'request_id':u},['request_id'],True,[144,159,161])
# Stable typed outer result. Per-resource fields remain projected by the executor.
for row in ops:
 resource = {'type':'object','properties':{'id':s(512),'state':s(80,0),'status':s(80,0),'display_name':s(240,0),'subject':s(1000,0),'created_at':{'anyOf':[dt,{'type':'null'}]},'updated_at':{'anyOf':[dt,{'type':'null'}]}},'additionalProperties':True}
 if row['operation'].startswith('support.'):
  resource={'type':'object','properties':{'id':u,'case_id':u,'subject':s(240),'details':s(8000),'body':s(8000),'category':{'enum':['account','billing','technical','privacy','other']},'state':{'enum':['open','closed']},'version':{'type':'integer','minimum':1},'created_at':dt,'updated_at':dt},'required':['id'],'additionalProperties':False}
 row['output_schema']={'type':'object','required':['ok','operation','contract_version','request_id','admission_id','request_state','executed','result','reconciliation_required'],'properties':{'ok':{'const':True},'operation':{'const':row['operation']},'contract_version':{'const':'1.0.0'},'request_id':u,'admission_id':u,'request_state':{'enum':['observed','accepted','failed','unknown','replayed']},'executed':{'type':['boolean','null']},'result':{'type':'object','properties':{'item':{'anyOf':[resource,{'type':'null'}]},'items':{'type':'array','maxItems':100,'items':resource},'changed':b,'next_cursor':{'type':['string','null']},'possibly_truncated':b,'provider_id':{'type':['string','null']},'provider_http_status':{'type':['integer','null'],'minimum':100,'maximum':599},'delivery_verified':b},'required':['item','items','changed','next_cursor','possibly_truncated','provider_id','provider_http_status','delivery_verified'],'additionalProperties':False},'reconciliation_required':b},'additionalProperties':False}
 row.pop('contract_sha256',None)
 row['contract_sha256']=hashlib.sha256(json.dumps(row,sort_keys=True,separators=(',',':'),ensure_ascii=False).encode()).hexdigest()
(root/'contracts.json').write_text(json.dumps({'operations':ops,'version':'1.0.0'},indent=2,ensure_ascii=False)+'\n')
print(json.dumps({'operations':len(ops),'reads':sum(not x['is_mutation'] for x in ops),'mutations':sum(x['is_mutation'] for x in ops)}))

# Keep the authored SQL boundary and generated registry in agreement with this
# fixed catalogue. This does not connect to any database or deploy anything.
repository=root.parents[2]
migration=repository/'supabase/migrations/20261021009000_sandy_product_service_boundary.sql'
if migration.exists():
 import re
 rows='\n'.join("INSERT INTO public.sandy_product_operation_contracts VALUES ('"+o['operation']+"','"+json.dumps(o,separators=(',',':'),ensure_ascii=False).replace("'","''")+"'::jsonb);" for o in ops)
 updated,count=re.subn(r'(?s)-- BEGIN GENERATED PRODUCT CONTRACTS\n.*?\n-- END GENERATED PRODUCT CONTRACTS',lambda _: '-- BEGIN GENERATED PRODUCT CONTRACTS\n'+rows+'\n-- END GENERATED PRODUCT CONTRACTS',migration.read_text())
 if count!=1:raise RuntimeError('private catalogue marker drift')
 migration.write_text(updated)
statements=[]
for o in ops:
 q=lambda v:"'"+str(v).replace("'","''")+"'"
 scope=('system:' if o['authorization']=='owner' else 'product:')+('write' if o['is_mutation'] else 'read')
 error={'contract_sha256':o['contract_sha256'],'requires_approval':o['authorization']=='owner' and (o['is_mutation'] or o['sensitive']),'api_key_delegable':False,'version':'1.0.0','requirement_ids':o['requirement_ids'],'requires_real_user_session':True,'authorization':o['authorization'],'source_review_only':True,'one_use_admission':True,'stable_idempotency_key':o['is_mutation'],'consumes_provider_units':o['consumes_provider_units'],'tenant_lifecycle_owner':'sandy-tenant-lifecycle-api','provider_submission_is_not_delivery':True,'pci_boundary':'no_cardholder_data_or_unconfigured_payment_processor'}
 row=[q(o['operation']),q(o['operation'].split('.')[0]),q(o['description']),q(scope),'true' if o['is_mutation'] else 'false',q(json.dumps(o['input_schema']))+'::jsonb',q(json.dumps(o['output_schema']))+'::jsonb',"'sandy-product-service-api'",'false','false','false','false',"'awaiting_deployment'","'ausstyle/web-staging'","'supabase/functions/sandy-product-service-api/index.ts'",q(json.dumps(['actual_confirmed_customer_Auth_JWT','independent_portal_tenant_binding','live_verification_before_exposure','server_configured_provider_and_tenant_policy']))+'::jsonb',q(json.dumps(error))+'::jsonb',q(json.dumps({'automatic':False,'safe_to_retry':False,'reason':'retrieve existing receipt and reconcile unknown provider outcomes; no redispatch'}))+'::jsonb',q(json.dumps({'applicable':False,'reason':'use explicit versioned restore where supported; no generic external compensation'}))+'::jsonb']
 statements.append('INSERT INTO public.sandy_operation_registry(operation,domain,description,permission_scope,is_mutation,input_schema,output_schema,handler,api_exposed,ui_exposed,ai_exposed,verified,implementation_state,source_repository,source_path,dependencies,error_contract,retry_policy,rollback_policy) VALUES('+','.join(row)+');')
(repository/'supabase/migrations/20261021009010_sandy_product_service_contracts.sql').write_text('-- Every new operation remains closed pending actual authenticated provider verification.\nBEGIN;\n'+'\n'.join(statements)+'\nCOMMIT;\n')
