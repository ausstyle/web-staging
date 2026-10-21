-- Real existing Auth session and real owner-approved video change metadata.
-- SQL claim overrides exercise owner RPC authorization only; they do not mint
-- tokens, call providers, or constitute end-to-end authentication evidence.
DO $test$
DECLARE identity_id uuid:=current_setting('sandy.fixture.identity')::uuid;session_id uuid:=current_setting('sandy.fixture.session')::uuid;epoch integer:=current_setting('sandy.fixture.epoch')::integer;source_id uuid:=current_setting('sandy.fixture.vm_change')::uuid;owner_id uuid;scope jsonb;result jsonb;checks integer:=0;count_jobs integer;
BEGIN
 IF has_function_privilege('authenticated','public.sandy_engineering_authorize_vm_reads(uuid,uuid)','EXECUTE') OR has_function_privilege('authenticated','public.sandy_engineering_record_vm_read(uuid,uuid,integer,text,uuid)','EXECUTE') OR has_table_privilege('authenticated','public.sandy_engineering_vm_read_scopes','SELECT') OR has_table_privilege('service_role','public.sandy_engineering_vm_read_scopes','UPDATE') THEN RAISE EXCEPTION 'VM scope privilege boundary';END IF;checks:=checks+4;
 SELECT authorized_by INTO owner_id FROM public.sandy_engineering_test_identities WHERE user_id=identity_id;
 SELECT count(*) INTO count_jobs FROM public.sandy_deployment_jobs;
 result:=public.sandy_engineering_resolve_identity(identity_id,session_id,epoch);IF result->>'ok' IS DISTINCT FROM 'true' OR jsonb_array_length(result->'operations')<>6 OR result->'vm_read_scope' IS DISTINCT FROM 'null'::jsonb THEN RAISE EXCEPTION 'existing six-operation delegation changed';END IF;checks:=checks+1;
 BEGIN
  PERFORM public.sandy_engineering_authorize_vm_reads(identity_id,gen_random_uuid());RAISE EXCEPTION 'unknown source change accepted';
 EXCEPTION WHEN insufficient_privilege THEN NULL;END;checks:=checks+1;
 result:=public.sandy_engineering_authorize_vm_reads(identity_id,source_id);IF result->>'authorized' IS DISTINCT FROM 'true' OR result->>'provider_writes_authorized' IS DISTINCT FROM 'false' THEN RAISE EXCEPTION 'actual owner-approved read scope';END IF;checks:=checks+1;
 result:=public.sandy_engineering_resolve_identity(identity_id,session_id,epoch);scope:=result->'vm_read_scope';
 IF scope->>'owner_authority_id' IS DISTINCT FROM owner_id::text OR scope->>'source_change_id' IS DISTINCT FROM source_id::text OR jsonb_array_length(scope->'operations')<>9 OR (scope->'operations')?'video.install' OR (scope->'operations')?'video.ssh.iam_grant' THEN RAISE EXCEPTION 'mutation/authority scope leakage';END IF;checks:=checks+4;
 result:=public.sandy_engineering_record_vm_read(identity_id,session_id,epoch,'video.status',gen_random_uuid());IF result->>'authorized' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'authorized recorded read';END IF;checks:=checks+1;
 result:=public.sandy_engineering_record_vm_read(identity_id,session_id,epoch,'video.install',gen_random_uuid());IF result->>'error' IS DISTINCT FROM 'engineering_vm_read_not_authorized' THEN RAISE EXCEPTION 'write accepted under read grant';END IF;checks:=checks+1;
 result:=public.sandy_engineering_record_vm_read(identity_id,gen_random_uuid(),epoch,'video.status',gen_random_uuid());IF result->>'error' IS DISTINCT FROM 'engineering_vm_read_not_authorized' THEN RAISE EXCEPTION 'unknown Auth session accepted';END IF;checks:=checks+1;
 UPDATE public.sandy_engineering_vm_read_scopes SET expires_at=clock_timestamp()-interval '1 second' WHERE identity_user_id=identity_id;
 result:=public.sandy_engineering_resolve_identity(identity_id,session_id,epoch);IF result->>'ok' IS DISTINCT FROM 'true' OR result->'vm_read_scope' IS DISTINCT FROM 'null'::jsonb THEN RAISE EXCEPTION 'expiry did not remove only optional scope';END IF;checks:=checks+1;
 PERFORM public.sandy_engineering_authorize_vm_reads(identity_id,source_id);
 PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',identity_id,'role','authenticated')::text,true);
 result:=public.sandy_engineering_revoke_vm_reads(identity_id);IF result->>'error' IS DISTINCT FROM 'current_controller_owner_required' THEN RAISE EXCEPTION 'machine granted owner RPC';END IF;checks:=checks+1;
 PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',owner_id,'role','authenticated')::text,true);
 result:=public.sandy_engineering_revoke_vm_reads(identity_id);IF result->>'revoked' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'current owner revocation';END IF;checks:=checks+1;
 result:=public.sandy_engineering_resolve_identity(identity_id,session_id,epoch);IF result->>'ok' IS DISTINCT FROM 'true' OR result->'vm_read_scope' IS DISTINCT FROM 'null'::jsonb THEN RAISE EXCEPTION 'optional revocation changed original scope';END IF;checks:=checks+1;
 PERFORM public.sandy_engineering_authorize_vm_reads(identity_id,source_id);
 result:=public.sandy_engineering_administrative_revoke_vm_reads(identity_id);IF result->>'revoked' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'administrative scope revocation';END IF;checks:=checks+1;
 result:=public.sandy_engineering_resolve_identity(identity_id,session_id,epoch);IF result->>'ok' IS DISTINCT FROM 'true' OR result->'vm_read_scope' IS DISTINCT FROM 'null'::jsonb THEN RAISE EXCEPTION 'admin optional revocation changed base scope';END IF;checks:=checks+1;
 PERFORM public.sandy_engineering_authorize_vm_reads(identity_id,source_id);
 FOR i IN 1..29 LOOP result:=public.sandy_engineering_record_vm_read(identity_id,session_id,epoch,'video.status',gen_random_uuid());IF result->>'authorized' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'read budget prematurely exhausted';END IF;END LOOP;checks:=checks+1;
 result:=public.sandy_engineering_record_vm_read(identity_id,session_id,epoch,'video.status',gen_random_uuid());IF result->>'error' IS DISTINCT FROM 'engineering_vm_read_rate_limited' THEN RAISE EXCEPTION 'read rate budget not enforced';END IF;checks:=checks+1;
 PERFORM public.sandy_engineering_rotate_identity(identity_id,false);
 IF public.sandy_engineering_vm_read_scope(identity_id,epoch) IS NOT NULL THEN RAISE EXCEPTION 'rotation retained stale VM scope';END IF;checks:=checks+1;
 IF (SELECT count(*) FROM public.sandy_deployment_jobs)<>count_jobs OR EXISTS(SELECT 1 FROM public.sandy_controller_admins WHERE auth_user_id=identity_id) THEN RAISE EXCEPTION 'read scope added provider jobs or Controller membership';END IF;checks:=checks+2;
 CREATE TEMP TABLE sandy_vm_read_scope_test_report AS SELECT checks passed,0 failed,true rolled_back,false provider_calls;
END $test$;
SELECT * FROM sandy_vm_read_scope_test_report;
