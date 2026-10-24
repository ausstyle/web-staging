BEGIN;
-- Requires the exact PR251 blob verifier; source-only tree extension: no grants, exposure or provider writes.
-- Fail rather than overwrite a newer shared verifier. Preserve its existing ACL.
DO $guard$ BEGIN
 IF encode(extensions.digest(pg_get_functiondef('public.sandy_api_verify_github_mutation(uuid,text,jsonb)'::regprocedure),'sha256'),'hex') <> 'fd417b32d9ae916cd5b6d7bc2aaa0f38e819a95ed46087e4589ac8d3a5bcc2f7' THEN
 RAISE EXCEPTION 'github_tree_settlement_baseline_changed'; END IF;
END $guard$;
CREATE OR REPLACE FUNCTION public.sandy_api_verify_github_mutation(p_admission_id uuid, p_canonical_arguments text, p_proof jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
DECLARE a public.sandy_api_execution_admissions;args jsonb;content_bytes bytea;proof_sha text;parents_canonical text;allowed_keys text[];
BEGIN
 IF p_canonical_arguments IS NULL OR octet_length(p_canonical_arguments)>150000 OR p_proof IS NULL OR jsonb_typeof(p_proof) IS DISTINCT FROM 'object' OR octet_length(p_proof::text)>4096 THEN
 RETURN jsonb_build_object('ok',false,'error','github_verification_invalid','http_status',400);END IF;
 BEGIN args:=p_canonical_arguments::jsonb;EXCEPTION WHEN others THEN RETURN jsonb_build_object('ok',false,'error','github_verification_invalid','http_status',400);END;
 SELECT * INTO a FROM public.sandy_api_execution_admissions WHERE id=p_admission_id FOR UPDATE;
 IF a.id IS NULL OR a.principal_kind IS DISTINCT FROM 'auth_user' OR a.tenant_id IS NOT NULL OR a.credential_id IS NOT NULL OR a.is_mutation IS DISTINCT FROM true
 OR a.operation NOT IN ('github.git.trees.create','github.git.blobs.create','github.files.create','github.files.update','github.files.delete','github.files.upsert','github.update_file','github.commit','github.git.commits.create','github.refs.create','github.refs.update') OR NOT public.sandy_api_current_owner(a.actor_id)
 OR a.approval_id IS NULL OR a.input_sha256 IS DISTINCT FROM encode(extensions.digest(p_canonical_arguments,'sha256'),'hex')
 OR a.provider_http_status NOT IN (200,201) OR a.provider_http_status IS NULL THEN
 RETURN jsonb_build_object('ok',false,'error','github_verification_scope_denied','http_status',403);END IF;
 IF p_proof->>'version' IS DISTINCT FROM '1' OR p_proof->>'repository' IS DISTINCT FROM 'ausstyle/web-staging' OR p_proof->>'read_http_status' IS DISTINCT FROM (CASE WHEN a.operation='github.files.delete' THEN '404' ELSE '200' END)
 OR (a.operation NOT IN ('github.git.blobs.create','github.git.trees.create') AND coalesce(p_proof->>'commit_sha','') !~ '^[a-f0-9]{40}$') OR jsonb_typeof(args->'body') IS DISTINCT FROM 'object' THEN
 RETURN jsonb_build_object('ok',false,'error','github_verification_invalid','http_status',400);END IF;
 IF a.operation='github.git.trees.create' THEN
  allowed_keys:=ARRAY['version','kind','repository','tree_sha','base_tree_sha','input_sha256','read_http_status'];
  IF jsonb_typeof(args->'body'->'tree') IS DISTINCT FROM 'array' THEN
   RETURN jsonb_build_object('ok',false,'error','github_verification_invalid','http_status',400);END IF;
  IF jsonb_array_length(args->'body'->'tree')>128
   OR (args->'body' ? 'base_tree' AND (jsonb_typeof(args->'body'->'base_tree') IS DISTINCT FROM 'string' OR args->'body'->>'base_tree' !~ '^[a-f0-9]{40}$'))
   OR p_proof->>'kind' IS DISTINCT FROM 'github_tree'
   OR coalesce(p_proof->>'tree_sha','') !~ '^[a-f0-9]{40}$'
   OR p_proof->'base_tree_sha' IS DISTINCT FROM coalesce(args->'body'->'base_tree','null'::jsonb)
   OR p_proof->>'input_sha256' IS DISTINCT FROM a.input_sha256 THEN
   RETURN jsonb_build_object('ok',false,'error','github_verification_mismatch','http_status',409);END IF;
  -- The service-only immutable readback verifies base/result graphs and exact
  -- leaf effects. This binds that proof to the already-admitted full input;
  -- it never grants authority or trusts a client-supplied object SHA alone.
 ELSIF a.operation='github.git.blobs.create' THEN
  allowed_keys:=ARRAY['version','kind','repository','blob_sha','byte_length','content_sha256','read_http_status'];
  IF jsonb_typeof(args->'body'->'content') IS DISTINCT FROM 'string' OR length(args->'body'->>'content')>100000
  OR coalesce(args->'body'->>'encoding','utf-8') NOT IN ('utf-8','base64') THEN
  RETURN jsonb_build_object('ok',false,'error','github_verification_invalid','http_status',400);END IF;
  BEGIN
   content_bytes:=CASE WHEN coalesce(args->'body'->>'encoding','utf-8')='base64'
    THEN decode(args->'body'->>'content','base64') ELSE convert_to(args->'body'->>'content','UTF8') END;
  EXCEPTION WHEN others THEN RETURN jsonb_build_object('ok',false,'error','github_verification_invalid','http_status',400);END;
  IF content_bytes IS NULL OR octet_length(content_bytes)>65536 OR p_proof->>'kind' IS DISTINCT FROM 'github_blob'
  OR p_proof->>'byte_length' IS DISTINCT FROM octet_length(content_bytes)::text
  OR p_proof->>'content_sha256' IS DISTINCT FROM encode(extensions.digest(content_bytes,'sha256'),'hex')
  OR p_proof->>'blob_sha' IS DISTINCT FROM encode(extensions.digest(convert_to('blob '||octet_length(content_bytes)::text,'UTF8')||decode('00','hex')||content_bytes,'sha1'),'hex') THEN
  RETURN jsonb_build_object('ok',false,'error','github_verification_mismatch','http_status',409);END IF;
 ELSIF a.operation='github.files.delete' THEN
  allowed_keys:=ARRAY['version','kind','repository','commit_sha','blob_sha','path','read_http_status'];
  IF p_proof->>'kind' IS DISTINCT FROM 'github_file_deleted' OR p_proof->>'path' IS DISTINCT FROM args->'path'->>'path'
  OR coalesce(p_proof->>'path','')='' OR p_proof->>'blob_sha' IS DISTINCT FROM args->'body'->>'sha'
  OR coalesce(p_proof->>'blob_sha','') !~ '^[a-f0-9]{40}$' THEN
  RETURN jsonb_build_object('ok',false,'error','github_verification_mismatch','http_status',409);END IF;
 ELSIF a.operation IN('github.refs.create','github.refs.update') THEN
  allowed_keys:=ARRAY['version','kind','repository','ref','commit_sha','read_http_status'];
  IF p_proof->>'kind' IS DISTINCT FROM 'github_ref'
  OR p_proof->>'commit_sha' IS DISTINCT FROM args->'body'->>'sha'
  OR p_proof->>'ref' IS DISTINCT FROM 'refs/'||regexp_replace(coalesce(args->'body'->>'ref',args->'path'->>'ref'),'^refs/','')
  OR coalesce(p_proof->>'ref','') !~ '^refs/heads/engineering/[A-Za-z0-9_./-]+$'
  OR coalesce(p_proof->>'ref','') ~ '(^|/)\.{1,2}(/|$)' OR coalesce(args->'body'->>'force','false')<>'false' THEN
  RETURN jsonb_build_object('ok',false,'error','github_verification_mismatch','http_status',409);END IF;
 ELSIF a.operation IN('github.commit','github.git.commits.create') THEN
  IF NOT(args->'body' ? 'parents') THEN args:=jsonb_set(args,'{body,parents}','[]'::jsonb);END IF;
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
END $function$
;
COMMIT;
