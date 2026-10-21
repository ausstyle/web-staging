-- Internal runtime conversation inference. No public session/profile exposure.
-- A contract and source review are not live model/provider verification.
BEGIN;
CREATE TABLE public.sandy_runtime_conversation_audit (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 operation text NOT NULL CHECK (operation='agent.runtime.conversation.respond'),
 contract_version text NOT NULL CHECK (contract_version='1.0.0'),
 principal_kind text NOT NULL CHECK (principal_kind='trusted_runtime'),
 auth_user_id uuid CHECK (auth_user_id IS NULL),
 customer_id uuid REFERENCES public.email_customers(id),
 task_id uuid NOT NULL REFERENCES public.sandy_agent_tasks(id),
 channel text NOT NULL,
 request_id text NOT NULL,
 source_runtime text NOT NULL,
 source_sha256 text NOT NULL,
 round integer NOT NULL CHECK (round BETWEEN 0 AND 3),
 selected_model text NOT NULL CHECK (selected_model ~ '^[a-zA-Z0-9_.:-]{1,200}$'),
 request_sha256 text NOT NULL CHECK (request_sha256 ~ '^[a-f0-9]{64}$'),
 state text NOT NULL CHECK (state IN ('started','succeeded','failed','unknown')),
 provider_response_id text,
 response_sha256 text CHECK (response_sha256 IS NULL OR response_sha256 ~ '^[a-f0-9]{64}$'),
 error text,
 created_at timestamptz NOT NULL DEFAULT now(),
 finished_at timestamptz,
 UNIQUE(task_id,round),
 CHECK ((source_runtime='sandy-agent-runtime-v2' AND source_sha256='d4354d6202851117b36b5e507bfecf52b0497524fb260f29c72f124d36986b78') OR
   (source_runtime='sandy-agent-runtime-v1-backup-r50' AND source_sha256='f4bfcd9191660fb4f2784d1e9d30151f204bee5eca096d49d02fa9fe330ab993')),
 CHECK ((state='started' AND finished_at IS NULL) OR (state<>'started' AND finished_at IS NOT NULL)),
 CHECK (state<>'succeeded' OR (provider_response_id IS NOT NULL AND response_sha256 IS NOT NULL AND error IS NULL))
);
ALTER TABLE public.sandy_runtime_conversation_audit ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.sandy_runtime_conversation_audit FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT,UPDATE ON public.sandy_runtime_conversation_audit TO service_role;
COMMENT ON TABLE public.sandy_runtime_conversation_audit IS
 'Private internal model-round receipts. Nullable customer means no tenant identity; never an Auth or owner session. No prompts/tool content are retained. One claim per task/round; lost results require reconciliation and must not be redispatched.';
CREATE FUNCTION public.sandy_runtime_conversation_receipt_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $guard$
DECLARE task public.sandy_agent_tasks%ROWTYPE;
BEGIN
 IF TG_OP='UPDATE' THEN
   IF OLD.state<>'started' OR NEW.state NOT IN ('succeeded','failed','unknown') THEN
     RAISE EXCEPTION 'runtime_conversation_receipt_transition_denied';
   END IF;
   IF (to_jsonb(NEW)-ARRAY['state','provider_response_id','response_sha256','error','finished_at']) IS DISTINCT FROM
      (to_jsonb(OLD)-ARRAY['state','provider_response_id','response_sha256','error','finished_at']) THEN
     RAISE EXCEPTION 'runtime_conversation_receipt_scope_immutable';
   END IF;
 ELSE
   IF NEW.state<>'started' OR NEW.provider_response_id IS NOT NULL OR NEW.response_sha256 IS NOT NULL THEN
     RAISE EXCEPTION 'runtime_conversation_started_claim_required';
   END IF;
 END IF;
 SELECT * INTO task FROM public.sandy_agent_tasks WHERE id=NEW.task_id;
 IF NOT FOUND OR task.customer_id IS DISTINCT FROM NEW.customer_id OR task.channel IS DISTINCT FROM NEW.channel OR
    task.request_id IS DISTINCT FROM NEW.request_id OR task.status NOT IN ('queued','running') THEN
   RAISE EXCEPTION 'runtime_conversation_persisted_task_mismatch';
 END IF;
 IF TG_OP='INSERT' AND NEW.round>0 AND NOT EXISTS (
   SELECT 1 FROM public.sandy_runtime_conversation_audit r WHERE r.task_id=NEW.task_id AND r.round=NEW.round-1 AND
    r.state='succeeded' AND r.source_runtime=NEW.source_runtime AND r.source_sha256=NEW.source_sha256 AND
    r.selected_model=NEW.selected_model AND r.customer_id IS NOT DISTINCT FROM NEW.customer_id
 ) THEN RAISE EXCEPTION 'runtime_conversation_prior_round_not_verified'; END IF;
 RETURN NEW;
