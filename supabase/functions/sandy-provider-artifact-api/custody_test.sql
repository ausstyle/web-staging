-- Synthetic private Vault fixtures under administrative SQL; no Auth or provider attestation.
BEGIN;
CREATE FUNCTION pg_temp.artifact_test_read(p_actor uuid,p_args jsonb) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE approval uuid:=gen_random_uuid(); admission uuid:=gen_random_uuid(); scope jsonb; hash text;
BEGIN
 INSERT INTO public.sandy_deployment_jobs(id,requested_by,provider,operation,target,idempotency_key,status)
 VALUES(approval,'artifact_rollback_only','google_cloud','get_vm','synthetic-no-provider',approval::text,'pending_approval');
 scope:=jsonb_build_object('provider','sandy_private_artifacts','artifact_class','provider_download','project_ref','zmqlyygzqoidkcwdysok',
 'custody_id',p_args->>'custody_id','expected_sha256',p_args->>'expected_sha256','source_operation',p_args->>'source_operation',
 'source_input_sha256',p_args->>'source_input_sha256','source_scope_sha256',p_args->>'source_scope_sha256');
 SELECT error_contract->>'contract_sha256' INTO hash FROM public.sandy_operation_registry WHERE operation='provider.artifacts.read_private';
 INSERT INTO public.sandy_api_execution_admissions(id,actor_id,operation,request_id,is_mutation,input_sha256,contract_sha256,scope_sha256,registry_revision_sha256,declared_cost_units,state,expires_at,approval_id)
 VALUES(admission,p_actor,'provider.artifacts.read_private',gen_random_uuid(),false,encode(extensions.digest(p_args::text,'sha256'),'hex'),hash,encode(extensions.digest(scope::text,'sha256'),'hex'),public.sandy_api_registry_revision('provider.artifacts.read_private'),0,'consumed',clock_timestamp()+interval '5 minutes',approval);
 RETURN public.sandy_provider_artifact_deliver(p_actor,admission,p_args::text,scope::text);
END $$;
DO $test$
DECLARE actor uuid:=gen_random_uuid(); foreign_actor uuid:=gen_random_uuid(); source_admission uuid; approval uuid; source text; target text; contract_hash text;
 context jsonb; args jsonb; result jsonb; capture jsonb; secret_id uuid; denied boolean; bad text; material text; payload text:='SYNTHETIC-ARTIFACT-NOT-A-CREDENTIAL';
