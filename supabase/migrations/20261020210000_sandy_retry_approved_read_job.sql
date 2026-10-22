-- Durable read-job requeue admission. This RPC makes no HTTP/provider or dispatch call.
-- Independent consumers may execute approved children; no dispatcher is established here.
-- Original approvals, payload, failure evidence and target scope are preserved.
-- Apply after 20261020202000 (get_logs completion support).
BEGIN;
-- Capture scope only at a new enabled-owner or existing sandy_read_policy_v2
-- approval. The policy actor is preserved; retry admission still requires a current
-- enabled owner. Historical jobs are never retroactively assigned an approval
-- snapshot from mutable current metadata.
CREATE TABLE public.sandy_api_read_job_approval_snapshots (
  job_id uuid PRIMARY KEY REFERENCES public.sandy_deployment_jobs(id) ON DELETE RESTRICT,
  requested_by text NOT NULL,
  engineering_change_id uuid,
  provider text NOT NULL,
  operation text NOT NULL,
  target_name text NOT NULL,
  payload jsonb NOT NULL,
  approved_by text NOT NULL,
  approved_at timestamptz NOT NULL,
  target_project_id text NOT NULL,
  target_zone text NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.sandy_api_read_job_approval_snapshots ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.sandy_api_read_job_approval_snapshots FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.sandy_api_read_job_approval_snapshots TO service_role;
CREATE FUNCTION public.sandy_api_capture_read_job_approval()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, pg_temp AS $$
DECLARE scope public.sandy_cloud_targets%ROWTYPE;
BEGIN
  IF NEW.status <> 'approved' OR NEW.provider <> 'google_cloud'
    OR NEW.operation NOT IN ('get_vm','list_vms','get_logs')
    OR (TG_OP = 'UPDATE' AND OLD.status <> 'pending_approval')
    OR NEW.approved_at IS NULL OR NEW.approved_by IS NULL
    OR (NEW.approved_by <> 'sandy_read_policy_v2' AND NOT EXISTS (
      SELECT 1 FROM public.sandy_controller_admins
      WHERE enabled = true AND role = 'owner' AND auth_user_id::text = NEW.approved_by)) THEN
    RETURN NEW;
  END IF;
  SELECT * INTO scope FROM public.sandy_cloud_targets WHERE name = NEW.target FOR SHARE;
  IF NOT FOUND OR nullif(btrim(scope.project_id),'') IS NULL OR nullif(btrim(scope.zone),'') IS NULL THEN
    RETURN NEW;
  END IF;
  INSERT INTO public.sandy_api_read_job_approval_snapshots(job_id,requested_by,engineering_change_id,
    provider,operation,target_name,payload,approved_by,approved_at,target_project_id,target_zone)
    VALUES(NEW.id,NEW.requested_by,NEW.engineering_change_id,NEW.provider,NEW.operation,NEW.target,
      NEW.payload,NEW.approved_by,NEW.approved_at,
      scope.project_id,scope.zone)
    ON CONFLICT (job_id) DO NOTHING;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.sandy_api_capture_read_job_approval() FROM PUBLIC, anon, authenticated, service_role;
CREATE TRIGGER sandy_api_capture_read_job_approval
AFTER INSERT OR UPDATE OF status ON public.sandy_deployment_jobs
FOR EACH ROW EXECUTE FUNCTION public.sandy_api_capture_read_job_approval();

CREATE TABLE public.sandy_api_read_job_retries (
  parent_job_id uuid PRIMARY KEY REFERENCES public.sandy_deployment_jobs(id) ON DELETE RESTRICT,
  retry_job_id uuid NOT NULL UNIQUE REFERENCES public.sandy_deployment_jobs(id) ON DELETE RESTRICT,
  root_job_id uuid NOT NULL REFERENCES public.sandy_deployment_jobs(id) ON DELETE RESTRICT,
  retry_depth integer NOT NULL CHECK (retry_depth BETWEEN 1 AND 3),
  requested_by uuid NOT NULL,
  original_approved_by text NOT NULL,
  original_approved_at timestamptz NOT NULL,
  target_name text NOT NULL,
  target_project_id text NOT NULL,
  target_zone text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (parent_job_id <> retry_job_id)
);
CREATE INDEX sandy_api_read_job_retries_target_idx ON public.sandy_api_read_job_retries(target_name);
ALTER TABLE public.sandy_api_read_job_retries ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.sandy_api_read_job_retries FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT ON public.sandy_api_read_job_retries TO service_role;

-- Declarative active pins keep the existing worker's target lookup stable under
-- concurrent transactions, including repeatable-read. Unrelated targets retain
-- their existing update behavior. Terminal children release their active pin.
ALTER TABLE public.sandy_cloud_targets ADD CONSTRAINT sandy_api_cloud_target_scope_key
  UNIQUE (name,project_id,zone);
CREATE TABLE public.sandy_api_active_read_retry_targets (
  retry_job_id uuid PRIMARY KEY REFERENCES public.sandy_deployment_jobs(id) ON DELETE RESTRICT,
  target_name text NOT NULL,
  target_project_id text NOT NULL,
  target_zone text NOT NULL,
  CONSTRAINT sandy_api_active_retry_target_scope_fk
    FOREIGN KEY (target_name,target_project_id,target_zone)
    REFERENCES public.sandy_cloud_targets(name,project_id,zone) ON UPDATE RESTRICT ON DELETE RESTRICT
);
ALTER TABLE public.sandy_api_active_read_retry_targets ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.sandy_api_active_read_retry_targets FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.sandy_api_active_read_retry_targets TO service_role;
CREATE FUNCTION public.sandy_api_maintain_read_retry_target_pin()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, pg_temp AS $$
DECLARE lineage public.sandy_api_read_job_retries%ROWTYPE; active boolean;
BEGIN
  IF TG_TABLE_NAME = 'sandy_api_read_job_retries' THEN
    lineage := NEW;
    SELECT status IN ('approved','running') INTO active
      FROM public.sandy_deployment_jobs WHERE id=lineage.retry_job_id;
  ELSE
    SELECT * INTO lineage FROM public.sandy_api_read_job_retries WHERE retry_job_id=NEW.id;
    IF NOT FOUND THEN RETURN NEW; END IF;
    active := NEW.status IN ('approved','running');
  END IF;
  IF active THEN
    INSERT INTO public.sandy_api_active_read_retry_targets(retry_job_id,target_name,target_project_id,target_zone)
      VALUES(lineage.retry_job_id,lineage.target_name,lineage.target_project_id,lineage.target_zone)
      ON CONFLICT (retry_job_id) DO NOTHING;
  ELSE
    DELETE FROM public.sandy_api_active_read_retry_targets WHERE retry_job_id=lineage.retry_job_id;
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.sandy_api_maintain_read_retry_target_pin() FROM PUBLIC, anon, authenticated, service_role;
CREATE TRIGGER sandy_api_record_read_retry_target_pin
AFTER INSERT ON public.sandy_api_read_job_retries
FOR EACH ROW EXECUTE FUNCTION public.sandy_api_maintain_read_retry_target_pin();
CREATE TRIGGER sandy_api_update_read_retry_target_pin
AFTER UPDATE OF status ON public.sandy_deployment_jobs
FOR EACH ROW EXECUTE FUNCTION public.sandy_api_maintain_read_retry_target_pin();

-- The worker can still write lifecycle/outcome fields. A recorded child's
-- approved execution scope remains immutable even after it becomes terminal.
CREATE FUNCTION public.sandy_api_guard_read_retry_job_scope()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  IF (NEW.requested_by IS DISTINCT FROM OLD.requested_by
    OR NEW.provider IS DISTINCT FROM OLD.provider OR NEW.operation IS DISTINCT FROM OLD.operation
    OR NEW.target IS DISTINCT FROM OLD.target OR NEW.payload IS DISTINCT FROM OLD.payload
    OR NEW.approved_by IS DISTINCT FROM OLD.approved_by OR NEW.approved_at IS DISTINCT FROM OLD.approved_at
    OR NEW.engineering_change_id IS DISTINCT FROM OLD.engineering_change_id
    OR NEW.idempotency_key IS DISTINCT FROM OLD.idempotency_key)
    AND EXISTS (SELECT 1 FROM public.sandy_api_read_job_retries WHERE retry_job_id=OLD.id) THEN
    RAISE EXCEPTION 'retry_child_approved_scope_is_immutable' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.sandy_api_guard_read_retry_job_scope() FROM PUBLIC, anon, authenticated, service_role;
CREATE TRIGGER sandy_api_read_retry_job_scope
BEFORE UPDATE OF requested_by,provider,operation,target,payload,approved_by,approved_at,engineering_change_id,idempotency_key
ON public.sandy_deployment_jobs
FOR EACH ROW EXECUTE FUNCTION public.sandy_api_guard_read_retry_job_scope();

CREATE FUNCTION public.sandy_api_retry_read_deployment_job(p_job_id uuid, p_actor_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER
SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  source_job public.sandy_deployment_jobs%ROWTYPE;
  prior_retry public.sandy_api_read_job_retries%ROWTYPE;
  parent_retry public.sandy_api_read_job_retries%ROWTYPE;
  target_row public.sandy_cloud_targets%ROWTYPE;
  approval public.sandy_api_read_job_approval_snapshots%ROWTYPE;
  retry_id uuid;
  retry_status text;
  root_id uuid;
  depth integer;
  failed_constraint text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.sandy_controller_admins
    WHERE auth_user_id = p_actor_id AND enabled = true AND role = 'owner') THEN
    RETURN jsonb_build_object('ok',false,'error','owner_required','http_status',403);
  END IF;
  SELECT * INTO source_job FROM public.sandy_deployment_jobs WHERE id = p_job_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok',false,'error','job_not_found','http_status',404);
  END IF;

  -- A retry lost its response? Return the same durable child without mutation,
  -- even if a separate authorized executor has since advanced the child state.
  SELECT * INTO prior_retry FROM public.sandy_api_read_job_retries WHERE parent_job_id = p_job_id;
  IF FOUND THEN
    SELECT status INTO retry_status FROM public.sandy_deployment_jobs WHERE id = prior_retry.retry_job_id;
    RETURN jsonb_build_object('ok',true,'accepted',true,'executed',false,
      'request_state','recorded','source_job_id',p_job_id,'retry_job_id',prior_retry.retry_job_id,
      'retry_job_status',retry_status,'reused',true,'retry_depth',prior_retry.retry_depth,
      'dispatch_required',retry_status = 'approved');
  END IF;

  IF source_job.status <> 'failed' THEN
    RETURN jsonb_build_object('ok',false,'error','only_failed_jobs_can_retry','http_status',409);
  END IF;
  IF source_job.provider <> 'google_cloud' OR source_job.operation NOT IN ('get_vm','list_vms','get_logs') THEN
    RETURN jsonb_build_object('ok',false,'error','retry_operation_not_supported','http_status',422);
  END IF;
  IF source_job.result IS NOT NULL OR source_job.error IS NULL
    OR source_job.started_at IS NULL OR source_job.finished_at IS NULL THEN
    RETURN jsonb_build_object('ok',false,'error','retry_requires_outcome_reconciliation','http_status',409);
  END IF;
  -- Known receipt-persistence failures and unclassified exceptions are never
  -- inferred to be transient provider errors. The parent remains unchanged.
  IF (source_job.operation IN ('get_vm','list_vms') AND
      source_job.error !~ '^google_compute_http_(429|500|502|503|504)(:|$)')
    OR (source_job.operation = 'get_logs' AND
      source_job.error !~ '^google_logging_http_(429|500|502|503|504)(:|$)') THEN
    RETURN jsonb_build_object('ok',false,'error','failure_not_classified_retryable','http_status',409);
  END IF;
  IF source_job.approved_at IS NULL OR source_job.approved_by IS NULL OR
    (source_job.approved_by <> 'sandy_read_policy_v2' AND NOT EXISTS (
      SELECT 1 FROM public.sandy_controller_admins WHERE role = 'owner' AND enabled = true
        AND auth_user_id::text = source_job.approved_by
    )) THEN
    RETURN jsonb_build_object('ok',false,'error','original_approval_not_current','http_status',403);
  END IF;

  SELECT * INTO approval FROM public.sandy_api_read_job_approval_snapshots WHERE job_id = p_job_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok',false,'error','approved_target_snapshot_missing','http_status',409);
  END IF;
  IF approval.requested_by IS DISTINCT FROM source_job.requested_by
    OR approval.engineering_change_id IS DISTINCT FROM source_job.engineering_change_id
    OR approval.provider IS DISTINCT FROM source_job.provider
    OR approval.operation IS DISTINCT FROM source_job.operation
    OR approval.target_name IS DISTINCT FROM source_job.target
    OR approval.payload IS DISTINCT FROM source_job.payload
    OR approval.approved_by IS DISTINCT FROM source_job.approved_by
    OR approval.approved_at IS DISTINCT FROM source_job.approved_at THEN
    RETURN jsonb_build_object('ok',false,'error','approved_job_scope_changed','http_status',409);
  END IF;
  SELECT * INTO parent_retry FROM public.sandy_api_read_job_retries WHERE retry_job_id = p_job_id;
  IF FOUND THEN
    depth := parent_retry.retry_depth + 1;
    root_id := parent_retry.root_job_id;
  ELSE
    depth := 1;
    root_id := p_job_id;
  END IF;
  IF depth > 3 THEN
    RETURN jsonb_build_object('ok',false,'error','retry_limit_reached','http_status',429);
  END IF;
  -- No target UPDATE privilege is needed by this invoker. The active composite
  -- FK serializes exact-scope pin creation with target identity mutation.
  SELECT * INTO target_row FROM public.sandy_cloud_targets WHERE name = source_job.target;
  IF NOT FOUND OR nullif(btrim(target_row.project_id),'') IS NULL OR nullif(btrim(target_row.zone),'') IS NULL THEN
    RETURN jsonb_build_object('ok',false,'error','registered_target_required','http_status',409);
  END IF;
  IF target_row.project_id IS DISTINCT FROM approval.target_project_id
    OR target_row.zone IS DISTINCT FROM approval.target_zone THEN
    RETURN jsonb_build_object('ok',false,'error','approved_target_scope_changed','http_status',409);
  END IF;

  BEGIN
    INSERT INTO public.sandy_deployment_jobs(requested_by,provider,operation,target,payload,
      idempotency_key,status,approved_by,approved_at,engineering_change_id)
    VALUES(source_job.requested_by,source_job.provider,source_job.operation,source_job.target,
      source_job.payload,'sandy-api:read-retry:' || p_job_id::text,'approved',
      source_job.approved_by,source_job.approved_at,source_job.engineering_change_id)
    RETURNING id INTO retry_id;
    INSERT INTO public.sandy_api_read_job_retries(parent_job_id,retry_job_id,root_job_id,retry_depth,
    requested_by,original_approved_by,original_approved_at,target_name,target_project_id,target_zone)
    VALUES(p_job_id,retry_id,root_id,depth,p_actor_id,source_job.approved_by,source_job.approved_at,
      target_row.name,target_row.project_id,target_row.zone);
    INSERT INTO public.sandy_deployment_events(job_id,event_type,actor,details)
    VALUES(retry_id,'read_retry_recorded',p_actor_id::text,
      jsonb_build_object('source','sandy-operation-api','parent_job_id',p_job_id,
        'root_job_id',root_id,'retry_depth',depth,'provider_execution_started',false));
  EXCEPTION WHEN unique_violation THEN
    RETURN jsonb_build_object('ok',false,'error','retry_idempotency_collision','http_status',409);
  WHEN foreign_key_violation THEN
    GET STACKED DIAGNOSTICS failed_constraint = CONSTRAINT_NAME;
    IF failed_constraint = 'sandy_api_active_retry_target_scope_fk' THEN
      RETURN jsonb_build_object('ok',false,'error','approved_target_scope_changed','http_status',409);
    END IF;
    RAISE;
  END;
  RETURN jsonb_build_object('ok',true,'accepted',true,'executed',false,
    'request_state','recorded','source_job_id',p_job_id,'retry_job_id',retry_id,
    'retry_job_status','approved','reused',false,'retry_depth',depth,'dispatch_required',true);
END $$;
REVOKE ALL ON FUNCTION public.sandy_api_retry_read_deployment_job(uuid,uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.sandy_api_retry_read_deployment_job(uuid,uuid) TO service_role;
-- Admission remains disabled until an authenticated owner API/MCP attestation.
INSERT INTO public.sandy_operation_registry (
 operation,domain,description,permission_scope,is_mutation,input_schema,output_schema,
 handler,api_exposed,ui_exposed,ai_exposed,verified,implementation_state,
 source_repository,source_path,dependencies,retry_policy,rollback_policy
) VALUES (
 'deployment.jobs.retry','deployment',
 'Record one immutable approved child for a classified transient failed GCP read; accepted does not mean provider execution. Historical unpinned approvals are refused; contract v1.0.0.',
 'deployment:write',true,
 '{"type":"object","required":["job_id"],"properties":{"job_id":{"type":"string","format":"uuid"}},"additionalProperties":false}'::jsonb,'{"type":"object","required":["ok","operation","accepted","executed","request_state","source_job_id","retry_job_id","retry_job_status","reused","retry_depth","dispatch_required"],"properties":{"ok":{"const":true},"operation":{"const":"deployment.jobs.retry"},"accepted":{"const":true},"executed":{"const":false},"request_state":{"const":"recorded"},"source_job_id":{"type":"string","format":"uuid"},"retry_job_id":{"type":"string","format":"uuid"},"retry_job_status":{"type":"string","enum":["pending_approval","approved","running","succeeded","failed","cancelled"]},"reused":{"type":"boolean"},"retry_depth":{"type":"integer","minimum":1,"maximum":3},"dispatch_required":{"type":"boolean"}},"additionalProperties":false}'::jsonb,
 'sandy-operation-api',false,false,false,false,'deployed_unverified',
 'ausstyle/web-staging','supabase/functions/sandy-operation-api/index.ts',
 '["controller_owner_session","sandy_api_retry_read_deployment_job","immutable_approval_snapshot","registered_target_scope","authenticated_live_integration_attestation"]'::jsonb,
 '{"safe_to_retry":true,"automatic":false,"reason":"one durable child per parent; maximum depth three; reconcile unknown admission outcomes"}'::jsonb,
 '{"applicable":false,"reason":"read-only retry admission has no provider compensation; pending child may use cancellation"}'::jsonb
) ON CONFLICT (operation) DO NOTHING;
COMMIT;
