-- Source-bound task configuration uses the existing private model policy/audit.
-- Resource reservations are conservative token units, never dollar guarantees.
BEGIN;
SET LOCAL lock_timeout='2s';SET LOCAL statement_timeout='15s';
ALTER TABLE public.sandy_openai_context_policies ADD COLUMN execution_limits jsonb;
INSERT INTO public.sandy_openai_context_policies(capability,permitted_categories,prohibited_categories,require_external_research,max_context_chars,enabled,execution_limits)
VALUES('task.configuration.extract',ARRAY['user_request'],ARRAY['customer_profile','legal_history','financial_history','unrelated_personal','web_research'],false,6000,false,
'{"schema_version":"1","rollout_stage":"legacy_staging","model":"gpt-4.1-mini","output_tokens":512,"request_bytes":24000,"customer_requests_daily":100,"customer_token_units_daily":1000000,"global_requests_daily":10000,"global_token_units_daily":25000000,"entrypoint_sha256":"567cba5f8959f0e154e0a7c0a63c6d995816a50c927db4fe3843c3e7c4570a28","instructions_sha256":"3812b5a99f5c65c03ad2859b87ec3bf0dfbab05adc8c4aadedaf5ee11f761418"}'::jsonb);
-- Disabled until source-preserved worker and isolated canary are independently
-- verified. No existing capability or customer processing policy is changed.
CREATE UNIQUE INDEX sandy_task_model_request_once ON public.sandy_openai_request_audit(request_id) WHERE capability='task.configuration.extract';
CREATE FUNCTION public.sandy_task_model_audit_guard() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,pg_temp AS $$
BEGIN
 IF (TG_OP<>'DELETE' AND NEW.capability='task.configuration.extract') OR (TG_OP<>'INSERT' AND OLD.capability='task.configuration.extract') THEN
  IF current_user<>'postgres' THEN RAISE EXCEPTION 'task_model_protected_custody_required';END IF;
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'task_model_audit_immutable';END IF;
  IF TG_OP='UPDATE' THEN
   IF (to_jsonb(NEW)-ARRAY['execution_status','provider_response_id','meta']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['execution_status','provider_response_id','meta'])
    OR OLD.execution_status IS DISTINCT FROM 'started' OR NEW.execution_status IS NULL OR NEW.execution_status NOT IN('succeeded','unknown')
    OR (NEW.meta-ARRAY['result','response_sha256','model_metrics','gateway_http_status','finished_at']) IS DISTINCT FROM (OLD.meta-ARRAY['result','response_sha256','model_metrics','gateway_http_status','finished_at'])
   THEN RAISE EXCEPTION 'task_model_receipt_transition_denied';END IF;
  ELSE
   IF NEW.execution_status IS DISTINCT FROM 'started' OR NEW.decision IS DISTINCT FROM 'allowed' OR NEW.verified_success IS DISTINCT FROM false
    OR NEW.model IS DISTINCT FROM 'gpt-4.1-mini' OR NEW.meta->>'source_sha256' IS DISTINCT FROM '567cba5f8959f0e154e0a7c0a63c6d995816a50c927db4fe3843c3e7c4570a28'
    OR NEW.provider_response_id IS NOT NULL OR NEW.meta ?| ARRAY['result','response_sha256','model_metrics','gateway_http_status','finished_at']
   THEN RAISE EXCEPTION 'task_model_source_bound_claim_required';END IF;
  END IF;
 END IF;
 RETURN CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END;
