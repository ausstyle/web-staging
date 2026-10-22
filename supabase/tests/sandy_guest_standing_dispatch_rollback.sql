-- Database boundary fixtures only. No provider/guest effect or real Auth login.
-- The existing status contract temporarily requires policy authorization inside
-- this transaction to exercise the same gate used by guest writes, without
-- granting a new write class or changing the production standing policy.
BEGIN;
DO $test$
DECLARE uid uuid:='7a519da9-2ee3-4edf-adec-42697da5a560';owner uuid;epoch integer;
 sid uuid:=gen_random_uuid();req uuid:=gen_random_uuid();job uuid;aid uuid;gid uuid;
 args text:='{"vm_name":"sandy-video"}';scope text:='{"instance_id":"6831598645020395570","project_id":"elaborate-haven-511518-a5","provider":"gcp_guest","vm_name":"sandy-video","zone":"europe-west1-b"}';
 op text:='gcp.vm.agent.status';digest text;contract text;r jsonb;checks integer:=0;
 expiry timestamptz;delegation uuid;
BEGIN
 SELECT credential_epoch,authorized_by INTO epoch,owner
 FROM public.sandy_engineering_test_identities WHERE user_id=uid;
 INSERT INTO auth.sessions(id,user_id,created_at,updated_at,not_after)
 VALUES(sid,uid,clock_timestamp(),clock_timestamp(),clock_timestamp()+interval '30 minutes');
 PERFORM public.sandy_engineering_register_session(uid,sid,epoch,clock_timestamp()+interval '30 minutes');
 UPDATE public.sandy_operation_registry SET error_contract=error_contract||'{"requires_approval":true}'::jsonb WHERE operation=op;
 SELECT error_contract->>'contract_sha256' INTO contract FROM public.sandy_operation_registry WHERE operation=op;
 digest:=encode(extensions.digest(args,'sha256'),'hex');
 r:=public.sandy_engineering_prepare_delegated(uid,sid,epoch,req,op,args,contract,scope);
 IF r->>'ok' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'prepare_fixture: %',r;END IF;
 job:=(r->>'authorization_id')::uuid;delegation:=(r->>'delegation_id')::uuid;
 r:=public.sandy_api_admit_execution(owner,NULL,op,digest,req,NULL,contract,encode(extensions.digest(scope,'sha256'),'hex'),0,job);
 IF r->>'ok' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'admit_fixture: %',r;END IF;
 aid:=(r->>'admission_id')::uuid;gid:=(r->>'grant_id')::uuid;
 IF public.sandy_guest_admission_current(aid,owner,op,digest) THEN RAISE EXCEPTION 'unconsumed_grant_allowed';END IF;checks:=checks+1;
 r:=public.sandy_api_consume_execution_grant(gid,owner,NULL,op,digest,req,contract,encode(extensions.digest(scope,'sha256'),'hex'));
 IF r->>'allowed' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'consume_fixture: %',r;END IF;
 IF NOT public.sandy_guest_admission_current(aid,owner,op,digest) THEN RAISE EXCEPTION 'standing_guest_dispatch_refused';END IF;checks:=checks+1;
 IF EXISTS(SELECT 1 FROM public.sandy_api_mutation_approval_snapshots WHERE job_id=job)
 OR EXISTS(SELECT 1 FROM public.sandy_deployment_jobs WHERE id=job AND (approved_by IS NOT NULL OR approved_at IS NOT NULL))
 THEN RAISE EXCEPTION 'manual_approval_manufactured';END IF;checks:=checks+1;
 IF public.sandy_guest_admission_current(aid,uid,op,digest)
 OR public.sandy_guest_admission_current(aid,owner,'gcp.vm.files.upload',digest)
 OR public.sandy_guest_admission_current(aid,owner,op,repeat('f',64))
 OR public.sandy_guest_admission_current(gen_random_uuid(),owner,op,digest)
 THEN RAISE EXCEPTION 'altered_context_allowed';END IF;checks:=checks+4;
 UPDATE public.sandy_engineering_standing_delegations SET revoked_at=clock_timestamp() WHERE id=delegation;
 IF public.sandy_guest_admission_current(aid,owner,op,digest) THEN RAISE EXCEPTION 'revoked_policy_allowed';END IF;checks:=checks+1;
 UPDATE public.sandy_engineering_standing_delegations SET revoked_at=NULL WHERE id=delegation;
 SELECT expires_at INTO expiry FROM public.sandy_engineering_standing_delegations WHERE id=delegation;
 UPDATE public.sandy_engineering_standing_delegations SET expires_at=clock_timestamp()-interval '1 second' WHERE id=delegation;
 IF public.sandy_guest_admission_current(aid,owner,op,digest) THEN RAISE EXCEPTION 'expired_policy_allowed';END IF;checks:=checks+1;
 UPDATE public.sandy_engineering_standing_delegations d SET expires_at=expiry,version=d.version+1 WHERE id=delegation;
 IF public.sandy_guest_admission_current(aid,owner,op,digest) THEN RAISE EXCEPTION 'replaced_policy_allowed';END IF;checks:=checks+1;
 UPDATE public.sandy_engineering_standing_delegations d SET version=d.version-1 WHERE id=delegation;
 UPDATE auth.sessions SET not_after=clock_timestamp()-interval '1 second' WHERE id=sid;
 IF public.sandy_guest_admission_current(aid,owner,op,digest) THEN RAISE EXCEPTION 'expired_session_allowed';END IF;checks:=checks+1;
 UPDATE auth.sessions SET not_after=clock_timestamp()+interval '30 minutes' WHERE id=sid;
 UPDATE public.sandy_engineering_test_identities SET enabled=false WHERE user_id=uid;
 IF public.sandy_guest_admission_current(aid,owner,op,digest) THEN RAISE EXCEPTION 'disabled_identity_allowed';END IF;checks:=checks+1;
 UPDATE public.sandy_engineering_test_identities SET enabled=true WHERE user_id=uid;
 UPDATE public.sandy_operation_registry SET verified=false WHERE operation=op;
 IF public.sandy_guest_admission_current(aid,owner,op,digest) THEN RAISE EXCEPTION 'unverified_contract_allowed';END IF;checks:=checks+1;
 UPDATE public.sandy_operation_registry SET verified=true WHERE operation=op;
 IF NOT public.sandy_guest_admission_current(aid,owner,op,digest) THEN RAISE EXCEPTION 'fixture_restore_failed';END IF;checks:=checks+1;
 UPDATE public.sandy_api_execution_admissions SET expires_at=clock_timestamp()-interval '1 second' WHERE id=aid;
 IF public.sandy_guest_admission_current(aid,owner,op,digest) THEN RAISE EXCEPTION 'expired_admission_allowed';END IF;checks:=checks+1;
 IF has_function_privilege('service_role','public.sandy_guest_admission_current(uuid,uuid,text,text)','EXECUTE')
 OR has_function_privilege('authenticated','public.sandy_guest_admission_current(uuid,uuid,text,text)','EXECUTE')
 OR has_function_privilege('anon','public.sandy_guest_admission_current(uuid,uuid,text,text)','EXECUTE')
 THEN RAISE EXCEPTION 'guest_private_gate_exposed';END IF;checks:=checks+1;
 PERFORM set_config('sandy.guest.dispatch.checks',checks::text,true);
END $test$;
SELECT current_setting('sandy.guest.dispatch.checks')::integer checks;
ROLLBACK;
