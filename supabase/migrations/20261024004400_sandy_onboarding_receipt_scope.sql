-- Replaying an immutable identity receipt never restores a missing portal
-- binding or returns a previously bound customer's identity to a new binding.
BEGIN;
SET LOCAL lock_timeout='2s';SET LOCAL statement_timeout='10s';
DO $repair$
DECLARE body text;definition text;anchor text:=$anchor$  RETURN prior.result||jsonb_build_object('reused',true,'executed',true,'request_state','succeeded','request_id',p_request_id,'reconciliation_required',false);$anchor$;
 replacement text:=$replacement$  -- The immutable receipt describes the original customer. Authorization must
  -- still resolve that same customer now; an absent binding is not authority.
  IF portal.customer_id IS NULL THEN RETURN jsonb_build_object('ok',false,'error','onboarding_required','http_status',409);END IF;
  IF prior.result->>'customer_id' IS DISTINCT FROM portal.customer_id::text OR prior.result->>'memory_customer_id' IS DISTINCT FROM portal.customer_id::text THEN RETURN jsonb_build_object('ok',false,'error','identity_link_conflict','http_status',409);END IF;
  RETURN prior.result||jsonb_build_object('reused',true,'executed',true,'request_state','succeeded','request_id',p_request_id,'reconciliation_required',false);$replacement$;
BEGIN
 SELECT prosrc,pg_get_functiondef(oid) INTO body,definition FROM pg_proc WHERE oid='public.sandy_customer_onboarding_execute(text,jsonb,uuid)'::regprocedure;
 IF encode(sha256(convert_to(body,'UTF8')),'hex')<>'02703d0659ee09dd482b174e2f1480cf3b66535e8686e42230325981b662fe8a' OR (length(body)-length(replace(body,anchor,'')))/length(anchor)<>1 THEN RAISE EXCEPTION 'reviewed onboarding receipt source preimage required';END IF;
 EXECUTE replace(definition,anchor,replacement);
END $repair$;
COMMIT;
