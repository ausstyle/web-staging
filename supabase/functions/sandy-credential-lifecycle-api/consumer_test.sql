-- Administrative PostgreSQL component checks with disposable noncredential
-- strings and synthetic private records. No Auth session, provider request or
-- production approval is exercised. The entire fixture always rolls back.
BEGIN;
DO $consumer_test$
<<consumer_test>>
DECLARE actor uuid:=gen_random_uuid(); target_id uuid:=gen_random_uuid(); version_id uuid:=gen_random_uuid();
 admission_id uuid:=gen_random_uuid(); proof_id uuid:=gen_random_uuid(); rotation_id uuid:=gen_random_uuid(); approval_id uuid:=gen_random_uuid();
 vault_id uuid; response jsonb; evidence jsonb; canonical text; refused boolean;
 op text:='supabase.consumer_fixture.read'; fixture text:='SYNTHETIC-CONSUMER-FIXTURE-NOT-A-CREDENTIAL'; sha text;
BEGIN
 IF has_function_privilege('anon','public.sandy_credential_resolve_consumer(text,uuid,uuid,text)','EXECUTE')
 OR has_function_privilege('authenticated','public.sandy_credential_resolve_consumer(text,uuid,uuid,text)','EXECUTE')
 OR NOT has_function_privilege('service_role','public.sandy_credential_resolve_consumer(text,uuid,uuid,text)','EXECUTE')
 OR has_function_privilege('service_role','public.sandy_credential_consumer_target_matches(text,public.sandy_credential_targets)','EXECUTE')
 OR has_table_privilege('service_role','public.sandy_credential_consumer_bindings','UPDATE')
 OR has_table_privilege('authenticated','public.sandy_credential_consumer_access','SELECT') THEN RAISE EXCEPTION 'consumer_acl_invalid'; END IF;
 IF EXISTS(SELECT 1 FROM public.sandy_credential_consumer_bindings) THEN RAISE EXCEPTION 'consumer_fixture_requires_empty_new_bindings'; END IF;
 refused:=false;
 BEGIN PERFORM public.sandy_credential_resolve_consumer('supabase_management',actor,admission_id,op); EXCEPTION WHEN OTHERS THEN IF SQLERRM<>'consumer_scoped_admission_required' THEN RAISE; END IF;refused:=true;END;
 IF NOT refused THEN RAISE EXCEPTION 'consumer_unbound_admission_accepted'; END IF;
 INSERT INTO public.sandy_controller_admins(auth_user_id,role,enabled) VALUES(actor,'owner',true);
 INSERT INTO public.sandy_operation_registry(operation,domain,description,handler,permission_scope,is_mutation,input_schema,output_schema,api_exposed,verified,error_contract)
 VALUES(op,'supabase','Rollback-only private consumer component fixture','sandy-provider-operation-api','infrastructure:read',false,'{"type":"object"}','{"type":"object"}',true,true,'{"api_key_delegable":true}');
 INSERT INTO public.sandy_api_execution_admissions(id,actor_id,operation,request_id,is_mutation,input_sha256,contract_sha256,scope_sha256,registry_revision_sha256,declared_cost_units,state,expires_at)
 VALUES(admission_id,actor,op,gen_random_uuid(),false,repeat('a',64),repeat('b',64),repeat('c',64),public.sandy_api_registry_revision(op),0,'consumed',clock_timestamp()+interval '5 minutes');
 response:=public.sandy_credential_resolve_consumer('supabase_management',actor,admission_id,op);
 IF response->>'source'<>'existing_configuration' OR response->'active_version_id'<>'null'::jsonb OR response ? 'value' THEN RAISE EXCEPTION 'consumer_legacy_decision_invalid'; END IF;
 UPDATE public.sandy_operation_registry SET api_exposed=false WHERE operation=op;
 refused:=false;
 BEGIN PERFORM public.sandy_credential_resolve_consumer('supabase_management',actor,admission_id,op); EXCEPTION WHEN OTHERS THEN IF SQLERRM<>'consumer_current_contract_required' THEN RAISE; END IF;refused:=true;END;
 IF NOT refused THEN RAISE EXCEPTION 'consumer_changed_contract_accepted'; END IF;
 UPDATE public.sandy_operation_registry SET api_exposed=true WHERE operation=op;
 refused:=false;
 BEGIN PERFORM public.sandy_credential_resolve_consumer('github_api',actor,admission_id,op); EXCEPTION WHEN OTHERS THEN IF SQLERRM<>'consumer_provider_scope_mismatch' THEN RAISE; END IF;refused:=true;END;
 IF NOT refused THEN RAISE EXCEPTION 'consumer_cross_provider_key_accepted'; END IF;
 INSERT INTO public.sandy_credential_targets(id,provider,resource,config_sha256,scope_sha256,enabled,verified)
 VALUES(target_id,'supabase_edge_secret','{"secret_name":"SANDY_SUPABASE_MANAGEMENT_TOKEN"}',repeat('d',64),repeat('e',64),true,true);
 INSERT INTO public.sandy_credential_consumer_bindings(consumer,target_id,target_config_sha256) VALUES('supabase_management',target_id,repeat('d',64));
 response:=public.sandy_credential_resolve_consumer('supabase_management',actor,admission_id,op);
 IF response->>'source'<>'existing_configuration' THEN RAISE EXCEPTION 'consumer_unused_pointer_changed_legacy'; END IF;
 vault_id:=vault.create_secret(fixture,'SANDY_CONSUMER_ROLLBACK_'||gen_random_uuid()::text,'Disposable rollback-only encryption fixture');
 sha:=encode(extensions.digest(fixture,'sha256'),'hex');
 INSERT INTO public.sandy_credential_versions(id,target_id,vault_secret_id,material_sha256,state,source_admission_id) VALUES(version_id,target_id,vault_id,sha,'active',admission_id);
 UPDATE public.sandy_credential_targets SET active_version_id=version_id WHERE id=target_id;
 refused:=false;
 BEGIN PERFORM public.sandy_credential_resolve_consumer('supabase_management',actor,admission_id,op); EXCEPTION WHEN OTHERS THEN IF SQLERRM<>'consumer_active_binding_refused' THEN RAISE; END IF;refused:=true;END;
 IF NOT refused THEN RAISE EXCEPTION 'consumer_disabled_binding_fell_back'; END IF;
 UPDATE public.sandy_credential_consumer_bindings SET enabled=true,verified=true WHERE consumer='supabase_management';
 refused:=false;
 BEGIN PERFORM public.sandy_credential_resolve_consumer('supabase_management',actor,admission_id,op); EXCEPTION WHEN OTHERS THEN IF SQLERRM<>'consumer_active_readback_required' THEN RAISE; END IF;refused:=true;END;
 IF NOT refused THEN RAISE EXCEPTION 'consumer_unattested_key_accepted'; END IF;
 -- Synthetic private rows test linkage and digest invariants only. The pending
 -- job is deliberately not a real approved engineering change/provider test.
 INSERT INTO public.sandy_deployment_jobs(id,requested_by,provider,operation,target,idempotency_key,status)
 VALUES(approval_id,'consumer_rollback_fixture','google_cloud','get_vm','consumer-rollback-no-provider',approval_id::text,'pending_approval');
 evidence:=jsonb_build_object('rotation_id',rotation_id,'target_id',target_id,'target_config_sha256',repeat('d',64),'material_sha256',sha,'provider_verified',true);
 canonical:=evidence::text;
 INSERT INTO public.sandy_api_execution_admissions(id,actor_id,operation,request_id,is_mutation,input_sha256,contract_sha256,scope_sha256,registry_revision_sha256,declared_cost_units,state,expires_at,approval_id,result_sha256,finished_at)
 VALUES(proof_id,actor,'system.credentials.provider.verify',gen_random_uuid(),false,repeat('f',64),repeat('0',64),repeat('e',64),repeat('1',64),0,'succeeded',clock_timestamp()+interval '5 minutes',approval_id,encode(extensions.digest(canonical,'sha256'),'hex'),clock_timestamp());
 INSERT INTO public.sandy_credential_rotations(id,target_id,actor_id,source_admission_id,source_operation,staged_version_id,target_config_sha256,state,verification_admission_id,verification_evidence,verification_canonical)
 VALUES(rotation_id,target_id,actor,admission_id,'system.credentials.provider.adopt',version_id,repeat('d',64),'activated',proof_id,evidence,canonical);
 UPDATE public.sandy_api_execution_admissions SET result_sha256=repeat('0',64) WHERE id=proof_id;
 refused:=false;
 BEGIN PERFORM public.sandy_credential_resolve_consumer('supabase_management',actor,admission_id,op); EXCEPTION WHEN OTHERS THEN IF SQLERRM<>'consumer_active_readback_required' THEN RAISE; END IF;refused:=true;END;
 IF NOT refused THEN RAISE EXCEPTION 'consumer_changed_proof_digest_accepted'; END IF;
 UPDATE public.sandy_api_execution_admissions SET result_sha256=encode(extensions.digest(canonical,'sha256'),'hex') WHERE id=proof_id;
 response:=public.sandy_credential_resolve_consumer('supabase_management',actor,admission_id,op);
 IF response->>'source'<>'vault_active' OR response->>'value'<>fixture OR response->>'active_version_id'<>version_id::text THEN RAISE EXCEPTION 'consumer_fixture_read_invalid'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.sandy_credential_consumer_access receipt WHERE receipt.admission_id=consumer_test.admission_id AND receipt.consumer='supabase_management' AND receipt.version_id=consumer_test.version_id AND receipt.material_sha256=sha) THEN RAISE EXCEPTION 'consumer_digest_access_receipt_missing'; END IF;
 -- Stable repeat can read the same private material, but cannot cross a pointer
 -- change or a finished admission and never causes an external dispatch here.
 response:=public.sandy_credential_resolve_consumer('supabase_management',actor,admission_id,op);
 UPDATE public.sandy_credential_targets SET config_sha256=repeat('2',64) WHERE id=target_id;
 refused:=false;
 BEGIN PERFORM public.sandy_credential_resolve_consumer('supabase_management',actor,admission_id,op); EXCEPTION WHEN OTHERS THEN IF SQLERRM<>'consumer_active_binding_refused' THEN RAISE; END IF;refused:=true;END;
 IF NOT refused THEN RAISE EXCEPTION 'consumer_changed_scope_fell_back'; END IF;
 UPDATE public.sandy_credential_targets SET config_sha256=repeat('d',64),active_version_id=NULL WHERE id=target_id;
 refused:=false;
 BEGIN PERFORM public.sandy_credential_resolve_consumer('supabase_management',actor,admission_id,op); EXCEPTION WHEN OTHERS THEN IF SQLERRM<>'consumer_active_pointer_removed' THEN RAISE; END IF;refused:=true;END;
 IF NOT refused THEN RAISE EXCEPTION 'consumer_removed_pointer_fell_back'; END IF;
 UPDATE public.sandy_api_execution_admissions SET state='succeeded' WHERE id=admission_id;
 refused:=false;
 BEGIN PERFORM public.sandy_credential_resolve_consumer('supabase_management',actor,admission_id,op); EXCEPTION WHEN OTHERS THEN IF SQLERRM<>'consumer_scoped_admission_required' THEN RAISE; END IF;refused:=true;END;
 IF NOT refused THEN RAISE EXCEPTION 'consumer_completed_grant_reused'; END IF;
END $consumer_test$;
SELECT jsonb_build_object('passed',true,'layer','administrative_database_component','fixtures','rolled_back','provider_called',false,'auth_session_tested',false,'real_mutation_approval_tested',false,'checks',jsonb_build_array('service_only_acl','consumed_admission','current_owner_contract','changed_contract_refusal','cross_provider_refusal','legacy_only_without_cutover','active_binding_denial','real_vault_dummy_read','changed_proof_digest_refusal','digest_proof_link','no_scope_fallback','no_removed_pointer_fallback','finished_grant_refusal')) AS evidence;
ROLLBACK;
