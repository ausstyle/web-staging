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
