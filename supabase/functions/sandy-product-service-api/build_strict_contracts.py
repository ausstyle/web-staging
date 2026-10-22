"""Build an additive1.1 product catalogue, never applied09000/09010 bytes."""
import copy,hashlib,json,pathlib
root=pathlib.Path(__file__).resolve().parent;repository=root.parents[2]
base=json.loads((root/'contracts.json').read_text())['operations']
metadata=json.loads((root/'strict_resource_metadata.json').read_text())['columns'];columns={(c['table_name'],c['column_name']):c for c in metadata}
obj=lambda p,required=None:{'type':'object','properties':p,'required':list(p) if required is None else list(required),'additionalProperties':False}
s=lambda maximum=65536,minimum=0:{'type':'string','minLength':minimum,'maxLength':maximum}
arr=lambda item,max=100,min=0:{'type':'array','items':item,'maxItems':max,'minItems':min}
const=lambda value:{'const':value}
enum=lambda *v:{'type':'string','enum':list(v)}
integer=lambda minimum=0,maximum=9007199254740991:{'type':'integer','minimum':minimum,'maximum':maximum}
u={'type':'string','format':'uuid'};dt={'type':'string','format':'date-time'};b={'type':'boolean'};null=const(None)
nullable=lambda x:{'anyOf':[x,null]}
code=s(160,1);pid=s(8192,1);version=integer(1);state=s(160,1);digest={'type':'string','pattern':'^[a-f0-9]{64}$'}
def projection(table,fields):
 result={}
 for field in fields.split():
  c=columns[table,field];kind=c['udt_name'];schema={'uuid':u,'timestamptz':dt,'bool':b,'int4':integer(),'int8':integer(),'text':s(),'_text':arr(s(240),100)}.get(kind)
  if schema is None:raise ValueError((table,field,kind))
  result[field]=nullable(schema) if c['is_nullable']=='YES' else schema
 return obj(result)
def narrow(schema,**props):
 result=copy.deepcopy(schema);result['properties'].update(props);return result
provider_config=projection('email_ai_provider_config','provider_key model_name enabled is_default created_at updated_at')
resource={};items={};provider_resources={}
def bind(ops,schema,rows=False):
 for op in ops.split():
  (items if rows else resource)[op]=copy.deepcopy(schema)
