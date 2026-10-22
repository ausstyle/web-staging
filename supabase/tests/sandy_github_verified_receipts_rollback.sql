-- Administrative SQL boundary assertions only. No Auth login, provider call,
-- workload role or production approval is created. Everything rolls back.
BEGIN;
SET LOCAL statement_timeout='20s';SET LOCAL lock_timeout='3s';
CREATE TEMP TABLE github_verification_assertions(label text PRIMARY KEY,passed boolean) ON COMMIT DROP;
CREATE FUNCTION pg_temp.github_assert(ok boolean,label text) RETURNS void LANGUAGE plpgsql AS $$BEGIN
 IF ok IS DISTINCT FROM true THEN RAISE EXCEPTION 'GitHub verification assertion: %',label;END IF;
 INSERT INTO pg_temp.github_verification_assertions VALUES(label,true);END $$;
DO $component$
DECLARE actor uuid;change_id uuid;job uuid;admission uuid;canonical text;proof jsonb;result jsonb;blob text;input_hash text;
BEGIN
 SELECT i.authorized_by,i.delegation_change_id INTO actor,change_id FROM public.sandy_engineering_test_identities i WHERE i.enabled AND i.revoked_at IS NULL AND public.sandy_api_current_owner(i.authorized_by) LIMIT 1;
 IF actor IS NULL THEN RAISE EXCEPTION 'Existing authorized fixture identity unavailable';END IF;
 INSERT INTO public.sandy_deployment_jobs(requested_by,provider,operation,target,payload,idempotency_key,status,approved_by,approved_at,engineering_change_id)
 VALUES(actor::text,'github','rollback-only-readback','ausstyle/web-staging','{}',gen_random_uuid()::text,'running',actor::text,now(),change_id) RETURNING id INTO job;
 canonical:='{"body":{"content":"eA==","message":"rollback-only","sha":"'||repeat('c',40)||'"},"path":{"path":"engineering-smoke/rollback.txt"}}';
 input_hash:=encode(extensions.digest(canonical,'sha256'),'hex');blob:=encode(extensions.digest(decode('626c6f6220310078','hex'),'sha1'),'hex');
 INSERT INTO public.sandy_api_execution_admissions(actor_id,operation,request_id,is_mutation,input_sha256,contract_sha256,scope_sha256,registry_revision_sha256,declared_cost_units,approval_id,state,expires_at,provider_http_status,result_sha256)
 VALUES(actor,'github.files.update',gen_random_uuid(),true,input_hash,repeat('a',64),repeat('b',64),repeat('c',64),0,job,'accepted',now()+interval '60 seconds',200,repeat('d',64)) RETURNING id INTO admission;
 proof:=jsonb_build_object('version',1,'kind','github_file','repository','ausstyle/web-staging','commit_sha',repeat('a',40),'blob_sha',blob,'path','engineering-smoke/rollback.txt','byte_length',1,'content_sha256',encode(extensions.digest('x','sha256'),'hex'),'read_http_status',200);
 result:=public.sandy_api_verify_github_mutation(admission,canonical||' ',proof);
 PERFORM pg_temp.github_assert(result->>'http_status'='403','different_admitted_input_refused');
 result:=public.sandy_api_verify_github_mutation(admission,canonical,proof||jsonb_build_object('content_sha256',repeat('0',64)));
 PERFORM pg_temp.github_assert(result->>'http_status'='409','wrong_content_digest_refused');
 result:=public.sandy_api_verify_github_mutation(admission,canonical,proof||jsonb_build_object('blob_sha',repeat('b',40)));
 PERFORM pg_temp.github_assert(result->>'http_status'='409','Git_blob_identity_checked');
 result:=public.sandy_api_verify_github_mutation(admission,canonical,proof||jsonb_build_object('repository','foreign/repo'));
 PERFORM pg_temp.github_assert(result->>'http_status'='400','foreign_repository_refused');
 result:=public.sandy_api_verify_github_mutation(admission,canonical,proof||jsonb_build_object('raw_content','forbidden'));
 PERFORM pg_temp.github_assert(result->>'http_status'='400','raw_material_not_stored');
 result:=public.sandy_api_finish_execution(admission,'succeeded',200,NULL,repeat('e',64));
 PERFORM pg_temp.github_assert(result->>'error'='mutation_readback_required','generic_finish_remains_closed');
 result:=public.sandy_api_verify_github_mutation(admission,canonical,proof);
 PERFORM pg_temp.github_assert(result->>'state'='succeeded' AND result->>'reused'='false','actual_valid_readback_settles_existing_accepted_admission');
 PERFORM pg_temp.github_assert((SELECT state='succeeded' AND effect_verification=proof FROM public.sandy_api_execution_admissions WHERE id=admission),'verification_evidence_durable');
 PERFORM pg_temp.github_assert((SELECT status='succeeded' FROM public.sandy_deployment_jobs WHERE id=job),'existing_job_settled');
 PERFORM pg_temp.github_assert((SELECT count(*)=1 FROM public.sandy_api_audit_events WHERE admission_id=admission AND phase='verification' AND outcome='succeeded'),'shared_audit_appended');
 result:=public.sandy_api_verify_github_mutation(admission,canonical,proof);
 PERFORM pg_temp.github_assert(result->>'reused'='true','same_proof_idempotent');
 result:=public.sandy_api_verify_github_mutation(admission,canonical,proof||jsonb_build_object('commit_sha',repeat('b',40)));
 PERFORM pg_temp.github_assert(result->>'http_status'='409','conflicting_settlement_refused');
 INSERT INTO public.sandy_deployment_jobs(requested_by,provider,operation,target,payload,idempotency_key,status,approved_by,approved_at,engineering_change_id)
 VALUES(actor::text,'github','rollback-only-commit','ausstyle/web-staging','{}',gen_random_uuid()::text,'running',actor::text,now(),change_id) RETURNING id INTO job;
 canonical:='{"body":{"message":"component","parents":["'||repeat('c',40)||'"],"tree":"'||repeat('b',40)||'"}}';
 INSERT INTO public.sandy_api_execution_admissions(actor_id,operation,request_id,is_mutation,input_sha256,contract_sha256,scope_sha256,registry_revision_sha256,declared_cost_units,approval_id,state,expires_at,provider_http_status,result_sha256)
 VALUES(actor,'github.commit',gen_random_uuid(),true,encode(extensions.digest(canonical,'sha256'),'hex'),repeat('a',64),repeat('b',64),repeat('c',64),0,job,'accepted',now()+interval '60 seconds',201,repeat('d',64)) RETURNING id INTO admission;
 proof:=jsonb_build_object('version',1,'kind','github_commit','repository','ausstyle/web-staging','commit_sha',repeat('a',40),'tree_sha',repeat('b',40),'parents_sha256',encode(extensions.digest('["'||repeat('c',40)||'"]','sha256'),'hex'),'message_sha256',encode(extensions.digest('component','sha256'),'hex'),'read_http_status',200);
 result:=public.sandy_api_verify_github_mutation(admission,canonical,proof||jsonb_build_object('tree_sha',repeat('a',40)));
 PERFORM pg_temp.github_assert(result->>'http_status'='409','wrong_commit_tree_refused');
 result:=public.sandy_api_verify_github_mutation(admission,canonical,proof);
 PERFORM pg_temp.github_assert(result->>'state'='succeeded','immutable_commit_settlement');
 PERFORM pg_temp.github_assert(NOT has_function_privilege('authenticated','public.sandy_api_verify_github_mutation(uuid,text,jsonb)','EXECUTE'),'customer_cannot_forge_verification');
 PERFORM pg_temp.github_assert(NOT has_function_privilege('anon','public.sandy_api_verify_github_mutation(uuid,text,jsonb)','EXECUTE'),'anonymous_cannot_forge_verification');
END $component$;
SELECT count(*) assertions,bool_and(passed) passed FROM pg_temp.github_verification_assertions;
ROLLBACK;
