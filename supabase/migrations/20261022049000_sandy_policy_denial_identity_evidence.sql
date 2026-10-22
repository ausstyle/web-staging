BEGIN;
-- Bind pre-admission policy denials to the actual normal Auth workload without
-- retaining rejected arguments or creating a provider admission.
ALTER TABLE public.sandy_engineering_identity_events DROP CONSTRAINT sandy_engineering_identity_events_event_type_check;
ALTER TABLE public.sandy_engineering_identity_events ADD CONSTRAINT sandy_engineering_identity_events_event_type_check CHECK(event_type IN('provisioned','authorized','session_issued','session_retired','execution_authorized','credential_rotation_started','credential_rotated','bootstrap_installed','bootstrap_delivered','revoked','scope_authorized','scope_revoked','execution_session_rebound','execution_policy_denied'));
CREATE OR REPLACE FUNCTION public.sandy_engineering_record_policy_denial(p_user_id uuid, p_session_id uuid, p_epoch integer, p_request_id uuid, p_operation text, p_input_sha256 text, p_error text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
DECLARE r jsonb;seq bigint;identity_event bigint;
BEGIN
 r:=public.sandy_engineering_resolve_identity(p_user_id,p_session_id,p_epoch);
 IF r->>'ok' IS DISTINCT FROM 'true' OR p_request_id IS NULL OR p_input_sha256 IS NULL OR p_input_sha256 !~ '^[a-f0-9]{64}$'
 OR p_error IS NULL OR p_error !~ '^[a-z][a-z0-9_]{2,80}$' OR NOT EXISTS(SELECT 1 FROM public.sandy_operation_registry WHERE operation=p_operation)
 THEN RETURN jsonb_build_object('ok',false);END IF;
 -- Digests only; no rejected source, credentials or user arguments are logged.
 INSERT INTO public.sandy_engineering_identity_events(identity_user_id,owner_authority_id,actor_kind,event_type,detail)
 VALUES(p_user_id,(r->>'owner_authority_id')::uuid,'verified_auth_workload','execution_policy_denied',
  jsonb_build_object('request_id',p_request_id,'session_id',p_session_id,'credential_epoch',p_epoch,'operation',p_operation,'input_sha256',p_input_sha256,'error',p_error)) RETURNING id INTO identity_event;
 seq:=public.sandy_api_append_audit((r->>'owner_authority_id')::uuid,p_operation,p_request_id,NULL,NULL,'policy','rejected',p_input_sha256,encode(extensions.digest(jsonb_build_object('error',p_error,'authenticated_user_id',p_user_id,'identity_event_id',identity_event)::text,'sha256'),'hex'),NULL,NULL);
 RETURN jsonb_build_object('ok',true,'audit_sequence',seq);
END $function$
;
COMMIT;