END $$;
CREATE TRIGGER sandy_task_model_custody BEFORE INSERT OR UPDATE OR DELETE ON public.sandy_openai_request_audit FOR EACH ROW EXECUTE FUNCTION public.sandy_task_model_audit_guard();
CREATE FUNCTION public.sandy_task_model_mode(p_task_id uuid,p_customer_id uuid)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE p public.sandy_openai_context_policies;canary text;
BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' OR p_customer_id IS NULL THEN RETURN 'blocked';END IF;
 IF NOT EXISTS(SELECT 1 FROM public.sandy_tasks t JOIN public.sandy_task_analysis_queue q ON q.task_id=t.id AND q.customer_id=t.customer_id WHERE t.id=p_task_id AND t.customer_id=p_customer_id AND q.state='processing' AND q.source_title=t.title AND t.archived_at IS NULL) THEN RETURN 'blocked';END IF;
 SELECT * INTO p FROM public.sandy_openai_context_policies WHERE capability='task.configuration.extract';
 IF p.capability IS NULL THEN RETURN 'blocked';END IF;
 IF p.enabled THEN RETURN 'governed';END IF;
 canary:=p.execution_limits->>'canary_customer_id';
 IF canary=p_customer_id::text THEN
  IF p.execution_limits->>'canary_expires_at' IS NULL OR (p.execution_limits->>'canary_expires_at')::timestamptz<=clock_timestamp() OR (p.execution_limits->>'canary_expires_at')::timestamptz>clock_timestamp()+interval '15 minutes' THEN RETURN 'blocked';END IF;
  IF NOT EXISTS(SELECT 1 FROM public.email_customers c JOIN public.sandy_memory_settings m ON m.customer_id=c.id JOIN public.sandy_memory_portal_accounts a ON a.customer_id=c.id JOIN auth.users u ON u.id=a.auth_user_id
   WHERE c.id=p_customer_id AND c.display_name='Isolated Sandy API service acceptance' AND c.google_drive_folder_status='excluded'
    AND m.enabled=false AND m.learning_enabled=false AND m.proactive_enabled=false AND a.revoked_at IS NULL
    AND u.raw_user_meta_data->>'sandy_api_isolated_session_test'='true' AND u.email LIKE '%@example.invalid'
    AND NOT EXISTS(SELECT 1 FROM public.sandy_controller_admins d WHERE d.auth_user_id=u.id)) THEN RETURN 'blocked';END IF;
  RETURN 'governed';
 END IF;
 IF p.execution_limits->>'rollout_stage'='legacy_staging' THEN RETURN 'legacy_staging';END IF;
 RETURN 'blocked';
