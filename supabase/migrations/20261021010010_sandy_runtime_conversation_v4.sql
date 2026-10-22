-- Admit only the exact active-v4 source profile to the existing internal-only
-- conversation operation. This is source metadata, not model/provider evidence.
BEGIN;
DO $guard$
DECLARE old_constraint name; matches integer;
BEGIN
 SELECT count(*),min(conname) INTO matches,old_constraint FROM pg_constraint
 WHERE conrelid='public.sandy_runtime_conversation_audit'::regclass AND contype='c' AND
   position('d4354d6202851117b36b5e507bfecf52b0497524fb260f29c72f124d36986b78' IN pg_get_constraintdef(oid))>0 AND
   position('f4bfcd9191660fb4f2784d1e9d30151f204bee5eca096d49d02fa9fe330ab993' IN pg_get_constraintdef(oid))>0 AND
   position('3aadfb520f651e9a6807cbb24b5d4409fcfbb25fb69fe5d72036916e44db8679' IN pg_get_constraintdef(oid))=0;
 IF matches<>1 THEN RAISE EXCEPTION 'runtime_conversation_prior_profile_constraint_drift'; END IF;
 EXECUTE format('ALTER TABLE public.sandy_runtime_conversation_audit DROP CONSTRAINT %I',old_constraint);
END $guard$;
ALTER TABLE public.sandy_runtime_conversation_audit ADD CONSTRAINT sandy_runtime_conversation_fixed_source_profile CHECK (
 (source_runtime='sandy-agent-runtime-v2' AND source_sha256='d4354d6202851117b36b5e507bfecf52b0497524fb260f29c72f124d36986b78') OR
 (source_runtime='sandy-agent-runtime-v1-backup-r50' AND source_sha256='f4bfcd9191660fb4f2784d1e9d30151f204bee5eca096d49d02fa9fe330ab993') OR
 (source_runtime='sandy-agent-runtime-v4' AND source_sha256='3aadfb520f651e9a6807cbb24b5d4409fcfbb25fb69fe5d72036916e44db8679')
);
DO $guard$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.sandy_operation_registry WHERE operation='agent.runtime.conversation.respond' AND
   handler='internal:agent.runtime.conversation.respond@1.0.0' AND is_mutation AND
   NOT api_exposed AND NOT ui_exposed AND NOT ai_exposed AND NOT verified AND
   error_contract->>'version'='1.0.0' AND (error_contract->>'internal_only')::boolean) THEN
   RAISE EXCEPTION 'runtime_conversation_closed_registry_contract_drift';
 END IF;
END $guard$;
UPDATE public.sandy_operation_registry SET
 description=description||' The exact active-v4 source profile preserves its existing broker automation credential, integration token, 13-tool schema, temporal context and server-selected model policy; this additive profile has no public exposure.',
 error_contract=error_contract||jsonb_build_object('v4_profile',jsonb_build_object(
   'source_sha256','3aadfb520f651e9a6807cbb24b5d4409fcfbb25fb69fe5d72036916e44db8679',
   'tool_schema_sha256','3a6f4b1d9e3a600739d68013842bf119ec65e11f87fb4a308733befe4bbd2d6b',
   'source_only',true,'transport','fixed_original_v4_broker',
   'authentication','existing_runtime_automation_not_customer_session',
   'timeout_ms',100000,'zero_customer_requires_zero_tools',true))
WHERE operation='agent.runtime.conversation.respond';
COMMIT;
