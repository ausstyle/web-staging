-- Run inside BEGIN/ROLLBACK with the new migrations/class index installed in
-- that transaction. These are database component tests, not authenticated MCP
-- or provider evidence. A temporary Auth session never leaves the transaction.
DO $test$
DECLARE identity_id uuid;owner_id uuid;epoch integer;session_id uuid:=gen_random_uuid();expiry timestamptz:=clock_timestamp()+interval '30 minutes';
 policy jsonb:='{"version":"standing-engineering-v1","risk_ceiling":"routine","declared_unit_budget":0,"requests_per_minute":30,"environments":["test","production"],"resources":{"github":["ausstyle/web-staging"],"supabase":["zmqlyygzqoidkcwdysok"],"gcp":["elaborate-haven-511518-a5"]},"classes":{"github":["metadata_read","source_read","code_write","git_write","pull_request_write"],"supabase":["metadata_read"],"gcp":["metadata_read"]}}';
 result jsonb;scope text:='{"provider":"github","repository":"ausstyle/web-staging"}';args text;contract text;request_id uuid;job uuid;admission uuid;grant_id uuid;checks integer:=0;
BEGIN
 SELECT i.user_id,i.authorized_by,i.credential_epoch INTO STRICT identity_id,owner_id,epoch FROM public.sandy_engineering_test_identities i JOIN auth.users u ON u.id=i.user_id WHERE u.email='sandy-engineering-test@sandy-ai.internal' AND i.enabled AND i.revoked_at IS NULL AND i.rotation_state='ready';
 IF has_function_privilege('service_role','public.sandy_engineering_admin_set_standing(uuid,jsonb,text,timestamptz,boolean,text)','EXECUTE')
 OR has_function_privilege('authenticated','public.sandy_engineering_admin_set_standing(uuid,jsonb,text,timestamptz,boolean,text)','EXECUTE')
 OR has_table_privilege('service_role','public.sandy_engineering_standing_delegations','UPDATE')
 OR has_table_privilege('authenticated','public.sandy_engineering_operation_classes','INSERT') THEN RAISE EXCEPTION 'workload_can_expand_authority';END IF;checks:=checks+4;
 IF EXISTS(SELECT 1 FROM public.sandy_controller_admins WHERE auth_user_id=identity_id) THEN RAISE EXCEPTION 'global_controller_membership';END IF;checks:=checks+1;
 INSERT INTO auth.sessions(id,user_id,created_at,updated_at,not_after) VALUES(session_id,identity_id,clock_timestamp(),clock_timestamp(),expiry);
 result:=public.sandy_engineering_register_session(identity_id,session_id,epoch,expiry);IF result->>'ok' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'component_session_failed %',result;END IF;
 result:=public.sandy_engineering_admin_set_standing(identity_id,policy,repeat('a',64),expiry,false,repeat('b',40));
 IF result->>'ok' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'admin_policy_install';END IF;checks:=checks+1;
 result:=public.sandy_engineering_resolve_standing(identity_id,session_id,epoch);
 IF result->>'ok' IS DISTINCT FROM 'true' OR NOT(result->'operations' ? 'github.repos.get') THEN RAISE EXCEPTION 'routine_discovery_failed %',result;END IF;checks:=checks+1;
 IF result->'operations' ? 'github.repos.delete' THEN RAISE EXCEPTION 'high_risk_discovered';END IF;checks:=checks+1;
 -- A complete read lifecycle uses the shared ledger and contains no owner-signoff.
 request_id:=gen_random_uuid();contract:=(SELECT error_contract->>'contract_sha256' FROM public.sandy_operation_registry WHERE operation='github.repos.get');
 result:=public.sandy_engineering_prepare_delegated(identity_id,session_id,epoch,request_id,'github.repos.get','{}',contract,scope);
 IF result->>'authorization_state' IS DISTINCT FROM 'authorized_by_policy' THEN RAISE EXCEPTION 'delegated_read_preparation %',result;END IF;job:=(result->>'authorization_id')::uuid;checks:=checks+1;
 IF NOT EXISTS(SELECT 1 FROM public.sandy_deployment_jobs WHERE id=job AND status='authorized_by_policy' AND approved_by IS NULL AND approved_at IS NULL)
 OR EXISTS(SELECT 1 FROM public.sandy_api_mutation_approval_snapshots WHERE job_id=job) THEN RAISE EXCEPTION 'fabricated_interactive_approval';END IF;checks:=checks+1;
 result:=public.sandy_api_admit_execution(owner_id,NULL,'github.repos.get',encode(extensions.digest('{}','sha256'),'hex'),request_id,NULL,contract,encode(extensions.digest(scope,'sha256'),'hex'),0,job);
 IF result->>'ok' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'shared_admission_failed %',result;END IF;admission:=(result->>'admission_id')::uuid;grant_id:=(result->>'grant_id')::uuid;checks:=checks+1;
 IF NOT public.sandy_engineering_authorized_admission(admission,'admitted') THEN RAISE EXCEPTION 'trusted_admission_check';END IF;checks:=checks+1;
 result:=public.sandy_api_consume_execution_grant(grant_id,owner_id,NULL,'github.repos.get',encode(extensions.digest('{}','sha256'),'hex'),request_id,contract,encode(extensions.digest(scope,'sha256'),'hex'));
 IF result->>'allowed' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'shared_consume_failed %',result;END IF;checks:=checks+1;
 result:=public.sandy_api_finish_execution(admission,'succeeded',200,NULL,repeat('c',64));
 IF result->>'state' IS DISTINCT FROM 'succeeded' OR NOT EXISTS(SELECT 1 FROM public.sandy_deployment_jobs WHERE id=job AND status='succeeded' AND approved_by IS NULL) THEN RAISE EXCEPTION 'shared_settlement_failed';END IF;checks:=checks+1;
 result:=public.sandy_engineering_owns_execution(identity_id,session_id,epoch,request_id);
 IF result->>'owned' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'own_receipt_hidden';END IF;checks:=checks+1;
 result:=public.sandy_engineering_owns_execution(identity_id,session_id,epoch,gen_random_uuid());
 IF result->>'owned' IS DISTINCT FROM 'false' THEN RAISE EXCEPTION 'foreign_receipt_visible';END IF;checks:=checks+1;
 -- Exact requests reuse authorization; changed inputs cannot reuse the nonce.
 result:=public.sandy_engineering_prepare_delegated(identity_id,session_id,epoch,request_id,'github.repos.get','{}',contract,scope);
 IF result->>'reused' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'idempotency_not_preserved';END IF;checks:=checks+1;
 result:=public.sandy_engineering_prepare_delegated(identity_id,session_id,epoch,request_id,'github.repos.get','{"changed":true}',contract,scope);
 IF result->>'error' IS DISTINCT FROM 'engineering_request_conflict' THEN RAISE EXCEPTION 'changed_input_reused';END IF;checks:=checks+1;
 result:=public.sandy_engineering_prepare_delegated(identity_id,session_id,epoch,gen_random_uuid(),'github.repos.get','{}',contract,'{"provider":"github","repository":"other/repository"}');
 IF result->>'http_status' IS DISTINCT FROM '403' THEN RAISE EXCEPTION 'foreign_repository_allowed';END IF;checks:=checks+1;
 result:=public.sandy_engineering_prepare_delegated(identity_id,session_id,epoch,gen_random_uuid(),'github.repos.delete','{}',(SELECT error_contract->>'contract_sha256' FROM public.sandy_operation_registry WHERE operation='github.repos.delete'),scope);
 IF result->>'http_status' IS DISTINCT FROM '403' THEN RAISE EXCEPTION 'high_risk_delete_allowed';END IF;checks:=checks+1;
 contract:=(SELECT error_contract->>'contract_sha256' FROM public.sandy_operation_registry WHERE operation='github.files.update');
 args:='{"body":{"branch":"main","content":"Zml4dHVyZQ==","message":"component","sha":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"},"path":{"path":"engineering-smoke/component.txt"}}';
 result:=public.sandy_engineering_prepare_delegated(identity_id,session_id,epoch,gen_random_uuid(),'github.files.update',args,contract,scope);
 IF result->>'http_status' IS DISTINCT FROM '403' THEN RAISE EXCEPTION 'production_branch_write_allowed';END IF;checks:=checks+1;
 args:=replace(args,'"main"','"engineering/component"');
 IF NOT public.sandy_engineering_policy_target(policy,'github.files.update',args::jsonb,scope::jsonb) THEN RAISE EXCEPTION 'routine_branch_denied';END IF;checks:=checks+1;
 IF public.sandy_engineering_policy_target(policy,'github.files.update',replace(args,'engineering-smoke/component.txt','.github/workflows/privilege.yml')::jsonb,scope::jsonb)
 OR public.sandy_engineering_policy_target(policy,'github.files.update',replace(args,'engineering-smoke/component.txt','../outside.txt')::jsonb,scope::jsonb) THEN RAISE EXCEPTION 'security_or_path_escape';END IF;checks:=checks+2;
 request_id:=gen_random_uuid();result:=public.sandy_engineering_prepare_delegated(identity_id,session_id,epoch,request_id,'github.files.update',args,contract,scope);job:=(result->>'authorization_id')::uuid;
 result:=public.sandy_api_admit_execution(owner_id,NULL,'github.files.update',encode(extensions.digest(args,'sha256'),'hex'),request_id,NULL,contract,encode(extensions.digest(scope,'sha256'),'hex'),0,job);
 IF result->>'ok' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'routine_mutation_not_admitted %',result;END IF;admission:=(result->>'admission_id')::uuid;grant_id:=(result->>'grant_id')::uuid;checks:=checks+1;
 UPDATE public.sandy_engineering_standing_delegations SET revoked_at=clock_timestamp() WHERE identity_user_id=identity_id;
 result:=public.sandy_api_consume_execution_grant(grant_id,owner_id,NULL,'github.files.update',encode(extensions.digest(args,'sha256'),'hex'),request_id,contract,encode(extensions.digest(scope,'sha256'),'hex'));
 IF result->>'allowed'='true' THEN RAISE EXCEPTION 'revoked_after_admission_dispatched';END IF;checks:=checks+1;
 UPDATE public.sandy_engineering_standing_delegations SET revoked_at=NULL,expires_at=clock_timestamp()-interval '1 second' WHERE identity_user_id=identity_id;
 IF public.sandy_engineering_authorized_admission(admission,'admitted') THEN RAISE EXCEPTION 'expired_policy_accepted';END IF;checks:=checks+1;
 UPDATE public.sandy_engineering_standing_delegations SET expires_at=expiry,version=version+1 WHERE identity_user_id=identity_id;
 IF public.sandy_engineering_authorized_admission(admission,'admitted') THEN RAISE EXCEPTION 'stale_policy_version_accepted';END IF;checks:=checks+1;
 result:=public.sandy_engineering_resolve_standing(identity_id,session_id,epoch+1);IF result->>'ok'='true' THEN RAISE EXCEPTION 'wrong_epoch_accepted';END IF;checks:=checks+1;
 BEGIN PERFORM public.sandy_engineering_admin_set_standing(identity_id,jsonb_set(policy,'{classes,github}','["restricted"]'),repeat('a',64),expiry,false,repeat('b',40));RAISE EXCEPTION 'unbounded_class_install';EXCEPTION WHEN insufficient_privilege THEN checks:=checks+1;END;
 PERFORM set_config('sandy.fixture.checks',checks::text,true);
END $test$;
SELECT current_setting('sandy.fixture.checks')::integer checks;
