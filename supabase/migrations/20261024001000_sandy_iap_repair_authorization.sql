-- Proposal submission is not permission. Installation records NO grant and
-- performs NO provider operation. Read delegation and canary v6 are untouched.
BEGIN;
ALTER TABLE public.sandy_engineering_control_grants
 ADD COLUMN iap_repair_policy jsonb,
 ADD COLUMN iap_repair_revision integer NOT NULL DEFAULT 0 CHECK(iap_repair_revision>=0);
CREATE FUNCTION public.sandy_iap_repair_template() RETURNS jsonb
LANGUAGE sql IMMUTABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$ SELECT '{"member":"serviceAccount:sandy-computer@elaborate-haven-511518-a5.iam.gserviceaccount.com","role":"roles/iap.tunnelResourceAccessor","expires_at":"2026-10-30T21:17:00Z","targets":[{"vm":"sandy-video","instance_id":"6831598645020395570","resource":"projects/1030223524306/iap_tunnel/zones/europe-west1-b/instances/6831598645020395570","condition":"destination.port == 22 && request.time < timestamp(\"2026-10-30T21:17:00Z\")"},{"vm":"sandy-windows","instance_id":"8120150462304566315","resource":"projects/1030223524306/iap_tunnel/zones/europe-west1-b/instances/8120150462304566315","condition":"destination.port == 5986 && request.time < timestamp(\"2026-10-30T21:17:00Z\")"}],"preconditions":["Separate explicit authorization; revision 1 is read-only","Protected administrator operation with independent admission; existing worker exposes reads only","Fresh full policy and immutable VM identity readback before any write","Preserve every unrelated binding, condition and audit configuration with etag concurrency","Single write attempt, independent provider readback and retained rollback preimage"],"not_authorized":["project-wide IAM","public addresses","firewall changes","guest changes","commands","agent enrolment"],"proposal_sha256":"3a6486847383057853fe4fb51ea4b0559d92b744046b5b5fe2067fb70f7cd87b","project":"elaborate-haven-511518-a5","version":1}'::jsonb $$;
REVOKE ALL ON FUNCTION public.sandy_iap_repair_template() FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION public.sandy_engineering_guard_iap_repair_owner_event() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
BEGIN
 IF TG_OP<>'INSERT' AND OLD.detail->>'boundary' ='gcp_iap_repair_delegation' THEN RAISE EXCEPTION 'owner_delegation_audit_immutable';END IF;
 IF TG_OP='INSERT' AND NEW.detail->>'boundary' ='gcp_iap_repair_delegation' THEN
  IF auth.role() IS DISTINCT FROM 'authenticated' OR auth.uid() IS DISTINCT FROM NEW.owner_authority_id
  OR NOT public.sandy_api_current_owner(auth.uid()) OR NEW.actor_kind IS DISTINCT FROM 'controller_owner'
  OR NEW.event_type NOT IN('scope_authorized','scope_revoked')
  OR NEW.detail->>'Owner_session_fingerprint' IS DISTINCT FROM encode(extensions.digest(auth.jwt()->>'session_id','sha256'),'hex')
  THEN RAISE EXCEPTION 'genuine_owner_audit_context_required';END IF;
 END IF;
 IF TG_OP='DELETE' THEN RETURN OLD;END IF;RETURN NEW;
END $$;

REVOKE ALL ON FUNCTION public.sandy_engineering_guard_iap_repair_owner_event() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER sandy_iap_repair_owner_audit_guard BEFORE INSERT OR UPDATE OR DELETE ON public.sandy_engineering_identity_events FOR EACH ROW EXECUTE FUNCTION public.sandy_engineering_guard_iap_repair_owner_event();

CREATE FUNCTION public.sandy_engineering_submit_iap_repair_proposal() RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE actor uuid:=auth.uid();sid uuid;epoch integer;r jsonb;g public.sandy_engineering_control_grants;
 cfg jsonb:=public.sandy_iap_repair_template();cid uuid;key text;reused boolean:=false;
