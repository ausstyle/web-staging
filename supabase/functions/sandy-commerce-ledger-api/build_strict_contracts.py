"""Additive1.1 strict resource contracts. Never rewrites applied09100/09110."""
import copy,json,hashlib,pathlib
root=pathlib.Path(__file__).resolve().parent;repo=root.parents[2]
base=json.loads((root/'contracts.json').read_text())['operations']
obj=lambda p,required=None:{'type':'object','properties':p,'required':list(p) if required is None else list(required),'additionalProperties':False}
arr=lambda schema,max=100,min=0:{'type':'array','items':schema,'maxItems':max,'minItems':min}
text=lambda maximum=240,minimum=1:{'type':'string','maxLength':maximum,'minLength':minimum}
enum=lambda *v:{'type':'string','enum':list(v)}
const=lambda v:{'const':v}
u={'type':'string','format':'uuid'};nu={'type':['string','null'],'format':'uuid'};dt={'type':'string','format':'date-time'};ndt={'type':['string','null'],'format':'date-time'};b={'type':'boolean'};integer=lambda min=0,max=2147483647:{'type':'integer','minimum':min,'maximum':max};version=integer(1);digest={'type':'string','pattern':'^[a-f0-9]{64}$'}
minor={'type':'string','pattern':'^(0|[1-9][0-9]*)$','maxLength':80};signed={'type':'string','pattern':'^-?(0|[1-9][0-9]*)$','maxLength':80};currency={'type':'string','pattern':'^[A-Z]{3}$'};exponent=integer(0,3);code={'type':'string','pattern':'^[a-z][a-z0-9_.:-]{1,79}$'}
shared_states=['admitted','consumed','accepted','succeeded','failed','unknown','rejected'];forward_states=['not_observed','claimed','sending','submitted','verified','needs_review','failed','unknown']
def override(schema,**props):
 s=copy.deepcopy(schema);s['properties'].update(props);return s
