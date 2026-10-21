BEGIN;
-- Dedicated normal Auth workload; never a global Controller owner.
-- Standing fixture delegation is distinct from a human session. Administrative
-- bootstrap must reference an existing, genuinely owner-approved change and is
-- audited as management administration, never as a new interactive approval.
CREATE TABLE public.sandy_engineering_test_identities (
 user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE RESTRICT,
 enabled boolean NOT NULL DEFAULT false,
 authorized_by uuid REFERENCES auth.users(id),
 source_approval_change_id uuid REFERENCES public.sandy_engineering_changes(id),
 delegation_change_id uuid REFERENCES public.sandy_engineering_changes(id),
 policy_sha256 text NOT NULL DEFAULT '53757b36eda9e249e880e295d4d25183c27401fbc2facd651fe74a2d025523f3'
 CHECK(policy_sha256='53757b36eda9e249e880e295d4d25183c27401fbc2facd651fe74a2d025523f3'),
 credential_epoch integer NOT NULL DEFAULT 1 CHECK(credential_epoch>0),
 auth_issue_lease_id uuid, auth_issue_lease_until timestamptz,
 active_session_id uuid, active_session_expires_at timestamptz,
 bootstrap_secret_id uuid, bootstrap_sha256 text CHECK(bootstrap_sha256~'^[a-f0-9]{64}$'), bootstrap_generation integer NOT NULL DEFAULT 0, bootstrap_rotated_at timestamptz,
 rotation_bootstrap_generation integer,
 rotation_state text NOT NULL DEFAULT 'ready' CHECK(rotation_state IN('ready','rotating')),
 revoked_at timestamptz, created_at timestamptz NOT NULL DEFAULT clock_timestamp(), updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 CHECK(NOT enabled OR (authorized_by IS NOT NULL AND source_approval_change_id IS NOT NULL AND delegation_change_id IS NOT NULL AND revoked_at IS NULL))
);
CREATE TABLE public.sandy_engineering_auth_sessions (
 identity_user_id uuid NOT NULL REFERENCES public.sandy_engineering_test_identities(user_id),
 session_id uuid PRIMARY KEY, credential_epoch integer NOT NULL, expires_at timestamptz NOT NULL,
 revoked_at timestamptz, created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
ALTER TABLE public.sandy_engineering_auth_sessions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.sandy_engineering_auth_sessions FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT,UPDATE ON public.sandy_engineering_auth_sessions TO service_role;
CREATE TABLE public.sandy_engineering_identity_events (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 identity_user_id uuid NOT NULL REFERENCES public.sandy_engineering_test_identities(user_id),
 owner_authority_id uuid, actor_kind text NOT NULL CHECK(actor_kind IN('management_administration','controller_owner','engineering_runtime','verified_auth_workload')),
 event_type text NOT NULL CHECK(event_type IN('provisioned','authorized','session_issued','session_retired','execution_authorized','credential_rotation_started','credential_rotated','bootstrap_installed','revoked')),
 detail jsonb NOT NULL DEFAULT '{}'::jsonb, occurred_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE public.sandy_engineering_execution_authorizations (
 identity_user_id uuid NOT NULL REFERENCES public.sandy_engineering_test_identities(user_id),
 request_id uuid NOT NULL, owner_authority_id uuid NOT NULL, session_id uuid NOT NULL, credential_epoch integer NOT NULL,
 operation text NOT NULL, input_sha256 text NOT NULL CHECK(input_sha256~'^[a-f0-9]{64}$'),
 contract_sha256 text NOT NULL CHECK(contract_sha256~'^[a-f0-9]{64}$'), scope_sha256 text NOT NULL CHECK(scope_sha256~'^[a-f0-9]{64}$'),
 job_id uuid NOT NULL UNIQUE REFERENCES public.sandy_deployment_jobs(id), created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(identity_user_id,request_id), UNIQUE(owner_authority_id,request_id)
);
ALTER TABLE public.sandy_engineering_test_identities ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sandy_engineering_identity_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sandy_engineering_execution_authorizations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.sandy_engineering_test_identities,public.sandy_engineering_identity_events,public.sandy_engineering_execution_authorizations FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT,UPDATE ON public.sandy_engineering_test_identities TO service_role;
GRANT SELECT,INSERT ON public.sandy_engineering_identity_events,public.sandy_engineering_execution_authorizations TO service_role;
GRANT USAGE,SELECT ON SEQUENCE public.sandy_engineering_identity_events_id_seq TO service_role;
CREATE TRIGGER sandy_engineering_identity_events_immutable BEFORE UPDATE OR DELETE ON public.sandy_engineering_identity_events
 FOR EACH ROW EXECUTE FUNCTION public.sandy_api_refuse_audit_edit();
CREATE TRIGGER sandy_engineering_execution_authorizations_immutable BEFORE UPDATE OR DELETE ON public.sandy_engineering_execution_authorizations
 FOR EACH ROW EXECUTE FUNCTION public.sandy_api_refuse_audit_edit();

CREATE FUNCTION public.sandy_engineering_provision_identity(p_user_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM auth.users WHERE id=p_user_id AND email='sandy-engineering-test@sandy-ai.internal'
  AND role='authenticated' AND raw_app_meta_data->>'sandy_engineering_test'='true'
  AND raw_app_meta_data->>'sandy_engineering_epoch'=coalesce((SELECT credential_epoch::text FROM public.sandy_engineering_test_identities WHERE user_id=p_user_id),'1'))
  OR EXISTS(SELECT 1 FROM public.sandy_controller_admins WHERE auth_user_id=p_user_id)
 THEN RAISE EXCEPTION 'dedicated_nonowner_auth_identity_required' USING ERRCODE='42501';END IF;
 INSERT INTO public.sandy_engineering_test_identities(user_id) VALUES(p_user_id) ON CONFLICT DO NOTHING;
 IF FOUND THEN INSERT INTO public.sandy_engineering_identity_events(identity_user_id,actor_kind,event_type)
  VALUES(p_user_id,'management_administration','provisioned');END IF;
 RETURN jsonb_build_object('ok',true,'identity_user_id',p_user_id,'global_controller_membership',false);
END $$;

CREATE FUNCTION public.sandy_engineering_grant_identity(p_user_id uuid,p_source_change_id uuid,p_actor_kind text,p_owner_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE source public.sandy_engineering_changes%ROWTYPE; identity public.sandy_engineering_test_identities%ROWTYPE; new_change_id uuid;
BEGIN
 SELECT * INTO identity FROM public.sandy_engineering_test_identities WHERE user_id=p_user_id FOR UPDATE;
 SELECT * INTO source FROM public.sandy_engineering_changes WHERE id=p_source_change_id;
 IF identity.user_id IS NULL OR identity.revoked_at IS NOT NULL OR source.id IS NULL OR source.status NOT IN('approved','implementing','committed','deployed','verified')
  OR source.requested_by IS DISTINCT FROM p_owner_id OR NOT public.sandy_api_current_owner(p_owner_id)
  OR p_actor_kind NOT IN('management_administration','controller_owner')
  OR EXISTS(SELECT 1 FROM public.sandy_controller_admins WHERE auth_user_id=p_user_id)
  OR NOT EXISTS(SELECT 1 FROM public.sandy_engineering_change_events WHERE change_id=source.id AND actor=p_owner_id
    AND ((event_type='status_changed' AND detail->>'to'='approved') OR event_type='delegated_auto_approved'))
  OR NOT source.scope @> '["github:ausstyle/web-staging:engineering-smoke/mcp-execution-20261021.txt","github:ausstyle/web-staging:git-objects","supabase:zmqlyygzqoidkcwdysok:supabase.deploy_edge_function","supabase:zmqlyygzqoidkcwdysok:supabase.db.migrations.apply","supabase:zmqlyygzqoidkcwdysok:supabase.functions.secrets.set"]'::jsonb
  OR NOT EXISTS(SELECT 1 FROM public.sandy_engineering_tests WHERE change_id=source.id AND outcome='passed')
 THEN RAISE EXCEPTION 'existing_owner_approved_fixture_change_required' USING ERRCODE='42501';END IF;
 IF identity.enabled THEN
  IF identity.authorized_by IS DISTINCT FROM p_owner_id OR identity.source_approval_change_id IS DISTINCT FROM source.id THEN
   RAISE EXCEPTION 'engineering_identity_authority_conflict' USING ERRCODE='23514';END IF;
  RETURN jsonb_build_object('ok',true,'authorized',true,'reused',true);END IF;
 INSERT INTO public.sandy_engineering_changes(title,problem,expected_behavior,change_purpose,feature_improvement,scope,regression_rules,acceptance_criteria,risk,requested_by,idempotency_key,status)
 VALUES('Standing isolated engineering test delegation','A personal Controller JWT must not be reused as an engineering workload credential.',
 'A separate normal Auth identity executes only pinned fixtures under this revocable delegation.',
 'Materialize the explicitly requested engineering test identity using an existing authenticated owner-approved fixture change.',
 'Fresh verified workload sessions, scoped execution, rotation, revocation and immutable audit evidence.',
 source.scope||'["fixture-console-only:sandy-engineering-execution-fixture"]'::jsonb,
 '["No global Controller membership","Normal Supabase Auth verification and active owner authority required","No production source, arbitrary SQL, function code or secrets"]'::jsonb,
 '["Only fixed fixture operations work","Every mutation retains exact approval and one-use admission","Revocation prevents new execution"]'::jsonb,
 'low',p_user_id,'engineering-test-delegation:'||p_user_id::text,'approved') RETURNING id INTO new_change_id;
 UPDATE public.sandy_engineering_test_identities SET enabled=true,authorized_by=p_owner_id,source_approval_change_id=source.id,
  delegation_change_id=new_change_id,updated_at=clock_timestamp() WHERE user_id=p_user_id;
 INSERT INTO public.sandy_engineering_identity_events(identity_user_id,owner_authority_id,actor_kind,event_type,detail)
 VALUES(p_user_id,p_owner_id,p_actor_kind,'authorized',jsonb_build_object('source_approval_change_id',source.id,'delegation_change_id',new_change_id,
 'policy_sha256',identity.policy_sha256,'authorization_mode','revocable_standing_fixture_delegation','interactive_owner_session_used',p_actor_kind='controller_owner'));
 INSERT INTO public.sandy_engineering_change_events(change_id,event_type,actor,detail)
 VALUES(new_change_id,'standing_fixture_delegation_materialized',p_user_id,jsonb_build_object('source_approval_change_id',source.id,
 'owner_authority_id',p_owner_id,'administrative_provisioning',p_actor_kind='management_administration','not_a_new_interactive_owner_approval',true));
 RETURN jsonb_build_object('ok',true,'authorized',true,'identity_user_id',p_user_id,'delegation_change_id',new_change_id,'global_controller_membership',false);
END $$;
REVOKE ALL ON FUNCTION public.sandy_engineering_grant_identity(uuid,uuid,text,uuid) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.sandy_engineering_bootstrap_identity(p_user_id uuid,p_source_change_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$ DECLARE owner_id uuid; BEGIN
 SELECT requested_by INTO owner_id FROM public.sandy_engineering_changes WHERE id=p_source_change_id;
 RETURN public.sandy_engineering_grant_identity(p_user_id,p_source_change_id,'management_administration',owner_id);
END $$;
CREATE FUNCTION public.sandy_engineering_authorize_identity(p_user_id uuid,p_source_change_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$ BEGIN
 IF auth.uid() IS NULL OR auth.role()<>'authenticated' OR auth.jwt()->>'is_anonymous'='true' OR NOT public.sandy_api_current_owner(auth.uid()) THEN
  RAISE EXCEPTION 'normal_controller_owner_session_required' USING ERRCODE='42501';END IF;
 RETURN public.sandy_engineering_grant_identity(p_user_id,p_source_change_id,'controller_owner',auth.uid());
END $$;

CREATE FUNCTION public.sandy_engineering_resolve_identity(p_user_id uuid,p_session_id uuid,p_epoch integer) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE identity public.sandy_engineering_test_identities%ROWTYPE; BEGIN
 SELECT * INTO identity FROM public.sandy_engineering_test_identities WHERE user_id=p_user_id;
 IF identity.user_id IS NULL OR NOT identity.enabled OR identity.revoked_at IS NOT NULL OR identity.rotation_state<>'ready'
  OR identity.credential_epoch IS DISTINCT FROM p_epoch OR NOT public.sandy_api_current_owner(identity.authorized_by)
  OR NOT EXISTS(SELECT 1 FROM public.sandy_engineering_auth_sessions WHERE identity_user_id=p_user_id AND session_id=p_session_id
    AND credential_epoch=p_epoch AND revoked_at IS NULL AND expires_at>clock_timestamp())
  OR EXISTS(SELECT 1 FROM public.sandy_controller_admins WHERE auth_user_id=p_user_id)
  OR NOT EXISTS(SELECT 1 FROM auth.users WHERE id=p_user_id AND role='authenticated' AND email='sandy-engineering-test@sandy-ai.internal'
   AND raw_app_meta_data->>'sandy_engineering_test'='true' AND raw_app_meta_data->>'sandy_engineering_epoch'=p_epoch::text
   AND (banned_until IS NULL OR banned_until<=clock_timestamp()))
  OR NOT EXISTS(SELECT 1 FROM auth.sessions WHERE id=p_session_id AND user_id=p_user_id)
  OR NOT EXISTS(SELECT 1 FROM public.sandy_engineering_changes WHERE id=identity.delegation_change_id AND status='approved')
  OR NOT EXISTS(SELECT 1 FROM public.sandy_engineering_changes WHERE id=identity.source_approval_change_id AND status IN('approved','implementing','committed','deployed','verified'))
 THEN RETURN jsonb_build_object('ok',false,'error','engineering_identity_not_authorized','http_status',403);END IF;
 RETURN jsonb_build_object('ok',true,'owner_authority_id',identity.authorized_by,'identity_user_id',p_user_id,
 'policy_sha256',identity.policy_sha256,'credential_epoch',identity.credential_epoch,'session_id',p_session_id,
 'operations',jsonb_build_array('github.files.update','github.commit','supabase.deploy_edge_function','supabase.db.migrations.apply','supabase.functions.secrets.set','supabase.logs.query'));
END $$;

CREATE FUNCTION public.sandy_engineering_register_session(p_user_id uuid,p_session_id uuid,p_epoch integer,p_expires_at timestamptz) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE identity public.sandy_engineering_test_identities%ROWTYPE; BEGIN
 SELECT * INTO identity FROM public.sandy_engineering_test_identities WHERE user_id=p_user_id FOR UPDATE;
 IF identity.user_id IS NULL OR NOT identity.enabled OR identity.revoked_at IS NOT NULL OR identity.rotation_state<>'ready'
  OR identity.credential_epoch IS DISTINCT FROM p_epoch OR NOT public.sandy_api_current_owner(identity.authorized_by)
  OR p_expires_at<=clock_timestamp() OR p_expires_at>clock_timestamp()+interval '65 minutes'
  OR NOT EXISTS(SELECT 1 FROM auth.sessions WHERE id=p_session_id AND user_id=p_user_id)
  OR NOT EXISTS(SELECT 1 FROM auth.users WHERE id=p_user_id AND raw_app_meta_data->>'sandy_engineering_test'='true'
    AND raw_app_meta_data->>'sandy_engineering_epoch'=p_epoch::text AND (banned_until IS NULL OR banned_until<=clock_timestamp()))
  OR EXISTS(SELECT 1 FROM public.sandy_controller_admins WHERE auth_user_id=p_user_id)
 THEN RETURN jsonb_build_object('ok',false,'error','engineering_identity_not_authorized');END IF;
 INSERT INTO public.sandy_engineering_auth_sessions(identity_user_id,session_id,credential_epoch,expires_at)
 VALUES(p_user_id,p_session_id,p_epoch,p_expires_at) ON CONFLICT(session_id) DO NOTHING;
 UPDATE public.sandy_engineering_test_identities SET active_session_id=p_session_id,active_session_expires_at=p_expires_at,updated_at=clock_timestamp() WHERE user_id=p_user_id;
 INSERT INTO public.sandy_engineering_identity_events(identity_user_id,owner_authority_id,actor_kind,event_type,detail)
 VALUES(p_user_id,identity.authorized_by,'engineering_runtime','session_issued',jsonb_build_object('session_id',p_session_id,'credential_epoch',p_epoch,'expires_at',p_expires_at));
 RETURN jsonb_build_object('ok',true,'registered',true);
END $$;

CREATE FUNCTION public.sandy_engineering_prepare_execution(p_user_id uuid,p_session_id uuid,p_epoch integer,p_request_id uuid,
 p_operation text,p_input_sha256 text,p_contract_sha256 text,p_scope_sha256 text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE resolved jsonb; identity public.sandy_engineering_test_identities%ROWTYPE; prior public.sandy_engineering_execution_authorizations%ROWTYPE;
 entry public.sandy_operation_registry%ROWTYPE; job_id uuid; BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended(p_user_id::text||':'||p_request_id::text,0));
 resolved:=public.sandy_engineering_resolve_identity(p_user_id,p_session_id,p_epoch);
 IF resolved->>'ok' IS DISTINCT FROM 'true' THEN RETURN resolved;END IF;
 IF p_request_id IS NULL OR p_operation NOT IN('github.files.update','github.commit','supabase.deploy_edge_function','supabase.db.migrations.apply','supabase.functions.secrets.set','supabase.logs.query')
  OR p_input_sha256 IS NULL OR p_input_sha256 !~ '^[a-f0-9]{64}$' OR p_contract_sha256 IS NULL OR p_contract_sha256 !~ '^[a-f0-9]{64}$'
  OR p_scope_sha256 IS NULL OR p_scope_sha256 !~ '^[a-f0-9]{64}$' THEN RETURN jsonb_build_object('ok',false,'error','invalid_engineering_execution');END IF;
 SELECT * INTO identity FROM public.sandy_engineering_test_identities WHERE user_id=p_user_id FOR UPDATE;
 SELECT * INTO entry FROM public.sandy_operation_registry WHERE operation=p_operation;
 IF entry.operation IS NULL OR NOT entry.api_exposed OR NOT entry.ai_exposed OR NOT entry.verified
  OR entry.error_contract->>'contract_sha256' IS DISTINCT FROM p_contract_sha256 THEN
  RETURN jsonb_build_object('ok',false,'error','engineering_execution_contract_unavailable');END IF;
 SELECT * INTO prior FROM public.sandy_engineering_execution_authorizations WHERE identity_user_id=p_user_id AND request_id=p_request_id;
 IF FOUND THEN
  IF prior.operation<>p_operation OR prior.input_sha256<>p_input_sha256 OR prior.contract_sha256<>p_contract_sha256 OR prior.scope_sha256<>p_scope_sha256
   OR prior.credential_epoch<>p_epoch OR prior.session_id<>p_session_id THEN RETURN jsonb_build_object('ok',false,'error','engineering_request_conflict');END IF;
  RETURN jsonb_build_object('ok',true,'approval_id',prior.job_id,'reused',true);END IF;
 IF (SELECT count(*) FROM public.sandy_engineering_execution_authorizations WHERE identity_user_id=p_user_id AND created_at>=date_trunc('minute',clock_timestamp()))>=30 THEN RETURN jsonb_build_object('ok',false,'error','engineering_rate_limited','http_status',429);END IF;
 INSERT INTO public.sandy_deployment_jobs(requested_by,provider,operation,target,payload,idempotency_key,status,engineering_change_id,approved_by,approved_at)
 VALUES(p_user_id::text,split_part(p_operation,'.',1),p_operation,'isolated-engineering-fixtures',
 jsonb_build_object('engineering_change_id',identity.delegation_change_id,'engineering_test_identity_id',p_user_id,
 'authorization_mode','owner_authorized_standing_fixture_delegation','source_approval_change_id',identity.source_approval_change_id,
 'sandy_api_execution',jsonb_build_object('operation',p_operation,'input_sha256',p_input_sha256,'contract_sha256',p_contract_sha256,
 'scope_sha256',p_scope_sha256,'maximum_declared_cost_units',0)),
 'engineering-identity:'||p_user_id::text||':'||p_request_id::text,'approved',identity.delegation_change_id,identity.authorized_by::text,clock_timestamp()) RETURNING id INTO job_id;
 INSERT INTO public.sandy_engineering_execution_authorizations(identity_user_id,request_id,owner_authority_id,session_id,credential_epoch,operation,input_sha256,contract_sha256,scope_sha256,job_id)
 VALUES(p_user_id,p_request_id,identity.authorized_by,p_session_id,p_epoch,p_operation,p_input_sha256,p_contract_sha256,p_scope_sha256,job_id);
 INSERT INTO public.sandy_engineering_identity_events(identity_user_id,owner_authority_id,actor_kind,event_type,detail)
 VALUES(p_user_id,identity.authorized_by,'verified_auth_workload','execution_authorized',jsonb_build_object('request_id',p_request_id,
 'operation',p_operation,'approval_id',job_id,'input_sha256',p_input_sha256,'credential_epoch',p_epoch,'session_id',p_session_id));
 RETURN jsonb_build_object('ok',true,'approval_id',job_id,'reused',false);
END $$;

CREATE FUNCTION public.sandy_engineering_rotate_identity(p_user_id uuid,p_complete boolean DEFAULT false) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE identity public.sandy_engineering_test_identities%ROWTYPE; BEGIN
 SELECT * INTO identity FROM public.sandy_engineering_test_identities WHERE user_id=p_user_id FOR UPDATE;
 IF identity.user_id IS NULL OR NOT identity.enabled OR identity.revoked_at IS NOT NULL OR NOT public.sandy_api_current_owner(identity.authorized_by)
 THEN RETURN jsonb_build_object('ok',false,'error','engineering_identity_not_authorized');END IF;
 IF p_complete THEN
  IF identity.rotation_state<>'rotating' OR identity.bootstrap_generation<=coalesce(identity.rotation_bootstrap_generation,identity.bootstrap_generation) OR NOT EXISTS(SELECT 1 FROM auth.users WHERE id=p_user_id AND raw_app_meta_data->>'sandy_engineering_epoch'=identity.credential_epoch::text)
  THEN RETURN jsonb_build_object('ok',false,'error','engineering_rotation_metadata_not_confirmed');END IF;
  UPDATE public.sandy_engineering_test_identities SET rotation_state='ready',updated_at=clock_timestamp() WHERE user_id=p_user_id;
 ELSE
  IF identity.rotation_state='rotating' THEN RETURN jsonb_build_object('ok',true,'credential_epoch',identity.credential_epoch,'reused',true);END IF;
  UPDATE public.sandy_engineering_test_identities SET credential_epoch=credential_epoch+1,active_session_id=NULL,active_session_expires_at=NULL,
   rotation_state='rotating',rotation_bootstrap_generation=bootstrap_generation,updated_at=clock_timestamp() WHERE user_id=p_user_id RETURNING * INTO identity;
  UPDATE public.sandy_deployment_jobs j SET status='cancelled',updated_at=clock_timestamp() FROM public.sandy_engineering_execution_authorizations e
  WHERE e.identity_user_id=p_user_id AND j.id=e.job_id AND j.status='approved';
 END IF;
 INSERT INTO public.sandy_engineering_identity_events(identity_user_id,owner_authority_id,actor_kind,event_type,detail)
 VALUES(p_user_id,identity.authorized_by,'engineering_runtime',CASE WHEN p_complete THEN 'credential_rotated' ELSE 'credential_rotation_started' END,
 jsonb_build_object('credential_epoch',identity.credential_epoch));
 RETURN jsonb_build_object('ok',true,'credential_epoch',identity.credential_epoch,'ready',p_complete);
END $$;

CREATE FUNCTION public.sandy_engineering_revoke_identity(p_user_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE identity public.sandy_engineering_test_identities%ROWTYPE; BEGIN
 IF auth.uid() IS NULL OR auth.role()<>'authenticated' OR auth.jwt()->>'is_anonymous'='true' OR NOT public.sandy_api_current_owner(auth.uid()) THEN
  RAISE EXCEPTION 'normal_controller_owner_session_required' USING ERRCODE='42501';END IF;
 SELECT * INTO identity FROM public.sandy_engineering_test_identities WHERE user_id=p_user_id FOR UPDATE;
 IF identity.user_id IS NULL THEN RETURN jsonb_build_object('ok',false,'error','engineering_identity_not_found');END IF;
 UPDATE public.sandy_engineering_test_identities SET enabled=false,revoked_at=coalesce(revoked_at,clock_timestamp()),active_session_id=NULL,
 active_session_expires_at=NULL,updated_at=clock_timestamp() WHERE user_id=p_user_id;
 UPDATE public.sandy_engineering_changes SET status='cancelled',updated_at=clock_timestamp() WHERE id=identity.delegation_change_id AND status='approved';
 UPDATE public.sandy_deployment_jobs j SET status='cancelled',updated_at=clock_timestamp() FROM public.sandy_engineering_execution_authorizations e
 WHERE e.identity_user_id=p_user_id AND j.id=e.job_id AND j.status='approved';
 INSERT INTO public.sandy_engineering_identity_events(identity_user_id,owner_authority_id,actor_kind,event_type)
 VALUES(p_user_id,auth.uid(),'controller_owner','revoked');
 RETURN jsonb_build_object('ok',true,'revoked',true);
END $$;

REVOKE ALL ON FUNCTION public.sandy_engineering_provision_identity(uuid),public.sandy_engineering_bootstrap_identity(uuid,uuid),
 public.sandy_engineering_resolve_identity(uuid,uuid,integer),public.sandy_engineering_register_session(uuid,uuid,integer,timestamptz),
 public.sandy_engineering_prepare_execution(uuid,uuid,integer,uuid,text,text,text,text),public.sandy_engineering_rotate_identity(uuid,boolean),
 public.sandy_engineering_authorize_identity(uuid,uuid),public.sandy_engineering_revoke_identity(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.sandy_engineering_provision_identity(uuid),public.sandy_engineering_bootstrap_identity(uuid,uuid),
 public.sandy_engineering_resolve_identity(uuid,uuid,integer),public.sandy_engineering_register_session(uuid,uuid,integer,timestamptz),
 public.sandy_engineering_prepare_execution(uuid,uuid,integer,uuid,text,text,text,text),public.sandy_engineering_rotate_identity(uuid,boolean) TO service_role;
GRANT EXECUTE ON FUNCTION public.sandy_engineering_authorize_identity(uuid,uuid),public.sandy_engineering_revoke_identity(uuid) TO authenticated;

CREATE FUNCTION public.sandy_engineering_install_bootstrap(p_user_id uuid,p_secret_id uuid,p_sha256 text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$ BEGIN
 IF p_sha256 IS NULL OR p_sha256 !~ '^[a-f0-9]{64}$' OR NOT EXISTS(SELECT 1 FROM public.sandy_engineering_test_identities
  WHERE user_id=p_user_id AND enabled AND revoked_at IS NULL AND (bootstrap_generation=0 OR rotation_state='rotating') AND public.sandy_api_current_owner(authorized_by))
  OR NOT EXISTS(SELECT 1 FROM vault.decrypted_secrets WHERE id=p_secret_id AND name='sandy-engineering-runtime/bootstrap/'||p_user_id::text
   AND encode(extensions.digest(decrypted_secret,'sha256'),'hex')=p_sha256)
 THEN RAISE EXCEPTION 'verified_engineering_bootstrap_secret_required' USING ERRCODE='42501';END IF;
 UPDATE public.sandy_engineering_test_identities SET bootstrap_secret_id=p_secret_id,bootstrap_sha256=p_sha256,
  bootstrap_generation=bootstrap_generation+1,bootstrap_rotated_at=clock_timestamp(),updated_at=clock_timestamp() WHERE user_id=p_user_id;
 RETURN jsonb_build_object('ok',true,'installed',true);
END $$;
CREATE FUNCTION public.sandy_engineering_resolve_bootstrap(p_sha256 text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$ DECLARE identity public.sandy_engineering_test_identities%ROWTYPE; BEGIN
 IF p_sha256 IS NULL OR p_sha256 !~ '^[a-f0-9]{64}$' THEN RETURN jsonb_build_object('ok',false,'error','invalid_runtime_credential');END IF;
 SELECT * INTO identity FROM public.sandy_engineering_test_identities WHERE bootstrap_sha256=p_sha256;
 IF identity.user_id IS NULL OR NOT identity.enabled OR identity.revoked_at IS NOT NULL OR identity.rotation_state<>'ready'
  OR NOT public.sandy_api_current_owner(identity.authorized_by) OR EXISTS(SELECT 1 FROM public.sandy_controller_admins WHERE auth_user_id=identity.user_id)
  OR NOT EXISTS(SELECT 1 FROM auth.users WHERE id=identity.user_id AND role='authenticated' AND email='sandy-engineering-test@sandy-ai.internal'
    AND raw_app_meta_data->>'sandy_engineering_test'='true' AND raw_app_meta_data->>'sandy_engineering_epoch'=identity.credential_epoch::text
    AND (banned_until IS NULL OR banned_until<=clock_timestamp()))
 THEN RETURN jsonb_build_object('ok',false,'error','invalid_runtime_credential');END IF;
 RETURN jsonb_build_object('ok',true,'identity_user_id',identity.user_id,'credential_epoch',identity.credential_epoch,
  'bootstrap_generation',identity.bootstrap_generation,'policy_sha256',identity.policy_sha256);
END $$;
REVOKE ALL ON FUNCTION public.sandy_engineering_install_bootstrap(uuid,uuid,text),public.sandy_engineering_resolve_bootstrap(text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.sandy_engineering_install_bootstrap(uuid,uuid,text),public.sandy_engineering_resolve_bootstrap(text) TO service_role;

CREATE FUNCTION public.sandy_engineering_retire_session(p_user_id uuid,p_session_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$ BEGIN
 UPDATE public.sandy_engineering_auth_sessions SET revoked_at=coalesce(revoked_at,clock_timestamp())
 WHERE identity_user_id=p_user_id AND session_id=p_session_id;
 UPDATE public.sandy_deployment_jobs j SET status='cancelled',updated_at=clock_timestamp() FROM public.sandy_engineering_execution_authorizations e
 WHERE e.identity_user_id=p_user_id AND e.session_id=p_session_id AND j.id=e.job_id AND j.status='approved';
 INSERT INTO public.sandy_engineering_identity_events(identity_user_id,owner_authority_id,actor_kind,event_type,detail)
 SELECT user_id,authorized_by,'engineering_runtime','session_retired',jsonb_build_object('session_id',p_session_id)
 FROM public.sandy_engineering_test_identities WHERE user_id=p_user_id;
 RETURN jsonb_build_object('ok',true,'retired',true);
END $$;
REVOKE ALL ON FUNCTION public.sandy_engineering_retire_session(uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.sandy_engineering_retire_session(uuid,uuid) TO service_role;

CREATE FUNCTION public.sandy_engineering_administrative_revoke(p_user_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE identity public.sandy_engineering_test_identities%ROWTYPE; BEGIN
 SELECT * INTO identity FROM public.sandy_engineering_test_identities WHERE user_id=p_user_id FOR UPDATE;
 IF identity.user_id IS NULL THEN RETURN jsonb_build_object('ok',false,'error','engineering_identity_not_found');END IF;
 UPDATE public.sandy_engineering_test_identities SET enabled=false,revoked_at=coalesce(revoked_at,clock_timestamp()),active_session_id=NULL,
 active_session_expires_at=NULL,updated_at=clock_timestamp() WHERE user_id=p_user_id;
 UPDATE public.sandy_engineering_changes SET status='cancelled',updated_at=clock_timestamp() WHERE id=identity.delegation_change_id AND status='approved';
 UPDATE public.sandy_deployment_jobs j SET status='cancelled',updated_at=clock_timestamp() FROM public.sandy_engineering_execution_authorizations e
 WHERE e.identity_user_id=p_user_id AND j.id=e.job_id AND j.status='approved';
 INSERT INTO public.sandy_engineering_identity_events(identity_user_id,owner_authority_id,actor_kind,event_type)
 VALUES(p_user_id,identity.authorized_by,'management_administration','revoked');
 RETURN jsonb_build_object('ok',true,'revoked',true);
END $$;
REVOKE ALL ON FUNCTION public.sandy_engineering_administrative_revoke(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.sandy_engineering_administrative_revoke(uuid) TO service_role;

-- Secrets are supplied as bound RPC parameters, never embedded in SQL text.
CREATE FUNCTION public.sandy_engineering_store_bootstrap(p_user_id uuid,p_secret text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE identity public.sandy_engineering_test_identities%ROWTYPE; secret_id uuid; digest text; BEGIN
 SELECT * INTO identity FROM public.sandy_engineering_test_identities WHERE user_id=p_user_id FOR UPDATE;
 IF p_secret IS NULL OR p_secret !~ '^[A-Za-z0-9_-]{43,128}$' OR identity.user_id IS NULL OR NOT identity.enabled
  OR identity.revoked_at IS NOT NULL OR NOT public.sandy_api_current_owner(identity.authorized_by)
  OR (identity.bootstrap_generation>0 AND identity.rotation_state<>'rotating') THEN
  RAISE EXCEPTION 'authorized_engineering_credential_rotation_required' USING ERRCODE='42501';END IF;
 digest:=encode(extensions.digest(p_secret,'sha256'),'hex');secret_id:=identity.bootstrap_secret_id;
 IF secret_id IS NULL THEN
  SELECT vault.create_secret(p_secret,'sandy-engineering-runtime/bootstrap/'||p_user_id::text,'Scoped workload bootstrap; never a personal session') INTO secret_id;
 ELSE PERFORM vault.update_secret(secret_id,p_secret);END IF;
 PERFORM public.sandy_engineering_install_bootstrap(p_user_id,secret_id,digest);
 INSERT INTO public.sandy_engineering_identity_events(identity_user_id,owner_authority_id,actor_kind,event_type,detail)
 SELECT user_id,authorized_by,'engineering_runtime','bootstrap_installed',jsonb_build_object('bootstrap_generation',bootstrap_generation)
 FROM public.sandy_engineering_test_identities WHERE user_id=p_user_id;
 RETURN jsonb_build_object('ok',true,'stored_encrypted',true);
END $$;
REVOKE ALL ON FUNCTION public.sandy_engineering_store_bootstrap(uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.sandy_engineering_store_bootstrap(uuid,text) TO service_role;

CREATE FUNCTION public.sandy_engineering_claim_auth_issue(p_user_id uuid,p_epoch integer) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE identity public.sandy_engineering_test_identities%ROWTYPE; lease uuid; BEGIN
 SELECT * INTO identity FROM public.sandy_engineering_test_identities WHERE user_id=p_user_id FOR UPDATE;
 IF identity.user_id IS NULL OR NOT identity.enabled OR identity.revoked_at IS NOT NULL OR identity.rotation_state<>'ready'
  OR identity.credential_epoch IS DISTINCT FROM p_epoch OR NOT public.sandy_api_current_owner(identity.authorized_by)
 THEN RETURN jsonb_build_object('ok',false,'error','engineering_identity_not_authorized');END IF;
 IF identity.auth_issue_lease_until>clock_timestamp() THEN RETURN jsonb_build_object('ok',true,'busy',true);END IF;
 lease:=extensions.gen_random_uuid();
 UPDATE public.sandy_engineering_test_identities SET auth_issue_lease_id=lease,auth_issue_lease_until=clock_timestamp()+interval '90 seconds' WHERE user_id=p_user_id;
 RETURN jsonb_build_object('ok',true,'lease_id',lease);
END $$;
CREATE FUNCTION public.sandy_engineering_release_auth_issue(p_user_id uuid,p_lease_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$ BEGIN
 UPDATE public.sandy_engineering_test_identities SET auth_issue_lease_id=NULL,auth_issue_lease_until=NULL
 WHERE user_id=p_user_id AND auth_issue_lease_id=p_lease_id;
 RETURN jsonb_build_object('ok',true,'released',FOUND);
END $$;
REVOKE ALL ON FUNCTION public.sandy_engineering_claim_auth_issue(uuid,integer),public.sandy_engineering_release_auth_issue(uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.sandy_engineering_claim_auth_issue(uuid,integer),public.sandy_engineering_release_auth_issue(uuid,uuid) TO service_role;

COMMIT;
