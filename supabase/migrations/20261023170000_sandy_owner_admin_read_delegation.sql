-- Forward change only. Preserve canary v6, all existing Owner admission RPCs,
-- IAM, identities and grants. Installing this code establishes NO delegation.
BEGIN;
ALTER TABLE public.sandy_engineering_control_grants
 ADD COLUMN admin_read_policy jsonb,
 ADD COLUMN admin_read_revision integer NOT NULL DEFAULT 0 CHECK(admin_read_revision>=0);
-- A service transport must not be able to establish/expand the new policy.
REVOKE INSERT,UPDATE ON public.sandy_engineering_control_grants FROM service_role;
GRANT INSERT(identity_user_id,authorized_by,authorization_ref,authorization_sha256,allowed_actions,scope_prefixes,allowed_risks,enabled,expires_at,revoked_at,created_at,updated_at),
 UPDATE(identity_user_id,authorized_by,authorization_ref,authorization_sha256,allowed_actions,scope_prefixes,allowed_risks,enabled,expires_at,revoked_at,created_at,updated_at)
 ON public.sandy_engineering_control_grants TO service_role;

CREATE FUNCTION public.sandy_engineering_guard_owner_delegation_event() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
BEGIN
 IF TG_OP<>'INSERT' AND OLD.detail->>'boundary'='gcp_admin_read_delegation' THEN RAISE EXCEPTION 'owner_delegation_audit_immutable';END IF;
 IF TG_OP='INSERT' AND NEW.detail->>'boundary'='gcp_admin_read_delegation' THEN
  IF auth.role() IS DISTINCT FROM 'authenticated' OR auth.uid() IS DISTINCT FROM NEW.owner_authority_id
  OR NOT public.sandy_api_current_owner(auth.uid()) OR NEW.actor_kind IS DISTINCT FROM 'controller_owner'
  OR NEW.event_type NOT IN('scope_authorized','scope_revoked')
  OR NEW.detail->>'Owner_session_fingerprint' IS DISTINCT FROM encode(extensions.digest(auth.jwt()->>'session_id','sha256'),'hex')
  THEN RAISE EXCEPTION 'genuine_owner_audit_context_required';END IF;
 END IF;
 IF TG_OP='DELETE' THEN RETURN OLD;END IF;RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.sandy_engineering_guard_owner_delegation_event() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER sandy_engineering_owner_delegation_audit_guard BEFORE INSERT OR UPDATE OR DELETE
 ON public.sandy_engineering_identity_events FOR EACH ROW EXECUTE FUNCTION public.sandy_engineering_guard_owner_delegation_event();