def narrow(schema,**props):return override(schema,**{k:const(v) for k,v in props.items()})
config=obj({'currency':currency,'minor_unit_exponent':exponent,'invoice_prefix':{'type':'string','pattern':'^[A-Z0-9-]{1,16}$'},'next_invoice_number':{'type':'string','pattern':'^[1-9][0-9]{0,18}$'},'default_terms_days':integer(0,365),'version':version,'created_at':dt,'updated_at':dt,'processor':const(None)})
config_empty=obj({'configured':const(False),'version':const(0),'processor':const(None)})
config_get=copy.deepcopy(config);config_get['properties']['configured']=const(True);config_get['required'].append('configured')
consent_flags={'invoice_forwarding_allowed':b,'automatic_renewal_recorded':b,'record_current':b,'terms_validated':const(False),'authorizes_processor_charge':const(False)}
consent_empty=obj({**consent_flags,'revision':const(0)});consent_empty=narrow(consent_empty,invoice_forwarding_allowed=False,automatic_renewal_recorded=False,record_current=False)
consent=obj({**consent_flags,'terms_version':code,'expires_at':dt,'revoked_at':ndt,'revision':version,'updated_at':dt})
consent['allOf']=[{'if':{'properties':{'revoked_at':{'type':'string'}}},'then':{'properties':{'record_current':const(False),'invoice_forwarding_allowed':const(False),'automatic_renewal_recorded':const(False)}}}]
account=obj({'id':u,'code':code,'name':text(240),'kind':enum('asset','liability','equity','income','expense'),'currency':currency,'minor_unit_exponent':exponent,'active':b,'version':version,'created_at':dt,'updated_at':dt})
journal_line=obj({'id':u,'account_id':u,'debit_minor':minor,'credit_minor':minor,'description':text(1000,0)})
journal_line['oneOf']=[{'properties':{'debit_minor':{'type':'string','pattern':'^[1-9][0-9]*$','maxLength':80},'credit_minor':const('0')}},{'properties':{'debit_minor':const('0'),'credit_minor':{'type':'string','pattern':'^[1-9][0-9]*$','maxLength':80}}}]
journal_summary=obj({'id':u,'description':text(2000),'external_reference':text(160),'effective_at':dt,'state':enum('draft','posted'),'currency':currency,'minor_unit_exponent':exponent,'version':version,'reversal_of':nu,'posted_at':ndt,'created_at':dt,'updated_at':dt})
# State-dependent timestamps are semantic, not merely nullable field presence.
journal_summary['allOf']=[{'if':{'properties':{'state':const('posted')}},'then':{'properties':{'posted_at':dt}}},{'if':{'properties':{'state':const('draft')}},'then':{'properties':{'posted_at':const(None)}}}]
journal=copy.deepcopy(journal_summary);journal['properties'].update({'lines':arr(journal_line,50,2),'record_type':const('internal_journal'),'provider_verified':const(False)});journal['required']+=['lines','record_type','provider_verified']
balance=obj({'id':u,'code':code,'name':text(240),'kind':enum('asset','liability','equity','income','expense'),'currency':currency,'minor_unit_exponent':exponent,'recorded_balance_minor':signed,'provider_verified':const(False)})
ledger=obj({'id':u,'entry_id':u,'external_reference':text(160),'effective_at':dt,'description':text(1000,0),'debit_minor':minor,'credit_minor':minor,'recorded_delta_minor':signed,'currency':currency,'minor_unit_exponent':exponent,'provider_verified':const(False)})
statement_summary=obj({'id':u,'account_id':u,'source_reference':text(160),'source_kind':const('manual_unverified'),'content_sha256':digest,'created_at':dt})
statement_line=obj({'id':u,'external_reference':text(160),'effective_at':dt,'amount_minor':signed,'description':text(1000,0)})
statement=copy.deepcopy(statement_summary);statement['properties'].update({'lines':arr(statement_line,50,1),'provider_verified':const(False)});statement['required']+=['lines','provider_verified']
match=obj({'statement_line_id':u,'external_reference':text(160),'amount_minor':signed,'state':enum('proposed_internal_match','ambiguous','unmatched'),'candidate_count':integer(0,9007199254740991),'candidate_entry_id':nu,'provider_verified':const(False)})
match['allOf']=[{'if':{'properties':{'state':const('proposed_internal_match')}},'then':{'properties':{'candidate_count':const(1),'candidate_entry_id':u}}},{'if':{'properties':{'state':const('unmatched')}},'then':{'properties':{'candidate_count':const(0),'candidate_entry_id':const(None)}}},{'if':{'properties':{'state':const('ambiguous')}},'then':{'properties':{'candidate_count':integer(2,9007199254740991),'candidate_entry_id':const(None)}}}]
recon_summary=obj({'id':u,'statement_id':u,'state':enum('proposed_internal','reviewed_internal'),'version':version,'reviewed_at':ndt,'created_at':dt})
recon_summary['allOf']=[{'if':{'properties':{'state':const('reviewed_internal')}},'then':{'properties':{'reviewed_at':dt,'version':integer(2)}}},{'if':{'properties':{'state':const('proposed_internal')}},'then':{'properties':{'reviewed_at':const(None)}}}]
recon=copy.deepcopy(recon_summary);recon['properties'].update({'matches':arr(match,50,1),'provider_verified':const(False)});recon['required']+=['matches','provider_verified']
preview=obj({'statement_id':u,'source_kind':const('manual_unverified'),'matches':arr(match,50,1),'state':const('preview_internal'),'provider_verified':const(False)})
invoice_line=obj({'description':text(1000),'quantity':integer(1,100000),'unit_minor':minor})
invoice_number={'type':['string','null'],'pattern':'^[A-Z0-9-]{1,16}-[1-9][0-9]{0,18}$'}
invoice=obj({'id':u,'counterparty_name':text(240),'external_reference':text(160),'currency':currency,'minor_unit_exponent':exponent,'items':arr(invoice_line,50,1),'subtotal_minor':minor,'tax_minor':minor,'discount_minor':minor,'total_minor':minor,'due_at':dt,'state':enum('draft','issued_internal','void'),'invoice_number':invoice_number,'version':version,'source_message_id':nu,'forwarding_status':enum(*forward_states),'payment_status':const('unverified'),'created_at':dt,'updated_at':dt,'tax_provenance':const('user_supplied_unverified'),'payment_executed':const(False),'provider_verified':const(False),'invoice_source_correspondence_verified':const(False),'source_linkage':const('customer_asserted')})
invoice['allOf']=[{'if':{'properties':{'state':const('draft')}},'then':{'properties':{'invoice_number':const(None)}}},{'if':{'properties':{'state':const('issued_internal')}},'then':{'properties':{'invoice_number':{'type':'string','pattern':invoice_number['pattern']}}}}]
forward_status=obj({'id':u,'forwarding_status':enum(*forward_states),'payment_status':const('unverified'),'payment_executed':const(False),'invoice_source_correspondence_verified':const(False),'source_linkage':const('customer_asserted')})
forward_receipt=obj({'id':u,'status':text(120),'provider_message_id':{'type':['string','null'],'maxLength':8192},'created_at':dt,'updated_at':dt})
plan=obj({'id':u,'code':code,'name':text(240),'description':text(4000),'active':b,'version':version,'created_at':dt,'updated_at':dt})
price_summary=obj({'id':u,'plan_id':u,'currency':currency,'minor_unit_exponent':exponent,'unit_minor':minor,'interval':enum('one_time','month','year'),'active':b,'created_at':dt})
price=copy.deepcopy(price_summary);price['properties']['provider_price_created']=const(False);price['required'].append('provider_price_created')
entitlement=obj({'id':u,'feature_key':code,'expires_at':dt,'revoked_at':ndt,'reason':text(1000),'version':version,'updated_at':dt})
entitlement_check=obj({'feature_key':code,'enabled':b,'source':const('explicit_internal_entitlement'),'payment_verified':const(False)})
capabilities=obj({'configured_processor':const(None),'internal_ledger':const(True),'processor_payments':const(False),'refunds':const(False),'payouts':const(False),'tax_attestation':const(False),'processor_entitlements':const(False),'required_configuration':{'const':['explicit_processor_selection','authorized_merchant_fixture','commercial_currency_and_tax_policy','provider_secret_reference','provider_test_session']},'payment_executed':const(False),'provider_verified':const(False)})
mutations=[o['operation'] for o in base if o['is_mutation']]
audit=obj({'id':u,'operation':enum(*mutations),'actor_kind':enum('owner','tenant'),'created_at':dt,'request_id':u,'state':enum(*shared_states),'result_sha256':digest})
null=const(None);empty_items=arr(obj({}),0)
flags={'source':const('internal_commerce_records'),'payment_executed':const(False),'provider_verified':const(False)}
def result_schema(item=null,items=None,changed=b,cursor=nu):
 r=obj({'item':item,'items':arr(items) if items is not None else empty_items,'changed':changed,'next_cursor':cursor,'possibly_truncated':b if items is not None else const(False),**flags})
 if items is not None:r['allOf']=[{'if':{'properties':{'possibly_truncated':const(True)}},'then':{'properties':{'next_cursor':u}}},{'if':{'properties':{'possibly_truncated':const(False)}},'then':{'properties':{'next_cursor':const(None)}}}]
 return r
