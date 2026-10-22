-- Component test only. The runner supplies an existing real Auth fixture/session
-- and a genuinely owner-approved engineering change. All policy, job and audit
-- writes below roll back. Synthetic request.jwt.claims test owner RPC guards;
-- they are not authentication evidence and never authorize a provider call.
DO $test$
DECLARE identity_id uuid:=current_setting('sandy.fixture.identity')::uuid;
 test_session uuid:=current_setting('sandy.fixture.session')::uuid;
 source_change uuid:=current_setting('sandy.fixture.source_change')::uuid;
 expiry timestamptz:=current_setting('sandy.fixture.expiry')::timestamptz;
 result jsonb; owner_id uuid; op text; request_id uuid; approval uuid; issue_lease uuid; prior_jobs integer; checks integer:=0;
BEGIN
 IF has_function_privilege('authenticated','public.sandy_engineering_bootstrap_identity(uuid,uuid)','EXECUTE')
 OR has_function_privilege('authenticated','public.sandy_engineering_prepare_execution(uuid,uuid,integer,uuid,text,text,text,text)','EXECUTE')
 OR has_table_privilege('authenticated','public.sandy_engineering_test_identities','SELECT')
 OR has_table_privilege('anon','public.sandy_engineering_identity_events','INSERT') THEN RAISE EXCEPTION 'engineering privilege boundary';END IF; checks:=checks+4;
 result:=public.sandy_engineering_provision_identity(identity_id);IF result->>'ok'<>'true' THEN RAISE EXCEPTION 'provision';END IF;checks:=checks+1;
 IF (public.sandy_engineering_resolve_identity(identity_id,test_session,1)->>'ok')::boolean THEN RAISE EXCEPTION 'inactive identity accepted';END IF;checks:=checks+1;
 result:=public.sandy_engineering_bootstrap_identity(identity_id,source_change);IF result->>'authorized'<>'true' THEN RAISE EXCEPTION 'administrative grant under actual owner approval';END IF;checks:=checks+1;
 SELECT authorized_by INTO owner_id FROM public.sandy_engineering_test_identities WHERE user_id=identity_id;
 IF owner_id=identity_id OR EXISTS(SELECT 1 FROM public.sandy_controller_admins WHERE auth_user_id=identity_id) THEN RAISE EXCEPTION 'global membership or impersonation';END IF;checks:=checks+1;
 result:=public.sandy_engineering_store_bootstrap(identity_id,'synthetic_engineering_bootstrap_fixture_111111111111111111111111111111');IF result->>'ok'<>'true' THEN RAISE EXCEPTION 'encrypted bootstrap';END IF;checks:=checks+1;
 result:=public.sandy_engineering_claim_auth_issue(identity_id,1);issue_lease:=(result->>'lease_id')::uuid;IF issue_lease IS NULL THEN RAISE EXCEPTION 'issuer lease';END IF;checks:=checks+1;
 result:=public.sandy_engineering_claim_auth_issue(identity_id,1);IF result->>'busy'<>'true' THEN RAISE EXCEPTION 'overlapping issuer';END IF;checks:=checks+1;
 result:=public.sandy_engineering_release_auth_issue(identity_id,extensions.gen_random_uuid());IF result->>'released'<>'false' THEN RAISE EXCEPTION 'foreign lease released';END IF;checks:=checks+1;
 result:=public.sandy_engineering_release_auth_issue(identity_id,issue_lease);IF result->>'released'<>'true' THEN RAISE EXCEPTION 'issuer lease release';END IF;checks:=checks+1;
 result:=public.sandy_engineering_register_session(identity_id,test_session,1,expiry);IF result->>'ok'<>'true' THEN RAISE EXCEPTION 'register real Auth session';END IF;checks:=checks+1;
 result:=public.sandy_engineering_resolve_identity(identity_id,test_session,1);IF result->>'ok'<>'true' OR result->>'owner_authority_id'<>owner_id::text THEN RAISE EXCEPTION 'resolve exact authority';END IF;checks:=checks+1;
 IF (public.sandy_engineering_resolve_identity(identity_id,extensions.gen_random_uuid(),1)->>'ok')::boolean
 OR (public.sandy_engineering_resolve_identity(identity_id,test_session,2)->>'ok')::boolean THEN RAISE EXCEPTION 'wrong session or epoch';END IF;checks:=checks+2;
 FOREACH op IN ARRAY ARRAY['github.files.update','github.commit','supabase.deploy_edge_function','supabase.db.migrations.apply','supabase.functions.secrets.set','supabase.logs.query'] LOOP
  request_id:=extensions.gen_random_uuid();
  result:=public.sandy_engineering_prepare_execution(identity_id,test_session,1,request_id,op,repeat('a',64),
   (SELECT error_contract->>'contract_sha256' FROM public.sandy_operation_registry WHERE operation=op),repeat('b',64));
  IF result->>'ok'<>'true' THEN RAISE EXCEPTION 'prepare % %',op,result;END IF;approval:=(result->>'approval_id')::uuid;
  IF NOT EXISTS(SELECT 1 FROM public.sandy_api_mutation_approval_snapshots WHERE job_id=approval AND actor_id=owner_id AND operation=op AND input_sha256=repeat('a',64)) THEN RAISE EXCEPTION 'immutable exact approval missing';END IF;
  checks:=checks+2;
 END LOOP;
 result:=public.sandy_engineering_prepare_execution(identity_id,test_session,1,request_id,op,repeat('a',64),
   (SELECT error_contract->>'contract_sha256' FROM public.sandy_operation_registry WHERE operation=op),repeat('b',64));
 IF result->>'ok'<>'true' OR result->>'reused'<>'true' OR result->>'approval_id'<>approval::text THEN RAISE EXCEPTION 'idempotent exact request';END IF;checks:=checks+1;
 result:=public.sandy_engineering_prepare_execution(identity_id,test_session,1,request_id,op,repeat('c',64),
   (SELECT error_contract->>'contract_sha256' FROM public.sandy_operation_registry WHERE operation=op),repeat('b',64));
 IF result->>'error'<>'engineering_request_conflict' THEN RAISE EXCEPTION 'changed request reused';END IF;checks:=checks+1;
 result:=public.sandy_engineering_prepare_execution(identity_id,test_session,1,extensions.gen_random_uuid(),'supabase.projects.delete',repeat('a',64),repeat('b',64),repeat('c',64));
 IF result->>'ok'='true' THEN RAISE EXCEPTION 'scope escape';END IF;checks:=checks+1;
 UPDATE public.sandy_engineering_auth_sessions SET expires_at=clock_timestamp()-interval '1 second' WHERE identity_user_id=identity_id AND session_id=test_session;
 IF (public.sandy_engineering_resolve_identity(identity_id,test_session,1)->>'ok')::boolean THEN RAISE EXCEPTION 'expired session accepted';END IF;checks:=checks+1;
 UPDATE public.sandy_engineering_auth_sessions SET expires_at=expiry WHERE identity_user_id=identity_id;
 result:=public.sandy_engineering_rotate_identity(identity_id,false);IF result->>'ok'<>'true' OR result->>'credential_epoch'<>'2' THEN RAISE EXCEPTION 'rotation begin';END IF;checks:=checks+1;
 IF (public.sandy_engineering_resolve_identity(identity_id,test_session,1)->>'ok')::boolean THEN RAISE EXCEPTION 'old epoch accepted during rotation';END IF;checks:=checks+1;
 IF EXISTS(SELECT 1 FROM public.sandy_deployment_jobs j JOIN public.sandy_engineering_execution_authorizations e ON e.job_id=j.id WHERE e.identity_user_id=identity_id AND j.status='approved') THEN RAISE EXCEPTION 'old approved jobs survived rotation';END IF;checks:=checks+1;
 result:=public.sandy_engineering_rotate_identity(identity_id,true);IF result->>'ok'='true' THEN RAISE EXCEPTION 'rotation completed without Auth metadata readback';END IF;checks:=checks+1;
 UPDATE auth.users SET raw_app_meta_data=jsonb_set(raw_app_meta_data,'{sandy_engineering_epoch}','2'::jsonb) WHERE id=identity_id;
 result:=public.sandy_engineering_rotate_identity(identity_id,true);IF result->>'ok'='true' THEN RAISE EXCEPTION 'rotation before bootstrap replacement';END IF;checks:=checks+1;
 result:=public.sandy_engineering_store_bootstrap(identity_id,'synthetic_engineering_bootstrap_fixture_222222222222222222222222222222');IF result->>'ok'<>'true' THEN RAISE EXCEPTION 'encrypted rotated bootstrap';END IF;checks:=checks+1;
 result:=public.sandy_engineering_rotate_identity(identity_id,true);IF result->>'ok'<>'true' THEN RAISE EXCEPTION 'metadata-confirmed rotation';END IF;checks:=checks+1;
 result:=public.sandy_engineering_provision_identity(identity_id);IF result->>'ok'<>'true' THEN RAISE EXCEPTION 'rotated provisioning idempotency';END IF;checks:=checks+1;
 result:=public.sandy_engineering_bootstrap_identity(identity_id,source_change);IF result->>'reused'<>'true' THEN RAISE EXCEPTION 'rotated grant idempotency';END IF;checks:=checks+1;
 PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',identity_id,'role','authenticated')::text,true);
 BEGIN PERFORM public.sandy_engineering_revoke_identity(identity_id);RAISE EXCEPTION 'nonowner revoked grant';EXCEPTION WHEN insufficient_privilege THEN checks:=checks+1;END;
 PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',owner_id,'role','authenticated')::text,true);
 result:=public.sandy_engineering_revoke_identity(identity_id);IF result->>'revoked'<>'true' THEN RAISE EXCEPTION 'owner revocation';END IF;checks:=checks+1;
 IF (public.sandy_engineering_resolve_identity(identity_id,test_session,2)->>'ok')::boolean THEN RAISE EXCEPTION 'revoked identity accepted';END IF;checks:=checks+1;
 BEGIN UPDATE public.sandy_engineering_identity_events SET detail='{}' WHERE identity_user_id=identity_id;RAISE EXCEPTION 'audit mutable';EXCEPTION WHEN check_violation THEN checks:=checks+1;END;
 IF EXISTS(SELECT 1 FROM public.sandy_engineering_identity_events WHERE identity_user_id=identity_id AND detail::text ~ '(access_token|refresh_token|hashed_token|authorization.*Bearer)') THEN RAISE EXCEPTION 'credential audit disclosure';END IF;checks:=checks+1;
 PERFORM set_config('sandy.fixture.checks',checks::text,true);
END $test$;
SELECT current_setting('sandy.fixture.checks')::integer checks;