CREATE FUNCTION public.sandy_engineering_set_admin_read_delegation(p_enabled boolean,p_expires_at timestamptz,p_expected_revision integer)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE actor uuid:=auth.uid();session_id uuid;identity_id uuid;g public.sandy_engineering_control_grants;cfg jsonb;event_id bigint;
BEGIN
 IF auth.role() IS DISTINCT FROM 'authenticated' OR actor IS NULL OR NOT public.sandy_api_current_owner(actor)
 OR coalesce((auth.jwt()->'app_metadata'->>'sandy_engineering_test')::boolean,false)
 THEN RAISE EXCEPTION 'genuine_authenticated_owner_required' USING ERRCODE='42501';END IF;
 session_id:=(auth.jwt()->>'session_id')::uuid;
 IF session_id IS NULL OR NOT EXISTS(SELECT 1 FROM auth.sessions WHERE id=session_id AND user_id=actor AND (not_after IS NULL OR not_after>clock_timestamp()))
 THEN RAISE EXCEPTION 'current_owner_auth_session_required' USING ERRCODE='42501';END IF;
 SELECT i.user_id INTO identity_id FROM public.sandy_engineering_test_identities i JOIN auth.users u ON u.id=i.user_id
 WHERE u.email='sandy-engineering-test@sandy-ai.internal' AND i.authorized_by=actor AND i.enabled AND i.revoked_at IS NULL
 AND i.rotation_state='ready' AND u.raw_app_meta_data->>'sandy_engineering_test'='true'
 AND NOT EXISTS(SELECT 1 FROM public.sandy_controller_admins WHERE auth_user_id=i.user_id);
 SELECT * INTO g FROM public.sandy_engineering_control_grants WHERE identity_user_id=identity_id FOR UPDATE;
 IF g.identity_user_id IS NULL OR g.authorized_by IS DISTINCT FROM actor OR NOT g.enabled OR g.revoked_at IS NOT NULL OR g.expires_at<=clock_timestamp()
 OR p_expected_revision IS NULL OR p_expected_revision<>g.admin_read_revision OR p_enabled IS NULL
 THEN RAISE EXCEPTION 'current_owner_bound_control_grant_required' USING ERRCODE='42501';END IF;
 IF p_enabled THEN
  IF p_expires_at IS NULL OR p_expires_at<=clock_timestamp() OR p_expires_at>clock_timestamp()+interval '30 days' OR p_expires_at>g.expires_at
  THEN RAISE EXCEPTION 'bounded_delegation_expiry_required';END IF;
  cfg:=jsonb_build_object('version',1,'connection','sandy-gcp-admin','project','elaborate-haven-511518-a5',
   'targets',jsonb_build_array('6831598645020395570','8120150462304566315'),'read_only',true,
   'maximum_cost_units',0,'requests_per_minute',2,'expires_at',p_expires_at);
 END IF;
 UPDATE public.sandy_engineering_control_grants SET admin_read_policy=cfg,admin_read_revision=admin_read_revision+1,updated_at=clock_timestamp()
 WHERE identity_user_id=identity_id RETURNING * INTO g;
 INSERT INTO public.sandy_engineering_identity_events(identity_user_id,owner_authority_id,actor_kind,event_type,detail)
 VALUES(identity_id,actor,'controller_owner',CASE WHEN p_enabled THEN 'scope_authorized' ELSE 'scope_revoked' END,
 jsonb_build_object('boundary','gcp_admin_read_delegation','revision',g.admin_read_revision,'policy',cfg,
 'Owner_authentication_method','normal_Supabase_Auth_authenticated_RPC','Owner_session_fingerprint',encode(extensions.digest(session_id::text,'sha256'),'hex'),
 'workload_identity_distinct',true,'standing_canary_modified',false)) RETURNING id INTO event_id;
 RETURN jsonb_build_object('ok',true,'enabled',p_enabled,'revision',g.admin_read_revision,'audit_event_id',event_id,'expires_at',p_expires_at);
END $$;
REVOKE ALL ON FUNCTION public.sandy_engineering_set_admin_read_delegation(boolean,timestamptz,integer) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.sandy_engineering_set_admin_read_delegation(boolean,timestamptz,integer) TO authenticated;

CREATE FUNCTION public.sandy_engineering_get_admin_read_delegation() RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE g public.sandy_engineering_control_grants;
BEGIN
 IF auth.role() IS DISTINCT FROM 'authenticated' OR NOT public.sandy_api_current_owner(auth.uid())
 OR NOT EXISTS(SELECT 1 FROM auth.sessions WHERE id=(auth.jwt()->>'session_id')::uuid AND user_id=auth.uid() AND (not_after IS NULL OR not_after>clock_timestamp()))
 THEN RAISE EXCEPTION 'genuine_authenticated_owner_required' USING ERRCODE='42501';END IF;
 SELECT c.* INTO g FROM public.sandy_engineering_control_grants c JOIN auth.users u ON u.id=c.identity_user_id
 WHERE u.email='sandy-engineering-test@sandy-ai.internal' AND c.authorized_by=auth.uid();
 IF g.identity_user_id IS NULL THEN RAISE EXCEPTION 'existing_owner_bound_workload_required';END IF;
 RETURN jsonb_build_object('revision',g.admin_read_revision,'enabled',g.enabled AND g.revoked_at IS NULL AND g.expires_at>clock_timestamp()
 AND g.admin_read_policy IS NOT NULL AND (g.admin_read_policy->>'expires_at')::timestamptz>clock_timestamp(),'expires_at',g.admin_read_policy->>'expires_at');
END $$;
REVOKE ALL ON FUNCTION public.sandy_engineering_get_admin_read_delegation() FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.sandy_engineering_get_admin_read_delegation() TO authenticated;

