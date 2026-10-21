-- Exact-source guarded additive product runtime; no provider request or applied migration rewrite.
BEGIN;
DO $source_guard$ BEGIN
 IF md5(pg_get_functiondef('public.sandy_product_principal(text)'::regprocedure)) IS DISTINCT FROM '8ebfd7e1105ce55e358656626cc2f8bd' THEN RAISE EXCEPTION 'product_strict_source_drift:sandy_product_principal';END IF;
 IF md5(pg_get_functiondef('public.sandy_product_execute_db(uuid,uuid,jsonb,text,text)'::regprocedure)) IS DISTINCT FROM '0e5f6658d5526c2f5a61bcc2ea664e45' THEN RAISE EXCEPTION 'product_strict_source_drift:sandy_product_execute_db';END IF;
END $source_guard$;
CREATE FUNCTION public.sandy_product_bound_result(p_operation text,p_result jsonb,p_requested_limit integer) RETURNS jsonb
LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog,pg_temp AS $$
DECLARE result jsonb:=p_result;items jsonb:=p_result->'items';original_count integer:=jsonb_array_length(p_result->'items');kept integer;last_item jsonb;cursor text;truncated boolean:=coalesce((p_result->>'possibly_truncated')::boolean,false);budget integer:=192000;
BEGIN
 IF items IS NULL OR jsonb_typeof(items)<>'array' OR p_requested_limit NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION 'invalid_product_result_budget' USING ERRCODE='P0413';END IF;
 WHILE jsonb_array_length(items)>0 AND octet_length(result::text)>budget LOOP
  items:=items-(jsonb_array_length(items)-1);result:=jsonb_set(result,'{items}',items);truncated:=true;
 END LOOP;
 kept:=jsonb_array_length(items);
 IF octet_length(result::text)>budget OR(original_count>0 AND kept=0) THEN RAISE EXCEPTION 'product_response_record_too_large' USING ERRCODE='P0413';END IF;
 truncated:=truncated OR(original_count=p_requested_limit AND original_count>0);
 IF truncated AND kept>0 THEN
  last_item:=items->-1;
  cursor:=CASE WHEN p_operation='notifications.file_alerts.list' THEN replace(encode(convert_to(jsonb_build_object('file_id',last_item->>'file_id','process',last_item->>'process')::text,'UTF8'),'base64'),E'\n','') WHEN p_operation='whatsapp.identities.list' THEN last_item->>'wa_id' WHEN p_operation='product.configuration.providers.list' THEN last_item->>'provider_key' ELSE last_item->>'id' END;
  IF cursor IS NULL OR cursor='' THEN RAISE EXCEPTION 'product_result_cannot_continue' USING ERRCODE='P0413';END IF;
 ELSE cursor:=NULL;END IF;
 RETURN result||jsonb_build_object('items',items,'next_cursor',cursor,'possibly_truncated',truncated);
