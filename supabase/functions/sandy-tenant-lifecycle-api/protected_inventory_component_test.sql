-- Administrative PostgreSQL component test, NOT an authenticated customer or
-- Controller approval test. All identities, noncredential strings and proof
-- metadata are synthetic and always ROLLBACK. No password/session/owner grant,
-- provider dispatch, Vault secret creation or valid customer key is issued.
BEGIN;
-- SHARED_OWNER_COMPONENT_FIXTURE
CREATE FUNCTION pg_temp.protected_inventory_call(p_args jsonb) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE actor uuid;admission uuid;answer jsonb;
BEGIN
 SELECT auth_user_id INTO actor FROM public.sandy_controller_admins WHERE role='owner' AND enabled ORDER BY created_at LIMIT 1;
 admission:=pg_temp.sandy_owner_component_admission('supabase.tenant.protected_resources.inventory',p_args,'f409867ca7bb8103d66fcfc4bdbc10fc5c8fc2a5849cd15b5ba3ba79d6d128a9');
 answer:=public.sandy_tenant_protected_inventory(actor,admission,p_args::text);
 IF answer->>'ok' IS DISTINCT FROM 'true' OR answer->>'reused' IS DISTINCT FROM 'false' THEN RAISE EXCEPTION 'protected_inventory_dispatch_failed';END IF;
 RETURN answer->'result';
END $$;
DO $test$
DECLARE tenant uuid:=gen_random_uuid();subject uuid:=gen_random_uuid();foreign_tenant uuid:=gen_random_uuid();foreign_subject uuid:=gen_random_uuid();
 key_id uuid:=gen_random_uuid();key_id2 uuid:=gen_random_uuid();foreign_key_id uuid:=gen_random_uuid();calendar_id uuid:=gen_random_uuid();xero_id uuid:=gen_random_uuid();voice_id uuid:=gen_random_uuid();context_id uuid:=gen_random_uuid();vault_id uuid:=gen_random_uuid();
 email text:='protected-inventory-fixture-'||gen_random_uuid()::text||'@example.invalid';op_name text:='supabase.tenant.protected_resources.inventory';scope_sha text:='f409867ca7bb8103d66fcfc4bdbc10fc5c8fc2a5849cd15b5ba3ba79d6d128a9';
 args jsonb;result jsonb;resources jsonb;r jsonb;actor uuid;admission uuid;refused boolean;old_error_contract jsonb;key_material text:='SYNTHETIC_NOT_A_CREDENTIAL_'||gen_random_uuid()::text;
