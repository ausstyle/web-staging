-- #203/#226, hosting architecture sections 2/3/7/8. Logical accounts only.
-- Reuse authoritative customer identity and provisioning receipts/events. No
-- provider dispatch, resource creation, entitlement grant, billing or DNS.
BEGIN;
CREATE TABLE public.sandy_hosting_accounts (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 customer_id uuid NOT NULL UNIQUE REFERENCES public.email_customers(id),
 requested_plan text NOT NULL CHECK(requested_plan IN ('starter','business','premium')),
 state text NOT NULL DEFAULT 'logical_only' CHECK(state='logical_only'),
 version integer NOT NULL DEFAULT 1 CHECK(version>0),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
ALTER TABLE public.sandy_hosting_accounts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.sandy_hosting_accounts FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON public.sandy_hosting_accounts TO service_role;
COMMENT ON TABLE public.sandy_hosting_accounts IS 'Logical hosting account extension of email_customers; no paid entitlement or provider resource. Canonical scope: docs/sandy-cloud-hosting-architecture-engineering-scope-v1.md';

CREATE FUNCTION public.sandy_hosting_account_execute(p_operation text,p_arguments jsonb,p_request_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE actor uuid:=auth.uid(); customer uuid; account public.sandy_hosting_accounts%ROWTYPE;
 prior public.sandy_customer_provisioning_receipts%ROWTYPE; receipt_key uuid; input_hash text; result jsonb; reused boolean:=false;
BEGIN
 customer:=public.sandy_provisioning_customer_id();
 IF actor IS NULL OR customer IS NULL THEN
  RETURN jsonb_build_object('ok',false,'error','verified_customer_access_required','http_status',403,'executed',false);
 END IF;
 IF p_request_id IS NULL OR p_arguments IS NULL OR jsonb_typeof(p_arguments)<>'object' OR octet_length(p_arguments::text)>2048 OR p_operation NOT IN ('hosting.accounts.create','hosting.accounts.get') THEN
  RETURN jsonb_build_object('ok',false,'error','invalid_hosting_arguments','http_status',400,'executed',false);
 END IF;
 IF p_operation='hosting.accounts.create' THEN
  IF (SELECT count(*) FROM jsonb_object_keys(p_arguments))<>2 OR NOT (p_arguments ?& ARRAY['plan','idempotency_key']) OR jsonb_typeof(p_arguments->'plan')<>'string' OR p_arguments->>'plan' NOT IN ('starter','business','premium') OR jsonb_typeof(p_arguments->'idempotency_key')<>'string' OR (p_arguments->>'idempotency_key')!~'^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$' THEN
   RETURN jsonb_build_object('ok',false,'error','invalid_hosting_arguments','http_status',400,'executed',false);
  END IF;
  receipt_key:=(p_arguments->>'idempotency_key')::uuid;
 ELSE
  IF (SELECT count(*) FROM jsonb_object_keys(p_arguments))<>1 OR NOT p_arguments?'account_id' OR jsonb_typeof(p_arguments->'account_id')<>'string' OR (p_arguments->>'account_id')!~'^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$' THEN
   RETURN jsonb_build_object('ok',false,'error','invalid_hosting_arguments','http_status',400,'executed',false);
  END IF;
 END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('sandy-provisioning-customer:'||customer,0));
 input_hash:=encode(extensions.digest(convert_to(p_arguments::text,'UTF8'),'sha256'),'hex');
 IF p_operation='hosting.accounts.create' THEN
  SELECT * INTO prior FROM public.sandy_customer_provisioning_receipts WHERE actor_id=actor AND request_id=receipt_key;
  IF FOUND THEN
   IF prior.operation<>p_operation OR prior.input_sha256<>input_hash OR prior.result->>'customer_id' IS DISTINCT FROM customer::text THEN
    RETURN jsonb_build_object('ok',false,'error','request_id_conflict','http_status',409,'executed',false);
   END IF;
   RETURN (prior.result->'response')||jsonb_build_object('request_id',p_request_id,'reused',true);
  END IF;
 END IF;
 IF (SELECT count(*) FROM public.sandy_customer_provisioning_events WHERE actor_id=actor AND occurred_at>clock_timestamp()-interval '1 minute')>=60 THEN
  RETURN jsonb_build_object('ok',false,'error','provisioning_rate_limit','http_status',429,'executed',false);
 END IF;
 IF p_operation='hosting.accounts.create' THEN
  SELECT * INTO account FROM public.sandy_hosting_accounts WHERE customer_id=customer FOR UPDATE;
  IF FOUND THEN
   IF account.requested_plan<>p_arguments->>'plan' THEN
    RETURN jsonb_build_object('ok',false,'error','hosting_account_plan_conflict','http_status',409,'executed',false);
   END IF;
   reused:=true;
  ELSE
   INSERT INTO public.sandy_hosting_accounts(customer_id,requested_plan) VALUES(customer,p_arguments->>'plan') RETURNING * INTO account;
  END IF;
 ELSE
  SELECT * INTO account FROM public.sandy_hosting_accounts WHERE id=(p_arguments->>'account_id')::uuid AND customer_id=customer;
  IF NOT FOUND THEN
   RETURN jsonb_build_object('ok',false,'error','hosting_account_not_found','http_status',404,'executed',false);
  END IF;
 END IF;
 result:=jsonb_build_object('ok',true,'executed',true,'contract_version','1.0.0','request_state','succeeded','reconciliation_required',false,'operation',p_operation,'request_id',p_request_id,'reused',reused,
  'result',jsonb_build_object('account_id',account.id,'requested_plan',account.requested_plan,'state',account.state,'version',account.version,
  'provider_resources_created',false,'billing_activated',false));
 IF p_operation='hosting.accounts.create' THEN
  INSERT INTO public.sandy_customer_provisioning_receipts(actor_id,request_id,operation,input_sha256,result)
  VALUES(actor,receipt_key,p_operation,input_hash,jsonb_build_object('customer_id',customer,'response',result));
 END IF;
 INSERT INTO public.sandy_customer_provisioning_events(actor_id,customer_id,request_id,operation,resource_id,input_sha256,detail)
 VALUES(actor,customer,p_request_id,p_operation,account.id,input_hash,jsonb_build_object('state','logical_only','reused',reused,'provider_effect',false,'billing_activated',false));
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.sandy_hosting_account_execute(text,jsonb,uuid) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.sandy_hosting_account_execute(text,jsonb,uuid) TO authenticated;
COMMIT;