CREATE FUNCTION public.sandy_engineering_resolve_admin_read(p_actor uuid,p_session uuid,p_epoch integer)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE r jsonb;g public.sandy_engineering_control_grants;cfg jsonb;
BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'internal_transport_required';END IF;
 r:=public.sandy_engineering_resolve_identity(p_actor,p_session,p_epoch);
 IF r->>'ok' IS DISTINCT FROM 'true' THEN RETURN r;END IF;
 SELECT * INTO g FROM public.sandy_engineering_control_grants WHERE identity_user_id=p_actor FOR SHARE;
 cfg:=g.admin_read_policy;
 IF g.identity_user_id IS NULL OR NOT g.enabled OR g.revoked_at IS NOT NULL OR g.expires_at<=clock_timestamp()
 OR g.authorized_by::text IS DISTINCT FROM r->>'owner_authority_id' OR NOT public.sandy_api_current_owner(g.authorized_by)
 OR cfg IS NULL OR cfg->>'version' IS DISTINCT FROM '1' OR cfg->>'connection' IS DISTINCT FROM 'sandy-gcp-admin'
 OR cfg->>'project' IS DISTINCT FROM 'elaborate-haven-511518-a5'
 OR cfg->'targets' IS DISTINCT FROM '["6831598645020395570","8120150462304566315"]'::jsonb
 OR cfg->>'read_only' IS DISTINCT FROM 'true' OR cfg->>'maximum_cost_units' IS DISTINCT FROM '0'
 OR cfg->>'requests_per_minute' IS DISTINCT FROM '2' OR cfg->>'expires_at' IS NULL OR (cfg->>'expires_at')::timestamptz<=clock_timestamp()
 THEN RETURN jsonb_build_object('ok',false,'error','administrator_read_delegation_required');END IF;
 RETURN jsonb_build_object('ok',true,'identity_user_id',p_actor,'owner_authority_id',g.authorized_by,'session_id',p_session,
 'revision',g.admin_read_revision,'expires_at',cfg->>'expires_at',
 'scope_sha256',encode(extensions.digest(jsonb_build_array(p_actor,p_session,p_epoch,g.admin_read_revision,cfg)::text,'sha256'),'hex'));
END $$;

CREATE FUNCTION public.sandy_gcp_admin_delegated_admit(p_actor uuid,p_session uuid,p_epoch integer)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE r jsonb;reg public.sandy_operation_registry;a public.sandy_api_execution_admissions;
 h text:=encode(extensions.digest('sandy-gcp-admin-readonly-delegated-v1','sha256'),'hex');
BEGIN
 PERFORM 1 FROM public.sandy_engineering_control_grants WHERE identity_user_id=p_actor FOR UPDATE;
 r:=public.sandy_engineering_resolve_admin_read(p_actor,p_session,p_epoch);
 IF r->>'ok' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'administrator_read_delegation_required' USING ERRCODE='42501';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('sandy-gcp-admin:'||p_actor::text,0));
 IF (SELECT count(*) FROM public.sandy_api_execution_admissions WHERE actor_id=p_actor AND contract_sha256=h AND created_at>clock_timestamp()-interval '1 minute')>=2
 THEN RAISE EXCEPTION 'administrator_read_rate_limited';END IF;
 SELECT * INTO reg FROM public.sandy_operation_registry WHERE operation='engineering.preflight' FOR SHARE;
 IF reg.handler IS DISTINCT FROM 'sandy-engineering-control' OR reg.api_exposed IS DISTINCT FROM true OR reg.ai_exposed IS DISTINCT FROM true OR reg.is_mutation IS DISTINCT FROM false
 THEN RAISE EXCEPTION 'installed_preflight_contract_required';END IF;
 INSERT INTO public.sandy_api_execution_admissions(actor_id,operation,request_id,is_mutation,input_sha256,contract_sha256,scope_sha256,registry_revision_sha256,declared_cost_units,expires_at)
 VALUES(p_actor,'engineering.preflight',gen_random_uuid(),false,h,h,r->>'scope_sha256',encode(extensions.digest(to_jsonb(reg)::text,'sha256'),'hex'),0,
 least(clock_timestamp()+interval '60 seconds',(r->>'expires_at')::timestamptz)) RETURNING * INTO a;
 INSERT INTO public.sandy_engineering_identity_events(identity_user_id,owner_authority_id,actor_kind,event_type,detail)
 VALUES(p_actor,(r->>'owner_authority_id')::uuid,'verified_auth_workload','execution_authorized',
 jsonb_build_object('boundary','gcp_admin_read_delegated','admission_id',a.id,'session_id',p_session,'epoch',p_epoch,'revision',r->'revision','scope_sha256',r->>'scope_sha256'));
 RETURN jsonb_build_object('admission_id',a.id,'grant_id',a.grant_id,'request_id',a.request_id);
END $$;

