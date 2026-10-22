-- Private task-bound connection preflight. Optional existing diagnosis dispatch can consume model resources.
-- This metadata does not verify provider execution or expose a JSON handler.
BEGIN;
DO $guard$ BEGIN IF EXISTS(SELECT 1 FROM public.sandy_operation_registry WHERE operation='agent.runtime.connections.preflight') THEN RAISE EXCEPTION 'runtime_connection_preflight_already_registered_reconcile_first'; END IF; END $guard$;
INSERT INTO public.sandy_operation_registry(operation,domain,description,permission_scope,is_mutation,input_schema,output_schema,handler,api_exposed,ui_exposed,ai_exposed,verified,implementation_state,source_repository,source_path,dependencies,error_contract,retry_policy,rollback_policy) VALUES(
 'agent.runtime.connections.preflight',
 'agent',
 'Check the task-bound customer''s recorded connections against one complete identity-bound Composio page. Record scoped discrepancies and optionally schedule the existing private diagnosis workflow; never claim repair or diagnosis completion. Contract v1.0.0. Internal process-local capability only; no public handler readiness or production verification is asserted.',
 'runtime:connections',
 true,
 '{"type":"object","properties":{"idempotency_key":{"type":"string","pattern":"^[a-zA-Z0-9_.:-]{8,160}$"}},"required":["idempotency_key"],"additionalProperties":false}'::jsonb,
 '{"type":"object","properties":{"ok":{"const":true},"contract_version":{"const":"1.0.0"},"principal_kind":{"const":"trusted_runtime"},"task_id":{"type":"string","format":"uuid"},"result":{"type":"object","properties":{"response":{"type":"string","minLength":1,"maxLength":65536},"success":{"type":"boolean"},"provider_check":{"enum":["confirmed","unavailable"]},"records":{"type":"integer","minimum":0,"maximum":100},"mismatches":{"type":"integer","minimum":0,"maximum":100},"findings_recorded":{"type":"integer","minimum":0,"maximum":100},"diagnosis_requests_scheduled":{"type":"integer","minimum":0,"maximum":100},"diagnosis_completed":{"const":false}},"required":["response","success","provider_check","records","mismatches","findings_recorded","diagnosis_requests_scheduled","diagnosis_completed"],"additionalProperties":false}},"required":["ok","contract_version","principal_kind","task_id","result"],"additionalProperties":false}'::jsonb,
 'internal:agent.runtime.connections.preflight@1.0.0',
 false,
 false,
 false,
 false,
 'awaiting_deployment',
 'ausstyle/web-staging',
 'supabase/functions/_shared/sandy-agent-operations/runtime_connection_preflight.ts',
 '["identity:actual_trusted_runtime_customer_task","capability:process_local_exact_principal_preflight","database:sandy_agent_operation_audit","provider:fixed_tenant_scoped_composio_connected_accounts","workflow:existing_private_sandy_auto_improve","exposure:public_catalogue_stays_eight_operations"]'::jsonb,
 '{"version":"1.0.0","requirement_ids":[145,155,160],"internal_only":true,"sensitive":true,"consumes_model_resources":true,"runtime_principal_is_user_session":false,"customer_id_from_body":false,"capability_process_local":true,"requires_stored_task_channel_request_revalidation":true,"requires_complete_identity_bound_provider_page":true,"paginated_or_malformed_is_unavailable":true,"diagnosis_request_is_completion_proof":false,"provider_status_is_connection_repair":false,"audit_required_before_provider_request":true,"unknown_outcome_redispatch":false,"source_review_only":true,"contract_sha256":"b586e0b38097c4dadfcbeaa80f8ed1b08bb7fc9d410eebfc5a6e7ce49eac7726"}'::jsonb,
 '{"automatic":false,"reason":"One stable task-step claim; unknown provider/diagnosis dispatch requires reconciliation and cannot redispatch."}'::jsonb,
 '{"required":true,"reason":"Record scoped findings and optional diagnosis request only. Never modify connection state; proposals require separate approval."}'::jsonb
);
COMMIT;
