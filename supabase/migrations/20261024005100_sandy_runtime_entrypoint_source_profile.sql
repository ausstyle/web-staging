-- Reconcile the reviewed Runtime36 entrypoint pin with the fixed receipt profile.
-- Retain old receipts verbatim. New v4 INSERTs accept only the exact new source;
-- completed historical rows and legitimate in-flight terminal updates remain intact.
BEGIN;
SET LOCAL lock_timeout='2s';SET LOCAL statement_timeout='15s';
DO $source_guard$
DECLARE definition text;old text;
BEGIN
 IF md5(pg_get_constraintdef((SELECT oid FROM pg_constraint WHERE conrelid='public.sandy_runtime_conversation_audit'::regclass AND conname='sandy_runtime_conversation_fixed_source_profile'))) IS DISTINCT FROM 'b007a0775302338a02eda2db3cef777e'
 THEN RAISE EXCEPTION 'exact_runtime_source_constraint_preimage_required';END IF;
 SELECT pg_get_functiondef('public.sandy_runtime_conversation_receipt_guard()'::regprocedure) INTO definition;
 IF md5(definition)<>'0f077a547cdac1aa9329c0c78dfd3205' THEN RAISE EXCEPTION 'exact_metrics_receipt_guard_preimage_required';END IF;
 old:=$old$ ELSE
   IF NEW.state<>'started'$old$;
 IF (length(definition)-length(replace(definition,old,'')))/length(old)<>1 THEN RAISE EXCEPTION 'exact_insert_guard_anchor_required';END IF;
 EXECUTE replace(definition,old,$new$ ELSE
   IF NEW.source_runtime='sandy-agent-runtime-v4' AND NEW.source_sha256 IS DISTINCT FROM 'f4f15732b13e21d9fbd76de8173aac71672e4a5a49e8d17baf0884abe967f796' THEN
     RAISE EXCEPTION 'v4_new_receipt_entrypoint_source_required';
   END IF;
   IF NEW.state<>'started'$new$);
END $source_guard$;
ALTER TABLE public.sandy_runtime_conversation_audit DROP CONSTRAINT sandy_runtime_conversation_fixed_source_profile;
ALTER TABLE public.sandy_runtime_conversation_audit ADD CONSTRAINT sandy_runtime_conversation_fixed_source_profile CHECK (
 (source_runtime='sandy-agent-runtime-v2' AND source_sha256='d4354d6202851117b36b5e507bfecf52b0497524fb260f29c72f124d36986b78') OR
 (source_runtime='sandy-agent-runtime-v1-backup-r50' AND source_sha256='f4bfcd9191660fb4f2784d1e9d30151f204bee5eca096d49d02fa9fe330ab993') OR
 (source_runtime='sandy-agent-runtime-v4' AND source_sha256 IN('3aadfb520f651e9a6807cbb24b5d4409fcfbb25fb69fe5d72036916e44db8679','f4f15732b13e21d9fbd76de8173aac71672e4a5a49e8d17baf0884abe967f796'))
);
COMMENT ON CONSTRAINT sandy_runtime_conversation_fixed_source_profile ON public.sandy_runtime_conversation_audit IS
 'Exact approved source profiles. Legacy v4 hash is retained only for unchanged historical/in-flight rows; the INSERT trigger requires the current entrypoint hash for every new v4 receipt. No arbitrary hash or runtime is admitted.';
DO $registry_guard$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.sandy_operation_registry WHERE operation='agent.runtime.conversation.respond'
  AND handler='internal:agent.runtime.conversation.respond@1.0.0' AND NOT api_exposed AND NOT ui_exposed AND NOT ai_exposed AND NOT verified
  AND error_contract->'v4_profile'->>'source_sha256'='3aadfb520f651e9a6807cbb24b5d4409fcfbb25fb69fe5d72036916e44db8679')
 THEN RAISE EXCEPTION 'closed_runtime_source_profile_registry_preimage_required';END IF;
END $registry_guard$;
UPDATE public.sandy_operation_registry SET error_contract=jsonb_set(error_contract,'{v4_profile,source_sha256}',to_jsonb('f4f15732b13e21d9fbd76de8173aac71672e4a5a49e8d17baf0884abe967f796'::text))
 WHERE operation='agent.runtime.conversation.respond';
COMMIT;
