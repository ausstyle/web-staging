-- Automatic temporal learning only. Existing raw sources/jobs/facts and explicit
-- customer remember writers remain unchanged; no new persistence stores.
BEGIN;
SET LOCAL lock_timeout='2s';SET LOCAL statement_timeout='15s';
DO $$ BEGIN
 IF coalesce((SELECT encode(sha256(convert_to(prosrc,'UTF8')),'hex') FROM pg_proc WHERE oid=to_regprocedure('public.sandy_automatic_memory_learning_allowed(uuid)')),'')<>'db80c5dd6c5a39e34210d313d39b9f815b0548b7ca3472ed336bd79912b75f9f'
 THEN RAISE EXCEPTION 'reviewed shared automatic consent helper 05500 required';END IF;
END $$;

CREATE FUNCTION public.sandy_temporal_automatic_source(p_customer uuid,p_channel text,p_ref text,p_cutoff timestamptz) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE m public.sandy_memory_settings;v record;w record;c public.sandy_web_conversations;
 msg record;i public.sandy_whatsapp_identities;e record;
 cutoff timestamptz:=coalesce(p_cutoff,clock_timestamp());lower_bound timestamptz;stamp timestamptz;body text;author_role text:='owner';binding jsonb;voice jsonb;addresses jsonb;
