-- Component checks using the existing dedicated engineering identity.
-- Requires the standing-policy migrations; no normal Auth/provider acceptance is claimed.
BEGIN;
DO $test$ DECLARE uid uuid:='7a519da9-2ee3-4edf-adec-42697da5a560';owner uuid;epoch integer;sid1 uuid:=gen_random_uuid();sid2 uuid:=gen_random_uuid();sid3 uuid:=gen_random_uuid();req uuid:=gen_random_uuid();job uuid;r jsonb;contract text;scope text:='{"provider":"github","repository":"ausstyle/web-staging"}';admission uuid;grant_id uuid;checks integer:=0;seq bigint;
BEGIN
 SELECT credential_epoch,authorized_by INTO epoch,owner FROM public.sandy_engineering_test_identities WHERE user_id=uid;
 INSERT INTO auth.sessions(id,user_id,created_at,updated_at,not_after) SELECT id,uid,clock_timestamp(),clock_timestamp(),clock_timestamp()+interval '30 minutes' FROM unnest(ARRAY[sid1,sid2,sid3]) id;
 PERFORM public.sandy_engineering_register_session(uid,sid1,epoch,clock_timestamp()+interval '30 minutes');PERFORM public.sandy_engineering_register_session(uid,sid2,epoch,clock_timestamp()+interval '30 minutes');PERFORM public.sandy_engineering_register_session(uid,sid3,epoch,clock_timestamp()+interval '30 minutes');
 SELECT error_contract->>'contract_sha256' INTO contract FROM public.sandy_operation_registry WHERE operation='github.repos.get';
 r:=public.sandy_engineering_prepare_delegated(uid,sid1,epoch,req,'github.repos.get','{}',contract,scope);IF r->>'ok' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'pending_prepare %',r;END IF;job:=(r->>'authorization_id')::uuid;
 r:=public.sandy_engineering_prepare_delegated(uid,sid1,epoch,req,'github.repos.get','{}',contract,scope);IF r->>'reused' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'same_session_pending_reuse';END IF;checks:=checks+1;
 r:=public.sandy_engineering_prepare_delegated(uid,sid2,epoch,req,'github.repos.get','{}',contract,scope);IF r->>'reused' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'renewed_pending_reuse';END IF;checks:=checks+1;
 UPDATE auth.sessions SET not_after=clock_timestamp()-interval '1 second' WHERE id=sid1;
 IF NOT public.sandy_engineering_policy_job_authorized(job,'authorized_by_policy') THEN RAISE EXCEPTION 'renewed_binding_refused';END IF;checks:=checks+1;
 IF NOT EXISTS(SELECT 1 FROM public.sandy_engineering_execution_authorizations WHERE job_id=job AND session_id=sid1) THEN RAISE EXCEPTION 'original_authority_rewritten';END IF;checks:=checks+1;
 IF (SELECT count(*) FROM public.sandy_engineering_identity_events WHERE event_type='execution_session_rebound' AND detail->>'job_id'=job::text)<>1 THEN RAISE EXCEPTION 'binding_not_append_only';END IF;checks:=checks+1;
 r:=public.sandy_api_admit_execution(owner,NULL,'github.repos.get',encode(extensions.digest('{}','sha256'),'hex'),req,NULL,contract,encode(extensions.digest(scope,'sha256'),'hex'),0,job);IF r->>'ok' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'renewed_admit %',r;END IF;admission:=(r->>'admission_id')::uuid;grant_id:=(r->>'grant_id')::uuid;
 r:=public.sandy_api_consume_execution_grant(grant_id,owner,NULL,'github.repos.get',encode(extensions.digest('{}','sha256'),'hex'),req,contract,encode(extensions.digest(scope,'sha256'),'hex'));IF r->>'allowed' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'renewed_dispatch %',r;END IF;checks:=checks+1;
 r:=public.sandy_engineering_prepare_delegated(uid,sid3,epoch,req,'github.repos.get','{}',contract,scope);
 IF (SELECT count(*) FROM public.sandy_engineering_identity_events WHERE event_type='execution_session_rebound' AND detail->>'job_id'=job::text)<>1 THEN RAISE EXCEPTION 'consumed_request_rebound';END IF;checks:=checks+1;
 BEGIN UPDATE public.sandy_engineering_execution_authorizations SET session_id=sid3 WHERE job_id=job;RAISE EXCEPTION 'immutable_trigger_removed';EXCEPTION WHEN check_violation THEN checks:=checks+1;END;
 r:=public.sandy_engineering_record_policy_denial(uid,sid3,epoch,gen_random_uuid(),'github.repos.delete',repeat('a',64),'engineering_operation_scope_denied');IF r->>'ok' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'denial_not_recorded %',r;END IF;seq:=(r->>'audit_sequence')::bigint;checks:=checks+1;
 IF NOT EXISTS(SELECT 1 FROM public.sandy_api_audit_events WHERE sequence=seq AND phase='policy' AND outcome='rejected' AND admission_id IS NULL AND input_sha256=repeat('a',64) AND event_sha256=encode(extensions.digest(previous_sha256||public.sandy_api_audit_payload(sandy_api_audit_events)::text,'sha256'),'hex')) THEN RAISE EXCEPTION 'denial_audit_not_valid';END IF;checks:=checks+1;
 PERFORM set_config('sandy.session.checks',checks::text,true);
END $test$;SELECT current_setting('sandy.session.checks')::integer checks;
ROLLBACK;
