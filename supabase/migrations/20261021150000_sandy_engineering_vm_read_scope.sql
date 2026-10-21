-- Optional read-only VM authority derives from a real existing owner-approved
-- sandy-video change. It cannot authorize installation, IAM/network mutation,
-- shell execution, or any provider resource outside the fixed diagnostic tools.
BEGIN;
CREATE TABLE public.sandy_engineering_vm_read_scopes (
 identity_user_id uuid PRIMARY KEY REFERENCES public.sandy_engineering_test_identities(user_id),
 owner_authority_id uuid NOT NULL,source_change_id uuid NOT NULL REFERENCES public.sandy_engineering_changes(id),
 credential_epoch integer NOT NULL,policy_sha256 text NOT NULL CHECK(policy_sha256='b0998f2a39bc39d23a85fb00505e8ebac895ff36efe9200bcd42d684f7ae63de'),
 expires_at timestamptz NOT NULL,revoked_at timestamptz,created_at timestamptz NOT NULL DEFAULT clock_timestamp(),updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
ALTER TABLE public.sandy_engineering_vm_read_scopes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.sandy_engineering_vm_read_scopes FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON public.sandy_engineering_vm_read_scopes TO service_role;
ALTER TABLE public.sandy_engineering_identity_events DROP CONSTRAINT sandy_engineering_identity_events_event_type_check;
ALTER TABLE public.sandy_engineering_identity_events ADD CONSTRAINT sandy_engineering_identity_events_event_type_check CHECK(event_type IN('provisioned','authorized','session_issued','session_retired','execution_authorized','credential_rotation_started','credential_rotated','bootstrap_installed','bootstrap_delivered','revoked','scope_authorized','scope_revoked'));

CREATE FUNCTION public.sandy_engineering_authorize_vm_reads(p_user_id uuid,p_source_change_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE identity public.sandy_engineering_test_identities%ROWTYPE;source public.sandy_engineering_changes%ROWTYPE;
BEGIN
 SELECT * INTO identity FROM public.sandy_engineering_test_identities WHERE user_id=p_user_id FOR UPDATE;
 SELECT * INTO source FROM public.sandy_engineering_changes WHERE id=p_source_change_id;
 IF identity.user_id IS NULL OR NOT identity.enabled OR identity.revoked_at IS NOT NULL OR identity.rotation_state<>'ready'
 OR NOT public.sandy_api_current_owner(identity.authorized_by) OR source.requested_by IS DISTINCT FROM identity.authorized_by
 OR source.status NOT IN('approved','implementing','committed','deployed','verified')
 OR NOT source.scope @> '["sandy-video","video.install","osconfig.googleapis.com"]'::jsonb
 OR NOT EXISTS(SELECT 1 FROM public.sandy_engineering_change_events WHERE change_id=source.id AND actor=identity.authorized_by AND ((event_type='status_changed' AND detail->>'to'='approved') OR event_type='delegated_auto_approved'))
 OR EXISTS(SELECT 1 FROM public.sandy_controller_admins WHERE auth_user_id=p_user_id)
 THEN RAISE EXCEPTION 'existing_owner_approved_video_change_required' USING ERRCODE='42501';END IF;
 INSERT INTO public.sandy_engineering_vm_read_scopes(identity_user_id,owner_authority_id,source_change_id,credential_epoch,policy_sha256,expires_at)
 VALUES(p_user_id,identity.authorized_by,source.id,identity.credential_epoch,'b0998f2a39bc39d23a85fb00505e8ebac895ff36efe9200bcd42d684f7ae63de',clock_timestamp()+interval '24 hours')
 ON CONFLICT(identity_user_id) DO UPDATE SET owner_authority_id=excluded.owner_authority_id,source_change_id=excluded.source_change_id,credential_epoch=excluded.credential_epoch,policy_sha256=excluded.policy_sha256,expires_at=excluded.expires_at,revoked_at=NULL,updated_at=clock_timestamp();
 INSERT INTO public.sandy_engineering_identity_events(identity_user_id,owner_authority_id,actor_kind,event_type,detail)
 VALUES(p_user_id,identity.authorized_by,'management_administration','scope_authorized',jsonb_build_object('purpose','sandy_video_read','source_change_id',source.id,'policy_sha256','b0998f2a39bc39d23a85fb00505e8ebac895ff36efe9200bcd42d684f7ae63de','operations','["video.status","video.execution.preflight","video.install.preflight","video.network.preflight","video.ssh.preflight","video.osconfig.access","video.osconfig.agent_status","video.osconfig.permissions","video.osconfig.policy_preflight"]'::jsonb,'expires_in_hours',24,'provider_writes_authorized',false));
 RETURN jsonb_build_object('ok',true,'authorized',true,'purpose','sandy_video_read','provider_writes_authorized',false);
END $$;
REVOKE ALL ON FUNCTION public.sandy_engineering_authorize_vm_reads(uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.sandy_engineering_authorize_vm_reads(uuid,uuid) TO service_role;

CREATE FUNCTION public.sandy_engineering_administrative_revoke_vm_reads(p_user_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE scope public.sandy_engineering_vm_read_scopes%ROWTYPE;BEGIN
 UPDATE public.sandy_engineering_vm_read_scopes SET revoked_at=clock_timestamp(),updated_at=clock_timestamp() WHERE identity_user_id=p_user_id RETURNING * INTO scope;
 IF FOUND THEN INSERT INTO public.sandy_engineering_identity_events(identity_user_id,owner_authority_id,actor_kind,event_type,detail) VALUES(p_user_id,scope.owner_authority_id,'management_administration','scope_revoked','{"purpose":"sandy_video_read"}');END IF;
 RETURN jsonb_build_object('ok',true,'revoked',scope.identity_user_id IS NOT NULL,'purpose','sandy_video_read');
END $$;
REVOKE ALL ON FUNCTION public.sandy_engineering_administrative_revoke_vm_reads(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.sandy_engineering_administrative_revoke_vm_reads(uuid) TO service_role;

CREATE FUNCTION public.sandy_engineering_vm_read_scope(p_user_id uuid,p_epoch integer) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
 SELECT jsonb_build_object('policy_sha256',s.policy_sha256,'owner_authority_id',s.owner_authority_id,'source_change_id',s.source_change_id,'expires_at',s.expires_at,'operations','["video.status","video.execution.preflight","video.install.preflight","video.network.preflight","video.ssh.preflight","video.osconfig.access","video.osconfig.agent_status","video.osconfig.permissions","video.osconfig.policy_preflight"]'::jsonb)
 FROM public.sandy_engineering_vm_read_scopes s JOIN public.sandy_engineering_test_identities i ON i.user_id=s.identity_user_id JOIN public.sandy_engineering_changes c ON c.id=s.source_change_id
 WHERE s.identity_user_id=p_user_id AND s.credential_epoch=p_epoch AND i.credential_epoch=p_epoch AND s.revoked_at IS NULL AND s.expires_at>clock_timestamp()
 AND s.owner_authority_id=i.authorized_by AND c.requested_by=s.owner_authority_id AND public.sandy_api_current_owner(s.owner_authority_id)
 AND i.enabled AND i.revoked_at IS NULL AND i.rotation_state='ready' AND c.status IN('approved','implementing','committed','deployed','verified')
 AND c.scope @> '["sandy-video","video.install","osconfig.googleapis.com"]'::jsonb
 AND EXISTS(SELECT 1 FROM public.sandy_engineering_change_events e WHERE e.change_id=c.id AND e.actor=s.owner_authority_id AND ((e.event_type='status_changed' AND e.detail->>'to'='approved') OR e.event_type='delegated_auto_approved'))
$$;
REVOKE ALL ON FUNCTION public.sandy_engineering_vm_read_scope(uuid,integer) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.sandy_engineering_revoke_vm_reads(p_user_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE identity public.sandy_engineering_test_identities%ROWTYPE;BEGIN
 SELECT * INTO identity FROM public.sandy_engineering_test_identities WHERE user_id=p_user_id;
 IF auth.role() IS DISTINCT FROM 'authenticated' OR auth.uid() IS DISTINCT FROM identity.authorized_by OR NOT public.sandy_api_current_owner(auth.uid()) OR EXISTS(SELECT 1 FROM auth.users WHERE id=auth.uid() AND is_anonymous) THEN RETURN jsonb_build_object('ok',false,'error','current_controller_owner_required','http_status',403);END IF;
 UPDATE public.sandy_engineering_vm_read_scopes SET revoked_at=clock_timestamp(),updated_at=clock_timestamp() WHERE identity_user_id=p_user_id;
 INSERT INTO public.sandy_engineering_identity_events(identity_user_id,owner_authority_id,actor_kind,event_type,detail) VALUES(p_user_id,auth.uid(),'controller_owner','scope_revoked','{"purpose":"sandy_video_read"}');
 RETURN jsonb_build_object('ok',true,'revoked',true,'purpose','sandy_video_read');
END $$;
REVOKE ALL ON FUNCTION public.sandy_engineering_revoke_vm_reads(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.sandy_engineering_revoke_vm_reads(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.sandy_engineering_resolve_identity(p_user_id uuid,p_session_id uuid,p_epoch integer) RETURNS jsonb
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
 'operations',jsonb_build_array('github.files.update','github.commit','supabase.deploy_edge_function','supabase.db.migrations.apply','supabase.functions.secrets.set','supabase.logs.query'),'vm_read_scope',public.sandy_engineering_vm_read_scope(p_user_id,p_epoch));
END $$;


CREATE FUNCTION public.sandy_engineering_record_vm_read(p_user_id uuid,p_session_id uuid,p_epoch integer,p_operation text,p_request_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE resolved jsonb;scope jsonb;BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended('sandy-video-read:'||p_user_id::text,0));
 resolved:=public.sandy_engineering_resolve_identity(p_user_id,p_session_id,p_epoch);scope:=resolved->'vm_read_scope';
 IF resolved->>'ok' IS DISTINCT FROM 'true' OR scope IS NULL OR scope='null'::jsonb OR p_operation IS NULL OR NOT ((scope->'operations')?p_operation) OR p_request_id IS NULL THEN RETURN jsonb_build_object('ok',false,'error','engineering_vm_read_not_authorized','http_status',403);END IF;
 IF (SELECT count(*) FROM public.sandy_engineering_identity_events WHERE identity_user_id=p_user_id AND event_type='execution_authorized' AND detail->>'purpose'='sandy_video_read' AND occurred_at>clock_timestamp()-interval '1 minute')>=30 THEN RETURN jsonb_build_object('ok',false,'error','engineering_vm_read_rate_limited','http_status',429);END IF;
 INSERT INTO public.sandy_engineering_identity_events(identity_user_id,owner_authority_id,actor_kind,event_type,detail) VALUES(p_user_id,(scope->>'owner_authority_id')::uuid,'verified_auth_workload','execution_authorized',jsonb_build_object('purpose','sandy_video_read','operation',p_operation,'request_id',p_request_id,'session_id',p_session_id,'source_change_id',scope->>'source_change_id','policy_sha256',scope->>'policy_sha256','provider_writes_authorized',false));
 RETURN jsonb_build_object('ok',true,'authorized',true);
END $$;
REVOKE ALL ON FUNCTION public.sandy_engineering_record_vm_read(uuid,uuid,integer,text,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.sandy_engineering_record_vm_read(uuid,uuid,integer,text,uuid) TO service_role;
COMMIT;
