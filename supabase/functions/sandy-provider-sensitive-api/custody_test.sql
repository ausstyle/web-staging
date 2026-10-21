-- Administrative synthetic PostgreSQL/Vault component checks only.
BEGIN;
CREATE TEMP TABLE sensitive_provider_targets(operation text,target text);
INSERT INTO sensitive_provider_targets VALUES
 ('gcp.backup.data_sources.fetch_access_token.capture','https://backupdr.googleapis.com/v1/projects/elaborate-haven-511518-a5/locations/europe-west1/backupVaults/fixture/dataSources/fixture:fetchAccessToken'),
 ('gcp.compute.instances.get_guest_attributes.capture','https://compute.googleapis.com/compute/v1/projects/elaborate-haven-511518-a5/zones/europe-west1-b/instances/fixture/getGuestAttributes'),
 ('gcp.compute.instances.get_screenshot.capture','https://compute.googleapis.com/compute/v1/projects/elaborate-haven-511518-a5/zones/europe-west1-b/instances/fixture/screenshot'),
 ('gcp.compute.instances.get_shielded_instance_identity.capture','https://compute.googleapis.com/compute/v1/projects/elaborate-haven-511518-a5/zones/europe-west1-b/instances/fixture/getShieldedInstanceIdentity'),
 ('gcp.kms.crypto_key_versions.asymmetric_decrypt.capture','https://cloudkms.googleapis.com/v1/projects/elaborate-haven-511518-a5/locations/europe-west1/keyRings/fixture/cryptoKeys/fixture/cryptoKeyVersions/1:asymmetricDecrypt'),
 ('gcp.kms.crypto_key_versions.asymmetric_sign.capture','https://cloudkms.googleapis.com/v1/projects/elaborate-haven-511518-a5/locations/europe-west1/keyRings/fixture/cryptoKeys/fixture/cryptoKeyVersions/1:asymmetricSign'),
 ('gcp.kms.crypto_key_versions.decapsulate.capture','https://cloudkms.googleapis.com/v1/projects/elaborate-haven-511518-a5/locations/europe-west1/keyRings/fixture/cryptoKeys/fixture/cryptoKeyVersions/1:decapsulate'),
 ('gcp.kms.crypto_key_versions.export_trusted_key_wrapped_crypto_key_version.capture','https://cloudkms.googleapis.com/v1/projects/elaborate-haven-511518-a5/locations/europe-west1/keyRings/fixture/cryptoKeys/fixture/cryptoKeyVersions/1:exportTrustedKeyWrappedCryptoKeyVersion?wrappingKey=projects%2Felaborate-haven-511518-a5%2Flocations%2Feurope-west1%2FkeyRings%2Ffixture%2FcryptoKeys%2Ffixture%2FcryptoKeyVersions%2F1'),
 ('gcp.kms.crypto_key_versions.get_public_key.capture','https://cloudkms.googleapis.com/v1/projects/elaborate-haven-511518-a5/locations/europe-west1/keyRings/fixture/cryptoKeys/fixture/cryptoKeyVersions/1/publicKey'),
 ('gcp.kms.crypto_key_versions.import_trusted_key_wrapped_crypto_key_version.capture','https://cloudkms.googleapis.com/v1/projects/elaborate-haven-511518-a5/locations/europe-west1/keyRings/fixture/cryptoKeys/fixture/cryptoKeyVersions:importTrustedKeyWrappedCryptoKeyVersion'),
 ('gcp.kms.crypto_key_versions.mac_sign.capture','https://cloudkms.googleapis.com/v1/projects/elaborate-haven-511518-a5/locations/europe-west1/keyRings/fixture/cryptoKeys/fixture/cryptoKeyVersions/1:macSign'),
 ('gcp.kms.crypto_key_versions.mac_verify.capture','https://cloudkms.googleapis.com/v1/projects/elaborate-haven-511518-a5/locations/europe-west1/keyRings/fixture/cryptoKeys/fixture/cryptoKeyVersions/1:macVerify'),
 ('gcp.kms.crypto_key_versions.raw_decrypt.capture','https://cloudkms.googleapis.com/v1/projects/elaborate-haven-511518-a5/locations/europe-west1/keyRings/fixture/cryptoKeys/fixture/cryptoKeyVersions/1:rawDecrypt'),
 ('gcp.kms.crypto_key_versions.raw_encrypt.capture','https://cloudkms.googleapis.com/v1/projects/elaborate-haven-511518-a5/locations/europe-west1/keyRings/fixture/cryptoKeys/fixture/cryptoKeyVersions/1:rawEncrypt'),
 ('gcp.kms.crypto_keys.decrypt.capture','https://cloudkms.googleapis.com/v1/projects/elaborate-haven-511518-a5/locations/europe-west1/keyRings/fixture/cryptoKeys/fixture:decrypt'),
 ('gcp.kms.crypto_keys.encrypt.capture','https://cloudkms.googleapis.com/v1/projects/elaborate-haven-511518-a5/locations/europe-west1/keyRings/fixture/cryptoKeys/fixture:encrypt'),
 ('gcp.kubernetes.clusters.get_jwks.capture','https://container.googleapis.com/v1/projects/elaborate-haven-511518-a5/locations/europe-west1/clusters/fixture/jwks'),
 ('gcp.monitoring.notification_channels.get_verification_code.capture','https://monitoring.googleapis.com/v3/projects/elaborate-haven-511518-a5/notificationChannels/123:getVerificationCode');