empty_result=result_schema(changed=const(False),cursor=const(None));empty_result['properties']['possibly_truncated']=const(False)
error_item=obj({'error':enum('commerce_resource_not_found','commerce_state_or_version_conflict','commerce_configuration_required','invalid_commerce_state_or_arguments','commerce_response_record_too_large'),'internal_effect_committed':const(False)})
failure_result=result_schema(error_item,changed=const(False),cursor=const(None));failure_result['properties']['possibly_truncated']=const(False)
success={}
for o in base:
 op=o['operation'];action=op.rsplit('.',1)[-1];item=null;rows=None
 if op=='commerce.configuration.get':item={'oneOf':[config_empty,config_get]}
 elif op=='commerce.configuration.update':item=config
 elif op=='commerce.consent.get':item={'oneOf':[consent_empty,consent]}
 elif op=='commerce.consent.set':item=override(consent,revoked_at=const(None))
 elif op=='commerce.consent.revoke':item={'oneOf':[consent_empty,override(narrow(consent,record_current=False,invoice_forwarding_allowed=False,automatic_renewal_recorded=False),revoked_at=dt)]}
 elif op.startswith('commerce.accounts.'):
  if action=='list':rows=account
  else:item=account
  if action=='create':item=narrow(item,active=True,version=1)
  if action=='close':item=override(narrow(item,active=False),version=integer(2))
  if action=='update':item=override(item,version=integer(2))
 elif op.startswith('commerce.entries.'):
  if action=='list':rows=journal_summary
  elif action=='delete':item=obj({'id':u,'state':const('deleted_draft')})
  else:item=journal
  if action in ['create','update']:item=narrow(item,state='draft',posted_at=None,reversal_of=None)
  if action=='create':item=narrow(item,version=1)
  if action=='post':item=override(narrow(item,state='posted'),posted_at=dt)
  if action=='reverse':item=override(narrow(item,state='posted',version=2),posted_at=dt,reversal_of=u)
  if action in ['post','update']:item=override(item,version=integer(2))
 elif op=='commerce.reports.trial_balance':rows=balance
 elif op=='commerce.reports.income_expense':rows=override(balance,kind=enum('income','expense'))
 elif op=='commerce.reports.account_ledger':rows=ledger
 elif op.startswith('commerce.statements.'):
  if action=='list':rows=statement_summary
  elif action=='delete':item=obj({'id':u,'state':const('deleted_unreconciled_manual_statement')})
  else:item=statement
 elif op.startswith('commerce.reconciliation.'):
  if action=='list':rows=recon_summary
  elif action=='preview':item=preview
  else:item=recon
  if action=='run':item=narrow(item,state='proposed_internal',version=1,reviewed_at=None)
  if action=='review':item=override(narrow(item,state='reviewed_internal'),reviewed_at=dt,version=integer(2))
 elif op=='commerce.invoices.forwarding_status.get':item=forward_status;rows=forward_receipt
 elif op.startswith('commerce.invoices.'):
  if action=='list':rows=invoice
  else:item=invoice
  if action in ['create','update']:item=narrow(item,state='draft',invoice_number=None)
  if action=='create':item=narrow(item,version=1)
  if action=='issue':item=override(narrow(item,state='issued_internal'),invoice_number={'type':'string','pattern':invoice_number['pattern']})
  if action=='void':item=narrow(item,state='void')
  if action in ['update','issue','void','reconcile_forwarding_status']:item=override(item,version=integer(2))
 elif op.startswith('commerce.plans.'):
  if action=='list':rows=plan
  else:item=plan
  if action=='create':item=narrow(item,active=True,version=1)
  if action=='archive':item=narrow(item,active=False)
  if action in ['update','archive']:item=override(item,version=integer(2))
 elif op.startswith('commerce.prices.'):
  if action=='list':rows=price_summary
  else:item=price
  if action=='create':item=narrow(item,active=True)
  if action=='archive':item=narrow(item,active=False)
 elif op=='commerce.entitlements.list':rows=entitlement
 elif op=='commerce.entitlements.check':item=entitlement_check
 elif op=='commerce.entitlements.grant':item=override(entitlement,revoked_at=const(None))
 elif op=='commerce.entitlements.revoke':item=override(entitlement,revoked_at=dt,version=integer(2))
 elif op=='commerce.processor.capabilities':item=capabilities
 elif op=='commerce.audit.list':rows=audit
 elif op=='commerce.executions.get':continue
 else:raise ValueError(op)
 success[op]=result_schema(item,rows,changed=b if o['is_mutation'] else const(False),cursor=nu if rows is not None else const(None))