CREATE FUNCTION public.sandy_gcp_admin_delegated_claim(p_actor uuid,p_session uuid,p_epoch integer,p_admission uuid,p_grant uuid,p_request uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE r jsonb;a public.sandy_api_execution_admissions;
 h text:=encode(extensions.digest('sandy-gcp-admin-readonly-delegated-v1','sha256'),'hex');
BEGIN
 PERFORM 1 FROM public.sandy_engineering_control_grants WHERE identity_user_id=p_actor FOR SHARE;
 r:=public.sandy_engineering_resolve_admin_read(p_actor,p_session,p_epoch);
 IF r->>'ok' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'active_delegated_workload_required';END IF;
 SELECT * INTO a FROM public.sandy_api_execution_admissions WHERE id=p_admission FOR UPDATE;
 IF a.id IS NULL OR a.actor_id IS DISTINCT FROM p_actor OR a.grant_id IS DISTINCT FROM p_grant OR a.request_id IS DISTINCT FROM p_request
 OR a.operation IS DISTINCT FROM 'engineering.preflight' OR a.is_mutation IS DISTINCT FROM false OR a.contract_sha256 IS DISTINCT FROM h OR a.input_sha256 IS DISTINCT FROM h
 OR a.scope_sha256 IS DISTINCT FROM r->>'scope_sha256' OR a.declared_cost_units<>0 OR a.credential_id IS NOT NULL OR a.tenant_id IS NOT NULL
 OR a.state IS DISTINCT FROM 'admitted' OR a.expires_at<=clock_timestamp()
 OR NOT EXISTS(SELECT 1 FROM public.sandy_operation_registry reg WHERE operation=a.operation AND handler='sandy-engineering-control' AND api_exposed=true AND ai_exposed=true AND is_mutation=false
 AND encode(extensions.digest(to_jsonb(reg)::text,'sha256'),'hex')=a.registry_revision_sha256)
 THEN RAISE EXCEPTION 'delegated_administrator_admission_refused';END IF;
 UPDATE public.sandy_api_execution_admissions SET state='consumed',consumed_at=clock_timestamp() WHERE id=a.id;
 RETURN jsonb_build_object('ok',true,'admission_id',a.id);
END $$;

CREATE FUNCTION public.sandy_gcp_admin_delegated_finish(p_actor uuid,p_admission uuid,p_succeeded boolean,p_status integer,p_result_sha256 text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE a public.sandy_api_execution_admissions;
BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' OR p_result_sha256 IS NULL OR p_result_sha256 !~ '^[a-f0-9]{64}$'
 OR p_succeeded IS NULL OR p_status IS NULL OR p_status NOT BETWEEN 100 AND 599 THEN RAISE EXCEPTION 'internal_receipt_context_required';END IF;
 SELECT * INTO a FROM public.sandy_api_execution_admissions WHERE id=p_admission FOR UPDATE;
 IF a.id IS NULL OR a.actor_id IS DISTINCT FROM p_actor OR a.operation IS DISTINCT FROM 'engineering.preflight'
 OR a.contract_sha256 IS DISTINCT FROM encode(extensions.digest('sandy-gcp-admin-readonly-delegated-v1','sha256'),'hex') OR a.is_mutation IS DISTINCT FROM false
 THEN RAISE EXCEPTION 'delegated_receipt_refused';END IF;
 IF a.state='admitted' AND NOT p_succeeded THEN
  UPDATE public.sandy_api_execution_admissions SET state='failed',finished_at=clock_timestamp(),provider_http_status=p_status,result_sha256=p_result_sha256 WHERE id=a.id;
  RETURN jsonb_build_object('ok',true,'admission_id',a.id,'state','failed');
 END IF;
 RETURN public.sandy_api_finish_execution(a.id,CASE WHEN p_succeeded THEN 'succeeded' ELSE 'unknown' END,p_status,NULL,p_result_sha256);
END $$;
REVOKE ALL ON FUNCTION public.sandy_engineering_resolve_admin_read(uuid,uuid,integer),public.sandy_gcp_admin_delegated_admit(uuid,uuid,integer),
 public.sandy_gcp_admin_delegated_claim(uuid,uuid,integer,uuid,uuid,uuid),public.sandy_gcp_admin_delegated_finish(uuid,uuid,boolean,integer,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.sandy_engineering_resolve_admin_read(uuid,uuid,integer),public.sandy_gcp_admin_delegated_admit(uuid,uuid,integer),
 public.sandy_gcp_admin_delegated_claim(uuid,uuid,integer,uuid,uuid,uuid),public.sandy_gcp_admin_delegated_finish(uuid,uuid,boolean,integer,text) TO service_role;
NOTIFY pgrst,'reload schema';
COMMIT;