BEGIN
 IF NOT has_function_privilege('service_role','public.sandy_tenant_protected_inventory(uuid,uuid,text)','EXECUTE')
 OR has_function_privilege('authenticated','public.sandy_tenant_protected_inventory(uuid,uuid,text)','EXECUTE')
 OR has_function_privilege('anon','public.sandy_tenant_protected_inventory(uuid,uuid,text)','EXECUTE')
 OR has_function_privilege('service_role','public.sandy_tenant_protected_inventory_capture(uuid,integer,integer)','EXECUTE')
 THEN RAISE EXCEPTION 'protected_inventory_acl_invalid';END IF;
 IF NOT EXISTS(SELECT 1 FROM public.sandy_operation_registry WHERE sandy_operation_registry.operation=op_name AND NOT api_exposed AND NOT ai_exposed AND NOT verified AND NOT is_mutation AND error_contract->>'requires_approval'='true' AND error_contract->>'api_key_delegable'='false') THEN RAISE EXCEPTION 'protected_inventory_default_policy_invalid';END IF;
 -- No password or identity provider is set, so these temporary rows cannot log in.
 INSERT INTO auth.users(id,email,email_confirmed_at,created_at,updated_at,raw_app_meta_data,raw_user_meta_data)
 VALUES(subject,email,clock_timestamp(),clock_timestamp(),clock_timestamp(),'{}','{}'),(foreign_subject,'foreign-'||email,clock_timestamp(),clock_timestamp(),clock_timestamp(),'{}','{}');
 INSERT INTO public.email_customers(id) VALUES(tenant),(foreign_tenant);
 INSERT INTO public.email_customer_addresses(customer_id,email_address,is_primary) VALUES(tenant,email,true),(foreign_tenant,'foreign-'||email,true);
 INSERT INTO public.sandy_memory_portal_accounts(auth_user_id,customer_id) VALUES(subject,tenant),(foreign_subject,foreign_tenant);
 INSERT INTO public.sandy_supabase_tenant_consents(tenant_id,auth_user_id,operations,approved_emails,allow_erasure,expires_at)
 VALUES(tenant,subject,ARRAY[op_name,'supabase.tenant.exports.get'],ARRAY[]::text[],false,clock_timestamp()+interval '1 hour');
 INSERT INTO public.sandy_supabase_tenant_controls(tenant_id,legal_hold,retention_until) VALUES(tenant,true,clock_timestamp()+interval '1 year');
 -- Invalid key hash strings cannot equal any SHA-256 authentication digest.
 INSERT INTO public.sandy_operations_keys(id,customer_id,name,key_hash,prefix,scopes,expires_at,revoked_at)
 VALUES(key_id,tenant,'SYNTHETIC',key_material,'fixture',ARRAY['memory:read'],clock_timestamp()+interval '1 hour',NULL),
 (key_id2,tenant,'SYNTHETIC REVOKED',key_material||'_2','fixture',ARRAY['tasks:read'],clock_timestamp()+interval '1 hour',clock_timestamp()),
 (foreign_key_id,foreign_tenant,'SYNTHETIC FOREIGN',key_material||'_foreign','fixture',ARRAY['FOREIGN_MUST_NOT_APPEAR'],NULL,NULL);
 -- Deliberate UUID coincidence across distinct namespaces must not imply ownership.
 INSERT INTO public.sandy_api_tenants(id,name) VALUES(tenant,'SYNTHETIC UNMAPPED API TENANT');
 INSERT INTO public.sandy_api_keys(tenant_id,name,key_hash,key_prefix) VALUES(tenant,'SYNTHETIC UNMAPPED',key_material||'_unmapped','fixture');
 INSERT INTO public.sandy_computer_api_grants(tenant_id,enabled) VALUES(tenant,true);
 -- A nonexistent principal is not an enabled Controller owner; this is unusable
 -- proof metadata with an unretained random digest, not an issued credential.
 INSERT INTO public.sandy_api_credentials(id,principal_id,tenant_id,secret_sha256,allowed_operations,expires_at,requests_per_minute,declared_unit_budget)
 VALUES(gen_random_uuid(),gen_random_uuid(),tenant,encode(extensions.digest(gen_random_uuid()::text,'sha256'),'hex'),ARRAY['system.health'],clock_timestamp()+interval '30 minutes',1,0);
 INSERT INTO public.sandy_context_api_grants(id,tenant_id,customer_id,capabilities,active) VALUES(context_id,tenant,tenant,ARRAY['memory:read'],true);
 INSERT INTO public.sandy_calendar_connections(id,customer_id,provider,direction,connection_state,token_secret_ref,cursor_ref,last_error)
 VALUES(calendar_id,tenant,'ics','read_only','connected','SYNTHETIC_PRIVATE_TOKEN_REF','SYNTHETIC_PRIVATE_CURSOR','SYNTHETIC_PRIVATE_ERROR'),(gen_random_uuid(),foreign_tenant,'caldav','two_way','connected',NULL,NULL,NULL);
 INSERT INTO public.sandy_xero_connections(id,owner_customer_id,auth_user_id,xero_tenant_id,organisation_name,status,scopes,access_token_ciphertext,refresh_token_ciphertext)
 VALUES(xero_id,tenant,subject,'SYNTHETIC_EXTERNAL_ID','SYNTHETIC ORGANISATION','disconnected',ARRAY['accounting.settings.read'],'SYNTHETIC_NOT_CIPHERTEXT','SYNTHETIC_NOT_CIPHERTEXT'),
 (gen_random_uuid(),foreign_tenant,foreign_subject,'SYNTHETIC_FOREIGN_EXTERNAL_ID','FOREIGN_MUST_NOT_APPEAR','disconnected',ARRAY['FOREIGN_MUST_NOT_APPEAR'],NULL,NULL);
 INSERT INTO public.sandy_voice_call_links(id,owner_customer_id,token_sha256,expires_at,revoked_at,max_starts,starts,trusted_memory)
 VALUES(voice_id,tenant,encode(extensions.digest(gen_random_uuid()::text,'sha256'),'hex'),clock_timestamp()+interval '1 hour',clock_timestamp(),1,0,true),
 (gen_random_uuid(),foreign_tenant,encode(extensions.digest(gen_random_uuid()::text,'sha256'),'hex'),clock_timestamp()+interval '1 hour',NULL,1,0,false);
 -- Metadata binding only. No Vault secret exists or is created/read by this test.
 INSERT INTO public.sandy_supabase_managed_vault(tenant_id,name,secret_id) VALUES(tenant,'synthetic-metadata-only',vault_id),(foreign_tenant,'foreign-must-not-appear',gen_random_uuid());
 UPDATE public.sandy_operation_registry SET api_exposed=true,verified=true WHERE sandy_operation_registry.operation IN(op_name,'supabase.tenant.exports.get');
 args:=jsonb_build_object('tenant_id',tenant,'offset',0,'limit',50);
 result:=pg_temp.protected_inventory_call(args);resources:=result->'resources';
 IF result->>'complete_tenant_coverage'<>'false' OR result->>'provider_revocation_verified'<>'false' OR result->>'generic_restore_permitted'<>'false' OR result->>'audit_evidence_disposition'<>'retain_append_only_digest_evidence' OR (SELECT count(*) FROM jsonb_object_keys(resources))<>11 THEN RAISE EXCEPTION 'protected_inventory_scope_claim_invalid';END IF;
 IF result::text LIKE '%SYNTHETIC_PRIVATE%' OR result::text LIKE '%SYNTHETIC_NOT_%' OR result::text LIKE '%FOREIGN_MUST_NOT_APPEAR%' OR result::text LIKE '%foreign-must-not-appear%' OR result::text LIKE '%'||foreign_key_id::text||'%' OR result::text LIKE '%'||vault_id::text||'%' OR result::text LIKE '%'||subject::text||'%' THEN RAISE EXCEPTION 'protected_inventory_secret_or_cross_tenant_disclosure';END IF;
 IF result::text ~ '"(key_hash|key_prefix|prefix|secret_sha256|token_sha256|token_secret_ref|cursor_ref|last_error|auth_user_id|secret_id|access_token_ciphertext|refresh_token_ciphertext|trusted_memory|approved_emails)"' THEN RAISE EXCEPTION 'protected_inventory_forbidden_field_projected';END IF;
 FOR r IN SELECT value FROM jsonb_each(resources) LOOP
  IF r->>'generic_restore_permitted'<>'false' THEN RAISE EXCEPTION 'protected_inventory_restore_permission_invented';END IF;
 END LOOP;
 IF resources->'sandy_operations_keys'->>'total_count'<>'2'
 OR resources->'sandy_context_api_grants'->>'total_count'<>'1'
 OR resources->'sandy_calendar_connections'->>'total_count'<>'1'
 OR resources->'sandy_xero_connections'->>'total_count'<>'1'
 OR resources->'sandy_voice_call_links'->>'total_count'<>'1'
 OR resources->'sandy_supabase_tenant_consents'->>'total_count'<>'1'
 OR resources->'sandy_supabase_tenant_controls'->>'total_count'<>'1'
 OR resources->'sandy_supabase_managed_vault'->>'total_count'<>'1'
 THEN RAISE EXCEPTION 'protected_inventory_exact_owned_counts_failed';END IF;
 IF resources->'sandy_context_api_grants'->'items'->0->>'active'<>'true'
 OR resources->'sandy_voice_call_links'->'items'->0->>'revoked_at' IS NULL
 OR resources->'sandy_supabase_tenant_controls'->'items'->0->>'legal_hold'<>'true'
 OR resources->'sandy_xero_connections'->'items'->0->>'status'<>'disconnected'
 OR resources->'sandy_supabase_tenant_consents'->'items'->0->'operations' IS DISTINCT FROM to_jsonb(ARRAY[op_name,'supabase.tenant.exports.get'])
 THEN RAISE EXCEPTION 'protected_inventory_actual_scope_expiry_revocation_or_hold_not_reported';END IF;
 FOR r IN SELECT resources->x FROM unnest(ARRAY['sandy_api_keys','sandy_api_credentials','sandy_computer_api_grants'])x LOOP
  IF r->>'status'<>'ownership_mapping_unavailable' OR r->'total_count'<>'null'::jsonb OR r->'items'<>'[]'::jsonb THEN RAISE EXCEPTION 'unmapped_uuid_coincidence_adopted_as_customer_credentials';END IF;
 END LOOP;
 result:=pg_temp.protected_inventory_call(args||'{"limit":1}'::jsonb);
 IF result->'resources'->'sandy_operations_keys'->>'next_offset'<>'1' OR jsonb_array_length(result->'resources'->'sandy_operations_keys'->'items')<>1 THEN RAISE EXCEPTION 'protected_inventory_first_page_invalid';END IF;
 r:=pg_temp.protected_inventory_call(args||'{"offset":1,"limit":1}'::jsonb);
 IF r->'resources'->'sandy_operations_keys'->'next_offset'<>'null'::jsonb OR jsonb_array_length(r->'resources'->'sandy_operations_keys'->'items')<>1 OR r->'resources'->'sandy_operations_keys'->'items' IS NOT DISTINCT FROM result->'resources'->'sandy_operations_keys'->'items' THEN RAISE EXCEPTION 'protected_inventory_continuation_invalid';END IF;
 r:=pg_temp.protected_inventory_call(args||'{"offset":1000,"limit":1}'::jsonb);
 IF r->'resources'->'sandy_operations_keys'->>'total_count'<>'2' OR r->'resources'->'sandy_operations_keys'->'items'<>'[]'::jsonb OR r->'resources'->'sandy_operations_keys'->'next_offset'<>'null'::jsonb THEN RAISE EXCEPTION 'protected_inventory_empty_page_falsified_total';END IF;
 SELECT auth_user_id INTO actor FROM public.sandy_controller_admins WHERE role='owner' AND enabled ORDER BY created_at LIMIT 1;
 admission:=pg_temp.sandy_owner_component_admission(op_name,args,scope_sha);
 refused:=false;BEGIN PERFORM public.sandy_tenant_protected_inventory(gen_random_uuid(),admission,args::text);EXCEPTION WHEN OTHERS THEN IF SQLERRM<>'tenant_lifecycle_scoped_owner_admission_required' THEN RAISE;END IF;refused:=true;END;
 IF NOT refused THEN RAISE EXCEPTION 'protected_inventory_owner_proof_missing';END IF;
 refused:=false;BEGIN PERFORM public.sandy_tenant_protected_inventory(actor,admission,(args||jsonb_build_object('tenant_id',foreign_tenant))::text);EXCEPTION WHEN OTHERS THEN IF SQLERRM<>'tenant_lifecycle_scoped_owner_admission_required' THEN RAISE;END IF;refused:=true;END;
 IF NOT refused THEN RAISE EXCEPTION 'protected_inventory_canonical_binding_missing';END IF;
 UPDATE public.sandy_supabase_tenant_consents SET operations=ARRAY[]::text[] WHERE tenant_id=tenant;
 refused:=false;BEGIN PERFORM public.sandy_tenant_protected_inventory(actor,admission,args::text);EXCEPTION WHEN OTHERS THEN IF SQLERRM<>'tenant_lifecycle_explicit_consent_required' THEN RAISE;END IF;refused:=true;END;
 IF NOT refused THEN RAISE EXCEPTION 'protected_inventory_exact_operation_consent_missing';END IF;
 UPDATE public.sandy_supabase_tenant_consents SET operations=ARRAY[op_name,'supabase.tenant.exports.get'],expires_at=clock_timestamp()-interval '1 second' WHERE tenant_id=tenant;
 refused:=false;BEGIN PERFORM public.sandy_tenant_protected_inventory(actor,admission,args::text);EXCEPTION WHEN OTHERS THEN IF SQLERRM<>'tenant_lifecycle_explicit_consent_required' THEN RAISE;END IF;refused:=true;END;
 IF NOT refused THEN RAISE EXCEPTION 'protected_inventory_expired_consent_accepted';END IF;
 UPDATE public.sandy_supabase_tenant_consents SET expires_at=clock_timestamp()+interval '1 hour' WHERE tenant_id=tenant;
 UPDATE public.sandy_operation_registry SET verified=false WHERE sandy_operation_registry.operation=op_name;
 refused:=false;BEGIN PERFORM public.sandy_tenant_protected_inventory(actor,admission,args::text);EXCEPTION WHEN OTHERS THEN IF SQLERRM<>'tenant_lifecycle_current_verified_contract_required' THEN RAISE;END IF;refused:=true;END;
 IF NOT refused THEN RAISE EXCEPTION 'protected_inventory_unverified_registry_accepted';END IF;
 UPDATE public.sandy_operation_registry SET verified=true WHERE sandy_operation_registry.operation=op_name;
 refused:=false;BEGIN PERFORM pg_temp.protected_inventory_call(args||'{"table":"auth.users"}'::jsonb);EXCEPTION WHEN OTHERS THEN IF SQLERRM<>'tenant_inventory_arguments_or_operation_invalid' THEN RAISE;END IF;refused:=true;END;
 IF NOT refused THEN RAISE EXCEPTION 'protected_inventory_arbitrary_relation_accepted';END IF;
 refused:=false;BEGIN PERFORM pg_temp.protected_inventory_call(args||'{"limit":51}'::jsonb);EXCEPTION WHEN OTHERS THEN IF SQLERRM<>'tenant_inventory_arguments_or_operation_invalid' THEN RAISE;END IF;refused:=true;END;
 IF NOT refused THEN RAISE EXCEPTION 'protected_inventory_page_bound_ignored';END IF;
 admission:=pg_temp.sandy_owner_component_admission('supabase.tenant.exports.get',args,scope_sha);
 refused:=false;BEGIN PERFORM public.sandy_tenant_protected_inventory(actor,admission,args::text);EXCEPTION WHEN OTHERS THEN IF SQLERRM<>'tenant_inventory_arguments_or_operation_invalid' THEN RAISE;END IF;refused:=true;END;
 IF NOT refused THEN RAISE EXCEPTION 'protected_inventory_other_operation_admission_accepted';END IF;
 -- A read must still carry the immutable scoped owner approval. The shared
 -- admission table can represent ordinary unapproved reads; this one refuses it.
 INSERT INTO public.sandy_api_execution_admissions(id,actor_id,operation,request_id,is_mutation,input_sha256,contract_sha256,scope_sha256,registry_revision_sha256,declared_cost_units,state,expires_at)
 SELECT gen_random_uuid(),actor,op_name,gen_random_uuid(),false,encode(extensions.digest(args::text,'sha256'),'hex'),entry.error_contract->>'contract_sha256',scope_sha,public.sandy_api_registry_revision(op_name),0,'consumed',clock_timestamp()+interval '60 seconds'
 FROM public.sandy_operation_registry entry WHERE entry.operation=op_name RETURNING id INTO admission;
 refused:=false;BEGIN PERFORM public.sandy_tenant_protected_inventory(actor,admission,args::text);EXCEPTION WHEN OTHERS THEN IF SQLERRM<>'tenant_lifecycle_scoped_owner_admission_required' THEN RAISE;END IF;refused:=true;END;
 IF NOT refused THEN RAISE EXCEPTION 'protected_inventory_unapproved_read_accepted';END IF;
 -- No owned resource or credential state is changed by inventory execution.
 IF NOT EXISTS(SELECT 1 FROM public.sandy_operations_keys WHERE id=key_id AND key_hash=key_material AND revoked_at IS NULL)
 OR NOT EXISTS(SELECT 1 FROM public.sandy_supabase_tenant_controls WHERE tenant_id=tenant AND legal_hold AND retention_until>clock_timestamp())
 OR NOT EXISTS(SELECT 1 FROM public.sandy_context_api_grants WHERE id=context_id AND active)
 OR NOT EXISTS(SELECT 1 FROM public.sandy_supabase_managed_vault WHERE tenant_id=tenant AND secret_id=vault_id)
 OR EXISTS(SELECT 1 FROM vault.secrets WHERE id=vault_id)
 OR NOT EXISTS(SELECT 1 FROM public.sandy_voice_call_links WHERE id=voice_id AND trusted_memory AND revoked_at IS NOT NULL)
 THEN RAISE EXCEPTION 'protected_inventory_changed_credentials_or_controls';END IF;
