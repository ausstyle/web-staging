-- Automatic voice extraction reuses existing consent, sources, writer and audit.
BEGIN;
SET LOCAL lock_timeout='2s';SET LOCAL statement_timeout='15s';
DO $$ BEGIN
 IF coalesce((SELECT encode(sha256(convert_to(prosrc,'UTF8')),'hex') FROM pg_proc WHERE oid=to_regprocedure('public.sandy_automatic_memory_learning_allowed(uuid)')),'')<>'db80c5dd6c5a39e34210d313d39b9f815b0548b7ca3472ed336bd79912b75f9f'
 THEN RAISE EXCEPTION 'reviewed shared automatic consent helper 05500 required';END IF;
 IF (SELECT encode(sha256(convert_to(prosrc,'UTF8')),'hex') FROM pg_proc WHERE oid='public.sandy_voice_save_explicit_memory(uuid,text,text)'::regprocedure)<>'7dee46413219cc31cc5376b7b61570b1de91e788aba707468ca686c53100a09d'
 THEN RAISE EXCEPTION 'reviewed explicit writer preimage required';END IF;
END $$;

CREATE FUNCTION public.sandy_voice_automatic_learning_source(p_session uuid,p_expected_customer uuid,p_source_cutoff timestamptz DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE s public.sandy_voice_call_sessions;l public.sandy_voice_call_links;a public.sandy_voice_private_auth;m public.sandy_memory_settings;cutoff timestamptz:=coalesce(p_source_cutoff,clock_timestamp());not_before timestamptz;authorized_until timestamptz;turns_sha256 text;
BEGIN
 SELECT * INTO s FROM public.sandy_voice_call_sessions WHERE id=p_session FOR SHARE;
 IF s.id IS NULL OR s.owner_customer_id IS DISTINCT FROM p_expected_customer OR s.state='failed'
 OR s.created_at IS NULL OR NOT isfinite(s.created_at) OR s.created_at>clock_timestamp()+interval '1 minute'
 OR NOT isfinite(cutoff) OR cutoff>clock_timestamp()+interval '1 second' OR cutoff<s.created_at
 THEN RETURN jsonb_build_object('ok',false,'error','verified_voice_learning_source_required');END IF;
 SELECT * INTO l FROM public.sandy_voice_call_links WHERE id=s.link_id AND owner_customer_id=s.owner_customer_id FOR SHARE;
 SELECT * INTO a FROM public.sandy_voice_private_auth WHERE session_id=s.id AND owner_customer_id=s.owner_customer_id FOR SHARE;
 IF l.id IS NULL OR l.revoked_at IS NOT NULL OR coalesce(to_jsonb(l)->>'purpose','voice_call')<>'voice_call'
 OR l.expires_at IS NULL OR NOT isfinite(l.expires_at)
 OR a.session_id IS NULL OR a.verified_at IS NULL OR NOT isfinite(a.verified_at) OR a.verified_at>clock_timestamp()
 OR a.expires_at IS NULL OR NOT isfinite(a.expires_at)
 OR (s.ended_at IS NOT NULL AND (NOT isfinite(s.ended_at) OR s.ended_at>clock_timestamp()+interval '1 second'))
 OR NOT public.sandy_automatic_memory_learning_allowed(s.owner_customer_id)
 THEN RETURN jsonb_build_object('ok',false,'error','automatic_learning_not_authorized');END IF;
 SELECT * INTO m FROM public.sandy_memory_settings WHERE customer_id=s.owner_customer_id FOR SHARE;
 IF m.consent_at IS NULL OR NOT isfinite(m.consent_at) OR m.updated_at IS NULL OR NOT isfinite(m.updated_at)
 THEN RETURN jsonb_build_object('ok',false,'error','automatic_learning_not_authorized');END IF;
 authorized_until:=least(l.expires_at,a.expires_at,coalesce(s.ended_at,'infinity'::timestamptz));
 IF p_source_cutoff IS NULL THEN cutoff:=least(cutoff,authorized_until);END IF;
 IF cutoff>authorized_until THEN RETURN jsonb_build_object('ok',false,'error','voice_learning_source_authority_expired');END IF;
 not_before:=greatest(s.created_at,a.verified_at,m.consent_at,m.updated_at);
 IF not_before>cutoff THEN RETURN jsonb_build_object('ok',false,'error','automatic_learning_source_predates_consent');END IF;
 -- Bind exactly the ordered bounded model source, after consent admission.
 -- Row locks protect redaction/owner edits through the persistence transaction.
 SELECT encode(sha256(convert_to(coalesce(jsonb_agg(jsonb_build_object('id',t.id,'role',t.role,'text',t.text,'created_at',t.created_at)ORDER BY t.id),'[]'::jsonb)::text,'UTF8')),'hex') INTO turns_sha256
 FROM (SELECT id,role,text,created_at FROM public.sandy_voice_transcript_turns WHERE session_id=p_session AND owner_customer_id=p_expected_customer
  AND created_at>=not_before AND created_at<=cutoff ORDER BY id LIMIT 260 FOR SHARE) t;
 RETURN jsonb_build_object('ok',true,'session_id',s.id,'customer_id',s.owner_customer_id,'link_id',l.id,'session_created_at',s.created_at,
 'private_verified_at',a.verified_at,'private_expires_at',a.expires_at,'link_expires_at',l.expires_at,'authorized_until',authorized_until,'policy_updated_at',m.updated_at,'consent_at',m.consent_at,'source_not_before',not_before,'source_cutoff',cutoff,'source_turns_sha256',turns_sha256);
END $$;
REVOKE ALL ON FUNCTION public.sandy_voice_automatic_learning_source(uuid,uuid,timestamptz) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.sandy_voice_automatic_learning_source(uuid,uuid,timestamptz) TO service_role;

CREATE FUNCTION public.sandy_voice_automatic_learning_persist(p_session uuid,p_expected_customer uuid,p_expected_source jsonb,p_result jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE source jsonb;r public.sandy_voice_memory_reviews;c jsonb;key_name text;fact text;quote_text text;category_name text;decision_name text;
 grounded boolean;sensitive boolean;duplicate boolean;outcome text;saved_id uuid;seen text[]:='{}';committed integer:=0;reviewed integer:=0;rejected integer:=0;
 summary_text text;normalized jsonb:='[]';candidate_record jsonb;
BEGIN
 source:=public.sandy_voice_automatic_learning_source(p_session,p_expected_customer,(p_expected_source->>'source_cutoff')::timestamptz);
 IF source->>'ok' IS DISTINCT FROM 'true' OR source IS DISTINCT FROM p_expected_source
 THEN RETURN jsonb_build_object('ok',false,'error','automatic_learning_consent_or_source_changed','persisted',false);END IF;
 IF jsonb_typeof(p_result) IS DISTINCT FROM 'object' OR octet_length(p_result::text)>40000
 OR jsonb_typeof(p_result->'candidates') IS DISTINCT FROM 'array' OR jsonb_array_length(p_result->'candidates')>12
 OR jsonb_typeof(p_result->'summary') IS DISTINCT FROM 'string' OR length(p_result->>'summary')>2400
 THEN RAISE EXCEPTION 'bounded_automatic_voice_result_required' USING ERRCODE='22023';END IF;
 SELECT * INTO r FROM public.sandy_voice_memory_reviews WHERE session_id=p_session AND owner_customer_id=p_expected_customer FOR UPDATE;
 IF r.id IS NULL OR r.status<>'processing' THEN RETURN jsonb_build_object('ok',false,'error','current_voice_review_claim_required','persisted',false);END IF;
 -- Validate the entire source window before the first derived write. A newly
 -- granted epoch cannot authorize an old summary or even rejected fact copies.
 IF NOT EXISTS(SELECT 1 FROM public.sandy_voice_transcript_turns t WHERE t.session_id=p_session AND t.owner_customer_id=p_expected_customer AND t.role='user'
  AND t.created_at>=(source->>'source_not_before')::timestamptz AND t.created_at<=(source->>'source_cutoff')::timestamptz)
 THEN RETURN jsonb_build_object('ok',false,'error','voice_learning_current_source_required','persisted',false);END IF;
 FOR c IN SELECT value FROM jsonb_array_elements(p_result->'candidates') LOOP
  quote_text:=left(btrim(coalesce(c->>'source_quote','')),600);
  IF NOT EXISTS(SELECT 1 FROM public.sandy_voice_transcript_turns t WHERE t.session_id=p_session AND t.owner_customer_id=p_expected_customer AND t.role='user'
   AND t.created_at>=(source->>'source_not_before')::timestamptz AND t.created_at<=(source->>'source_cutoff')::timestamptz AND length(quote_text)>=4 AND position(quote_text IN t.text)>0)
  THEN RETURN jsonb_build_object('ok',false,'error','voice_learning_current_source_required','persisted',false);END IF;
 END LOOP;
 summary_text:=p_result->>'summary';
 FOR c IN SELECT value FROM jsonb_array_elements(p_result->'candidates') LOOP
  key_name:=left(lower(btrim(coalesce(c->>'fact_key',''))),80);fact:=left(btrim(coalesce(c->>'fact_value','')),400);quote_text:=left(btrim(coalesce(c->>'source_quote','')),600);
  IF key_name!~'^[a-z][a-z0-9_]{3,79}$' OR key_name=ANY(seen) THEN CONTINUE;END IF;seen:=array_append(seen,key_name);
  category_name:=CASE WHEN c->>'category' IN('preference','workflow','project','other')THEN c->>'category' ELSE 'other' END;
  SELECT EXISTS(SELECT 1 FROM public.sandy_voice_transcript_turns t WHERE t.session_id=p_session AND t.owner_customer_id=p_expected_customer AND t.role='user' AND t.created_at>=(source->>'source_not_before')::timestamptz AND t.created_at<=(source->>'source_cutoff')::timestamptz AND length(quote_text)>=4 AND position(quote_text IN t.text)>0) INTO grounded;
  sensitive:=(fact||' '||key_name)~*'\m(passport|password|pin|otp|medical|diagnos|religio|sexual|health|criminal|lawsuit|litigat|court|bank|account number|tax|loan|debt|credit card|politic|ethnic|salary|net worth|income|residen|visa|immigration|address)\M';
  PERFORM pg_advisory_xact_lock(hashtextextended(p_expected_customer::text||':'||key_name,0));
  SELECT EXISTS(SELECT 1 FROM public.email_ai_profile_facts f WHERE f.customer_id=p_expected_customer AND f.fact_key=key_name AND f.status='active')INTO duplicate;
  decision_name:=CASE WHEN duplicate THEN 'duplicate' WHEN NOT grounded OR fact='' OR quote_text='' OR c->>'decision'='reject' THEN 'rejected'
   WHEN c->>'decision' IS DISTINCT FROM 'commit' OR sensitive THEN 'review_required' ELSE 'committed' END;saved_id:=NULL;
  IF decision_name='committed' THEN
   outcome:=public.sandy_voice_save_explicit_memory(p_expected_customer,key_name,fact);
   IF outcome IN('saved','updated')THEN
    committed:=committed+1;SELECT id INTO saved_id FROM public.email_ai_profile_facts WHERE customer_id=p_expected_customer AND fact_key=key_name AND status='active' ORDER BY created_at DESC LIMIT 1;
   ELSE decision_name:='duplicate';END IF;
  END IF;
  IF decision_name='review_required'THEN reviewed:=reviewed+1;END IF;
  IF decision_name='rejected'THEN rejected:=rejected+1;END IF;
  INSERT INTO public.sandy_voice_memory_facts(review_id,owner_customer_id,fact_key,fact_value,category,decision,rationale,saved_profile_fact_id)
  VALUES(r.id,p_expected_customer,key_name,coalesce(nullif(fact,''),nullif(quote_text,''),'[missing fact value]'),category_name,decision_name,left(coalesce(c->>'rationale',''),350)||CASE WHEN grounded THEN '' ELSE ' [source quote absent]' END,saved_id)
  ON CONFLICT(review_id,fact_key)DO UPDATE SET fact_value=EXCLUDED.fact_value,category=EXCLUDED.category,decision=EXCLUDED.decision,rationale=EXCLUDED.rationale,saved_profile_fact_id=EXCLUDED.saved_profile_fact_id;
  candidate_record:=jsonb_build_object('fact_key',key_name,'fact_value',fact,'category',category_name,'source_quote',quote_text,'decision',left(coalesce(c->>'decision',''),40));normalized:=normalized||jsonb_build_array(candidate_record);
 END LOOP;
 UPDATE public.sandy_voice_memory_reviews SET status='complete',completed_at=clock_timestamp(),summary=summary_text,candidates=normalized,committed_count=committed,model='gpt-5.4-mini',error_code=NULL WHERE id=r.id;
 UPDATE public.sandy_voice_call_sessions SET review_status='complete' WHERE id=p_session AND owner_customer_id=p_expected_customer;
 RETURN jsonb_build_object('ok',true,'status','complete','review_id',r.id,'committed',committed,'review_required',reviewed,'rejected',rejected,'persisted',true);
END $$;
REVOKE ALL ON FUNCTION public.sandy_voice_automatic_learning_persist(uuid,uuid,jsonb,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.sandy_voice_automatic_learning_persist(uuid,uuid,jsonb,jsonb) TO service_role;
COMMIT;
