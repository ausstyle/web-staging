BEGIN;
-- Existing accepted mutation evidence remains immutable history. This adds an
-- explicit, narrow verification transition; generic finish still cannot claim
-- that a mutation succeeded. No new execution ledger or operation is created.
ALTER TABLE public.sandy_api_execution_admissions ADD COLUMN effect_verification jsonb;
ALTER TABLE public.sandy_api_execution_admissions ADD CONSTRAINT sandy_api_effect_verification_bounded CHECK(effect_verification IS NULL OR (jsonb_typeof(effect_verification)='object' AND octet_length(effect_verification::text)<=4096));
CREATE FUNCTION public.sandy_api_verify_github_mutation(p_admission_id uuid,p_canonical_arguments text,p_proof jsonb)
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
 IF NOT EXISTS(SELECT 1 FROM public.sandy_deployment_jobs j WHERE j.id=a.approval_id AND j.approved_by=a.actor_id::text AND j.status='running'
 AND (j.requested_by=a.actor_id::text OR EXISTS(SELECT 1 FROM public.sandy_engineering_execution_authorizations e
 WHERE e.job_id=j.id AND e.identity_user_id::text=j.requested_by AND e.owner_authority_id=a.actor_id
 AND e.request_id=a.request_id AND e.operation=a.operation AND e.input_sha256=a.input_sha256
 AND e.contract_sha256=a.contract_sha256 AND e.scope_sha256=a.scope_sha256))) THEN
 RETURN jsonb_build_object('ok',false,'error','github_verification_approval_conflict','http_status',409);END IF;
 UPDATE public.sandy_api_execution_admissions SET state='succeeded',effect_verification=p_proof,finished_at=clock_timestamp(),
 result_sha256=encode(extensions.digest(jsonb_build_object('accepted_result_sha256',a.result_sha256,'verification_sha256',proof_sha)::text,'sha256'),'hex') WHERE id=a.id;
 UPDATE public.sandy_deployment_jobs SET status='succeeded',finished_at=clock_timestamp(),updated_at=clock_timestamp(),
 result=coalesce(result,'{}'::jsonb)||jsonb_build_object('effect_verified',true,'verification_sha256',proof_sha,'reconciliation_required',false) WHERE id=a.approval_id;
 PERFORM public.sandy_api_append_audit(a.actor_id,a.operation,a.request_id,a.credential_id,a.id,'verification','succeeded',a.input_sha256,proof_sha,200,NULL);
 RETURN jsonb_build_object('ok',true,'admission_id',a.id,'state','succeeded','verification_sha256',proof_sha,'reused',false);
END $verify$;
REVOKE ALL ON FUNCTION public.sandy_api_verify_github_mutation(uuid,text,jsonb) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.sandy_api_verify_github_mutation(uuid,text,jsonb) TO service_role;
NOTIFY pgrst,'reload schema';
COMMIT;
