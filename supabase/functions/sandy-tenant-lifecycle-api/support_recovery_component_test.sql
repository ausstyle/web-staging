BEGIN;
DO $test$
<<fixture>>
DECLARE tenant uuid:=gen_random_uuid();foreign_tenant uuid:=gen_random_uuid();actor uuid:=gen_random_uuid();case_id uuid:=gen_random_uuid();comment_id uuid:=gen_random_uuid();payload jsonb;before_hash text;after_payload jsonb;r jsonb;refused boolean;
BEGIN
 IF has_function_privilege('service_role','public.sandy_tenant_support_capture(uuid,uuid)','EXECUTE') OR has_function_privilege('authenticated','public.sandy_tenant_support_apply(uuid,uuid,jsonb,text)','EXECUTE') THEN RAISE EXCEPTION 'support_native_private_acl_invalid';END IF;
 INSERT INTO auth.users(id,email,email_confirmed_at,created_at,updated_at,raw_app_meta_data,raw_user_meta_data) VALUES(actor,'support-recovery-fixture-'||actor::text||'@example.invalid',clock_timestamp(),clock_timestamp(),clock_timestamp(),'{}','{}');
 INSERT INTO public.email_customers(id) VALUES(tenant),(foreign_tenant);
 INSERT INTO public.sandy_product_support_cases(id,customer_id,subject,details,category) VALUES(case_id,tenant,'SYNTHETIC CASE','SYNTHETIC CASE BODY','privacy');
 INSERT INTO public.sandy_product_support_comments(id,case_id,actor_id,body) VALUES(comment_id,case_id,actor,'SYNTHETIC PRIVATE COMMENT');
 payload:=public.sandy_tenant_support_capture(tenant,case_id);before_hash:=encode(extensions.digest(payload::text,'sha256'),'hex');
 IF payload->>'private_recovery_only'<>'true' OR payload->>'complete_tenant_coverage'<>'false' OR jsonb_array_length(payload->'tables'->'sandy_product_support_comments')<>1 OR payload->'tables'->'sandy_product_support_comments'->0->>'actor_id'<>actor::text THEN RAISE EXCEPTION 'support_native_capture_scope_or_existing_attribution_invalid';END IF;
 IF jsonb_array_length(public.sandy_tenant_support_capture(foreign_tenant,case_id)->'tables'->'sandy_product_support_cases')<>0 THEN RAISE EXCEPTION 'support_native_foreign_capture_disclosed';END IF;
 UPDATE public.sandy_product_support_comments SET body='CHANGED COMMENT' WHERE id=comment_id;
 refused:=false;BEGIN PERFORM public.sandy_tenant_support_apply(tenant,case_id,payload,'erase');EXCEPTION WHEN OTHERS THEN IF SQLERRM<>'tenant_support_comment_compare_conflict' THEN RAISE;END IF;refused:=true;END;
 IF NOT refused OR NOT EXISTS(SELECT 1 FROM public.sandy_product_support_cases WHERE id=case_id) THEN RAISE EXCEPTION 'support_native_stale_delete_allowed';END IF;
 UPDATE public.sandy_product_support_comments SET body='SYNTHETIC PRIVATE COMMENT' WHERE id=comment_id;
 r:=public.sandy_tenant_support_apply(tenant,case_id,payload,'erase');
 IF EXISTS(SELECT 1 FROM public.sandy_product_support_cases WHERE id=case_id) OR EXISTS(SELECT 1 FROM public.sandy_product_support_comments c WHERE c.case_id=fixture.case_id) OR r->>'Auth_identity_created'<>'false' OR r->>'parent_notifications_replayed'<>'false' THEN RAISE EXCEPTION 'support_native_ordered_delete_invalid';END IF;
 UPDATE auth.users SET deleted_at=clock_timestamp() WHERE id=actor;
 refused:=false;BEGIN PERFORM public.sandy_tenant_support_apply(tenant,case_id,payload,'restore');EXCEPTION WHEN OTHERS THEN IF SQLERRM<>'tenant_support_existing_attribution_required' THEN RAISE;END IF;refused:=true;END;
 IF NOT refused OR EXISTS(SELECT 1 FROM public.sandy_product_support_cases WHERE id=case_id) THEN RAISE EXCEPTION 'support_native_missing_attribution_was_manufactured';END IF;
 UPDATE auth.users SET deleted_at=NULL WHERE id=actor;
 INSERT INTO public.sandy_product_support_cases(id,customer_id,subject,details,category) VALUES(case_id,foreign_tenant,'FOREIGN CASE','FOREIGN SOURCE MUST REMAIN','other');
 refused:=false;BEGIN PERFORM public.sandy_tenant_support_apply(tenant,case_id,payload,'restore');EXCEPTION WHEN OTHERS THEN IF SQLERRM<>'tenant_support_restore_requires_empty_case_scope' THEN RAISE;END IF;refused:=true;END;
 IF NOT refused OR NOT EXISTS(SELECT 1 FROM public.sandy_product_support_cases WHERE id=case_id AND customer_id=foreign_tenant) THEN RAISE EXCEPTION 'support_native_foreign_PK_was_adopted';END IF;
 DELETE FROM public.sandy_product_support_cases WHERE id=case_id AND customer_id=foreign_tenant;
 r:=public.sandy_tenant_support_apply(tenant,case_id,payload,'restore');after_payload:=public.sandy_tenant_support_capture(tenant,case_id);
 IF encode(extensions.digest(after_payload::text,'sha256'),'hex')<>before_hash OR r->>'Auth_identity_created'<>'false' THEN RAISE EXCEPTION 'support_native_exact_restore_digest_invalid';END IF;
 IF EXISTS(SELECT 1 FROM public.sandy_product_notification_inbox WHERE customer_id=tenant) OR EXISTS(SELECT 1 FROM public.sandy_product_notification_preferences WHERE customer_id=tenant) OR EXISTS(SELECT 1 FROM public.sandy_product_provider_dispatches d JOIN public.sandy_api_execution_admissions a ON a.id=d.admission_id WHERE a.tenant_id=tenant) THEN RAISE EXCEPTION 'support_native_restore_generated_message_or_consent';END IF;
 UPDATE public.sandy_product_support_cases SET details=repeat('x',1700000) WHERE id=case_id;
 refused:=false;BEGIN PERFORM public.sandy_tenant_support_capture(tenant,case_id);EXCEPTION WHEN OTHERS THEN IF SQLERRM<>'tenant_support_private_image_bound_exceeded' THEN RAISE;END IF;refused:=true;END;
 IF NOT refused THEN RAISE EXCEPTION 'support_native_oversize_private_image_allowed';END IF;
END $test$;
SELECT jsonb_build_object('passed',true,'layer','private_native_primitives_only','fixtures','full_rollback','common_approval_CAS_encryption_composition_pending',true,'customer_download_of_private_image_allowed',false,'real_auth_session_tested',false,'parent_source_records_tested',2,'complete_tenant_coverage',false,'checks',jsonb_build_array('private_acl','pinned_two_table_scope','existing_historical_Auth_attribution_capture','cross_customer_capture_empty','stale_comment_full_row_compare_refusal','ordered_child_then_parent_erase','no_Auth_creation','deleted_actor_restore_refusal','foreign_parent_PK_restore_refusal','ordered_parent_then_child_restore','exact_recovery_digest','no_notification_consent_or_dispatch_replay','preaggregation_image_bound')) AS evidence;
ROLLBACK;
