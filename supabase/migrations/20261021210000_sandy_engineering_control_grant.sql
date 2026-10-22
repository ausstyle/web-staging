BEGIN;
-- Extend the existing revocable workload/session authority to bounded Controller
-- metadata actions. These grants do not confer Controller membership, approval,
-- provider execution, deployment or an Auth token of a human owner.
CREATE TABLE public.sandy_engineering_control_grants (
 identity_user_id uuid PRIMARY KEY REFERENCES public.sandy_engineering_test_identities(user_id),
 authorized_by uuid NOT NULL REFERENCES auth.users(id),
 authorization_ref text NOT NULL CHECK(length(authorization_ref) BETWEEN 10 AND 500),
 authorization_sha256 text NOT NULL CHECK(authorization_sha256 ~ '^[a-f0-9]{64}$'),
 allowed_actions text[] NOT NULL CHECK(cardinality(allowed_actions)>0 AND allowed_actions <@ ARRAY['register','get','list','test','artifact']::text[]),
 scope_prefixes text[] NOT NULL CHECK(cardinality(scope_prefixes)>0 AND cardinality(scope_prefixes)<=50 AND array_position(scope_prefixes,'') IS NULL AND array_position(scope_prefixes,NULL) IS NULL),
 allowed_risks text[] NOT NULL DEFAULT ARRAY['low','normal']::text[] CHECK(cardinality(allowed_risks)>0 AND allowed_risks <@ ARRAY['low','normal']::text[]),
 enabled boolean NOT NULL DEFAULT false,
 expires_at timestamptz NOT NULL,
 revoked_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
ALTER TABLE public.sandy_engineering_control_grants ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.sandy_engineering_control_grants FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT,UPDATE ON public.sandy_engineering_control_grants TO service_role;

CREATE FUNCTION public.sandy_engineering_resolve_control_grant(p_user_id uuid,p_session_id uuid,p_epoch integer,p_action text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE resolved jsonb; grant_row public.sandy_engineering_control_grants%ROWTYPE;
BEGIN
 resolved:=public.sandy_engineering_resolve_identity(p_user_id,p_session_id,p_epoch);
 IF resolved->>'ok' IS DISTINCT FROM 'true' THEN RETURN resolved;END IF;
 SELECT * INTO grant_row FROM public.sandy_engineering_control_grants WHERE identity_user_id=p_user_id FOR SHARE;
 IF grant_row.identity_user_id IS NULL OR NOT grant_row.enabled OR grant_row.revoked_at IS NOT NULL OR grant_row.expires_at<=clock_timestamp()
  OR grant_row.authorized_by::text IS DISTINCT FROM resolved->>'owner_authority_id'
  OR NOT public.sandy_api_current_owner(grant_row.authorized_by)
  OR p_action IS NULL OR NOT (p_action=ANY(grant_row.allowed_actions))
 THEN RETURN jsonb_build_object('ok',false,'error','engineering_control_scope_denied');END IF;
 INSERT INTO public.sandy_engineering_identity_events(identity_user_id,owner_authority_id,actor_kind,event_type,detail)
 VALUES(p_user_id,grant_row.authorized_by,'verified_auth_workload','execution_authorized',
  jsonb_build_object('boundary','engineering_control','action',p_action,'session_id',p_session_id,'credential_epoch',p_epoch,'authorization_ref',grant_row.authorization_ref));
 RETURN jsonb_build_object('ok',true,'owner_authority_id',grant_row.authorized_by,'scope_prefixes',grant_row.scope_prefixes,'allowed_risks',grant_row.allowed_risks);
END $$;
REVOKE ALL ON FUNCTION public.sandy_engineering_resolve_control_grant(uuid,uuid,integer,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.sandy_engineering_resolve_control_grant(uuid,uuid,integer,text) TO service_role;

-- Shared source releases need a durable per-component lease in addition to the
-- immediate live-source/version guard. A lease never authorizes deployment.
CREATE TABLE public.sandy_engineering_component_leases (
 component text PRIMARY KEY,
 holder text NOT NULL,
 change_id uuid NOT NULL REFERENCES public.sandy_engineering_changes(id),
 expected_source_sha256 text NOT NULL CHECK(expected_source_sha256 ~ '^[a-f0-9]{64}$'),
 expires_at timestamptz NOT NULL,
 acquired_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
ALTER TABLE public.sandy_engineering_component_leases ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.sandy_engineering_component_leases FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT,UPDATE,DELETE ON public.sandy_engineering_component_leases TO service_role;
COMMIT;