DO $test$
DECLARE actor uuid:=gen_random_uuid(); aid uuid; approval uuid; entry record; context jsonb; receipt jsonb; secret_id uuid;
 payload text:='SYNTHETIC-PRIVATE-PROTOCOL-NOT-A-CREDENTIAL'; denied boolean; n integer:=0; resolver_source text;
BEGIN
 IF (SELECT count(*) FROM public.sandy_operation_registry WHERE handler='sandy-provider-sensitive-api')<>18
 OR EXISTS(SELECT 1 FROM public.sandy_operation_registry WHERE handler='sandy-provider-sensitive-api' AND (api_exposed OR ai_exposed OR verified OR ui_exposed
 OR error_contract->>'requires_approval' IS DISTINCT FROM 'true' OR error_contract->>'api_key_delegable' IS DISTINCT FROM 'false'))
 THEN RAISE EXCEPTION 'sensitive_closed_registry_mismatch'; END IF;
 IF EXISTS(SELECT 1 FROM pg_temp.sensitive_registry_before b LEFT JOIN public.sandy_operation_registry r USING(operation) WHERE to_jsonb(r) IS DISTINCT FROM b.snapshot)
 THEN RAISE EXCEPTION 'existing_registry_changed'; END IF;
 IF has_function_privilege('service_role','public.sandy_provider_supplement_context(jsonb)','EXECUTE')
 OR has_function_privilege('authenticated','public.sandy_provider_supplement_save_opaque(jsonb)','EXECUTE')
 OR has_table_privilege('service_role','public.sandy_provider_supplement_opaque','SELECT')
 OR has_function_privilege('anon','public.sandy_credential_resolve_consumer(text,uuid,uuid,text)','EXECUTE')
 THEN RAISE EXCEPTION 'sensitive_private_acl_changed'; END IF;
 SELECT prosrc INTO resolver_source FROM pg_proc WHERE oid='public.sandy_credential_resolve_consumer(text,uuid,uuid,text)'::regprocedure;
 IF position('sandy-provider-sensitive-api' in resolver_source)=0 OR position('sandy_provider_read_admission_proofs' in resolver_source)=0
 OR position('consumer_active_pointer_removed' in resolver_source)=0 OR position('consumer_active_readback_required' in resolver_source)=0
 OR position('consumer_pointer_changed_during_execution' in resolver_source)=0 THEN RAISE EXCEPTION 'consumer_guard_lost'; END IF;
 INSERT INTO public.sandy_controller_admins(auth_user_id,role,enabled) VALUES(actor,'owner',true);
 FOR entry IN SELECT r.operation,r.is_mutation,t.target FROM public.sandy_operation_registry r JOIN sensitive_provider_targets t USING(operation) ORDER BY r.operation LOOP
  aid:=gen_random_uuid(); approval:=gen_random_uuid();
  INSERT INTO public.sandy_deployment_jobs(id,requested_by,provider,operation,target,idempotency_key,status)
  VALUES(approval,'sensitive_rollback_only','google_cloud','get_vm','synthetic-no-provider',approval::text,'pending_approval');
  UPDATE public.sandy_operation_registry SET api_exposed=true,verified=true WHERE operation=entry.operation;
  INSERT INTO public.sandy_api_execution_admissions(id,actor_id,operation,request_id,is_mutation,input_sha256,contract_sha256,scope_sha256,registry_revision_sha256,declared_cost_units,state,expires_at,approval_id)
  VALUES(aid,actor,entry.operation,gen_random_uuid(),entry.is_mutation,repeat('a',64),repeat('b',64),repeat('c',64),public.sandy_api_registry_revision(entry.operation),0,'consumed',clock_timestamp()+interval '5 minutes',approval);
  context:=jsonb_build_object('actor',actor,'admission',aid,'operation',entry.operation,'scope_sha256',repeat('c',64),'input_sha256',repeat('a',64),
   'binding_sha256',repeat('d',64),'target',entry.target,'kind','artifact','payload_base64',encode(convert_to(payload,'UTF8'),'base64'),
   'payload_sha256',encode(extensions.digest(payload,'sha256'),'hex'),'byte_length',octet_length(payload),'media_type','application/json');
  denied:=false; BEGIN PERFORM public.sandy_provider_supplement_save_opaque(context||jsonb_build_object('target',replace(entry.target,'elaborate-haven-511518-a5','foreign')));
  EXCEPTION WHEN OTHERS THEN IF SQLERRM<>'supplement_fixed_resource_required' THEN RAISE; END IF; denied:=true; END;
  IF NOT denied THEN RAISE EXCEPTION 'sensitive_foreign_resource_accepted %',entry.operation; END IF;
  receipt:=public.sandy_provider_supplement_save_opaque(context);
  IF receipt ? 'payload_base64' OR receipt ? 'token' OR receipt ? 'target' THEN RAISE EXCEPTION 'sensitive_public_receipt_disclosed_content'; END IF;
  SELECT vault_secret_id INTO secret_id FROM public.sandy_provider_supplement_opaque WHERE id=(receipt->>'custody_id')::uuid;
  IF (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE id=secret_id) IS DISTINCT FROM encode(convert_to(payload,'UTF8'),'base64')
  THEN RAISE EXCEPTION 'sensitive_dummy_vault_capture_failed'; END IF;
  denied:=false; BEGIN PERFORM public.sandy_provider_supplement_take_opaque(context,(receipt->>'custody_id')::uuid);
  EXCEPTION WHEN OTHERS THEN denied:=SQLERRM='supplement_opaque_binding_expired_or_used'; END;
  IF NOT denied THEN RAISE EXCEPTION 'sensitive_artifact_readable_as_cursor'; END IF;
  n:=n+1;
 END LOOP;
 IF n<>18 THEN RAISE EXCEPTION 'sensitive_target_matrix_incomplete'; END IF;
END $test$;
SELECT jsonb_build_object('passed',true,'layer','administrative_private_protocol_custody_component','protocols',18,'foreign_resource_refusals',18,
 'artifacts_not_cursor_readable',18,'existing_registry_unchanged_before_fixture',true,'provider_called',false,'auth_session_tested',false,
 'real_approval_tested',false,'credential_resolved',false,'all_changes_rolled_back',true) AS evidence;
ROLLBACK;