END $guard$;
REVOKE ALL ON FUNCTION public.sandy_runtime_conversation_receipt_guard() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER sandy_runtime_conversation_receipt_binding BEFORE INSERT OR UPDATE ON public.sandy_runtime_conversation_audit
 FOR EACH ROW EXECUTE FUNCTION public.sandy_runtime_conversation_receipt_guard();
DO $guard$ BEGIN
 IF EXISTS (SELECT 1 FROM public.sandy_operation_registry WHERE operation='agent.runtime.conversation.respond') THEN
   RAISE EXCEPTION 'runtime_conversation_operation_already_registered_reconcile_first';
 END IF;
END $guard$;
INSERT INTO public.sandy_operation_registry(operation,domain,description,permission_scope,is_mutation,input_schema,output_schema,handler,api_exposed,ui_exposed,ai_exposed,verified,implementation_state,source_repository,source_path,dependencies,error_contract,retry_policy,rollback_policy) VALUES (
 'agent.runtime.conversation.respond',
 'agent',
 'Internal task-bound conversation inference through the fixed archived runtime profile. Preserves original server-selected models, instructions, tool schemas, three continuation rounds and 100-second timeout. Does not execute tools or create a customer session. JSON callers cannot supply or serialize the trusted capability; no public HTTP handler readiness is claimed. Contract v1.0.0; public/sensitive/cost exposure remains closed.',
 'runtime:conversation',
 true,
 '{"type":"object","properties":{"round":{"type":"integer","minimum":0,"maximum":3},"tool_results":{"type":"array","maxItems":200,"items":{"type":"object","properties":{"type":{"const":"function_call_output"},"call_id":{"type":"string","minLength":1,"maxLength":512},"output":{"type":"string","maxLength":2097152}},"required":["type","call_id","output"],"additionalProperties":false}}},"required":["round","tool_results"],"additionalProperties":false}'::jsonb,
 '{"type":"object","properties":{"ok":{"const":true},"operation":{"const":"agent.runtime.conversation.respond"},"contract_version":{"const":"1.0.0"},"principal_kind":{"const":"trusted_runtime"},"customer_id":{"type":["string","null"],"format":"uuid"},"task_id":{"type":"string","format":"uuid"},"round":{"type":"integer","minimum":0,"maximum":3},"selected_model":{"type":"string","minLength":1,"maxLength":200},"response":{"type":"object","properties":{"id":{"type":"string","minLength":1,"maxLength":512},"output":{"type":"array","maxItems":200,"items":{"type":"object"}}},"required":["id","output"],"additionalProperties":true}},"required":["ok","operation","contract_version","principal_kind","customer_id","task_id","round","selected_model","response"],"additionalProperties":false}'::jsonb,
 'internal:agent.runtime.conversation.respond@1.0.0',
 false,
 false,
 false,
 false,
 'awaiting_deployment',
 'ausstyle/web-staging',
 'supabase/functions/_shared/sandy-agent-operations/runtime_conversation.ts',
 '["identity:verified_RuntimeProof_and_persisted_task","database:sandy_runtime_conversation_audit","configuration:existing_runtime_OpenAI_credential","source:exact_archived_fallback_profile"]'::jsonb,
 '{"version":"1.0.0","requirement_ids":[151,160],"sensitive":true,"consumes_model_resources":true,"internal_only":true,"principal":"in_process_RuntimeProof_bound_persisted_runtime_task","auth_user_id":null,"nullable_customer_is_tenant_identity":false,"zero_customer_requires_zero_tools":true,"public_profile_selection":false,"provider_tool_execution":false,"source_review_only":true,"unknown_outcome":"reconciliation_required_no_redispatch","source_versions_are_archived_observations":true,"contract_sha256":"73aa4b54e67e8aaf12a6eef9e49cf6a189de263bfa828c2830e9c087165a9a0b"}'::jsonb,
 '{"automatic":false,"same_round_redispatch":false,"reason":"A started, unknown or completed round must never initiate another paid request."}'::jsonb,
 '{"required":false,"reason":"Model consumption cannot be rolled back; retain actual response hash/ID and reconcile lost results."}'::jsonb
);
COMMIT;
