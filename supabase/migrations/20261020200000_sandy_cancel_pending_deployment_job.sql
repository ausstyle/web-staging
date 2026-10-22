-- Atomic owner-only cancellation before worker claim. Running/provider jobs fail closed.
BEGIN;
CREATE FUNCTION public.sandy_api_cancel_deployment_job(p_job_id uuid, p_actor_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER
SET search_path = pg_catalog, pg_temp AS $$
DECLARE current_status text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.sandy_controller_admins
    WHERE auth_user_id = p_actor_id AND enabled = true AND role = 'owner') THEN
    RETURN jsonb_build_object('ok',false,'error','owner_required','http_status',403);
  END IF;
  SELECT status INTO current_status FROM public.sandy_deployment_jobs WHERE id = p_job_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok',false,'error','job_not_found','http_status',404);
  END IF;
  IF current_status = 'cancelled' THEN
    RETURN jsonb_build_object('ok',true,'job_id',p_job_id,'state','cancelled','already_cancelled',true);
  END IF;
  IF current_status NOT IN ('pending_approval','approved') THEN
    RETURN jsonb_build_object('ok',false,'error','job_not_cancellable','http_status',409,'state',current_status);
  END IF;
  UPDATE public.sandy_deployment_jobs SET status = 'cancelled', updated_at = now(), finished_at = now()
    WHERE id = p_job_id;
  INSERT INTO public.sandy_deployment_events(job_id,event_type,actor,details)
    VALUES (p_job_id,'cancelled',p_actor_id::text,
      jsonb_build_object('source','sandy-operation-api','previous_state',current_status,'provider_cancellation',false));
  RETURN jsonb_build_object('ok',true,'job_id',p_job_id,'state','cancelled','already_cancelled',false);
END $$;
REVOKE ALL ON FUNCTION public.sandy_api_cancel_deployment_job(uuid,uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sandy_api_cancel_deployment_job(uuid,uuid) TO service_role;

INSERT INTO public.sandy_operation_registry (
  operation,domain,description,permission_scope,is_mutation,input_schema,output_schema,
  handler,api_exposed,ui_exposed,ai_exposed,verified,implementation_state,
  source_repository,source_path,dependencies,retry_policy,rollback_policy
) VALUES (
  'deployment.jobs.cancel','deployment',
  'Cancel pending or approved deployment jobs atomically before worker claim; running/provider cancellation is unsupported; contract v1.0.0.',
  'deployment:write',true,
  '{"type":"object","required":["job_id"],"properties":{"job_id":{"type":"string","format":"uuid"}},"additionalProperties":false}',
  '{"type":"object","required":["ok","job_id","state","already_cancelled"],"properties":{"ok":{"const":true},"job_id":{"type":"string","format":"uuid"},"state":{"const":"cancelled"},"already_cancelled":{"type":"boolean"}},"additionalProperties":false}',
  'sandy-operation-api',false,false,false,false,'deployed_unverified',
  'ausstyle/web-staging','supabase/functions/sandy-operation-api/index.ts',
  '["controller_owner_session","sandy_api_cancel_deployment_job","authenticated_live_integration_attestation"]',
  '{"safe_to_retry":true,"automatic":false,"reason":"idempotent terminal-state check; reconcile ambiguous responses"}',
  '{"applicable":false,"reason":"cancellation cannot restart a job; create a new authorized request"}'
) ON CONFLICT (operation) DO NOTHING;
-- Exposure stays disabled until the authenticated owner API/MCP test passes.
COMMIT;
