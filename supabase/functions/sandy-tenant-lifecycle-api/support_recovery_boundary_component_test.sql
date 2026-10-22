BEGIN;
-- SHARED_OWNER_COMPONENT_FIXTURE
CREATE FUNCTION pg_temp.support_call(p_operation text,p_args jsonb) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE actor uuid;admission uuid;r jsonb;
BEGIN
 SELECT auth_user_id INTO actor FROM public.sandy_controller_admins WHERE role='owner' AND enabled ORDER BY created_at LIMIT 1;
 admission:=pg_temp.sandy_owner_component_admission(p_operation,p_args,'c691594174ef0f5b74c1c815568dab535a74a1b2f05f8a187bda3f41da1709b7');
 r:=public.sandy_tenant_lifecycle_execute(actor,admission,p_args::text);
 IF r->>'ok'<>'true' OR public.sandy_tenant_lifecycle_execute(actor,admission,p_args::text) IS DISTINCT FROM(r||jsonb_build_object('reused',true)) THEN RAISE EXCEPTION 'support_shared_receipt_invalid';END IF;
 RETURN r->'result';
END $$;
DO $test$
<<fixture>>
DECLARE tenant uuid:=gen_random_uuid();foreign_tenant uuid:=gen_random_uuid();subject uuid:=gen_random_uuid();historical_actor uuid:=gen_random_uuid();case_id uuid:=gen_random_uuid();other_case uuid:=gen_random_uuid();comment_id uuid:=gen_random_uuid();snapshot uuid;email text:='support-boundary-fixture-'||subject::text||'@example.invalid';manifest jsonb:=public.sandy_tenant_support_manifest_v1();args jsonb;image_sha text;empty_sha text;r jsonb;refused boolean;
BEGIN
 INSERT INTO auth.users(id,email,email_confirmed_at,created_at,updated_at,raw_app_meta_data,raw_user_meta_data) VALUES(subject,email,clock_timestamp(),clock_timestamp(),clock_timestamp(),'{}','{}'),(historical_actor,'actor-'||email,clock_timestamp(),clock_timestamp(),clock_timestamp(),'{}','{}');
 INSERT INTO public.email_customers(id) VALUES(tenant),(foreign_tenant);
 INSERT INTO public.email_customer_addresses(customer_id,email_address,is_primary) VALUES(tenant,email,true);
 INSERT INTO public.sandy_memory_portal_accounts(auth_user_id,customer_id) VALUES(subject,tenant);
 INSERT INTO public.sandy_product_support_cases(id,customer_id,subject,details,category) VALUES(case_id,tenant,'SYNTHETIC GOVERNED CASE','SYNTHETIC PRIVATE BODY','privacy'),(other_case,tenant,'OTHER OWN CASE','MUST REMAIN','other');
 INSERT INTO public.sandy_product_support_comments(id,case_id,actor_id,body) VALUES(comment_id,case_id,historical_actor,'SYNTHETIC HISTORICAL COMMENT');
 UPDATE public.sandy_operation_registry SET api_exposed=true,verified=true WHERE handler='sandy-tenant-lifecycle-api' OR operation IN('supabase.tenant.consent.set','supabase.tenant.exports.download');
 PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',subject,'role','authenticated')::text,true);
 PERFORM public.sandy_supabase_tenant_consent_set(ARRAY(SELECT operation FROM public.sandy_operation_registry WHERE handler='sandy-tenant-lifecycle-api'),ARRAY[]::text[],true,clock_timestamp()+interval '1 hour');
 args:=jsonb_build_object('tenant_id',tenant,'case_id',case_id,'manifest',manifest->>'id','expected_manifest_sha256',manifest->>'manifest_sha256');
 r:=pg_temp.support_call('supabase.tenant.support.snapshot',args);snapshot:=(r->>'snapshot_id')::uuid;image_sha:=r->>'snapshot_sha256';
 IF r->>'case_id'<>case_id::text OR r->>'private_recovery_only'<>'true' OR r->>'retained_control_copies'<>'true' OR r->>'complete_tenant_coverage'<>'false' OR r::text LIKE '%'||historical_actor::text||'%' OR r::text LIKE '%SYNTHETIC HISTORICAL%' THEN RAISE EXCEPTION 'support_private_recovery_metadata_or_attribution_leak';END IF;
 IF public.sandy_tenant_export_download(snapshot)->>'http_status'<>'404' THEN RAISE EXCEPTION 'support_private_Auth_attribution_customer_downloaded';END IF;
 refused:=false;BEGIN PERFORM pg_temp.support_call('supabase.tenant.support.snapshots.get',jsonb_build_object('tenant_id',tenant,'case_id',other_case,'snapshot_id',snapshot));EXCEPTION WHEN OTHERS THEN IF SQLERRM<>'tenant_support_snapshot_case_scope_mismatch' THEN RAISE;END IF;refused:=true;END;
 IF NOT refused THEN RAISE EXCEPTION 'support_snapshot_rebound_to_other_case';END IF;
 UPDATE public.sandy_supabase_tenant_controls SET legal_hold=true WHERE tenant_id=tenant;
 refused:=false;BEGIN PERFORM pg_temp.support_call('supabase.tenant.support.erase',args||jsonb_build_object('snapshot_id',snapshot,'expected_current_sha256',image_sha,'confirm_manifest_erasure',true));EXCEPTION WHEN OTHERS THEN IF SQLERRM<>'tenant_lifecycle_hold_or_retention_refused' THEN RAISE;END IF;refused:=true;END;
 IF NOT refused THEN RAISE EXCEPTION 'support_held_case_erased';END IF;
 UPDATE public.sandy_supabase_tenant_controls SET legal_hold=false WHERE tenant_id=tenant;
 UPDATE public.sandy_supabase_tenant_consents SET allow_erasure=false WHERE tenant_id=tenant;
 refused:=false;BEGIN PERFORM pg_temp.support_call('supabase.tenant.support.erase',args||jsonb_build_object('snapshot_id',snapshot,'expected_current_sha256',image_sha,'confirm_manifest_erasure',true));EXCEPTION WHEN OTHERS THEN IF SQLERRM<>'tenant_lifecycle_hold_or_retention_refused' THEN RAISE;END IF;refused:=true;END;
 IF NOT refused THEN RAISE EXCEPTION 'support_erased_without_erasure_consent';END IF;
 UPDATE public.sandy_supabase_tenant_consents SET allow_erasure=true WHERE tenant_id=tenant;
 r:=pg_temp.support_call('supabase.tenant.support.erase',args||jsonb_build_object('snapshot_id',snapshot,'expected_current_sha256',image_sha,'confirm_manifest_erasure',true));empty_sha:=r->>'after_sha256';
 IF r->>'state'<>'erased' OR EXISTS(SELECT 1 FROM public.sandy_product_support_cases WHERE id=fixture.case_id) OR EXISTS(SELECT 1 FROM public.sandy_product_support_comments WHERE id=comment_id) OR NOT EXISTS(SELECT 1 FROM public.sandy_product_support_cases WHERE id=other_case) THEN RAISE EXCEPTION 'support_single_case_erasure_or_other_case_preservation_invalid';END IF;
 UPDATE auth.users SET deleted_at=clock_timestamp() WHERE id=historical_actor;
 refused:=false;BEGIN PERFORM pg_temp.support_call('supabase.tenant.support.restore',args||jsonb_build_object('snapshot_id',snapshot,'expected_current_sha256',empty_sha,'confirm_manifest_restore',true));EXCEPTION WHEN OTHERS THEN IF SQLERRM<>'tenant_support_existing_attribution_required' THEN RAISE;END IF;refused:=true;END;
 IF NOT refused OR EXISTS(SELECT 1 FROM public.sandy_product_support_cases WHERE id=fixture.case_id) THEN RAISE EXCEPTION 'support_Auth_attribution_fabricated_or_partial_restore';END IF;
 UPDATE auth.users SET deleted_at=NULL WHERE id=historical_actor;
 INSERT INTO public.sandy_product_support_cases(id,customer_id,subject,details,category) VALUES(case_id,foreign_tenant,'FOREIGN PK COLLISION','FOREIGN BODY','other');
 refused:=false;BEGIN PERFORM pg_temp.support_call('supabase.tenant.support.restore',args||jsonb_build_object('snapshot_id',snapshot,'expected_current_sha256',empty_sha,'confirm_manifest_restore',true));EXCEPTION WHEN OTHERS THEN IF SQLERRM<>'tenant_support_restore_requires_empty_case_scope' THEN RAISE;END IF;refused:=true;END;
 IF NOT refused THEN RAISE EXCEPTION 'support_foreign_PK_adopted';END IF;
 DELETE FROM public.sandy_product_support_cases WHERE id=fixture.case_id AND customer_id=foreign_tenant;
 r:=pg_temp.support_call('supabase.tenant.support.restore',args||jsonb_build_object('snapshot_id',snapshot,'expected_current_sha256',empty_sha,'confirm_manifest_restore',true));
 IF r->>'state'<>'restored' OR r->>'after_sha256'<>image_sha OR NOT EXISTS(SELECT 1 FROM public.sandy_product_support_comments WHERE id=comment_id AND actor_id=historical_actor) THEN RAISE EXCEPTION 'support_private_exact_restore_failed';END IF;
 IF EXISTS(SELECT 1 FROM public.sandy_product_notification_inbox WHERE customer_id=tenant) OR EXISTS(SELECT 1 FROM public.sandy_product_notification_preferences WHERE customer_id=tenant) THEN RAISE EXCEPTION 'support_recovery_replayed_notifications_or_optin';END IF;
 r:=pg_temp.support_call('supabase.tenant.support.snapshots.get',jsonb_build_object('tenant_id',tenant,'case_id',case_id,'snapshot_id',snapshot));
 IF r->>'private_recovery_only'<>'true' OR r->>'snapshot_sha256'<>image_sha THEN RAISE EXCEPTION 'support_recovery_metadata_read_invalid';END IF;
 r:=pg_temp.support_call('supabase.tenant.support.snapshots.purge',jsonb_build_object('tenant_id',tenant,'case_id',case_id,'snapshot_id',snapshot,'confirm_artifact_purge',true));
 IF r->>'state'<>'purged' OR EXISTS(SELECT 1 FROM vault.secrets WHERE name='sandy_tenant_export_v1_'||snapshot::text) OR NOT EXISTS(SELECT 1 FROM public.sandy_product_support_cases WHERE id=fixture.case_id) THEN RAISE EXCEPTION 'support_private_image_purge_or_parent_preservation_invalid';END IF;
END $test$;
SELECT jsonb_build_object('passed',true,'layer','governed_private_support_database_component','fixtures','full_rollback','real_auth_session_tested',false,'real_owner_approval_tested',false,'external_provider_called',false,'complete_tenant_coverage',false,'retained_control_copies',true,'checks',jsonb_build_array('shared_immutable_owner_approval_and_consumed_grant','case_bound_encrypted_recovery_image','metadata_only_no_Auth_attribution_leak','actual_customer_cannot_download_private_recovery_image','wrong_case_snapshot_refusal','legal_hold_refusal','erasure_consent_refusal','single_case_erasure_other_cases_preserved','existing_Auth_attribution_required','foreign_PK_restore_refusal','ordered_exact_digest_restore','no_notification_replay_or_optin_restore','private_metadata_readback','explicit_encrypted_image_purge','source_parent_preserved_after_artifact_purge','shared_idempotent_receipts')) AS evidence;
ROLLBACK;