profile=projection('email_customers','id display_name created_at updated_at');bind('customer.profile.get customer.profile.update',profile)
bind('customer.addresses.list',projection('email_customer_addresses','id email_address is_primary verified_at created_at'),True)
case=projection('sandy_product_support_cases','id subject details category state version created_at updated_at');case=narrow(case,subject=s(240,1),details=s(8000,1),category=enum('account','billing','technical','privacy','other'),state=enum('open','closed'),version=version)
bind('support.cases.list',case,True);bind('support.cases.get support.cases.create support.cases.update support.cases.close support.cases.reopen',case)
resource['support.cases.update']=narrow(case,version=integer(2));resource['support.cases.create']=narrow(case,state=const('open'),version=const(1));resource['support.cases.close']=narrow(case,state=const('closed'),version=integer(2));resource['support.cases.reopen']=narrow(case,state=const('open'),version=integer(2))
comment=projection('sandy_product_support_comments','id case_id body created_at');comment=narrow(comment,body=s(8000,1));bind('support.comments.list',comment,True);bind('support.comments.create',comment)
prefs=projection('sandy_product_notification_preferences','email_enabled whatsapp_enabled file_alerts_enabled updated_at');prefs_get=narrow(prefs,updated_at=nullable(dt));bind('notifications.preferences.get',prefs_get);bind('notifications.preferences.update',prefs)
quiet=projection('sandy_product_notification_quiet_hours','enabled timezone start_minute end_minute updated_at');quiet=narrow(quiet,timezone=s(80,1),start_minute=integer(0,1439),end_minute=integer(0,1439));bind('notifications.quiet_hours.get',narrow(quiet,updated_at=nullable(dt)));bind('notifications.quiet_hours.update',quiet)
subscriptions=obj({'topic':enum('support','file_alerts','improvements'),'enabled':b,'updated_at':nullable(dt)});bind('notifications.subscriptions.list notifications.subscriptions.update',subscriptions,True)
inbox=projection('sandy_product_notification_inbox','id topic event resource_id acknowledged_at created_at');bind('notifications.inbox.list',inbox,True);bind('notifications.inbox.get notifications.inbox.acknowledge',inbox);resource['notifications.inbox.acknowledge']=narrow(inbox,acknowledged_at=dt)
template=projection('sandy_product_notification_templates','id name body_text version deleted_at created_at updated_at');template=narrow(template,name=s(80,2),body_text=s(8000,1),version=version);bind('notifications.templates.list',narrow(template,deleted_at=null),True);bind('notifications.templates.get notifications.templates.create notifications.templates.update',narrow(template,deleted_at=null));bind('notifications.templates.delete',narrow(template,deleted_at=dt))
file_alert=projection('sandy_file_processing_alerts','file_id process severity reason first_seen_at last_seen_at resolved_at');bind('notifications.file_alerts.list',file_alert,True);bind('notifications.file_alerts.get notifications.file_alerts.resolve notifications.file_alerts.reopen',file_alert);resource['notifications.templates.create']=narrow(resource['notifications.templates.create'],version=const(1));resource['notifications.templates.update']=narrow(resource['notifications.templates.update'],version=integer(2));resource['notifications.templates.delete']=narrow(resource['notifications.templates.delete'],version=integer(2));resource['notifications.file_alerts.resolve']=narrow(file_alert,resolved_at=dt);resource['notifications.file_alerts.reopen']=narrow(file_alert,resolved_at=null)
improvement=projection('sandy_improvement_notifications','id request_id notice_kind state delivery_channel message created_at sent_at');improvement=narrow(improvement,state=enum('pending','sending','sent','failed'));bind('notifications.improvements.list',improvement,True);bind('notifications.improvements.get',improvement)
bind('product.configuration.providers.list',provider_config,True);bind('product.configuration.providers.get',provider_config)
config_change=copy.deepcopy(provider_config);config_change['properties']['snapshot_id']=u;config_change['required'].append('snapshot_id');bind('product.configuration.providers.update product.configuration.providers.restore',config_change)
snapshot=obj({'id':u,'provider_key':s(160,1),'before_row':provider_config,'after_row':provider_config,'created_at':dt});bind('product.configuration.snapshots.list',snapshot,True);bind('product.configuration.snapshots.get',snapshot)
bind('graph.messages.list',projection('email_messages','id direction subject sender_address received_at sent_at created_at delivery_status'),True)
bind('graph.attachments.list',projection('email_ai_attachments','id filename content_type byte_size direction created_at'),True)
forward_receipt=projection('sandy_email_action_receipts','id status provider_message_id created_at updated_at');bind('commerce.invoice_forward.receipt',forward_receipt,True)
wa_message=projection('sandy_whatsapp_messages','meta_message_id direction message_type body processing_status created_at');wa_message['properties']={'id':{'type':'string','pattern':'^[1-9][0-9]{0,18}$'},**wa_message['properties']};wa_message['required'].append('id');bind('whatsapp.messages.list',wa_message,True);bind('whatsapp.messages.get',wa_message)
bind('whatsapp.identities.list',projection('sandy_whatsapp_identities','wa_id verification_status verified_at allowed_scopes is_primary'),True)
wa_topic=projection('sandy_whatsapp_topics','id title summary created_at updated_at');bind('whatsapp.topics.list',wa_topic,True);bind('whatsapp.topics.get',wa_topic)
wa_request=projection('sandy_whatsapp_outbound_requests','id status requested_wa_id resolved_wa_id meta_message_id error_code created_at updated_at');wa_request=narrow(wa_request,status=enum('claimed','submitted','failed','unknown'));bind('whatsapp.requests.list',wa_request,True);bind('whatsapp.requests.get',wa_request)
# Provider resource projections contain only the selected public fields. These
# schemas describe observed responses, never credential/context/provider URLs.
address=obj({'emailAddress':obj({'address':s(1024,1),'name':s(1024)},['address'])})
recipients=arr(address,1000);body=obj({'contentType':enum('text','html','Text','HTML'),'content':s(400000)})
message_props={'id':pid,'subject':nullable(s(1000)),'body':body,'bodyPreview':s(400000),'isRead':b,'isDraft':b,'internetMessageId':nullable(pid),'from':address,'sender':address,'replyTo':recipients,'toRecipients':recipients,'ccRecipients':recipients,'receivedDateTime':nullable(dt),'sentDateTime':nullable(dt),'categories':arr(s(240),100),'parentFolderId':pid}
message=obj(message_props,['id','subject','body','isRead','isDraft','toRecipients','ccRecipients'])
bind('graph.messages.get',message);bind('graph.messages.mark_read',obj(message_props,['id','isRead']));bind('graph.messages.set_categories',obj(message_props,['id','categories']));bind('graph.messages.move',obj(message_props,['id','parentFolderId']))
bind('graph.messages.search',obj({k:message_props[k] for k in ['id','subject','from','internetMessageId','receivedDateTime']},['id','subject','internetMessageId','receivedDateTime']),True)
deleted=obj({'id':pid,'state':const('deleted')});bind('graph.messages.delete graph.drafts.delete graph.drafts.attachments.delete graph.mail_folders.delete graph.mail_rules.delete',deleted)
attachment=obj({'id':pid,'name':s(1024),'contentType':s(240),'size':integer(),'isInline':b,'@odata.type':s(160)},['id','name','contentType','size','isInline'])
bind('graph.attachments.get graph.drafts.attachments.get graph.drafts.attachments.add',attachment);bind('graph.drafts.attachments.list',attachment,True)
bind('graph.attachments.download',obj({'id':u,'filename':s(1024),'content_type':s(240),'byte_size':integer(0,200000),'data_base64':{'type':'string','maxLength':266668,'pattern':'^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$'}}))
draft_preview=obj({**message_props,'id':u,'state':enum('draft','sending','submitted','sent','deleted','unknown','editing'),'version':version,'reviewed_content_sha256':digest,'attachments':arr(attachment,100)},['id','subject','body','from','toRecipients','ccRecipients','isDraft','state','version','reviewed_content_sha256','attachments'])
bind('graph.drafts.get',draft_preview);bind('graph.drafts.update',obj({**message_props,'id':u},['id','body']))
bind('graph.drafts.verify_sent',obj({'id':u,'state':state,'sent_confirmed':b,'sent_at':nullable(dt)}));bind('graph.drafts.confirm_send',obj({'id':u,'state':const('submitted')}))
draft_create=obj({'id':u,'state':const('draft'),'version':const(1),'recipients':arr({'type':'string','format':'email','maxLength':254},21,1)})
bind('graph.drafts.create graph.drafts.forward_create graph.drafts.reply_all_create',draft_create)
bind('graph.drafts.reply_create',obj({'id':u,'state':const('draft'),'version':const(1),'recipient':{'type':'string','format':'email','maxLength':254}}))
folder=obj({'id':pid,'displayName':s(1024),'parentFolderId':pid,'childFolderCount':integer(),'totalItemCount':integer(),'unreadItemCount':integer()},['id','displayName'])
bind('graph.mail_folders.list',folder,True);bind('graph.mail_folders.get graph.mail_folders.create graph.mail_folders.update',folder)
mailbox=obj({'id':pid,'displayName':s(1024),'mail':nullable(s(1024)),'userPrincipalName':s(1024)},['id','displayName','mail','userPrincipalName']);bind('graph.mailboxes.list',mailbox,True);bind('graph.mailboxes.get',mailbox)
predicates={k:arr(s(1024),100) for k in ['bodyContains','bodyOrSubjectContains','categories','headerContains','recipientContains','senderContains','subjectContains']}
predicates.update({k:recipients for k in ['fromAddresses','sentToAddresses']});predicates.update({k:b for k in ['hasAttachments','isApprovalRequest','isAutomaticForward','isAutomaticReply','isEncrypted','isMeetingRequest','isMeetingResponse','isNonDeliveryReport','isRead','isSigned','isVoicemail','notSentToMe','sentCcMe','sentOnlyToMe','sentToMe']});predicates.update({'importance':enum('low','normal','high'),'messageActionFlag':s(160),'sensitivity':s(160),'withinSizeRange':obj({'minimumSize':integer(),'maximumSize':integer()},[])})
actions={k:b for k in ['delete','markAsRead','permanentDelete','stopProcessingRules']};actions.update({k:pid for k in ['copyToFolder','moveToFolder']});actions.update({k:recipients for k in ['forwardAsAttachmentTo','forwardTo','redirectTo']});actions.update({'assignCategories':arr(s(240),100),'markImportance':enum('low','normal','high')})
rule=obj({'id':pid,'displayName':s(1024),'sequence':integer(),'isEnabled':b,'hasError':b,'isReadOnly':b,'conditions':obj(predicates,[]),'exceptions':obj(predicates,[]),'actions':obj(actions,[]),'unrepresented_rule_fields':b},['id','displayName','sequence','isEnabled','conditions','actions','unrepresented_rule_fields'])
bind('graph.mail_rules.list',rule,True);bind('graph.mail_rules.get graph.mail_rules.create',rule);bind('graph.mail_rules.update',obj({'id':pid,'state':const('update_submitted')}))
delta=obj({'id':pid,'subject':nullable(s(1000)),'internetMessageId':nullable(pid),'receivedDateTime':nullable(dt),'isRead':b,'categories':arr(s(240),100),'@removed':obj({'reason':s(160)},['reason'])},['id']);bind('graph.delta.start graph.delta.next',delta,True);bind('graph.delta.start graph.delta.next',obj({'id':u,'state':enum('ready','complete'),'version':version}))
subscription=obj({'id':pid,'resource':s(1024,1),'expirationDateTime':dt,'notificationUrl':{'type':'string','format':'uri','maxLength':4096}},['id','resource','expirationDateTime']);bind('graph.subscriptions.get',{'oneOf':[obj({'configured':const(False)}),subscription]});bind('graph.subscriptions.ensure',obj({k:subscription['properties'][k] for k in ['id','resource','expirationDateTime']}));bind('graph.subscriptions.delete',obj({'state':const('deleted')}))
bind('whatsapp.account.get',obj({'id':pid,'name':s(1024),'account_review_status':s(160)},['id','name']));bind('whatsapp.phone.get',obj({'id':pid,'verified_name':s(1024),'display_phone_number':s(160),'quality_rating':s(160),'code_verification_status':s(160)},['id','display_phone_number','code_verification_status']))
media=obj({'id':pid,'mime_type':s(240,1),'file_size':integer(),'sha256':s(160,1)})
bind('whatsapp.media.get whatsapp.messages.media.get',media);download=copy.deepcopy(media);download['properties'].update({'data_base64':{'type':'string','maxLength':266668,'pattern':'^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$'},'byte_size':integer(0,200000)});download['required']+=['data_base64','byte_size'];bind('whatsapp.media.download whatsapp.messages.media.download',download)
bind('whatsapp.media.upload',obj({'id':u,'filename':s(240,1),'content_type':s(240,1)}));bind('whatsapp.messages.send_text whatsapp.templates.send',obj({'status':const('submitted'),'request_id':u}));bind('whatsapp.messages.mark_read',obj({'id':{'type':'string','pattern':'^[1-9][0-9]{0,18}$'},'status':const('read_requested')}))
bind('whatsapp.templates.list',obj({'id':pid,'name':s(512,1),'status':s(160,1),'language':s(40,1),'category':s(160,1)}),True)
bind('commerce.invoice_forward.request',obj({'status':s(160,1),'payment_executed':const(False)}))
# Fixed provider-side safe projections are separate from post-finish schemas:
# SQL adds local UUID/version/receipt state after an actual accepted result.
for old in base:
 if old['executor'] not in ['db','receipt']:
  op=old['operation'];provider_resources[op]={'item':copy.deepcopy(resource.get(op,null)),'items':copy.deepcopy(items.get(op))}
  if op in ['graph.drafts.create','graph.drafts.forward_create','graph.drafts.reply_all_create']:
   provider_resources[op]['item']=obj({'state':const('draft'),'recipients':draft_create['properties']['recipients']})
  elif op=='graph.drafts.reply_create':provider_resources[op]['item']=obj({'state':const('draft'),'recipient':resource[op]['properties']['recipient']})
  elif op=='whatsapp.media.upload':provider_resources[op]['item']=obj({'filename':s(240,1),'content_type':s(240,1)})
  elif op.startswith('graph.delta.'):provider_resources[op]['item']=null