BEGIN
 IF auth.role() IS DISTINCT FROM 'authenticated' OR actor IS NULL THEN RAISE EXCEPTION 'normal_authenticated_workload_required' USING ERRCODE='42501';END IF;
 sid:=(auth.jwt()->>'session_id')::uuid;epoch:=(auth.jwt()->'app_metadata'->>'sandy_engineering_epoch')::integer;
 r:=public.sandy_engineering_resolve_identity(actor,sid,epoch);
 SELECT * INTO g FROM public.sandy_engineering_control_grants WHERE identity_user_id=actor FOR SHARE;
 IF r->>'ok' IS DISTINCT FROM 'true' OR g.identity_user_id IS NULL OR NOT g.enabled OR g.revoked_at IS NOT NULL OR g.expires_at<=clock_timestamp()
 OR g.authorized_by::text IS DISTINCT FROM r->>'owner_authority_id' OR NOT coalesce('register'=ANY(g.allowed_actions),false)
 OR NOT coalesce('sandy-engineering-control'=ANY(g.scope_prefixes),false)
 THEN RAISE EXCEPTION 'current_scoped_workload_registration_required' USING ERRCODE='42501';END IF;
 IF (cfg->>'expires_at')::timestamptz<=clock_timestamp() THEN RAISE EXCEPTION 'reviewed_proposal_expired';END IF;
 key:='iap-repair-review-'||(cfg->>'proposal_sha256');
 PERFORM pg_advisory_xact_lock(hashtextextended(key||actor::text,0));
 SELECT id INTO cid FROM public.sandy_engineering_changes WHERE requested_by=actor AND idempotency_key=key;
 IF cid IS NULL THEN
  INSERT INTO public.sandy_engineering_changes(title,problem,expected_behavior,change_purpose,feature_improvement,scope,regression_rules,acceptance_criteria,risk,requested_by,idempotency_key,status)
  VALUES('Restricted IAP repair: independent authorization request only',
   'Historical tunnel access failed. Submission must not confer permission or execute any provider action.',
   'A genuine current Owner independently reviews the fixed two-target, port-and-time-limited proposal before any grant is established.',
   'SANDY-ENG-0001: submission of the exact reviewed IAP proposal only; provider IAM repair remains a high-risk, separately authorized operation.',
   'Enable bounded private connectivity after independent grant validation, preserving all unrelated security controls.',
   '["sandy-engineering-control"]',
   '["No grant from submission","No IAM apply, commands, guest credentials, agent enrolment or graphical authority","Preserve administrator-read revision 1 and canary v6"]',
   jsonb_build_array('Independent protected Owner grant required','Proposal SHA256 '||(cfg->>'proposal_sha256'),'Fixed scope: '||cfg::text),
   'high',actor,key,'proposed') RETURNING id INTO cid;
  INSERT INTO public.sandy_engineering_change_events(change_id,event_type,actor,detail)
  VALUES(cid,'iap_repair_proposal_submitted',actor,jsonb_build_object('proposal',cfg,'grant_established',false,'IAM_changes',0,
   'workload_session_fingerprint',encode(extensions.digest(sid::text,'sha256'),'hex'),'authentication','normal_Supabase_Auth'));
 ELSE reused:=true;END IF;
 RETURN jsonb_build_object('ok',true,'change_id',cid,'state','proposed','reused',reused,'risk','high','proposal_sha256',cfg->>'proposal_sha256','grant_established',false,'IAM_changes',0);
END $$;
REVOKE ALL ON FUNCTION public.sandy_engineering_submit_iap_repair_proposal() FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.sandy_engineering_submit_iap_repair_proposal() TO authenticated;

CREATE FUNCTION public.sandy_engineering_get_iap_repair_proposal() RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE g public.sandy_engineering_control_grants;cid uuid;
BEGIN
 IF auth.role() IS DISTINCT FROM 'authenticated' OR NOT public.sandy_api_current_owner(auth.uid())
 OR NOT EXISTS(SELECT 1 FROM auth.sessions WHERE id=(auth.jwt()->>'session_id')::uuid AND user_id=auth.uid() AND (not_after IS NULL OR not_after>clock_timestamp()))
 THEN RAISE EXCEPTION 'genuine_authenticated_owner_required' USING ERRCODE='42501';END IF;
 SELECT c.* INTO g FROM public.sandy_engineering_control_grants c JOIN auth.users u ON u.id=c.identity_user_id
 WHERE u.email='sandy-engineering-test@sandy-ai.internal' AND c.authorized_by=auth.uid();
 IF g.identity_user_id IS NULL THEN RAISE EXCEPTION 'existing_owner_bound_workload_required';END IF;
 SELECT id INTO cid FROM public.sandy_engineering_changes WHERE requested_by=g.identity_user_id AND idempotency_key='iap-repair-review-'||(public.sandy_iap_repair_template()->>'proposal_sha256');
 RETURN jsonb_build_object('proposal',public.sandy_iap_repair_template(),'change_id',cid,'revision',g.iap_repair_revision,
 'enabled',g.iap_repair_policy IS NOT NULL AND g.enabled AND g.revoked_at IS NULL AND g.expires_at>clock_timestamp()
 AND (g.iap_repair_policy->>'expires_at')::timestamptz>clock_timestamp(),'expires_at',g.iap_repair_policy->>'expires_at','provider_operation_executed',false);
