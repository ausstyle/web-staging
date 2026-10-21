BEGIN;
-- Deliver only this workload's own encrypted bootstrap to a trusted managed
-- runtime client. No table permission is widened and no customer role can call.
ALTER TABLE public.sandy_engineering_identity_events DROP CONSTRAINT sandy_engineering_identity_events_event_type_check;
ALTER TABLE public.sandy_engineering_identity_events ADD CONSTRAINT sandy_engineering_identity_events_event_type_check
 CHECK(event_type IN('provisioned','authorized','session_issued','session_retired','execution_authorized','credential_rotation_started','credential_rotated','bootstrap_installed','bootstrap_delivered','revoked'));
CREATE FUNCTION public.sandy_engineering_runtime_bootstrap(p_user_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE identity public.sandy_engineering_test_identities%ROWTYPE; credential text; BEGIN
 SELECT * INTO identity FROM public.sandy_engineering_test_identities WHERE user_id=p_user_id FOR SHARE;
 IF identity.user_id IS NULL OR NOT identity.enabled OR identity.revoked_at IS NOT NULL OR identity.rotation_state<>'ready'
  OR NOT public.sandy_api_current_owner(identity.authorized_by)
  OR EXISTS(SELECT 1 FROM public.sandy_controller_admins WHERE auth_user_id=p_user_id)
  OR NOT EXISTS(SELECT 1 FROM auth.users WHERE id=p_user_id AND email='sandy-engineering-test@sandy-ai.internal' AND role='authenticated'
   AND raw_app_meta_data->>'sandy_engineering_test'='true' AND raw_app_meta_data->>'sandy_engineering_epoch'=identity.credential_epoch::text
   AND (banned_until IS NULL OR banned_until<=clock_timestamp()))
 THEN RETURN jsonb_build_object('ok',false,'error','engineering_identity_not_authorized');END IF;
 SELECT decrypted_secret INTO credential FROM vault.decrypted_secrets WHERE id=identity.bootstrap_secret_id
  AND name='sandy-engineering-runtime/bootstrap/'||p_user_id::text;
 IF credential IS NULL OR encode(extensions.digest(credential,'sha256'),'hex') IS DISTINCT FROM identity.bootstrap_sha256
 THEN RETURN jsonb_build_object('ok',false,'error','engineering_bootstrap_integrity_failed');END IF;
 INSERT INTO public.sandy_engineering_identity_events(identity_user_id,owner_authority_id,actor_kind,event_type,detail)
 VALUES(p_user_id,identity.authorized_by,'management_administration','bootstrap_delivered',
 jsonb_build_object('bootstrap_generation',identity.bootstrap_generation,'delivery','private_managed_runtime_client'));
 RETURN jsonb_build_object('ok',true,'credential',credential);
END $$;
REVOKE ALL ON FUNCTION public.sandy_engineering_runtime_bootstrap(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.sandy_engineering_runtime_bootstrap(uuid) TO service_role;
COMMIT;
