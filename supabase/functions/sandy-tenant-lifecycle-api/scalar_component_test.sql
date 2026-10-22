-- Administrative native-table fixtures only, always rolled back. Parent
-- document INSERT naturally queues an uncommitted indexing row; no worker can
-- see it and lifecycle never adds/replays it. No trigger is disabled.
BEGIN;
-- SHARED_OWNER_COMPONENT_FIXTURE
CREATE FUNCTION pg_temp.scalar_call(p_operation text,p_args jsonb) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE actor uuid;admission uuid;r jsonb;
BEGIN
 SELECT auth_user_id INTO actor FROM public.sandy_controller_admins WHERE role='owner' AND enabled ORDER BY created_at LIMIT 1;
 admission:=pg_temp.sandy_owner_component_admission(p_operation,p_args,public.sandy_tenant_lifecycle_operation_config(p_operation)->>'scope_sha256');
 r:=public.sandy_tenant_lifecycle_execute(actor,admission,p_args::text);
 IF r->>'ok'<>'true' OR public.sandy_tenant_lifecycle_execute(actor,admission,p_args::text) IS DISTINCT FROM (r||jsonb_build_object('reused',true)) THEN RAISE EXCEPTION 'scalar_receipt_failed';END IF;
 RETURN r->'result';
END $$;
DO $test$
<<fixture>>
DECLARE tenant uuid:=gen_random_uuid();subject uuid:=gen_random_uuid();foreign_tenant uuid:=gen_random_uuid();email text:='scalar-fixture-'||gen_random_uuid()::text||'@example.invalid';person_a uuid:=gen_random_uuid();person_b uuid:=gen_random_uuid();document uuid:=gen_random_uuid();entity uuid:=gen_random_uuid();space uuid:=gen_random_uuid();conversation uuid:=gen_random_uuid();message uuid:=gen_random_uuid();foreign_conversation uuid:=gen_random_uuid();offset_id uuid:=gen_random_uuid();area text;manifest jsonb:=public.sandy_tenant_manifest_scalar_v1();args jsonb;r jsonb;payload jsonb;snapshot uuid;sha text;empty_sha text;refused boolean;job_count integer;op text;actor uuid;admission uuid;before_count integer;
BEGIN
 IF has_function_privilege('service_role','public.sandy_tenant_capture_scalar_v1(uuid)','EXECUTE') OR has_function_privilege('authenticated','public.sandy_tenant_manifest_resolve(text)','EXECUTE') THEN RAISE EXCEPTION 'scalar_private_acl_invalid';END IF;
 IF public.sandy_tenant_manifest_scalar_schema_sha256() IS DISTINCT FROM manifest->>'schema_sha256' THEN RAISE EXCEPTION 'scalar_schema_pin_mismatch';END IF;
 IF public.sandy_tenant_lifecycle_operation_config('unsupported') IS NOT NULL THEN RAISE EXCEPTION 'scalar_unknown_operation_dispatch';END IF;
 INSERT INTO auth.users(id,email,email_confirmed_at,created_at,updated_at,raw_app_meta_data,raw_user_meta_data) VALUES(subject,email,clock_timestamp(),clock_timestamp(),clock_timestamp(),'{}','{}');
 INSERT INTO public.email_customers(id) VALUES(tenant),(foreign_tenant);
 INSERT INTO public.email_customer_addresses(customer_id,email_address,is_primary) VALUES(tenant,email,true);
 INSERT INTO public.sandy_memory_portal_accounts(auth_user_id,customer_id) VALUES(subject,tenant);
 INSERT INTO public.sandy_people(id,owner_customer_id,display_name) VALUES(person_a,tenant,'SYNTHETIC A'),(person_b,tenant,'SYNTHETIC B');
 INSERT INTO public.sandy_person_links(owner_customer_id,from_person_id,to_person_id,link_type,source,note) VALUES(tenant,person_a,person_b,'knows','explicit_user','SYNTHETIC PRIVATE LINK');
 SELECT a.area_key INTO area FROM public.sandy_life_areas a ORDER BY a.area_key LIMIT 1;
 INSERT INTO public.sandy_life_spaces(id,owner_customer_id,space_key,title,space_kind) VALUES(space,tenant,'component-'||space::text,'SYNTHETIC SPACE','personal');
 INSERT INTO public.sandy_knowledge_documents(id,owner_customer_id,source_kind,external_id,title,status) VALUES(document,tenant,'upload','component-'||document::text,'SYNTHETIC DOCUMENT','ready');
 INSERT INTO public.sandy_knowledge_entities(id,owner_customer_id,entity_type,canonical_name,normalized_name) VALUES(entity,tenant,'person','SYNTHETIC ENTITY','synthetic entity');
 INSERT INTO public.sandy_life_document_contexts(owner_customer_id,document_id,space_id,area_key,status,classification_source,confidence,evidence) VALUES(tenant,document,space,area,'confirmed','owner',0.123456789012345678901234567890123456789,'SYNTHETIC EVIDENCE');
 INSERT INTO public.sandy_knowledge_links(owner_customer_id,document_id,entity_id,relationship_type,evidence_excerpt,confidence) VALUES(tenant,document,entity,'synthetic','SYNTHETIC EXCERPT',0.123456789012345678901234567890123456789);
 -- Empty synthetic source email avoids memory/improvement/temporal content
 -- ingestion. Its normal metadata event is uncommitted, never sent externally.
 INSERT INTO public.email_conversations(id,customer_id) VALUES(conversation,tenant),(foreign_conversation,foreign_tenant);
 INSERT INTO public.email_messages(id,customer_id,conversation_id,sender_address,direction,body_text,subject) VALUES(message,tenant,conversation,'fixture@example.invalid','incoming',NULL,NULL);
 INSERT INTO public.sandy_timezone_email_offsets(id,customer_id,message_id,offset_minutes,header_date) VALUES(offset_id,tenant,message,60,'SYNTHETIC HEADER');
 SELECT count(*) INTO job_count FROM public.sandy_knowledge_jobs WHERE document_id=document;
 IF job_count<>1 OR EXISTS(SELECT 1 FROM public.sandy_temporal_ingestion_jobs WHERE source_ref=message::text) OR EXISTS(SELECT 1 FROM public.sandy_memory_archive WHERE owner_customer_id=tenant) THEN RAISE EXCEPTION 'scalar_native_fixture_side_effect_review_changed';END IF;
 UPDATE public.sandy_operation_registry SET api_exposed=true,verified=true WHERE handler='sandy-tenant-lifecycle-api' OR operation IN('supabase.tenant.consent.set','supabase.tenant.exports.download');
 PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',subject,'role','authenticated')::text,true);
 PERFORM public.sandy_supabase_tenant_consent_set(ARRAY(SELECT operation FROM public.sandy_operation_registry WHERE handler='sandy-tenant-lifecycle-api'),ARRAY[]::text[],true,clock_timestamp()+interval '1 hour');
 args:=jsonb_build_object('tenant_id',tenant,'manifest',manifest->>'id','expected_manifest_sha256',manifest->>'manifest_sha256');
 SELECT auth_user_id INTO actor FROM public.sandy_controller_admins WHERE role='owner' AND enabled ORDER BY created_at LIMIT 1;
 admission:=pg_temp.sandy_owner_component_admission('supabase.tenant.manifests.export',args,'f409867ca7bb8103d66fcfc4bdbc10fc5c8fc2a5849cd15b5ba3ba79d6d128a9');
 refused:=false;BEGIN PERFORM public.sandy_tenant_lifecycle_execute(actor,admission,args::text);EXCEPTION WHEN OTHERS THEN IF SQLERRM<>'tenant_lifecycle_scoped_owner_admission_required' THEN RAISE;END IF;refused:=true;END;
 IF NOT refused THEN RAISE EXCEPTION 'scalar_legacy_scope_proof_adopted';END IF;
 admission:=pg_temp.sandy_owner_component_admission('supabase.tenant.manifests.export',args,public.sandy_tenant_lifecycle_operation_config('supabase.tenant.manifests.export')->>'scope_sha256');
 UPDATE public.sandy_api_execution_admissions SET approval_id=NULL WHERE id=admission;
 refused:=false;BEGIN PERFORM public.sandy_tenant_lifecycle_execute(actor,admission,args::text);EXCEPTION WHEN OTHERS THEN IF SQLERRM<>'tenant_lifecycle_scoped_owner_admission_required' THEN RAISE;END IF;refused:=true;END;
 IF NOT refused THEN RAISE EXCEPTION 'scalar_missing_immutable_approval_accepted';END IF;
 UPDATE public.sandy_operation_registry SET error_contract=jsonb_set(error_contract,'{requires_approval}','false'::jsonb) WHERE operation='supabase.tenant.manifests.export';
 admission:=pg_temp.sandy_owner_component_admission('supabase.tenant.manifests.export',args,public.sandy_tenant_lifecycle_operation_config('supabase.tenant.manifests.export')->>'scope_sha256');
 refused:=false;BEGIN PERFORM public.sandy_tenant_lifecycle_execute(actor,admission,args::text);EXCEPTION WHEN OTHERS THEN IF SQLERRM<>'tenant_lifecycle_current_verified_contract_required' THEN RAISE;END IF;refused:=true;END;
 IF NOT refused THEN RAISE EXCEPTION 'scalar_registry_approval_flag_drift_accepted';END IF;
 UPDATE public.sandy_operation_registry SET error_contract=jsonb_set(error_contract,'{requires_approval}','true'::jsonb) WHERE operation='supabase.tenant.manifests.export';
 r:=pg_temp.scalar_call('supabase.tenant.manifests.export',args);snapshot:=(r->>'snapshot_id')::uuid;sha:=r->>'snapshot_sha256';
 IF r->>'manifest'<>manifest->>'id' OR r->>'complete_tenant_coverage'<>'false' OR EXISTS(SELECT 1 FROM jsonb_each_text(r->'row_counts') e WHERE e.value<>'1') OR r::text LIKE '%SYNTHETIC PRIVATE%' THEN RAISE EXCEPTION 'scalar_metadata_projection_invalid';END IF;
 payload:=public.sandy_tenant_export_download(snapshot)->'export';
 IF payload->'tables'->'sandy_knowledge_links'->0->>'confidence'<>'0.123456789012345678901234567890123456789' OR jsonb_typeof(payload->'tables'->'sandy_knowledge_links'->0->'confidence')<>'string' OR payload->'tables' ? 'sandy_knowledge_documents' THEN RAISE EXCEPTION 'scalar_precise_projection_or_parent_disclosure';END IF;
 r:=pg_temp.scalar_call('supabase.tenant.manifests.exports.get',jsonb_build_object('tenant_id',tenant,'snapshot_id',snapshot));
 IF r->>'snapshot_sha256'<>sha THEN RAISE EXCEPTION 'scalar_snapshot_readback_invalid';END IF;
 refused:=false;BEGIN PERFORM pg_temp.scalar_call('supabase.tenant.exports.get',jsonb_build_object('tenant_id',tenant,'snapshot_id',snapshot));EXCEPTION WHEN OTHERS THEN IF SQLERRM<>'tenant_export_manifest_version_unsupported' THEN RAISE;END IF;refused:=true;END;
 IF NOT refused THEN RAISE EXCEPTION 'legacy_operation_adopted_new_manifest';END IF;
 UPDATE public.sandy_timezone_email_offsets SET message_id=gen_random_uuid() WHERE id=offset_id;
 refused:=false;BEGIN PERFORM pg_temp.scalar_call('supabase.tenant.manifests.export',args);EXCEPTION WHEN OTHERS THEN IF SQLERRM<>'tenant_timezone_message_ownership_refused' THEN RAISE;END IF;refused:=true;END;
 IF NOT refused THEN RAISE EXCEPTION 'scalar_unproven_email_owner_accepted';END IF;
 UPDATE public.sandy_timezone_email_offsets SET message_id=message WHERE id=offset_id;
 UPDATE public.sandy_person_links SET note=repeat('x',10001) WHERE owner_customer_id=tenant;
 SELECT count(*) INTO before_count FROM public.sandy_tenant_export_snapshots WHERE tenant_id=tenant;
 refused:=false;BEGIN PERFORM pg_temp.scalar_call('supabase.tenant.manifests.export',args);EXCEPTION WHEN OTHERS THEN IF SQLERRM<>'tenant_manifest_text_or_decimal_bound_exceeded' THEN RAISE;END IF;refused:=true;END;
 IF NOT refused OR (SELECT count(*) FROM public.sandy_tenant_export_snapshots WHERE tenant_id=tenant)<>before_count THEN RAISE EXCEPTION 'scalar_oversize_artifact_registered';END IF;
 UPDATE public.sandy_person_links SET note='SYNTHETIC PRIVATE LINK' WHERE owner_customer_id=tenant;
 UPDATE public.sandy_knowledge_links SET confidence='NaN'::numeric WHERE owner_customer_id=tenant;
 refused:=false;BEGIN PERFORM pg_temp.scalar_call('supabase.tenant.manifests.export',args);EXCEPTION WHEN OTHERS THEN IF SQLERRM<>'tenant_manifest_text_or_decimal_bound_exceeded' THEN RAISE;END IF;refused:=true;END;
 IF NOT refused THEN RAISE EXCEPTION 'scalar_nondecimal_numeric_accepted';END IF;
 UPDATE public.sandy_knowledge_links SET confidence=0.123456789012345678901234567890123456789 WHERE owner_customer_id=tenant;
 UPDATE public.sandy_supabase_tenant_controls SET legal_hold=true WHERE tenant_id=tenant;
 refused:=false;BEGIN PERFORM pg_temp.scalar_call('supabase.tenant.manifests.erase',args||jsonb_build_object('snapshot_id',snapshot,'expected_current_sha256',sha,'confirm_manifest_erasure',true));EXCEPTION WHEN OTHERS THEN IF SQLERRM<>'tenant_lifecycle_hold_or_retention_refused' THEN RAISE;END IF;refused:=true;END;
 IF NOT refused THEN RAISE EXCEPTION 'scalar_held_erasure_allowed';END IF;
 UPDATE public.sandy_supabase_tenant_controls SET legal_hold=false WHERE tenant_id=tenant;
 r:=pg_temp.scalar_call('supabase.tenant.manifests.erase',args||jsonb_build_object('snapshot_id',snapshot,'expected_current_sha256',sha,'confirm_manifest_erasure',true));empty_sha:=r->>'after_sha256';
 IF r->>'state'<>'erased' OR EXISTS(SELECT 1 FROM public.sandy_person_links WHERE owner_customer_id=tenant) OR EXISTS(SELECT 1 FROM public.sandy_timezone_email_offsets WHERE customer_id=tenant) OR NOT EXISTS(SELECT 1 FROM public.sandy_knowledge_documents WHERE id=document) OR NOT EXISTS(SELECT 1 FROM public.email_messages WHERE id=message) THEN RAISE EXCEPTION 'scalar_exact_erasure_or_parent_preservation_failed';END IF;
 -- A deleted source-document state blocks link restore without rewriting the
 -- parent or revising it (which would enqueue a new job).
 UPDATE public.sandy_knowledge_documents SET status='deleted' WHERE id=document;
 refused:=false;BEGIN PERFORM pg_temp.scalar_call('supabase.tenant.manifests.restore',args||jsonb_build_object('snapshot_id',snapshot,'expected_current_sha256',empty_sha,'confirm_manifest_restore',true));EXCEPTION WHEN OTHERS THEN IF SQLERRM<>'tenant_document_context_parent_ownership_or_state_refused' THEN RAISE;END IF;refused:=true;END;
 IF NOT refused OR EXISTS(SELECT 1 FROM public.sandy_person_links WHERE owner_customer_id=tenant) THEN RAISE EXCEPTION 'scalar_parent_state_conflict_not_transactional';END IF;
 UPDATE public.sandy_knowledge_documents SET status='ready' WHERE id=document;
 -- No FK protects message ownership: moving the existing parent to a different
 -- customer must not make captured timezone offsets valid for that customer.
 UPDATE public.email_messages SET customer_id=foreign_tenant,conversation_id=foreign_conversation WHERE id=message;
 refused:=false;BEGIN PERFORM pg_temp.scalar_call('supabase.tenant.manifests.restore',args||jsonb_build_object('snapshot_id',snapshot,'expected_current_sha256',empty_sha,'confirm_manifest_restore',true));EXCEPTION WHEN OTHERS THEN IF SQLERRM<>'tenant_timezone_message_ownership_refused' THEN RAISE;END IF;refused:=true;END;
 IF NOT refused OR EXISTS(SELECT 1 FROM public.sandy_person_links WHERE owner_customer_id=tenant) THEN RAISE EXCEPTION 'scalar_foreign_message_restore_not_transactional';END IF;
 UPDATE public.email_messages SET customer_id=tenant,conversation_id=conversation WHERE id=message;
 INSERT INTO public.sandy_timezone_email_offsets(customer_id,message_id,offset_minutes,header_date) VALUES(foreign_tenant,message,0,'SYNTHETIC GLOBAL UNIQUE CONFLICT');
 refused:=false;BEGIN PERFORM pg_temp.scalar_call('supabase.tenant.manifests.restore',args||jsonb_build_object('snapshot_id',snapshot,'expected_current_sha256',empty_sha,'confirm_manifest_restore',true));EXCEPTION WHEN unique_violation THEN refused:=true;END;
 IF NOT refused OR EXISTS(SELECT 1 FROM public.sandy_person_links WHERE owner_customer_id=tenant) THEN RAISE EXCEPTION 'scalar_global_message_collision_not_transactional';END IF;
 DELETE FROM public.sandy_timezone_email_offsets WHERE customer_id=foreign_tenant AND message_id=message;
 r:=pg_temp.scalar_call('supabase.tenant.manifests.restore',args||jsonb_build_object('snapshot_id',snapshot,'expected_current_sha256',empty_sha,'confirm_manifest_restore',true));
 IF r->>'after_sha256'<>sha OR (SELECT confidence::text FROM public.sandy_knowledge_links WHERE owner_customer_id=tenant)<>'0.123456789012345678901234567890123456789' THEN RAISE EXCEPTION 'scalar_exact_precision_restore_failed';END IF;
 IF (SELECT count(*) FROM public.sandy_knowledge_jobs WHERE document_id=document)<>job_count OR EXISTS(SELECT 1 FROM public.sandy_life_classification_jobs WHERE document_id=document) OR (SELECT revision FROM public.sandy_knowledge_documents WHERE id=document)<>1 THEN RAISE EXCEPTION 'scalar_lifecycle_replayed_parent_jobs';END IF;
 r:=pg_temp.scalar_call('supabase.tenant.manifests.exports.purge',jsonb_build_object('tenant_id',tenant,'snapshot_id',snapshot,'confirm_artifact_purge',true));
 IF r->>'state'<>'purged' OR EXISTS(SELECT 1 FROM vault.secrets WHERE name='sandy_tenant_export_v1_'||snapshot::text) THEN RAISE EXCEPTION 'scalar_encrypted_purge_readback_failed';END IF;
END $test$;
SELECT jsonb_build_object('passed',true,'layer','administrative_database_component','fixtures','full_rollback','manifest','application_scalar_links_v1','populated_manifest_tables',4,'complete_tenant_coverage',false,'provider_called',false,'real_auth_session_tested',false,'real_owner_approval_tested',false,'parent_fixture_queues_uncommitted_only',true,'checks',jsonb_build_array('private_adapters_acl','structural_schema_pin','static_unknown_operation_refusal','four_tables_populated','metadata_only_administration','decimal_precision_export','decimal_precision_restore','typed_parent_exclusion','exact_snapshot_readback','legacy_manifest_isolation','explicit_message_owner_proof','text_bound_before_snapshot','nondecimal_numeric_refusal','legal_hold_refusal','mixed_owner_column_erase','parent_records_preserved','inactive_parent_restore_refusal','foreign_message_owner_restore_refusal','global_message_unique_conflict_rollback','empty_target_exact_digest_restore','no_parent_revision_or_worker_replay','real_vault_artifact_purge','transactional_receipt_reuse','legacy_scope_proof_refusal','missing_immutable_approval_refusal','registry_approval_flag_drift_refusal')) AS evidence;
ROLLBACK;
