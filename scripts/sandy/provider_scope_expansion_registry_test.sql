-- Registry/DDL component validation only. No Auth session or provider execution.
BEGIN;
DO $test$
DECLARE n integer; hashes text;
BEGIN
 IF (SELECT count(*) FROM pg_temp.sandy_provider_expansion_before)<>595 THEN RAISE EXCEPTION 'original_provider_snapshot_count_mismatch'; END IF;
 IF EXISTS(SELECT 1 FROM pg_temp.sandy_provider_expansion_before b LEFT JOIN public.sandy_operation_registry r USING(operation) WHERE to_jsonb(r) IS DISTINCT FROM b.snapshot) THEN RAISE EXCEPTION 'original_provider_registry_changed'; END IF;
 SELECT count(*),encode(extensions.digest(string_agg(r.operation||':'||(r.error_contract->>'contract_sha256'),E'\n' ORDER BY r.operation COLLATE "C"),'sha256'),'hex') INTO n,hashes
 FROM public.sandy_operation_registry r LEFT JOIN pg_temp.sandy_provider_expansion_before b USING(operation)
 WHERE r.handler='sandy-provider-operation-api' AND b.operation IS NULL;
 IF n<>1143 OR hashes<>'39c610e4441d821047c9657b8f9f6cfc131f7e2f613018274c2c18e823d80245' THEN RAISE EXCEPTION 'expansion_count_or_hash_mismatch count=% hash=%',n,hashes; END IF;
 IF EXISTS(SELECT 1 FROM public.sandy_operation_registry r LEFT JOIN pg_temp.sandy_provider_expansion_before b USING(operation)
 WHERE r.handler='sandy-provider-operation-api' AND b.operation IS NULL AND
 (r.api_exposed IS DISTINCT FROM false OR r.ai_exposed IS DISTINCT FROM false OR r.verified IS DISTINCT FROM false
 OR r.error_contract->>'requires_approval' IS DISTINCT FROM 'true' OR r.error_contract->>'api_key_delegable' IS DISTINCT FROM 'false')) THEN RAISE EXCEPTION 'expansion_not_closed'; END IF;
END $test$;
SELECT jsonb_build_object('passed',true,'layer','administrative_registry_component','original_595_full_rows_unchanged',true,'new_operations',1143,'all_additions_closed_unverified',true,'provider_called',false,'auth_session_tested',false,'all_changes_rolled_back',true) AS evidence;
ROLLBACK;
