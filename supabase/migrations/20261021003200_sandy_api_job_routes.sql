-- Canonical job URLs select existing handlers; no business execution is copied.
-- Durable jobs are actor-owned. Legacy deployment jobs retain their existing
-- project-owner administration scope. Nonowners/foreign durable IDs do not leak.
BEGIN;
CREATE FUNCTION public.sandy_api_resolve_job_route(p_actor_id uuid,p_job_id uuid,p_action text,p_channel text DEFAULT 'api',
 p_credential_id uuid DEFAULT NULL,p_allowed_operations text[] DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE durable boolean; legacy boolean; job_kind text; selected_operation text; expected_handler text; expected_scope text;
 selected_mutation boolean; registry public.sandy_operation_registry%ROWTYPE; credential public.sandy_api_credentials%ROWTYPE;
 sources uuid[]; source_request uuid;
BEGIN
 IF p_job_id IS NULL OR p_actor_id IS NULL OR p_action IS NULL OR p_action NOT IN ('get','events','cancel','retry','rollback')
 OR p_channel IS NULL OR p_channel NOT IN ('api','mcp') OR (p_allowed_operations IS NOT NULL AND
 (cardinality(p_allowed_operations) NOT BETWEEN 1 AND 4096 OR EXISTS(SELECT 1 FROM unnest(p_allowed_operations) op WHERE op IS NULL OR op !~ '^[a-z][a-z0-9_.-]{2,100}$'))) THEN
  RETURN jsonb_build_object('ok',false,'error','invalid_job_route','http_status',400); END IF;
 IF NOT public.sandy_api_current_owner(p_actor_id) THEN RETURN jsonb_build_object('ok',false,'error','job_not_found','http_status',404); END IF;
 IF p_credential_id IS NOT NULL THEN
  SELECT * INTO credential FROM public.sandy_api_credentials WHERE id=p_credential_id;
  IF credential.id IS NULL OR credential.principal_id IS DISTINCT FROM p_actor_id OR credential.tenant_id IS NOT NULL
   OR credential.revoked_at IS NOT NULL OR credential.expires_at<=clock_timestamp() OR p_action NOT IN ('get','events') THEN
   RETURN jsonb_build_object('ok',false,'error','job_not_found','http_status',404); END IF;
 END IF;
 SELECT EXISTS(SELECT 1 FROM public.sandy_orch_jobs WHERE id=p_job_id AND actor_id=p_actor_id AND tenant_id IS NULL),
        EXISTS(SELECT 1 FROM public.sandy_deployment_jobs WHERE id=p_job_id) INTO durable,legacy;
 IF durable AND legacy THEN RETURN jsonb_build_object('ok',false,'error','ambiguous_job_id','http_status',409); END IF;
 IF NOT durable AND NOT legacy THEN RETURN jsonb_build_object('ok',false,'error','job_not_found','http_status',404); END IF;
 job_kind:=CASE WHEN durable THEN 'durable' ELSE 'legacy' END;
 selected_mutation:=p_action IN ('cancel','retry','rollback');
 IF p_action='rollback' THEN
  selected_operation:='system.lifecycle.compensate'; expected_handler:='sandy-operation-api';expected_scope:='system:write';
  IF p_allowed_operations IS NOT NULL AND NOT selected_operation=ANY(p_allowed_operations) THEN
   RETURN jsonb_build_object('ok',false,'error','job_not_found','http_status',404); END IF;
  IF durable THEN
   SELECT array_agg(DISTINCT s.source_request_id) INTO sources
   FROM public.sandy_orch_attempts t JOIN public.sandy_lifecycle_snapshots s ON s.source_admission_id=t.execution_admission_id
   JOIN public.sandy_api_execution_admissions a ON a.id=s.source_admission_id
   WHERE t.job_id=p_job_id AND s.actor_id=p_actor_id AND a.actor_id=p_actor_id AND a.tenant_id IS NULL AND a.credential_id IS NULL;
  ELSE
   SELECT array_agg(DISTINCT s.source_request_id) INTO sources
   FROM public.sandy_lifecycle_snapshots s JOIN public.sandy_api_execution_admissions a ON a.id=s.source_admission_id
   WHERE a.approval_id=p_job_id AND s.actor_id=p_actor_id AND a.actor_id=p_actor_id AND a.tenant_id IS NULL AND a.credential_id IS NULL;
  END IF;
  IF coalesce(cardinality(sources),0)=0 THEN RETURN jsonb_build_object('ok',false,'error','job_rollback_snapshot_required','http_status',424); END IF;
  IF cardinality(sources)<>1 THEN RETURN jsonb_build_object('ok',false,'error','ambiguous_job_rollback_source','http_status',409); END IF;
  source_request:=sources[1];
 ELSE
  selected_operation:=(CASE WHEN durable THEN 'orchestration.jobs.' ELSE 'deployment.jobs.' END)||p_action;
  expected_handler:=CASE WHEN durable THEN 'sandy-orchestration-api' WHEN selected_mutation THEN 'sandy-operation-api' ELSE 'sandy-infrastructure-read' END;
  expected_scope:=(CASE WHEN durable THEN 'orchestration' ELSE 'deployment' END)||CASE WHEN selected_mutation THEN ':write' ELSE ':read' END;
 END IF;
 IF p_allowed_operations IS NOT NULL AND NOT selected_operation=ANY(p_allowed_operations) THEN
  RETURN jsonb_build_object('ok',false,'error','job_not_found','http_status',404); END IF;
 IF p_credential_id IS NOT NULL AND (selected_mutation OR NOT selected_operation=ANY(credential.allowed_operations)) THEN
  RETURN jsonb_build_object('ok',false,'error','job_not_found','http_status',404); END IF;
 SELECT * INTO registry FROM public.sandy_operation_registry WHERE operation=selected_operation;
 IF registry.operation IS NULL OR registry.api_exposed IS DISTINCT FROM true OR registry.handler IS DISTINCT FROM expected_handler
 OR registry.permission_scope IS DISTINCT FROM expected_scope OR registry.is_mutation IS DISTINCT FROM selected_mutation
 OR (p_channel='mcp' AND registry.ai_exposed IS DISTINCT FROM true) THEN
  RETURN jsonb_build_object('ok',false,'error','job_not_found','http_status',404); END IF;
 RETURN jsonb_build_object('ok',true,'job_id',p_job_id,'job_kind',job_kind,'operation',selected_operation)
  ||CASE WHEN source_request IS NULL THEN '{}'::jsonb ELSE jsonb_build_object('source_request_id',source_request) END;
END $$;
REVOKE ALL ON FUNCTION public.sandy_api_resolve_job_route(uuid,uuid,text,text,uuid,text[]) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.sandy_api_resolve_job_route(uuid,uuid,text,text,uuid,text[]) TO service_role;
COMMIT;
