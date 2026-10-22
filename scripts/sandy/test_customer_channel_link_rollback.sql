-- Real PostgreSQL component execution, synthetic trusted-ingress proof fixtures.
-- No email/WhatsApp provider message, real OTP, customer session or merge.
DO $test$
DECLARE customer uuid:=gen_random_uuid();other_customer uuid:=gen_random_uuid();challenge uuid;wa text;email text;other_email text;result jsonb;checks integer:=0;i integer;existing_count bigint;failed boolean:=false;
BEGIN
 wa:='1555'||lpad((floor(random()*10000000)::bigint)::text,7,'0');email:='sandy-link-'||customer||'@example.invalid';other_email:='sandy-link-'||other_customer||'@example.invalid';
 IF EXISTS(SELECT 1 FROM public.sandy_whatsapp_identities WHERE wa_id=wa) THEN RAISE EXCEPTION 'fixture phone collision';END IF;
 IF has_function_privilege('anon','public.sandy_customer_whatsapp_link_finish(text,uuid,text)','EXECUTE') OR has_function_privilege('authenticated','public.sandy_customer_whatsapp_link_finish(text,uuid,text)','EXECUTE') OR has_table_privilege('authenticated','public.sandy_customer_channel_link_audit','SELECT') OR has_table_privilege('service_role','public.sandy_customer_channel_link_audit','INSERT') THEN RAISE EXCEPTION 'channel link privilege boundary';END IF;checks:=checks+4;
 INSERT INTO public.email_customers(id,display_name,google_drive_folder_status) VALUES(customer,'Isolated channel link fixture','excluded'),(other_customer,'Isolated channel link fixture','excluded');
 INSERT INTO public.email_customer_addresses(customer_id,email_address,is_primary) VALUES(customer,email,true),(other_customer,other_email,true);
 INSERT INTO public.sandy_whatsapp_link_challenges(wa_id,customer_id,email,code_hash,expires_at) VALUES(wa,customer,email,repeat('a',64),clock_timestamp()+interval '10 minutes') RETURNING id INTO challenge;
 result:=public.sandy_customer_whatsapp_link_finish(NULL,challenge,repeat('a',64));IF result->>'error' IS DISTINCT FROM 'invalid_link_proof' THEN RAISE EXCEPTION 'invalid phone rejected';END IF;checks:=checks+1;
 result:=public.sandy_customer_whatsapp_link_finish(wa,challenge,'plaintext-code');IF result->>'error' IS DISTINCT FROM 'invalid_link_proof' THEN RAISE EXCEPTION 'only bound digest accepted';END IF;checks:=checks+1;
 result:=public.sandy_customer_whatsapp_link_finish(wa,gen_random_uuid(),repeat('a',64));IF result->>'error' IS DISTINCT FROM 'link_challenge_unavailable' THEN RAISE EXCEPTION 'wrong challenge rejected';END IF;checks:=checks+1;
 FOR i IN 1..5 LOOP
  result:=public.sandy_customer_whatsapp_link_finish(wa,challenge,repeat('b',64));IF result->>'error' IS DISTINCT FROM 'invalid_link_proof' OR (SELECT attempts FROM public.sandy_whatsapp_link_challenges WHERE id=challenge) IS DISTINCT FROM i THEN RAISE EXCEPTION 'serial attempt budget';END IF;checks:=checks+1;
 END LOOP;
 result:=public.sandy_customer_whatsapp_link_finish(wa,challenge,repeat('a',64));IF result->>'error' IS DISTINCT FROM 'link_attempts_exceeded' OR EXISTS(SELECT 1 FROM public.sandy_whatsapp_identities WHERE wa_id=wa) THEN RAISE EXCEPTION 'exhausted proof does not bind';END IF;checks:=checks+2;
 IF (SELECT count(*) FROM public.sandy_customer_channel_link_audit WHERE challenge_id=challenge AND event_type='verification_failed')<>5 THEN RAISE EXCEPTION 'bounded failure audit';END IF;checks:=checks+1;
 UPDATE public.sandy_whatsapp_link_challenges SET attempts=0,expires_at=clock_timestamp()-interval '1 second' WHERE id=challenge;
 result:=public.sandy_customer_whatsapp_link_finish(wa,challenge,repeat('a',64));IF result->>'error' IS DISTINCT FROM 'link_challenge_unavailable' THEN RAISE EXCEPTION 'expired proof denied';END IF;checks:=checks+1;
 UPDATE public.sandy_whatsapp_link_challenges SET expires_at=clock_timestamp()+interval '10 minutes' WHERE id=challenge;
 UPDATE public.email_customer_addresses SET customer_id=other_customer,is_primary=false WHERE normalized_email=email;
 result:=public.sandy_customer_whatsapp_link_finish(wa,challenge,repeat('a',64));IF result->>'error' IS DISTINCT FROM 'link_challenge_unavailable' OR (SELECT used_at FROM public.sandy_whatsapp_link_challenges WHERE id=challenge) IS NOT NULL THEN RAISE EXCEPTION 'current email ownership rechecked';END IF;checks:=checks+2;
 UPDATE public.email_customer_addresses SET customer_id=customer,is_primary=true WHERE normalized_email=email;
 INSERT INTO public.sandy_whatsapp_identities(wa_id,customer_id,verification_status,verified_at) VALUES(wa,other_customer,'verified',clock_timestamp());
 result:=public.sandy_customer_whatsapp_link_finish(wa,challenge,repeat('a',64));IF result->>'error' IS DISTINCT FROM 'identity_link_conflict' OR (SELECT customer_id FROM public.sandy_whatsapp_identities WHERE wa_id=wa) IS DISTINCT FROM other_customer OR (SELECT used_at FROM public.sandy_whatsapp_link_challenges WHERE id=challenge) IS NOT NULL THEN RAISE EXCEPTION 'different canonical customer cannot be overwritten';END IF;checks:=checks+3;
 UPDATE public.sandy_whatsapp_identities SET verification_status='revoked' WHERE wa_id=wa;
 result:=public.sandy_customer_whatsapp_link_finish(wa,challenge,repeat('a',64));IF result->>'error' IS DISTINCT FROM 'identity_link_conflict' THEN RAISE EXCEPTION 'revocation is not identity transfer consent';END IF;checks:=checks+1;
 DELETE FROM public.sandy_whatsapp_identities WHERE wa_id=wa;
 result:=public.sandy_customer_whatsapp_link_finish(wa,challenge,repeat('a',64));IF result->>'ok' IS DISTINCT FROM 'true' OR result->>'state' IS DISTINCT FROM 'verified' OR result->>'identity_merged' IS DISTINCT FROM 'false' THEN RAISE EXCEPTION 'atomic valid binding';END IF;checks:=checks+3;
 IF (SELECT used_at FROM public.sandy_whatsapp_link_challenges WHERE id=challenge) IS NULL OR NOT EXISTS(SELECT 1 FROM public.sandy_whatsapp_identities WHERE wa_id=wa AND customer_id=customer AND verification_status='verified' AND allowed_scopes=ARRAY['memory_read','email_read']) THEN RAISE EXCEPTION 'proof consumption and binding persisted together';END IF;checks:=checks+2;
 result:=public.sandy_customer_whatsapp_link_finish(wa,challenge,repeat('a',64));IF result->>'error' IS DISTINCT FROM 'link_challenge_unavailable' THEN RAISE EXCEPTION 'consumed proof cannot replay';END IF;checks:=checks+1;
 UPDATE public.sandy_whatsapp_identities SET allowed_scopes=ARRAY['memory_read'] WHERE wa_id=wa;
 INSERT INTO public.sandy_whatsapp_link_challenges(wa_id,customer_id,email,code_hash,expires_at) VALUES(wa,customer,email,repeat('c',64),clock_timestamp()+interval '10 minutes') RETURNING id INTO challenge;
 result:=public.sandy_customer_whatsapp_link_finish(wa,challenge,repeat('c',64));IF result->>'ok' IS DISTINCT FROM 'true' OR (SELECT allowed_scopes FROM public.sandy_whatsapp_identities WHERE wa_id=wa) IS DISTINCT FROM ARRAY['memory_read'] THEN RAISE EXCEPTION 'narrower existing permissions preserved';END IF;checks:=checks+2;
 -- A failed final audit must undo both channel binding and code consumption.
 DELETE FROM public.sandy_whatsapp_identities WHERE wa_id=wa;
 INSERT INTO public.sandy_whatsapp_link_challenges(wa_id,customer_id,email,code_hash,expires_at) VALUES(wa,customer,email,repeat('d',64),clock_timestamp()+interval '10 minutes') RETURNING id INTO challenge;
 EXECUTE 'CREATE FUNCTION pg_temp.sandy_link_fixture_fail_audit() RETURNS trigger LANGUAGE plpgsql AS $failure$ BEGIN RAISE EXCEPTION ''isolated audit failure'';END $failure$';
 CREATE TRIGGER sandy_link_fixture_audit_failure BEFORE INSERT ON public.sandy_customer_channel_link_audit FOR EACH ROW EXECUTE FUNCTION pg_temp.sandy_link_fixture_fail_audit();
 BEGIN
  PERFORM public.sandy_customer_whatsapp_link_finish(wa,challenge,repeat('d',64));
 EXCEPTION WHEN raise_exception THEN failed:=true;
 END;
 DROP TRIGGER sandy_link_fixture_audit_failure ON public.sandy_customer_channel_link_audit;
 IF NOT failed OR EXISTS(SELECT 1 FROM public.sandy_whatsapp_identities WHERE wa_id=wa) OR (SELECT used_at FROM public.sandy_whatsapp_link_challenges WHERE id=challenge) IS NOT NULL THEN RAISE EXCEPTION 'link/audit failure was not atomic';END IF;checks:=checks+3;
 CREATE TEMP TABLE sandy_channel_link_test_report AS SELECT checks passed,0 failed,true rolled_back,false external_provider_verified;
END $test$;
SELECT * FROM sandy_channel_link_test_report;
