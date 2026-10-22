BEGIN;
-- Amendment B is a design requirement, not a grant. Installation enables no
-- actor or target. Only a legitimate administrator may provision delegation.
ALTER TABLE public.sandy_engineering_control_grants
 ADD COLUMN autonomous_config jsonb,
 ADD COLUMN autonomous_revision bigint NOT NULL DEFAULT 0;
ALTER TABLE public.sandy_engineering_control_grants DROP CONSTRAINT sandy_engineering_control_grants_allowed_actions_check;
ALTER TABLE public.sandy_engineering_control_grants ADD CONSTRAINT sandy_engineering_control_grants_allowed_actions_check
 CHECK(cardinality(allowed_actions)>0 AND allowed_actions <@ ARRAY['register','get','list','test','artifact','authorize_release']::text[]);
ALTER TABLE public.sandy_engineering_changes DROP CONSTRAINT sandy_engineering_changes_status_check;
ALTER TABLE public.sandy_engineering_changes ADD CONSTRAINT sandy_engineering_changes_status_check
 CHECK(status=ANY(ARRAY['proposed','approved','implementing','committed','deployed','verified','failed','rolled_back','cancelled','authorized_by_policy','policy_blocked','executing','unknown_outcome']::text[]));
CREATE TABLE public.sandy_engineering_release_authorizations (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 change_id uuid NOT NULL REFERENCES public.sandy_engineering_changes(id),
 identity_user_id uuid NOT NULL REFERENCES public.sandy_engineering_control_grants(identity_user_id),
 grant_revision bigint NOT NULL,
 source_commit text NOT NULL CHECK(source_commit ~ '^[a-f0-9]{40}$'),
 manifest_sha256 text NOT NULL CHECK(manifest_sha256 ~ '^[a-f0-9]{64}$'),
 state text NOT NULL DEFAULT 'authorized_by_policy' CHECK(state IN ('authorized_by_policy','executing','verified','unknown_outcome','failed','revoked')),
 proof jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 expires_at timestamptz NOT NULL,
 UNIQUE(change_id,grant_revision,source_commit,manifest_sha256)
);
ALTER TABLE public.sandy_engineering_release_authorizations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.sandy_engineering_release_authorizations FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT,UPDATE ON public.sandy_engineering_release_authorizations TO service_role;