BEGIN
 IF EXISTS(SELECT 1 FROM pg_temp.artifact_registry_before b LEFT JOIN public.sandy_operation_registry r USING(operation) WHERE to_jsonb(r) IS DISTINCT FROM b.snapshot) THEN RAISE EXCEPTION 'artifact_migration_changed_existing_registry'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.sandy_operation_registry WHERE operation='provider.artifacts.read_private' AND handler='sandy-provider-artifact-api' AND NOT api_exposed AND NOT ai_exposed AND NOT ui_exposed AND NOT verified)
 OR has_function_privilege('anon','public.sandy_provider_artifact_deliver(uuid,uuid,text,text)','EXECUTE')
 OR has_function_privilege('authenticated','public.sandy_provider_artifact_deliver(uuid,uuid,text,text)','EXECUTE')
 OR NOT has_function_privilege('service_role','public.sandy_provider_artifact_deliver(uuid,uuid,text,text)','EXECUTE')
 OR has_table_privilege('service_role','public.sandy_provider_supplement_opaque','SELECT') THEN RAISE EXCEPTION 'artifact_delivery_acl_or_closed_registry_mismatch'; END IF;
 INSERT INTO public.sandy_controller_admins(auth_user_id,role,enabled) VALUES(actor,'owner',true),(foreign_actor,'owner',true);
 UPDATE public.sandy_operation_registry SET api_exposed=true,verified=true WHERE operation='provider.artifacts.read_private';
 FOR source,target IN SELECT * FROM (VALUES
 ('github.actions.jobs.logs.capture','https://api.github.com/repos/ausstyle/web-staging/actions/jobs/1/logs'),
 ('github.actions.jobs.steps.logs.capture','https://api.github.com/repos/ausstyle/web-staging/actions/jobs/1/steps/1/logs'),
 ('github.actions.runs.attempts.logs.capture','https://api.github.com/repos/ausstyle/web-staging/actions/runs/1/attempts/1/logs'),
 ('github.actions.runs.logs.capture','https://api.github.com/repos/ausstyle/web-staging/actions/runs/1/logs'),
 ('github.actions.artifacts.download.capture','https://api.github.com/repos/ausstyle/web-staging/actions/artifacts/1/zip'),
 ('gcp.artifacts.files.download.capture','https://artifactregistry.googleapis.com/v1/projects/elaborate-haven-511518-a5/locations/europe-west1/repositories/fixture/files/a:download?alt=media')) v(source,target) LOOP
  UPDATE public.sandy_operation_registry SET api_exposed=true,verified=true WHERE operation=source;
  SELECT error_contract->>'contract_sha256' INTO contract_hash FROM public.sandy_operation_registry WHERE operation=source;
  source_admission:=gen_random_uuid();approval:=gen_random_uuid();
  INSERT INTO public.sandy_deployment_jobs(id,requested_by,provider,operation,target,idempotency_key,status)
  VALUES(approval,'artifact_rollback_only','google_cloud','get_vm','synthetic-no-provider',approval::text,'pending_approval');
  INSERT INTO public.sandy_api_execution_admissions(id,actor_id,operation,request_id,is_mutation,input_sha256,contract_sha256,scope_sha256,registry_revision_sha256,declared_cost_units,state,expires_at,approval_id)
  VALUES(source_admission,actor,source,gen_random_uuid(),false,repeat('a',64),contract_hash,repeat('b',64),public.sandy_api_registry_revision(source),0,'consumed',clock_timestamp()+interval '5 minutes',approval);
  material:=replace(encode(convert_to(payload,'UTF8'),'base64'),chr(10),'');
  context:=jsonb_build_object('actor',actor,'admission',source_admission,'operation',source,'scope_sha256',repeat('b',64),'input_sha256',repeat('a',64),
   'binding_sha256',repeat('c',64),'target',target,'kind','artifact','payload_base64',material,'payload_sha256',encode(extensions.digest(payload,'sha256'),'hex'),'byte_length',octet_length(payload),'media_type','application/octet-stream');
  capture:=public.sandy_provider_supplement_save_opaque(context);
  IF NOT EXISTS(SELECT 1 FROM public.sandy_provider_supplement_opaque WHERE id=(capture->>'custody_id')::uuid
   AND expires_at=created_at+interval '10 minutes' AND expires_at>clock_timestamp())
  THEN RAISE EXCEPTION 'artifact_single_timestamp_ttl_bound_failed'; END IF;
  UPDATE public.sandy_api_execution_admissions SET state='succeeded' WHERE id=source_admission;
  args:=jsonb_build_object('custody_id',capture->>'custody_id','expected_sha256',capture->>'sha256','source_operation',source,'source_input_sha256',repeat('a',64),'source_scope_sha256',repeat('b',64));
  denied:=false;BEGIN PERFORM pg_temp.artifact_test_read(foreign_actor,args);EXCEPTION WHEN OTHERS THEN IF SQLERRM<>'artifact_delivery_binding_expired_or_used' THEN RAISE;END IF;denied:=true;END;IF NOT denied THEN RAISE EXCEPTION 'artifact_foreign_owner_accepted'; END IF;
  FOR bad IN SELECT unnest(ARRAY['expected_sha256','source_input_sha256','source_scope_sha256']) LOOP
   denied:=false;BEGIN PERFORM pg_temp.artifact_test_read(actor,args||jsonb_build_object(bad,repeat('f',64)));EXCEPTION WHEN OTHERS THEN IF SQLERRM<>'artifact_delivery_binding_expired_or_used' THEN RAISE;END IF;denied:=true;END;IF NOT denied THEN RAISE EXCEPTION 'artifact_changed_digest_accepted'; END IF;
  END LOOP;
  FOREACH bad IN ARRAY ARRAY['supabase.functions.body.capture','gcp.kms.crypto.decrypt.capture','gcp.backups.access_token.capture','gcp.pubsub.snapshots.list.bound'] LOOP
   denied:=false;BEGIN PERFORM pg_temp.artifact_test_read(actor,args||jsonb_build_object('source_operation',bad));EXCEPTION WHEN OTHERS THEN IF SQLERRM<>'artifact_delivery_source_class_required' THEN RAISE;END IF;denied:=true;END;IF NOT denied THEN RAISE EXCEPTION 'artifact_sensitive_source_class_accepted'; END IF;
  END LOOP;
  UPDATE public.sandy_provider_supplement_opaque SET kind='redirect' WHERE id=(capture->>'custody_id')::uuid;
  denied:=false;BEGIN PERFORM pg_temp.artifact_test_read(actor,args);EXCEPTION WHEN OTHERS THEN IF SQLERRM<>'artifact_delivery_binding_expired_or_used' THEN RAISE;END IF;denied:=true;END;IF NOT denied THEN RAISE EXCEPTION 'artifact_redirect_material_accepted'; END IF;
  UPDATE public.sandy_provider_supplement_opaque SET kind='artifact',created_at=clock_timestamp()-interval '2 minutes',expires_at=clock_timestamp()-interval '1 second' WHERE id=(capture->>'custody_id')::uuid;
  denied:=false;BEGIN PERFORM pg_temp.artifact_test_read(actor,args);EXCEPTION WHEN OTHERS THEN IF SQLERRM<>'artifact_delivery_binding_expired_or_used' THEN RAISE;END IF;denied:=true;END;IF NOT denied THEN RAISE EXCEPTION 'artifact_expired_material_accepted'; END IF;
  UPDATE public.sandy_provider_supplement_opaque SET created_at=clock_timestamp(),expires_at=clock_timestamp()+interval '5 minutes' WHERE id=(capture->>'custody_id')::uuid;
  UPDATE public.sandy_api_execution_admissions SET state='unknown' WHERE id=source_admission;
  denied:=false;BEGIN PERFORM pg_temp.artifact_test_read(actor,args);EXCEPTION WHEN OTHERS THEN IF SQLERRM<>'artifact_delivery_source_not_succeeded' THEN RAISE;END IF;denied:=true;END;IF NOT denied THEN RAISE EXCEPTION 'artifact_ambiguous_source_accepted'; END IF;
  UPDATE public.sandy_api_execution_admissions SET state='succeeded' WHERE id=source_admission;
  UPDATE public.sandy_operation_registry SET error_contract=error_contract||'{"requires_approval":false}' WHERE operation=source;
  denied:=false;BEGIN PERFORM pg_temp.artifact_test_read(actor,args);EXCEPTION WHEN OTHERS THEN IF SQLERRM<>'artifact_delivery_source_contract_changed' THEN RAISE;END IF;denied:=true;END;IF NOT denied THEN RAISE EXCEPTION 'artifact_drifted_source_contract_accepted'; END IF;
  UPDATE public.sandy_operation_registry SET error_contract=error_contract||'{"requires_approval":true}' WHERE operation=source;
  -- A registry revision includes mutable timestamps; restore the full captured
  -- revision explicitly for this synthetic fixture after the drift test.
  UPDATE public.sandy_api_execution_admissions SET registry_revision_sha256=public.sandy_api_registry_revision(source) WHERE id=source_admission;
  UPDATE public.sandy_provider_supplement_opaque SET registry_revision_sha256=public.sandy_api_registry_revision(source) WHERE id=(capture->>'custody_id')::uuid;
  SELECT vault_secret_id INTO secret_id FROM public.sandy_provider_supplement_opaque WHERE id=(capture->>'custody_id')::uuid;
  PERFORM vault.update_secret(secret_id,'Y29ycnVwdGVk');
  denied:=false;BEGIN PERFORM pg_temp.artifact_test_read(actor,args);EXCEPTION WHEN OTHERS THEN IF SQLERRM<>'artifact_delivery_integrity_failed' THEN RAISE;END IF;denied:=true;END;IF NOT denied THEN RAISE EXCEPTION 'artifact_corrupt_vault_material_accepted'; END IF;
  PERFORM vault.update_secret(secret_id,material);
  result:=pg_temp.artifact_test_read(actor,args);
  IF result->>'content_base64' IS DISTINCT FROM material OR result->>'sha256' IS DISTINCT FROM capture->>'sha256' OR result->>'content_returned' IS DISTINCT FROM 'true'
   OR result ? 'target' OR result ? 'url' OR result ? 'token' THEN RAISE EXCEPTION 'artifact_exact_private_delivery_receipt_failed'; END IF;
  denied:=false;BEGIN PERFORM pg_temp.artifact_test_read(actor,args);EXCEPTION WHEN OTHERS THEN IF SQLERRM<>'artifact_delivery_binding_expired_or_used' THEN RAISE;END IF;denied:=true;END;IF NOT denied THEN RAISE EXCEPTION 'artifact_reused_material_accepted'; END IF;
  -- Synthetic recognizable private-key marker, deliberately not a real key.
  source_admission:=gen_random_uuid();approval:=gen_random_uuid();
  INSERT INTO public.sandy_deployment_jobs(id,requested_by,provider,operation,target,idempotency_key,status)
  VALUES(approval,'artifact_rollback_only','google_cloud','get_vm','synthetic-no-provider',approval::text,'pending_approval');
  INSERT INTO public.sandy_api_execution_admissions(id,actor_id,operation,request_id,is_mutation,input_sha256,contract_sha256,scope_sha256,registry_revision_sha256,declared_cost_units,state,expires_at,approval_id)
  VALUES(source_admission,actor,source,gen_random_uuid(),false,repeat('a',64),contract_hash,repeat('b',64),public.sandy_api_registry_revision(source),0,'consumed',clock_timestamp()+interval '5 minutes',approval);
  material:='-----BEGIN PRIVATE KEY-----SYNTHETIC-NOT-A-KEY';
  capture:=public.sandy_provider_supplement_save_opaque(context||jsonb_build_object('admission',source_admission,'payload_base64',encode(convert_to(material,'UTF8'),'base64'),'payload_sha256',encode(extensions.digest(material,'sha256'),'hex'),'byte_length',octet_length(material)));
  UPDATE public.sandy_api_execution_admissions SET state='succeeded' WHERE id=source_admission;
  args:=args||jsonb_build_object('custody_id',capture->>'custody_id','expected_sha256',capture->>'sha256');
  denied:=false;BEGIN PERFORM pg_temp.artifact_test_read(actor,args);EXCEPTION WHEN OTHERS THEN IF SQLERRM<>'artifact_delivery_credential_material_refused' THEN RAISE;END IF;denied:=true;END;IF NOT denied THEN RAISE EXCEPTION 'artifact_recognizable_credential_material_accepted'; END IF;
 END LOOP;
END $test$;
SELECT jsonb_build_object('passed',true,'layer','administrative_artifact_delivery_private_vault_component','source_classes',6,
 'exact_dummy_byte_delivery',true,'same_actor_and_all_digests_enforced',true,'expiry_kind_replay_source_state_and_registry_drift_refused',true,
 'exact_single_timestamp_10minute_ttl_all6_classes',true,
 'credential_token_functionsource_cursor_classes_refused',true,'corrupt_vault_payload_refused',true,
 'recognizable_synthetic_credential_material_refused',true,
 'provider_called',false,'auth_session_tested',false,'real_approval_tested',false,'all_changes_rolled_back',true) AS evidence;
ROLLBACK;
