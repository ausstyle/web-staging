-- Database guard tests only; synthetic sessions are rolled back and do not
-- substitute for authenticated MCP/provider acceptance.
BEGIN;
DO $test$
DECLARE uid uuid:='7a519da9-2ee3-4edf-adec-42697da5a560';sid uuid:=gen_random_uuid();req uuid:=gen_random_uuid();owner uuid;epoch integer;contract text;job uuid;admission uuid;grant_id uuid;r jsonb;checks integer:=0;
 scope text:='{"provider":"github","repository":"ausstyle/web-staging"}';
 args text:='{"body":{"force":false,"sha":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"},"path":{"ref":"heads/engineering/boundary-sql-test"}}';
BEGIN
 IF has_function_privilege('anon','public.sandy_engineering_github_publication_context(uuid)','EXECUTE') OR has_function_privilege('authenticated','public.sandy_engineering_github_publication_context(uuid)','EXECUTE')
 THEN RAISE EXCEPTION 'private_source_context_exposed';END IF;checks:=checks+1;
 IF NOT has_function_privilege('service_role','public.sandy_engineering_github_publication_context(uuid)','EXECUTE') THEN RAISE EXCEPTION 'service_source_context_missing';END IF;checks:=checks+1;
 r:=public.sandy_engineering_github_publication_context(gen_random_uuid());IF r->>'ok' IS DISTINCT FROM 'false' THEN RAISE EXCEPTION 'missing_admission_authorized';END IF;checks:=checks+1;
 SELECT credential_epoch,authorized_by INTO epoch,owner FROM public.sandy_engineering_test_identities WHERE user_id=uid;
 INSERT INTO auth.sessions(id,user_id,created_at,updated_at,not_after) VALUES(sid,uid,clock_timestamp(),clock_timestamp(),clock_timestamp()+interval '30 minutes');
 PERFORM public.sandy_engineering_register_session(uid,sid,epoch,clock_timestamp()+interval '30 minutes');
 SELECT error_contract->>'contract_sha256' INTO contract FROM public.sandy_operation_registry WHERE operation='github.refs.update';
 r:=public.sandy_engineering_prepare_delegated(uid,sid,epoch,req,'github.refs.update',args,contract,scope);
 IF r->>'ok' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'prepare_source_test %',r;END IF;job:=(r->>'authorization_id')::uuid;
 r:=public.sandy_api_admit_execution(owner,NULL,'github.refs.update',encode(extensions.digest(args,'sha256'),'hex'),req,NULL,contract,encode(extensions.digest(scope,'sha256'),'hex'),0,job);
 IF r->>'ok' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'admit_source_test %',r;END IF;admission:=(r->>'admission_id')::uuid;grant_id:=(r->>'grant_id')::uuid;
 r:=public.sandy_engineering_github_publication_context(admission);IF r->>'ok' IS DISTINCT FROM 'false' THEN RAISE EXCEPTION 'unconsumed_source_context_accepted';END IF;checks:=checks+1;
 r:=public.sandy_api_consume_execution_grant(grant_id,owner,NULL,'github.refs.update',encode(extensions.digest(args,'sha256'),'hex'),req,contract,encode(extensions.digest(scope,'sha256'),'hex'));
 IF r->>'allowed' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'consume_source_test %',r;END IF;
 r:=public.sandy_engineering_github_publication_context(admission);
 IF r->>'ok' IS DISTINCT FROM 'true' OR r->>'mode' IS DISTINCT FROM 'standing_engineering' OR r->>'baseline_commit' IS DISTINCT FROM (SELECT source_commit FROM public.sandy_engineering_standing_delegations WHERE identity_user_id=uid) THEN RAISE EXCEPTION 'trusted_source_baseline_missing %',r;END IF;checks:=checks+1;
 IF EXISTS(SELECT 1 FROM public.sandy_api_mutation_approval_snapshots WHERE job_id=job) OR (SELECT approved_by FROM public.sandy_deployment_jobs WHERE id=job) IS NOT NULL THEN RAISE EXCEPTION 'standing_source_fabricated_owner_approval';END IF;checks:=checks+1;
 UPDATE public.sandy_engineering_standing_delegations SET revoked_at=clock_timestamp() WHERE identity_user_id=uid;
 r:=public.sandy_engineering_github_publication_context(admission);IF r->>'ok' IS DISTINCT FROM 'false' THEN RAISE EXCEPTION 'revoked_source_context_accepted';END IF;checks:=checks+1;
 PERFORM set_config('sandy.source_boundary.checks',checks::text,true);
END $test$;
SELECT current_setting('sandy.source_boundary.checks')::integer checks;
ROLLBACK;