flags={'provider_id':nullable(pid),'provider_http_status':{'type':['integer','null'],'minimum':100,'maximum':599},'delivery_verified':const(False)}
def result_schema(op):
 return obj({'item':resource.get(op,null),'items':arr(items[op]) if op in items else arr(obj({}),0),'changed':b if next(o for o in base if o['operation']==op)['is_mutation'] else const(False),'next_cursor':nullable(s(4096,1)),'possibly_truncated':b,**flags})
empty=obj({'item':null,'items':arr(obj({}),0),'changed':const(False),'next_cursor':null,'possibly_truncated':const(False),**flags})
failed=obj({'item':obj({'state':enum('failed','unknown'),'error':s(160,1)}),'items':arr(obj({}),0),'changed':const(False),'next_cursor':null,'possibly_truncated':const(False),**flags})
success={o['operation']:result_schema(o['operation']) for o in base if o['executor']!='receipt'}
creation_ops={'graph.drafts.create','graph.drafts.forward_create','graph.drafts.reply_all_create','graph.drafts.reply_create'}
def failure_for(op):
 if op not in creation_ops:return failed
 partial=copy.deepcopy(failed);partial['properties']['item']=obj({'state':const('unknown'),'error':s(160,1),'id':u,'version':const(1)});return {'anyOf':[failed,partial]}