CREATE FUNCTION public.sandy_engineering_set_autonomous_policy(p_actor uuid,p_identity uuid,p_config jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE g public.sandy_engineering_control_grants%ROWTYPE; expiry timestamptz;
BEGIN
 -- The Controller calls this only after Auth getUser; additionally reject
 -- workload identities even if a stale or erroneous owner membership exists.
 IF NOT coalesce(public.sandy_api_current_owner(p_actor),false) OR EXISTS(SELECT 1 FROM public.sandy_engineering_test_identities WHERE user_id=p_actor)
 THEN RAISE EXCEPTION 'legitimate_policy_administrator_required'; END IF;
 SELECT * INTO g FROM public.sandy_engineering_control_grants WHERE identity_user_id=p_identity FOR UPDATE;
 IF NOT FOUND OR g.authorized_by<>p_actor THEN RAISE EXCEPTION 'existing_owner_bound_control_grant_required'; END IF;
 IF p_config IS NOT NULL THEN
  expiry:=(p_config->>'expires_at')::timestamptz;
  IF NOT coalesce(g.enabled AND g.revoked_at IS NULL AND g.expires_at>clock_timestamp()
    AND ((expiry='infinity'::timestamptz AND p_config->>'expiry_mode'='until_revoked') OR (expiry>clock_timestamp() AND expiry<=clock_timestamp()+interval '30 days'))
    AND p_config->>'repository'='ausstyle/web-staging' AND p_config->>'project'='zmqlyygzqoidkcwdysok'
    AND p_config->>'environment'='canary' AND p_config->>'branch' ~ '^engineering/[a-z0-9-]+$'
    AND p_config->>'baseline_commit' ~ '^[a-f0-9]{40}$' AND p_config->>'workflow_sha256' ~ '^[a-f0-9]{64}$'
    AND (p_config->>'maximum_cost_units')::numeric=0 AND (p_config->>'max_releases_per_day')::integer BETWEEN 1 AND 10
    AND jsonb_typeof(p_config->'targets')='array' AND jsonb_array_length(p_config->'targets') BETWEEN 1 AND 6,false)
  THEN RAISE EXCEPTION 'bounded_autonomous_policy_required'; END IF;
  IF EXISTS(SELECT 1 FROM jsonb_array_elements_text(p_config->'targets') x(target)
   WHERE target<>ALL(ARRAY['sandy-agent-runtime-v4','sandy-workspace','sandy-email-runtime-canary','email-ai-generate-draft','sandy-whatsapp-webhook','sandy-voice-account-context']) OR NOT(target=ANY(g.scope_prefixes)))
  THEN RAISE EXCEPTION 'target_outside_existing_grant'; END IF;
 END IF;
 UPDATE public.sandy_engineering_control_grants SET autonomous_config=p_config,autonomous_revision=autonomous_revision+1,
  allowed_actions=CASE WHEN p_config IS NULL THEN array_remove(allowed_actions,'authorize_release') ELSE ARRAY(SELECT DISTINCT unnest(allowed_actions||ARRAY['authorize_release'])) END,
  updated_at=clock_timestamp() WHERE identity_user_id=p_identity RETURNING * INTO g;
 UPDATE public.sandy_engineering_release_authorizations SET state='revoked' WHERE identity_user_id=p_identity AND state IN ('authorized_by_policy','executing');
 INSERT INTO public.sandy_engineering_identity_events(identity_user_id,owner_authority_id,actor_kind,event_type,detail)
 VALUES(p_identity,p_actor,'authenticated_policy_administrator',CASE WHEN p_config IS NULL THEN 'autonomous_policy_revoked' ELSE 'autonomous_policy_established' END,
 jsonb_build_object('actor',p_actor,'grant_revision',g.autonomous_revision,'policy',p_config,'individual_release_approval',false));
 RETURN jsonb_build_object('ok',true,'grant_revision',g.autonomous_revision,'enabled',p_config IS NOT NULL);
END $$;

CREATE FUNCTION public.sandy_engineering_authorize_release(p_actor uuid,p_change uuid,p_revision bigint,p_change_updated_at timestamptz,p_source text,p_manifest text,p_proof jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE g public.sandy_engineering_control_grants%ROWTYPE; c public.sandy_engineering_changes%ROWTYPE;
 a public.sandy_engineering_release_authorizations%ROWTYPE; i public.sandy_engineering_test_identities%ROWTYPE;
 cfg jsonb; prior public.sandy_engineering_release_authorizations%ROWTYPE;
BEGIN
 SELECT * INTO i FROM public.sandy_engineering_test_identities WHERE user_id=p_actor FOR SHARE;
 IF NOT FOUND OR NOT coalesce(i.enabled AND i.revoked_at IS NULL AND i.active_session_expires_at>clock_timestamp() AND i.active_session_id IS NOT NULL,false) THEN RAISE EXCEPTION 'active_engineering_identity_required'; END IF;
 SELECT * INTO g FROM public.sandy_engineering_control_grants WHERE identity_user_id=p_actor FOR UPDATE;
 cfg:=g.autonomous_config;
 IF NOT coalesce(g.enabled AND g.revoked_at IS NULL AND g.expires_at>clock_timestamp() AND g.autonomous_revision=p_revision
  AND g.authorized_by=i.authorized_by AND public.sandy_api_current_owner(g.authorized_by)
  AND 'authorize_release'=ANY(g.allowed_actions) AND cfg IS NOT NULL AND (cfg->>'expires_at')::timestamptz>clock_timestamp(),false)
 THEN RAISE EXCEPTION 'policy_blocked'; END IF;
 SELECT * INTO c FROM public.sandy_engineering_changes WHERE id=p_change FOR UPDATE;
 IF NOT FOUND OR c.requested_by<>p_actor OR c.updated_at IS DISTINCT FROM p_change_updated_at OR c.status NOT IN ('proposed','approved','authorized_by_policy')
  OR c.risk NOT IN ('low','normal') OR NOT(c.risk=ANY(g.allowed_risks)) OR jsonb_array_length(c.scope)<>2
  OR NOT(c.scope @> jsonb_build_array('github:'||(cfg->>'repository')||':'||(cfg->>'branch')))
  OR NOT(c.scope @> jsonb_build_array(p_proof->>'target')) OR NOT(cfg->'targets' ? (p_proof->>'target'))
  OR p_source !~ '^[a-f0-9]{40}$' OR p_manifest !~ '^[a-f0-9]{64}$'
  OR position(p_source in c.expected_behavior)=0 OR position(p_manifest in c.expected_behavior)=0
  OR p_proof->>'source_commit' IS DISTINCT FROM p_source OR p_proof->>'manifest_sha256' IS DISTINCT FROM p_manifest
  OR p_proof->>'workflow_sha256' IS DISTINCT FROM cfg->>'workflow_sha256'
  OR p_proof->>'compared_from' IS DISTINCT FROM cfg->>'baseline_commit'
  OR p_proof->>'repository' IS DISTINCT FROM cfg->>'repository' OR NOT(p_proof ? 'check_run_id')
 THEN RAISE EXCEPTION 'policy_source_target_or_version_denied'; END IF;
 IF EXISTS(SELECT 1 FROM public.sandy_engineering_tests WHERE change_id=p_change AND (outcome<>'passed' OR checked_at IS NULL))
 OR (SELECT count(*) FROM public.sandy_engineering_tests WHERE change_id=p_change AND outcome='passed'
  AND evidence->>'source_commit'=p_source AND evidence->>'manifest_sha256'=p_manifest
  AND evidence->'release_manifest'->>'function'=p_proof->>'target')<>1
 THEN RAISE EXCEPTION 'passing_pinned_tests_required'; END IF;
 SELECT * INTO prior FROM public.sandy_engineering_release_authorizations WHERE change_id=p_change AND grant_revision=p_revision AND source_commit=p_source AND manifest_sha256=p_manifest;
 IF FOUND THEN
  IF prior.state NOT IN ('authorized_by_policy','executing') OR prior.expires_at<=clock_timestamp() THEN RAISE EXCEPTION 'authorization_consumed_or_expired'; END IF;
  RETURN jsonb_build_object('ok',true,'authorization',to_jsonb(prior),'reused',true);
 END IF;
 IF (SELECT count(*) FROM public.sandy_engineering_release_authorizations WHERE identity_user_id=p_actor AND created_at>=date_trunc('day',clock_timestamp())) >= (cfg->>'max_releases_per_day')::integer
 THEN RAISE EXCEPTION 'policy_release_budget_exceeded'; END IF;
 INSERT INTO public.sandy_engineering_release_authorizations(change_id,identity_user_id,grant_revision,source_commit,manifest_sha256,proof,expires_at)
 VALUES(p_change,p_actor,p_revision,p_source,p_manifest,p_proof,least(clock_timestamp()+interval '10 minutes',(cfg->>'expires_at')::timestamptz,g.expires_at)) RETURNING * INTO a;
 -- Preserve legacy approvals verbatim; only new routine proposals map forward.
 IF c.status='proposed' THEN UPDATE public.sandy_engineering_changes SET status='authorized_by_policy',updated_at=clock_timestamp() WHERE id=p_change; END IF;
 INSERT INTO public.sandy_engineering_change_events(change_id,event_type,actor,detail)
 VALUES(p_change,'authorized_by_policy',p_actor,jsonb_build_object('authorization_id',a.id,'grant_revision',p_revision,'source_commit',p_source,'manifest_sha256',p_manifest,'owner_signoff_claimed',false));
 RETURN jsonb_build_object('ok',true,'authorization',to_jsonb(a),'reused',false);
END $$;
REVOKE ALL ON FUNCTION public.sandy_engineering_set_autonomous_policy(uuid,uuid,jsonb), public.sandy_engineering_authorize_release(uuid,uuid,bigint,timestamptz,text,text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.sandy_engineering_set_autonomous_policy(uuid,uuid,jsonb), public.sandy_engineering_authorize_release(uuid,uuid,bigint,timestamptz,text,text,jsonb) TO service_role;
COMMIT;
