-- Reuse the existing shared provider read for the same owner-approved sandy-video
-- diagnostic target. No new operation, provider IAM grant, mutation authority,
-- customer membership or verification flag is introduced. Old v1 read scopes
-- retain their exact nine-operation projection until explicit reauthorization.
BEGIN;
ALTER TABLE public.sandy_engineering_vm_read_scopes DROP CONSTRAINT sandy_engineering_vm_read_scopes_policy_sha256_check;
ALTER TABLE public.sandy_engineering_vm_read_scopes ADD CONSTRAINT sandy_engineering_vm_read_scopes_policy_sha256_check CHECK(policy_sha256 IN('b0998f2a39bc39d23a85fb00505e8ebac895ff36efe9200bcd42d684f7ae63de','6c9d57379cec9bb2f5d2471681984ccf5e890f4f5249b705498d27dd39d245ce'));

CREATE OR REPLACE FUNCTION public.sandy_engineering_authorize_vm_reads(p_user_id uuid,p_source_change_id uuid) RETURNS jsonb
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
 VALUES(p_user_id,identity.authorized_by,source.id,identity.credential_epoch,'6c9d57379cec9bb2f5d2471681984ccf5e890f4f5249b705498d27dd39d245ce',clock_timestamp()+interval '24 hours')
 ON CONFLICT(identity_user_id) DO UPDATE SET owner_authority_id=excluded.owner_authority_id,source_change_id=excluded.source_change_id,credential_epoch=excluded.credential_epoch,policy_sha256=excluded.policy_sha256,expires_at=excluded.expires_at,revoked_at=NULL,updated_at=clock_timestamp();
 INSERT INTO public.sandy_engineering_identity_events(identity_user_id,owner_authority_id,actor_kind,event_type,detail)
 VALUES(p_user_id,identity.authorized_by,'management_administration','scope_authorized',jsonb_build_object('purpose','sandy_video_read','source_change_id',source.id,'policy_sha256','6c9d57379cec9bb2f5d2471681984ccf5e890f4f5249b705498d27dd39d245ce','operations','["video.status","video.execution.preflight","video.install.preflight","video.network.preflight","video.ssh.preflight","video.osconfig.access","video.osconfig.agent_status","video.osconfig.permissions","video.osconfig.policy_preflight","gcp.compute.instances.get"]'::jsonb,'expires_in_hours',24,'provider_writes_authorized',false));
 RETURN jsonb_build_object('ok',true,'authorized',true,'purpose','sandy_video_read','provider_writes_authorized',false);
END $$;

CREATE OR REPLACE FUNCTION public.sandy_engineering_vm_read_scope(p_user_id uuid,p_epoch integer) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
 SELECT jsonb_build_object('policy_sha256',s.policy_sha256,'owner_authority_id',s.owner_authority_id,'source_change_id',s.source_change_id,'expires_at',s.expires_at,'operations',CASE WHEN s.policy_sha256='6c9d57379cec9bb2f5d2471681984ccf5e890f4f5249b705498d27dd39d245ce' THEN '["video.status","video.execution.preflight","video.install.preflight","video.network.preflight","video.ssh.preflight","video.osconfig.access","video.osconfig.agent_status","video.osconfig.permissions","video.osconfig.policy_preflight","gcp.compute.instances.get"]'::jsonb ELSE '["video.status","video.execution.preflight","video.install.preflight","video.network.preflight","video.ssh.preflight","video.osconfig.access","video.osconfig.agent_status","video.osconfig.permissions","video.osconfig.policy_preflight"]'::jsonb END)
 FROM public.sandy_engineering_vm_read_scopes s JOIN public.sandy_engineering_test_identities i ON i.user_id=s.identity_user_id JOIN public.sandy_engineering_changes c ON c.id=s.source_change_id
 WHERE s.identity_user_id=p_user_id AND s.credential_epoch=p_epoch AND i.credential_epoch=p_epoch AND s.revoked_at IS NULL AND s.expires_at>clock_timestamp()
 AND s.owner_authority_id=i.authorized_by AND c.requested_by=s.owner_authority_id AND public.sandy_api_current_owner(s.owner_authority_id)
 AND i.enabled AND i.revoked_at IS NULL AND i.rotation_state='ready' AND c.status IN('approved','implementing','committed','deployed','verified')
 AND c.scope @> '["sandy-video","video.install","osconfig.googleapis.com"]'::jsonb
 AND EXISTS(SELECT 1 FROM public.sandy_engineering_change_events e WHERE e.change_id=c.id AND e.actor=s.owner_authority_id AND ((e.event_type='status_changed' AND e.detail->>'to'='approved') OR e.event_type='delegated_auto_approved'))
$$;
COMMIT;
