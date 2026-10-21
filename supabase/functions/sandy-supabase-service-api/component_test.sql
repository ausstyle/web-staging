-- Administrative PostgreSQL component tests only. Synthetic rows, simulated
-- claims and admission records are transaction fixtures, not Auth sessions,
-- approved production changes, or provider attestations. Always rolls back.
BEGIN;
-- SHARED_OWNER_COMPONENT_FIXTURE
CREATE FUNCTION pg_temp.service_admission(p_operation text,p_arguments jsonb) RETURNS uuid LANGUAGE sql AS $$
 SELECT pg_temp.sandy_owner_component_admission(p_operation,p_arguments,'04573c462b9fa724cc78afc55ca40999b05855765084fc1c1e449fd8e06f2a14')
$$;
CREATE FUNCTION pg_temp.service_call(p_operation text,p_arguments jsonb) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE actor uuid;admission uuid;canonical text:=p_arguments::text;result jsonb;
BEGIN
 SELECT auth_user_id INTO actor FROM public.sandy_controller_admins WHERE role='owner' AND enabled ORDER BY created_at LIMIT 1;
 admission:=pg_temp.service_admission(p_operation,p_arguments);
 PERFORM public.sandy_supabase_service_authorize(actor,admission,canonical);
 SELECT public.sandy_supabase_service_execute(actor,admission,canonical) INTO result;
 IF result->>'ok'<>'true' THEN RAISE EXCEPTION 'component_service_call_failed';END IF;
 IF public.sandy_supabase_service_execute(actor,admission,canonical) IS DISTINCT FROM (result||jsonb_build_object('reused',true)) THEN RAISE EXCEPTION 'component_idempotent_receipt_failed';END IF;
 RETURN result->'result';