# Complete original-result readback is selected by original operation, including
# known failed/pending attempts. Receipt lookup never creates a receipt-of-receipt.
receipt_item=obj({'operation':enum(*[o['operation'] for o in base]),'state':enum(*shared_states),'result':{'type':['object','null']},'redispatch_permitted':const(False),'created_at':dt,'finished_at':ndt})
receipt_item['allOf']=[]
receipt_defs={}
for i,(op,schema) in enumerate(success.items()):
 name='original_result_'+str(i);receipt_defs[name]={'anyOf':[schema,failure_result,null]};receipt_item['allOf'].append({'if':{'properties':{'operation':const(op)}},'then':{'properties':{'result':{'$ref':'#/$defs/'+name}}}})
receipt_item['allOf'].append({'if':{'properties':{'operation':const('commerce.executions.get')}},'then':{'properties':{'result':{'anyOf':[failure_result,null]}}}})
success['commerce.executions.get']=result_schema(receipt_item,changed=const(False),cursor=const(None))
ops=[]
for original in base:
 o=copy.deepcopy(original);op=o['operation'];o['version']='1.1.0';o['description']=o['description']+' Required explicit resource result schema v1.1.0.';o['resource_schema_revision']='required_explicit_fields_v1'
 old=o['output_schema'];out=copy.deepcopy(old);out['properties']['contract_version']=const('1.1.0')
 out['properties']['result']={'anyOf':[success[op],failure_result,empty_result]} if op!='commerce.executions.get' else success[op]
 if op=='commerce.executions.get':out['properties']['request_state']=enum('replayed','unknown');out['$defs']=receipt_defs
 else:
  out['properties']['request_state']=enum('accepted','replayed') if o['is_mutation'] else enum('observed','replayed')
  out['allOf']=[{'if':{'properties':{'executed':const(True)}},'then':{'properties':{'result':success[op]}}},{'if':{'properties':{'executed':{'enum':[False,None]}}},'then':{'properties':{'request_state':const('replayed'),'result':{'anyOf':[failure_result,empty_result]}}}}]
 o['output_schema']=out;o.pop('contract_sha256',None);o['contract_sha256']=hashlib.sha256(json.dumps(o,sort_keys=True,separators=(',',':'),ensure_ascii=False).encode()).hexdigest();ops.append(o)