END $$;
REVOKE ALL ON FUNCTION public.sandy_product_bound_result(text,jsonb,integer) FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION public.sandy_product_principal(p_operation text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
DECLARE actor uuid:=auth.uid(); tenant uuid; config jsonb; email text;
BEGIN
 IF actor IS NULL OR auth.role() IS DISTINCT FROM 'authenticated' THEN RETURN NULL; END IF;
 SELECT lower(u.email) INTO email FROM auth.users u WHERE u.id=actor AND u.email_confirmed_at IS NOT NULL AND NOT coalesce(u.is_anonymous,false);
 IF email IS NULL THEN RETURN NULL; END IF;
 SELECT contract INTO config FROM public.sandy_product_operation_contracts WHERE operation=p_operation;
 IF config IS NULL THEN RETURN NULL; END IF;
 IF config->>'authorization'='owner' THEN
  IF NOT public.sandy_api_current_owner(actor) THEN RETURN NULL; END IF;
 ELSIF config->>'authorization'='portal' THEN
  SELECT p.customer_id INTO tenant FROM public.sandy_memory_portal_accounts p JOIN public.email_customer_addresses a ON a.customer_id=p.customer_id AND a.is_primary AND a.normalized_email=email WHERE p.auth_user_id=actor AND p.revoked_at IS NULL;
  IF tenant IS NULL THEN RETURN NULL; END IF;
 END IF;
 RETURN jsonb_build_object('actor_id',actor,'tenant_id',tenant);
END $function$;

CREATE OR REPLACE FUNCTION public.sandy_product_execute_db(p_admission_id uuid, p_grant_id uuid, p_arguments jsonb, p_canonical_arguments text, p_channel text DEFAULT 'api'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
DECLARE proof jsonb;admission public.sandy_api_execution_admissions%ROWTYPE;op text;tenant uuid;actor uuid;item jsonb;items jsonb:='[]';result jsonb;before_row jsonb;after_row jsonb;snapshot uuid;case_row public.sandy_product_support_cases%ROWTYPE;count_limit integer:=coalesce((p_arguments->>'limit')::integer,50);changed boolean:=false;cursor text;compound jsonb;finish_state text;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.sandy_api_execution_admissions a JOIN public.sandy_product_operation_contracts c ON c.operation=a.operation WHERE a.id=p_admission_id AND c.contract->>'executor'='db') THEN RETURN jsonb_build_object('ok',false,'error','not_a_database_product_operation','http_status',400);END IF;
 proof:=public.sandy_product_consume(p_admission_id,p_grant_id,p_arguments,p_canonical_arguments,p_channel);IF proof->>'ok' IS DISTINCT FROM 'true' THEN RETURN proof;END IF;
 SELECT * INTO admission FROM public.sandy_api_execution_admissions WHERE id=p_admission_id;op:=admission.operation;tenant:=admission.tenant_id;actor:=admission.actor_id;
 IF op='customer.profile.get' THEN SELECT jsonb_build_object('id',id,'display_name',display_name,'created_at',created_at,'updated_at',updated_at) INTO item FROM public.email_customers WHERE id=tenant;
 ELSIF op='customer.profile.update' THEN SELECT jsonb_build_object('id',id,'display_name',display_name,'created_at',created_at,'updated_at',updated_at) INTO before_row FROM public.email_customers WHERE id=tenant FOR UPDATE; UPDATE public.email_customers SET display_name=btrim(p_arguments->>'display_name'),updated_at=clock_timestamp() WHERE id=tenant RETURNING jsonb_build_object('id',id,'display_name',display_name,'created_at',created_at,'updated_at',updated_at) INTO item;changed:=true;
 ELSIF op='customer.addresses.list' THEN SELECT coalesce(jsonb_agg(to_jsonb(q) ORDER BY q.id),'[]') INTO items FROM(SELECT id,email_address,is_primary,verified_at,created_at FROM public.email_customer_addresses WHERE customer_id=tenant AND(p_arguments->>'after_id' IS NULL OR id>(p_arguments->>'after_id')::uuid) ORDER BY id LIMIT count_limit)q;
 ELSIF op='support.cases.create' THEN INSERT INTO public.sandy_product_support_cases(customer_id,subject,details,category) VALUES(tenant,btrim(p_arguments->>'subject'),p_arguments->>'details',p_arguments->>'category') RETURNING to_jsonb(sandy_product_support_cases.*)-'customer_id' INTO item;changed:=true;
 ELSIF op='support.cases.list' THEN SELECT coalesce(jsonb_agg(to_jsonb(q)-'customer_id' ORDER BY q.id),'[]') INTO items FROM(SELECT * FROM public.sandy_product_support_cases WHERE customer_id=tenant AND(p_arguments->>'state' IS NULL OR state=p_arguments->>'state') AND(p_arguments->>'category' IS NULL OR category=p_arguments->>'category') AND(p_arguments->>'search' IS NULL OR position(lower(p_arguments->>'search') IN lower(subject))>0) AND (p_arguments->>'after_id' IS NULL OR id>(p_arguments->>'after_id')::uuid) ORDER BY id LIMIT count_limit)q;
 ELSIF op IN ('support.cases.get','support.cases.update','support.cases.close','support.cases.reopen','support.comments.list','support.comments.create') THEN
  SELECT * INTO case_row FROM public.sandy_product_support_cases WHERE id=(p_arguments->>'case_id')::uuid AND customer_id=tenant FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'product_resource_not_found' USING ERRCODE='P0404';END IF;
  before_row:=to_jsonb(case_row)-'customer_id';
  IF op IN ('support.cases.update','support.cases.close','support.cases.reopen') THEN
   IF case_row.version<>(p_arguments->>'expected_version')::integer THEN RAISE EXCEPTION 'product_resource_version_conflict' USING ERRCODE='P0409';END IF;
   UPDATE public.sandy_product_support_cases SET subject=CASE WHEN op='support.cases.update' THEN btrim(p_arguments->>'subject') ELSE subject END,details=CASE WHEN op='support.cases.update' THEN p_arguments->>'details' ELSE details END,state=CASE WHEN op='support.cases.close' THEN 'closed' WHEN op='support.cases.reopen' THEN 'open' ELSE state END,version=version+1,updated_at=clock_timestamp() WHERE id=case_row.id RETURNING to_jsonb(sandy_product_support_cases.*)-'customer_id' INTO item;changed:=true;
  ELSIF op='support.comments.create' THEN INSERT INTO public.sandy_product_support_comments(case_id,actor_id,body) VALUES(case_row.id,actor,p_arguments->>'body') RETURNING to_jsonb(sandy_product_support_comments.*)-'actor_id' INTO item;changed:=true;
  ELSIF op='support.comments.list' THEN SELECT coalesce(jsonb_agg(to_jsonb(q)-'actor_id' ORDER BY q.id),'[]') INTO items FROM(SELECT * FROM public.sandy_product_support_comments WHERE case_id=case_row.id AND (p_arguments->>'after_id' IS NULL OR id>(p_arguments->>'after_id')::uuid) ORDER BY id LIMIT count_limit)q;
  ELSE item:=to_jsonb(case_row)-'customer_id';END IF;
 ELSIF op IN ('notifications.preferences.get','notifications.preferences.update') THEN
  SELECT to_jsonb(p)-'customer_id' INTO before_row FROM public.sandy_product_notification_preferences p WHERE customer_id=tenant FOR UPDATE;
  IF op='notifications.preferences.update' THEN INSERT INTO public.sandy_product_notification_preferences(customer_id,email_enabled,whatsapp_enabled,file_alerts_enabled) VALUES(tenant,(p_arguments->>'email_enabled')::boolean,(p_arguments->>'whatsapp_enabled')::boolean,(p_arguments->>'file_alerts_enabled')::boolean) ON CONFLICT(customer_id) DO UPDATE SET email_enabled=excluded.email_enabled,whatsapp_enabled=excluded.whatsapp_enabled,file_alerts_enabled=excluded.file_alerts_enabled,updated_at=clock_timestamp();changed:=true;END IF;
  SELECT to_jsonb(p)-'customer_id' INTO item FROM public.sandy_product_notification_preferences p WHERE customer_id=tenant;
  IF item IS NULL THEN item:=jsonb_build_object('email_enabled',false,'whatsapp_enabled',false,'file_alerts_enabled',true,'updated_at',NULL);END IF;
 ELSIF op LIKE 'notifications.inbox.%' THEN
  SELECT to_jsonb(n)-'customer_id' INTO before_row FROM public.sandy_product_notification_inbox n WHERE id=(p_arguments->>'notification_id')::uuid AND customer_id=tenant FOR UPDATE;
  IF op='notifications.inbox.acknowledge' THEN UPDATE public.sandy_product_notification_inbox SET acknowledged_at=coalesce(acknowledged_at,clock_timestamp()) WHERE id=(p_arguments->>'notification_id')::uuid AND customer_id=tenant;changed:=FOUND;END IF;
  SELECT coalesce(jsonb_agg(to_jsonb(q)-'customer_id' ORDER BY q.id),'[]') INTO items FROM(SELECT * FROM public.sandy_product_notification_inbox WHERE customer_id=tenant AND(p_arguments->>'notification_id' IS NULL OR id=(p_arguments->>'notification_id')::uuid) AND(p_arguments->>'after_id' IS NULL OR id>(p_arguments->>'after_id')::uuid) ORDER BY id LIMIT count_limit)q;
  IF op<>'notifications.inbox.list' THEN item:=items->0;items:='[]';IF item IS NULL THEN RAISE EXCEPTION 'product_resource_not_found' USING ERRCODE='P0404';END IF;END IF;
 ELSIF op LIKE 'notifications.quiet_hours.%' THEN
  SELECT to_jsonb(q)-'customer_id' INTO before_row FROM public.sandy_product_notification_quiet_hours q WHERE customer_id=tenant FOR UPDATE;
  IF op='notifications.quiet_hours.update' THEN
   IF NOT EXISTS(SELECT 1 FROM pg_timezone_names WHERE name=p_arguments->>'timezone') OR p_arguments->>'start_minute'=p_arguments->>'end_minute' THEN RAISE EXCEPTION 'invalid_quiet_hours' USING ERRCODE='22023';END IF;
   INSERT INTO public.sandy_product_notification_quiet_hours(customer_id,enabled,timezone,start_minute,end_minute) VALUES(tenant,(p_arguments->>'enabled')::boolean,p_arguments->>'timezone',(p_arguments->>'start_minute')::integer,(p_arguments->>'end_minute')::integer) ON CONFLICT(customer_id) DO UPDATE SET enabled=excluded.enabled,timezone=excluded.timezone,start_minute=excluded.start_minute,end_minute=excluded.end_minute,updated_at=clock_timestamp();changed:=true;
  END IF;
  SELECT to_jsonb(q)-'customer_id' INTO item FROM public.sandy_product_notification_quiet_hours q WHERE customer_id=tenant;
  IF item IS NULL THEN item:=jsonb_build_object('enabled',false,'timezone','UTC','start_minute',1320,'end_minute',420,'updated_at',NULL);END IF;
 ELSIF op LIKE 'notifications.subscriptions.%' THEN
  SELECT to_jsonb(q)-'customer_id' INTO before_row FROM public.sandy_product_notification_subscriptions q WHERE customer_id=tenant AND topic=p_arguments->>'topic' FOR UPDATE;
  IF op='notifications.subscriptions.update' THEN INSERT INTO public.sandy_product_notification_subscriptions(customer_id,topic,enabled) VALUES(tenant,p_arguments->>'topic',(p_arguments->>'enabled')::boolean) ON CONFLICT(customer_id,topic) DO UPDATE SET enabled=excluded.enabled,updated_at=clock_timestamp();changed:=true;END IF;
  SELECT coalesce(jsonb_agg(jsonb_build_object('topic',t,'enabled',coalesce(n.enabled,true),'updated_at',n.updated_at) ORDER BY t),'[]') INTO items FROM unnest(ARRAY['support','file_alerts','improvements'])t LEFT JOIN public.sandy_product_notification_subscriptions n ON n.customer_id=tenant AND n.topic=t;
 ELSIF op LIKE 'notifications.templates.%' THEN
  SELECT to_jsonb(t) INTO before_row FROM public.sandy_product_notification_templates t WHERE id=(p_arguments->>'template_id')::uuid FOR UPDATE;
  IF op='notifications.templates.create' THEN INSERT INTO public.sandy_product_notification_templates(name,body_text) VALUES(p_arguments->>'name',p_arguments->>'body_text') RETURNING to_jsonb(sandy_product_notification_templates.*) INTO item;changed:=true;
  ELSIF op IN ('notifications.templates.update','notifications.templates.delete') THEN UPDATE public.sandy_product_notification_templates SET body_text=coalesce(p_arguments->>'body_text',body_text),deleted_at=CASE WHEN op='notifications.templates.delete' THEN clock_timestamp() ELSE NULL END,version=version+1,updated_at=clock_timestamp() WHERE id=(p_arguments->>'template_id')::uuid AND version=(p_arguments->>'expected_version')::integer AND deleted_at IS NULL RETURNING to_jsonb(sandy_product_notification_templates.*) INTO item;IF item IS NULL THEN RAISE EXCEPTION 'product_resource_version_conflict' USING ERRCODE='P0409';END IF;changed:=true;
  ELSE SELECT coalesce(jsonb_agg(to_jsonb(q) ORDER BY q.id),'[]') INTO items FROM(SELECT * FROM public.sandy_product_notification_templates WHERE deleted_at IS NULL AND(p_arguments->>'template_id' IS NULL OR id=(p_arguments->>'template_id')::uuid) AND(p_arguments->>'after_id' IS NULL OR id>(p_arguments->>'after_id')::uuid) ORDER BY id LIMIT count_limit)q;IF op='notifications.templates.get' THEN item:=items->0;items:='[]';IF item IS NULL THEN RAISE EXCEPTION 'product_resource_not_found' USING ERRCODE='P0404';END IF;END IF;END IF;
 ELSIF op LIKE 'product.configuration.snapshots.%' THEN
  SELECT coalesce(jsonb_agg(to_jsonb(q)-'admission_id' ORDER BY q.id),'[]') INTO items FROM(SELECT * FROM public.sandy_product_configuration_snapshots WHERE(p_arguments->>'snapshot_id' IS NULL OR id=(p_arguments->>'snapshot_id')::uuid) AND(p_arguments->>'after_id' IS NULL OR id>(p_arguments->>'after_id')::uuid) ORDER BY id LIMIT count_limit)q;
  IF op='product.configuration.snapshots.get' THEN item:=items->0;items:='[]';IF item IS NULL THEN RAISE EXCEPTION 'product_resource_not_found' USING ERRCODE='P0404';END IF;END IF;
 ELSIF op LIKE 'notifications.file_alerts.%' THEN
  IF op='notifications.file_alerts.list' THEN
   IF p_arguments ? 'cursor' THEN compound:=convert_from(decode(p_arguments->>'cursor','base64'),'UTF8')::jsonb;IF jsonb_typeof(compound)<>'object' OR (SELECT count(*) FROM jsonb_object_keys(compound))<>2 OR NOT compound ? 'file_id' OR NOT compound ? 'process' THEN RAISE EXCEPTION 'invalid_cursor' USING ERRCODE='22023';END IF;END IF;
   SELECT coalesce(jsonb_agg(to_jsonb(q)-'owner_customer_id' ORDER BY q.file_id,q.process),'[]') INTO items FROM(SELECT * FROM public.sandy_file_processing_alerts WHERE owner_customer_id=tenant AND(p_arguments->>'severity' IS NULL OR severity=p_arguments->>'severity') AND(p_arguments->>'resolved' IS NULL OR(resolved_at IS NOT NULL)=(p_arguments->>'resolved')::boolean) AND(compound IS NULL OR (file_id,process)>((compound->>'file_id')::uuid,compound->>'process')) ORDER BY file_id,process LIMIT count_limit)q;
   IF jsonb_array_length(items)=count_limit THEN cursor:=replace(encode(convert_to(jsonb_build_object('file_id',items->-1->>'file_id','process',items->-1->>'process')::text,'UTF8'),'base64'),E'\n','');END IF;
  ELSE
   SELECT to_jsonb(a)-'owner_customer_id' INTO before_row FROM public.sandy_file_processing_alerts a WHERE owner_customer_id=tenant AND file_id=(p_arguments->>'file_id')::uuid AND process=p_arguments->>'process' FOR UPDATE;
   IF op IN ('notifications.file_alerts.resolve','notifications.file_alerts.reopen') THEN UPDATE public.sandy_file_processing_alerts SET resolved_at=CASE WHEN op='notifications.file_alerts.resolve' THEN clock_timestamp() ELSE NULL END WHERE owner_customer_id=tenant AND file_id=(p_arguments->>'file_id')::uuid AND process=p_arguments->>'process';changed:=FOUND;END IF;
   SELECT to_jsonb(a)-'owner_customer_id' INTO item FROM public.sandy_file_processing_alerts a WHERE owner_customer_id=tenant AND file_id=(p_arguments->>'file_id')::uuid AND process=p_arguments->>'process';IF item IS NULL THEN RAISE EXCEPTION 'product_resource_not_found' USING ERRCODE='P0404';END IF;
  END IF;
 ELSIF op LIKE 'notifications.improvements.%' THEN
  SELECT coalesce(jsonb_agg(to_jsonb(q) ORDER BY q.id),'[]') INTO items FROM(SELECT n.id,n.request_id,n.notice_kind,n.state,n.delivery_channel,n.message,n.created_at,n.sent_at FROM public.sandy_improvement_notifications n JOIN public.sandy_improvement_requests r ON r.id=n.request_id WHERE r.requester_customer_id=tenant AND(p_arguments->>'notification_id' IS NULL OR n.id=(p_arguments->>'notification_id')::uuid) AND(p_arguments->>'after_id' IS NULL OR n.id>(p_arguments->>'after_id')::uuid) ORDER BY n.id LIMIT count_limit)q;IF op LIKE '%.get' THEN item:=items->0;items:='[]';IF item IS NULL THEN RAISE EXCEPTION 'product_resource_not_found' USING ERRCODE='P0404';END IF;END IF;
 ELSIF op LIKE 'product.configuration.providers.%' THEN
  IF op='product.configuration.providers.list' THEN SELECT coalesce(jsonb_agg(to_jsonb(p) ORDER BY p.provider_key),'[]') INTO items FROM(SELECT * FROM public.email_ai_provider_config WHERE(p_arguments->>'after_provider_key' IS NULL OR provider_key>p_arguments->>'after_provider_key') ORDER BY provider_key LIMIT count_limit)p;
  ELSIF op='product.configuration.providers.get' THEN SELECT to_jsonb(p) INTO item FROM public.email_ai_provider_config p WHERE p.provider_key=p_arguments->>'provider_key';
  ELSE
   IF op='product.configuration.providers.restore' THEN SELECT s.before_row INTO before_row FROM public.sandy_product_configuration_snapshots s WHERE s.id=(p_arguments->>'snapshot_id')::uuid;IF before_row IS NULL THEN RAISE EXCEPTION 'product_resource_not_found' USING ERRCODE='P0404';END IF;ELSE before_row:=p_arguments;END IF;
   SELECT to_jsonb(p) INTO after_row FROM public.email_ai_provider_config p WHERE p.provider_key=before_row->>'provider_key' FOR UPDATE;
   IF after_row IS NULL THEN RAISE EXCEPTION 'product_resource_not_found' USING ERRCODE='P0404';END IF;
   IF (after_row->>'updated_at')::timestamptz<>(p_arguments->>'expected_updated_at')::timestamptz THEN RAISE EXCEPTION 'product_resource_version_conflict' USING ERRCODE='P0409';END IF;
   IF (before_row->>'is_default')::boolean AND EXISTS(SELECT 1 FROM public.email_ai_provider_config WHERE is_default AND provider_key<>before_row->>'provider_key') THEN RAISE EXCEPTION 'product_default_provider_conflict' USING ERRCODE='P0409';END IF;
   UPDATE public.email_ai_provider_config SET model_name=before_row->>'model_name',enabled=(before_row->>'enabled')::boolean,is_default=(before_row->>'is_default')::boolean,updated_at=clock_timestamp() WHERE provider_key=before_row->>'provider_key' RETURNING to_jsonb(email_ai_provider_config.*) INTO item;
   INSERT INTO public.sandy_product_configuration_snapshots(admission_id,provider_key,before_row,after_row) VALUES(admission.id,item->>'provider_key',after_row,item) RETURNING id INTO snapshot;changed:=true;
  END IF;
 ELSIF op='graph.messages.list' THEN SELECT coalesce(jsonb_agg(to_jsonb(q) ORDER BY q.id),'[]') INTO items FROM(SELECT id,direction,subject,sender_address,received_at,sent_at,created_at,delivery_status FROM public.email_messages WHERE customer_id=tenant AND(p_arguments->>'after_id' IS NULL OR id>(p_arguments->>'after_id')::uuid) AND(p_arguments->>'direction' IS NULL OR direction=p_arguments->>'direction') AND(p_arguments->>'search' IS NULL OR position(lower(p_arguments->>'search') IN lower(coalesce(subject,'')))>0) ORDER BY id LIMIT count_limit)q;
 ELSIF op='graph.attachments.list' THEN SELECT coalesce(jsonb_agg(to_jsonb(q) ORDER BY q.id),'[]') INTO items FROM(SELECT a.id,a.filename,a.content_type,a.byte_size,a.direction,a.created_at FROM public.email_ai_attachments a JOIN public.email_messages m ON m.id=a.message_id WHERE m.customer_id=tenant AND m.id=(p_arguments->>'message_id')::uuid AND(p_arguments->>'after_id' IS NULL OR a.id>(p_arguments->>'after_id')::uuid) ORDER BY a.id LIMIT count_limit)q;
 ELSIF op='commerce.invoice_forward.receipt' THEN SELECT coalesce(jsonb_agg(to_jsonb(q) ORDER BY q.id),'[]') INTO items FROM(SELECT r.id,r.status,r.provider_message_id,r.created_at,r.updated_at FROM public.sandy_email_action_receipts r JOIN public.email_messages m ON m.id=r.source_message_id WHERE m.customer_id=tenant AND m.id=(p_arguments->>'source_message_id')::uuid AND r.action_type='invoice_forward' AND(p_arguments->>'after_id' IS NULL OR r.id>(p_arguments->>'after_id')::uuid) ORDER BY r.id LIMIT count_limit)q;
 ELSIF op LIKE 'whatsapp.messages.%' THEN
  SELECT coalesce(jsonb_agg(to_jsonb(q) ORDER BY q.id::bigint),'[]') INTO items FROM(SELECT m.id::text AS id,m.meta_message_id,m.direction,m.message_type,m.body,m.processing_status,m.created_at FROM public.sandy_whatsapp_messages m WHERE m.phone_number_id='1360367063825981' AND EXISTS(SELECT 1 FROM public.sandy_whatsapp_identities i WHERE i.wa_id=m.sender_wa_id AND i.customer_id=tenant AND i.verification_status='verified') AND(p_arguments->>'id' IS NULL OR m.id=(p_arguments->>'id')::bigint) AND(p_arguments->>'after_id' IS NULL OR m.id>(p_arguments->>'after_id')::bigint) ORDER BY m.id LIMIT count_limit)q;
  IF op LIKE '%.get' THEN item:=items->0;items:='[]';IF item IS NULL THEN RAISE EXCEPTION 'product_resource_not_found' USING ERRCODE='P0404';END IF;END IF;
 ELSIF op='whatsapp.identities.list' THEN SELECT coalesce(jsonb_agg(to_jsonb(q) ORDER BY q.wa_id),'[]') INTO items FROM(SELECT wa_id,verification_status,verified_at,allowed_scopes,is_primary FROM public.sandy_whatsapp_identities WHERE customer_id=tenant AND(p_arguments->>'after_wa_id' IS NULL OR wa_id>p_arguments->>'after_wa_id') ORDER BY wa_id LIMIT count_limit)q;IF jsonb_array_length(items)=count_limit THEN cursor:=items->-1->>'wa_id';END IF;
 ELSIF op LIKE 'whatsapp.topics.%' THEN SELECT coalesce(jsonb_agg(to_jsonb(q) ORDER BY q.id),'[]') INTO items FROM(SELECT id,title,summary,created_at,updated_at FROM public.sandy_whatsapp_topics WHERE customer_id=tenant AND(p_arguments->>'id' IS NULL OR id=(p_arguments->>'id')::uuid) AND(p_arguments->>'after_id' IS NULL OR id>(p_arguments->>'after_id')::uuid) ORDER BY id LIMIT count_limit)q;IF op LIKE '%.get' THEN item:=items->0;items:='[]';IF item IS NULL THEN RAISE EXCEPTION 'product_resource_not_found' USING ERRCODE='P0404';END IF;END IF;
 ELSIF op LIKE 'whatsapp.requests.%' THEN SELECT coalesce(jsonb_agg(to_jsonb(q) ORDER BY q.id),'[]') INTO items FROM(SELECT id,status,requested_wa_id,resolved_wa_id,meta_message_id,error_code,created_at,updated_at FROM public.sandy_whatsapp_outbound_requests WHERE customer_id=tenant AND(p_arguments->>'id' IS NULL OR id=(p_arguments->>'id')::uuid) AND(p_arguments->>'after_id' IS NULL OR id>(p_arguments->>'after_id')::uuid) ORDER BY id LIMIT count_limit)q;IF op LIKE '%.get' THEN item:=items->0;items:='[]';IF item IS NULL THEN RAISE EXCEPTION 'product_resource_not_found' USING ERRCODE='P0404';END IF;END IF;
 ELSE RAISE EXCEPTION 'not_a_database_product_operation' USING ERRCODE='22023';END IF;
 IF item IS NULL AND jsonb_array_length(items)=0 AND op IN ('customer.profile.get','customer.profile.update','product.configuration.providers.get') THEN RAISE EXCEPTION 'product_resource_not_found' USING ERRCODE='P0404';END IF;
 IF cursor IS NULL AND jsonb_array_length(items)=count_limit AND items->-1 ? 'id' THEN cursor:=items->-1->>'id';END IF;
 IF changed AND op LIKE 'support.%' AND coalesce((SELECT enabled FROM public.sandy_product_notification_subscriptions WHERE customer_id=tenant AND topic='support'),true) THEN INSERT INTO public.sandy_product_notification_inbox(customer_id,topic,event,resource_id) VALUES(tenant,'support',op,(item->>'id')::uuid);END IF;
 result:=public.sandy_product_result(item,items,changed,cursor,jsonb_array_length(items)>=count_limit);
 IF snapshot IS NOT NULL THEN result:=jsonb_set(result,'{item,snapshot_id}',to_jsonb(snapshot),true);END IF;
 result:=public.sandy_product_bound_result(op,result,count_limit);
 IF admission.is_mutation THEN PERFORM public.sandy_product_record_mutation(admission.id,CASE WHEN op LIKE 'product.configuration.providers.%' THEN after_row WHEN op='support.comments.create' THEN NULL ELSE before_row END,CASE WHEN item IS NOT NULL THEN item ELSE items END);END IF;
 finish_state:=CASE WHEN admission.is_mutation THEN 'accepted' ELSE 'succeeded' END;
 proof:=public.sandy_api_finish_execution(admission.id,finish_state,200,NULL,encode(extensions.digest(result::text,'sha256'),'hex'));
 IF proof->>'ok' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'product_receipt_not_persisted' USING ERRCODE='P0503';END IF;
 INSERT INTO public.sandy_product_results(admission_id,result,created_at,executed) VALUES(admission.id,result,clock_timestamp(),true);
 RETURN jsonb_build_object('ok',true,'admission_id',admission.id,'request_id',admission.request_id,'request_state',CASE WHEN admission.is_mutation THEN 'accepted' ELSE 'observed' END,'executed',true,'result',result,'reconciliation_required',admission.is_mutation);
EXCEPTION WHEN SQLSTATE 'P0413' THEN
 -- The exception rolled back this function's consumed grant and any local effect.
 -- Reconsume the exact still-current proof before persisting a known failure.
 proof:=public.sandy_product_consume(p_admission_id,p_grant_id,p_arguments,p_canonical_arguments,p_channel);IF proof->>'ok' IS DISTINCT FROM 'true' THEN RETURN proof;END IF;
 SELECT * INTO admission FROM public.sandy_api_execution_admissions WHERE id=p_admission_id;
 result:=public.sandy_product_result(jsonb_build_object('state','failed','error','product_response_record_too_large'));
 proof:=public.sandy_api_finish_execution(admission.id,'failed',NULL,NULL,encode(extensions.digest(result::text,'sha256'),'hex'));IF proof->>'ok' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'product_failure_receipt_not_persisted';END IF;
 INSERT INTO public.sandy_product_results(admission_id,result,executed) VALUES(admission.id,result,false);
 RETURN jsonb_build_object('ok',false,'error','product_response_record_too_large','http_status',413,'request_id',admission.request_id,'admission_id',admission.id,'executed',false,'reconciliation_required',false);
 WHEN SQLSTATE 'P0404' THEN RETURN jsonb_build_object('ok',false,'error','product_resource_not_found','http_status',404);
 WHEN SQLSTATE 'P0409' THEN RETURN jsonb_build_object('ok',false,'error','product_resource_version_conflict','http_status',409);
 WHEN data_exception OR check_violation OR not_null_violation THEN RETURN jsonb_build_object('ok',false,'error','invalid_product_arguments','http_status',400);
END $function$;

COMMIT;