END $$;
DO $test$
DECLARE tenant uuid:=gen_random_uuid();foreign_tenant uuid:=gen_random_uuid();subject uuid:=gen_random_uuid();foreign_subject uuid:=gen_random_uuid();email text:='sandy-service-component-'||gen_random_uuid()::text||'@example.invalid';ops text[];r jsonb;refused boolean;secret_uuid uuid;actor uuid;admission uuid;canonical text;entry public.sandy_operation_registry;provider_policy text;original_using text;reserve_tenant uuid:=gen_random_uuid();reserve_user uuid:=gen_random_uuid();
BEGIN
 IF has_table_privilege('authenticated','public.sandy_supabase_tenant_consents','SELECT') OR has_table_privilege('service_role','public.sandy_supabase_managed_vault','UPDATE')
 OR has_function_privilege('authenticated','public.sandy_supabase_service_execute(uuid,uuid,text)','EXECUTE') OR has_function_privilege('service_role','public.sandy_supabase_service_context(uuid,uuid,text)','EXECUTE')
 OR NOT has_function_privilege('authenticated','public.sandy_supabase_tenant_consent_set(text[],text[],boolean,timestamptz)','EXECUTE') THEN RAISE EXCEPTION 'service_acl_invalid';END IF;
 INSERT INTO auth.users(id,email,email_confirmed_at,created_at,updated_at,raw_app_meta_data,raw_user_meta_data) VALUES(subject,email,clock_timestamp(),clock_timestamp(),clock_timestamp(),'{}','{}');
 INSERT INTO auth.users(id,email,email_confirmed_at,created_at,updated_at,raw_app_meta_data,raw_user_meta_data) VALUES(foreign_subject,'foreign-'||email,clock_timestamp(),clock_timestamp(),clock_timestamp(),'{}','{}');
 INSERT INTO public.email_customers(id) VALUES(tenant),(foreign_tenant);
 INSERT INTO public.email_customer_addresses(customer_id,email_address,is_primary) VALUES(tenant,email,true),(foreign_tenant,'foreign-'||email,true);
 INSERT INTO public.sandy_memory_portal_accounts(auth_user_id,customer_id) VALUES(subject,tenant),(foreign_subject,foreign_tenant);
 PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',subject,'role','authenticated')::text,true);
 UPDATE public.sandy_operation_registry SET api_exposed=true,verified=true WHERE handler='sandy-supabase-service-api' OR operation IN('supabase.tenant.consent.get','supabase.tenant.consent.set');
 SELECT array_agg(operation) INTO ops FROM public.sandy_operation_registry WHERE handler='sandy-supabase-service-api';
 r:=public.sandy_supabase_tenant_consent_set(ops,ARRAY['managed-'||email],true,clock_timestamp()+interval '1 hour');
 IF r->>'ok'<>'true' OR r->>'tenant_id'<>tenant::text OR r->>'revision'<>'1' THEN RAISE EXCEPTION 'actual_claim_derived_tenant_failed';END IF;
 IF public.sandy_supabase_tenant_member(foreign_tenant,subject) OR public.sandy_supabase_tenant_member(foreign_tenant,foreign_subject) THEN RAISE EXCEPTION 'cross_tenant_membership_disclosure_or_grant';END IF;
 r:=pg_temp.service_call('supabase.auth.sessions.list',jsonb_build_object('tenant_id',tenant,'user_id',subject));
 IF r ? 'token' OR r ? 'refresh_token_hmac_key' OR r->'sessions'<>'[]'::jsonb THEN RAISE EXCEPTION 'session_safe_projection_failed';END IF;
 INSERT INTO storage.buckets(id,name,public) VALUES('sandy-service-v1-tenant-'||tenant::text,'sandy-service-v1-tenant-'||tenant::text,false),('sandy-service-v1-tenant-'||foreign_tenant::text,'sandy-service-v1-tenant-'||foreign_tenant::text,false);
 refused:=false;BEGIN PERFORM pg_temp.service_call('supabase.storage.buckets.create',jsonb_build_object('tenant_id',tenant));EXCEPTION WHEN OTHERS THEN IF SQLERRM<>'existing_or_reserved_bucket_adoption_refused' THEN RAISE;END IF;refused:=true;END;
 IF NOT refused THEN RAISE EXCEPTION 'unbound_existing_bucket_adopted';END IF;
 SELECT id INTO admission FROM public.sandy_api_execution_admissions WHERE operation='supabase.auth.sessions.list' ORDER BY created_at DESC LIMIT 1;
 INSERT INTO public.sandy_supabase_managed_buckets(tenant_id,bucket_id,creation_admission_id,state,bound_at) VALUES(tenant,'sandy-service-v1-tenant-'||tenant::text,admission,'active',clock_timestamp()),(foreign_tenant,'sandy-service-v1-tenant-'||foreign_tenant::text,admission,'active',clock_timestamp());
 r:=pg_temp.service_call('supabase.storage.policies.create',jsonb_build_object('tenant_id',tenant,'name','fixture','subject_user_id',subject,'command','SELECT','prefix','owned/'));
 IF r->>'readback_verified'<>'true' THEN RAISE EXCEPTION 'storage_policy_create_readback_failed';END IF;
 -- Real PostgreSQL RLS evaluation under a simulated authenticated fixture.
 -- A deliberately broad permissive fixture cannot override restrictive tenant,
 -- subject, operation or prefix boundaries. No object bytes/provider are used.

 INSERT INTO storage.objects(bucket_id,name) VALUES('sandy-service-v1-tenant-'||tenant::text,'owned/visible'),('sandy-service-v1-tenant-'||tenant::text,'outside/hidden'),('sandy-service-v1-tenant-'||foreign_tenant::text,'owned/foreign');
 EXECUTE 'CREATE POLICY sandy_service_component_permissive ON storage.objects FOR SELECT TO authenticated USING(true)';
 EXECUTE 'SET LOCAL ROLE authenticated';
 SELECT jsonb_build_object('count',count(*)) INTO r FROM storage.objects WHERE bucket_id IN('sandy-service-v1-tenant-'||tenant::text,'sandy-service-v1-tenant-'||foreign_tenant::text);
 EXECUTE 'RESET ROLE';
 IF r->>'count'<>'1' THEN RAISE EXCEPTION 'broad_policy_bypassed_subject_prefix_tenant_boundary';END IF;
 INSERT INTO storage.buckets(id,name,public) VALUES('sandy-tenant-'||tenant::text,'sandy-tenant-'||tenant::text,false);
 INSERT INTO storage.objects(bucket_id,name) VALUES('sandy-tenant-'||tenant::text,'owned/legacy-unmanaged');
 EXECUTE 'SET LOCAL ROLE authenticated';
 SELECT jsonb_build_object('count',count(*)) INTO r FROM storage.objects WHERE bucket_id='sandy-tenant-'||tenant::text;
 EXECUTE 'RESET ROLE';
 IF r->>'count'<>'1' THEN RAISE EXCEPTION 'unmanaged_legacy_namespace_changed';END IF;
 IF public.sandy_supabase_realtime_permission('tenant:'||tenant::text||':legacy',false,NULL,'SELECT') IS DISTINCT FROM true THEN RAISE EXCEPTION 'legacy_realtime_namespace_changed';END IF;
 EXECUTE 'DROP POLICY sandy_service_component_permissive ON storage.objects';
 r:=pg_temp.service_call('supabase.storage.policies.list',jsonb_build_object('tenant_id',tenant));
 IF jsonb_array_length(r->'policies')<>1 THEN RAISE EXCEPTION 'storage_policy_list_failed';END IF;
 PERFORM pg_temp.service_call('supabase.storage.policies.update',jsonb_build_object('tenant_id',tenant,'name','fixture','subject_user_id',subject,'command','SELECT','prefix','revised/'));
 SELECT p.provider_name INTO provider_policy FROM public.sandy_supabase_managed_policies p WHERE p.tenant_id=tenant AND p.kind='storage' AND p.name='fixture';
 SELECT pg_get_expr(p.polqual,p.polrelid) INTO original_using FROM pg_policy p WHERE p.polname=provider_policy AND p.polrelid='storage.objects'::regclass;
 EXECUTE format('ALTER POLICY %I ON storage.objects USING(true)',provider_policy);
 refused:=false;BEGIN PERFORM pg_temp.service_call('supabase.storage.policies.update',jsonb_build_object('tenant_id',tenant,'name','fixture','subject_user_id',subject,'command','SELECT','prefix','forbidden/'));EXCEPTION WHEN OTHERS THEN IF SQLERRM<>'managed_policy_provider_drift_refused' THEN RAISE;END IF;refused:=true;END;
 IF NOT refused THEN RAISE EXCEPTION 'externally_changed_policy_not_refused';END IF;
 EXECUTE format('ALTER POLICY %I ON storage.objects USING(%s)',provider_policy,original_using);
 PERFORM pg_temp.service_call('supabase.storage.policies.delete',jsonb_build_object('tenant_id',tenant,'name','fixture','subject_user_id',subject));
 PERFORM pg_temp.service_call('supabase.realtime.channels.create',jsonb_build_object('tenant_id',tenant,'name','fixture','description','Rollback-only channel definition'));
 r:=pg_temp.service_call('supabase.realtime.channels.get',jsonb_build_object('tenant_id',tenant,'name','fixture'));
 IF r->'channel'->>'topic'<>'sandy-service-v1:'||tenant::text||':fixture' THEN RAISE EXCEPTION 'private_topic_binding_failed';END IF;
 PERFORM pg_temp.service_call('supabase.realtime.channels.update',jsonb_build_object('tenant_id',tenant,'name','fixture','description','Updated rollback-only definition'));
 r:=pg_temp.service_call('supabase.realtime.channels.list',jsonb_build_object('tenant_id',tenant));
 IF jsonb_array_length(r->'channels')<>1 OR r->'channels'->0->>'revision'<>'2' THEN RAISE EXCEPTION 'managed_channel_revision_failed';END IF;
 PERFORM pg_temp.service_call('supabase.realtime.permissions.create',jsonb_build_object('tenant_id',tenant,'name','fixture','subject_user_id',subject,'command','SELECT','channel','fixture'));
 PERFORM pg_temp.service_call('supabase.realtime.permissions.update',jsonb_build_object('tenant_id',tenant,'name','fixture','subject_user_id',subject,'command','INSERT','channel','fixture'));
 PERFORM pg_temp.service_call('supabase.realtime.permissions.list',jsonb_build_object('tenant_id',tenant));
 refused:=false;BEGIN PERFORM pg_temp.service_call('supabase.realtime.channels.delete',jsonb_build_object('tenant_id',tenant,'name','fixture'));
 IF NOT EXISTS(SELECT 1 FROM public.sandy_supabase_managed_channels c WHERE c.tenant_id=tenant AND c.name='fixture' AND c.state='deleted') THEN RAISE EXCEPTION 'deleted_private_topic_ownership_not_retained';END IF;
 IF public.sandy_supabase_realtime_permission('sandy-service-v1:'||tenant::text||':fixture',true,subject,'SELECT') IS DISTINCT FROM false THEN RAISE EXCEPTION 'deleted_private_topic_reopened_by_permissive_policy';END IF;
 PERFORM pg_temp.service_call('supabase.realtime.channels.create',jsonb_build_object('tenant_id',tenant,'name','fixture','description','Safe reuse of retained namespace'));
 PERFORM pg_temp.service_call('supabase.realtime.channels.delete',jsonb_build_object('tenant_id',tenant,'name','fixture'));
