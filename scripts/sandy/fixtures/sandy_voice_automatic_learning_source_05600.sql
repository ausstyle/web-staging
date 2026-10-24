-- Exact dependency source for isolated tests only; never deployed by 05800.
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
