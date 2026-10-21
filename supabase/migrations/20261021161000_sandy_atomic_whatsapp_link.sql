-- Complete the existing email-code + authenticated WhatsApp flow atomically.
-- No human session, channel ownership proof or account merge is manufactured.
BEGIN;
CREATE TABLE public.sandy_customer_channel_link_audit (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 challenge_id uuid REFERENCES public.sandy_whatsapp_link_challenges(id) ON DELETE SET NULL,
 customer_id uuid REFERENCES public.email_customers(id) ON DELETE SET NULL,
 event_type text NOT NULL CHECK(event_type IN('verification_failed','identity_conflict','verified')),
 actor_kind text NOT NULL DEFAULT 'service_ingress' CHECK(actor_kind='service_ingress'),
 occurred_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
ALTER TABLE public.sandy_customer_channel_link_audit ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.sandy_customer_channel_link_audit FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON public.sandy_customer_channel_link_audit TO service_role;

CREATE FUNCTION public.sandy_customer_whatsapp_link_finish(p_wa_id text,p_challenge_id uuid,p_candidate_hash text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE challenge public.sandy_whatsapp_link_challenges%ROWTYPE;identity public.sandy_whatsapp_identities%ROWTYPE;address public.email_customer_addresses%ROWTYPE;
BEGIN
 IF p_wa_id IS NULL OR p_wa_id!~'^[1-9][0-9]{6,14}$' OR p_challenge_id IS NULL OR p_candidate_hash IS NULL OR p_candidate_hash!~'^[a-f0-9]{64}$' THEN RETURN jsonb_build_object('ok',false,'error','invalid_link_proof');END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('sandy-whatsapp-link:'||p_wa_id,0));
 SELECT * INTO challenge FROM public.sandy_whatsapp_link_challenges WHERE id=p_challenge_id AND wa_id=p_wa_id FOR UPDATE;
 IF NOT FOUND OR challenge.used_at IS NOT NULL OR challenge.expires_at<=clock_timestamp() THEN RETURN jsonb_build_object('ok',false,'error','link_challenge_unavailable');END IF;
 IF challenge.attempts<0 OR challenge.attempts>=5 THEN RETURN jsonb_build_object('ok',false,'error','link_attempts_exceeded');END IF;
 IF challenge.code_hash IS DISTINCT FROM p_candidate_hash THEN
  UPDATE public.sandy_whatsapp_link_challenges SET attempts=attempts+1 WHERE id=challenge.id;
  INSERT INTO public.sandy_customer_channel_link_audit(challenge_id,customer_id,event_type) VALUES(challenge.id,challenge.customer_id,'verification_failed');
  RETURN jsonb_build_object('ok',false,'error','invalid_link_proof');
 END IF;
 SELECT * INTO address FROM public.email_customer_addresses WHERE normalized_email=lower(btrim(challenge.email)) AND customer_id=challenge.customer_id FOR UPDATE;
 IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'error','link_challenge_unavailable');END IF;
 SELECT * INTO identity FROM public.sandy_whatsapp_identities WHERE wa_id=p_wa_id FOR UPDATE;
 -- Even a revoked association cannot silently move to another canonical
 -- customer. Transfers require a separate explicit, reviewed ownership flow.
 IF identity.customer_id IS NOT NULL AND identity.customer_id<>challenge.customer_id THEN
  INSERT INTO public.sandy_customer_channel_link_audit(challenge_id,customer_id,event_type) VALUES(challenge.id,challenge.customer_id,'identity_conflict');
  RETURN jsonb_build_object('ok',false,'error','identity_link_conflict');
 END IF;
 INSERT INTO public.sandy_whatsapp_identities(wa_id,customer_id,verification_status,verified_at,allowed_scopes)
 VALUES(p_wa_id,challenge.customer_id,'verified',clock_timestamp(),ARRAY['memory_read','email_read'])
 ON CONFLICT(wa_id) DO UPDATE SET customer_id=excluded.customer_id,verification_status='verified',verified_at=excluded.verified_at,
  allowed_scopes=CASE WHEN sandy_whatsapp_identities.verification_status='verified' THEN sandy_whatsapp_identities.allowed_scopes ELSE excluded.allowed_scopes END,
  updated_at=clock_timestamp()
 WHERE sandy_whatsapp_identities.customer_id IS NULL OR sandy_whatsapp_identities.customer_id=excluded.customer_id
 RETURNING * INTO identity;
 IF identity.wa_id IS NULL THEN
  INSERT INTO public.sandy_customer_channel_link_audit(challenge_id,customer_id,event_type) VALUES(challenge.id,challenge.customer_id,'identity_conflict');
  RETURN jsonb_build_object('ok',false,'error','identity_link_conflict');
 END IF;
 UPDATE public.sandy_whatsapp_link_challenges SET used_at=clock_timestamp() WHERE id=challenge.id;
 INSERT INTO public.sandy_customer_channel_link_audit(challenge_id,customer_id,event_type) VALUES(challenge.id,challenge.customer_id,'verified');
 RETURN jsonb_build_object('ok',true,'state','verified','identity_merged',false);
END $$;
REVOKE ALL ON FUNCTION public.sandy_customer_whatsapp_link_finish(text,uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.sandy_customer_whatsapp_link_finish(text,uuid,text) TO service_role;
COMMIT;