EXCEPTION WHEN OTHERS THEN IF SQLERRM<>'managed_channel_missing_or_policies_present' THEN RAISE;END IF;refused:=true;END;
 IF NOT refused THEN RAISE EXCEPTION 'channel_deleted_with_live_permissions';END IF;
 PERFORM pg_temp.service_call('supabase.realtime.permissions.delete',jsonb_build_object('tenant_id',tenant,'name','fixture','subject_user_id',subject));
 PERFORM pg_temp.service_call('supabase.realtime.channels.delete',jsonb_build_object('tenant_id',tenant,'name','fixture'));
 r:=pg_temp.service_call('supabase.vault.secrets.managed.create',jsonb_build_object('tenant_id',tenant,'name','fixture','value','SYNTHETIC-NONCREDENTIAL-COMPONENT-FIXTURE','description','Rollback-only noncredential fixture'));
 IF r ? 'value' OR r ? 'secret' OR r->>'readback_verified'<>'true' THEN RAISE EXCEPTION 'vault_write_projection_failed';END IF;
 r:=pg_temp.service_call('supabase.vault.secrets.managed.get',jsonb_build_object('tenant_id',tenant,'name','fixture'));
 IF r->'secret' ? 'value' OR r::text LIKE '%SYNTHETIC-NONCREDENTIAL%' THEN RAISE EXCEPTION 'vault_secret_disclosure';END IF;
 PERFORM pg_temp.service_call('supabase.vault.secrets.managed.update',jsonb_build_object('tenant_id',tenant,'name','fixture','value','SYNTHETIC-NONCREDENTIAL-UPDATED','description','Updated noncredential fixture'));
 PERFORM pg_temp.service_call('supabase.vault.secrets.managed.list',jsonb_build_object('tenant_id',tenant));
 PERFORM pg_temp.service_call('supabase.vault.secrets.managed.delete',jsonb_build_object('tenant_id',tenant,'name','fixture'));
 -- Provider metadata insertion exercises reservation/bind, with no bytes
 -- or HTTP. Positive deletion waits for real Storage API testing: PostgreSQL
 -- storage.protect_delete is preserved and is never disabled/bypassed.
 SELECT auth_user_id INTO actor FROM public.sandy_controller_admins WHERE role='owner' AND enabled ORDER BY created_at LIMIT 1;
 INSERT INTO auth.users(id,email,email_confirmed_at,created_at,updated_at,raw_app_meta_data,raw_user_meta_data) VALUES(reserve_user,'reserve-'||email,clock_timestamp(),clock_timestamp(),clock_timestamp(),'{}','{}');
 INSERT INTO public.email_customers(id) VALUES(reserve_tenant);
 INSERT INTO public.email_customer_addresses(customer_id,email_address,is_primary) VALUES(reserve_tenant,'reserve-'||email,true);
 INSERT INTO public.sandy_memory_portal_accounts(auth_user_id,customer_id) VALUES(reserve_user,reserve_tenant);
 PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',reserve_user,'role','authenticated')::text,true);
 PERFORM public.sandy_supabase_tenant_consent_set(ops,ARRAY[]::text[],true,clock_timestamp()+interval '1 hour');
 canonical:=jsonb_build_object('tenant_id',reserve_tenant)::text;
 admission:=pg_temp.service_admission('supabase.storage.buckets.create',canonical::jsonb);
 PERFORM public.sandy_supabase_service_authorize(actor,admission,canonical);
 IF NOT EXISTS(SELECT 1 FROM public.sandy_supabase_managed_buckets b WHERE b.tenant_id=reserve_tenant AND b.state='reserved' AND b.creation_admission_id=admission) THEN RAISE EXCEPTION 'created_bucket_not_reserved';END IF;
 INSERT INTO storage.buckets(id,name,public,created_at) VALUES('sandy-service-v1-tenant-'||reserve_tenant::text,'sandy-service-v1-tenant-'||reserve_tenant::text,false,clock_timestamp());
 PERFORM public.sandy_supabase_service_bind_bucket(actor,admission);
 IF NOT EXISTS(SELECT 1 FROM public.sandy_supabase_managed_buckets b WHERE b.tenant_id=reserve_tenant AND b.state='active') THEN RAISE EXCEPTION 'created_bucket_binding_not_active';END IF;
 canonical:=jsonb_build_object('tenant_id',reserve_tenant,'confirm_erasure',true)::text;
 admission:=pg_temp.service_admission('supabase.storage.buckets.delete',canonical::jsonb);
 PERFORM public.sandy_supabase_service_authorize(actor,admission,canonical);
 refused:=false;BEGIN PERFORM public.sandy_supabase_service_release_bucket(actor,admission,canonical);EXCEPTION WHEN OTHERS THEN IF SQLERRM<>'deleted_bucket_readback_required' THEN RAISE;END IF;refused:=true;END;
 IF NOT refused THEN RAISE EXCEPTION 'existing_bucket_binding_released';END IF;
 PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',subject,'role','authenticated')::text,true);
 r:=pg_temp.service_call('supabase.compliance.audit',jsonb_build_object('tenant_id',tenant));
 IF r->>'coverage'<>'managed_resources_only' OR r->>'complete_tenant_manifest_verified'<>'false' OR r->>'external_audit_anchor_verified'<>'false' THEN RAISE EXCEPTION 'compliance_false_full_coverage_claim';END IF;
 PERFORM pg_temp.service_call('supabase.compliance.hold.create',jsonb_build_object('tenant_id',tenant,'reason','Synthetic rollback legal-hold guard'));
 refused:=false;BEGIN PERFORM pg_temp.service_call('supabase.vault.secrets.managed.update',jsonb_build_object('tenant_id',tenant,'name','fixture','value','SYNTHETIC-NONCREDENTIAL','description','blocked'));EXCEPTION WHEN OTHERS THEN IF SQLERRM<>'tenant_erasure_retention_or_legal_hold_refused' THEN RAISE;END IF;refused:=true;END;
 IF NOT refused THEN RAISE EXCEPTION 'legal_hold_not_enforced';END IF;
 PERFORM pg_temp.service_call('supabase.compliance.retention.extend',jsonb_build_object('tenant_id',tenant,'retain_until',clock_timestamp()+interval '1 day'));
 refused:=false;BEGIN PERFORM pg_temp.service_call('supabase.compliance.retention.extend',jsonb_build_object('tenant_id',tenant,'retain_until',clock_timestamp()+interval '1 hour'));EXCEPTION WHEN OTHERS THEN IF SQLERRM<>'retention_may_only_extend' THEN RAISE;END IF;refused:=true;END;
 IF NOT refused THEN RAISE EXCEPTION 'retention_shortening_not_refused';END IF;
 UPDATE public.sandy_supabase_tenant_consents SET expires_at=clock_timestamp()-interval '1 second' WHERE tenant_id=tenant;
 refused:=false;BEGIN PERFORM pg_temp.service_call('supabase.storage.policies.list',jsonb_build_object('tenant_id',tenant));EXCEPTION WHEN OTHERS THEN IF SQLERRM<>'current_explicit_tenant_consent_required' THEN RAISE;END IF;refused:=true;END;
 IF NOT refused THEN RAISE EXCEPTION 'expired_consent_not_refused';END IF;
 r:=pg_temp.service_call('supabase.compliance.audit',jsonb_build_object('tenant_id',tenant));
 IF r->>'consent_current'<>'false' THEN RAISE EXCEPTION 'expired_consent_reported_current';END IF;
 -- A real existing owner ID is metadata only here: no session or owner grant
 -- is issued, and no Controller membership is created or changed.
 SELECT auth_user_id INTO actor FROM public.sandy_controller_admins WHERE role='owner' AND enabled ORDER BY created_at LIMIT 1;
 INSERT INTO public.sandy_supabase_managed_users(tenant_id,user_id,source) VALUES(tenant,actor,'service_created') ON CONFLICT DO NOTHING;
 UPDATE public.sandy_supabase_tenant_consents SET expires_at=clock_timestamp()+interval '1 hour' WHERE tenant_id=tenant;
 SELECT * INTO entry FROM public.sandy_operation_registry WHERE operation='supabase.auth.users.disable';admission:=gen_random_uuid();canonical:=jsonb_build_object('tenant_id',tenant,'user_id',actor,'duration_hours',1)::text;
 admission:=pg_temp.service_admission(entry.operation,canonical::jsonb);
 refused:=false;BEGIN PERFORM public.sandy_supabase_service_authorize(actor,admission,canonical);EXCEPTION WHEN OTHERS THEN IF SQLERRM<>'protected_system_identity_refused' THEN RAISE;END IF;refused:=true;END;
 IF NOT refused THEN RAISE EXCEPTION 'controller_identity_not_protected';END IF;
 PERFORM set_config('request.jwt.claims','{"role":"service_role"}',true);
 r:=public.sandy_supabase_tenant_consent_get();
 IF r->>'error'<>'confirmed_portal_customer_session_required' THEN RAISE EXCEPTION 'service_credential_accepted_as_customer_session';END IF;
END $test$;
SELECT jsonb_build_object('passed',true,'layer','administrative_database_component','fixture','always_rolled_back','real_auth_session_tested',false,'owner_membership_changed',false,'real_owner_approval_tested',false,'external_auth_storage_realtime_provider_called',false,'vault_noncredential_encryption_roundtrip_tested',true,'checks',jsonb_build_array('private_acl','claim_derived_tenant','cross_tenant_refusal','safe_session_projection','storage_policy_crud_readback','real_PG_RLS_with_simulated_claims','broad_permissive_policy_cannot_bypass_tenant_subject_prefix','realtime_channel_definition_crud','realtime_permissions_crud','dependent_channel_delete_refusal','managed_vault_crud_real_encryption','no_secret_disclosure','SQL_idempotency_receipts','compliance_honest_coverage','legal_hold_refusal','retention_extension_only','expired_consent_refusal','controller_protection','changed_provider_policy_refusal','service_credential_is_not_customer_session','preexisting_unowned_bucket_adoption_refusal','existing_unmanaged_storage_realtime_preserved','bucket_reserve_bind_and_unproven_release_refusal','deleted_realtime_topic_tombstone_stays_denied')) AS evidence;
ROLLBACK;
