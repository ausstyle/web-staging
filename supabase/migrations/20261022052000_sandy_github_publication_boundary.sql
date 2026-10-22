BEGIN;
-- Private context for source verification. It can neither authorize a new
-- operation nor advance a reference; the original one-use admission is required.
CREATE FUNCTION public.sandy_engineering_github_publication_context(p_admission_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE a public.sandy_api_execution_admissions;e public.sandy_engineering_execution_authorizations;d public.sandy_engineering_standing_delegations;j public.sandy_deployment_jobs;
BEGIN
 SELECT * INTO a FROM public.sandy_api_execution_admissions WHERE id=p_admission_id;
 IF a.id IS NULL OR a.principal_kind IS DISTINCT FROM 'auth_user' OR a.tenant_id IS NOT NULL OR a.credential_id IS NOT NULL OR a.customer_key_id IS NOT NULL
 OR a.operation NOT IN('github.refs.create','github.refs.update') OR a.state IS DISTINCT FROM 'consumed' OR a.approval_id IS NULL
 OR NOT public.sandy_api_current_owner(a.actor_id) THEN RETURN jsonb_build_object('ok',false);END IF;
 SELECT * INTO e FROM public.sandy_engineering_execution_authorizations WHERE job_id=a.approval_id;
 IF e.delegation_id IS NOT NULL THEN
  IF NOT public.sandy_engineering_authorized_admission(a.id,'consumed') THEN RETURN jsonb_build_object('ok',false);END IF;
  SELECT * INTO d FROM public.sandy_engineering_standing_delegations WHERE id=e.delegation_id;
  IF coalesce(d.source_commit,'') !~ '^[a-f0-9]{40}$' OR NOT(d.policy->'resources'->'github' ? 'ausstyle/web-staging') THEN RETURN jsonb_build_object('ok',false);END IF;
  RETURN jsonb_build_object('ok',true,'mode','standing_engineering','repository','ausstyle/web-staging','baseline_commit',d.source_commit,'delegation_id',d.id,'version',d.version);
 END IF;
 SELECT * INTO j FROM public.sandy_deployment_jobs WHERE id=a.approval_id;
 IF j.id IS NULL OR j.status IS DISTINCT FROM 'running' OR j.approved_by IS DISTINCT FROM a.actor_id::text OR j.approved_at IS NULL
 OR NOT EXISTS(SELECT 1 FROM public.sandy_api_mutation_approval_snapshots s WHERE s.job_id=a.approval_id AND s.actor_id=a.actor_id AND s.operation=a.operation AND s.input_sha256=a.input_sha256 AND s.contract_sha256=a.contract_sha256 AND s.scope_sha256=a.scope_sha256)
 THEN RETURN jsonb_build_object('ok',false);END IF;
 RETURN jsonb_build_object('ok',true,'mode','explicit_owner_approval');
END $$;
REVOKE ALL ON FUNCTION public.sandy_engineering_github_publication_context(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.sandy_engineering_github_publication_context(uuid) TO service_role;
COMMIT;
