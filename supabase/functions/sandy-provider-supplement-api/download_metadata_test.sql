-- Administrative metadata-only component validation, no provider or Auth claim.
BEGIN;
DO $test$
DECLARE before_record record; current_record jsonb; changed integer:=0;
BEGIN
 FOR before_record IN SELECT * FROM pg_temp.download_registry_before LOOP
  SELECT to_jsonb(r) INTO current_record FROM public.sandy_operation_registry r WHERE operation=before_record.operation;
  IF current_record IS DISTINCT FROM before_record.snapshot THEN
   IF before_record.operation NOT IN ('github.actions.jobs.logs.capture','github.actions.jobs.steps.logs.capture','github.actions.runs.attempts.logs.capture','github.actions.runs.logs.capture','github.actions.artifacts.download.capture') THEN RAISE EXCEPTION 'unrelated_registry_row_changed'; END IF;
   changed:=changed+1;
   IF (current_record-'description'-'error_contract') IS DISTINCT FROM (before_record.snapshot-'description'-'error_contract')
    OR current_record->'error_contract'->>'contract_sha256' IS DISTINCT FROM before_record.snapshot->'error_contract'->>'contract_sha256'
    OR current_record->'error_contract'->>'private_capture_complete_supported' IS DISTINCT FROM 'true'
    OR current_record->'error_contract'->>'public_payload_retrieval_supported' IS DISTINCT FROM 'false'
    OR current_record->'error_contract'->>'payload_transfer_complete' IS DISTINCT FROM 'false'
    OR current_record->'error_contract'->>'runtime_provider_verified' IS DISTINCT FROM 'false'
    OR current_record->'error_contract'->>'provider_download_host_policy_sha256' IS DISTINCT FROM '0122590a135e29ae6aae87fe2aaa46504516896237a360844c21c6a3ea9accfd'
   THEN RAISE EXCEPTION 'download_metadata_changed_execution_or_attestation'; END IF;
  END IF;
 END LOOP;
 IF changed<>5 THEN RAISE EXCEPTION 'expected_exactly5_download_metadata_updates'; END IF;
END $test$;
SELECT jsonb_build_object('passed',true,'layer','administrative_download_metadata_component','changed_closed_rows',5,
 'existing_contracts_schemas_exposure_verification_preserved',true,'all_other_rows_unchanged',true,
 'provider_called',false,'auth_session_tested',false,'all_changes_rolled_back',true) AS evidence;
ROLLBACK;
