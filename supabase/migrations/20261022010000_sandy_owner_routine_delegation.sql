BEGIN;
-- Extend the existing policy, never the workload grant or an owner's Auth role.
ALTER TABLE public.sandy_engineering_delegation_policy
 ADD COLUMN standing_authorized_by uuid REFERENCES auth.users(id),
 ADD COLUMN standing_expires_at timestamptz,
 ADD COLUMN standing_revoked_at timestamptz,
 ADD COLUMN standing_config jsonb NOT NULL DEFAULT '{}'::jsonb,
 ADD COLUMN standing_revision bigint NOT NULL DEFAULT 0;
CREATE TABLE public.sandy_engineering_delegation_events (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), actor uuid NOT NULL REFERENCES auth.users(id),
 policy_revision bigint NOT NULL, event_type text NOT NULL, detail jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
ALTER TABLE public.sandy_engineering_delegation_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.sandy_engineering_delegation_events FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT ON public.sandy_engineering_delegation_events TO service_role;

CREATE FUNCTION public.sandy_engineering_set_standing_delegation(p_actor uuid,p_enabled boolean,p_config jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE revision bigint; deadline timestamptz;
BEGIN
 PERFORM 1 FROM public.sandy_controller_admins a JOIN auth.users u ON u.id=a.auth_user_id
  WHERE a.auth_user_id=p_actor AND a.enabled AND a.role='owner'
  AND coalesce(u.raw_app_meta_data->>'sandy_engineering_test','false')<>'true' FOR SHARE OF a,u;
 IF NOT FOUND THEN RAISE EXCEPTION 'current authenticated owner required'; END IF;
 IF p_enabled THEN
  deadline:=(p_config->>'expires_at')::timestamptz;
  IF coalesce(deadline IS NULL OR deadline<=clock_timestamp() OR deadline>clock_timestamp()+interval '30 days'
   OR jsonb_typeof(p_config->'targets')<>'array' OR jsonb_array_length(p_config->'targets')<1
   OR NOT (p_config->'targets' <@ '["sandy-agent-runtime-v4","sandy-workspace","sandy-email-runtime-canary"]'::jsonb)
   OR jsonb_typeof(p_config->'reviewers')<>'array' OR jsonb_array_length(p_config->'reviewers')<1
   OR (p_config->>'baseline_commit') !~ '^[a-f0-9]{40}$' OR (p_config->>'workflow_sha256') !~ '^[a-f0-9]{64}$'
   ,true) THEN RAISE EXCEPTION 'bounded routine policy required'; END IF;
 END IF;
 UPDATE public.sandy_engineering_delegation_policy SET enabled=p_enabled,
  allowed_risks=ARRAY['low','normal'],allowed_operations=ARRAY['supabase_deploy_function'],
  require_authenticated_admin=true,require_change_record=true,require_test_evidence=true,require_rollback_plan=true,
  standing_authorized_by=p_actor,standing_expires_at=deadline,standing_revoked_at=CASE WHEN p_enabled THEN NULL ELSE clock_timestamp() END,
  standing_config=CASE WHEN p_enabled THEN p_config ELSE '{}'::jsonb END,
  standing_revision=standing_revision+1,updated_at=clock_timestamp() WHERE id=1 RETURNING standing_revision INTO revision;
 IF NOT FOUND THEN RAISE EXCEPTION 'existing delegation policy required'; END IF;
 INSERT INTO public.sandy_engineering_delegation_events(actor,policy_revision,event_type,detail)
 VALUES(p_actor,revision,CASE WHEN p_enabled THEN 'standing_owner_authorized' ELSE 'standing_owner_revoked' END,
  jsonb_build_object('configuration',p_config,'eligible_risks',jsonb_build_array('low','normal')));
 RETURN jsonb_build_object('ok',true,'revision',revision,'enabled',p_enabled);
END $$;

CREATE FUNCTION public.sandy_engineering_record_owner_approval(p_actor uuid,p_change uuid,p_reason text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE c public.sandy_engineering_changes%ROWTYPE;
BEGIN
 PERFORM 1 FROM public.sandy_controller_admins a JOIN auth.users u ON u.id=a.auth_user_id
  WHERE a.auth_user_id=p_actor AND a.enabled AND a.role='owner'
  AND coalesce(u.raw_app_meta_data->>'sandy_engineering_test','false')<>'true' FOR SHARE OF a,u;
 IF NOT FOUND THEN RAISE EXCEPTION 'current authenticated owner required'; END IF;
 SELECT * INTO c FROM public.sandy_engineering_changes WHERE id=p_change FOR UPDATE;
 IF c.id IS NULL OR c.status<>'proposed' THEN RAISE EXCEPTION 'proposed change required'; END IF;
 UPDATE public.sandy_engineering_changes SET status='approved',updated_at=clock_timestamp() WHERE id=c.id;
 INSERT INTO public.sandy_engineering_change_events(change_id,event_type,actor,detail)
 VALUES(c.id,'status_changed',p_actor,jsonb_build_object('from','proposed','to','approved','reason',left(p_reason,1000),'owner_workflow','authenticated_controller'));
 RETURN jsonb_build_object('ok',true,'change',jsonb_build_object('id',c.id,'status','approved'));
END $$;

CREATE FUNCTION public.sandy_engineering_apply_standing_delegation(p_actor uuid,p_change uuid,p_policy_revision bigint,
 p_change_updated_at timestamptz,p_source text,p_manifest text,p_proof jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE p public.sandy_engineering_delegation_policy%ROWTYPE; c public.sandy_engineering_changes%ROWTYPE;
BEGIN
 PERFORM 1 FROM public.sandy_controller_admins a JOIN auth.users u ON u.id=a.auth_user_id
  WHERE a.auth_user_id=p_actor AND a.enabled AND a.role='owner'
  AND coalesce(u.raw_app_meta_data->>'sandy_engineering_test','false')<>'true' FOR SHARE OF a,u;
 IF NOT FOUND THEN RAISE EXCEPTION 'current authenticated owner required'; END IF;
 SELECT * INTO p FROM public.sandy_engineering_delegation_policy WHERE id=1 FOR SHARE;
 SELECT * INTO c FROM public.sandy_engineering_changes WHERE id=p_change FOR UPDATE;
 IF coalesce(NOT p.enabled OR p.standing_authorized_by IS DISTINCT FROM p_actor OR p.standing_revision<>p_policy_revision
  OR p.standing_expires_at IS NULL OR p.standing_expires_at<=clock_timestamp() OR p.standing_revoked_at IS NOT NULL
  OR c.status IS DISTINCT FROM 'proposed' OR c.updated_at IS DISTINCT FROM p_change_updated_at
  OR c.risk NOT IN ('low','normal') OR p_source !~ '^[a-f0-9]{40}$' OR p_manifest !~ '^[a-f0-9]{64}$'
  OR position(p_source in c.expected_behavior)=0 OR position(p_manifest in c.expected_behavior)=0
  OR jsonb_typeof(c.scope)<>'array' OR jsonb_array_length(c.scope)<>2
  OR NOT (c.scope @> '["github:ausstyle/web-staging:engineering/sandy-unified-intelligence-20261021"]'::jsonb)
  OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements_text(p.standing_config->'targets') t WHERE c.scope ? t.value)
  OR NOT EXISTS(SELECT 1 FROM public.sandy_engineering_tests WHERE change_id=c.id AND outcome='passed' AND checked_at IS NOT NULL)
  OR EXISTS(SELECT 1 FROM public.sandy_engineering_tests WHERE change_id=c.id AND (outcome<>'passed' OR checked_at IS NULL))
  OR p_proof->>'repository' IS DISTINCT FROM 'ausstyle/web-staging' OR p_proof->>'source_commit' IS DISTINCT FROM p_source
  OR p_proof->>'manifest_sha256' IS DISTINCT FROM p_manifest
  OR p_proof->>'workflow_sha256' IS DISTINCT FROM p.standing_config->>'workflow_sha256'
  OR p_proof->>'compared_from' IS DISTINCT FROM p.standing_config->>'baseline_commit'
  OR coalesce(jsonb_array_length(p_proof->'review_ids'),0)<1 OR p_proof->>'check_run_id' IS NULL
  ,true) THEN RAISE EXCEPTION 'standing release recheck failed'; END IF;
 -- Reject changed test evidence after the external review reads.
 IF NOT EXISTS(SELECT 1 FROM public.sandy_engineering_tests t WHERE t.change_id=c.id
  AND t.evidence->>'source_commit'=p_source AND t.evidence->>'manifest_sha256'=p_manifest
  AND t.evidence->'release_manifest'->>'source_commit'=p_source)
 THEN RAISE EXCEPTION 'pinned passing release evidence required'; END IF;
 UPDATE public.sandy_engineering_changes SET status='approved',updated_at=clock_timestamp() WHERE id=c.id;
 INSERT INTO public.sandy_engineering_change_events(change_id,event_type,actor,detail)
 VALUES(c.id,'status_changed',p_actor,jsonb_build_object('from','proposed','to','approved',
  'reason','Standing routine release; source '||p_source||'; manifest '||p_manifest,
  'approval_mode','standing_owner_policy','policy_revision',p.standing_revision,'independent_review_and_ci',p_proof));
 RETURN jsonb_build_object('ok',true,'change',jsonb_build_object('id',c.id,'status','approved'),'approval_mode','standing_owner_policy');
END $$;
REVOKE ALL ON FUNCTION public.sandy_engineering_set_standing_delegation(uuid,boolean,jsonb),
 public.sandy_engineering_record_owner_approval(uuid,uuid,text),
 public.sandy_engineering_apply_standing_delegation(uuid,uuid,bigint,timestamptz,text,text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.sandy_engineering_set_standing_delegation(uuid,boolean,jsonb),
 public.sandy_engineering_record_owner_approval(uuid,uuid,text),
 public.sandy_engineering_apply_standing_delegation(uuid,uuid,bigint,timestamptz,text,text,jsonb) TO service_role;
COMMIT;
