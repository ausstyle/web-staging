-- Contract metadata only. No real customer persona/task or provider is created.
BEGIN;
CREATE TEMP TABLE runtime_record_checks(name text PRIMARY KEY);
CREATE FUNCTION pg_temp.runtime_record_assert(name text, value boolean) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
 IF value IS DISTINCT FROM true THEN RAISE EXCEPTION 'runtime record assertion failed: %',name; END IF;
 INSERT INTO runtime_record_checks VALUES(name);
END $$;
SELECT pg_temp.runtime_record_assert('exact nine separately closed record contracts registered',count(*)=9)
 FROM public.sandy_operation_registry WHERE operation IN (
 'agent.runtime.tasks.list','agent.runtime.tasks.request_client_action','agent.runtime.history.search','agent.runtime.images.request_approval','agent.runtime.connections.list',
 'agent.runtime.context.tasks.find','agent.runtime.context.tasks.get','agent.runtime.context.files.find','agent.runtime.context.memory.search');
SELECT pg_temp.runtime_record_assert('all record execution exposure and verification remain closed',bool_and(
 NOT api_exposed AND NOT ui_exposed AND NOT ai_exposed AND NOT verified AND permission_scope='runtime:records' AND
 (error_contract->>'internal_only')::boolean AND (error_contract->>'sensitive')::boolean AND
 NOT (error_contract->>'consumes_model_resources')::boolean AND
 NOT (error_contract->>'runtime_principal_is_user_session')::boolean))
 FROM public.sandy_operation_registry WHERE permission_scope='runtime:records';
SELECT pg_temp.runtime_record_assert('public agent handler does not own the internal runtime routes',bool_and(
 handler='internal:'||operation||'@1.0.0' AND handler<>'sandy-agent-operation-api'))
 FROM public.sandy_operation_registry WHERE permission_scope='runtime:records';
SELECT pg_temp.runtime_record_assert('JSON inputs cannot select customer identity provider profile or tools',bool_and(
 input_schema->>'additionalProperties'='false' AND NOT(input_schema->'properties' ?| ARRAY['customer_id','auth_user_id','task_id','profile','model','tools','table'])))
 FROM public.sandy_operation_registry WHERE permission_scope='runtime:records';
SELECT pg_temp.runtime_record_assert('runtime child id stays distinct inside the canonical result envelope',bool_and(
 output_schema->'properties'->'task_id'->>'format'='uuid' AND output_schema->'properties' ? 'result' AND
 output_schema->'properties'->'principal_kind'->>'const'='trusted_runtime'))
 FROM public.sandy_operation_registry WHERE permission_scope='runtime:records';
SELECT pg_temp.runtime_record_assert('writes carry an explicit stable idempotency key and typed child id',count(*)=2 AND bool_and(
 input_schema->'required' ? 'idempotency_key' AND output_schema->'properties'->'result'->'properties'->'task_id'->>'format'='uuid'))
 FROM public.sandy_operation_registry WHERE permission_scope='runtime:records' AND is_mutation;
SELECT pg_temp.runtime_record_assert('image route requests client approval without model execution',
 (SELECT output_schema->'properties'->'result'->'properties'->'approval_pending'->>'const'='true' AND
  NOT (error_contract->>'provider_or_model_execution')::boolean FROM public.sandy_operation_registry WHERE operation='agent.runtime.images.request_approval'));
SELECT pg_temp.runtime_record_assert('each operation binds actual task ownership and refuses unknown redispatch: '||operation,
 (error_contract->>'requires_stored_task_revalidation')::boolean AND NOT(error_contract->>'customer_id_from_body')::boolean AND
 error_contract->>'same_key_unknown_outcome'='reconciliation_required_no_reexecution' AND error_contract->>'contract_sha256' ~ '^[a-f0-9]{64}$')
 FROM public.sandy_operation_registry WHERE permission_scope='runtime:records';
SELECT jsonb_build_object('status','pass','component_checks',count(*),'real_provider_calls',0,'real_customer_execution_tested',false,'all_changes_rolled_back',true) AS runtime_record_contract_evidence FROM runtime_record_checks;
ROLLBACK;