END $$;
REVOKE ALL ON FUNCTION public.sandy_engineering_get_iap_repair_proposal() FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.sandy_engineering_get_iap_repair_proposal() TO authenticated;

CREATE FUNCTION public.sandy_engineering_set_iap_repair_delegation(p_enabled boolean,p_expires_at timestamptz,p_expected_revision integer,p_change_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE actor uuid:=auth.uid();sid uuid;identity_id uuid;g public.sandy_engineering_control_grants;cfg jsonb;event_id bigint;template jsonb:=public.sandy_iap_repair_template();
BEGIN
 IF auth.role() IS DISTINCT FROM 'authenticated' OR actor IS NULL OR NOT public.sandy_api_current_owner(actor)
 OR coalesce((auth.jwt()->'app_metadata'->>'sandy_engineering_test')::boolean,false)
 THEN RAISE EXCEPTION 'genuine_authenticated_owner_required' USING ERRCODE='42501';END IF;
 sid:=(auth.jwt()->>'session_id')::uuid;
 IF sid IS NULL OR NOT EXISTS(SELECT 1 FROM auth.sessions WHERE id=sid AND user_id=actor AND (not_after IS NULL OR not_after>clock_timestamp()))
 THEN RAISE EXCEPTION 'current_owner_auth_session_required' USING ERRCODE='42501';END IF;
 SELECT i.user_id INTO identity_id FROM public.sandy_engineering_test_identities i JOIN auth.users u ON u.id=i.user_id
 WHERE u.email='sandy-engineering-test@sandy-ai.internal' AND i.authorized_by=actor AND i.enabled AND i.revoked_at IS NULL
 AND i.rotation_state='ready' AND u.raw_app_meta_data->>'sandy_engineering_test'='true'
 AND NOT EXISTS(SELECT 1 FROM public.sandy_controller_admins WHERE auth_user_id=i.user_id);
 SELECT * INTO g FROM public.sandy_engineering_control_grants WHERE identity_user_id=identity_id FOR UPDATE;
 IF g.identity_user_id IS NULL OR g.authorized_by IS DISTINCT FROM actor OR NOT g.enabled OR g.revoked_at IS NOT NULL OR g.expires_at<=clock_timestamp()
 OR p_expected_revision IS NULL OR p_expected_revision<>g.iap_repair_revision OR p_enabled IS NULL
 THEN RAISE EXCEPTION 'current_owner_bound_control_grant_required' USING ERRCODE='42501';END IF;
 IF p_enabled THEN
  IF p_expires_at IS NULL OR p_expires_at<=clock_timestamp() OR p_expires_at>(template->>'expires_at')::timestamptz OR p_expires_at>g.expires_at
  OR NOT EXISTS(SELECT 1 FROM public.sandy_engineering_changes WHERE id=p_change_id AND requested_by=identity_id AND risk='high'
   AND status='proposed' AND idempotency_key='iap-repair-review-'||(template->>'proposal_sha256'))
  THEN RAISE EXCEPTION 'bounded_exact_reviewed_proposal_required';END IF;
  cfg:=jsonb_build_object('version',1,'template',template,'change_id',p_change_id,'expires_at',p_expires_at,'maximum_cost_units',0,'requests_per_minute',2);
 END IF;
 UPDATE public.sandy_engineering_control_grants SET iap_repair_policy=cfg,iap_repair_revision=iap_repair_revision+1,updated_at=clock_timestamp()
 WHERE identity_user_id=identity_id RETURNING * INTO g;
 INSERT INTO public.sandy_engineering_identity_events(identity_user_id,owner_authority_id,actor_kind,event_type,detail)
 VALUES(identity_id,actor,'controller_owner',CASE WHEN p_enabled THEN 'scope_authorized' ELSE 'scope_revoked' END,
 jsonb_build_object('boundary','gcp_iap_repair_delegation','revision',g.iap_repair_revision,'policy',cfg,
 'Owner_authentication_method','normal_Supabase_Auth_authenticated_RPC','Owner_session_fingerprint',encode(extensions.digest(sid::text,'sha256'),'hex'),
 'read_delegation_modified',false,'standing_canary_modified',false,'provider_operation_executed',false)) RETURNING id INTO event_id;
 RETURN jsonb_build_object('ok',true,'enabled',p_enabled,'revision',g.iap_repair_revision,'audit_event_id',event_id,'expires_at',p_expires_at,'provider_operation_executed',false);
END $$;
REVOKE ALL ON FUNCTION public.sandy_engineering_set_iap_repair_delegation(boolean,timestamptz,integer,uuid) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.sandy_engineering_set_iap_repair_delegation(boolean,timestamptz,integer,uuid) TO authenticated;

CREATE FUNCTION public.sandy_engineering_resolve_iap_repair(p_actor uuid,p_session uuid,p_epoch integer) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE r jsonb;g public.sandy_engineering_control_grants;cfg jsonb;
BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'internal_transport_required';END IF;
 r:=public.sandy_engineering_resolve_identity(p_actor,p_session,p_epoch);
 IF r->>'ok' IS DISTINCT FROM 'true' THEN RETURN r;END IF;
 SELECT * INTO g FROM public.sandy_engineering_control_grants WHERE identity_user_id=p_actor FOR SHARE;cfg:=g.iap_repair_policy;
 IF g.identity_user_id IS NULL OR NOT g.enabled OR g.revoked_at IS NOT NULL OR g.expires_at<=clock_timestamp()
 OR g.authorized_by::text IS DISTINCT FROM r->>'owner_authority_id' OR NOT public.sandy_api_current_owner(g.authorized_by)
 OR cfg IS NULL OR cfg->>'version' IS DISTINCT FROM '1' OR cfg->'template' IS DISTINCT FROM public.sandy_iap_repair_template()
 OR cfg->>'maximum_cost_units' IS DISTINCT FROM '0' OR cfg->>'requests_per_minute' IS DISTINCT FROM '2'
 OR cfg->>'expires_at' IS NULL OR (cfg->>'expires_at')::timestamptz<=clock_timestamp()
 OR (cfg->>'expires_at')::timestamptz>(public.sandy_iap_repair_template()->>'expires_at')::timestamptz
 OR NOT EXISTS(SELECT 1 FROM public.sandy_engineering_identity_events e WHERE e.identity_user_id=p_actor AND e.owner_authority_id=g.authorized_by
  AND e.actor_kind='controller_owner' AND e.event_type='scope_authorized' AND e.detail->>'boundary'='gcp_iap_repair_delegation'
  AND e.detail->>'revision'=g.iap_repair_revision::text AND e.detail->'policy'=cfg)
 THEN RETURN jsonb_build_object('ok',false,'error','independent_iap_repair_grant_required');END IF;
 RETURN jsonb_build_object('ok',true,'identity_user_id',p_actor,'owner_authority_id',g.authorized_by,'session_id',p_session,
 'revision',g.iap_repair_revision,'policy',cfg,'scope_sha256',encode(extensions.digest(jsonb_build_array(p_actor,p_session,p_epoch,g.iap_repair_revision,cfg)::text,'sha256'),'hex'));
END $$;
REVOKE ALL ON FUNCTION public.sandy_engineering_resolve_iap_repair(uuid,uuid,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.sandy_engineering_resolve_iap_repair(uuid,uuid,integer) TO service_role;
-- Existing table privileges are column-scoped. New policy columns remain
-- unavailable for service/workload INSERT/UPDATE; only the Owner RPC writes them.
DO $$ BEGIN
 IF has_column_privilege('service_role','public.sandy_engineering_control_grants','iap_repair_policy','UPDATE')
 OR has_column_privilege('service_role','public.sandy_engineering_control_grants','iap_repair_revision','UPDATE')
 OR has_column_privilege('service_role','public.sandy_engineering_control_grants','iap_repair_policy','INSERT')
 THEN RAISE EXCEPTION 'service_must_not_establish_iap_authority';END IF;
END $$;
NOTIFY pgrst,'reload schema';
COMMIT;
