-- Internal examiner automation only. Quality verdicts are not execution proof.
BEGIN;
CREATE TABLE public.sandy_examiner_quality_audit(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 operation text NOT NULL DEFAULT 'agent.reliability.interaction.review' CHECK(operation='agent.reliability.interaction.review'),
 contract_version text NOT NULL DEFAULT '1.0.0' CHECK(contract_version='1.0.0'),
 principal_kind text NOT NULL DEFAULT 'trusted_internal_worker' CHECK(principal_kind='trusted_internal_worker'),auth_user_id uuid CHECK(auth_user_id IS NULL),
 channel text NOT NULL CHECK(channel IN ('web','whatsapp','email','voice')),source_id text NOT NULL CHECK(length(source_id) BETWEEN 1 AND 128),
 source_at timestamptz NOT NULL,customer_id uuid REFERENCES public.email_customers(id),run_key text NOT NULL REFERENCES public.sandy_examiner_live_runs(run_key),
 source_sha256 text NOT NULL CHECK(source_sha256='7d19d3ec92fb2a8951d540db5f9684e150069f1371a86c1b139aeed3f24db933'),
 source_snapshot jsonb NOT NULL,context jsonb NOT NULL,context_sha256 text NOT NULL CHECK(context_sha256 ~ '^[a-f0-9]{64}$'),
 model_request_planned boolean NOT NULL,state text NOT NULL CHECK(state IN ('started','succeeded','unknown')),
 provider_response_id text CHECK(provider_response_id IS NULL OR length(provider_response_id) BETWEEN 1 AND 512),response_sha256 text CHECK(response_sha256 IS NULL OR response_sha256 ~ '^[a-f0-9]{64}$'),
 review_id bigint REFERENCES public.sandy_examiner_live_reviews(id),error text,created_at timestamptz NOT NULL DEFAULT now(),finished_at timestamptz,
 UNIQUE(channel,source_id),CHECK(channel<>'whatsapp' OR customer_id IS NULL),
 CHECK((state='started' AND review_id IS NULL AND error IS NULL AND finished_at IS NULL AND provider_response_id IS NULL AND response_sha256 IS NULL) OR
 (state='succeeded' AND review_id IS NOT NULL AND error IS NULL AND finished_at IS NOT NULL) OR
 (state='unknown' AND review_id IS NULL AND error='examiner_source_outcome_requires_reconciliation' AND finished_at IS NOT NULL))
);
ALTER TABLE public.sandy_examiner_quality_audit ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.sandy_examiner_quality_audit FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON public.sandy_examiner_quality_audit TO service_role;
COMMENT ON TABLE public.sandy_examiner_quality_audit IS 'Existing service automation is a distinct internal principal, never a customer/Controller session. Actual persisted run/source/customer or NULL unmapped channel, server-read context and one-use receipt precede any model request. Qualitative pass is not external execution proof. Unknown cannot redispatch across run IDs.';
-- Same UTF16 unit budgets as JavaScript, without cutting a Unicode scalar.
CREATE FUNCTION public.sandy_examiner_utf16_prefix(p_value text,p_budget integer)RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE SET search_path=pg_catalog AS $prefix$
 WITH points AS(SELECT point,ordinality,CASE WHEN ascii(point)>65535 THEN 2 ELSE 1 END AS units FROM regexp_split_to_table(left(coalesce(p_value,''),greatest(p_budget,0)),'')WITH ORDINALITY AS p(point,ordinality)),
 weighted AS(SELECT ordinality,sum(units)OVER(ORDER BY ordinality)AS used FROM points)
 SELECT left(coalesce(p_value,''),coalesce(max(ordinality)FILTER(WHERE used<=greatest(p_budget,0)),0)::integer)FROM weighted
