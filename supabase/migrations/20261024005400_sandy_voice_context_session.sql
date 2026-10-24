-- Normal customer context-only voice authorization. No media or provider effects.
BEGIN;
DO $$ DECLARE target text;BEGIN
 FOREACH target IN ARRAY ARRAY['sandy_voice_call_links','sandy_voice_call_sessions','sandy_voice_private_auth'] LOOP
  IF NOT(SELECT relrowsecurity FROM pg_class WHERE oid=('public.'||target)::regclass)
  OR has_table_privilege('anon','public.'||target,'SELECT,INSERT,UPDATE,DELETE')
  OR has_table_privilege('authenticated','public.'||target,'SELECT,INSERT,UPDATE,DELETE')
  THEN RAISE EXCEPTION 'existing_private_voice_table_boundary_changed';END IF;
 END LOOP;
END $$;
ALTER TABLE public.sandy_voice_call_links
 ADD COLUMN purpose text NOT NULL DEFAULT 'voice_call' CHECK(purpose IN('voice_call','context_only')),
 ADD COLUMN context_auth_user_id uuid REFERENCES auth.users(id),
 ADD COLUMN context_auth_session_id uuid,
 ADD COLUMN context_request_id uuid,
 ADD COLUMN context_token_secret_id uuid,
 ADD COLUMN context_retired_reason text CHECK(context_retired_reason IN('customer','expired_or_revoked')),
 ADD CONSTRAINT sandy_voice_context_link_scope CHECK(
  (purpose='voice_call' AND context_auth_user_id IS NULL AND context_auth_session_id IS NULL AND context_request_id IS NULL AND context_token_secret_id IS NULL AND context_retired_reason IS NULL)
  OR (purpose='context_only' AND context_auth_user_id IS NOT NULL AND context_auth_session_id IS NOT NULL AND context_request_id IS NOT NULL AND trusted_memory=false AND max_starts=1 AND starts=0 AND expires_at<=created_at+interval '5 minutes'));
CREATE UNIQUE INDEX sandy_voice_context_request ON public.sandy_voice_call_links(context_auth_user_id,context_request_id) WHERE purpose='context_only';

CREATE FUNCTION public.sandy_voice_context_actor(p_require_context boolean DEFAULT true) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE claims jsonb:=auth.jwt();actor uuid:=auth.uid();sid uuid;customer uuid;expiry timestamptz;instant timestamptz:=clock_timestamp();
BEGIN
 IF auth.role() IS DISTINCT FROM 'authenticated' OR actor IS NULL OR claims->>'role' IS DISTINCT FROM 'authenticated' OR claims->>'aud' IS DISTINCT FROM 'authenticated'
 OR coalesce(claims->>'session_id','')!~*'^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$' OR coalesce(claims->>'exp','')!~'^[0-9]{10,11}$'
 THEN RAISE EXCEPTION 'normal_customer_auth_session_required' USING ERRCODE='42501';END IF;
 sid:=(claims->>'session_id')::uuid;
 BEGIN
  SELECT least(to_timestamp((claims->>'exp')::double precision),coalesce(s.not_after,'infinity'::timestamptz),instant+interval '5 minutes')
  INTO STRICT expiry FROM auth.users u JOIN auth.sessions s ON s.user_id=u.id AND s.id=sid
  WHERE u.id=actor AND u.email_confirmed_at IS NOT NULL AND (u.banned_until IS NULL OR u.banned_until<=instant)
  AND (s.not_after IS NULL OR s.not_after>instant) FOR SHARE OF u,s;
 EXCEPTION WHEN NO_DATA_FOUND OR TOO_MANY_ROWS THEN RAISE EXCEPTION 'normal_customer_context_authority_required' USING ERRCODE='42501';END;
 IF expiry<=instant+(CASE WHEN p_require_context THEN interval '30 seconds' ELSE interval '0 seconds' END) THEN RAISE EXCEPTION 'fresh_normal_customer_session_required' USING ERRCODE='42501';END IF;
 IF p_require_context THEN
  BEGIN
   SELECT p.customer_id INTO STRICT customer FROM auth.users u
   JOIN public.sandy_memory_portal_accounts p ON p.auth_user_id=u.id AND p.revoked_at IS NULL
   JOIN public.email_customer_addresses a ON a.customer_id=p.customer_id AND a.is_primary AND a.verified_at IS NOT NULL AND a.normalized_email=lower(u.email)
   JOIN public.sandy_memory_settings m ON m.customer_id=p.customer_id AND m.enabled
   WHERE u.id=actor FOR SHARE OF p,a,m;
  EXCEPTION WHEN NO_DATA_FOUND OR TOO_MANY_ROWS THEN RAISE EXCEPTION 'normal_customer_context_authority_required' USING ERRCODE='42501';END;
 END IF;
 RETURN jsonb_build_object('actor',actor,'auth_session',sid,'customer',customer,'expires_at',expiry);
