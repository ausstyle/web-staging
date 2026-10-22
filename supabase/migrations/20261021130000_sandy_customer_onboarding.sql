-- Extend the existing canonical customer, portal, verified email and WhatsApp
-- identity architecture. Unverified contacts never become authorized customers.
BEGIN;
CREATE TABLE public.sandy_customer_onboarding (
 customer_id uuid PRIMARY KEY REFERENCES public.email_customers(id) ON DELETE CASCADE,
 phase text NOT NULL DEFAULT 'verified' CHECK(phase IN('verified','ready')),
 organisation_name text CHECK(length(organisation_name)<=160),
 version integer NOT NULL DEFAULT 1 CHECK(version>0),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(), updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE public.sandy_customer_provisional_contacts (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), channel text NOT NULL CHECK(channel IN('email','whatsapp','voice')),
 subject text NOT NULL CHECK(length(subject) BETWEEN 3 AND 320),
 first_observed_at timestamptz NOT NULL DEFAULT clock_timestamp(),last_observed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(channel,subject)
);
CREATE TABLE public.sandy_customer_contact_events (
 channel text NOT NULL, provider_event_id text NOT NULL CHECK(length(provider_event_id) BETWEEN 1 AND 180),
 contact_id uuid NOT NULL REFERENCES public.sandy_customer_provisional_contacts(id),
 observed_at timestamptz NOT NULL DEFAULT clock_timestamp(), PRIMARY KEY(channel,provider_event_id)
);
CREATE TABLE public.sandy_customer_onboarding_receipts (
 actor_id uuid NOT NULL,request_id uuid NOT NULL,operation text NOT NULL,input_sha256 text NOT NULL,
 result jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT clock_timestamp(),PRIMARY KEY(actor_id,request_id)
);
CREATE TABLE public.sandy_customer_onboarding_audit (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,actor_id uuid NOT NULL,customer_id uuid,
 request_id uuid NOT NULL,operation text NOT NULL,input_sha256 text NOT NULL,
 occurred_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
ALTER TABLE public.sandy_customer_onboarding ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sandy_customer_provisional_contacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sandy_customer_contact_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sandy_customer_onboarding_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sandy_customer_onboarding_audit ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.sandy_customer_onboarding,public.sandy_customer_provisional_contacts,public.sandy_customer_contact_events,public.sandy_customer_onboarding_receipts,public.sandy_customer_onboarding_audit FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.sandy_customer_onboarding,public.sandy_customer_provisional_contacts,public.sandy_customer_contact_events,public.sandy_customer_onboarding_receipts,public.sandy_customer_onboarding_audit TO service_role;

-- Service ingress may observe a provider-authenticated event, but observation
-- grants no memory, customer session, account link, or customer creation rights.
CREATE FUNCTION public.sandy_customer_contact_observe(p_channel text,p_subject text,p_provider_event_id text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE v_subject text;contact uuid;prior public.sandy_customer_contact_events%ROWTYPE;
BEGIN
 IF p_channel IS NULL OR p_channel NOT IN('email','whatsapp','voice') OR p_subject IS NULL OR p_provider_event_id IS NULL OR length(p_provider_event_id) NOT BETWEEN 1 AND 180 THEN RETURN jsonb_build_object('ok',false,'error','invalid_contact');END IF;
 v_subject:=CASE WHEN p_channel='email' THEN lower(btrim(p_subject)) ELSE btrim(p_subject) END;
 IF length(v_subject) NOT BETWEEN 3 AND 320 OR (p_channel='email' AND v_subject!~'^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$') OR (p_channel IN('whatsapp','voice') AND v_subject!~'^\+?[1-9][0-9]{6,14}$') THEN RETURN jsonb_build_object('ok',false,'error','invalid_contact');END IF;
 IF p_channel IN('whatsapp','voice') THEN v_subject:=ltrim(v_subject,'+');END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('sandy-contact:'||p_channel||':'||p_provider_event_id,0));
 SELECT * INTO prior FROM public.sandy_customer_contact_events WHERE channel=p_channel AND provider_event_id=p_provider_event_id;
 IF FOUND THEN
  IF NOT EXISTS(SELECT 1 FROM public.sandy_customer_provisional_contacts c WHERE c.id=prior.contact_id AND c.subject=v_subject AND c.channel=p_channel) THEN RETURN jsonb_build_object('ok',false,'error','provider_event_conflict');END IF;
  RETURN jsonb_build_object('ok',true,'contact_id',prior.contact_id,'state','provisional','authorized',false,'reused',true);
 END IF;
 INSERT INTO public.sandy_customer_provisional_contacts(channel,subject) VALUES(p_channel,v_subject) ON CONFLICT(channel,subject) DO UPDATE SET last_observed_at=clock_timestamp() RETURNING id INTO contact;
 INSERT INTO public.sandy_customer_contact_events(channel,provider_event_id,contact_id) VALUES(p_channel,p_provider_event_id,contact);
 RETURN jsonb_build_object('ok',true,'contact_id',contact,'state','provisional','authorized',false,'reused',false);
END $$;
REVOKE ALL ON FUNCTION public.sandy_customer_contact_observe(text,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.sandy_customer_contact_observe(text,text,text) TO service_role;

CREATE FUNCTION public.sandy_customer_onboarding_execute(p_operation text,p_arguments jsonb,p_request_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
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
  RETURN prior.result||jsonb_build_object('reused',true);
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
 result:=jsonb_build_object('ok',true,'contract_version','1.0.0','customer_id',customer,'created',created,'reused',false,'phase',coalesce(profile.phase,'verified'),'version',coalesce(profile.version,0),'display_name',(SELECT display_name FROM public.email_customers WHERE id=customer),'organisation_name',profile.organisation_name,'channels',channels,'permissions_source','existing_verified_portal_and_channel_grants','memory_customer_id',customer,'automatic_provisioning',false);
 INSERT INTO public.sandy_customer_onboarding_receipts(actor_id,request_id,operation,input_sha256,result) VALUES(actor,p_request_id,p_operation,input_hash,result);
 INSERT INTO public.sandy_customer_onboarding_audit(actor_id,customer_id,request_id,operation,input_sha256) VALUES(actor,customer,p_request_id,p_operation,input_hash);
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.sandy_customer_onboarding_execute(text,jsonb,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.sandy_customer_onboarding_execute(text,jsonb,uuid) TO authenticated;
COMMIT;
