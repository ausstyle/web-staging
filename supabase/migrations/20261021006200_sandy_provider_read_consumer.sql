-- Add the versioned original provider-read consumer boundary. Existing 06100
-- stays byte-stable; its resolver is replaced only to admit this exact proven
-- read handler. Gateway still owns the single shared grant and final receipt.
BEGIN;
CREATE TABLE public.sandy_provider_read_admission_proofs(
 admission_id uuid PRIMARY KEY REFERENCES public.sandy_api_execution_admissions(id) ON DELETE RESTRICT,
 actor_id uuid NOT NULL,credential_id uuid,request_id uuid NOT NULL,grant_id uuid NOT NULL,
 operation text NOT NULL,input_sha256 text NOT NULL CHECK(input_sha256~'^[a-f0-9]{64}$'),
 scope_sha256 text NOT NULL CHECK(scope_sha256~'^[a-f0-9]{64}$'),
 registry_revision_sha256 text NOT NULL CHECK(registry_revision_sha256~'^[a-f0-9]{64}$'),
 authorized_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
ALTER TABLE public.sandy_provider_read_admission_proofs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.sandy_provider_read_admission_proofs FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION public.sandy_provider_read_proof_immutable() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$ BEGIN RAISE EXCEPTION 'provider_read_proof_immutable'; END $$;
CREATE TRIGGER sandy_provider_read_proof_immutable BEFORE UPDATE OR DELETE ON public.sandy_provider_read_admission_proofs FOR EACH ROW EXECUTE FUNCTION public.sandy_provider_read_proof_immutable();
CREATE FUNCTION public.sandy_provider_read_authorize(p jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE a public.sandy_api_execution_admissions;entry public.sandy_operation_registry;
BEGIN
 IF p->>'protocol' IS DISTINCT FROM 'consumed-admission-v1' OR p->>'tenant_id' IS NOT NULL
  OR p->>'arguments_canonical' IS NULL OR jsonb_typeof(p->'arguments') IS DISTINCT FROM 'object'
  OR (p->>'arguments_canonical')::jsonb IS DISTINCT FROM p->'arguments'
  OR encode(extensions.digest(p->>'arguments_canonical','sha256'),'hex') IS DISTINCT FROM p->>'input_sha256'
  THEN RETURN jsonb_build_object('ok',false,'error','provider_read_argument_proof_invalid','http_status',400);END IF;
 SELECT * INTO a FROM public.sandy_api_execution_admissions WHERE id=(p->>'admission_id')::uuid FOR SHARE;
 IF a.id IS NULL OR a.state IS DISTINCT FROM 'consumed' OR a.expires_at<=clock_timestamp() OR a.is_mutation OR a.tenant_id IS NOT NULL
  OR a.actor_id IS DISTINCT FROM (p->>'actor_id')::uuid OR a.request_id IS DISTINCT FROM (p->>'request_id')::uuid
  OR a.grant_id IS DISTINCT FROM (p->>'grant_id')::uuid OR a.credential_id IS DISTINCT FROM (p->>'credential_id')::uuid
  OR a.operation IS DISTINCT FROM p->>'operation' OR a.input_sha256 IS DISTINCT FROM p->>'input_sha256'
  OR a.scope_sha256 IS DISTINCT FROM p->>'scope_sha256' OR NOT public.sandy_api_current_owner(a.actor_id)
  OR a.scope_sha256 IS DISTINCT FROM encode(extensions.digest('{"permission_scope":"infrastructure:read","sandy_project_ref":"zmqlyygzqoidkcwdysok"}','sha256'),'hex')
  THEN RETURN jsonb_build_object('ok',false,'error','provider_read_consumed_context_required','http_status',403);END IF;
 SELECT * INTO entry FROM public.sandy_operation_registry WHERE operation=a.operation FOR SHARE;
 IF entry.operation IS NULL OR entry.handler IS DISTINCT FROM 'sandy-provider-read-api'
  OR entry.api_exposed IS DISTINCT FROM true OR entry.is_mutation IS DISTINCT FROM false OR entry.permission_scope IS DISTINCT FROM 'infrastructure:read'
  OR a.registry_revision_sha256 IS DISTINCT FROM public.sandy_api_registry_revision(a.operation)
  THEN RETURN jsonb_build_object('ok',false,'error','provider_read_current_contract_required','http_status',409);END IF;
 INSERT INTO public.sandy_provider_read_admission_proofs(admission_id,actor_id,credential_id,request_id,grant_id,operation,input_sha256,scope_sha256,registry_revision_sha256)
 VALUES(a.id,a.actor_id,a.credential_id,a.request_id,a.grant_id,a.operation,a.input_sha256,a.scope_sha256,a.registry_revision_sha256)
 ON CONFLICT DO NOTHING;
 IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'error','provider_read_context_already_claimed','http_status',409);END IF;
 PERFORM public.sandy_api_append_audit(a.actor_id,a.operation,a.request_id,a.credential_id,a.id,'provider_read_context','authorized',a.input_sha256);
 RETURN jsonb_build_object('ok',true,'actor_id',a.actor_id,'admission_id',a.id,'request_id',a.request_id,'operation',a.operation,'input_sha256',a.input_sha256,'scope_sha256',a.scope_sha256,'registry_revision_sha256',a.registry_revision_sha256);
EXCEPTION WHEN invalid_text_representation THEN RETURN jsonb_build_object('ok',false,'error','provider_read_argument_proof_invalid','http_status',400);
END $$;
CREATE OR REPLACE FUNCTION public.sandy_credential_resolve_consumer(p_consumer text,p_actor uuid,p_admission uuid,p_operation text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
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
 OR entry.handler IS NULL OR entry.handler NOT IN ('sandy-provider-operation-api','sandy-credential-lifecycle-api','sandy-database-operation-api','sandy-guest-operation-api','sandy-provider-read-api') THEN RAISE EXCEPTION 'consumer_current_contract_required'; END IF;
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
END $$;
REVOKE ALL ON FUNCTION public.sandy_provider_read_proof_immutable(),public.sandy_provider_read_authorize(jsonb),public.sandy_credential_resolve_consumer(text,uuid,uuid,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.sandy_provider_read_authorize(jsonb),public.sandy_credential_resolve_consumer(text,uuid,uuid,text) TO service_role;
-- Internal protocol metadata only. Public read contracts, exposure flags and
-- verification evidence retain their existing values.
UPDATE public.sandy_operation_registry
 SET error_contract=coalesce(error_contract,'{}'::jsonb)||jsonb_build_object('internal_execution_protocol','consumed-admission-v1','credential_resolution','current private consumer after exact actual argument/admission proof; no active-pointer fallback'),
 dependencies=coalesce(dependencies,'[]'::jsonb)||'["gateway_consumed_admission_v1","sandy_credential_consumer_schema"]'::jsonb,
 updated_at=clock_timestamp()
 WHERE handler='sandy-provider-read-api';
COMMIT;
