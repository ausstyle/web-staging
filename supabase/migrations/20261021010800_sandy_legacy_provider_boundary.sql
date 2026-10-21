-- Fixed legacy aliases share the original canonical one-use provider engine.
BEGIN;
DO $guard$ BEGIN IF (SELECT encode(extensions.digest(prosrc,'sha256'),'hex') FROM pg_proc WHERE oid='public.sandy_credential_resolve_consumer(text,uuid,uuid,text)'::regprocedure AND prosecdef) IS DISTINCT FROM '27987d528a27133fe4ab468f714de48b19692ab1a77ce58b440ebbb47c23ec26' THEN RAISE EXCEPTION 'reviewed_legacy_consumer_baseline_required';END IF;END $guard$;
CREATE TABLE public.sandy_legacy_provider_contracts (
 operation text PRIMARY KEY,
 input_schema jsonb NOT NULL,
 sql_input_schema jsonb NOT NULL,
 output_schema jsonb NOT NULL,
 contract_sha256 text NOT NULL CHECK(contract_sha256 ~ '^[a-f0-9]{64}$'),
 canonical_scope text NOT NULL,
 maximum_input_bytes integer NOT NULL CHECK(maximum_input_bytes BETWEEN 1 AND 1550000),
 permission_scope text NOT NULL,
 is_mutation boolean NOT NULL,
 consumer text NOT NULL CHECK(consumer IN('github_api','supabase_management'))
);
ALTER TABLE public.sandy_legacy_provider_contracts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.sandy_legacy_provider_contracts FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION public.sandy_legacy_provider_context(p_context jsonb,p_expected_state text DEFAULT 'admitted') RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE a public.sandy_api_execution_admissions%ROWTYPE; r public.sandy_operation_registry%ROWTYPE; c public.sandy_legacy_provider_contracts%ROWTYPE;
BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' OR p_expected_state NOT IN('admitted','consumed') OR p_expected_state IS NULL
 OR jsonb_typeof(p_context) IS DISTINCT FROM 'object' THEN RETURN jsonb_build_object('allowed',false,'error','internal_service_transport_required','http_status',403);END IF;
 SELECT * INTO a FROM public.sandy_api_execution_admissions WHERE id=(p_context->>'admission_id')::uuid FOR SHARE;
 SELECT * INTO c FROM public.sandy_legacy_provider_contracts WHERE operation=p_context->>'operation';
 SELECT * INTO r FROM public.sandy_operation_registry WHERE operation=p_context->>'operation' FOR SHARE;
 IF a.id IS NULL OR c.operation IS NULL OR a.actor_id IS DISTINCT FROM (p_context->>'actor_id')::uuid
 OR a.request_id IS DISTINCT FROM (p_context->>'request_id')::uuid OR a.grant_id IS DISTINCT FROM (p_context->>'grant_id')::uuid
 OR a.operation IS DISTINCT FROM c.operation OR a.principal_kind IS DISTINCT FROM 'auth_user' OR a.state IS DISTINCT FROM p_expected_state
 OR a.tenant_id IS NOT NULL OR a.credential_id IS NOT NULL OR a.customer_key_id IS NOT NULL
 OR p_context->'tenant_id' IS DISTINCT FROM 'null'::jsonb OR p_context->'credential_id' IS DISTINCT FROM 'null'::jsonb
 OR a.expires_at<=clock_timestamp() OR NOT public.sandy_api_current_owner(a.actor_id)
 OR NOT EXISTS(SELECT 1 FROM auth.users u WHERE u.id=a.actor_id AND u.email_confirmed_at IS NOT NULL AND NOT coalesce(u.is_anonymous,false))
 THEN RETURN jsonb_build_object('allowed',false,'error','actual_current_owner_admission_required','http_status',403);END IF;
 IF r.handler IS DISTINCT FROM 'sandy-legacy-compatibility-api' OR r.api_exposed IS DISTINCT FROM true OR r.verified IS DISTINCT FROM true
 OR r.permission_scope IS DISTINCT FROM c.permission_scope OR r.is_mutation IS DISTINCT FROM c.is_mutation OR a.is_mutation IS DISTINCT FROM c.is_mutation
 OR r.input_schema IS DISTINCT FROM c.input_schema OR r.output_schema IS DISTINCT FROM c.output_schema
 OR r.error_contract->>'contract_sha256' IS DISTINCT FROM c.contract_sha256 OR a.contract_sha256 IS DISTINCT FROM c.contract_sha256
 OR r.error_contract->>'requires_approval' IS DISTINCT FROM 'true' OR r.error_contract->>'requires_grant' IS DISTINCT FROM 'true'
 OR r.error_contract->>'requires_real_user_session' IS DISTINCT FROM 'true' OR r.error_contract->>'api_key_delegable' IS DISTINCT FROM 'false'
 OR a.registry_revision_sha256 IS DISTINCT FROM public.sandy_api_registry_revision(a.operation)
 OR a.scope_sha256 IS DISTINCT FROM encode(extensions.digest(c.canonical_scope,'sha256'),'hex')
 THEN RETURN jsonb_build_object('allowed',false,'error','exact_legacy_provider_contract_required','http_status',409);END IF;
 IF p_expected_state='admitted' AND (
 jsonb_typeof(p_context->'arguments') IS DISTINCT FROM 'object'
 OR NOT public.sandy_product_input_valid(c.sql_input_schema,p_context->'arguments')
 OR p_context->>'canonical_arguments' IS NULL OR octet_length(p_context->>'canonical_arguments')>c.maximum_input_bytes
 OR (p_context->>'canonical_arguments')::jsonb IS DISTINCT FROM p_context->'arguments'
 OR encode(extensions.digest(p_context->>'canonical_arguments','sha256'),'hex') IS DISTINCT FROM a.input_sha256)
 THEN RETURN jsonb_build_object('allowed',false,'error','exact_alias_arguments_required','http_status',403);END IF;
 IF a.approval_id IS NULL OR NOT EXISTS(
 SELECT 1 FROM public.sandy_api_mutation_approval_snapshots p
 JOIN public.sandy_deployment_jobs j ON j.id=p.job_id
 JOIN public.sandy_engineering_changes ch ON ch.id=p.engineering_change_id
 WHERE p.job_id=a.approval_id AND p.actor_id=a.actor_id AND p.operation=a.operation
 AND p.input_sha256=a.input_sha256 AND p.contract_sha256=a.contract_sha256 AND p.scope_sha256=a.scope_sha256
 AND a.declared_cost_units<=p.maximum_declared_cost_units
 AND j.status=CASE WHEN p_expected_state='admitted' THEN 'approved' ELSE 'running' END AND ch.status='approved'
 AND p.job_fingerprint_sha256=public.sandy_api_job_fingerprint(j))
 THEN RETURN jsonb_build_object('allowed',false,'error','immutable_alias_approval_required','http_status',403);END IF;
 RETURN jsonb_build_object('allowed',true,'admission_id',a.id,'reused',false);
