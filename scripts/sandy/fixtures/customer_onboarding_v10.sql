CREATE OR REPLACE FUNCTION public.sandy_customer_onboarding_execute(p_operation text, p_arguments jsonb, p_request_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
DECLARE actor uuid:=auth.uid();account auth.users%ROWTYPE;portal public.sandy_memory_portal_accounts%ROWTYPE;
 address public.email_customer_addresses%ROWTYPE;customer uuid;prior public.sandy_customer_onboarding_receipts%ROWTYPE;
 profile public.sandy_customer_onboarding%ROWTYPE;result jsonb;channels jsonb;input_hash text;created boolean:=false;
BEGIN
 IF auth.role()<>'authenticated' OR actor IS NULL THEN RETURN jsonb_build_object('ok',false,'error','user_session_required','http_status',401);END IF;
 SELECT * INTO account FROM auth.users WHERE id=actor;
 IF NOT FOUND OR account.email_confirmed_at IS NULL OR account.is_anonymous OR account.raw_app_meta_data->>'sandy_engineering_test'='true' THEN RETURN jsonb_build_object('ok',false,'error','verified_customer_session_required','http_status',403);END IF;
 IF p_request_id IS NULL OR p_operation NOT IN('customer.onboarding.ensure','customer.onboarding.update','customer.identity.get') OR jsonb_typeof(p_arguments) IS DISTINCT FROM 'object' OR octet_length(p_arguments::text)>4096 THEN RETURN jsonb_build_object('ok',false,'error','invalid_onboarding_request','http_status',400);END IF;
 IF EXISTS(SELECT 1 FROM jsonb_object_keys(p_arguments) k WHERE k NOT IN('display_name','organisation_name','expected_version')) OR (p_operation='customer.identity.get' AND p_arguments<>'{}'::jsonb) OR (p_operation='customer.onboarding.update' AND NOT p_arguments?'expected_version') OR (p_arguments?'display_name' AND (jsonb_typeof(p_arguments->'display_name')<>'string' OR length(btrim(p_arguments->>'display_name')) NOT BETWEEN 1 AND 160)) OR (p_arguments?'organisation_name' AND (jsonb_typeof(p_arguments->'organisation_name')<>'string' OR length(btrim(p_arguments->>'organisation_name')) NOT BETWEEN 1 AND 160)) OR (p_arguments?'expected_version' AND (p_arguments->>'expected_version')!~'^[1-9][0-9]{0,8}$') THEN RETURN jsonb_build_object('ok',false,'error','invalid_onboarding_arguments','http_status',400);END IF;
 input_hash:=encode(extensions.digest(convert_to(p_arguments::text,'UTF8'),'sha256'),'hex');
 PERFORM pg_advisory_xact_lock(hashtextextended('sandy-onboarding-actor:'||actor::text,0));
 -- Authorization is current even when an immutable prior receipt is replayed.
 SELECT * INTO portal FROM public.sandy_memory_portal_accounts WHERE auth_user_id=actor FOR UPDATE;
 IF FOUND AND portal.revoked_at IS NOT NULL THEN RETURN jsonb_build_object('ok',false,'error','customer_access_revoked','http_status',403);END IF;
 IF portal.customer_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.email_customer_addresses WHERE customer_id=portal.customer_id AND is_primary AND normalized_email=lower(btrim(account.email))) THEN RETURN jsonb_build_object('ok',false,'error','identity_link_conflict','http_status',409);END IF;
 SELECT * INTO prior FROM public.sandy_customer_onboarding_receipts WHERE actor_id=actor AND request_id=p_request_id;
 IF FOUND THEN
  IF prior.operation<>p_operation OR prior.input_sha256<>input_hash THEN RETURN jsonb_build_object('ok',false,'error','request_id_conflict','http_status',409);END IF;
  RETURN prior.result||jsonb_build_object('reused',true,'executed',true,'request_state','succeeded','request_id',p_request_id,'reconciliation_required',false);
 END IF;
 IF (SELECT count(*) FROM public.sandy_customer_onboarding_audit WHERE actor_id=actor AND occurred_at>clock_timestamp()-interval '1 minute')>=30 THEN RETURN jsonb_build_object('ok',false,'error','onboarding_rate_limit','http_status',429);END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('sandy-onboarding-email:'||lower(btrim(account.email)),0));
 SELECT * INTO portal FROM public.sandy_memory_portal_accounts WHERE auth_user_id=actor FOR UPDATE;
 IF FOUND AND portal.revoked_at IS NOT NULL THEN RETURN jsonb_build_object('ok',false,'error','customer_access_revoked','http_status',403);END IF;
 SELECT * INTO address FROM public.email_customer_addresses WHERE normalized_email=lower(btrim(account.email)) FOR UPDATE;
 IF address.id IS NOT NULL AND NOT address.is_primary THEN RETURN jsonb_build_object('ok',false,'error','primary_channel_verification_required','http_status',403);END IF;
 IF portal.customer_id IS NOT NULL AND portal.customer_id IS DISTINCT FROM address.customer_id THEN RETURN jsonb_build_object('ok',false,'error','identity_link_conflict','http_status',409);END IF;
 customer:=coalesce(portal.customer_id,address.customer_id);
 IF customer IS NULL THEN
  IF p_operation<>'customer.onboarding.ensure' THEN RETURN jsonb_build_object('ok',false,'error','onboarding_required','http_status',409);END IF;
  -- The existing Drive trigger is preserved. Provisioning is explicitly excluded
  -- until an authorized feature/entitlement enables it; onboarding incurs no cost.
  INSERT INTO public.email_customers(display_name,google_drive_folder_status) VALUES(coalesce(p_arguments->>'display_name',split_part(account.email,'@',1)),'excluded') RETURNING id INTO customer;
  INSERT INTO public.email_customer_addresses(customer_id,email_address,is_primary,verified_at) VALUES(customer,account.email,true,clock_timestamp());
  INSERT INTO public.sandy_memory_settings(customer_id,learning_enabled,proactive_enabled) VALUES(customer,false,false) ON CONFLICT(customer_id) DO NOTHING;
  created:=true;
 END IF;
 IF portal.customer_id IS NULL THEN
  IF p_operation<>'customer.onboarding.ensure' THEN RETURN jsonb_build_object('ok',false,'error','onboarding_required','http_status',409);END IF;
  IF EXISTS(SELECT 1 FROM public.sandy_memory_portal_accounts WHERE customer_id=customer AND auth_user_id<>actor) THEN RETURN jsonb_build_object('ok',false,'error','identity_already_bound','http_status',409);END IF;
  INSERT INTO public.sandy_memory_portal_accounts(auth_user_id,customer_id) VALUES(actor,customer);
 END IF;
 IF p_operation IN('customer.onboarding.ensure','customer.onboarding.update') THEN
  INSERT INTO public.sandy_customer_onboarding(customer_id) VALUES(customer) ON CONFLICT DO NOTHING;
  SELECT * INTO profile FROM public.sandy_customer_onboarding WHERE customer_id=customer FOR UPDATE;
  IF p_operation='customer.onboarding.update' AND profile.version<>(p_arguments->>'expected_version')::integer THEN RETURN jsonb_build_object('ok',false,'error','onboarding_version_conflict','http_status',409);END IF;
  IF p_arguments?'display_name' THEN UPDATE public.email_customers SET display_name=btrim(p_arguments->>'display_name'),updated_at=clock_timestamp() WHERE id=customer;END IF;
  IF p_arguments?'organisation_name' OR p_arguments?'display_name' THEN UPDATE public.sandy_customer_onboarding SET organisation_name=coalesce(btrim(p_arguments->>'organisation_name'),organisation_name),phase=CASE WHEN p_arguments?'organisation_name' THEN 'ready' ELSE phase END,version=version+1,updated_at=clock_timestamp() WHERE customer_id=customer;END IF;
 END IF;
 SELECT * INTO profile FROM public.sandy_customer_onboarding WHERE customer_id=customer;
 SELECT jsonb_build_array(jsonb_build_object('channel','email','subject',account.email,'verified',true),jsonb_build_object('channel','web','subject',actor,'verified',true),jsonb_build_object('channel','api','subject',actor,'verified',true))||coalesce(jsonb_agg(jsonb_build_object('channel','whatsapp','subject',w.wa_id,'verified',true)),'[]'::jsonb) INTO channels FROM public.sandy_whatsapp_identities w WHERE w.customer_id=customer AND w.verification_status='verified' AND w.verified_at>clock_timestamp()-interval '90 days';
 result:=jsonb_build_object('ok',true,'contract_version','1.0.0','executed',true,'request_state','succeeded','request_id',p_request_id,'reconciliation_required',false,'customer_id',customer,'created',created,'reused',false,'phase',coalesce(profile.phase,'verified'),'version',coalesce(profile.version,0),'display_name',(SELECT display_name FROM public.email_customers WHERE id=customer),'organisation_name',profile.organisation_name,'channels',channels,'permissions_source','existing_verified_portal_and_channel_grants','memory_customer_id',customer,'automatic_provisioning',false);
 INSERT INTO public.sandy_customer_onboarding_receipts(actor_id,request_id,operation,input_sha256,result) VALUES(actor,p_request_id,p_operation,input_hash,result);
 INSERT INTO public.sandy_customer_onboarding_audit(actor_id,customer_id,request_id,operation,input_sha256) VALUES(actor,customer,p_request_id,p_operation,input_hash);
 RETURN result;
END $function$