BEGIN
 -- This is deliberately before ANY source row/text lookup. 05500 also keeps
 -- policy changes blocked until the surrounding transaction completes.
 IF NOT public.sandy_automatic_memory_learning_allowed(p_customer) THEN RETURN jsonb_build_object('ok',false,'error','automatic_learning_not_authorized');END IF;
 SELECT * INTO m FROM public.sandy_memory_settings WHERE customer_id=p_customer FOR SHARE;
 IF NOT isfinite(cutoff) OR cutoff>clock_timestamp()+interval '1 second' OR m.consent_at IS NULL OR NOT isfinite(m.consent_at) OR m.updated_at IS NULL OR NOT isfinite(m.updated_at) THEN RETURN jsonb_build_object('ok',false,'error','automatic_learning_not_authorized');END IF;
 lower_bound:=greatest(m.consent_at,m.updated_at);
 IF p_channel IS NULL OR p_ref IS NULL OR length(p_ref) NOT BETWEEN 1 AND 180 OR p_channel NOT IN('email','voice','web','whatsapp') OR (p_channel IN('email','web') AND p_ref!~'^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$') OR (p_channel='voice' AND p_ref!~'^[1-9][0-9]{0,18}$') THEN RETURN jsonb_build_object('ok',false,'error','automatic_learning_source_required');END IF;
 CASE p_channel
 WHEN 'voice' THEN
  SELECT id,session_id,owner_customer_id,role,created_at INTO v FROM public.sandy_voice_transcript_turns WHERE id=p_ref::bigint AND owner_customer_id=p_customer AND role='user' FOR SHARE;
  IF v.id IS NULL THEN RETURN jsonb_build_object('ok',false,'error','automatic_learning_source_required');END IF;
  IF coalesce((SELECT encode(sha256(convert_to(prosrc,'UTF8')),'hex') FROM pg_proc WHERE oid=to_regprocedure('public.sandy_voice_automatic_learning_source(uuid,uuid,timestamp with time zone)')),'')<>'0cf0de01ee9ac9336072800825eb674f87e42460a1e92589c5a8ce8614681c45' THEN RETURN jsonb_build_object('ok',false,'error','voice_source_guard_unavailable');END IF;
  voice:=public.sandy_voice_automatic_learning_source(v.session_id,p_customer,p_cutoff);
  IF voice->>'ok' IS DISTINCT FROM 'true' THEN RETURN jsonb_build_object('ok',false,'error','automatic_learning_source_required');END IF;
  lower_bound:=greatest(lower_bound,(voice->>'source_not_before')::timestamptz);cutoff:=(voice->>'source_cutoff')::timestamptz;stamp:=v.created_at;
  binding:=jsonb_build_object('voice',voice,'turn_id',v.id,'session_id',v.session_id,'owner_customer_id',v.owner_customer_id,'role',v.role);
 WHEN 'web' THEN
  SELECT id,conversation_id,customer_id,status,created_at INTO w FROM public.sandy_web_turns WHERE id=p_ref::uuid AND customer_id=p_customer AND status='completed' FOR SHARE;
  IF w.id IS NULL THEN RETURN jsonb_build_object('ok',false,'error','automatic_learning_source_required');END IF;
  SELECT * INTO c FROM public.sandy_web_conversations WHERE id=w.conversation_id AND customer_id=p_customer FOR SHARE;
  IF c.id IS NULL OR c.created_at IS NULL OR NOT isfinite(c.created_at) OR c.created_at>cutoff THEN RETURN jsonb_build_object('ok',false,'error','automatic_learning_source_required');END IF;
  lower_bound:=greatest(lower_bound,c.created_at);stamp:=w.created_at;
  binding:=jsonb_build_object('turn_id',w.id,'conversation_id',c.id,'customer_id',w.customer_id,'conversation_customer_id',c.customer_id,'status',w.status);
 WHEN 'whatsapp' THEN
  SELECT id,sender_wa_id,direction,created_at INTO msg FROM public.sandy_whatsapp_messages WHERE meta_message_id=p_ref AND direction='inbound' FOR SHARE;
  IF msg.id IS NULL THEN RETURN jsonb_build_object('ok',false,'error','automatic_learning_source_required');END IF;
  SELECT * INTO i FROM public.sandy_whatsapp_identities WHERE wa_id=msg.sender_wa_id AND customer_id=p_customer FOR SHARE;
  IF i.wa_id IS NULL OR i.verification_status<>'verified' OR NOT coalesce(i.allowed_scopes@>ARRAY['memory_read']::text[],false) OR i.verified_at IS NULL OR NOT isfinite(i.verified_at) OR i.verified_at>cutoff OR i.verified_at<clock_timestamp()-interval '90 days' OR i.updated_at IS NULL OR NOT isfinite(i.updated_at) OR i.updated_at>cutoff THEN RETURN jsonb_build_object('ok',false,'error','automatic_learning_source_required');END IF;
  lower_bound:=greatest(lower_bound,i.verified_at,i.updated_at);stamp:=msg.created_at;
  binding:=jsonb_build_object('message_id',msg.id,'direction',msg.direction,'identity_sha256',encode(sha256(convert_to(to_jsonb(i)::text,'UTF8')),'hex'));
 WHEN 'email' THEN
  SELECT id,customer_id,sender_address,direction,created_at,received_at INTO e FROM public.email_messages WHERE id=p_ref::uuid AND customer_id=p_customer AND direction='incoming' FOR SHARE;
  IF e.id IS NULL OR e.created_at IS NULL OR NOT isfinite(e.created_at) OR e.created_at<lower_bound OR e.created_at>cutoff THEN RETURN jsonb_build_object('ok',false,'error','automatic_learning_source_required');END IF;
  PERFORM 1 FROM public.email_customer_addresses WHERE customer_id=p_customer ORDER BY id FOR SHARE;
  SELECT coalesce(jsonb_agg(jsonb_build_object('id',a.id,'email',a.normalized_email,'verified_at',a.verified_at) ORDER BY a.id),'[]') INTO addresses FROM public.email_customer_addresses a WHERE a.customer_id=p_customer;
  author_role:=CASE WHEN EXISTS(SELECT 1 FROM public.email_customer_addresses a WHERE a.customer_id=p_customer AND lower(a.normalized_email)=lower(e.sender_address) AND a.verified_at IS NOT NULL AND isfinite(a.verified_at) AND a.verified_at<=e.received_at) THEN 'owner' ELSE 'third_party' END;
  stamp:=e.received_at;
  binding:=jsonb_build_object('message_id',e.id,'customer_id',e.customer_id,'direction',e.direction,'created_at',e.created_at,'sender_sha256',encode(sha256(convert_to(coalesce(e.sender_address,''),'UTF8')),'hex'),'addresses_sha256',encode(sha256(convert_to(addresses::text,'UTF8')),'hex'));
 END CASE;
 IF stamp IS NULL OR NOT isfinite(stamp) OR stamp<lower_bound OR stamp>cutoff OR lower_bound>cutoff THEN RETURN jsonb_build_object('ok',false,'error','automatic_learning_source_predates_consent');END IF;
 CASE p_channel
 WHEN 'voice' THEN SELECT left(coalesce(t.text,''),6000) INTO body FROM public.sandy_voice_transcript_turns t WHERE t.id=v.id AND t.owner_customer_id=p_customer;
 WHEN 'web' THEN SELECT left(coalesce(t.question,''),6000) INTO body FROM public.sandy_web_turns t WHERE t.id=w.id AND t.customer_id=p_customer;
 WHEN 'whatsapp' THEN SELECT left(coalesce(t.body,''),6000) INTO body FROM public.sandy_whatsapp_messages t WHERE t.id=msg.id;
 WHEN 'email' THEN SELECT left(coalesce(t.subject,'')||E'\n'||coalesce(t.body_text,''),6000) INTO body FROM public.email_messages t WHERE t.id=e.id AND t.customer_id=p_customer;
 END CASE;
 RETURN jsonb_build_object('ok',true,'customer_id',p_customer,'source_channel',p_channel,'source_ref',p_ref,'source_cutoff',cutoff,'source_not_before',lower_bound,'observed_at',stamp,'author_role',author_role,'consent_at',m.consent_at,'policy_updated_at',m.updated_at,'binding',binding,'text',body);