$prefix$;
REVOKE ALL ON FUNCTION public.sandy_examiner_utf16_prefix(text,integer)FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION public.sandy_examiner_source_witness(p_source jsonb)RETURNS jsonb
LANGUAGE plpgsql IMMUTABLE SECURITY DEFINER SET search_path=pg_catalog,public,extensions AS $witness$
DECLARE result jsonb:='{}';entry record;
BEGIN
 IF jsonb_typeof(p_source)IS DISTINCT FROM 'object'THEN RAISE EXCEPTION 'examiner_actual_source_object_required';END IF;
 FOR entry IN SELECT key,value FROM jsonb_each(p_source)LOOP
  IF entry.key=ANY(ARRAY['question','response','subject','body_text','body','text','processing_status'])AND entry.value IS DISTINCT FROM 'null'::jsonb THEN
   IF jsonb_typeof(entry.value)IS DISTINCT FROM 'string'THEN RAISE EXCEPTION 'examiner_actual_text_type_required';END IF;
   result:=result||jsonb_build_object(entry.key,jsonb_build_object('sha256',encode(extensions.digest(convert_to(entry.value#>>'{}','UTF8'),'sha256'),'hex')));
  ELSE result:=result||jsonb_build_object(entry.key,entry.value);END IF;
 END LOOP;
 RETURN result;
END $witness$;
REVOKE ALL ON FUNCTION public.sandy_examiner_source_witness(jsonb)FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION public.sandy_examiner_actual_source(p_channel text,p_source_id text) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,public AS $source$
DECLARE result jsonb;
BEGIN
 CASE p_channel
 WHEN 'web' THEN SELECT jsonb_build_object('id',id,'customer_id',customer_id,'created_at',created_at,'question',question,'response',response) INTO result FROM public.sandy_web_turns WHERE id::text=p_source_id FOR SHARE;
 WHEN 'whatsapp' THEN SELECT jsonb_build_object('id',id,'created_at',created_at,'direction',direction,'body',body,'processing_status',processing_status,'sender_wa_id',sender_wa_id) INTO result FROM public.sandy_whatsapp_messages WHERE id::text=p_source_id FOR SHARE;
 WHEN 'email' THEN SELECT jsonb_build_object('id',id,'customer_id',customer_id,'created_at',created_at,'conversation_id',conversation_id,'direction',direction,'subject',subject,'body_text',body_text,'delivery_status',delivery_status) INTO result FROM public.email_messages WHERE id::text=p_source_id FOR SHARE;
 WHEN 'voice' THEN SELECT jsonb_build_object('id',id,'owner_customer_id',owner_customer_id,'session_id',session_id,'created_at',created_at,'role',role,'text',text) INTO result FROM public.sandy_voice_transcript_turns WHERE id::text=p_source_id FOR SHARE;
 ELSE RAISE EXCEPTION 'examiner_supported_source_channel_required'; END CASE;
 IF result IS NULL OR (p_channel='web' AND coalesce(result->>'question','')='') OR (p_channel='voice' AND lower(coalesce(result->>'role','')) NOT IN ('user','human')) OR (p_channel IN ('email','whatsapp') AND lower(coalesce(result->>'direction','')) NOT IN ('inbound','incoming','in')) THEN RAISE EXCEPTION 'examiner_actual_inbound_source_required'; END IF;
 RETURN result;
END $source$;
REVOKE ALL ON FUNCTION public.sandy_examiner_actual_source(text,text) FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION public.sandy_examiner_quality_result(p_review_id bigint,p_attempted boolean) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $result$
 SELECT jsonb_build_object('customer_id',r.customer_id,'channel',r.channel,'source_id',r.source_id,'run_key',r.run_key,'review_id',r.id::text,'verdict',r.verdict,'reason',r.reason,
 'quality_score',CASE WHEN jsonb_typeof(r.judge_evidence->'quality_score')='number' THEN CASE WHEN (r.judge_evidence->>'quality_score')::numeric BETWEEN 1 AND 5 AND trunc((r.judge_evidence->>'quality_score')::numeric)=(r.judge_evidence->>'quality_score')::numeric THEN to_jsonb(((r.judge_evidence->>'quality_score')::numeric)::integer) ELSE 'null'::jsonb END ELSE 'null'::jsonb END,
 'review_status',coalesce(r.judge_evidence->>'status','not_run'),'model_request_attempted',p_attempted)
 FROM public.sandy_examiner_live_reviews r WHERE r.id=p_review_id
$result$;
REVOKE ALL ON FUNCTION public.sandy_examiner_quality_result(bigint,boolean) FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION public.sandy_examiner_quality_audit_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $guard$
BEGIN
 IF TG_OP='INSERT' THEN IF NEW.state<>'started' THEN RAISE EXCEPTION 'examiner_started_claim_required'; END IF;
 ELSIF OLD.state<>'started' OR NEW.state NOT IN ('succeeded','unknown') THEN RAISE EXCEPTION 'examiner_receipt_transition_denied';
 ELSIF (to_jsonb(NEW)-ARRAY['state','provider_response_id','response_sha256','review_id','error','finished_at']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['state','provider_response_id','response_sha256','review_id','error','finished_at']) THEN RAISE EXCEPTION 'examiner_receipt_scope_immutable'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.sandy_examiner_live_runs WHERE run_key=NEW.run_key) THEN RAISE EXCEPTION 'examiner_actual_run_required'; END IF;
 RETURN NEW;
END $guard$;
REVOKE ALL ON FUNCTION public.sandy_examiner_quality_audit_guard() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER sandy_examiner_quality_audit_binding BEFORE INSERT OR UPDATE ON public.sandy_examiner_quality_audit FOR EACH ROW EXECUTE FUNCTION public.sandy_examiner_quality_audit_guard();
CREATE FUNCTION public.sandy_prepare_examiner_review(p_run_key text,p_channel text,p_source_id text,p_source_sha256 text,p_source_canonical text,p_context_canonical text,p_model_request_planned boolean) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,extensions AS $prepare$
DECLARE run public.sandy_examiner_live_runs%ROWTYPE; cursor public.sandy_examiner_live_cursors%ROWTYPE; existing public.sandy_examiner_live_reviews%ROWTYPE; prior public.sandy_examiner_quality_audit%ROWTYPE; source jsonb; supplied jsonb; context jsonb; customer uuid; when_at timestamptz; base_question text; receipt uuid;
BEGIN
 IF p_source_sha256 IS DISTINCT FROM '7d19d3ec92fb2a8951d540db5f9684e150069f1371a86c1b139aeed3f24db933' OR p_model_request_planned IS NULL OR p_run_key IS NULL OR p_run_key !~ '^live:' OR length(p_run_key)>200 OR p_source_id IS NULL OR length(p_source_id) NOT BETWEEN 1 AND 128 THEN RAISE EXCEPTION 'examiner_fixed_source_profile_required'; END IF;
 SELECT * INTO run FROM public.sandy_examiner_live_runs WHERE run_key=p_run_key FOR SHARE;
 IF NOT FOUND OR run.status<>'running' OR run.details->>'cutoff' IS NULL THEN RAISE EXCEPTION 'examiner_actual_running_run_required'; END IF;
 SELECT * INTO cursor FROM public.sandy_examiner_live_cursors WHERE channel=p_channel FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'examiner_actual_channel_cursor_required'; END IF;
 source:=public.sandy_examiner_actual_source(p_channel,p_source_id);when_at:=(source->>'created_at')::timestamptz;
 customer:=CASE WHEN p_channel='whatsapp' THEN NULL ELSE coalesce(source->>'customer_id',source->>'owner_customer_id')::uuid END;
 SELECT * INTO existing FROM public.sandy_examiner_live_reviews WHERE channel=p_channel AND source_id=p_source_id;
 IF FOUND THEN
  IF existing.customer_id IS DISTINCT FROM customer THEN RAISE EXCEPTION 'examiner_historical_review_tenant_mismatch'; END IF;
  SELECT * INTO prior FROM public.sandy_examiner_quality_audit WHERE channel=p_channel AND source_id=p_source_id;
  RETURN jsonb_build_object('existing_review',public.sandy_examiner_quality_result(existing.id,CASE WHEN prior.id IS NOT NULL THEN prior.model_request_planned WHEN existing.judge_evidence->>'status'='evaluated' THEN true ELSE NULL END));
 END IF;
 IF EXISTS(SELECT 1 FROM public.sandy_examiner_quality_audit WHERE channel=p_channel AND source_id=p_source_id) THEN RAISE EXCEPTION 'examiner_source_outcome_requires_reconciliation'; END IF;
 IF when_at>(run.details->>'cutoff')::timestamptz OR when_at<cursor.last_created_at OR (when_at=cursor.last_created_at AND cursor.last_source_id<>'' AND CASE WHEN p_source_id ~ '^[0-9]+$' AND cursor.last_source_id ~ '^[0-9]+$' THEN p_source_id::numeric<=cursor.last_source_id::numeric ELSE p_source_id<=cursor.last_source_id END) THEN RAISE EXCEPTION 'examiner_source_outside_actual_scan_scope'; END IF;
 IF p_source_canonical IS NULL OR p_context_canonical IS NULL OR length(p_source_canonical)>32768 OR length(p_context_canonical)>131072 THEN RAISE EXCEPTION 'examiner_bounded_actual_context_required'; END IF;
 supplied:=p_source_canonical::jsonb;context:=p_context_canonical::jsonb;
 IF (public.sandy_examiner_source_witness(source)-'created_at') IS DISTINCT FROM (supplied-'created_at') OR (source->>'created_at')::timestamptz IS DISTINCT FROM (supplied->>'created_at')::timestamptz THEN RAISE EXCEPTION 'examiner_actual_source_snapshot_changed'; END IF;
 base_question:=public.sandy_examiner_utf16_prefix(CASE p_channel WHEN 'web' THEN coalesce(source->>'question','') WHEN 'voice' THEN coalesce(source->>'text','') WHEN 'email' THEN concat_ws(E'\n',nullif(source->>'subject',''),nullif(source->>'body_text','')) ELSE coalesce(source->>'body','') END,3000);
 IF jsonb_typeof(context) IS DISTINCT FROM 'object' OR context->>'channel' IS DISTINCT FROM p_channel OR length(trim(base_question))=0 OR jsonb_typeof(context->'question') IS DISTINCT FROM 'string' OR public.sandy_examiner_utf16_prefix(context->>'question',3701)IS DISTINCT FROM context->>'question' OR jsonb_typeof(context->'answer') IS DISTINCT FROM 'string' OR public.sandy_examiner_utf16_prefix(context->>'answer',3500)IS DISTINCT FROM context->>'answer' OR jsonb_typeof(context->'continuation_joined') IS DISTINCT FROM 'boolean' OR jsonb_typeof(context->'recentContext') IS DISTINCT FROM 'array' OR jsonb_array_length(context->'recentContext')>8 OR (SELECT count(*) FROM jsonb_object_keys(context))<>6 THEN RAISE EXCEPTION 'examiner_bounded_actual_context_required'; END IF;
 IF context->'continuation_joined'='true'::jsonb THEN IF p_channel<>'whatsapp' OR right(context->>'question',length(base_question))<>base_question THEN RAISE EXCEPTION 'examiner_actual_continuation_required'; END IF;
 ELSIF context->>'question' IS DISTINCT FROM base_question THEN RAISE EXCEPTION 'examiner_actual_question_required'; END IF;
 IF coalesce(context->>'receipt','') NOT IN ('paired_web_turn','unavailable','same_conversation_outbound','same_session_assistant','same_sender_outbound_before_next_inbound') OR
 (p_channel='web' AND (context->>'answer' IS DISTINCT FROM public.sandy_examiner_utf16_prefix(coalesce(source->>'response',''),3500) OR context->>'receipt' IS DISTINCT FROM CASE WHEN coalesce(source->>'response','')='' THEN 'unavailable' ELSE 'paired_web_turn' END)) OR
 (p_channel<>'whatsapp' AND (context->'continuation_joined'<>'false'::jsonb OR context->'recentContext'<>'[]'::jsonb)) OR
 (p_channel='email' AND context->>'receipt' NOT IN ('unavailable','same_conversation_outbound')) OR (p_channel='voice' AND context->>'receipt' NOT IN ('unavailable','same_session_assistant')) OR (p_channel='whatsapp' AND context->>'receipt' NOT IN ('unavailable','same_sender_outbound_before_next_inbound')) OR (p_model_request_planned AND context->>'answer'='') THEN RAISE EXCEPTION 'examiner_actual_reply_scope_required'; END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(context->'recentContext')v WHERE jsonb_typeof(v.value) IS DISTINCT FROM 'object' OR coalesce(v.value->>'role','') NOT IN ('inbound','outbound') OR jsonb_typeof(v.value->'text') IS DISTINCT FROM 'string' OR public.sandy_examiner_utf16_prefix(v.value->>'text',600)IS DISTINCT FROM v.value->>'text' OR (SELECT count(*) FROM jsonb_object_keys(v.value))<>2) THEN RAISE EXCEPTION 'examiner_actual_recent_context_required'; END IF;
 INSERT INTO public.sandy_examiner_quality_audit(channel,source_id,source_at,customer_id,run_key,source_sha256,source_snapshot,context,context_sha256,model_request_planned,state) VALUES(p_channel,p_source_id,when_at,customer,p_run_key,p_source_sha256,source,context,encode(extensions.digest(context::text,'sha256'),'hex'),p_model_request_planned,'started') RETURNING id INTO receipt;
 RETURN jsonb_build_object('id',receipt);
END $prepare$;
REVOKE ALL ON FUNCTION public.sandy_prepare_examiner_review(text,text,text,text,text,text,boolean) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.sandy_prepare_examiner_review(text,text,text,text,text,text,boolean) TO service_role;
CREATE FUNCTION public.sandy_finish_examiner_review(p_audit_id uuid,p_unknown boolean,p_verdict text,p_reason text,p_judge_canonical text,p_provider_response_id text,p_response_sha256 text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $finish$
DECLARE a public.sandy_examiner_quality_audit%ROWTYPE; run public.sandy_examiner_live_runs%ROWTYPE; source jsonb; judge jsonb; review bigint;
BEGIN
 SELECT * INTO a FROM public.sandy_examiner_quality_audit WHERE id=p_audit_id FOR UPDATE;
 IF NOT FOUND OR a.state<>'started' OR p_unknown IS NULL THEN RAISE EXCEPTION 'examiner_started_finish_claim_required'; END IF;
 SELECT * INTO run FROM public.sandy_examiner_live_runs WHERE run_key=a.run_key FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'examiner_actual_run_required'; END IF;
 IF p_unknown THEN
  IF p_verdict IS NOT NULL OR p_reason IS NOT NULL OR p_judge_canonical IS NOT NULL THEN RAISE EXCEPTION 'examiner_unknown_receipt_invalid'; END IF;
  UPDATE public.sandy_examiner_quality_audit SET state='unknown',error='examiner_source_outcome_requires_reconciliation',finished_at=now() WHERE id=a.id;
  RETURN jsonb_build_object('ok',true,'reconciliation_required',true);
 END IF;
 IF run.status<>'running' THEN RAISE EXCEPTION 'examiner_running_finalization_required'; END IF;
 source:=public.sandy_examiner_actual_source(a.channel,a.source_id);
 IF source IS DISTINCT FROM a.source_snapshot THEN RAISE EXCEPTION 'examiner_source_changed_reconcile'; END IF;
 IF p_verdict IS NULL OR p_verdict NOT IN ('pass','needs_review','potential_issue','unverifiable') OR p_reason IS NULL OR (length(p_reason)<1 OR public.sandy_examiner_utf16_prefix(p_reason,90)IS DISTINCT FROM p_reason) OR p_judge_canonical IS NULL OR length(p_judge_canonical)>4096 THEN RAISE EXCEPTION 'examiner_bounded_quality_result_required'; END IF;
 judge:=p_judge_canonical::jsonb;
 IF jsonb_typeof(judge) IS DISTINCT FROM 'object' OR coalesce(judge->>'status','') NOT IN ('evaluated','not_run','judge_unavailable') OR judge->>'receipt' IS DISTINCT FROM a.context->>'receipt' THEN RAISE EXCEPTION 'examiner_observed_quality_receipt_required'; END IF;
 IF judge->>'status'='evaluated' THEN
  IF NOT a.model_request_planned OR judge->>'model' IS DISTINCT FROM 'gpt-6-astra' OR p_provider_response_id IS NULL OR p_response_sha256 IS NULL OR p_response_sha256 !~ '^[a-f0-9]{64}$' OR jsonb_typeof(judge->'reason_summary') IS DISTINCT FROM 'string' OR public.sandy_examiner_utf16_prefix(judge->>'reason_summary',350)IS DISTINCT FROM judge->>'reason_summary' OR (CASE jsonb_typeof(judge->'quality_score') WHEN 'null' THEN false WHEN 'number' THEN NOT((judge->>'quality_score')::numeric BETWEEN 1 AND 5 AND trunc((judge->>'quality_score')::numeric)=(judge->>'quality_score')::numeric) ELSE true END) OR (SELECT count(*) FROM jsonb_object_keys(judge))<>5 THEN RAISE EXCEPTION 'examiner_actual_model_quality_receipt_required'; END IF;
 ELSE
  IF p_verdict IS DISTINCT FROM (CASE WHEN a.context->>'answer'='' THEN 'unverifiable' ELSE 'needs_review' END) OR p_reason IS DISTINCT FROM (CASE WHEN a.context->>'answer'='' THEN 'no_verified_outcome' ELSE 'actual_outcome_not_independently_verified' END) OR (SELECT count(*) FROM jsonb_object_keys(judge))<>2 OR (judge->>'status'='judge_unavailable' AND NOT a.model_request_planned) OR (a.model_request_planned AND judge->>'status'='not_run') THEN RAISE EXCEPTION 'examiner_unavailable_quality_cannot_claim_success'; END IF;
 END IF;
 INSERT INTO public.sandy_examiner_live_reviews(channel,source_id,source_at,customer_id,run_key,verdict,reason,judge_evidence) VALUES(a.channel,a.source_id,a.source_at,a.customer_id,a.run_key,p_verdict,p_reason,judge) RETURNING id INTO review;
 IF p_verdict='potential_issue' THEN
  INSERT INTO public.sandy_evolution_cases(case_key,domain,title,description,source_type,source_reference,priority,status,risk_tier,approval_required) VALUES('examiner:live:'||a.channel||':'||a.source_id,'intelligence','Review live '||a.channel||' customer interaction','Potential response-quality problem. Independently examine the referenced Examiner live review and verify root cause; do not assume customer objective failed.','sandy_examiner_live_reviews',a.channel||':'||a.source_id,65,'discovered','unassessed',true) ON CONFLICT(case_key) DO NOTHING;
 END IF;
 UPDATE public.sandy_examiner_quality_audit SET state='succeeded',provider_response_id=p_provider_response_id,response_sha256=p_response_sha256,review_id=review,finished_at=now() WHERE id=a.id;
 RETURN jsonb_build_object('ok',true,'review',public.sandy_examiner_quality_result(review,a.model_request_planned));
END $finish$;
REVOKE ALL ON FUNCTION public.sandy_finish_examiner_review(uuid,boolean,text,text,text,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.sandy_finish_examiner_review(uuid,boolean,text,text,text,text,text) TO service_role;
DO $guard$ BEGIN IF EXISTS(SELECT 1 FROM public.sandy_operation_registry WHERE operation='agent.reliability.interaction.review') THEN RAISE EXCEPTION 'examiner_quality_operation_already_registered_reconcile_first'; END IF; END $guard$;
INSERT INTO public.sandy_operation_registry(operation,domain,description,permission_scope,is_mutation,input_schema,output_schema,handler,api_exposed,ui_exposed,ai_exposed,verified,implementation_state,source_repository,source_path,dependencies,error_contract,retry_policy,rollback_policy) VALUES('agent.reliability.interaction.review',
'agent',
'Assess response quality for an actual recorded source interaction through existing internal automation. Preserve real customer or unknown-channel scope. A qualitative model verdict never proves external provider execution or customer objective completion. Contract v1.0.0. Process-local automation capability cannot be supplied by JSON; no public handler readiness is asserted.',
'worker:reliability',
true,
'{"type":"object","properties":{},"required":[],"additionalProperties":false}'::jsonb,
'{"type":"object","properties":{"ok":{"const":true},"operation":{"const":"agent.reliability.interaction.review"},"contract_version":{"const":"1.0.0"},"principal_kind":{"const":"trusted_internal_worker"},"auth_user_id":{"type":"null"},"customer_id":{"type":["string","null"],"format":"uuid"},"channel":{"enum":["web","whatsapp","email","voice"]},"source_id":{"type":"string","minLength":1,"maxLength":128},"run_key":{"type":"string","minLength":1,"maxLength":200},"review_id":{"type":"string","pattern":"^[0-9]+$"},"verdict":{"enum":["pass","needs_review","potential_issue","unverifiable"]},"reason":{"type":"string","minLength":1,"maxLength":90},"quality_score":{"type":["integer","null"],"minimum":1,"maximum":5},"review_status":{"enum":["evaluated","not_run","judge_unavailable"]},"model_request_attempted":{"type":["boolean","null"]},"reused_record":{"type":"boolean"},"external_actions_performed":{"const":0},"execution_verified":{"const":false}},"required":["ok","operation","contract_version","principal_kind","auth_user_id","customer_id","channel","source_id","run_key","review_id","verdict","reason","quality_score","review_status","model_request_attempted","reused_record","external_actions_performed","execution_verified"],"additionalProperties":false,"allOf":[{"if":{"properties":{"channel":{"const":"whatsapp"}}},"then":{"properties":{"customer_id":{"const":null}}}},{"if":{"properties":{"review_status":{"const":"evaluated"}}},"then":{"properties":{"model_request_attempted":{"const":true}}}}]}'::jsonb,
'internal:agent.reliability.interaction.review@1.0.0',
false,
false,
false,
false,
'awaiting_deployment',
'ausstyle/web-staging',
'supabase/functions/_shared/sandy-agent-operations/worker_examiner.ts',
'["identity:existing_service_automation_bearer_distinct_from_customer_session","database:actual_running_examiner_run_channel_cursor_and_source","database:sandy_examiner_quality_audit","provider:fixed_gpt_6_astra_16s_Responses","scope:actual_customer_or_unmapped_null_channel","evidence:quality_verdict_not_external_action_proof"]'::jsonb,
'{"version":"1.0.0","requirement_ids":[155,160],"internal_only":true,"sensitive":true,"consumes_model_resources":true,"principal_kind":"trusted_internal_worker","auth_user_id":null,"existing_service_automation_separate_from_customer":true,"actual_run_source_channel_scope_required":true,"whatsapp_customer_mapping":"unknown_null","public_model_prompt_tool_or_customer_selection":false,"atomic_one_use_claim_before_model":true,"unknown_source_cross_run_redispatch":false,"atomic_review_finding_intake":true,"qualitative_pass_is_external_execution_proof":false,"external_actions_performed":0,"source_review_only":true,"original_source_sha256":"7d19d3ec92fb2a8951d540db5f9684e150069f1371a86c1b139aeed3f24db933","contract_sha256":"7ba44b5a2b1e4b4f87fc173f10633b891f86577554456c4fc0cfe6f3d5d79698"}'::jsonb,
'{"automatic":false,"same_source_cross_run_redispatch":false,"reason":"One actual source receipt precedes any model request. Unknown source outcomes require reconciliation; saved historical reviews are reused without paid redispatch."}'::jsonb,
'{"required":false,"reason":"Paid model requests cannot be reversed. Quality reviews/finding intake are internal records only; no customer/provider actions execute."}'::jsonb);
COMMIT;