provider_result_schemas={op:obj({'item':shape['item'],'items':arr(shape['items']) if shape['items'] is not None else arr(obj({}),0),'changed':b if next(o for o in base if o['operation']==op)['is_mutation'] else const(False),'next_cursor':nullable(s(4096,1)),'possibly_truncated':b,**flags}) for op,shape in provider_resources.items()}
receipt=obj({'operation':enum(*[o['operation'] for o in base]),'state':enum('admitted','consumed','accepted','succeeded','failed','unknown','rejected'),'result':{'type':['object','null']},'redispatch_permitted':const(False),'created_at':dt,'finished_at':nullable(dt)})
receipt_defs={};receipt['allOf']=[]
for i,(op,schema) in enumerate(success.items()):
 name='original_'+str(i);receipt_defs[name]={'anyOf':[schema,failure_for(op),empty,null]};receipt['allOf'].append({'if':{'properties':{'operation':const(op)}},'then':{'properties':{'result':{'$ref':'#/$defs/'+name}}}})
receipt['allOf'].append({'if':{'properties':{'operation':const('product.executions.get')}},'then':{'properties':{'result':{'anyOf':[failed,null]}}}})
resource['product.executions.get']=receipt;success['product.executions.get']=result_schema('product.executions.get')
ops=[]
for old in base:
 o=copy.deepcopy(old);op=o['operation']
 if op=='commerce.invoice_forward.receipt':o['input_schema']['properties'].update({'limit':integer(1,100),'after_id':u})
 if op=='product.configuration.providers.list':o['input_schema']['properties'].update({'limit':integer(1,100),'after_provider_key':s(160,1)})
 o['contract_version']='1.1.0';o['description']+=' Required explicit public resource result schema v1.1.0.';o['result_schema']=resource.get(op,items.get(op));o['resource_schema_revision']='required_explicit_fields_v1';o['provider_result_schema']=provider_result_schemas.get(op);out=copy.deepcopy(o['output_schema']);out['properties']['contract_version']=const('1.1.0');out['properties']['result']={'anyOf':[success[op],failure_for(op),empty]} if o['executor']!='receipt' else success[op]
 if o['executor']=='receipt':out['properties']['request_state']=enum('replayed','unknown');out['$defs']=receipt_defs
 else:out['allOf']=[{'if':{'properties':{'request_state':{'enum':['observed','accepted']}}},'then':{'properties':{'result':success[op]}}}]
 o['output_schema']=out;o.pop('contract_sha256');o['contract_sha256']=hashlib.sha256(json.dumps(o,sort_keys=True,separators=(',',':'),ensure_ascii=False).encode()).hexdigest();ops.append(o)
