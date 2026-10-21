BEGIN;
-- Negative authorization and schema tests only. Synthetic UUIDs do not create
-- Auth users, owners, approvals, credentials or external provider requests.
DO $custody_test$
DECLARE
 actor uuid:='10000000-0000-4000-8000-000000000001';
 target uuid:='10000000-0000-4000-8000-000000000002';
 admission uuid:='10000000-0000-4000-8000-000000000003';
 rejected boolean;
 material_id uuid;
 key_resource jsonb:='{"service_account":"sandy-computer@elaborate-haven-511518-a5.iam.gserviceaccount.com"}';
 key_fixture text:='{"type":"service_account","project_id":"elaborate-haven-511518-a5","client_email":"sandy-computer@elaborate-haven-511518-a5.iam.gserviceaccount.com","token_uri":"https://oauth2.googleapis.com/token","private_key_id":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","private_key":"synthetic noncredential not an RSA key"}';
 key_identity text;
 bad_material text;
BEGIN
 IF has_table_privilege('anon','public.sandy_credential_targets','SELECT') OR has_table_privilege('authenticated','public.sandy_credential_versions','SELECT') OR has_table_privilege('authenticated','public.sandy_credential_rotations','SELECT') THEN RAISE EXCEPTION 'credential_custody_metadata_exposed'; END IF;
 IF has_table_privilege('service_role','public.sandy_credential_targets','INSERT') OR has_table_privilege('service_role','public.sandy_credential_targets','UPDATE') OR has_table_privilege('service_role','public.sandy_credential_targets','DELETE') OR has_table_privilege('service_role','public.sandy_credential_versions','INSERT') OR has_table_privilege('service_role','public.sandy_credential_versions','UPDATE') OR has_table_privilege('service_role','public.sandy_credential_versions','DELETE') OR has_table_privilege('service_role','public.sandy_credential_rotations','INSERT') OR has_table_privilege('service_role','public.sandy_credential_rotations','UPDATE') OR has_table_privilege('service_role','public.sandy_credential_rotations','DELETE') THEN RAISE EXCEPTION 'credential_direct_service_writes_exposed'; END IF;
 IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid='public.sandy_credential_versions'::regclass) THEN RAISE EXCEPTION 'credential_custody_rls_missing'; END IF;
 IF has_function_privilege('authenticated','public.sandy_credential_material(uuid,uuid,uuid,text)','EXECUTE') OR has_function_privilege('anon','public.sandy_credential_store_version(uuid,uuid,uuid,text)','EXECUTE') THEN RAISE EXCEPTION 'credential_plaintext_rpc_exposed'; END IF;
 IF NOT has_function_privilege('service_role','public.sandy_credential_material(uuid,uuid,uuid,text)','EXECUTE') THEN RAISE EXCEPTION 'credential_service_material_rpc_missing'; END IF;
 IF has_function_privilege('service_role','public.sandy_credential_assert_admission(uuid,uuid,text,text)','EXECUTE') THEN RAISE EXCEPTION 'credential_private_assertion_exposed'; END IF;
 IF has_function_privilege('service_role','public.sandy_credential_key_version(jsonb,text)','EXECUTE') OR has_function_privilege('service_role','public.sandy_credential_key_identity(jsonb,text,text)','EXECUTE') OR has_function_privilege('authenticated','public.sandy_credential_key_identity(jsonb,text,text)','EXECUTE') THEN RAISE EXCEPTION 'credential_private_key_helper_exposed'; END IF;
 -- Fixed dummy JSON tests identity binding only, not private key cryptography.
 key_identity:=public.sandy_credential_key_identity(key_resource,key_fixture);
 IF key_identity<>'projects/elaborate-haven-511518-a5/serviceAccounts/sandy-computer@elaborate-haven-511518-a5.iam.gserviceaccount.com/keys/'||repeat('a',40) OR public.sandy_credential_key_identity(key_resource,key_fixture,replace(key_identity,'projects/elaborate-haven-511518-a5/','projects/1030223524306/'))<>key_identity OR public.sandy_credential_key_identity(key_resource,key_fixture,replace(key_identity,'projects/elaborate-haven-511518-a5/','projects/-/'))<>key_identity THEN RAISE EXCEPTION 'credential_key_identity_canonicalization_failed'; END IF;
 FOREACH bad_material IN ARRAY ARRAY[replace(key_fixture,'"project_id":"elaborate-haven-511518-a5"','"project_id":"foreign-project"'),replace(key_fixture,'"client_email":"sandy-computer@','"client_email":"foreign@')] LOOP
  rejected:=false;
  BEGIN PERFORM public.sandy_credential_key_identity(key_resource,bad_material); EXCEPTION WHEN OTHERS THEN IF SQLERRM<>'credential_key_scope_mismatch' THEN RAISE; END IF;rejected:=true;END;
  IF NOT rejected THEN RAISE EXCEPTION 'foreign_key_material_accepted'; END IF;
 END LOOP;
 rejected:=false;
 BEGIN PERFORM public.sandy_credential_key_identity(key_resource,'invalid synthetic JSON'); EXCEPTION WHEN OTHERS THEN IF SQLERRM<>'credential_key_format_invalid' THEN RAISE; END IF;rejected:=true;END;
 IF NOT rejected THEN RAISE EXCEPTION 'invalid_key_json_accepted'; END IF;
 rejected:=false;
 BEGIN PERFORM public.sandy_credential_key_identity(key_resource,key_fixture,replace(key_identity,repeat('a',40),repeat('b',40))); EXCEPTION WHEN OTHERS THEN IF SQLERRM<>'credential_key_scope_mismatch' THEN RAISE; END IF;rejected:=true;END;
 IF NOT rejected THEN RAISE EXCEPTION 'mismatched_custody_key_identity_accepted'; END IF;
 IF has_function_privilege('authenticated','public.sandy_credential_probe_start(uuid,uuid,uuid)','EXECUTE') OR has_function_privilege('anon','public.sandy_credential_claim_unstaged_key(uuid,uuid,uuid)','EXECUTE') OR has_function_privilege('authenticated','public.sandy_credential_resolve_unstaged_key(uuid,uuid,uuid)','EXECUTE') THEN RAISE EXCEPTION 'credential_reconciliation_rpc_exposed'; END IF;
 INSERT INTO public.sandy_credential_targets(id,provider,resource,scope_sha256,config_sha256) VALUES(target,'supabase_edge_secret','{"secret_name":"SANDY_ROTATION_TEST_SECRET"}',repeat('a',64),repeat('b',64));
 IF (SELECT enabled OR verified FROM public.sandy_credential_targets WHERE id=target) THEN RAISE EXCEPTION 'credential_targets_enabled_by_default'; END IF;
 rejected:=false;
 BEGIN PERFORM public.sandy_credential_store_version(target,actor,admission,'synthetic fixture not a credential'); EXCEPTION WHEN OTHERS THEN IF SQLERRM<>'verified_credential_target_required' THEN RAISE; END IF;rejected:=true;END;
 IF NOT rejected THEN RAISE EXCEPTION 'unverified_target_stored_material'; END IF;
 INSERT INTO public.sandy_api_execution_admissions(id,actor_id,operation,request_id,is_mutation,input_sha256,contract_sha256,scope_sha256,registry_revision_sha256,declared_cost_units,state,expires_at)
 VALUES(admission,actor,'supabase.vault.secrets.create_version',gen_random_uuid(),true,repeat('c',64),repeat('d',64),repeat('a',64),repeat('e',64),0,'consumed',clock_timestamp()+interval '1 minute');
 UPDATE public.sandy_credential_targets SET enabled=true,verified=true WHERE id=target;
 rejected:=false;
 BEGIN PERFORM public.sandy_credential_store_version(target,actor,admission,'synthetic fixture not a credential'); EXCEPTION WHEN OTHERS THEN IF SQLERRM<>'credential_scoped_admission_required' THEN RAISE; END IF;rejected:=true;END;
 IF NOT rejected THEN RAISE EXCEPTION 'synthetic_nonowner_without_approval_stored_material'; END IF;
 rejected:=false;
 BEGIN PERFORM public.sandy_credential_material(gen_random_uuid(),actor,admission,'prior'); EXCEPTION WHEN OTHERS THEN IF SQLERRM<>'credential_rotation_not_found' THEN RAISE; END IF;rejected:=true;END;
 IF NOT rejected THEN RAISE EXCEPTION 'unbound_rotation_read_plaintext'; END IF;
 rejected:=false;
 BEGIN PERFORM public.sandy_credential_claim_unstaged_key(gen_random_uuid(),actor,admission); EXCEPTION WHEN OTHERS THEN IF SQLERRM<>'credential_unstaged_key_identity_unconfirmed' THEN RAISE; END IF;rejected:=true;END;
 IF NOT rejected THEN RAISE EXCEPTION 'unbound_rotation_authorized_key_cleanup'; END IF;
 rejected:=false;
 BEGIN PERFORM public.sandy_credential_probe_start(gen_random_uuid(),actor,admission); EXCEPTION WHEN OTHERS THEN IF SQLERRM<>'credential_probe_binding_required' THEN RAISE; END IF;rejected:=true;END;
 IF NOT rejected THEN RAISE EXCEPTION 'unbound_rotation_authorized_workflow_dispatch'; END IF;
 IF EXISTS(SELECT 1 FROM public.sandy_credential_versions WHERE target_id=target) THEN RAISE EXCEPTION 'refused_calls_created_custody_versions'; END IF;
 -- Exercise the installed Vault signature with a disposable, noncredential
 -- string; return only assertion success. The transaction is always rolled back.
 material_id:=vault.create_secret('synthetic-custody-test-NOT-A-CREDENTIAL','SANDY_CUSTODY_SQL_TEST_'||gen_random_uuid()::text,'Rollback-only encryption assertion');
 IF NOT EXISTS(SELECT 1 FROM vault.decrypted_secrets WHERE id=material_id AND decrypted_secret='synthetic-custody-test-NOT-A-CREDENTIAL') THEN RAISE EXCEPTION 'vault_signature_or_encryption_failed'; END IF;
 IF EXISTS(SELECT 1 FROM vault.secrets WHERE id=material_id AND secret='synthetic-custody-test-NOT-A-CREDENTIAL') THEN RAISE EXCEPTION 'vault_material_not_encrypted'; END IF;
 DELETE FROM vault.secrets WHERE id=material_id;
END $custody_test$;
SELECT true AS custody_schema_permissions_fail_closed_and_encryption_passed;
ROLLBACK;
