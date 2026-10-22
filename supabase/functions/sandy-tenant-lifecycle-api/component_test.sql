-- Administrative PostgreSQL tests, not real Auth/session/approval tests.
-- All data is synthetic. No Controller membership or external provider action.
-- Include the shared component fixture; all fixture changes always roll back.
BEGIN;
-- SHARED_OWNER_COMPONENT_FIXTURE
CREATE FUNCTION pg_temp.lifecycle_call(p_operation text,p_args jsonb) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE actor uuid;admission uuid;answer jsonb;
BEGIN
 SELECT auth_user_id INTO actor FROM public.sandy_controller_admins WHERE role='owner' AND enabled ORDER BY created_at LIMIT 1;
 admission:=pg_temp.sandy_owner_component_admission(p_operation,p_args,'f409867ca7bb8103d66fcfc4bdbc10fc5c8fc2a5849cd15b5ba3ba79d6d128a9');
 answer:=public.sandy_tenant_lifecycle_execute(actor,admission,p_args::text);
 IF answer->>'ok'<>'true' THEN RAISE EXCEPTION 'lifecycle_component_dispatch_failed';END IF;
 IF public.sandy_tenant_lifecycle_execute(actor,admission,p_args::text) IS DISTINCT FROM (answer||jsonb_build_object('reused',true)) THEN RAISE EXCEPTION 'lifecycle_component_idempotency_failed';END IF;
 RETURN answer->'result';
