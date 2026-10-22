BEGIN;
-- Complete conditional GitHub file deletion and its source-preserving inverse.
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
 OR a.operation NOT IN ('github.files.create','github.files.update','github.files.delete','github.files.upsert','github.update_file','github.commit','github.git.commits.create','github.refs.create','github.refs.update') OR NOT public.sandy_api_current_owner(a.actor_id)
 OR a.approval_id IS NULL OR a.input_sha256 IS DISTINCT FROM encode(extensions.digest(p_canonical_arguments,'sha256'),'hex')
 OR a.provider_http_status NOT IN (200,201) OR a.provider_http_status IS NULL THEN
 RETURN jsonb_build_object('ok',false,'error','github_verification_scope_denied','http_status',403);END IF;
 IF p_proof->>'version' IS DISTINCT FROM '1' OR p_proof->>'repository' IS DISTINCT FROM 'ausstyle/web-staging' OR p_proof->>'read_http_status' IS DISTINCT FROM (CASE WHEN a.operation='github.files.delete' THEN '404' ELSE '200' END)
 OR coalesce(p_proof->>'commit_sha','') !~ '^[a-f0-9]{40}$' OR jsonb_typeof(args->'body') IS DISTINCT FROM 'object' THEN
 RETURN jsonb_build_object('ok',false,'error','github_verification_invalid','http_status',400);END IF;
 IF a.operation='github.files.delete' THEN
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
CREATE OR REPLACE FUNCTION public.sandy_engineering_capture_recovery(p_user_id uuid, p_session_id uuid, p_epoch integer, p_request_id uuid, p_record jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
DECLARE ctx jsonb;source public.sandy_api_execution_admissions;c public.sandy_api_execution_admissions;b public.sandy_api_execution_admissions;
 inverse jsonb;verify_args jsonb;resource jsonb;parent text;prior public.sandy_lifecycle_snapshots;snapshot_id uuid;old_sha text;absent boolean;
BEGIN
 ctx:=public.sandy_engineering_recovery_context(p_user_id,p_session_id,p_epoch,p_request_id);IF ctx->>'ok' IS DISTINCT FROM 'true' THEN RETURN ctx;END IF;
 SELECT * INTO source FROM public.sandy_api_execution_admissions WHERE id=(ctx->>'admission_id')::uuid FOR UPDATE;
 SELECT * INTO prior FROM public.sandy_lifecycle_snapshots WHERE source_admission_id=source.id;
 IF FOUND THEN RETURN jsonb_build_object('ok',true,'snapshot_id',prior.id,'reused',true);END IF;
 IF p_record IS NULL OR jsonb_typeof(p_record) IS DISTINCT FROM 'object' OR octet_length(p_record::text)>800000 OR p_record->>'proof_version' IS DISTINCT FROM '2' THEN
 RETURN jsonb_build_object('ok',false,'error','immutable_recovery_proof_invalid','http_status',409);END IF;
 SELECT * INTO c FROM public.sandy_api_execution_admissions WHERE id=(p_record->>'commit_read_admission_id')::uuid;
 SELECT * INTO b FROM public.sandy_api_execution_admissions WHERE id=(p_record->>'read_admission_id')::uuid;
 parent:=p_record->'commit_read_result'->'parents'->0->>'sha';old_sha:=ctx->>'expected_blob_sha';absent:=old_sha IS NULL;
 resource:=jsonb_build_object('provider','github','repository','ausstyle/web-staging','branch',ctx->'branch','path',ctx->'path');
 verify_args:=jsonb_build_object('path',jsonb_build_object('path',ctx->'path'),'query',jsonb_build_object('ref',ctx->'branch'));
 inverse:=jsonb_build_object('path',verify_args->'path','body',jsonb_build_object('branch',ctx->'branch','sha',ctx->'blob_sha','message','Sandy compensation for '||p_request_id::text));
 IF ctx->>'effect_exists'='false' THEN inverse:=inverse#-ARRAY['body','sha'];END IF;
 IF NOT absent THEN inverse:=jsonb_set(inverse,'{body,content}',p_record->'read_result'->'content');END IF;
 IF c.id IS NULL OR b.id IS NULL OR parent IS NULL OR parent !~ '^[a-f0-9]{40}$'
 OR c.actor_id IS DISTINCT FROM source.actor_id OR b.actor_id IS DISTINCT FROM source.actor_id
 OR c.operation IS DISTINCT FROM 'github.git.commits.get' OR b.operation IS DISTINCT FROM 'github.files.content.get'
 OR c.state IS DISTINCT FROM 'succeeded' OR c.created_at<source.finished_at OR b.created_at<c.finished_at
 OR c.is_mutation OR b.is_mutation OR c.credential_id IS NOT NULL OR b.credential_id IS NOT NULL OR c.tenant_id IS NOT NULL OR b.tenant_id IS NOT NULL
 OR NOT EXISTS(SELECT 1 FROM public.sandy_engineering_execution_authorizations WHERE job_id=c.approval_id AND identity_user_id=p_user_id)
 OR NOT EXISTS(SELECT 1 FROM public.sandy_engineering_execution_authorizations WHERE job_id=b.approval_id AND identity_user_id=p_user_id)
 OR NOT public.sandy_lifecycle_json_proof(p_record->'commit_read_result',p_record->>'commit_read_result_canonical',c.result_sha256)
 OR NOT public.sandy_lifecycle_json_proof(jsonb_build_object('path',jsonb_build_object('commit_sha',ctx->'commit_sha')),p_record->>'commit_read_arguments_canonical',c.input_sha256)
 OR p_record->'commit_read_result'->>'sha' IS DISTINCT FROM ctx->>'commit_sha'
 OR NOT public.sandy_lifecycle_json_proof(p_record->'read_result',p_record->>'read_result_canonical',b.result_sha256)
 OR NOT public.sandy_lifecycle_json_proof(p_record->'read_arguments',p_record->>'read_arguments_canonical',b.input_sha256)
 OR p_record->'read_arguments' IS DISTINCT FROM jsonb_build_object('path',verify_args->'path','query',jsonb_build_object('ref',parent))
 OR p_record->>'read_operation' IS DISTINCT FROM b.operation
 OR (absent AND (b.state IS DISTINCT FROM 'failed' OR b.provider_http_status IS DISTINCT FROM 404 OR p_record->'read_result' IS DISTINCT FROM '{"error":"provider_resource_not_found","provider_http_status":404}'::jsonb))
 OR (NOT absent AND (b.state IS DISTINCT FROM 'succeeded' OR p_record->'read_result'->>'path' IS DISTINCT FROM ctx->>'path'
   OR p_record->'read_result'->>'sha' IS DISTINCT FROM old_sha OR public.sandy_lifecycle_blob_sha(p_record->'read_result'->>'content') IS DISTINCT FROM old_sha))
 OR p_record->'baseline' IS DISTINCT FROM (CASE WHEN absent THEN '{"exists":false}'::jsonb ELSE jsonb_build_object('exists',true,'sha',old_sha) END)
 OR p_record->'expected_effect' IS DISTINCT FROM (CASE WHEN ctx->>'effect_exists'='false' THEN '{"exists":false}'::jsonb ELSE jsonb_build_object('exists',true,'sha',ctx->'blob_sha') END) OR p_record->'resource' IS DISTINCT FROM resource
 OR p_record->>'verify_operation' IS DISTINCT FROM 'github.files.metadata.get' OR p_record->'verify_arguments' IS DISTINCT FROM verify_args
 OR NOT public.sandy_lifecycle_json_proof(verify_args,p_record->>'verify_arguments_canonical',p_record->>'verify_input_sha256')
 OR p_record->>'compensation_operation' IS DISTINCT FROM (CASE WHEN ctx->>'effect_exists'='false' THEN 'github.files.create' WHEN absent THEN 'github.files.delete' ELSE 'github.files.update' END)
 OR p_record->'compensation_arguments' IS DISTINCT FROM inverse
 OR NOT public.sandy_lifecycle_json_proof(inverse,p_record->>'compensation_arguments_canonical',p_record->>'compensation_input_sha256') THEN
 RETURN jsonb_build_object('ok',false,'error','immutable_recovery_proof_invalid','http_status',409);END IF;
 INSERT INTO public.sandy_lifecycle_snapshots(actor_id,source_admission_id,source_request_id,source_operation,source_arguments,record)
 VALUES(source.actor_id,source.id,source.request_id,source.operation,jsonb_build_object('path',verify_args->'path','body',jsonb_build_object('branch',ctx->'branch','sha',old_sha)),p_record) RETURNING id INTO snapshot_id;
 RETURN jsonb_build_object('ok',true,'snapshot_id',snapshot_id,'reused',false);
EXCEPTION WHEN invalid_text_representation THEN RETURN jsonb_build_object('ok',false,'error','immutable_recovery_proof_invalid','http_status',409);
END $function$
;
CREATE OR REPLACE FUNCTION public.sandy_engineering_recovery_context(p_user_id uuid, p_session_id uuid, p_epoch integer, p_request_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
DECLARE owned jsonb;a public.sandy_api_execution_admissions;j public.sandy_deployment_jobs;
BEGIN
 owned:=public.sandy_engineering_owns_execution(p_user_id,p_session_id,p_epoch,p_request_id);
 IF owned->>'owned' IS DISTINCT FROM 'true' THEN RETURN jsonb_build_object('ok',false,'error','recovery_source_not_owned','http_status',404);END IF;
 SELECT admission.* INTO a FROM public.sandy_api_execution_admissions admission
 JOIN public.sandy_engineering_execution_authorizations e ON e.job_id=admission.approval_id AND admission.actor_id=e.owner_authority_id AND admission.request_id=e.request_id
 WHERE e.identity_user_id=p_user_id AND e.request_id=p_request_id;
 SELECT * INTO j FROM public.sandy_deployment_jobs WHERE id=a.approval_id;
 IF a.operation NOT IN('github.files.create','github.files.update','github.files.delete','github.update_file') OR a.state IS DISTINCT FROM 'succeeded'
 OR a.effect_verification->>'kind' IS DISTINCT FROM (CASE WHEN a.operation='github.files.delete' THEN 'github_file_deleted' ELSE 'github_file' END) OR a.effect_verification->>'repository' IS DISTINCT FROM 'ausstyle/web-staging'
 OR a.effect_verification->>'path' IS DISTINCT FROM j.payload->'recovery'->>'path'
 OR coalesce(j.payload->'recovery'->>'branch','') !~ '^engineering/[A-Za-z0-9_./-]+$'
 OR coalesce(a.effect_verification->>'commit_sha','') !~ '^[a-f0-9]{40}$'
 OR coalesce(a.effect_verification->>'blob_sha','') !~ '^[a-f0-9]{40}$'
 THEN RETURN jsonb_build_object('ok',false,'error','verified_github_recovery_source_required','http_status',424);END IF;
 RETURN jsonb_build_object('ok',true,'admission_id',a.id,'operation',a.operation,'commit_sha',a.effect_verification->'commit_sha',
 'effect_exists',a.operation<>'github.files.delete','blob_sha',a.effect_verification->'blob_sha','path',a.effect_verification->'path','branch',j.payload->'recovery'->'branch',
 'expected_blob_sha',j.payload->'recovery'->'expected_blob_sha','snapshot_exists',EXISTS(SELECT 1 FROM public.sandy_lifecycle_snapshots WHERE source_admission_id=a.id));
END $function$
;
CREATE OR REPLACE FUNCTION public.sandy_lifecycle_effect_matches(p_operation text, p_record jsonb, p_phase text, p_observed jsonb, p_absent boolean)
 RETURNS boolean
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
DECLARE expected jsonb:=p_record->(CASE WHEN p_phase='source' THEN 'expected_effect' ELSE 'baseline' END);
BEGIN
 IF p_operation IN('github.files.upsert','github.files.create','github.files.update','github.files.delete','github.update_file') THEN
  IF expected->>'exists'='false' THEN RETURN p_absent; END IF;
  RETURN coalesce(NOT p_absent AND p_observed->>'path'=p_record->'resource'->>'path' AND p_observed->>'type'='file' AND p_observed->>'sha'=expected->>'sha',false);
 END IF;
 RETURN coalesce(NOT p_absent AND public.sandy_lifecycle_vm_identity(p_observed)=expected,false);
END $function$
;
CREATE OR REPLACE FUNCTION public.sandy_lifecycle_observe(p_actor_id uuid, p_snapshot_id uuid, p_phase text, p_read_admission_id uuid, p_read_result jsonb, p_read_result_canonical text, p_matched boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
DECLARE s public.sandy_lifecycle_snapshots%ROWTYPE; a public.sandy_api_execution_admissions%ROWTYPE; source public.sandy_api_execution_admissions%ROWTYPE; c public.sandy_lifecycle_compensations%ROWTYPE; observation_id uuid;
BEGIN
 IF NOT public.sandy_api_current_owner(p_actor_id) THEN RETURN jsonb_build_object('ok',false,'error','owner_required','http_status',403); END IF;
 IF p_phase IS NULL OR p_phase NOT IN ('source','compensation') OR p_matched IS NULL THEN RETURN jsonb_build_object('ok',false,'error','invalid_lifecycle_observation','http_status',400); END IF;
 SELECT * INTO s FROM public.sandy_lifecycle_snapshots WHERE id=p_snapshot_id AND actor_id=p_actor_id;
 SELECT * INTO source FROM public.sandy_api_execution_admissions WHERE id=s.source_admission_id;
 SELECT * INTO a FROM public.sandy_api_execution_admissions WHERE id=p_read_admission_id;
 SELECT * INTO c FROM public.sandy_lifecycle_compensations WHERE snapshot_id=p_snapshot_id;
 IF s.id IS NULL OR a.actor_id IS DISTINCT FROM p_actor_id OR a.tenant_id IS NOT NULL OR a.credential_id IS NOT NULL OR a.is_mutation IS DISTINCT FROM false
 OR source.state NOT IN ('accepted','unknown','succeeded') OR source.consumed_at IS NULL OR a.created_at<source.consumed_at
 OR a.operation IS DISTINCT FROM s.record->>'verify_operation' OR a.input_sha256 IS DISTINCT FROM s.record->>'verify_input_sha256'
 OR NOT (a.state='succeeded' OR (((p_phase='compensation' AND s.record->'baseline'->>'exists'='false') OR (p_phase='source' AND s.record->'expected_effect'->>'exists'='false')) AND a.state='failed' AND a.provider_http_status=404))
 OR NOT public.sandy_lifecycle_json_proof(p_read_result,p_read_result_canonical,a.result_sha256)
 OR p_matched IS DISTINCT FROM public.sandy_lifecycle_effect_matches(s.source_operation,s.record,p_phase,p_read_result,a.state='failed' AND a.provider_http_status=404)
 OR (p_phase='compensation' AND (c.snapshot_id IS NULL OR c.admission_id IS NULL OR c.state NOT IN ('accepted','unknown','verified') OR a.created_at<c.reserved_at
  OR NOT EXISTS(SELECT 1 FROM public.sandy_api_execution_admissions inverse WHERE inverse.id=c.admission_id AND inverse.state IN ('accepted','unknown','succeeded') AND inverse.consumed_at IS NOT NULL))) THEN
  RETURN jsonb_build_object('ok',false,'error','lifecycle_readback_proof_invalid','http_status',409);
 END IF;
 INSERT INTO public.sandy_lifecycle_observations(snapshot_id,read_admission_id,phase,matched,observation)
 VALUES(s.id,a.id,p_phase,p_matched,p_read_result) ON CONFLICT(snapshot_id,read_admission_id,phase) DO NOTHING RETURNING id INTO observation_id;
 IF observation_id IS NULL THEN SELECT id INTO observation_id FROM public.sandy_lifecycle_observations WHERE snapshot_id=s.id AND read_admission_id=a.id AND phase=p_phase AND matched=p_matched; END IF;
 IF observation_id IS NULL THEN RETURN jsonb_build_object('ok',false,'error','immutable_observation_conflict','http_status',409); END IF;
 IF p_phase='compensation' AND p_matched THEN UPDATE public.sandy_lifecycle_compensations SET state='verified',finished_at=clock_timestamp() WHERE snapshot_id=s.id; END IF;
 -- A policy-bound delete may have an accepted/unknown response, followed by an
 -- actual canonical 404. Only this owned inverse and immutable snapshot can
 -- establish its absence proof; unrelated mutations cannot use this transition.
 IF p_phase='compensation' AND p_matched AND s.record->>'proof_version'='2'
 AND s.record->'baseline'->>'exists'='false' AND a.state='failed' AND a.provider_http_status=404 THEN
  UPDATE public.sandy_api_execution_admissions inverse SET state='succeeded',finished_at=clock_timestamp(),
   effect_verification=jsonb_build_object('version',1,'kind','github_compensation_absence','snapshot_id',s.id,'read_admission_id',a.id,'observation_id',observation_id),
   result_sha256=encode(extensions.digest(coalesce(inverse.result_sha256,'')||':'||a.result_sha256,'sha256'),'hex')
  WHERE inverse.id=c.admission_id AND inverse.operation='github.files.delete' AND inverse.state IN('accepted','unknown')
   AND inverse.consumed_at IS NOT NULL AND inverse.approval_id=c.approval_id
   AND inverse.input_sha256=s.record->>'compensation_input_sha256'
   AND public.sandy_engineering_policy_job_authorized(c.approval_id,'running');
  IF FOUND THEN
   UPDATE public.sandy_deployment_jobs SET status='succeeded',finished_at=clock_timestamp(),updated_at=clock_timestamp(),
    result=coalesce(result,'{}'::jsonb)||jsonb_build_object('effect_verified',true,'snapshot_id',s.id,'read_admission_id',a.id,'reconciliation_required',false) WHERE id=c.approval_id;
   PERFORM public.sandy_api_append_audit(p_actor_id,'github.files.delete',c.request_id,NULL,c.admission_id,'verification','succeeded',s.record->>'compensation_input_sha256',a.result_sha256,404,NULL);
  END IF;
 END IF;

 RETURN jsonb_build_object('ok',true,'observation_id',observation_id,'effect_confirmed',p_matched,'phase',p_phase,'read_admission_id',a.id);
END $function$
;
CREATE OR REPLACE FUNCTION public.sandy_engineering_prepare_delegated(p_user_id uuid, p_session_id uuid, p_epoch integer, p_request_id uuid, p_operation text, p_canonical_arguments text, p_contract_sha256 text, p_canonical_scope text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
DECLARE r jsonb;a jsonb;s jsonb;d public.sandy_engineering_standing_delegations;c public.sandy_engineering_operation_classes;
 prior public.sandy_engineering_execution_authorizations;input_hash text;scope_hash text;job uuid;count_recent integer;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended(p_user_id::text||':'||p_request_id::text,0));
 r:=public.sandy_engineering_resolve_standing(p_user_id,p_session_id,p_epoch);
 IF r->>'ok' IS DISTINCT FROM 'true' THEN RETURN r;END IF;
 IF p_request_id IS NULL OR p_canonical_arguments IS NULL OR octet_length(p_canonical_arguments)>1550000 OR octet_length(p_canonical_scope)>8192
 THEN RETURN jsonb_build_object('ok',false,'error','invalid_delegated_request','http_status',400);END IF;
 a:=p_canonical_arguments::jsonb;s:=p_canonical_scope::jsonb;
 SELECT * INTO d FROM public.sandy_engineering_standing_delegations WHERE id=(r->>'delegation_id')::uuid FOR UPDATE;
 IF d.id IS NULL OR d.revoked_at IS NOT NULL OR d.expires_at<=clock_timestamp() OR d.version::text IS DISTINCT FROM r->>'version' THEN
 RETURN jsonb_build_object('ok',false,'error','standing_delegation_inactive','http_status',403);END IF;
 SELECT * INTO c FROM public.sandy_engineering_operation_classes WHERE operation=p_operation;
 IF NOT (r->'operations' ? p_operation) OR c.contract_sha256 IS DISTINCT FROM p_contract_sha256
 OR NOT public.sandy_engineering_policy_target(d.policy,p_operation,a,s)
 OR (c.provider='github' AND c.operation_class='code_write' AND c.method='DELETE' AND NOT EXISTS(
  SELECT 1 FROM public.sandy_engineering_execution_authorizations owned
  JOIN public.sandy_api_execution_admissions effect ON effect.approval_id=owned.job_id AND effect.request_id=owned.request_id AND effect.actor_id=owned.owner_authority_id
  JOIN public.sandy_deployment_jobs source_job ON source_job.id=owned.job_id
  WHERE owned.identity_user_id=p_user_id AND effect.state='succeeded' AND effect.effect_verification->>'kind'='github_file'
  AND effect.effect_verification->>'blob_sha'=a->'body'->>'sha' AND effect.effect_verification->>'path'=a->'path'->>'path'
  AND source_job.payload->'recovery'->>'branch'=a->'body'->>'branch' AND effect.scope_sha256=encode(extensions.digest(p_canonical_scope,'sha256'),'hex')
 )) THEN
 RETURN jsonb_build_object('ok',false,'error','engineering_policy_blocked','http_status',403,'authorization_state','policy_blocked');END IF;
 input_hash:=encode(extensions.digest(p_canonical_arguments,'sha256'),'hex');scope_hash:=encode(extensions.digest(p_canonical_scope,'sha256'),'hex');
 SELECT * INTO prior FROM public.sandy_engineering_execution_authorizations WHERE identity_user_id=p_user_id AND request_id=p_request_id;
 IF FOUND THEN
  IF prior.operation IS DISTINCT FROM p_operation OR prior.input_sha256 IS DISTINCT FROM input_hash OR prior.contract_sha256 IS DISTINCT FROM p_contract_sha256
   OR prior.scope_sha256 IS DISTINCT FROM scope_hash OR prior.delegation_id IS DISTINCT FROM d.id OR prior.delegation_version IS DISTINCT FROM d.version THEN
   RETURN jsonb_build_object('ok',false,'error','engineering_request_conflict','http_status',409);END IF;
  IF NOT EXISTS(SELECT 1 FROM public.sandy_api_execution_admissions WHERE approval_id=prior.job_id)
   AND EXISTS(SELECT 1 FROM public.sandy_deployment_jobs WHERE id=prior.job_id AND status='authorized_by_policy') THEN
   IF NOT EXISTS(SELECT 1 FROM public.sandy_engineering_identity_events ev WHERE ev.identity_user_id=p_user_id
     AND ev.event_type='execution_session_rebound' AND ev.detail->>'job_id'=prior.job_id::text AND ev.detail->>'session_id'=p_session_id::text
     AND ev.detail->>'credential_epoch'=p_epoch::text)
    AND (prior.session_id IS DISTINCT FROM p_session_id OR prior.credential_epoch IS DISTINCT FROM p_epoch) THEN
    INSERT INTO public.sandy_engineering_identity_events(identity_user_id,owner_authority_id,actor_kind,event_type,detail)
    VALUES(p_user_id,d.owner_authority_id,'verified_auth_workload','execution_session_rebound',jsonb_build_object(
      'job_id',prior.job_id,'request_id',prior.request_id,'input_sha256',prior.input_sha256,'contract_sha256',prior.contract_sha256,
      'scope_sha256',prior.scope_sha256,'session_id',p_session_id,'credential_epoch',p_epoch,'delegation_id',d.id,'delegation_version',d.version));
   END IF;
  END IF;
  RETURN jsonb_build_object('ok',true,'authorization_id',prior.job_id,'authorization_state','authorized_by_policy','delegation_id',d.id,'version',d.version,'reused',true);
 END IF;
 SELECT count(*) INTO count_recent FROM public.sandy_engineering_execution_authorizations WHERE identity_user_id=p_user_id AND created_at>=date_trunc('minute',clock_timestamp());
 IF count_recent>=30 THEN RETURN jsonb_build_object('ok',false,'error','engineering_rate_limited','http_status',429);END IF;
 INSERT INTO public.sandy_deployment_jobs(requested_by,provider,operation,target,payload,idempotency_key,status,engineering_change_id)
 VALUES(p_user_id::text,CASE WHEN c.provider='gcp' THEN 'google_cloud' ELSE c.provider END,p_operation,coalesce(s->>'repository',s->>'project_ref',s->>'project_id'),
 jsonb_build_object('authorization_mode','authorized_by_policy','delegation_id',d.id,'delegation_version',d.version,'operation_class',c.operation_class,
 'input_sha256',input_hash,'contract_sha256',c.contract_sha256,'scope_sha256',scope_hash,'source_policy_sha256',d.source_sha256,'source_commit',d.source_commit,
 'recovery',jsonb_build_object('expected_blob_sha',a->'body'->>'sha','branch',coalesce(a->'body'->>'branch',a->'body'->>'ref'),'path',a->'path'->>'path')),
 'standing-engineering:'||p_user_id::text||':'||p_request_id::text,'authorized_by_policy',d.engineering_change_id) RETURNING id INTO job;
 INSERT INTO public.sandy_engineering_execution_authorizations(identity_user_id,request_id,owner_authority_id,session_id,credential_epoch,operation,input_sha256,contract_sha256,scope_sha256,job_id,delegation_id,delegation_version)
 VALUES(p_user_id,p_request_id,d.owner_authority_id,p_session_id,p_epoch,p_operation,input_hash,c.contract_sha256,scope_hash,job,d.id,d.version);
 INSERT INTO public.sandy_engineering_identity_events(identity_user_id,owner_authority_id,actor_kind,event_type,detail)
 VALUES(p_user_id,d.owner_authority_id,'verified_auth_workload','execution_authorized',jsonb_build_object('authorization_state','authorized_by_policy','delegation_id',d.id,'version',d.version,'job_id',job,'operation',p_operation,'request_id',p_request_id,'input_sha256',input_hash));
 RETURN jsonb_build_object('ok',true,'authorization_id',job,'authorization_state','authorized_by_policy','delegation_id',d.id,'version',d.version,'reused',false);
EXCEPTION WHEN invalid_text_representation THEN RETURN jsonb_build_object('ok',false,'error','invalid_delegated_request','http_status',400);
END $function$
;
NOTIFY pgrst,'reload schema';
UPDATE public.sandy_operation_registry SET output_schema='{"type":"object","properties":{"ok":{"const":true},"contract_version":{"const":"1.0.0"},"source_request_id":{"type":"string","format":"uuid"},"snapshot_id":{"type":"string","format":"uuid"},"source_operation":{"enum":["github.files.upsert","github.files.create","github.files.update","github.files.delete","github.update_file","gcp.compute.instances.start","gcp.compute.instances.stop"]},"source_state":{"type":"string"},"captured_at":{"type":"string","format":"date-time"},"resource":{"oneOf":[{"type":"object","properties":{"provider":{"const":"github"},"repository":{"const":"ausstyle/web-staging"},"branch":{"type":"string","pattern":"^(main|engineering/[A-Za-z0-9_./-]+)$"},"path":{"type":"string","minLength":1,"maxLength":1024}},"required":["provider","repository","branch","path"],"additionalProperties":false},{"type":"object","properties":{"provider":{"const":"gcp"},"project_id":{"const":"elaborate-haven-511518-a5"},"zone":{"const":"europe-west1-b"},"instance_id":{"type":"string","pattern":"^[1-9][0-9]{0,19}$"},"instance_name":{"type":"string"}},"required":["provider","project_id","zone","instance_id","instance_name"],"additionalProperties":false}]},"compensation_operation":{"enum":["github.files.upsert","github.files.create","github.files.update","github.files.delete","gcp.compute.instances.start","gcp.compute.instances.stop"]},"compensation_input_sha256":{"type":"string","pattern":"^[a-f0-9]{64}$"},"latest_source_effect_confirmed":{"type":"boolean"},"compensation_request_id":{"type":["string","null"],"format":"uuid"},"compensation_state":{"type":["string","null"],"enum":[null,"reserved","accepted","failed","unknown","verified"]},"provider_state_cas_available":{"type":"boolean"},"limitations":{"type":"array","maxItems":3,"items":{"type":"string"}}},"required":["ok","contract_version","source_request_id","snapshot_id","source_operation","source_state","captured_at","resource","compensation_operation","compensation_input_sha256","latest_source_effect_confirmed","compensation_request_id","compensation_state","provider_state_cas_available","limitations"],"additionalProperties":false}'::jsonb,updated_at=clock_timestamp() WHERE operation='system.lifecycle.get' AND handler='sandy-operation-api';
COMMIT;