EXCEPTION WHEN invalid_text_representation THEN RETURN jsonb_build_object('allowed',false,'error','invalid_legacy_provider_context','http_status',400);
END $$;
REVOKE ALL ON FUNCTION public.sandy_legacy_provider_context(jsonb,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.sandy_legacy_provider_context(jsonb,text) TO service_role;

CREATE OR REPLACE FUNCTION public.sandy_credential_resolve_consumer(p_consumer text,p_actor uuid,p_admission uuid,p_operation text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $consumer$
DECLARE admission public.sandy_api_execution_admissions; credential public.sandy_api_credentials;
 entry public.sandy_operation_registry; binding public.sandy_credential_consumer_bindings;
 target public.sandy_credential_targets; version public.sandy_credential_versions; previous public.sandy_credential_consumer_access;
 operation_target public.sandy_credential_targets; expected_consumer text; material text; target_document jsonb;
BEGIN
 IF p_consumer IS NULL OR p_consumer NOT IN ('supabase_management','github_api','gcp_access_token')
 OR p_actor IS NULL OR p_admission IS NULL OR p_operation IS NULL OR p_operation !~ '^[a-z][a-z0-9_.-]{2,100}$' THEN RAISE EXCEPTION 'consumer_execution_context_invalid'; END IF;
 SELECT * INTO admission FROM public.sandy_api_execution_admissions WHERE id=p_admission FOR SHARE;
 IF admission.id IS NULL OR admission.actor_id IS DISTINCT FROM p_actor OR admission.operation IS DISTINCT FROM p_operation OR admission.state IS DISTINCT FROM 'consumed'
 OR admission.tenant_id IS NOT NULL OR admission.expires_at<=clock_timestamp() OR NOT public.sandy_api_current_owner(p_actor) THEN RAISE EXCEPTION 'consumer_scoped_admission_required'; END IF;
 SELECT * INTO entry FROM public.sandy_operation_registry WHERE operation=p_operation FOR SHARE;
 IF entry.operation IS NULL OR entry.api_exposed IS DISTINCT FROM true OR public.sandy_api_registry_revision(p_operation) IS DISTINCT FROM admission.registry_revision_sha256
 OR entry.handler IS NULL OR entry.handler NOT IN ('sandy-provider-operation-api','sandy-credential-lifecycle-api','sandy-database-operation-api','sandy-guest-operation-api','sandy-provider-read-api','sandy-provider-gap-api','sandy-provider-supplement-api','sandy-provider-sensitive-api','sandy-provider-bound-api','sandy-legacy-compatibility-api') THEN RAISE EXCEPTION 'consumer_current_contract_required'; END IF;
 IF entry.handler='sandy-legacy-compatibility-api' THEN
  IF (SELECT consumer FROM public.sandy_legacy_provider_contracts WHERE operation=p_operation) IS DISTINCT FROM p_consumer
  OR public.sandy_legacy_provider_context(jsonb_build_object('operation',p_operation,'actor_id',p_actor,'admission_id',p_admission,
   'request_id',admission.request_id,'grant_id',admission.grant_id,'tenant_id',NULL,'credential_id',NULL),'consumed')->>'allowed' IS DISTINCT FROM 'true'
  THEN RAISE EXCEPTION 'consumer_scoped_admission_required';END IF;
 END IF;
 IF admission.credential_id IS NOT NULL THEN
  SELECT * INTO credential FROM public.sandy_api_credentials WHERE id=admission.credential_id FOR SHARE;
  IF credential.id IS NULL OR credential.principal_id IS DISTINCT FROM p_actor OR credential.tenant_id IS NOT NULL OR credential.revoked_at IS NOT NULL OR credential.expires_at<=clock_timestamp()
  OR NOT p_operation=ANY(credential.allowed_operations) OR entry.is_mutation OR entry.error_contract->>'api_key_delegable' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'consumer_delegated_scope_refused'; END IF;
 END IF;
 -- Original metadata reads have gateway-owned grants. They must first claim
 -- the exact versioned argument context against that actual consumed admission.
 IF entry.handler='sandy-provider-read-api' AND (
  admission.is_mutation OR entry.is_mutation OR entry.permission_scope IS DISTINCT FROM 'infrastructure:read'
  OR admission.scope_sha256 IS DISTINCT FROM encode(extensions.digest('{"permission_scope":"infrastructure:read","sandy_project_ref":"zmqlyygzqoidkcwdysok"}','sha256'),'hex')
  OR NOT EXISTS(SELECT 1 FROM public.sandy_provider_read_admission_proofs proof WHERE proof.admission_id=admission.id
   AND proof.actor_id=admission.actor_id AND proof.credential_id IS NOT DISTINCT FROM admission.credential_id
   AND proof.request_id=admission.request_id AND proof.grant_id=admission.grant_id AND proof.operation=admission.operation
   AND proof.input_sha256=admission.input_sha256 AND proof.scope_sha256=admission.scope_sha256
   AND proof.registry_revision_sha256=admission.registry_revision_sha256)) THEN RAISE EXCEPTION 'consumer_scoped_admission_required'; END IF;
 expected_consumer:=CASE WHEN p_operation LIKE 'supabase.%' THEN 'supabase_management' WHEN p_operation LIKE 'github.%' THEN 'github_api' WHEN p_operation LIKE 'gcp.%' THEN 'gcp_access_token' END;
 IF entry.handler='sandy-credential-lifecycle-api' THEN
  SELECT * INTO operation_target FROM public.sandy_credential_targets WHERE scope_sha256=admission.scope_sha256 AND enabled AND verified LIMIT 1;
  expected_consumer:=CASE operation_target.provider WHEN 'supabase_edge_secret' THEN 'supabase_management' WHEN 'github_actions_secret' THEN 'github_api' WHEN 'gcp_secret' THEN 'gcp_access_token' WHEN 'gcp_service_account_key' THEN 'gcp_access_token' END;
 END IF;
 IF expected_consumer IS DISTINCT FROM p_consumer THEN RAISE EXCEPTION 'consumer_provider_scope_mismatch'; END IF;
 SELECT * INTO binding FROM public.sandy_credential_consumer_bindings WHERE consumer=p_consumer FOR SHARE;
 IF binding.consumer IS NULL THEN RETURN jsonb_build_object('ok',true,'source','existing_configuration','active_version_id',NULL); END IF;
 SELECT * INTO target FROM public.sandy_credential_targets WHERE id=binding.target_id FOR SHARE;
 IF target.id IS NULL THEN RAISE EXCEPTION 'consumer_configured_target_missing'; END IF;
 IF target.active_version_id IS NULL THEN
  IF EXISTS(SELECT 1 FROM public.sandy_credential_consumer_access WHERE target_id=target.id)
  OR EXISTS(SELECT 1 FROM public.sandy_credential_rotations WHERE target_id=target.id AND state='activated') THEN RAISE EXCEPTION 'consumer_active_pointer_removed'; END IF;
  RETURN jsonb_build_object('ok',true,'source','existing_configuration','active_version_id',NULL);
 END IF;
 IF NOT binding.enabled OR NOT binding.verified OR NOT target.enabled OR NOT target.verified OR target.config_sha256 IS DISTINCT FROM binding.target_config_sha256
 OR NOT public.sandy_credential_consumer_target_matches(p_consumer,target) THEN RAISE EXCEPTION 'consumer_active_binding_refused'; END IF;
 SELECT * INTO version FROM public.sandy_credential_versions WHERE id=target.active_version_id AND target_id=target.id FOR SHARE;
 IF version.id IS NULL OR version.state IS DISTINCT FROM 'active' THEN RAISE EXCEPTION 'consumer_active_version_refused'; END IF;
 -- Active versions must retain the prior custody proof, including a real
 -- successful verification admission with a digest-bound observation.
 IF NOT EXISTS(SELECT 1 FROM public.sandy_credential_rotations rotation JOIN public.sandy_api_execution_admissions proof ON proof.id=rotation.verification_admission_id
  WHERE rotation.target_id=target.id AND rotation.staged_version_id=version.id AND rotation.state='activated'
  AND rotation.target_config_sha256=target.config_sha256 AND proof.operation='system.credentials.provider.verify' AND proof.state='succeeded'
  AND proof.actor_id=rotation.actor_id AND proof.credential_id IS NULL AND proof.approval_id IS NOT NULL AND proof.scope_sha256=target.scope_sha256
  AND proof.result_sha256=encode(extensions.digest(rotation.verification_canonical,'sha256'),'hex')
  AND rotation.verification_canonical::jsonb=rotation.verification_evidence
  AND rotation.verification_evidence->>'rotation_id'=rotation.id::text AND rotation.verification_evidence->>'target_id'=target.id::text
  AND rotation.verification_evidence->>'target_config_sha256'=target.config_sha256
  AND rotation.verification_evidence->>'provider_verified'='true' AND rotation.verification_evidence->>'material_sha256'=version.material_sha256) THEN RAISE EXCEPTION 'consumer_active_readback_required'; END IF;
 SELECT * INTO previous FROM public.sandy_credential_consumer_access WHERE admission_id=p_admission AND consumer=p_consumer;
 IF previous.admission_id IS NOT NULL AND (previous.actor_id IS DISTINCT FROM p_actor OR previous.target_id IS DISTINCT FROM target.id OR previous.version_id IS DISTINCT FROM version.id OR previous.material_sha256 IS DISTINCT FROM version.material_sha256) THEN RAISE EXCEPTION 'consumer_pointer_changed_during_execution'; END IF;
 SELECT decrypted_secret INTO material FROM vault.decrypted_secrets WHERE id=version.vault_secret_id;
 IF material IS NULL OR octet_length(material) NOT BETWEEN 1 AND 65536 OR encode(extensions.digest(material,'sha256'),'hex') IS DISTINCT FROM version.material_sha256 THEN RAISE EXCEPTION 'consumer_material_integrity_failed'; END IF;
 INSERT INTO public.sandy_credential_consumer_access(admission_id,consumer,actor_id,target_id,version_id,material_sha256)
 VALUES(p_admission,p_consumer,p_actor,target.id,version.id,version.material_sha256) ON CONFLICT DO NOTHING;
 IF previous.admission_id IS NULL THEN PERFORM public.sandy_api_append_audit(p_actor,p_operation,admission.request_id,admission.credential_id,p_admission,'credential_consumer','resolved',admission.input_sha256,
  encode(extensions.digest(jsonb_build_object('consumer',p_consumer,'target_id',target.id,'version_id',version.id,'material_sha256',version.material_sha256)::text,'sha256'),'hex')); END IF;
 target_document:=jsonb_build_object('id',target.id,'provider',target.provider,'resource',target.resource,'enabled',target.enabled,'verified',target.verified,'active_version_id',target.active_version_id,'scope_sha256',target.scope_sha256,'config_sha256',target.config_sha256);
 RETURN jsonb_build_object('ok',true,'source','vault_active','consumer',p_consumer,'admission_id',p_admission,'active_version_id',version.id,'target',target_document,'value',material,'material_sha256',version.material_sha256,'provider_version_id',version.provider_version_id);
END $consumer$;
COMMIT;
