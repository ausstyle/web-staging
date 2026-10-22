-- Metadata component only; no customer identity, context or provider is forged.
BEGIN;
CREATE TEMP TABLE runtime_operational_checks(name text PRIMARY KEY);
CREATE FUNCTION pg_temp.operational_assert(name text, value boolean) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
 IF value IS DISTINCT FROM true THEN RAISE EXCEPTION 'operational contract assertion failed: %',name; END IF;
 INSERT INTO runtime_operational_checks VALUES(name);
END $$;
SELECT pg_temp.operational_assert('exact six internal operational domains',count(*)=6)
 FROM public.sandy_operation_registry WHERE permission_scope='runtime:operational';
SELECT pg_temp.operational_assert('read-only inspection stays closed and does not consume provider/model units',bool_and(
 NOT is_mutation AND NOT api_exposed AND NOT ui_exposed AND NOT ai_exposed AND NOT verified AND
 (error_contract->>'internal_only')::boolean AND (error_contract->>'sensitive')::boolean AND NOT(error_contract->>'consumes_model_resources')::boolean))
 FROM public.sandy_operation_registry WHERE permission_scope='runtime:operational';
SELECT pg_temp.operational_assert('no JSON caller can supply a context tenant profile channel or model',bool_and(
 input_schema->>'additionalProperties'='false' AND input_schema->'properties'='{}'::jsonb AND
 handler='internal:'||operation||'@1.0.0' AND handler<>'sandy-agent-operation-api'))
 FROM public.sandy_operation_registry WHERE permission_scope='runtime:operational';
SELECT pg_temp.operational_assert('environment supplies no geolocation proof',
 (SELECT output_schema->'properties'->'result'->'properties'->'physical_location'->>'const'='not_available' AND
 output_schema->'properties'->'result'->'properties'->'precision'->>'const'='none' FROM public.sandy_operation_registry WHERE operation='agent.runtime.operational.environment'));
SELECT pg_temp.operational_assert('unknown email authorship count remains nullable',
 (SELECT output_schema->'properties'->'result'->'properties'->'counts'->'properties'->'email_authored_by_verified_customer'->'type' ? 'null'
  FROM public.sandy_operation_registry WHERE operation='agent.runtime.operational.communication'));
SELECT pg_temp.operational_assert('recorded connection state is explicitly unverified at the provider',
 (SELECT output_schema->'properties'->'result'->'properties'->'services'->'items'->'properties'->'state'->>'const'='locally_recorded_active_not_provider_verified'
  FROM public.sandy_operation_registry WHERE operation='agent.runtime.operational.connections'));
SELECT pg_temp.operational_assert('actual runtime principal and source scope are required: '||operation,
 (error_contract->>'runtime_context_process_local')::boolean AND
 (error_contract->>'requires_stored_task_and_channel_revalidation')::boolean AND
 (error_contract->>'source_qualifications_preserved')::boolean AND
 NOT(error_contract->>'runtime_principal_is_user_session')::boolean AND
 NOT(error_contract->>'metadata_is_provider_execution_proof')::boolean AND
 NOT(error_contract->>'snapshot_mutable_from_body')::boolean AND error_contract->>'contract_sha256' ~ '^[a-f0-9]{64}$')
 FROM public.sandy_operation_registry WHERE permission_scope='runtime:operational';
SELECT jsonb_build_object('status','pass','component_checks',count(*),'real_provider_calls',0,'real_customer_execution_tested',false,'all_changes_rolled_back',true) AS runtime_operational_contract_evidence FROM runtime_operational_checks;
ROLLBACK;
