BEGIN;
-- Normal authenticated customer reads reuse the central admission, rate and
-- append-only audit ledger. Existing owner/key/provider grants are unchanged.
-- The fixed allowlist is intentionally narrower than the operation catalogue.
CREATE FUNCTION public.sandy_api_customer_read_policy(p_operation text,p_channel text)
RETURNS uuid LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $policy$
DECLARE customer uuid;entry public.sandy_operation_registry;
BEGIN
 IF p_operation IS NULL OR p_operation NOT IN ('tasks.list','tasks.get','calendar.list','calendar.get','agenda.overview','calendar.client.overview','agenda.pins.list','calendar.client.timezone.get')
 OR p_channel IS NULL OR p_channel NOT IN ('api','mcp') THEN RETURN NULL;END IF;
 customer:=public.sandy_api_customer_read_customer(p_operation IN ('agenda.pins.list','agenda.overview'));
 IF customer IS NULL THEN RETURN NULL;END IF;
 SELECT * INTO entry FROM public.sandy_operation_registry WHERE operation=p_operation;
 IF entry.operation IS NULL OR entry.is_mutation IS DISTINCT FROM false OR entry.api_exposed IS DISTINCT FROM true
 OR entry.handler IS DISTINCT FROM (CASE WHEN p_operation IN ('agenda.pins.list','agenda.overview') THEN 'sandy-agenda' WHEN p_operation IN ('calendar.client.overview','calendar.client.timezone.get') THEN 'sandy-calendar-api' ELSE 'sandy-operations-api' END)
 OR entry.permission_scope IS DISTINCT FROM (CASE WHEN p_operation IN ('tasks.list','tasks.get','agenda.overview','agenda.pins.list') THEN 'tasks:read' ELSE 'calendar:read' END)
 OR (p_channel='mcp' AND entry.ai_exposed IS DISTINCT FROM true) OR entry.error_contract->>'requires_approval'='true' THEN RETURN NULL;END IF;
 RETURN customer;
END $policy$;
REVOKE ALL ON FUNCTION public.sandy_api_customer_read_policy(text,text) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.sandy_api_admit_customer_read(p_operation text,p_request_id uuid,p_input_sha256 text,p_contract_sha256 text,p_channel text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $admit$
DECLARE actor uuid:=auth.uid();customer uuid;prior public.sandy_api_execution_admissions;admission public.sandy_api_execution_admissions;
 entry public.sandy_operation_registry;scope_hash text;active_window timestamptz:=date_trunc('minute',clock_timestamp());counter integer;
BEGIN
 customer:=public.sandy_api_customer_read_policy(p_operation,p_channel);
 IF customer IS NULL THEN RETURN jsonb_build_object('ok',false,'error','customer_read_access_denied','http_status',403);END IF;
 IF p_request_id IS NULL OR p_input_sha256 IS NULL OR p_input_sha256 !~ '^[a-f0-9]{64}$' OR p_contract_sha256 IS NULL OR p_contract_sha256 !~ '^[a-f0-9]{64}$' THEN
 RETURN jsonb_build_object('ok',false,'error','customer_read_invalid_admission','http_status',400);END IF;
 SELECT * INTO entry FROM public.sandy_operation_registry WHERE operation=p_operation FOR SHARE;
 IF entry.error_contract ? 'contract_sha256' AND entry.error_contract->>'contract_sha256' IS DISTINCT FROM p_contract_sha256 THEN
 RETURN jsonb_build_object('ok',false,'error','customer_read_contract_changed','http_status',409);END IF;
 scope_hash:=encode(extensions.digest(jsonb_build_object('actor_id',actor,'tenant_id',customer,'operation',p_operation,'channel',p_channel)::text,'sha256'),'hex');
 PERFORM pg_advisory_xact_lock(hashtextextended(actor::text||':'||p_request_id::text,0));
 SELECT * INTO prior FROM public.sandy_api_execution_admissions WHERE actor_id=actor AND request_id=p_request_id;
 IF prior.id IS NOT NULL THEN
  IF prior.operation IS DISTINCT FROM p_operation OR prior.tenant_id IS DISTINCT FROM customer OR prior.input_sha256 IS DISTINCT FROM p_input_sha256
  OR prior.contract_sha256 IS DISTINCT FROM p_contract_sha256 OR prior.scope_sha256 IS DISTINCT FROM scope_hash THEN
  RETURN jsonb_build_object('ok',false,'error','request_id_conflict','http_status',409);END IF;
  RETURN jsonb_build_object('ok',false,'error','admission_already_recorded','http_status',409);END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('customer_read:'||actor::text,0));
 INSERT INTO public.sandy_api_rate_windows(actor_id,bucket,window_start,requests,declared_units)
 VALUES(actor,'customer_read:'||customer::text,active_window,0,0) ON CONFLICT DO NOTHING;
 SELECT requests INTO counter FROM public.sandy_api_rate_windows WHERE actor_id=actor AND bucket='customer_read:'||customer::text AND window_start=active_window FOR UPDATE;
 IF counter>=60 THEN RETURN jsonb_build_object('ok',false,'error','customer_read_rate_exceeded','http_status',429);END IF;
 INSERT INTO public.sandy_api_execution_admissions(actor_id,tenant_id,operation,request_id,is_mutation,input_sha256,contract_sha256,scope_sha256,registry_revision_sha256,declared_cost_units,expires_at)
 VALUES(actor,customer,p_operation,p_request_id,false,p_input_sha256,p_contract_sha256,scope_hash,public.sandy_api_registry_revision(p_operation),0,clock_timestamp()+interval '60 seconds') RETURNING * INTO admission;
 UPDATE public.sandy_api_rate_windows SET requests=requests+1 WHERE actor_id=actor AND bucket='customer_read:'||customer::text AND window_start=active_window;
 PERFORM public.sandy_api_append_audit(actor,p_operation,p_request_id,NULL,admission.id,'customer_read_admission','admitted',p_input_sha256,scope_hash);
 RETURN jsonb_build_object('ok',true,'allowed',true,'reused',false,'actor_id',actor,'tenant_id',customer,'admission_id',admission.id,'grant_id',admission.grant_id,'scope_sha256',scope_hash,'state','admitted','executed',false,'expires_at',admission.expires_at);
