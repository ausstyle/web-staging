BEGIN;
-- Preserve the existing admission/rate/audit path and legacy approval history.

CREATE OR REPLACE FUNCTION public.sandy_api_admit_execution(p_actor_id uuid, p_tenant_id uuid, p_operation text, p_input_sha256 text, p_request_id uuid, p_credential_id uuid DEFAULT NULL::uuid, p_contract_sha256 text DEFAULT NULL::text, p_scope_sha256 text DEFAULT NULL::text, p_declared_cost_units bigint DEFAULT 0, p_approval_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
DECLARE entry public.sandy_operation_registry%ROWTYPE; prior public.sandy_api_execution_admissions%ROWTYPE;
 credential public.sandy_api_credentials%ROWTYPE; proof public.sandy_api_mutation_approval_snapshots%ROWTYPE;
 job public.sandy_deployment_jobs%ROWTYPE; active_window timestamptz:=date_trunc('minute',clock_timestamp());
 policy_authorized boolean:=false; requests integer; units bigint; request_limit integer:=60; admission public.sandy_api_execution_admissions%ROWTYPE;
BEGIN
 IF NOT public.sandy_api_current_owner(p_actor_id) THEN RETURN jsonb_build_object('ok',false,'allowed',false,'error','owner_required','http_status',403); END IF;
 IF p_tenant_id IS NOT NULL THEN RETURN jsonb_build_object('ok',false,'allowed',false,'error','tenant_execution_policy_unavailable','http_status',422); END IF;
 IF p_request_id IS NULL OR p_operation IS NULL OR p_input_sha256 IS NULL OR p_declared_cost_units IS NULL OR p_operation !~ '^[a-z][a-z0-9_.-]{2,100}$' OR p_input_sha256 !~ '^[a-f0-9]{64}$'
  OR p_contract_sha256 IS NULL OR p_contract_sha256 !~ '^[a-f0-9]{64}$' OR p_scope_sha256 IS NULL OR p_scope_sha256 !~ '^[a-f0-9]{64}$'
  OR p_declared_cost_units NOT BETWEEN 0 AND 1000000 THEN RETURN jsonb_build_object('ok',false,'allowed',false,'error','invalid_execution_admission','http_status',400); END IF;
 -- Actor/request lock serializes retries before any counter, approval or audit write.
 PERFORM pg_advisory_xact_lock(hashtextextended(p_actor_id::text||':'||p_request_id::text,0));
 SELECT * INTO prior FROM public.sandy_api_execution_admissions WHERE actor_id=p_actor_id AND request_id=p_request_id;
 IF FOUND THEN
  IF prior.tenant_id IS DISTINCT FROM p_tenant_id OR prior.operation IS DISTINCT FROM p_operation
   OR prior.input_sha256 IS DISTINCT FROM p_input_sha256 OR prior.contract_sha256 IS DISTINCT FROM p_contract_sha256
   OR prior.scope_sha256 IS DISTINCT FROM p_scope_sha256 OR prior.credential_id IS DISTINCT FROM p_credential_id
   OR prior.approval_id IS DISTINCT FROM p_approval_id OR prior.declared_cost_units IS DISTINCT FROM p_declared_cost_units THEN
   RETURN jsonb_build_object('ok',false,'allowed',false,'error','request_id_conflict','http_status',409); END IF;
  RETURN jsonb_build_object('ok',true,'allowed',false,'admission_id',prior.id,'grant_id',prior.grant_id,
   'reused',true,'state',prior.state,'expires_at',prior.expires_at,'executed',false,'error','admission_already_recorded','http_status',409);
 END IF;
 SELECT * INTO entry FROM public.sandy_operation_registry WHERE operation=p_operation;
 IF NOT FOUND OR entry.api_exposed IS DISTINCT FROM true THEN RETURN jsonb_build_object('ok',false,'allowed',false,'error','operation_not_exposed','http_status',404); END IF;
 IF entry.error_contract ? 'contract_sha256' AND entry.error_contract->>'contract_sha256' IS DISTINCT FROM p_contract_sha256 THEN RETURN jsonb_build_object('ok',false,'allowed',false,'error','execution_contract_changed','http_status',409); END IF;
 IF p_credential_id IS NOT NULL THEN
  SELECT * INTO credential FROM public.sandy_api_credentials WHERE id=p_credential_id FOR UPDATE;
  IF NOT FOUND OR credential.principal_id<>p_actor_id OR credential.tenant_id IS DISTINCT FROM p_tenant_id
   OR credential.revoked_at IS NOT NULL OR credential.expires_at<=clock_timestamp()
   OR NOT p_operation=ANY(credential.allowed_operations) OR entry.is_mutation IS DISTINCT FROM false
   OR entry.handler IS NULL OR entry.permission_scope IS NULL
   OR entry.handler NOT IN ('sandy-provider-read-api','sandy-infrastructure-read','sandy-deploy-provision','sandy-provider-operation-api')
   OR entry.permission_scope NOT IN ('infrastructure:read','deployment:read','engineering:read','system:read')
   OR entry.error_contract->>'requires_approval'='true'
   OR entry.error_contract->>'api_key_delegable'='false'
   OR (entry.handler='sandy-provider-operation-api' AND entry.error_contract->>'api_key_delegable' IS DISTINCT FROM 'true') THEN
   RETURN jsonb_build_object('ok',false,'allowed',false,'error','credential_scope_denied','http_status',403); END IF;
  IF credential.admitted_units+p_declared_cost_units>credential.declared_unit_budget THEN
   RETURN jsonb_build_object('ok',false,'allowed',false,'error','declared_unit_budget_exceeded','http_status',429); END IF;
  request_limit:=credential.requests_per_minute;
 END IF;
 SELECT EXISTS(SELECT 1 FROM public.sandy_engineering_execution_authorizations e
 WHERE e.job_id=p_approval_id AND e.delegation_id IS NOT NULL AND e.owner_authority_id=p_actor_id
 AND e.request_id=p_request_id AND e.operation=p_operation AND e.input_sha256=p_input_sha256
 AND e.contract_sha256=p_contract_sha256 AND e.scope_sha256=p_scope_sha256
 AND p_credential_id IS NULL AND p_declared_cost_units=0
 AND public.sandy_engineering_policy_job_authorized(e.job_id,'authorized_by_policy')) INTO policy_authorized;
 IF NOT policy_authorized THEN
 IF entry.is_mutation OR entry.error_contract->>'requires_approval'='true' THEN
  IF p_credential_id IS NOT NULL OR entry.verified IS DISTINCT FROM true THEN
   RETURN jsonb_build_object('ok',false,'allowed',false,'error','mutation_requires_verified_auth_approval','http_status',424); END IF;
  SELECT * INTO proof FROM public.sandy_api_mutation_approval_snapshots WHERE job_id=p_approval_id;
  SELECT * INTO job FROM public.sandy_deployment_jobs WHERE id=p_approval_id FOR UPDATE;
  IF proof.job_id IS NULL OR job.id IS NULL OR job.status<>'approved' OR proof.actor_id<>p_actor_id
   OR NOT public.sandy_api_current_owner(proof.actor_id) OR proof.operation<>p_operation
   OR proof.input_sha256<>p_input_sha256 OR proof.contract_sha256<>p_contract_sha256 OR proof.scope_sha256<>p_scope_sha256
   OR p_declared_cost_units>proof.maximum_declared_cost_units
   OR proof.job_fingerprint_sha256<>public.sandy_api_job_fingerprint(job)
   OR NOT EXISTS(SELECT 1 FROM public.sandy_engineering_changes WHERE id=proof.engineering_change_id AND status='approved') THEN
   RETURN jsonb_build_object('ok',false,'allowed',false,'error','scoped_mutation_approval_required','http_status',403); END IF;
 ELSE
  IF p_approval_id IS NOT NULL THEN RETURN jsonb_build_object('ok',false,'allowed',false,'error','read_approval_unexpected','http_status',400); END IF;
 END IF;
 END IF;
 INSERT INTO public.sandy_api_rate_windows(actor_id,bucket,window_start,requests,declared_units)
 VALUES(p_actor_id,'principal',active_window,0,0) ON CONFLICT DO NOTHING;
 SELECT w.requests,w.declared_units INTO requests,units FROM public.sandy_api_rate_windows w
 WHERE actor_id=p_actor_id AND w.bucket='principal' AND w.window_start=active_window FOR UPDATE;
 IF requests>=60 OR units+p_declared_cost_units>1000000 THEN
  RETURN jsonb_build_object('ok',false,'allowed',false,'error','admission_rate_or_declared_units_exceeded','http_status',429); END IF;
 IF p_credential_id IS NOT NULL THEN
  INSERT INTO public.sandy_api_rate_windows(actor_id,bucket,window_start,requests,declared_units)
  VALUES(p_actor_id,p_credential_id::text,active_window,0,0) ON CONFLICT DO NOTHING;
  SELECT w.requests INTO requests FROM public.sandy_api_rate_windows w WHERE actor_id=p_actor_id
   AND w.bucket=p_credential_id::text AND w.window_start=active_window FOR UPDATE;
  IF requests>=request_limit THEN RETURN jsonb_build_object('ok',false,'allowed',false,'error','admission_rate_or_declared_units_exceeded','http_status',429); END IF;
 END IF;
 INSERT INTO public.sandy_api_execution_admissions(actor_id,tenant_id,operation,request_id,is_mutation,credential_id,input_sha256,
 contract_sha256,scope_sha256,registry_revision_sha256,declared_cost_units,approval_id,expires_at)
 VALUES(p_actor_id,p_tenant_id,p_operation,p_request_id,entry.is_mutation,p_credential_id,p_input_sha256,p_contract_sha256,p_scope_sha256,
 public.sandy_api_registry_revision(p_operation),p_declared_cost_units,p_approval_id,clock_timestamp()+interval '60 seconds') RETURNING * INTO admission;
 UPDATE public.sandy_api_rate_windows w SET requests=w.requests+1,declared_units=w.declared_units+p_declared_cost_units
 WHERE actor_id=p_actor_id AND w.bucket='principal' AND w.window_start=active_window;
 IF p_credential_id IS NOT NULL THEN
 UPDATE public.sandy_api_rate_windows w SET requests=w.requests+1,declared_units=w.declared_units+p_declared_cost_units
 WHERE actor_id=p_actor_id AND w.bucket=p_credential_id::text AND w.window_start=active_window;
 UPDATE public.sandy_api_credentials SET admitted_requests=admitted_requests+1,
 admitted_units=admitted_units+p_declared_cost_units WHERE id=p_credential_id; END IF;
 PERFORM public.sandy_api_append_audit(p_actor_id,p_operation,p_request_id,p_credential_id,admission.id,'admission','admitted',p_input_sha256);
 RETURN jsonb_build_object('ok',true,'allowed',true,'admission_id',admission.id,'grant_id',admission.grant_id,
 'reused',false,'state','admitted','expires_at',admission.expires_at,'executed',false,
 'unit_kind','caller_declared_units_not_money','provider_price_known',false);
END $function$
;

CREATE OR REPLACE FUNCTION public.sandy_api_consume_execution_grant(p_grant_id uuid, p_actor_id uuid, p_tenant_id uuid, p_operation text, p_input_sha256 text, p_request_id uuid, p_contract_sha256 text, p_scope_sha256 text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
DECLARE admission public.sandy_api_execution_admissions%ROWTYPE; credential public.sandy_api_credentials%ROWTYPE;
 entry public.sandy_operation_registry%ROWTYPE; proof public.sandy_api_mutation_approval_snapshots%ROWTYPE;
 job public.sandy_deployment_jobs%ROWTYPE;
BEGIN
 SELECT * INTO admission FROM public.sandy_api_execution_admissions WHERE grant_id=p_grant_id FOR UPDATE;
 IF NOT FOUND OR NOT public.sandy_api_current_owner(p_actor_id) OR admission.actor_id IS DISTINCT FROM p_actor_id
  OR admission.tenant_id IS DISTINCT FROM p_tenant_id OR admission.operation IS DISTINCT FROM p_operation
  OR admission.input_sha256 IS DISTINCT FROM p_input_sha256 OR admission.request_id IS DISTINCT FROM p_request_id
  OR admission.contract_sha256 IS DISTINCT FROM p_contract_sha256 OR admission.scope_sha256 IS DISTINCT FROM p_scope_sha256 THEN
  RETURN jsonb_build_object('ok',false,'allowed',false,'error','execution_grant_scope_denied','http_status',403,'executed',false); END IF;
 IF admission.state<>'admitted' OR admission.expires_at<=clock_timestamp() THEN
  RETURN jsonb_build_object('ok',false,'allowed',false,'error','execution_grant_used_or_expired','http_status',409,'executed',false); END IF;
 SELECT * INTO entry FROM public.sandy_operation_registry WHERE operation=p_operation;
 IF entry.operation IS NULL OR entry.api_exposed IS DISTINCT FROM true OR
  admission.registry_revision_sha256 IS DISTINCT FROM public.sandy_api_registry_revision(p_operation) THEN
  RETURN jsonb_build_object('ok',false,'allowed',false,'error','execution_contract_changed','http_status',409,'executed',false); END IF;
 IF admission.credential_id IS NOT NULL THEN
  SELECT * INTO credential FROM public.sandy_api_credentials WHERE id=admission.credential_id;
  IF credential.revoked_at IS NOT NULL OR credential.expires_at<=clock_timestamp() OR
   NOT p_operation=ANY(credential.allowed_operations) THEN RETURN jsonb_build_object('ok',false,'allowed',false,
   'error','execution_credential_revoked_or_expired','http_status',403,'executed',false); END IF;
 END IF;
 IF EXISTS(SELECT 1 FROM public.sandy_engineering_execution_authorizations WHERE job_id=admission.approval_id AND delegation_id IS NOT NULL) THEN
  IF NOT public.sandy_engineering_policy_job_authorized(admission.approval_id,'authorized_by_policy') THEN
   RETURN jsonb_build_object('ok',false,'allowed',false,'error','execution_credential_revoked_or_expired','http_status',403,'executed',false);END IF;
  UPDATE public.sandy_deployment_jobs SET status='running',started_at=clock_timestamp(),updated_at=clock_timestamp() WHERE id=admission.approval_id;
 ELSE
 IF entry.is_mutation OR entry.error_contract->>'requires_approval'='true' THEN
  SELECT * INTO proof FROM public.sandy_api_mutation_approval_snapshots WHERE job_id=admission.approval_id;
  SELECT * INTO job FROM public.sandy_deployment_jobs WHERE id=admission.approval_id FOR UPDATE;
  IF entry.verified IS DISTINCT FROM true OR admission.credential_id IS NOT NULL OR proof.job_id IS NULL
   OR job.status IS DISTINCT FROM 'approved' OR proof.actor_id IS DISTINCT FROM p_actor_id
   OR proof.job_fingerprint_sha256 IS DISTINCT FROM public.sandy_api_job_fingerprint(job)
   OR NOT EXISTS(SELECT 1 FROM public.sandy_engineering_changes WHERE id=proof.engineering_change_id AND status='approved') THEN
   RETURN jsonb_build_object('ok',false,'allowed',false,'error','mutation_approval_changed','http_status',409,'executed',false); END IF;
  UPDATE public.sandy_deployment_jobs SET status='running',started_at=clock_timestamp(),updated_at=clock_timestamp()
   WHERE id=admission.approval_id;
 END IF;
 END IF;
 UPDATE public.sandy_api_execution_admissions SET state='consumed',consumed_at=clock_timestamp() WHERE id=admission.id;
 PERFORM public.sandy_api_append_audit(p_actor_id,p_operation,p_request_id,admission.credential_id,admission.id,'grant','consumed',p_input_sha256);
 RETURN jsonb_build_object('ok',true,'allowed',true,'admission_id',admission.id,'reused',false,'executed',false);
END $function$
;

CREATE OR REPLACE FUNCTION public.sandy_api_verify_github_mutation(p_admission_id uuid,p_canonical_arguments text,p_proof jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $verify$
DECLARE a public.sandy_api_execution_admissions;args jsonb;content_bytes bytea;proof_sha text;parents_canonical text;allowed_keys text[];
BEGIN
 IF p_canonical_arguments IS NULL OR octet_length(p_canonical_arguments)>150000 OR p_proof IS NULL OR jsonb_typeof(p_proof) IS DISTINCT FROM 'object' OR octet_length(p_proof::text)>4096 THEN
 RETURN jsonb_build_object('ok',false,'error','github_verification_invalid','http_status',400);END IF;
 BEGIN args:=p_canonical_arguments::jsonb;EXCEPTION WHEN others THEN RETURN jsonb_build_object('ok',false,'error','github_verification_invalid','http_status',400);END;
 SELECT * INTO a FROM public.sandy_api_execution_admissions WHERE id=p_admission_id FOR UPDATE;
 IF a.id IS NULL OR a.principal_kind IS DISTINCT FROM 'auth_user' OR a.tenant_id IS NOT NULL OR a.credential_id IS NOT NULL OR a.is_mutation IS DISTINCT FROM true
 OR a.operation NOT IN ('github.files.create','github.files.update','github.commit') OR NOT public.sandy_api_current_owner(a.actor_id)
 OR a.approval_id IS NULL OR a.input_sha256 IS DISTINCT FROM encode(extensions.digest(p_canonical_arguments,'sha256'),'hex')
 OR a.provider_http_status NOT IN (200,201) OR a.provider_http_status IS NULL THEN
 RETURN jsonb_build_object('ok',false,'error','github_verification_scope_denied','http_status',403);END IF;
 IF p_proof->>'version' IS DISTINCT FROM '1' OR p_proof->>'repository' IS DISTINCT FROM 'ausstyle/web-staging' OR p_proof->>'read_http_status' IS DISTINCT FROM '200'
 OR coalesce(p_proof->>'commit_sha','') !~ '^[a-f0-9]{40}$' OR jsonb_typeof(args->'body') IS DISTINCT FROM 'object' THEN
 RETURN jsonb_build_object('ok',false,'error','github_verification_invalid','http_status',400);END IF;
 IF a.operation='github.commit' THEN
  allowed_keys:=ARRAY['version','kind','repository','commit_sha','tree_sha','parents_sha256','message_sha256','read_http_status'];
  IF p_proof->>'kind' IS DISTINCT FROM 'github_commit' OR p_proof->>'tree_sha' IS DISTINCT FROM args->'body'->>'tree'
  OR coalesce(p_proof->>'tree_sha','') !~ '^[a-f0-9]{40}$' OR jsonb_typeof(args->'body'->'parents') IS DISTINCT FROM 'array'
  OR jsonb_array_length(args->'body'->'parents')>10 OR jsonb_typeof(args->'body'->'message') IS DISTINCT FROM 'string' THEN
  RETURN jsonb_build_object('ok',false,'error','github_verification_mismatch','http_status',409);END IF;
  SELECT '['||coalesce(string_agg(to_jsonb(v)::text,',' ORDER BY n),'')||']' INTO parents_canonical FROM jsonb_array_elements_text(args->'body'->'parents') WITH ORDINALITY e(v,n);
  IF EXISTS(SELECT 1 FROM jsonb_array_elements_text(args->'body'->'parents') e(v) WHERE v !~ '^[a-f0-9]{40}$')
  OR p_proof->>'parents_sha256' IS DISTINCT FROM encode(extensions.digest(parents_canonical,'sha256'),'hex')
  OR p_proof->>'message_sha256' IS DISTINCT FROM encode(extensions.digest(args->'body'->>'message','sha256'),'hex') THEN
  RETURN jsonb_build_object('ok',false,'error','github_verification_mismatch','http_status',409);END IF;
 ELSE
  allowed_keys:=ARRAY['version','kind','repository','commit_sha','blob_sha','path','byte_length','content_sha256','read_http_status'];
  BEGIN content_bytes:=decode(args->'body'->>'content','base64');EXCEPTION WHEN others THEN RETURN jsonb_build_object('ok',false,'error','github_verification_invalid','http_status',400);END;
  IF content_bytes IS NULL OR octet_length(content_bytes)>65536 OR p_proof->>'kind' IS DISTINCT FROM 'github_file'
  OR p_proof->>'path' IS DISTINCT FROM args->'path'->>'path' OR coalesce(p_proof->>'path','')=''
  OR p_proof->>'byte_length' IS DISTINCT FROM octet_length(content_bytes)::text
  OR p_proof->>'content_sha256' IS DISTINCT FROM encode(extensions.digest(content_bytes,'sha256'),'hex')
  OR p_proof->>'blob_sha' IS DISTINCT FROM encode(extensions.digest(convert_to('blob '||octet_length(content_bytes)::text,'UTF8')||decode('00','hex')||content_bytes,'sha1'),'hex') THEN
  RETURN jsonb_build_object('ok',false,'error','github_verification_mismatch','http_status',409);END IF;
 END IF;
 IF EXISTS(SELECT 1 FROM jsonb_object_keys(p_proof) k WHERE NOT k=ANY(allowed_keys)) OR (SELECT count(*) FROM jsonb_object_keys(p_proof))<>cardinality(allowed_keys) THEN
 RETURN jsonb_build_object('ok',false,'error','github_verification_invalid','http_status',400);END IF;
 proof_sha:=encode(extensions.digest(p_proof::text,'sha256'),'hex');
 IF a.state='succeeded' AND a.effect_verification=p_proof THEN RETURN jsonb_build_object('ok',true,'admission_id',a.id,'state','succeeded','verification_sha256',proof_sha,'reused',true);END IF;
 IF a.state IS DISTINCT FROM 'accepted' OR a.effect_verification IS NOT NULL OR a.result_sha256 IS NULL THEN
 RETURN jsonb_build_object('ok',false,'error','github_verification_state_conflict','http_status',409);END IF;
 IF NOT EXISTS(SELECT 1 FROM public.sandy_deployment_jobs j WHERE j.id=a.approval_id AND j.status='running' AND (public.sandy_engineering_policy_job_authorized(j.id,'running') OR (j.approved_by=a.actor_id::text
 AND (j.requested_by=a.actor_id::text OR EXISTS(SELECT 1 FROM public.sandy_engineering_execution_authorizations e
 WHERE e.job_id=j.id AND e.identity_user_id::text=j.requested_by AND e.owner_authority_id=a.actor_id
 AND e.request_id=a.request_id AND e.operation=a.operation AND e.input_sha256=a.input_sha256
 AND e.contract_sha256=a.contract_sha256 AND e.scope_sha256=a.scope_sha256))))) THEN
 RETURN jsonb_build_object('ok',false,'error','github_verification_approval_conflict','http_status',409);END IF;
 UPDATE public.sandy_api_execution_admissions SET state='succeeded',effect_verification=p_proof,finished_at=clock_timestamp(),
 result_sha256=encode(extensions.digest(jsonb_build_object('accepted_result_sha256',a.result_sha256,'verification_sha256',proof_sha)::text,'sha256'),'hex') WHERE id=a.id;
 UPDATE public.sandy_deployment_jobs SET status='succeeded',finished_at=clock_timestamp(),updated_at=clock_timestamp(),
 result=coalesce(result,'{}'::jsonb)||jsonb_build_object('effect_verified',true,'verification_sha256',proof_sha,'reconciliation_required',false) WHERE id=a.approval_id;
 PERFORM public.sandy_api_append_audit(a.actor_id,a.operation,a.request_id,a.credential_id,a.id,'verification','succeeded',a.input_sha256,proof_sha,200,NULL);
 RETURN jsonb_build_object('ok',true,'admission_id',a.id,'state','succeeded','verification_sha256',proof_sha,'reused',false);
END $verify$;


CREATE FUNCTION public.sandy_engineering_authorized_admission(p_admission_id uuid,p_expected_state text DEFAULT 'admitted')
RETURNS boolean LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
 SELECT EXISTS(SELECT 1 FROM public.sandy_api_execution_admissions a JOIN public.sandy_engineering_execution_authorizations e ON e.job_id=a.approval_id
 WHERE a.id=p_admission_id AND a.state=p_expected_state AND a.actor_id=e.owner_authority_id AND a.operation=e.operation
 AND a.request_id=e.request_id AND a.input_sha256=e.input_sha256 AND a.contract_sha256=e.contract_sha256 AND a.scope_sha256=e.scope_sha256
 AND e.delegation_id IS NOT NULL AND a.credential_id IS NULL AND a.tenant_id IS NULL AND a.expires_at>clock_timestamp()
 AND public.sandy_engineering_policy_job_authorized(e.job_id,CASE WHEN p_expected_state='admitted' THEN 'authorized_by_policy' ELSE 'running' END))
$$;
REVOKE ALL ON FUNCTION public.sandy_engineering_authorized_admission(uuid,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.sandy_engineering_authorized_admission(uuid,text) TO service_role;
CREATE OR REPLACE FUNCTION public.sandy_legacy_provider_context(p_context jsonb, p_expected_state text DEFAULT 'admitted'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
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
 IF r.handler IS DISTINCT FROM 'sandy-legacy-compatibility-api' OR r.api_exposed IS DISTINCT FROM true OR (r.verified IS DISTINCT FROM true AND NOT public.sandy_engineering_authorized_admission(a.id,p_expected_state))
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
 IF NOT public.sandy_engineering_authorized_admission(a.id,p_expected_state) AND (a.approval_id IS NULL OR NOT EXISTS(
 SELECT 1 FROM public.sandy_api_mutation_approval_snapshots p
 JOIN public.sandy_deployment_jobs j ON j.id=p.job_id
 JOIN public.sandy_engineering_changes ch ON ch.id=p.engineering_change_id
 WHERE p.job_id=a.approval_id AND p.actor_id=a.actor_id AND p.operation=a.operation
 AND p.input_sha256=a.input_sha256 AND p.contract_sha256=a.contract_sha256 AND p.scope_sha256=a.scope_sha256
 AND a.declared_cost_units<=p.maximum_declared_cost_units
 AND j.status=CASE WHEN p_expected_state='admitted' THEN 'approved' ELSE 'running' END AND ch.status='approved'
 AND p.job_fingerprint_sha256=public.sandy_api_job_fingerprint(j)))
 THEN RETURN jsonb_build_object('allowed',false,'error','immutable_alias_approval_required','http_status',403);END IF;
 RETURN jsonb_build_object('allowed',true,'admission_id',a.id,'reused',false);
EXCEPTION WHEN invalid_text_representation THEN RETURN jsonb_build_object('allowed',false,'error','invalid_legacy_provider_context','http_status',400);
END $function$
;
COMMIT;