END $$;
REVOKE ALL ON FUNCTION public.sandy_temporal_automatic_source(uuid,text,text,timestamptz) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.sandy_temporal_automatic_enqueue(p_customer uuid,p_channel text,p_ref text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE s jsonb;j public.sandy_temporal_ingestion_jobs;
BEGIN
 s:=public.sandy_temporal_automatic_source(p_customer,p_channel,p_ref,NULL);
 IF s->>'ok' IS DISTINCT FROM 'true' THEN RETURN s||jsonb_build_object('queued',false);END IF;
 INSERT INTO public.sandy_temporal_ingestion_jobs(customer_id,source_channel,source_ref) VALUES(p_customer,p_channel,p_ref)
 ON CONFLICT(source_channel,source_ref) DO NOTHING;
 SELECT * INTO j FROM public.sandy_temporal_ingestion_jobs WHERE source_channel=p_channel AND source_ref=p_ref FOR UPDATE;
 IF j.id IS NULL OR j.customer_id IS DISTINCT FROM p_customer THEN RETURN jsonb_build_object('ok',false,'queued',false,'error','temporal_source_owner_conflict');END IF;
 RETURN jsonb_build_object('ok',true,'queued',j.state='pending','job_id',j.id,'state',j.state);
END $$;
REVOKE ALL ON FUNCTION public.sandy_temporal_automatic_enqueue(uuid,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.sandy_temporal_automatic_enqueue(uuid,text,text) TO service_role;

CREATE FUNCTION public.sandy_temporal_automatic_prepare(p_job uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE j public.sandy_temporal_ingestion_jobs;s jsonb;
BEGIN
 SELECT * INTO j FROM public.sandy_temporal_ingestion_jobs WHERE id=p_job FOR UPDATE;
 IF j.id IS NULL OR j.state<>'processing' THEN RETURN jsonb_build_object('ok',false,'error','current_temporal_claim_required');END IF;
 s:=public.sandy_temporal_automatic_source(j.customer_id,j.source_channel,j.source_ref,NULL);
 IF s->>'ok' IS DISTINCT FROM 'true' THEN
  UPDATE public.sandy_temporal_ingestion_jobs SET state=CASE WHEN s->>'error'='voice_source_guard_unavailable' THEN 'needs_review' ELSE 'skipped' END,last_error=s->>'error',updated_at=clock_timestamp() WHERE id=j.id;
  RETURN s||jsonb_build_object('prepared',false,'state',CASE WHEN s->>'error'='voice_source_guard_unavailable' THEN 'needs_review' ELSE 'skipped' END);
 END IF;
 RETURN jsonb_build_object('ok',true,'prepared',true,'job_id',j.id,'attempts',j.attempts,'claim_updated_at',j.updated_at,'source',s);
END $$;
REVOKE ALL ON FUNCTION public.sandy_temporal_automatic_prepare(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.sandy_temporal_automatic_prepare(uuid) TO service_role;

CREATE FUNCTION public.sandy_temporal_automatic_finish(p_job uuid,p_expected jsonb,p_facts jsonb,p_receipt jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE j public.sandy_temporal_ingestion_jobs;s jsonb;f jsonb;quote_text text;idx integer;inserted integer:=0;effect integer;source_role text;
BEGIN
 SELECT * INTO j FROM public.sandy_temporal_ingestion_jobs WHERE id=p_job FOR UPDATE;
 IF j.id IS NULL OR j.state<>'processing' OR p_expected->>'job_id' IS DISTINCT FROM j.id::text OR (p_expected->>'attempts')::integer IS DISTINCT FROM j.attempts OR (p_expected->>'claim_updated_at')::timestamptz IS DISTINCT FROM j.updated_at THEN RETURN jsonb_build_object('ok',false,'error','current_temporal_claim_required','persisted',false);END IF;
 s:=public.sandy_temporal_automatic_source(j.customer_id,j.source_channel,j.source_ref,(p_expected->'source'->>'source_cutoff')::timestamptz);
 IF s->>'ok' IS DISTINCT FROM 'true' OR s IS DISTINCT FROM p_expected->'source' THEN
  UPDATE public.sandy_temporal_ingestion_jobs SET state='skipped',last_error='automatic_learning_consent_or_source_changed',updated_at=clock_timestamp() WHERE id=j.id;
  RETURN jsonb_build_object('ok',false,'error','automatic_learning_consent_or_source_changed','persisted',false,'state','skipped');
 END IF;
 IF jsonb_typeof(p_receipt) IS DISTINCT FROM 'object' OR jsonb_typeof(p_receipt->'provider_response_id') IS DISTINCT FROM 'string' OR jsonb_typeof(p_receipt->'response_sha256') IS DISTINCT FROM 'string' OR p_receipt->>'provider_response_id' IS NULL OR length(p_receipt->>'provider_response_id') NOT BETWEEN 1 AND 512 OR p_receipt->>'response_sha256' IS NULL OR p_receipt->>'response_sha256' !~ '^[a-f0-9]{64}$' THEN RAISE EXCEPTION 'actual_temporal_model_receipt_required' USING ERRCODE='22023';END IF;
 IF jsonb_typeof(p_facts) IS DISTINCT FROM 'array' OR jsonb_array_length(p_facts)>5 OR octet_length(p_facts::text)>16000 THEN RAISE EXCEPTION 'bounded_temporal_facts_required' USING ERRCODE='22023';END IF;
 source_role:=s->>'author_role';
 -- Validate every candidate before the first derived write. No rejected facts,
 -- raw model responses, summaries or quotes are persisted on a failed epoch.
 FOR f IN SELECT value FROM jsonb_array_elements(p_facts) LOOP
  quote_text:=f->>'source_quote';
  IF jsonb_typeof(f) IS DISTINCT FROM 'object' OR jsonb_typeof(f->'predicate') IS DISTINCT FROM 'string' OR f->>'predicate' NOT IN('timezone.current','location.current','travel.planned','availability.temporary','commitment.promised','reply.expected','project.blocker','document.pending','person.role_current') OR f->'sensitive' IS DISTINCT FROM 'false'::jsonb OR jsonb_typeof(f->'value') IS DISTINCT FROM 'object' OR octet_length((f->'value')::text)>1100 OR jsonb_typeof(f->'source_quote') IS DISTINCT FROM 'string' OR quote_text IS NULL OR length(btrim(quote_text)) NOT BETWEEN 4 AND 600 OR position(quote_text IN s->>'text')=0 OR (source_role='third_party' AND f->>'predicate' NOT IN('reply.expected','document.pending','person.role_current','project.blocker')) THEN RAISE EXCEPTION 'grounded_temporal_facts_required' USING ERRCODE='22023';END IF;
  IF (f->'value')::text||' '||quote_text ~* '\m(passport|password|pin|otp|medical|diagnos|religio|sexual|health|criminal|lawsuit|litigat|court|bank|account number|tax|loan|debt|credit card|politic|ethnic|salary|net worth|income|residen|visa|immigration|address)\M' THEN RAISE EXCEPTION 'sensitive_temporal_fact_rejected' USING ERRCODE='22023';END IF;
  IF coalesce(f->>'subject_type','user')='' OR length(coalesce(f->>'subject_type','user'))>60 OR coalesce(f->>'subject_id','self')='' OR length(coalesce(f->>'subject_id','self'))>180 OR (f?'confidence' AND jsonb_typeof(f->'confidence')<>'number') THEN RAISE EXCEPTION 'bounded_temporal_fact_fields_required' USING ERRCODE='22023';END IF;
  FOREACH quote_text IN ARRAY ARRAY['valid_from','valid_until','expires_at'] LOOP
   IF f->>quote_text IS NOT NULL AND (jsonb_typeof(f->quote_text)<>'string' OR f->>quote_text !~ '^\d{4}-\d\d-\d\dT.*(Z|[+-]\d\d:\d\d)$' OR NOT isfinite((f->>quote_text)::timestamptz)) THEN RAISE EXCEPTION 'explicit_temporal_offset_required' USING ERRCODE='22023';END IF;
  END LOOP;
  IF f->>'valid_from' IS NOT NULL AND f->>'valid_until' IS NOT NULL AND (f->>'valid_until')::timestamptz<(f->>'valid_from')::timestamptz THEN RAISE EXCEPTION 'valid_temporal_interval_required' USING ERRCODE='22023';END IF;
 END LOOP;
 idx:=0;
 FOR f IN SELECT value FROM jsonb_array_elements(p_facts) LOOP
  INSERT INTO public.sandy_temporal_facts(customer_id,subject_type,subject_id,predicate,value,state,confidence,valid_from,valid_until,expires_at,observed_at,source_channel,source_ref,evidence,access_scope,sensitivity,review_status)
  VALUES(j.customer_id,coalesce(f->>'subject_type','user'),coalesce(f->>'subject_id','self'),f->>'predicate',f->'value','inferred',least(.8,greatest(.1,coalesce((f->>'confidence')::numeric,.5))),(f->>'valid_from')::timestamptz,(f->>'valid_until')::timestamptz,(f->>'expires_at')::timestamptz,(s->>'observed_at')::timestamptz,j.source_channel,j.source_ref||':fact:'||idx,
   jsonb_build_object('extracted',true,'source_message_id',j.source_ref,'source_author_role',source_role,'source_quote',f->>'source_quote','source_snapshot_sha256',encode(sha256(convert_to(s::text,'UTF8')),'hex'),'consent_at',s->'consent_at','policy_updated_at',s->'policy_updated_at','provider_response_id',p_receipt->'provider_response_id','response_sha256',p_receipt->'response_sha256'),'private','normal',CASE WHEN source_role='third_party' OR f->>'predicate' IN('commitment.promised','reply.expected','project.blocker') THEN 'pending' ELSE 'none' END)
  ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS effect=ROW_COUNT;inserted:=inserted+effect;idx:=idx+1;
 END LOOP;
 UPDATE public.sandy_temporal_ingestion_jobs SET state='completed',last_error=NULL,updated_at=clock_timestamp() WHERE id=j.id;
 RETURN jsonb_build_object('ok',true,'persisted',true,'inserted',inserted,'state','completed');
EXCEPTION WHEN OTHERS THEN
 UPDATE public.sandy_temporal_ingestion_jobs SET state='needs_review',last_error='temporal_result_requires_review',updated_at=clock_timestamp() WHERE id=p_job AND state='processing' AND attempts=j.attempts;
 RETURN jsonb_build_object('ok',false,'error','temporal_result_requires_review','persisted',false,'state','needs_review');
END $$;
REVOKE ALL ON FUNCTION public.sandy_temporal_automatic_finish(uuid,jsonb,jsonb,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.sandy_temporal_automatic_finish(uuid,jsonb,jsonb,jsonb) TO service_role;
COMMIT;