EXCEPTION WHEN invalid_text_representation OR invalid_datetime_format OR datetime_field_overflow THEN RETURN 'blocked';
END $$;
CREATE FUNCTION public.sandy_task_model_admit(p_task_id uuid,p_customer_id uuid,p_source_sha256 text,p_request_canonical text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE q public.sandy_task_analysis_queue;t public.sandy_tasks;p public.sandy_openai_context_policies;a public.sandy_openai_request_audit;
 body jsonb;lim jsonb;rid text;units bigint;counts bigint;tokens bigint;day_start timestamptz:=date_trunc('day',clock_timestamp() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC';aid uuid;
BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' THEN RETURN jsonb_build_object('ok',false,'error','task_model_private_runtime_required');END IF;
 SELECT * INTO p FROM public.sandy_openai_context_policies WHERE capability='task.configuration.extract';lim:=p.execution_limits;
 IF lim->>'schema_version' IS DISTINCT FROM '1' THEN RETURN jsonb_build_object('ok',false,'error','task_model_policy_disabled');END IF;
 IF public.sandy_task_model_mode(p_task_id,p_customer_id) IS DISTINCT FROM 'governed' THEN RETURN jsonb_build_object('ok',false,'error',CASE WHEN p.enabled THEN 'task_model_current_request_required' ELSE 'task_model_policy_disabled' END);END IF;
 IF p_source_sha256 IS DISTINCT FROM lim->>'entrypoint_sha256' OR p_source_sha256 IS DISTINCT FROM '567cba5f8959f0e154e0a7c0a63c6d995816a50c927db4fe3843c3e7c4570a28' THEN RETURN jsonb_build_object('ok',false,'error','task_model_source_denied');END IF;
 IF octet_length(p_request_canonical)>LEAST((lim->>'request_bytes')::int,24000) THEN RETURN jsonb_build_object('ok',false,'error','task_model_request_limit');END IF;
 body:=p_request_canonical::jsonb;
 -- Match the normal task-save trigger lock order (task, then queue).
 SELECT * INTO t FROM public.sandy_tasks WHERE id=p_task_id FOR UPDATE;
 SELECT * INTO q FROM public.sandy_task_analysis_queue WHERE task_id=p_task_id FOR UPDATE;
 IF p_customer_id IS NULL OR q.task_id IS NULL OR t.id IS NULL OR q.customer_id IS DISTINCT FROM p_customer_id OR t.customer_id IS DISTINCT FROM p_customer_id
  OR q.state IS DISTINCT FROM 'processing' OR q.source_title IS DISTINCT FROM t.title OR t.archived_at IS NOT NULL
  OR coalesce(t.source_kind,'manual') NOT IN('web_instant','manual','web','agenda')
  OR (left(t.title,1)='"' AND right(t.title,1)='"') OR (left(t.title,1)='“' AND right(t.title,1)='”')
 THEN RETURN jsonb_build_object('ok',false,'error','task_model_current_request_required');END IF;
 IF length(t.title)>LEAST(p.max_context_chars,6000) OR body->>'input' IS DISTINCT FROM t.title
  OR jsonb_typeof(body->'input') IS DISTINCT FROM 'string' OR body->>'model' IS DISTINCT FROM 'gpt-4.1-mini'
  OR body->'store' IS DISTINCT FROM 'false'::jsonb OR body->'temperature' IS DISTINCT FROM '0'::jsonb
  OR body->'max_output_tokens' IS DISTINCT FROM to_jsonb(LEAST((lim->>'output_tokens')::int,512)) OR body->'max_output_tokens' IS DISTINCT FROM '512'::jsonb OR body->'text' IS DISTINCT FROM '{"format":{"type":"json_object"}}'::jsonb
  OR encode(sha256(convert_to(body->>'instructions','UTF8')),'hex') IS DISTINCT FROM lim->>'instructions_sha256'
  OR encode(sha256(convert_to(body->>'instructions','UTF8')),'hex') IS DISTINCT FROM '3812b5a99f5c65c03ad2859b87ec3bf0dfbab05adc8c4aadedaf5ee11f761418'
  OR body-ARRAY['input','model','store','temperature','max_output_tokens','text','instructions']<>'{}'::jsonb
 THEN RETURN jsonb_build_object('ok',false,'error','task_model_contract_denied');END IF;
 rid:='task-analysis:'||p_task_id::text||':'||encode(sha256(convert_to(t.title,'UTF8')),'hex');
 -- Global then customer locks serialize cross-job daily reservations, including
 -- different idempotency keys. Unknown outcomes retain their whole reservation.
 PERFORM pg_advisory_xact_lock(hashtextextended('task-model-global:'||day_start::text,0));
 PERFORM pg_advisory_xact_lock(hashtextextended('task-model:'||p_customer_id::text||':'||day_start::text,0));
 -- Re-read/lock after every serialization wait. A canary may expire, an
 -- administrator may revoke the policy or reduce ceilings while we waited.
 -- The share lock linearizes that protected change against this reservation.
 SELECT * INTO p FROM public.sandy_openai_context_policies WHERE capability='task.configuration.extract' FOR SHARE;lim:=p.execution_limits;
 IF public.sandy_task_model_mode(p_task_id,p_customer_id) IS DISTINCT FROM 'governed' OR lim->>'schema_version' IS DISTINCT FROM '1'
  OR p_source_sha256 IS DISTINCT FROM lim->>'entrypoint_sha256' OR lim->>'model' IS DISTINCT FROM 'gpt-4.1-mini'
  OR encode(sha256(convert_to(body->>'instructions','UTF8')),'hex') IS DISTINCT FROM lim->>'instructions_sha256'
  OR octet_length(p_request_canonical)>LEAST((lim->>'request_bytes')::int,24000) OR length(t.title)>LEAST(p.max_context_chars,6000)
  OR body->'max_output_tokens' IS DISTINCT FROM to_jsonb(LEAST((lim->>'output_tokens')::int,512))
 THEN RETURN jsonb_build_object('ok',false,'error','task_model_policy_changed_before_reservation');END IF;
 SELECT * INTO a FROM public.sandy_openai_request_audit WHERE capability=p.capability AND request_id=rid;
 IF FOUND THEN
  IF a.customer_id IS DISTINCT FROM p_customer_id OR a.request_sha256 IS DISTINCT FROM encode(sha256(convert_to(p_request_canonical,'UTF8')),'hex') THEN RETURN jsonb_build_object('ok',false,'error','task_model_receipt_conflict');END IF;
  RETURN jsonb_build_object('ok',true,'audit_id',a.id,'state',a.execution_status,'reused',true,'result',a.meta->'result');
 END IF;
 units:=octet_length(p_request_canonical)+512+1024;
 SELECT count(*),coalesce(sum((meta->>'reserved_token_units')::bigint),0) INTO counts,tokens FROM public.sandy_openai_request_audit WHERE capability=p.capability AND created_at>=day_start AND customer_id=p_customer_id;
 IF counts>=LEAST((lim->>'customer_requests_daily')::int,100) OR tokens+units>LEAST((lim->>'customer_token_units_daily')::int,1000000) THEN RETURN jsonb_build_object('ok',false,'error','task_model_customer_budget_exhausted');END IF;
 SELECT count(*),coalesce(sum((meta->>'reserved_token_units')::bigint),0) INTO counts,tokens FROM public.sandy_openai_request_audit WHERE capability=p.capability AND created_at>=day_start;
 IF counts>=LEAST((lim->>'global_requests_daily')::int,10000) OR tokens+units>LEAST((lim->>'global_token_units_daily')::int,25000000) THEN RETURN jsonb_build_object('ok',false,'error','task_model_global_budget_exhausted');END IF;
 INSERT INTO public.sandy_openai_request_audit(customer_id,source_channel,source_reference,request_id,capability,model,policy_version,context_manifest,rejected_manifest,request_sha256,request_chars,decision,violations,execution_status,verified_success,meta)
 VALUES(p_customer_id,'internal',p_task_id::text,rid,p.capability,'gpt-4.1-mini','task-model-v1','[{"category":"user_request","source":"current_customer_task_title"}]','[]',encode(sha256(convert_to(p_request_canonical,'UTF8')),'hex'),length(p_request_canonical),'allowed','[]','started',false,
 jsonb_build_object('source_sha256',p_source_sha256,'task_id',p_task_id,'title_sha256',encode(sha256(convert_to(t.title,'UTF8')),'hex'),'reserved_token_units',units,'reservation_basis','utf8_request_bytes_plus_output_and_wrapper_allowance','max_output_tokens',512,'consent_basis','customer_requested_task_configuration','provider_effect_verified',false)) RETURNING id INTO aid;
 RETURN jsonb_build_object('ok',true,'audit_id',aid,'state','started','reused',false);
EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN RETURN jsonb_build_object('ok',false,'error','task_model_contract_denied');
END $$;
CREATE FUNCTION public.sandy_task_model_finish(p_audit_id uuid,p_state text,p_provider_response_id text,p_response_sha256 text,p_result jsonb,p_metrics jsonb,p_gateway_http_status integer DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE a public.sandy_openai_request_audit;k text;v jsonb;
BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' THEN RETURN jsonb_build_object('ok',false,'error','task_model_private_runtime_required');END IF;
 SELECT * INTO a FROM public.sandy_openai_request_audit WHERE id=p_audit_id AND capability='task.configuration.extract' FOR UPDATE;
 IF p_gateway_http_status IS NOT NULL AND (p_gateway_http_status<100 OR p_gateway_http_status>599) THEN RETURN jsonb_build_object('ok',false,'error','task_model_gateway_status_denied');END IF;
 IF a.id IS NULL OR p_state IS NULL OR p_state NOT IN('succeeded','unknown') THEN RETURN jsonb_build_object('ok',false,'error','task_model_receipt_denied');END IF;
 IF p_metrics IS NOT NULL AND (jsonb_typeof(p_metrics) IS DISTINCT FROM 'object' OR p_metrics->>'schema_version' IS DISTINCT FROM '1'
  OR p_metrics->>'source' IS DISTINCT FROM 'received_provider_envelope' OR p_metrics->'provider_effect_verified' IS DISTINCT FROM 'false'::jsonb
  OR p_metrics-ARRAY['schema_version','source','model_returned','request_duration_ms','usage','estimated_cost_usd','cost_basis','rate_verified_at','provider_effect_verified']<>'{}'::jsonb
  OR NOT p_metrics ?& ARRAY['model_returned','request_duration_ms','usage','estimated_cost_usd','cost_basis','rate_verified_at']
  OR coalesce(p_metrics->>'cost_basis','') NOT IN('unavailable_usage_or_model','unavailable_exact_fresh_rate','estimated_exact_model_verified_rate')
  OR (p_metrics->>'cost_basis'<>'estimated_exact_model_verified_rate' AND (p_metrics->'estimated_cost_usd' IS DISTINCT FROM 'null'::jsonb OR p_metrics->'rate_verified_at' IS DISTINCT FROM 'null'::jsonb))
  OR jsonb_typeof(p_metrics->'model_returned') NOT IN('string','null')
  OR (p_metrics->'model_returned'<>'null'::jsonb AND p_metrics->>'model_returned'!~'^[a-zA-Z0-9_.:-]{1,200}$')
  OR jsonb_typeof(p_metrics->'request_duration_ms') NOT IN('number','null')
  OR jsonb_typeof(p_metrics->'usage') NOT IN('object','null')
  OR (jsonb_typeof(p_metrics->'usage')='object' AND ((p_metrics->'usage')-ARRAY['input_tokens','output_tokens','cached_input_tokens','total_tokens']<>'{}'::jsonb OR NOT (p_metrics->'usage') ?& ARRAY['input_tokens','output_tokens','cached_input_tokens','total_tokens']))
  OR octet_length(p_metrics::text)>4000) THEN RETURN jsonb_build_object('ok',false,'error','task_model_metrics_denied');END IF;
 IF a.execution_status<>'started' THEN RETURN jsonb_build_object('ok',a.execution_status=p_state AND a.provider_response_id IS NOT DISTINCT FROM p_provider_response_id AND a.meta->>'response_sha256' IS NOT DISTINCT FROM p_response_sha256 AND a.meta->'result' IS NOT DISTINCT FROM coalesce(p_result,'null'::jsonb) AND a.meta->'gateway_http_status' IS NOT DISTINCT FROM coalesce(to_jsonb(p_gateway_http_status),'null'::jsonb),'reused',true);END IF;
 IF p_state='succeeded' THEN
  IF p_provider_response_id IS NULL OR p_provider_response_id!~'^resp_[A-Za-z0-9_-]{1,200}$' OR p_response_sha256!~'^[a-f0-9]{64}$' OR p_response_sha256 IS NULL OR jsonb_typeof(p_result) IS DISTINCT FROM 'object'
   OR p_result-ARRAY['contact_name','time_text','date_text','relative_text','date_ymd','due_date_ymd','hour','minute','relative_minutes','priority','timezone']<>'{}'::jsonb OR (SELECT count(*) FROM jsonb_object_keys(p_result))<>11
   OR p_metrics->>'schema_version' IS DISTINCT FROM '1' OR p_metrics->'provider_effect_verified' IS DISTINCT FROM 'false'::jsonb OR octet_length(p_metrics::text)>4000
  THEN RETURN jsonb_build_object('ok',false,'error','task_model_result_denied');END IF;
  FOR k,v IN SELECT * FROM jsonb_each(p_result) LOOP
   IF v='null'::jsonb THEN CONTINUE;END IF;
   IF k IN('hour','minute','relative_minutes') THEN
    IF jsonb_typeof(v)<>'number' OR v::text!~'^[0-9]+$' OR (k='hour' AND v::int>23) OR (k='minute' AND v::int>59) OR (k='relative_minutes' AND (v::int<1 OR v::int>525600)) THEN RETURN jsonb_build_object('ok',false,'error','task_model_result_denied');END IF;
   ELSIF jsonb_typeof(v)<>'string' OR length(v#>>'{}')>240 OR (k='priority' AND v#>>'{}' NOT IN('high','normal','low')) OR (k='timezone' AND v#>>'{}' NOT IN('AEST','AEDT')) OR (k IN('date_ymd','due_date_ymd') AND v#>>'{}'!~'^20[0-9]{2}-[0-9]{2}-[0-9]{2}$') THEN RETURN jsonb_build_object('ok',false,'error','task_model_result_denied');END IF;
  END LOOP;
 ELSE
  IF p_result IS NOT NULL THEN RETURN jsonb_build_object('ok',false,'error','task_model_unknown_result_denied');END IF;
 END IF;
 UPDATE public.sandy_openai_request_audit SET execution_status=p_state,provider_response_id=p_provider_response_id,meta=meta||jsonb_build_object('result',p_result,'response_sha256',p_response_sha256,'model_metrics',p_metrics,'gateway_http_status',p_gateway_http_status,'finished_at',clock_timestamp()) WHERE id=a.id;
 RETURN jsonb_build_object('ok',true,'reused',false,'provider_effect_verified',false);
END $$;
REVOKE ALL ON FUNCTION public.sandy_task_model_mode(uuid,uuid),public.sandy_task_model_admit(uuid,uuid,text,text),public.sandy_task_model_finish(uuid,text,text,text,jsonb,jsonb,integer),public.sandy_task_model_audit_guard() FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.sandy_task_model_mode(uuid,uuid),public.sandy_task_model_admit(uuid,uuid,text,text),public.sandy_task_model_finish(uuid,text,text,text,jsonb,jsonb,integer) TO service_role;
COMMIT;
