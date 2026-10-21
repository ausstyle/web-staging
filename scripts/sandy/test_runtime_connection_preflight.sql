-- Registry metadata component only. No provider/model request or forged customer.
BEGIN;
CREATE TEMP TABLE runtime_preflight_checks(name text PRIMARY KEY);
CREATE FUNCTION pg_temp.preflight_assert(name text,value boolean) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
 IF value IS DISTINCT FROM true THEN RAISE EXCEPTION 'preflight contract assertion failed: %',name; END IF;
 INSERT INTO runtime_preflight_checks VALUES(name);
END $$;
SELECT pg_temp.preflight_assert('one named private preflight contract',count(*)=1)
 FROM public.sandy_operation_registry WHERE operation='agent.runtime.connections.preflight';
SELECT pg_temp.preflight_assert('mutation model cost and sensitive exposure remain closed',is_mutation AND
 NOT api_exposed AND NOT ui_exposed AND NOT ai_exposed AND NOT verified AND
 (error_contract->>'internal_only')::boolean AND (error_contract->>'sensitive')::boolean AND
 (error_contract->>'consumes_model_resources')::boolean AND implementation_state='awaiting_deployment')
 FROM public.sandy_operation_registry WHERE operation='agent.runtime.connections.preflight';
SELECT pg_temp.preflight_assert('no public caller can supply customer profile key or provider URL',
 input_schema->>'additionalProperties'='false' AND input_schema->'required'='["idempotency_key"]'::jsonb AND
 (SELECT count(*) FROM jsonb_object_keys(input_schema->'properties'))=1 AND handler='internal:agent.runtime.connections.preflight@1.0.0')
 FROM public.sandy_operation_registry WHERE operation='agent.runtime.connections.preflight';
SELECT pg_temp.preflight_assert('exact live task and process-local identity are required',
 (error_contract->>'capability_process_local')::boolean AND (error_contract->>'requires_stored_task_channel_request_revalidation')::boolean AND
 NOT(error_contract->>'runtime_principal_is_user_session')::boolean AND NOT(error_contract->>'customer_id_from_body')::boolean)
 FROM public.sandy_operation_registry WHERE operation='agent.runtime.connections.preflight';
SELECT pg_temp.preflight_assert('strict complete tenant-bound evidence and unavailable partial states',
 (error_contract->>'requires_complete_identity_bound_provider_page')::boolean AND (error_contract->>'paginated_or_malformed_is_unavailable')::boolean)
 FROM public.sandy_operation_registry WHERE operation='agent.runtime.connections.preflight';
SELECT pg_temp.preflight_assert('diagnosis request and provider observation never claim completion or repair',
 NOT(error_contract->>'diagnosis_request_is_completion_proof')::boolean AND NOT(error_contract->>'provider_status_is_connection_repair')::boolean AND
 output_schema->'properties'->'result'->'properties'->'diagnosis_completed'->>'const'='false')
 FROM public.sandy_operation_registry WHERE operation='agent.runtime.connections.preflight';
SELECT pg_temp.preflight_assert('audit precedes provider and unknown cannot redispatch',
 (error_contract->>'audit_required_before_provider_request')::boolean AND NOT(error_contract->>'unknown_outcome_redispatch')::boolean AND
 NOT(retry_policy->>'automatic')::boolean AND (rollback_policy->>'required')::boolean)
 FROM public.sandy_operation_registry WHERE operation='agent.runtime.connections.preflight';
SELECT pg_temp.preflight_assert('accurate source-only evidence and contract digest',
 (error_contract->>'source_review_only')::boolean AND error_contract->>'contract_sha256' ~ '^[a-f0-9]{64}$' AND
 source_path='supabase/functions/_shared/sandy-agent-operations/runtime_connection_preflight.ts')
 FROM public.sandy_operation_registry WHERE operation='agent.runtime.connections.preflight';
SELECT jsonb_build_object('status','pass','component_checks',count(*),'real_provider_calls',0,'real_customer_execution_tested',false,'all_changes_rolled_back',true) AS runtime_preflight_contract_evidence FROM runtime_preflight_checks;
ROLLBACK;
