-- Registry-only schema evolution; no Auth session or real approval is created.
BEGIN;
DO $test$
DECLARE contract public.sandy_operation_registry; options jsonb;
BEGIN
 SELECT * INTO contract FROM public.sandy_operation_registry WHERE operation='supabase.tenant.consent.set';
 options:=contract.input_schema->'properties'->'operations'->'items'->'enum';
 IF contract.error_contract->>'contract_sha256' IS DISTINCT FROM '7a9ed304551bffc702c93f750361c607e3c4fc16da84991abab9c324f851b25d' THEN RAISE EXCEPTION 'inventory_consent_contract_hash_mismatch';END IF;
 IF jsonb_array_length(options)<>52 OR NOT options ? 'supabase.tenant.protected_resources.inventory' OR NOT options ? 'supabase.tenant.export' OR NOT options ? 'supabase.storage.objects.get' THEN RAISE EXCEPTION 'inventory_consent_operation_extension_mismatch';END IF;
 IF contract.api_exposed OR contract.ai_exposed OR contract.verified THEN RAISE EXCEPTION 'inventory_consent_activated_without_verification';END IF;
 IF NOT has_function_privilege('authenticated','public.sandy_supabase_tenant_consent_set(text[],text[],boolean,timestamp with time zone)','EXECUTE') OR has_function_privilege('service_role','public.sandy_supabase_tenant_consent_set(text[],text[],boolean,timestamp with time zone)','EXECUTE') THEN RAISE EXCEPTION 'inventory_consent_actual_user_acl_changed';END IF;
END $test$;
SELECT jsonb_build_object('passed',true,'layer','administrative_database_component','fixtures','always_rolled_back','real_auth_session_tested',false,'external_provider_called',false,'checks',jsonb_build_array('exact_revised_consent_hash','preserved51_options_plus_protected_inventory','exposure_and_verification_remain_closed','actual_user_only_consent_acl_preserved')) AS evidence;
ROLLBACK;