(root/'strict_contracts.json').write_text(json.dumps({'version':'1.1.0','operations':ops},indent=2)+'\n')
q=lambda v:"'"+str(v).replace("'","''")+"'";newrows=',\n'.join('('+q(o['operation'])+','+q(json.dumps(old,separators=(',',':')))+'::jsonb,'+q(json.dumps(o,separators=(',',':')))+'::jsonb)' for old,o in zip(base,ops))
text='''-- Additive strict result-schema revision;09100/09110 bytes remain unchanged.
BEGIN;
CREATE TEMP TABLE sandy_commerce_strict_revision(operation text PRIMARY KEY,old_contract jsonb NOT NULL,new_contract jsonb NOT NULL) ON COMMIT DROP;
INSERT INTO sandy_commerce_strict_revision VALUES
'''+newrows+''';
DO $strict_revision$
DECLARE revision record;current_contract jsonb;registry public.sandy_operation_registry%ROWTYPE;new_error jsonb;
BEGIN
 FOR revision IN SELECT * FROM pg_temp.sandy_commerce_strict_revision ORDER BY operation LOOP
  SELECT c.contract INTO current_contract FROM public.sandy_commerce_contracts c WHERE c.operation=revision.operation FOR UPDATE;
  SELECT * INTO registry FROM public.sandy_operation_registry WHERE operation=revision.operation FOR UPDATE;
  IF current_contract IS DISTINCT FROM revision.old_contract AND current_contract IS DISTINCT FROM revision.new_contract THEN RAISE EXCEPTION 'strict_commerce_private_contract_drift:%',revision.operation;END IF;
  IF registry.handler IS DISTINCT FROM 'sandy-commerce-ledger-api' OR registry.input_schema IS DISTINCT FROM current_contract->'input_schema' OR registry.output_schema IS DISTINCT FROM current_contract->'output_schema' OR registry.error_contract->>'contract_sha256' IS DISTINCT FROM current_contract->>'contract_sha256' OR registry.permission_scope IS DISTINCT FROM current_contract->>'permission_scope' OR registry.is_mutation IS DISTINCT FROM(current_contract->>'is_mutation')::boolean THEN RAISE EXCEPTION 'strict_commerce_registry_contract_drift:%',revision.operation;END IF;
  IF current_contract=revision.new_contract THEN CONTINUE;END IF;
  new_error:=jsonb_build_object('version','1.1.0','contract_sha256',revision.new_contract->>'contract_sha256','requires_approval',(revision.new_contract->>'requires_approval')::boolean,'api_key_delegable',false,'requirement_ids',revision.new_contract->'requirement_ids','requires_real_user_session',true,'source_review_only',true,'provider_neutral_internal_records_only',true,'processor_configured',false,'payment_executed',false,'provider_verified',false,'pci_boundary','no_cardholder_or_processor_secret_fields','stable_uuid_idempotency',(revision.new_contract->>'is_mutation')::boolean,'required_explicit_resource_schema',true,'prior_contract_revision',jsonb_build_object('contract_sha256',current_contract->>'contract_sha256','error_contract',registry.error_contract,'last_verified_at',registry.last_verified_at,'verified',registry.verified));
  UPDATE public.sandy_commerce_contracts SET contract=revision.new_contract WHERE operation=revision.operation;
  UPDATE public.sandy_operation_registry SET description=revision.new_contract->>'description',input_schema=revision.new_contract->'input_schema',output_schema=revision.new_contract->'output_schema',error_contract=new_error,source_path='supabase/functions/sandy-commerce-ledger-api/strict_entry.ts',api_exposed=false,ui_exposed=false,ai_exposed=false,verified=false,last_verified_at=NULL,implementation_state='awaiting_deployment' WHERE operation=revision.operation;
 END LOOP;
END $strict_revision$;
COMMIT;
'''
(repo/'supabase/migrations/20261021009120_sandy_commerce_strict_result_contracts.sql').write_text(text)
print(json.dumps({'operations':len(ops),'version':'1.1.0','strict_resources':len(success),'applied_migrations_rewritten':False,'bytes':len(text.encode())}))