END $admit$;

CREATE FUNCTION public.sandy_api_consume_customer_read(p_grant_id uuid,p_operation text,p_request_id uuid,p_input_sha256 text,p_contract_sha256 text,p_channel text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $consume$
DECLARE actor uuid:=auth.uid();customer uuid;admission public.sandy_api_execution_admissions;scope_hash text;
BEGIN
 customer:=public.sandy_api_customer_read_policy(p_operation,p_channel);
 IF customer IS NULL THEN RETURN jsonb_build_object('ok',false,'error','customer_read_access_denied','http_status',403);END IF;
 scope_hash:=encode(extensions.digest(jsonb_build_object('actor_id',actor,'tenant_id',customer,'operation',p_operation,'channel',p_channel)::text,'sha256'),'hex');
 SELECT * INTO admission FROM public.sandy_api_execution_admissions WHERE grant_id=p_grant_id FOR UPDATE;
 IF admission.id IS NULL OR admission.principal_kind IS DISTINCT FROM 'auth_user' OR admission.actor_id IS DISTINCT FROM actor OR admission.tenant_id IS DISTINCT FROM customer
 OR admission.credential_id IS NOT NULL OR admission.approval_id IS NOT NULL OR admission.is_mutation IS DISTINCT FROM false
 OR admission.operation IS DISTINCT FROM p_operation OR admission.request_id IS DISTINCT FROM p_request_id OR admission.input_sha256 IS DISTINCT FROM p_input_sha256
 OR admission.contract_sha256 IS DISTINCT FROM p_contract_sha256 OR admission.scope_sha256 IS DISTINCT FROM scope_hash THEN
 RETURN jsonb_build_object('ok',false,'error','customer_read_grant_scope_denied','http_status',403);END IF;
 IF admission.state<>'admitted' OR admission.expires_at<=clock_timestamp() THEN RETURN jsonb_build_object('ok',false,'error','customer_read_grant_used_or_expired','http_status',409);END IF;
 IF admission.registry_revision_sha256 IS DISTINCT FROM public.sandy_api_registry_revision(p_operation) THEN RETURN jsonb_build_object('ok',false,'error','customer_read_contract_changed','http_status',409);END IF;
 UPDATE public.sandy_api_execution_admissions SET state='consumed',consumed_at=clock_timestamp() WHERE id=admission.id;
 PERFORM public.sandy_api_append_audit(actor,p_operation,p_request_id,NULL,admission.id,'customer_read_grant','consumed',p_input_sha256);
 RETURN jsonb_build_object('ok',true,'allowed',true,'reused',false,'admission_id',admission.id);
END $consume$;
REVOKE ALL ON FUNCTION public.sandy_api_admit_customer_read(text,uuid,text,text,text),public.sandy_api_consume_customer_read(uuid,text,uuid,text,text,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.sandy_api_admit_customer_read(text,uuid,text,text,text),public.sandy_api_consume_customer_read(uuid,text,uuid,text,text,text) TO authenticated;
NOTIFY pgrst,'reload schema';
COMMIT;
