-- Administrative PostgreSQL/Vault fixtures only; not Auth or provider evidence.
BEGIN;
DO $test$
<<fixture>>
DECLARE actor uuid:=gen_random_uuid(); actor2 uuid:=gen_random_uuid(); admission uuid:=gen_random_uuid(); next_admission uuid:=gen_random_uuid();
 approval uuid:=gen_random_uuid(); approval2 uuid:=gen_random_uuid(); saved uuid; secret_id uuid; receipt jsonb; value jsonb; context jsonb; changed jsonb;
 payload text:='SYNTHETIC-PRIVATE-CURSOR-NOT-A-CREDENTIAL'; encoded text; sha text; denied boolean; op text:='gcp.projects.search_filtered';
BEGIN
 IF EXISTS(SELECT 1 FROM public.sandy_operation_registry WHERE handler='sandy-provider-supplement-api' AND (api_exposed OR ai_exposed OR ui_exposed OR verified
 OR error_contract->>'requires_approval' IS DISTINCT FROM 'true' OR error_contract->>'api_key_delegable' IS DISTINCT FROM 'false'))
 OR (SELECT count(*) FROM public.sandy_operation_registry WHERE handler='sandy-provider-supplement-api')<>28 THEN RAISE EXCEPTION 'supplement_closed_registry_mismatch'; END IF;
 IF EXISTS(SELECT 1 FROM pg_temp.supplement_registry_before b LEFT JOIN public.sandy_operation_registry r USING(operation) WHERE to_jsonb(r) IS DISTINCT FROM b.snapshot)
 THEN RAISE EXCEPTION 'existing_registry_row_changed'; END IF;
 IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid='public.sandy_provider_supplement_opaque'::regclass)
 OR has_table_privilege('service_role','public.sandy_provider_supplement_opaque','SELECT')
 OR has_table_privilege('authenticated','public.sandy_provider_supplement_opaque','SELECT')
 OR has_function_privilege('anon','public.sandy_provider_supplement_save_opaque(jsonb)','EXECUTE')
 OR has_function_privilege('authenticated','public.sandy_provider_supplement_take_opaque(jsonb,uuid)','EXECUTE')
 OR has_function_privilege('service_role','public.sandy_provider_supplement_context(jsonb)','EXECUTE')
 OR NOT has_function_privilege('service_role','public.sandy_provider_supplement_save_opaque(jsonb)','EXECUTE')
 THEN RAISE EXCEPTION 'supplement_acl_mismatch'; END IF;
 INSERT INTO public.sandy_controller_admins(auth_user_id,role,enabled) VALUES(actor,'owner',true),(actor2,'owner',true);
 INSERT INTO public.sandy_deployment_jobs(id,requested_by,provider,operation,target,idempotency_key,status)
 VALUES(approval,'supplement_rollback_only','google_cloud','get_vm','synthetic-no-provider',approval::text,'pending_approval'),
 (approval2,'supplement_rollback_only','google_cloud','get_vm','synthetic-no-provider',approval2::text,'pending_approval');
 -- No real approval is minted or consumed. These direct private rows exercise
 -- SQL linkage invariants inside a transaction that always rolls back.
 UPDATE public.sandy_operation_registry SET api_exposed=true,verified=true WHERE operation=op;
 INSERT INTO public.sandy_api_execution_admissions(id,actor_id,operation,request_id,is_mutation,input_sha256,contract_sha256,scope_sha256,registry_revision_sha256,declared_cost_units,state,expires_at,approval_id)
 VALUES(admission,actor,op,gen_random_uuid(),false,repeat('a',64),repeat('b',64),repeat('c',64),public.sandy_api_registry_revision(op),0,'consumed',clock_timestamp()+interval '5 minutes',approval),
 (next_admission,actor,op,gen_random_uuid(),false,repeat('d',64),repeat('b',64),repeat('c',64),public.sandy_api_registry_revision(op),0,'consumed',clock_timestamp()+interval '5 minutes',approval2);
 encoded:=encode(convert_to(payload,'UTF8'),'base64'); sha:=encode(extensions.digest(convert_to(payload,'UTF8'),'sha256'),'hex');
 context:=jsonb_build_object('actor',actor,'admission',admission,'operation',op,'scope_sha256',repeat('c',64),'input_sha256',repeat('a',64),
 'binding_sha256',repeat('e',64),'target','https://cloudresourcemanager.googleapis.com/v3/projects:search?query=projectId%3Aelaborate-haven-511518-a5&pageSize=100',
 'kind','cursor','payload_base64',encoded,'payload_sha256',sha,'byte_length',octet_length(payload),'media_type','application/x-sandy-provider-cursor');
 denied:=false; BEGIN PERFORM public.sandy_provider_supplement_save_opaque(context||jsonb_build_object('actor',actor2)); EXCEPTION WHEN OTHERS THEN denied:=SQLERRM='supplement_consumed_owner_admission_required'; END;
 IF NOT denied THEN RAISE EXCEPTION 'supplement_foreign_actor_accepted'; END IF;
 denied:=false; BEGIN PERFORM public.sandy_provider_supplement_save_opaque(context||'{"target":"https://attacker.invalid"}'); EXCEPTION WHEN OTHERS THEN denied:=SQLERRM='supplement_fixed_resource_required'; END;
 IF NOT denied THEN RAISE EXCEPTION 'supplement_arbitrary_url_accepted'; END IF;
 denied:=false; BEGIN PERFORM public.sandy_provider_supplement_save_opaque(context||jsonb_build_object('payload_sha256',repeat('f',64))); EXCEPTION WHEN OTHERS THEN denied:=SQLERRM='supplement_payload_integrity_failed'; END;
 IF NOT denied THEN RAISE EXCEPTION 'supplement_wrong_digest_accepted'; END IF;
 receipt:=public.sandy_provider_supplement_save_opaque(context); saved:=(receipt->>'custody_id')::uuid;
 IF receipt ? 'payload_base64' OR receipt ? 'target' OR receipt->>'sha256' IS DISTINCT FROM sha OR (receipt->>'byte_length')::integer<>octet_length(payload)
 THEN RAISE EXCEPTION 'supplement_public_receipt_invalid'; END IF;
 SELECT vault_secret_id INTO secret_id FROM public.sandy_provider_supplement_opaque WHERE id=saved;
 IF (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE id=secret_id) IS DISTINCT FROM encoded
 OR (SELECT secret FROM vault.secrets WHERE id=secret_id) IS NOT DISTINCT FROM encoded THEN RAISE EXCEPTION 'supplement_dummy_vault_encryption_failed'; END IF;
 denied:=false; BEGIN PERFORM public.sandy_provider_supplement_save_opaque(context); EXCEPTION WHEN OTHERS THEN denied:=SQLERRM='supplement_admission_already_captured'; END;
 IF NOT denied THEN RAISE EXCEPTION 'supplement_duplicate_capture_accepted'; END IF;
 changed:=(context-'payload_base64'-'payload_sha256'-'byte_length'-'media_type')||jsonb_build_object('admission',next_admission,'input_sha256',repeat('d',64));
 denied:=false; BEGIN PERFORM public.sandy_provider_supplement_take_opaque(changed||jsonb_build_object('binding_sha256',repeat('f',64)),saved); EXCEPTION WHEN OTHERS THEN denied:=SQLERRM='supplement_opaque_binding_expired_or_used'; END;
 IF NOT denied THEN RAISE EXCEPTION 'supplement_different_arguments_accepted'; END IF;
 UPDATE public.sandy_controller_admins SET enabled=false WHERE auth_user_id=actor;
 denied:=false; BEGIN PERFORM public.sandy_provider_supplement_take_opaque(changed,saved); EXCEPTION WHEN OTHERS THEN denied:=SQLERRM='supplement_consumed_owner_admission_required'; END;
 IF NOT denied THEN RAISE EXCEPTION 'supplement_revoked_owner_accepted'; END IF;
 UPDATE public.sandy_controller_admins SET enabled=true WHERE auth_user_id=actor;
 UPDATE public.sandy_provider_supplement_opaque SET expires_at=clock_timestamp()-interval '1 second',created_at=clock_timestamp()-interval '6 minutes' WHERE id=saved;
 denied:=false; BEGIN PERFORM public.sandy_provider_supplement_take_opaque(changed,saved); EXCEPTION WHEN OTHERS THEN denied:=SQLERRM='supplement_opaque_binding_expired_or_used'; END;
 IF NOT denied THEN RAISE EXCEPTION 'supplement_expired_handle_accepted'; END IF;
 UPDATE public.sandy_provider_supplement_opaque SET expires_at=clock_timestamp()+interval '2 minutes',created_at=clock_timestamp() WHERE id=saved;
 value:=public.sandy_provider_supplement_take_opaque(changed,saved);
 IF value->>'payload_base64' IS DISTINCT FROM encoded OR value->>'sha256' IS DISTINCT FROM sha THEN RAISE EXCEPTION 'supplement_private_cursor_readback_failed'; END IF;
 denied:=false; BEGIN PERFORM public.sandy_provider_supplement_take_opaque(changed,saved); EXCEPTION WHEN OTHERS THEN denied:=SQLERRM='supplement_opaque_binding_expired_or_used'; END;
 IF NOT denied THEN RAISE EXCEPTION 'supplement_used_handle_replayed'; END IF;
 PERFORM public.sandy_provider_supplement_cleanup_opaque();
 IF EXISTS(SELECT 1 FROM public.sandy_provider_supplement_opaque WHERE id=saved) OR EXISTS(SELECT 1 FROM vault.secrets WHERE id=secret_id) THEN RAISE EXCEPTION 'supplement_cleanup_failed'; END IF;
END $test$;
SELECT jsonb_build_object('passed',true,'layer','administrative_registry_vault_component','checks',18,
 'new_closed_operations',28,'original_registry_unchanged_before_fixture',true,'provider_called',false,
 'auth_session_tested',false,'real_approval_tested',false,'all_changes_rolled_back',true) AS evidence;
ROLLBACK;
