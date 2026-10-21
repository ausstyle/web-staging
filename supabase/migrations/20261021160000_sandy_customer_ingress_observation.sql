-- Observe existing authenticated ingestion without creating or authorizing a
-- customer. Matching is a routing hint, never proof of the sender's identity.
BEGIN;
CREATE FUNCTION public.sandy_customer_contact_resolve(p_contact_id uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE contact public.sandy_customer_provisional_contacts%ROWTYPE;customer uuid;basis text;
BEGIN
 SELECT * INTO contact FROM public.sandy_customer_provisional_contacts WHERE id=p_contact_id;
 IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'error','contact_not_found','authorized',false);END IF;
 IF contact.channel='email' THEN
  SELECT a.customer_id INTO customer FROM public.email_customer_addresses a WHERE a.normalized_email=contact.subject AND a.verified_at IS NOT NULL;
  IF customer IS NOT NULL THEN basis:='existing_verified_email_record';END IF;
 ELSIF contact.channel='whatsapp' THEN
  SELECT w.customer_id INTO customer FROM public.sandy_whatsapp_identities w WHERE w.wa_id=contact.subject AND w.verification_status='verified' AND w.verified_at>clock_timestamp()-interval '90 days';
  IF customer IS NOT NULL THEN basis:='existing_current_whatsapp_link';END IF;
 END IF;
 -- Caller ID does not prove ownership of a voice channel. Even a known email
 -- sender may be spoofed; every consumer must retain its own authentication.
 RETURN jsonb_build_object('ok',true,'contact_id',contact.id,'channel',contact.channel,'state',CASE WHEN customer IS NULL THEN 'provisional' ELSE 'matched_existing_record' END,'matched_customer_id',customer,'match_basis',basis,'authorized',false,'customer_created',false,'identity_merged',false);
END $$;
REVOKE ALL ON FUNCTION public.sandy_customer_contact_resolve(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.sandy_customer_contact_resolve(uuid) TO service_role;

CREATE FUNCTION public.sandy_customer_ingress_observe() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE observed jsonb;channel text;subject text;event text;
BEGIN
 -- Only the established trusted ingestion role (or direct database maintenance)
 -- may feed this internal observation path. Customer writes are not proof.
 IF auth.role() IS DISTINCT FROM 'service_role' AND NOT (auth.role() IS NULL AND session_user IN('postgres','supabase_admin')) THEN RETURN NEW;END IF;
 IF TG_TABLE_SCHEMA='public' AND TG_TABLE_NAME='email_messages' THEN
  IF NEW.direction IS DISTINCT FROM 'incoming' THEN RETURN NEW;END IF;
  channel:='email';subject:=NEW.sender_address;event:='email_message:'||NEW.id::text;
 ELSIF TG_TABLE_SCHEMA='public' AND TG_TABLE_NAME='sandy_whatsapp_messages' THEN
  IF NEW.direction IS DISTINCT FROM 'inbound' THEN RETURN NEW;END IF;
  channel:='whatsapp';subject:=NEW.sender_wa_id;
  event:='meta_message:'||encode(extensions.digest(convert_to(NEW.meta_message_id,'UTF8'),'sha256'),'hex');
 ELSE RAISE EXCEPTION 'unsupported_customer_ingress';END IF;
 observed:=public.sandy_customer_contact_observe(channel,subject,event);
 -- Invalid/missing transport subjects remain ordinary inbound records. A
 -- conflicting immutable provider event is a data-integrity failure.
 IF observed->>'error'='provider_event_conflict' THEN RAISE EXCEPTION 'customer_ingress_provider_event_conflict' USING ERRCODE='23514';END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.sandy_customer_ingress_observe() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER sandy_customer_ingress_observation AFTER INSERT ON public.email_messages FOR EACH ROW EXECUTE FUNCTION public.sandy_customer_ingress_observe();
CREATE TRIGGER sandy_customer_ingress_observation AFTER INSERT ON public.sandy_whatsapp_messages FOR EACH ROW EXECUTE FUNCTION public.sandy_customer_ingress_observe();
COMMIT;