END $$;
DO $test$
<<fixture>>
DECLARE tenant uuid:=gen_random_uuid();subject uuid:=gen_random_uuid();foreign_tenant uuid:=gen_random_uuid();foreign_subject uuid:=gen_random_uuid();email text:='tenant-lifecycle-fixture-'||gen_random_uuid()::text||'@example.invalid';company uuid:=gen_random_uuid();person uuid:=gen_random_uuid();foreign_person uuid:=gen_random_uuid();foreign_fact uuid:=gen_random_uuid();connection uuid:=gen_random_uuid();task_id uuid:=gen_random_uuid();space_id uuid:=gen_random_uuid();goal_id uuid:=gen_random_uuid();area_key text;manifest jsonb:=public.sandy_tenant_manifest_v1();ops text[];args jsonb;metadata jsonb;snapshot_id uuid;foreign_snapshot uuid;export_sha text;empty_sha text;r jsonb;refused boolean;actor uuid;admission uuid;guard_name text;
BEGIN
 IF has_table_privilege('authenticated','public.sandy_tenant_export_snapshots','SELECT') OR has_table_privilege('service_role','public.sandy_tenant_export_snapshots','UPDATE')
 OR has_function_privilege('authenticated','public.sandy_tenant_lifecycle_execute(uuid,uuid,text)','EXECUTE') OR has_function_privilege('service_role','public.sandy_tenant_capture_v1(uuid)','EXECUTE')
 OR has_function_privilege('service_role','public.sandy_tenant_export_download(uuid)','EXECUTE') OR NOT has_function_privilege('authenticated','public.sandy_tenant_export_download(uuid)','EXECUTE') THEN RAISE EXCEPTION 'tenant_lifecycle_acl_invalid';END IF;
 IF public.sandy_tenant_manifest_schema_sha256() IS DISTINCT FROM manifest->>'schema_sha256' THEN RAISE EXCEPTION 'tenant_manifest_pin_mismatch';END IF;
 INSERT INTO auth.users(id,email,email_confirmed_at,created_at,updated_at,raw_app_meta_data,raw_user_meta_data) VALUES(subject,email,clock_timestamp(),clock_timestamp(),clock_timestamp(),'{}','{}'),(foreign_subject,'foreign-'||email,clock_timestamp(),clock_timestamp(),clock_timestamp(),'{}','{}');
 INSERT INTO public.email_customers(id) VALUES(tenant),(foreign_tenant);
 INSERT INTO public.email_customer_addresses(customer_id,email_address,is_primary) VALUES(tenant,email,true),(foreign_tenant,'foreign-'||email,true);
 INSERT INTO public.sandy_memory_portal_accounts(auth_user_id,customer_id) VALUES(subject,tenant),(foreign_subject,foreign_tenant);
 INSERT INTO public.sandy_agenda_companies(id,customer_id,name) VALUES(company,tenant,'SYNTHETIC LIFECYCLE COMPANY');
 INSERT INTO public.sandy_company_aliases(customer_id,company_id,alias) VALUES(tenant,company,'SYNTHETIC LINK');
 INSERT INTO public.sandy_social_people(id,customer_id,display_name) VALUES(person,tenant,'SYNTHETIC PERSON'),(foreign_person,foreign_tenant,'SYNTHETIC FOREIGN PERSON');
 INSERT INTO public.sandy_social_connections(id,customer_id,person_id,related_person_id,relationship,evidence_fact_id,verification_status) VALUES(connection,tenant,person,NULL,'SYNTHETIC RELATIONSHIP',NULL,'unverified');
 -- Native API-source completed fixture avoids the app's analyzed manual/
 -- agenda source kinds. No trigger is disabled; no parent is restored. Both
 -- analysis/mission queues are asserted empty for this synthetic task.
 SELECT a.area_key INTO area_key FROM public.sandy_life_areas a ORDER BY a.area_key LIMIT 1;
 IF area_key IS NULL THEN RAISE EXCEPTION 'component_shared_life_area_required';END IF;
 INSERT INTO public.sandy_life_spaces(id,owner_customer_id,space_key,title,space_kind) VALUES(space_id,tenant,'component-'||space_id::text,'SYNTHETIC COMPONENT SPACE','personal');
 INSERT INTO public.sandy_tasks(id,customer_id,title,status,source_kind,metadata) VALUES(task_id,tenant,'SYNTHETIC LIFECYCLE PARENT','completed','api','{}');
 INSERT INTO public.sandy_life_goals(id,customer_id,space_id,area_key,title) VALUES(goal_id,tenant,space_id,area_key,'SYNTHETIC COMPONENT GOAL');
 INSERT INTO public.sandy_task_pins(customer_id,task_id,position) VALUES(tenant,task_id,0);
 INSERT INTO public.sandy_agenda_attention(customer_id,task_id,reason,resolved_at) VALUES(tenant,task_id,'follow_up',clock_timestamp());
 INSERT INTO public.sandy_life_task_contexts(customer_id,task_id,space_id,area_key) VALUES(tenant,task_id,space_id,area_key);
 INSERT INTO public.sandy_life_goal_tasks(customer_id,goal_id,task_id) VALUES(tenant,goal_id,task_id);
 IF EXISTS(SELECT 1 FROM public.sandy_task_analysis_queue q WHERE q.task_id=fixture.task_id) OR EXISTS(SELECT 1 FROM public.sandy_mission_runs m WHERE m.mission_task_id=fixture.task_id) THEN RAISE EXCEPTION 'component_parent_would_schedule_work';END IF;

 UPDATE public.sandy_operation_registry SET api_exposed=true,verified=true WHERE handler='sandy-tenant-lifecycle-api' OR operation IN('supabase.tenant.consent.set','supabase.tenant.exports.download');
 SELECT array_agg(operation) INTO ops FROM public.sandy_operation_registry WHERE handler='sandy-tenant-lifecycle-api';
 PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',subject,'role','authenticated')::text,true);
 r:=public.sandy_supabase_tenant_consent_set(ops,ARRAY[]::text[],true,clock_timestamp()+interval '1 hour');
 IF r->>'ok'<>'true' THEN RAISE EXCEPTION 'lifecycle_consent_schema_extension_failed';END IF;
 args:=jsonb_build_object('tenant_id',tenant,'manifest',manifest->>'id','expected_manifest_sha256',manifest->>'manifest_sha256');
 -- Exact download field limit is accepted; one character beyond it is refused
 -- before snapshot/Vault creation, with no inaccessible artifact left behind.
 UPDATE public.sandy_company_aliases SET alias='x'||repeat(' ',9999) WHERE customer_id=tenant;
 r:=pg_temp.lifecycle_call('supabase.tenant.export',args);
 IF public.sandy_tenant_export_download((r->>'snapshot_id')::uuid)->'export'->'tables'->'sandy_company_aliases'->0->>'alias' IS DISTINCT FROM 'x'||repeat(' ',9999) THEN RAISE EXCEPTION 'text_boundary_payload_not_deliverable';END IF;
 UPDATE public.sandy_company_aliases SET alias='x'||repeat(' ',10000) WHERE customer_id=tenant;
 SELECT count(*)::text INTO guard_name FROM public.sandy_tenant_export_snapshots WHERE tenant_id=tenant;
 refused:=false;BEGIN PERFORM pg_temp.lifecycle_call('supabase.tenant.export',args);EXCEPTION WHEN OTHERS THEN IF SQLERRM<>'tenant_manifest_text_bound_exceeded' THEN RAISE;END IF;refused:=true;END;
 IF NOT refused OR (SELECT count(*)::text FROM public.sandy_tenant_export_snapshots WHERE tenant_id=tenant) IS DISTINCT FROM guard_name THEN RAISE EXCEPTION 'oversize_text_created_inaccessible_snapshot';END IF;
 UPDATE public.sandy_company_aliases SET alias='SYNTHETIC LINK' WHERE customer_id=tenant;
 metadata:=pg_temp.lifecycle_call('supabase.tenant.export',args);snapshot_id:=(metadata->>'snapshot_id')::uuid;export_sha:=metadata->>'snapshot_sha256';
 IF metadata->>'complete_tenant_coverage'<>'false' OR metadata->>'external_provider_assets_included'<>'false' OR metadata ? 'export' OR metadata ? 'value' OR metadata ? 'vault_secret_id' OR metadata::text LIKE '%SYNTHETIC LINK%' THEN RAISE EXCEPTION 'lifecycle_admin_payload_or_fullscope_disclosure';END IF;
 IF EXISTS(SELECT 1 FROM jsonb_each_text(metadata->'row_counts') e WHERE e.value<>'1') THEN RAISE EXCEPTION 'lifecycle_explicit_rows_not_captured';END IF;
 r:=public.sandy_tenant_export_download(snapshot_id);
 IF r->>'ok'<>'true' OR r->'export'->'tables'->'sandy_company_aliases'->0->>'alias'<>'SYNTHETIC LINK' OR r->'export'->'tables' ? 'sandy_operations_keys' THEN RAISE EXCEPTION 'actual_claim_private_delivery_projection_failed';END IF;
 PERFORM set_config('request.jwt.claims','{"role":"service_role"}',true);r:=public.sandy_tenant_export_download(snapshot_id);
 IF r->>'http_status'<>'403' THEN RAISE EXCEPTION 'admin_credential_substituted_for_customer_session';END IF;
 PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',foreign_subject,'role','authenticated')::text,true);r:=public.sandy_tenant_export_download(snapshot_id);
 IF r->>'http_status'<>'404' THEN RAISE EXCEPTION 'foreign_customer_download_allowed';END IF;
 PERFORM public.sandy_supabase_tenant_consent_set(ops,ARRAY[]::text[],true,clock_timestamp()+interval '1 hour');
 r:=pg_temp.lifecycle_call('supabase.tenant.export',jsonb_build_object('tenant_id',foreign_tenant,'manifest',manifest->>'id','expected_manifest_sha256',manifest->>'manifest_sha256'));foreign_snapshot:=(r->>'snapshot_id')::uuid;
 PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',subject,'role','authenticated')::text,true);
 refused:=false;BEGIN PERFORM pg_temp.lifecycle_call('supabase.tenant.exports.get',jsonb_build_object('tenant_id',tenant,'snapshot_id',foreign_snapshot));EXCEPTION WHEN OTHERS THEN IF SQLERRM<>'tenant_export_not_found' THEN RAISE;END IF;refused:=true;END;
 IF NOT refused THEN RAISE EXCEPTION 'cross_tenant_admin_snapshot_allowed';END IF;
 INSERT INTO public.email_ai_profile_facts(id,customer_id,category,fact_key,fact_value,confidence) VALUES(foreign_fact,foreign_tenant,'other','SYNTHETIC COMPONENT FACT','SYNTHETIC NONSENSITIVE FIXTURE','explicit');
 UPDATE public.sandy_social_connections SET evidence_fact_id=foreign_fact WHERE id=connection;
 refused:=false;BEGIN PERFORM pg_temp.lifecycle_call('supabase.tenant.export',args);EXCEPTION WHEN OTHERS THEN IF SQLERRM<>'tenant_social_link_parent_ownership_refused' THEN RAISE;END IF;refused:=true;END;
 IF NOT refused THEN RAISE EXCEPTION 'native_ID_only_FK_was_treated_as_tenant_proof';END IF;
 UPDATE public.sandy_social_connections SET evidence_fact_id=NULL WHERE id=connection;
 UPDATE public.sandy_company_aliases SET alias='CHANGED SYNTHETIC LINK' WHERE customer_id=tenant;
 refused:=false;BEGIN PERFORM pg_temp.lifecycle_call('supabase.tenant.erase',args||jsonb_build_object('snapshot_id',snapshot_id,'expected_current_sha256',export_sha,'confirm_manifest_erasure',true));EXCEPTION WHEN OTHERS THEN IF SQLERRM<>'tenant_manifest_current_state_changed' THEN RAISE;END IF;refused:=true;END;
 IF NOT refused THEN RAISE EXCEPTION 'stale_export_erasure_allowed';END IF;
 UPDATE public.sandy_company_aliases SET alias='SYNTHETIC LINK' WHERE customer_id=tenant;
 UPDATE public.sandy_supabase_tenant_controls SET legal_hold=true WHERE tenant_id=tenant;
 refused:=false;BEGIN PERFORM pg_temp.lifecycle_call('supabase.tenant.erase',args||jsonb_build_object('snapshot_id',snapshot_id,'expected_current_sha256',export_sha,'confirm_manifest_erasure',true));EXCEPTION WHEN OTHERS THEN IF SQLERRM<>'tenant_lifecycle_hold_or_retention_refused' THEN RAISE;END IF;refused:=true;END;
 IF NOT refused THEN RAISE EXCEPTION 'held_manifest_erased';END IF;
 UPDATE public.sandy_supabase_tenant_controls SET legal_hold=false,retention_until=clock_timestamp()+interval '1 day' WHERE tenant_id=tenant;
 refused:=false;BEGIN PERFORM pg_temp.lifecycle_call('supabase.tenant.erase',args||jsonb_build_object('snapshot_id',snapshot_id,'expected_current_sha256',export_sha,'confirm_manifest_erasure',true));EXCEPTION WHEN OTHERS THEN IF SQLERRM<>'tenant_lifecycle_hold_or_retention_refused' THEN RAISE;END IF;refused:=true;END;
 IF NOT refused THEN RAISE EXCEPTION 'retained_manifest_erased';END IF;
 UPDATE public.sandy_supabase_tenant_controls SET retention_until=NULL WHERE tenant_id=tenant;
 r:=pg_temp.lifecycle_call('supabase.tenant.erase',args||jsonb_build_object('snapshot_id',snapshot_id,'expected_current_sha256',export_sha,'confirm_manifest_erasure',true));empty_sha:=r->>'after_sha256';
 IF r->>'state'<>'erased' OR r->>'readback_verified'<>'true' OR EXISTS(SELECT 1 FROM public.sandy_company_aliases WHERE customer_id=tenant) OR EXISTS(SELECT 1 FROM public.sandy_social_connections WHERE customer_id=tenant)
 OR NOT EXISTS(SELECT 1 FROM public.sandy_agenda_companies WHERE id=company) OR NOT EXISTS(SELECT 1 FROM public.sandy_social_people WHERE id=person) THEN RAISE EXCEPTION 'manifest_erase_postcondition_or_parent_preservation_failed';END IF;
 INSERT INTO public.sandy_social_connections(id,customer_id,person_id,related_person_id,relationship,evidence_fact_id,verification_status) VALUES(connection,foreign_tenant,foreign_person,NULL,'FOREIGN ROLLBACK CONFLICT',NULL,'unverified');
 refused:=false;BEGIN PERFORM pg_temp.lifecycle_call('supabase.tenant.restore',args||jsonb_build_object('snapshot_id',snapshot_id,'expected_current_sha256',empty_sha,'confirm_manifest_restore',true));EXCEPTION WHEN unique_violation THEN refused:=true;END;
 IF NOT refused OR EXISTS(SELECT 1 FROM public.sandy_company_aliases WHERE customer_id=tenant) THEN RAISE EXCEPTION 'foreign_primary_key_conflict_not_transactional';END IF;
 DELETE FROM public.sandy_social_connections WHERE id=connection AND customer_id=foreign_tenant;
 r:=pg_temp.lifecycle_call('supabase.tenant.restore',args||jsonb_build_object('snapshot_id',snapshot_id,'expected_current_sha256',empty_sha,'confirm_manifest_restore',true));
 IF r->>'state'<>'restored' OR r->>'after_sha256'<>export_sha OR r->>'readback_verified'<>'true' OR (SELECT count(*) FROM public.sandy_company_aliases WHERE customer_id=tenant)<>1 OR (SELECT count(*) FROM public.sandy_social_connections WHERE customer_id=tenant)<>1 THEN RAISE EXCEPTION 'manifest_restore_exact_readback_failed';END IF;
 IF EXISTS(SELECT 1 FROM public.sandy_task_analysis_queue q WHERE q.task_id=fixture.task_id) OR EXISTS(SELECT 1 FROM public.sandy_mission_runs m WHERE m.mission_task_id=fixture.task_id) THEN RAISE EXCEPTION 'manifest_restore_scheduled_parent_work';END IF;
 UPDATE public.sandy_tenant_export_snapshots SET expires_at=clock_timestamp()-interval '1 second' WHERE id=snapshot_id;
 r:=public.sandy_tenant_export_download(snapshot_id);IF r->>'http_status'<>'410' THEN RAISE EXCEPTION 'expired_artifact_delivered';END IF;
 r:=pg_temp.lifecycle_call('supabase.tenant.exports.purge',jsonb_build_object('tenant_id',tenant,'snapshot_id',snapshot_id,'confirm_artifact_purge',true));
 IF r->>'state'<>'purged' OR r->>'readback_verified'<>'true' OR EXISTS(SELECT 1 FROM vault.secrets WHERE name='sandy_tenant_export_v1_'||snapshot_id::text) THEN RAISE EXCEPTION 'encrypted_artifact_purge_not_verified';END IF;
 -- Row bounds fail closed, with no truncation or unbounded artifact allocation.
 INSERT INTO public.sandy_company_aliases(customer_id,company_id,alias) SELECT tenant,company,'BOUND FIXTURE '||i::text FROM generate_series(1,1000) i;
 refused:=false;BEGIN PERFORM pg_temp.lifecycle_call('supabase.tenant.export',args);EXCEPTION WHEN OTHERS THEN IF SQLERRM<>'tenant_manifest_row_bound_exceeded' THEN RAISE;END IF;refused:=true;END;
 IF NOT refused THEN RAISE EXCEPTION 'oversize_manifest_silently_truncated';END IF;
END $test$;
SELECT jsonb_build_object('passed',true,'layer','administrative_database_component','fixtures','always_rolled_back','real_auth_session_tested',false,'real_owner_approval_tested',false,'owner_membership_changed',false,'external_provider_called',false,'manifest','application_leaf_links_v1','populated_tables_tested',6,'empty_tables_structurally_tested',0,'complete_tenant_coverage',false,'checks',jsonb_build_array('service_only_acl','pinned_schema_hash','exact_consent_extension','encrypted_private_snapshot_roundtrip','metadata_only_admin_response','simulated_claim_customer_download','service_key_not_customer_session','cross_customer_download_refusal','cross_tenant_snapshot_refusal','stale_state_refusal','legal_hold_refusal','retention_refusal','exact_captured_row_erase','parent_records_preserved','no_parent_task_or_mission_restore','foreign_PK_conflict_full_rollback','empty_target_exact_restore_readback','expired_delivery_refusal','payload_purge_real_vault_readback','row_bound_without_truncation','transactional_one_use_receipts','native_id_FK_is_not_tenant_proof','native_parent_fixture_did_not_queue_analysis_or_mission','text_download_boundary_accepted','oversize_text_refused_before_snapshot')) AS evidence;
ROLLBACK;
