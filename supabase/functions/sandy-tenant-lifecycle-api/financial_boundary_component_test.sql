BEGIN;
-- SHARED_OWNER_COMPONENT_FIXTURE
CREATE FUNCTION pg_temp.financial_call(p_operation text,p_args jsonb) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE actor uuid;admission uuid;r jsonb;scope text;
BEGIN
 SELECT auth_user_id INTO actor FROM public.sandy_controller_admins WHERE role='owner' AND enabled ORDER BY created_at LIMIT 1;
 scope:=public.sandy_tenant_lifecycle_operation_config(p_operation)->>'scope_sha256';
 admission:=pg_temp.sandy_owner_component_admission(p_operation,p_args,scope);
 r:=public.sandy_tenant_content_execute(actor,admission,p_args::text);
 IF r->>'ok'<>'true' OR public.sandy_tenant_content_execute(actor,admission,p_args::text) IS DISTINCT FROM(r||jsonb_build_object('reused',true)) THEN RAISE EXCEPTION 'financial_shared_receipt_invalid';END IF;
 RETURN r->'result';
END $$;
DO $test$
<<fixture>>
DECLARE tenant uuid:=gen_random_uuid();subject uuid:=gen_random_uuid();foreign_tenant uuid:=gen_random_uuid();foreign_subject uuid:=gen_random_uuid();email text:='financial-boundary-fixture-'||subject::text||'@example.invalid';snapshot uuid;content_snapshot uuid;args jsonb;manifest jsonb:=public.sandy_tenant_financial_manifest_v1();r jsonb;fragment record;payload jsonb;stream text;initial_invoice text;counted integer:=0;sha text;before_state text;after_state text;refused boolean;account_id uuid:=gen_random_uuid();entry_id uuid:=gen_random_uuid();invoice_id uuid:=gen_random_uuid();
BEGIN
 INSERT INTO auth.users(id,email,email_confirmed_at,created_at,updated_at,raw_app_meta_data,raw_user_meta_data) VALUES(subject,email,clock_timestamp(),clock_timestamp(),clock_timestamp(),'{}','{}'),(foreign_subject,'foreign-'||email,clock_timestamp(),clock_timestamp(),clock_timestamp(),'{}','{}');
 INSERT INTO public.email_customers(id) VALUES(tenant),(foreign_tenant);
 INSERT INTO public.email_customer_addresses(customer_id,email_address,is_primary) VALUES(tenant,email,true),(foreign_tenant,'foreign-'||email,true);
 INSERT INTO public.sandy_memory_portal_accounts(auth_user_id,customer_id) VALUES(subject,tenant),(foreign_subject,foreign_tenant);
 INSERT INTO public.sandy_commerce_configuration(customer_id,currency,minor_unit_exponent,invoice_prefix,next_invoice_number,default_terms_days) VALUES(tenant,'AUD',2,'SYNTHETIC-',9007199254740993,30);
 INSERT INTO public.sandy_commerce_accounts(id,customer_id,code,name,kind,currency,minor_unit_exponent) VALUES(account_id,tenant,'SYNTHETIC','SYNTHETIC OWN ACCOUNT','asset','AUD',2);
 INSERT INTO public.sandy_commerce_entries(id,customer_id,description,external_reference,effective_at,currency,minor_unit_exponent) VALUES(entry_id,tenant,repeat('😀',850000),'SYNTHETIC-ENTRY',clock_timestamp(),'AUD',2);
 INSERT INTO public.sandy_commerce_entry_lines(entry_id,account_id,debit_minor,credit_minor,description) VALUES(entry_id,account_id,9223372036854775807,0,'SYNTHETIC LARGE INTEGER');
 UPDATE public.sandy_commerce_entries SET state='posted',posted_at=clock_timestamp() WHERE id=entry_id;
 INSERT INTO public.sandy_commerce_invoices(id,customer_id,counterparty_name,external_reference,currency,minor_unit_exponent,items,subtotal_minor,tax_minor,discount_minor,total_minor,due_at) VALUES(invoice_id,tenant,'SYNTHETIC CUSTOMER','SYNTHETIC-INVOICE','AUD',2,'[{"description":"SYNTHETIC","quantity":100000,"unit_minor":"9223372036854775807"}]',922337203685477580700000,0,0,922337203685477580700000,clock_timestamp());
 SELECT encode(extensions.digest(jsonb_agg(part ORDER BY(part->>'sequence')::integer)::text,'sha256'),'hex') INTO before_state FROM public.sandy_tenant_financial_capture_v1(tenant)part;
 UPDATE public.sandy_operation_registry SET api_exposed=true,verified=true WHERE handler='sandy-tenant-lifecycle-api' OR operation IN('supabase.tenant.consent.get','supabase.tenant.consent.set','supabase.tenant.content.exports.available','supabase.tenant.content.exports.download','supabase.tenant.financial.exports.available','supabase.tenant.financial.exports.download');
 PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',subject,'role','authenticated')::text,true);
 PERFORM public.sandy_supabase_tenant_consent_set(ARRAY['supabase.tenant.financial.export','supabase.tenant.financial.exports.get','supabase.tenant.financial.exports.purge','supabase.tenant.content.export'],ARRAY[]::text[],false,clock_timestamp()+interval '1 hour');
 args:=jsonb_build_object('tenant_id',tenant,'manifest',manifest->>'id','expected_manifest_sha256',manifest->>'manifest_sha256');
 r:=pg_temp.financial_call('supabase.tenant.financial.export',args);snapshot:=(r->>'snapshot_id')::uuid;
 IF r->>'manifest'<>manifest->>'id' OR r->>'complete_tenant_coverage'<>'false' OR r->>'provider_verified'<>'false' OR r->>'payment_executed'<>'false' OR r->>'financial_source'<>'internal_commerce_records' OR (r->>'total_plaintext_bytes')::bigint<3000000 OR r::text LIKE '%SYNTHETIC CUSTOMER%' OR r::text LIKE '%vault_secret_id%' THEN RAISE EXCEPTION 'financial_export_metadata_invalid_or_plaintext_leaked';END IF;
 IF (SELECT count(*) FROM jsonb_object_keys(r->'row_counts'))<>10 OR (r->>'fragment_count')::integer<20 THEN RAISE EXCEPTION 'financial_fragment_capture_incomplete';END IF;
 r:=public.sandy_tenant_financial_exports_available(0,50);
 IF r->>'total_count'<>'1' OR r->'items'->0->>'snapshot_id'<>snapshot::text OR public.sandy_tenant_content_exports_available(0,50)->>'total_count'<>'0' THEN RAISE EXCEPTION 'financial_discovery_manifest_partition_invalid';END IF;
 IF public.sandy_tenant_content_fragment_download(snapshot,0)->>'http_status'<>'404' THEN RAISE EXCEPTION 'financial_image_rebound_as_content';END IF;
 stream:='';
 FOR fragment IN SELECT * FROM public.sandy_tenant_content_fragments WHERE snapshot_id=snapshot ORDER BY sequence LOOP
  r:=public.sandy_tenant_financial_fragment_download(snapshot,fragment.sequence);payload:=(r->>'artifact_json')::jsonb;
  IF r->>'ok'<>'true' OR r->>'artifact_sha256' IS DISTINCT FROM encode(extensions.digest(r->>'artifact_json','sha256'),'hex') OR payload->>'manifest'<>manifest->>'id' OR payload->>'snapshot_id'<>snapshot::text THEN RAISE EXCEPTION 'financial_fragment_digest_or_binding_invalid';END IF;
  IF payload->>'table'='sandy_commerce_entries' THEN stream:=stream||(payload->>'json_fragment');END IF;
  IF payload->>'table'='sandy_commerce_invoices' AND payload->>'table_complete'='true' THEN initial_invoice:=payload->>'json_fragment';END IF;
  counted:=counted+1;
 END LOOP;
 IF counted<>(SELECT fragment_count FROM public.sandy_tenant_content_snapshots WHERE id=snapshot) OR char_length((trim(stream)::jsonb)->>'description')<>850000 OR trim(initial_invoice)::jsonb->>'total_minor'<>'922337203685477580700000' THEN RAISE EXCEPTION 'financial_unicode_reassembly_or_decimal_precision_failed';END IF;
 PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',foreign_subject,'role','authenticated')::text,true);
 IF public.sandy_tenant_financial_fragment_download(snapshot,0)->>'http_status'<>'404' OR public.sandy_tenant_financial_exports_available(0,50)->>'total_count'<>'0' THEN RAISE EXCEPTION 'financial_foreign_customer_access_accepted';END IF;
 PERFORM set_config('request.jwt.claims',jsonb_build_object('role','service_role')::text,true);
 IF public.sandy_tenant_financial_fragment_download(snapshot,0)->>'http_status'<>'403' THEN RAISE EXCEPTION 'financial_service_key_became_customer';END IF;
 PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',subject,'role','authenticated')::text,true);
 r:=pg_temp.financial_call('supabase.tenant.content.export',jsonb_build_object('tenant_id',tenant,'manifest','customer_content_fragments_v1','expected_manifest_sha256',public.sandy_tenant_content_manifest_v1()->>'manifest_sha256'));content_snapshot:=(r->>'snapshot_id')::uuid;
 IF public.sandy_tenant_financial_exports_available(0,50)->>'total_count'<>'1' OR public.sandy_tenant_content_exports_available(0,50)->>'total_count'<>'1' OR public.sandy_tenant_financial_fragment_download(content_snapshot,0)->>'http_status'<>'404' OR public.sandy_tenant_content_fragment_download(content_snapshot,0)->>'ok'<>'true' THEN RAISE EXCEPTION 'financial_shared_engine_broke_existing_content';END IF;
 r:=pg_temp.financial_call('supabase.tenant.financial.exports.get',jsonb_build_object('tenant_id',tenant,'snapshot_id',snapshot));
 IF r->>'snapshot_id'<>snapshot::text THEN RAISE EXCEPTION 'financial_snapshot_metadata_get_invalid';END IF;
 refused:=false;BEGIN PERFORM pg_temp.financial_call('supabase.tenant.financial.exports.get',jsonb_build_object('tenant_id',tenant,'snapshot_id',content_snapshot));EXCEPTION WHEN OTHERS THEN IF SQLERRM<>'tenant_content_snapshot_manifest_unsupported' THEN RAISE;END IF;refused:=true;END;
 IF NOT refused THEN RAISE EXCEPTION 'financial_other_manifest_metadata_adopted';END IF;
 refused:=false;BEGIN PERFORM pg_temp.financial_call('supabase.tenant.financial.exports.purge',jsonb_build_object('tenant_id',tenant,'snapshot_id',snapshot,'confirm_artifact_purge',true));EXCEPTION WHEN OTHERS THEN IF SQLERRM<>'tenant_lifecycle_hold_or_retention_refused' THEN RAISE;END IF;refused:=true;END;
 IF NOT refused THEN RAISE EXCEPTION 'financial_artifact_purged_without_erasure_consent';END IF;
 UPDATE public.sandy_supabase_tenant_consents SET allow_erasure=true WHERE tenant_id=tenant;
 INSERT INTO public.sandy_supabase_tenant_controls(tenant_id,legal_hold) VALUES(tenant,true) ON CONFLICT(tenant_id) DO UPDATE SET legal_hold=true;
 refused:=false;BEGIN PERFORM pg_temp.financial_call('supabase.tenant.financial.exports.purge',jsonb_build_object('tenant_id',tenant,'snapshot_id',snapshot,'confirm_artifact_purge',true));EXCEPTION WHEN OTHERS THEN IF SQLERRM<>'tenant_lifecycle_hold_or_retention_refused' THEN RAISE;END IF;refused:=true;END;
 IF NOT refused THEN RAISE EXCEPTION 'financial_held_artifact_purged';END IF;
 UPDATE public.sandy_supabase_tenant_controls SET legal_hold=false,retention_until=clock_timestamp()+interval '1 hour' WHERE tenant_id=tenant;
 refused:=false;BEGIN PERFORM pg_temp.financial_call('supabase.tenant.financial.exports.purge',jsonb_build_object('tenant_id',tenant,'snapshot_id',snapshot,'confirm_artifact_purge',true));EXCEPTION WHEN OTHERS THEN IF SQLERRM<>'tenant_lifecycle_hold_or_retention_refused' THEN RAISE;END IF;refused:=true;END;
 IF NOT refused THEN RAISE EXCEPTION 'financial_retained_artifact_purged';END IF;
 UPDATE public.sandy_supabase_tenant_controls SET retention_until=NULL WHERE tenant_id=tenant;
 UPDATE public.sandy_tenant_content_snapshots SET expires_at=clock_timestamp()-interval '1 second' WHERE id=snapshot;
 IF public.sandy_tenant_financial_fragment_download(snapshot,0)->>'http_status'<>'410' THEN RAISE EXCEPTION 'financial_expired_image_delivered';END IF;
 r:=pg_temp.financial_call('supabase.tenant.financial.exports.purge',jsonb_build_object('tenant_id',tenant,'snapshot_id',snapshot,'confirm_artifact_purge',true));
 IF r->>'state'<>'purged' OR EXISTS(SELECT 1 FROM vault.secrets WHERE name LIKE 'sandy_tenant_content_v1_'||snapshot::text||'_%') OR public.sandy_tenant_financial_fragment_download(snapshot,0)->>'http_status'<>'410' OR NOT EXISTS(SELECT 1 FROM public.sandy_commerce_entries WHERE id=entry_id AND state='posted') THEN RAISE EXCEPTION 'financial_artifact_purge_changed_history_or_left_custody';END IF;
 SELECT encode(extensions.digest(jsonb_agg(part ORDER BY(part->>'sequence')::integer)::text,'sha256'),'hex') INTO after_state FROM public.sandy_tenant_financial_capture_v1(tenant)part;
 IF after_state IS DISTINCT FROM before_state OR NOT EXISTS(SELECT 1 FROM public.sandy_commerce_configuration WHERE customer_id=tenant AND next_invoice_number=9007199254740993) THEN RAISE EXCEPTION 'financial_read_export_or_artifact_purge_changed_history';END IF;
END $test$;
SELECT jsonb_build_object('passed',true,'layer','governed_financial_fragments_database_component','fixtures','full_rollback','real_auth_session_tested',false,'real_owner_approval_tested',false,'financial_state_changed',false,'complete_tenant_coverage',false,'checks',jsonb_build_array('shared_owner_approval_and_one_use_admission','private_digest_bound_financial_fragments','ten_exact_table_completions','multi_MiB_unicode_export','no_plaintext_in_owner_metadata','actual_customer_financial_discovery','old_and_new_manifests_partitioned','all_fragment_SHA256_and_scope_verified','exact_unicode_reassembly_and_numeric30_precision','foreign_customer_refused','service_key_not_customer_session','existing_content_export_download_preserved','same_tenant_cross_manifest_metadata_refused','idempotent_shared_receipt','explicit_erasure_consent_for_artifact_purge','legal_hold_refusal','retention_refusal','expired_customer_download_refused','encrypted_custody_purge','posted_financial_history_and_numbering_unchanged')) AS evidence;
ROLLBACK;