(root/'strict_contracts.json').write_text(json.dumps({'version':'1.1.0','operations':ops,'provider_resources':provider_resources,'provider_result_schemas':provider_result_schemas},indent=2,ensure_ascii=False)+'\n')
# Catalogue migration generated only after fixed handwritten boundary exists.
q=lambda value:"'"+str(value).replace("'","''")+"'";rows=',\n'.join('('+q(o['operation'])+','+q(json.dumps(old,separators=(',',':'),ensure_ascii=False))+'::jsonb,'+q(json.dumps(o,separators=(',',':'),ensure_ascii=False))+'::jsonb)' for old,o in zip(base,ops))
sql='''-- Additive product resource-contract revision;09000/09010 bytes stay unchanged.
BEGIN;
CREATE TEMP TABLE sandy_product_strict_revision(operation text PRIMARY KEY,old_contract jsonb NOT NULL,new_contract jsonb NOT NULL) ON COMMIT DROP;
INSERT INTO sandy_product_strict_revision VALUES
'''+rows+''';
DO $strict_revision$
DECLARE revision record;current_contract jsonb;registry public.sandy_operation_registry%ROWTYPE;new_error jsonb;
BEGIN
 FOR revision IN SELECT * FROM pg_temp.sandy_product_strict_revision ORDER BY operation LOOP
  SELECT c.contract INTO current_contract FROM public.sandy_product_operation_contracts c WHERE c.operation=revision.operation FOR UPDATE;
  SELECT * INTO registry FROM public.sandy_operation_registry WHERE operation=revision.operation FOR UPDATE;
  IF current_contract IS DISTINCT FROM revision.old_contract AND current_contract IS DISTINCT FROM revision.new_contract THEN RAISE EXCEPTION 'strict_product_private_contract_drift:%',revision.operation;END IF;
  IF registry.handler IS DISTINCT FROM 'sandy-product-service-api' OR registry.input_schema IS DISTINCT FROM current_contract->'input_schema' OR registry.output_schema IS DISTINCT FROM current_contract->'output_schema' OR registry.error_contract->>'contract_sha256' IS DISTINCT FROM current_contract->>'contract_sha256' OR registry.permission_scope IS DISTINCT FROM(CASE WHEN current_contract->>'authorization'='owner' THEN 'system:' ELSE 'product:' END||CASE WHEN(current_contract->>'is_mutation')::boolean THEN 'write' ELSE 'read' END) OR registry.is_mutation IS DISTINCT FROM(current_contract->>'is_mutation')::boolean THEN RAISE EXCEPTION 'strict_product_registry_contract_drift:%',revision.operation;END IF;
  IF current_contract=revision.new_contract THEN CONTINUE;END IF;
  new_error:=registry.error_contract||jsonb_build_object('version','1.1.0','contract_sha256',revision.new_contract->>'contract_sha256','requires_real_user_session',true,'api_key_delegable',false,'requires_approval',(revision.new_contract->>'authorization'='owner' AND((revision.new_contract->>'is_mutation')::boolean OR(revision.new_contract->>'sensitive')::boolean)),'authorization',revision.new_contract->>'authorization','source_review_only',true,'required_explicit_resource_schema',true,'prior_contract_revision',jsonb_build_object('contract_sha256',current_contract->>'contract_sha256','error_contract',registry.error_contract,'verified',registry.verified,'last_verified_at',registry.last_verified_at));
  UPDATE public.sandy_product_operation_contracts SET contract=revision.new_contract WHERE operation=revision.operation;
  UPDATE public.sandy_operation_registry SET description=revision.new_contract->>'description',input_schema=revision.new_contract->'input_schema',output_schema=revision.new_contract->'output_schema',error_contract=new_error,source_path='supabase/functions/sandy-product-service-api/strict_entry.ts',api_exposed=false,ai_exposed=false,ui_exposed=false,verified=false,last_verified_at=NULL,implementation_state='awaiting_deployment' WHERE operation=revision.operation;
 END LOOP;
END $strict_revision$;
COMMIT;
'''
(repository/'supabase/migrations/20261021090200_sandy_product_strict_resource_contracts.sql').write_text(sql)
print(json.dumps({'operations':len(ops),'resource_items':len(resource),'resource_lists':len(items),'provider_projections':len(provider_resources),'applied_bytes_changed':False}))