END $$;
REVOKE ALL ON FUNCTION public.sandy_voice_context_actor(boolean) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.sandy_voice_context_authority_current(p_session uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
 SELECT EXISTS(
  SELECT 1 FROM public.sandy_voice_call_sessions s JOIN public.sandy_voice_call_links l ON l.id=s.link_id AND l.owner_customer_id=s.owner_customer_id
  JOIN auth.users u ON u.id=l.context_auth_user_id AND u.email_confirmed_at IS NOT NULL AND (u.banned_until IS NULL OR u.banned_until<=statement_timestamp())
  JOIN auth.sessions a ON a.id=l.context_auth_session_id AND a.user_id=u.id AND (a.not_after IS NULL OR a.not_after>statement_timestamp())
  JOIN public.sandy_memory_portal_accounts p ON p.auth_user_id=u.id AND p.customer_id=l.owner_customer_id AND p.revoked_at IS NULL
  JOIN public.email_customer_addresses e ON e.customer_id=p.customer_id AND e.is_primary AND e.verified_at IS NOT NULL AND e.normalized_email=lower(u.email)
  JOIN public.sandy_memory_settings m ON m.customer_id=p.customer_id AND m.enabled
  JOIN public.sandy_voice_private_auth v ON v.session_id=s.id AND v.owner_customer_id=s.owner_customer_id AND v.verified_at IS NOT NULL AND v.expires_at>statement_timestamp()
  WHERE s.id=p_session AND l.purpose='context_only' AND l.revoked_at IS NULL AND l.expires_at>statement_timestamp()
  AND s.ended_at IS NULL AND s.state='starting' AND s.connected_at IS NULL AND s.openai_call_id IS NULL
 );
$$;
REVOKE ALL ON FUNCTION public.sandy_voice_context_authority_current(uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.sandy_voice_context_authority_current(uuid) TO service_role;

CREATE FUNCTION public.sandy_voice_context_expire() RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE l public.sandy_voice_call_links;n integer:=0;instant timestamptz:=clock_timestamp();
BEGIN
 FOR l IN SELECT * FROM public.sandy_voice_call_links WHERE purpose='context_only' AND (revoked_at IS NULL OR context_token_secret_id IS NOT NULL)
 AND (expires_at<=instant OR revoked_at IS NOT NULL OR NOT EXISTS(SELECT 1 FROM auth.sessions a WHERE a.id=context_auth_session_id AND a.user_id=context_auth_user_id AND (a.not_after IS NULL OR a.not_after>instant)))
 ORDER BY created_at LIMIT 100 FOR UPDATE SKIP LOCKED LOOP
  UPDATE public.sandy_voice_call_links SET revoked_at=coalesce(revoked_at,instant),context_retired_reason=coalesce(context_retired_reason,'expired_or_revoked'),context_token_secret_id=NULL WHERE id=l.id;
  UPDATE public.sandy_voice_call_sessions SET state='ended',ended_at=coalesce(ended_at,instant) WHERE link_id=l.id;
  DELETE FROM public.sandy_voice_private_auth WHERE session_id IN(SELECT id FROM public.sandy_voice_call_sessions WHERE link_id=l.id);
  IF l.context_token_secret_id IS NOT NULL THEN DELETE FROM vault.secrets WHERE id=l.context_token_secret_id;END IF;n:=n+1;
 END LOOP;RETURN n;
END $$;
REVOKE ALL ON FUNCTION public.sandy_voice_context_expire() FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.sandy_voice_context_session_issue(p_request_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE a jsonb;actor uuid;customer uuid;auth_session uuid;expiry timestamptz;instant timestamptz:=clock_timestamp();l public.sandy_voice_call_links;s public.sandy_voice_call_sessions;
 token text;secret uuid;receipt uuid;result jsonb;reused boolean:=false;
BEGIN
 a:=public.sandy_voice_context_actor();actor:=(a->>'actor')::uuid;customer:=(a->>'customer')::uuid;auth_session:=(a->>'auth_session')::uuid;expiry:=(a->>'expires_at')::timestamptz;
 expiry:=least(expiry,instant+interval '5 minutes');
 IF p_request_id IS NULL THEN RAISE EXCEPTION 'voice_context_request_id_required' USING ERRCODE='22023';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('voice-context:'||actor::text,0));PERFORM public.sandy_voice_context_expire();
 SELECT * INTO l FROM public.sandy_voice_call_links WHERE purpose='context_only' AND context_auth_user_id=actor AND context_request_id=p_request_id FOR UPDATE;
 IF l.id IS NOT NULL THEN
  SELECT * INTO s FROM public.sandy_voice_call_sessions WHERE link_id=l.id AND owner_customer_id=customer;
  IF l.context_auth_session_id IS DISTINCT FROM auth_session OR s.id IS NULL OR NOT public.sandy_voice_context_authority_current(s.id) THEN RAISE EXCEPTION 'voice_context_request_retired_or_conflicting' USING ERRCODE='23505';END IF;
  SELECT decrypted_secret INTO token FROM vault.decrypted_secrets WHERE id=l.context_token_secret_id;reused:=true;
  IF token IS NULL OR encode(extensions.digest(token,'sha256'),'hex') IS DISTINCT FROM l.token_sha256 THEN RAISE EXCEPTION 'voice_context_private_custody_unavailable';END IF;
 ELSE
  IF (SELECT count(*) FROM public.sandy_voice_call_links WHERE purpose='context_only' AND context_auth_user_id=actor AND revoked_at IS NULL AND expires_at>instant)>=3 THEN RAISE EXCEPTION 'voice_context_session_quota' USING ERRCODE='54000';END IF;
  token:=encode(extensions.gen_random_bytes(32),'hex');SELECT vault.create_secret(token) INTO secret;
  INSERT INTO public.sandy_voice_call_links(owner_customer_id,token_sha256,created_at,expires_at,max_starts,starts,trusted_memory,purpose,context_auth_user_id,context_auth_session_id,context_request_id,context_token_secret_id)
  VALUES(customer,encode(extensions.digest(token,'sha256'),'hex'),instant,expiry,1,0,false,'context_only',actor,auth_session,p_request_id,secret) RETURNING * INTO l;
  INSERT INTO public.sandy_voice_call_sessions(link_id,owner_customer_id,created_at,state)VALUES(l.id,customer,instant,'starting')RETURNING * INTO s;
  INSERT INTO public.sandy_voice_private_auth(session_id,owner_customer_id,code_hash,attempts,sent_count,last_sent_at,expires_at,verified_at)
  VALUES(s.id,customer,'normal_auth_context:'||encode(extensions.digest(auth_session::text,'sha256'),'hex'),0,0,instant,expiry,instant);
  result:=jsonb_build_object('session_id',s.id,'link_id',l.id,'purpose','context_only','expires_at',expiry,'state','starting','media_connected',false,'provider_operations',0);
  INSERT INTO public.sandy_customer_mutation_receipts(customer_id,auth_user_id,operation,idempotency_key,arguments_sha256,result)
  VALUES(customer,actor,'voice.context.session.issue','voice-context:'||p_request_id::text,encode(extensions.digest(p_request_id::text,'sha256'),'hex'),result)RETURNING mutation_id INTO receipt;
 END IF;
 IF receipt IS NULL THEN SELECT mutation_id INTO receipt FROM public.sandy_customer_mutation_receipts WHERE auth_user_id=actor AND operation='voice.context.session.issue' AND idempotency_key='voice-context:'||p_request_id::text;END IF;
 RETURN jsonb_build_object('ok',true,'session_id',s.id,'token',token,'purpose','context_only','expires_at',l.expires_at,'state','starting','media_connected',false,'provider_operations',0,'receipt_id',receipt,'reused',reused);
END $$;
REVOKE ALL ON FUNCTION public.sandy_voice_context_session_issue(uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.sandy_voice_context_session_issue(uuid) TO authenticated;

CREATE FUNCTION public.sandy_voice_context_session_retire(p_session_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE a jsonb;l public.sandy_voice_call_links;s public.sandy_voice_call_sessions;instant timestamptz:=clock_timestamp();result jsonb;receipt uuid;
BEGIN
 a:=public.sandy_voice_context_actor(false);
 PERFORM pg_advisory_xact_lock(hashtextextended('voice-context:'||(a->>'actor'),0));
 SELECT s0.* INTO s FROM public.sandy_voice_call_sessions s0 JOIN public.sandy_voice_call_links l0 ON l0.id=s0.link_id AND l0.owner_customer_id=s0.owner_customer_id WHERE s0.id=p_session_id AND l0.purpose='context_only' AND l0.context_auth_user_id=(a->>'actor')::uuid;
 SELECT * INTO l FROM public.sandy_voice_call_links WHERE id=s.link_id AND owner_customer_id=s.owner_customer_id AND purpose='context_only' AND context_auth_user_id=(a->>'actor')::uuid FOR UPDATE;
 IF s.id IS NULL OR l.id IS NULL THEN RAISE EXCEPTION 'owned_voice_context_session_required' USING ERRCODE='42501';END IF;
 PERFORM 1 FROM public.sandy_voice_call_sessions WHERE id=s.id AND link_id=l.id FOR UPDATE;
 SELECT r.mutation_id,r.result INTO receipt,result FROM public.sandy_customer_mutation_receipts r WHERE r.auth_user_id=(a->>'actor')::uuid AND r.operation='voice.context.session.retire' AND r.idempotency_key='voice-context-retire:'||p_session_id::text;
 IF receipt IS NOT NULL THEN RETURN result||jsonb_build_object('receipt_id',receipt,'reused',true);END IF;
 UPDATE public.sandy_voice_call_links SET revoked_at=coalesce(revoked_at,instant),context_retired_reason='customer',context_token_secret_id=NULL WHERE id=l.id;
 UPDATE public.sandy_voice_call_sessions SET state='ended',ended_at=coalesce(ended_at,instant) WHERE id=s.id;
 DELETE FROM public.sandy_voice_private_auth WHERE session_id=s.id;
 IF l.context_token_secret_id IS NOT NULL THEN DELETE FROM vault.secrets WHERE id=l.context_token_secret_id;END IF;
 result:=jsonb_build_object('ok',true,'session_id',s.id,'purpose','context_only','state','ended','media_connected',false,'provider_operations',0);
 INSERT INTO public.sandy_customer_mutation_receipts(customer_id,auth_user_id,operation,idempotency_key,arguments_sha256,result)
 VALUES(s.owner_customer_id,(a->>'actor')::uuid,'voice.context.session.retire','voice-context-retire:'||p_session_id::text,encode(extensions.digest(p_session_id::text,'sha256'),'hex'),result)RETURNING mutation_id INTO receipt;
 RETURN result||jsonb_build_object('receipt_id',receipt,'reused',false);
END $$;
REVOKE ALL ON FUNCTION public.sandy_voice_context_session_retire(uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.sandy_voice_context_session_retire(uuid) TO authenticated;

-- Existing database scheduler, not another worker queue or credential-bearing HTTP timer.
DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM pg_extension WHERE extname='pg_cron') THEN
 RAISE EXCEPTION 'bounded_voice_context_expiry_scheduler_required';ELSE
 PERFORM cron.schedule('sandy-voice-context-expiry','* * * * *','SELECT public.sandy_voice_context_expire()');
END IF;END $$;
COMMIT;
