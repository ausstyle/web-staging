-- Real PostgreSQL component fixture only. Synthetic private owner/admission
-- rows never become an Auth session, reach a provider or establish verification.
-- Run after additive06200 in this same transaction; everything rolls back.
BEGIN;
SET LOCAL statement_timeout='15s';
SET LOCAL lock_timeout='3s';
DO $read_test$
DECLARE actor uuid:=gen_random_uuid(); admission uuid:=gen_random_uuid(); request_id uuid:=gen_random_uuid();grant_id uuid:=gen_random_uuid();
 op text:='supabase.branches.get';canonical text:='{"name":"approved-fixture"}';scope_sha text;input_sha text;payload jsonb;result jsonb;refused boolean;patch jsonb;
BEGIN
 IF EXISTS(SELECT 1 FROM public.sandy_credential_consumer_bindings) THEN RAISE EXCEPTION 'provider_read_fixture_requires_empty_consumer_bindings';END IF;
 IF has_function_privilege('anon','public.sandy_provider_read_authorize(jsonb)','EXECUTE')
  OR has_function_privilege('authenticated','public.sandy_provider_read_authorize(jsonb)','EXECUTE')
  OR NOT has_function_privilege('service_role','public.sandy_provider_read_authorize(jsonb)','EXECUTE')
  OR has_function_privilege('service_role','public.sandy_provider_read_proof_immutable()','EXECUTE')
  OR has_table_privilege('service_role','public.sandy_provider_read_admission_proofs','SELECT,INSERT,UPDATE,DELETE')
  THEN RAISE EXCEPTION 'provider_read_private_acl_invalid';END IF;
 IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid='public.sandy_provider_read_admission_proofs'::regclass) THEN RAISE EXCEPTION 'provider_read_private_rls_missing';END IF;
 INSERT INTO public.sandy_controller_admins(auth_user_id,role,enabled) VALUES(actor,'owner',true);
 scope_sha:=encode(extensions.digest('{"permission_scope":"infrastructure:read","sandy_project_ref":"zmqlyygzqoidkcwdysok"}','sha256'),'hex');
 input_sha:=encode(extensions.digest(canonical,'sha256'),'hex');
 INSERT INTO public.sandy_api_execution_admissions(id,grant_id,actor_id,operation,request_id,is_mutation,input_sha256,contract_sha256,scope_sha256,registry_revision_sha256,declared_cost_units,state,expires_at)
 VALUES(admission,grant_id,actor,op,request_id,false,input_sha,repeat('b',64),scope_sha,public.sandy_api_registry_revision(op),0,'consumed',clock_timestamp()+interval '5 minutes');
 payload:=jsonb_build_object('protocol','consumed-admission-v1','operation',op,'arguments',canonical::jsonb,'arguments_canonical',canonical,
  'actor_id',actor,'tenant_id',NULL,'request_id',request_id,'grant_id',grant_id,'admission_id',admission,'credential_id',NULL,'input_sha256',input_sha,'scope_sha256',scope_sha);
 refused:=false;BEGIN PERFORM public.sandy_credential_resolve_consumer('supabase_management',actor,admission,op);EXCEPTION WHEN OTHERS THEN IF SQLERRM<>'consumer_scoped_admission_required' THEN RAISE;END IF;refused:=true;END;
 IF NOT refused THEN RAISE EXCEPTION 'provider_read_credential_before_actual_argument_claim';END IF;
 FOR patch IN SELECT value FROM jsonb_array_elements(jsonb_build_array(
  jsonb_build_object('actor_id',gen_random_uuid()),jsonb_build_object('request_id',gen_random_uuid()),jsonb_build_object('grant_id',gen_random_uuid()),
  jsonb_build_object('credential_id',gen_random_uuid()),jsonb_build_object('tenant_id',gen_random_uuid()),jsonb_build_object('scope_sha256',repeat('0',64)),
  jsonb_build_object('operation','supabase.projects.get'),jsonb_build_object('arguments','{"name":"other-fixture"}'::jsonb),
  jsonb_build_object('arguments','{"name":"other-fixture"}'::jsonb,'arguments_canonical','{"name":"other-fixture"}','input_sha256',encode(extensions.digest('{"name":"other-fixture"}','sha256'),'hex')))) LOOP
  result:=public.sandy_provider_read_authorize(payload||patch);IF result->>'ok'='true' THEN RAISE EXCEPTION 'provider_read_changed_context_accepted';END IF;
 END LOOP;
 UPDATE public.sandy_api_execution_admissions SET state='admitted' WHERE id=admission;
 result:=public.sandy_provider_read_authorize(payload);IF result->>'ok'='true' THEN RAISE EXCEPTION 'provider_read_unconsumed_admission';END IF;
 UPDATE public.sandy_api_execution_admissions SET state='consumed',expires_at=clock_timestamp()-interval '1 second' WHERE id=admission;
 result:=public.sandy_provider_read_authorize(payload);IF result->>'ok'='true' THEN RAISE EXCEPTION 'provider_read_expired_admission';END IF;
 UPDATE public.sandy_api_execution_admissions SET expires_at=clock_timestamp()+interval '5 minutes' WHERE id=admission;
 UPDATE public.sandy_controller_admins SET enabled=false WHERE auth_user_id=actor;
 result:=public.sandy_provider_read_authorize(payload);IF result->>'ok'='true' THEN RAISE EXCEPTION 'provider_read_revoked_owner';END IF;
 UPDATE public.sandy_controller_admins SET enabled=true WHERE auth_user_id=actor;
 UPDATE public.sandy_operation_registry SET api_exposed=false WHERE operation=op;
 result:=public.sandy_provider_read_authorize(payload);IF result->>'ok'='true' THEN RAISE EXCEPTION 'provider_read_changed_registry';END IF;
 UPDATE public.sandy_operation_registry SET api_exposed=true WHERE operation=op;
 result:=public.sandy_provider_read_authorize(payload);
 IF result->>'ok' IS DISTINCT FROM 'true' OR result->>'input_sha256'<>input_sha OR result->>'admission_id'<>admission::text OR result->>'request_id'<>request_id::text THEN RAISE EXCEPTION 'provider_read_exact_proof_refused';END IF;
 result:=public.sandy_provider_read_authorize(payload);IF result->>'error' IS DISTINCT FROM 'provider_read_context_already_claimed' THEN RAISE EXCEPTION 'provider_read_duplicate_dispatch_permitted';END IF;
 result:=public.sandy_credential_resolve_consumer('supabase_management',actor,admission,op);
 IF result->>'source' IS DISTINCT FROM 'existing_configuration' OR result ? 'value' THEN RAISE EXCEPTION 'provider_read_legacy_selection_failed';END IF;
 IF NOT EXISTS(SELECT 1 FROM public.sandy_api_audit_events WHERE admission_id=admission AND phase='provider_read_context' AND outcome='authorized') THEN RAISE EXCEPTION 'provider_read_claim_audit_missing';END IF;
 refused:=false;BEGIN UPDATE public.sandy_provider_read_admission_proofs SET input_sha256=repeat('0',64) WHERE admission_id=admission;EXCEPTION WHEN OTHERS THEN IF SQLERRM<>'provider_read_proof_immutable' THEN RAISE;END IF;refused:=true;END;
 IF NOT refused THEN RAISE EXCEPTION 'provider_read_private_proof_mutable';END IF;
 UPDATE public.sandy_operation_registry SET api_exposed=false WHERE operation=op;
 refused:=false;BEGIN PERFORM public.sandy_credential_resolve_consumer('supabase_management',actor,admission,op);EXCEPTION WHEN OTHERS THEN IF SQLERRM<>'consumer_current_contract_required' THEN RAISE;END IF;refused:=true;END;
 IF NOT refused THEN RAISE EXCEPTION 'provider_read_resolver_registry_recheck_missing';END IF;
 UPDATE public.sandy_operation_registry SET api_exposed=true WHERE operation=op;
 UPDATE public.sandy_api_execution_admissions SET scope_sha256=repeat('0',64) WHERE id=admission;
 refused:=false;BEGIN PERFORM public.sandy_credential_resolve_consumer('supabase_management',actor,admission,op);EXCEPTION WHEN OTHERS THEN IF SQLERRM<>'consumer_scoped_admission_required' THEN RAISE;END IF;refused:=true;END;
 IF NOT refused THEN RAISE EXCEPTION 'provider_read_resolver_scope_recheck_missing';END IF;
 UPDATE public.sandy_api_execution_admissions SET scope_sha256=scope_sha,state='succeeded' WHERE id=admission;
 refused:=false;BEGIN PERFORM public.sandy_credential_resolve_consumer('supabase_management',actor,admission,op);EXCEPTION WHEN OTHERS THEN IF SQLERRM<>'consumer_scoped_admission_required' THEN RAISE;END IF;refused:=true;END;
 IF NOT refused THEN RAISE EXCEPTION 'provider_read_finished_admission_reused';END IF;
END $read_test$;
SELECT jsonb_build_object('ok',true,'checks',24,'layer','real_postgresql_component_full_rollback','provider_called',false,'auth_session_exercised',false,'credentials_returned',false) AS evidence;
ROLLBACK;