END $test$;
SELECT jsonb_build_object('passed',true,'layer','administrative_database_component','fixtures','always_rolled_back','real_auth_session_tested',false,'real_owner_approval_tested',false,'owner_membership_changed',false,'external_provider_called',false,'credential_or_session_issued',false,'reviewed_resource_classes',11,'populated_exact_customer_projections',8,'unmapped_credential_namespaces',3,'complete_tenant_coverage',false,
 'checks',jsonb_build_array('service_only_primitive_acl','private_capture_acl','default_disabled_unverified_sensitive_read','exact_customer_and_owner_filters','eight_populated_projections','actual_scopes_and_revocation_expiry_metadata','held_tenant_read_without_hold_change','unknown_unmapped_counts','UUID_coincidence_not_ownership','no_hash_ciphertext_vaultref_Authid_or_externalaccount_projection','no_cross_customer_rows','explicit_pagination_and_total_counts','empty_page_preserves_total_count','current_owner_bound_admission','canonical_tenant_binding','current_exact_operation_consent','expired_consent_refused','current_verified_registry_required','arbitrary_relation_refused','page_bound_refused','other_operation_admission_refused','unapproved_sensitive_read_refused','no_credential_or_control_mutation','no_Vault_secret_access')) AS evidence;
ROLLBACK;
