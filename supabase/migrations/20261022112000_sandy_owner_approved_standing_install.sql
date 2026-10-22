BEGIN;
-- Explicit high-risk administrative provisioning, not a workload action. The
-- authenticated owner approves these exact pins AND the frozen declaration once.
-- The protected Management installer executes the approved security change;
-- no owner Auth session, approval event or workload self-grant is manufactured.
CREATE FUNCTION public.sandy_engineering_install_approved_policy(
 p_change uuid,p_source text,p_manifest text,p_declaration text,p_workflow_sha256 text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE c public.sandy_engineering_changes%ROWTYPE; g public.sandy_engineering_control_grants%ROWTYPE;
 declaration jsonb; declaration_sha text; owner_actor uuid; owner_event uuid; approved_at timestamptz;
 cfg jsonb; expiry timestamptz; revision bigint;
BEGIN
 declaration:=p_declaration::jsonb;
 declaration_sha:=encode(sha256(convert_to(p_declaration,'UTF8')),'hex');
 IF p_source !~ '^[a-f0-9]{40}$' OR p_manifest !~ '^[a-f0-9]{64}$' OR p_workflow_sha256 !~ '^[a-f0-9]{64}$'
 OR coalesce(declaration->>'identity_binding_sha256','') !~ '^[a-f0-9]{64}$'
 OR declaration->>'version' IS DISTINCT FROM 'amendment-b-standing-v1'
 OR declaration->>'repository' IS DISTINCT FROM 'ausstyle/web-staging'
 OR declaration->>'project' IS DISTINCT FROM 'zmqlyygzqoidkcwdysok'
 OR declaration->>'environment' IS DISTINCT FROM 'canary'
 OR declaration->>'branch' IS DISTINCT FROM 'engineering/sandy-unified-intelligence-20261021'
 OR declaration->>'risk_ceiling' IS DISTINCT FROM 'normal'
 OR declaration->>'expiry_mode' IS DISTINCT FROM 'until_revoked'
 OR declaration->>'max_releases_per_day' IS DISTINCT FROM '10'
 OR declaration->>'maximum_cost_units' IS DISTINCT FROM '0'
 OR declaration->>'baseline' IS DISTINCT FROM 'approved_source_commit'
 OR declaration->>'workflow' IS DISTINCT FROM 'approved_workflow_sha256'
 OR declaration->'targets' IS DISTINCT FROM '["sandy-agent-runtime-v4","sandy-workspace"]'::jsonb
 THEN RAISE EXCEPTION 'exact_bounded_declaration_required';END IF;
 SELECT * INTO c FROM public.sandy_engineering_changes WHERE id=p_change FOR SHARE;
 IF NOT FOUND OR c.status<>'approved' OR c.risk<>'high'
 OR NOT(c.scope ? 'security:standing-engineering-delegation')
 OR position(p_source in c.expected_behavior)=0 OR position(p_manifest in c.expected_behavior)=0
 OR NOT(c.regression_rules @> jsonb_build_array('Standing-policy declaration: '||p_declaration))
 THEN RAISE EXCEPTION 'explicit_security_change_required';END IF;
 SELECT e.actor,e.id,e.occurred_at INTO owner_actor,owner_event,approved_at
 FROM public.sandy_engineering_change_events e
 JOIN public.sandy_controller_admins a ON a.auth_user_id=e.actor AND a.enabled AND a.role='owner'
 JOIN auth.users u ON u.id=e.actor AND coalesce(u.raw_app_meta_data->>'sandy_engineering_test','false')<>'true'
 WHERE e.change_id=p_change AND e.event_type IN ('status_changed','owner_release_attested') AND e.detail->>'to'='approved'
 AND position(p_source in e.detail->>'reason')>0 AND position(p_manifest in e.detail->>'reason')>0
 AND position('standing-policy declaration '||declaration_sha in e.detail->>'reason')>0
 ORDER BY e.occurred_at LIMIT 1 FOR SHARE OF e,a,u;
 IF owner_actor IS NULL THEN RAISE EXCEPTION 'genuine_owner_declaration_approval_required';END IF;
 SELECT g0.* INTO g FROM public.sandy_engineering_control_grants g0
 JOIN public.sandy_engineering_test_identities i ON i.user_id=g0.identity_user_id AND i.enabled AND i.revoked_at IS NULL
 WHERE g0.authorized_by=owner_actor AND i.authorized_by=owner_actor
 AND g0.authorization_ref=declaration->>'identity_authorization_ref'
 AND encode(sha256(convert_to(g0.identity_user_id::text,'UTF8')),'hex')=declaration->>'identity_binding_sha256'
 AND g0.enabled AND g0.revoked_at IS NULL AND g0.expires_at>clock_timestamp() FOR UPDATE OF g0;
 IF NOT FOUND OR NOT(g.scope_prefixes @> ARRAY['sandy-agent-runtime-v4','sandy-workspace']) THEN RAISE EXCEPTION 'existing_owner_bound_identity_required';END IF;
 expiry:=g.expires_at; -- Never outlive the existing parent identity grant.
 cfg:=jsonb_build_object('repository',declaration->>'repository','project',declaration->>'project',
 'environment','canary','branch',declaration->>'branch','targets',declaration->'targets',
 'baseline_commit',p_source,'workflow_sha256',p_workflow_sha256,'expiry_mode','until_revoked','expires_at',CASE WHEN expiry='infinity'::timestamptz THEN 'infinity' ELSE to_char(expiry AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') END,
 'maximum_cost_units',0,'max_releases_per_day',10);
 IF g.autonomous_config IS NOT NULL THEN
  IF g.autonomous_config=cfg AND EXISTS(SELECT 1 FROM public.sandy_engineering_identity_events e
   WHERE e.identity_user_id=g.identity_user_id AND e.event_type='standing_policy_installed_from_owner_approval'
   AND e.detail->>'change_id'=p_change::text AND e.detail->>'declaration_sha256'=declaration_sha
   AND e.detail->>'grant_revision'=g.autonomous_revision::text)
  THEN RETURN jsonb_build_object('ok',true,'reused',true,'grant_revision',g.autonomous_revision,'expires_at',expiry);END IF;
  RAISE EXCEPTION 'existing_policy_must_not_be_overwritten';
 END IF;
 UPDATE public.sandy_engineering_control_grants SET autonomous_config=cfg,autonomous_revision=autonomous_revision+1,
 allowed_actions=ARRAY(SELECT DISTINCT unnest(g.allowed_actions||ARRAY['authorize_release'])),updated_at=clock_timestamp()
 WHERE identity_user_id=g.identity_user_id RETURNING autonomous_revision INTO revision;
 INSERT INTO public.sandy_engineering_identity_events(identity_user_id,owner_authority_id,actor_kind,event_type,detail)
 VALUES(g.identity_user_id,owner_actor,'owner_authorized_management_installer','standing_policy_installed_from_owner_approval',
 jsonb_build_object('change_id',p_change,'owner_approval_event_id',owner_event,'source_commit',p_source,'manifest_sha256',p_manifest,
 'declaration_sha256',declaration_sha,'grant_revision',revision,'policy',cfg,'owner_session_impersonated',false,'workload_self_authorized',false));
 INSERT INTO public.sandy_engineering_change_events(change_id,event_type,actor,detail)
 VALUES(p_change,'standing_policy_installed',NULL,jsonb_build_object('execution_actor','protected_management_installer',
 'owner_approval_event_id',owner_event,'grant_revision',revision,'declaration_sha256',declaration_sha,'owner_auth_event_created',false));
 RETURN jsonb_build_object('ok',true,'reused',false,'grant_revision',revision,'expires_at',expiry);
END $$;
REVOKE ALL ON FUNCTION public.sandy_engineering_install_approved_policy(uuid,text,text,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.sandy_engineering_install_approved_policy(uuid,text,text,text,text) TO service_role;
COMMIT;
