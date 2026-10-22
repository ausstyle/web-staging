-- Component-only fixture. Run with the pending-compensation migration installed
-- inside BEGIN/ROLLBACK. Synthetic read/dispatch records never leave this
-- transaction and are not real Auth or provider execution evidence.
DO $test$
DECLARE uid uuid:='7a519da9-2ee3-4edf-adec-42697da5a560';owner uuid;epoch integer;sid uuid:=gen_random_uuid();s public.sandy_lifecycle_snapshots;
 r jsonb;read_request uuid:=gen_random_uuid();read_job uuid;read_admission uuid;read_grant uuid;read_contract text;observation uuid;
 inverse_request uuid:=gen_random_uuid();inverse_job uuid;inverse_contract text;inverse_admission uuid;inverse_grant uuid;
 scope text:='{"provider":"github","repository":"ausstyle/web-staging"}';read_result jsonb;read_canonical text;checks integer:=0;
BEGIN
 SELECT credential_epoch,authorized_by INTO epoch,owner FROM public.sandy_engineering_test_identities WHERE user_id=uid;
 SELECT snapshot.* INTO s FROM public.sandy_lifecycle_snapshots snapshot
 JOIN public.sandy_api_execution_admissions a ON a.id=snapshot.source_admission_id
 JOIN public.sandy_engineering_execution_authorizations e ON e.job_id=a.approval_id AND e.identity_user_id=uid
 WHERE snapshot.record->>'proof_version'='2' AND snapshot.source_operation='github.files.update' AND snapshot.record->>'compensation_operation'='github.files.update'
 ORDER BY snapshot.captured_at DESC LIMIT 1;
 IF s.id IS NULL THEN RAISE EXCEPTION 'owned_completed_recovery_fixture_required';END IF;
 INSERT INTO auth.sessions(id,user_id,created_at,updated_at,not_after) VALUES(sid,uid,clock_timestamp(),clock_timestamp(),clock_timestamp()+interval '30 minutes');
 PERFORM public.sandy_engineering_register_session(uid,sid,epoch,clock_timestamp()+interval '30 minutes');
 -- This fresh matched observation is synthetic, for the SQL state machine only.
 SELECT error_contract->>'contract_sha256' INTO read_contract FROM public.sandy_operation_registry WHERE operation='github.files.metadata.get';
 r:=public.sandy_engineering_prepare_delegated(uid,sid,epoch,read_request,'github.files.metadata.get',s.record->>'verify_arguments_canonical',read_contract,scope);read_job:=(r->>'authorization_id')::uuid;
 r:=public.sandy_api_admit_execution(owner,NULL,'github.files.metadata.get',s.record->>'verify_input_sha256',read_request,NULL,read_contract,encode(extensions.digest(scope,'sha256'),'hex'),0,read_job);read_admission:=(r->>'admission_id')::uuid;read_grant:=(r->>'grant_id')::uuid;
 r:=public.sandy_api_consume_execution_grant(read_grant,owner,NULL,'github.files.metadata.get',s.record->>'verify_input_sha256',read_request,read_contract,encode(extensions.digest(scope,'sha256'),'hex'));IF r->>'allowed' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'component_read_admission %',r;END IF;
 read_result:=jsonb_build_object('path',s.record->'resource'->'path','type','file','sha',s.record->'expected_effect'->'sha');read_canonical:=read_result::text;
 PERFORM public.sandy_api_finish_execution(read_admission,'succeeded',200,NULL,encode(extensions.digest(read_canonical,'sha256'),'hex'));
 r:=public.sandy_lifecycle_observe(owner,s.id,'source',read_admission,read_result,read_canonical,true);IF r->>'ok' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'component_observation %',r;END IF;observation:=(r->>'observation_id')::uuid;
 -- Replace only the fixture's compensation inside this rollback transaction.
 DELETE FROM public.sandy_lifecycle_compensations WHERE snapshot_id=s.id;
 SELECT error_contract->>'contract_sha256' INTO inverse_contract FROM public.sandy_operation_registry WHERE operation='github.files.update';
 r:=public.sandy_engineering_prepare_delegated(uid,sid,epoch,inverse_request,'github.files.update',s.record->>'compensation_arguments_canonical',inverse_contract,scope);IF r->>'ok' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'component_inverse_prepare %',r;END IF;inverse_job:=(r->>'authorization_id')::uuid;
 INSERT INTO public.sandy_lifecycle_compensations(snapshot_id,actor_id,request_id,approval_id,state) VALUES(s.id,owner,inverse_request,inverse_job,'unknown');
 r:=public.sandy_engineering_reserve_compensation(uid,sid,epoch,s.id,observation);
 IF r->>'attempt_delivery' IS DISTINCT FROM 'true' OR r->>'reused' IS DISTINCT FROM 'true' OR r->>'redispatch_permitted' IS DISTINCT FROM 'false' OR r->>'request_id' IS DISTINCT FROM inverse_request::text OR r->>'authorization_id' IS DISTINCT FROM inverse_job::text THEN RAISE EXCEPTION 'safe_pending_delivery_not_resumed %',r;END IF;checks:=checks+1;
 IF EXISTS(SELECT 1 FROM public.sandy_api_execution_admissions WHERE actor_id=owner AND request_id=inverse_request) THEN RAISE EXCEPTION 'resume_created_provider_effect';END IF;checks:=checks+1;
 -- The same request now has an uncertain consumed admission: never deliver it again.
 r:=public.sandy_api_admit_execution(owner,NULL,'github.files.update',s.record->>'compensation_input_sha256',inverse_request,NULL,inverse_contract,encode(extensions.digest(scope,'sha256'),'hex'),0,inverse_job);inverse_admission:=(r->>'admission_id')::uuid;inverse_grant:=(r->>'grant_id')::uuid;
 r:=public.sandy_api_consume_execution_grant(inverse_grant,owner,NULL,'github.files.update',s.record->>'compensation_input_sha256',inverse_request,inverse_contract,encode(extensions.digest(scope,'sha256'),'hex'));IF r->>'allowed' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'component_inverse_consume %',r;END IF;
 PERFORM public.sandy_api_finish_execution(inverse_admission,'unknown',NULL,NULL,repeat('c',64));
 UPDATE public.sandy_lifecycle_compensations SET state='unknown' WHERE snapshot_id=s.id;
 r:=public.sandy_engineering_reserve_compensation(uid,sid,epoch,s.id,observation);
 IF r->>'attempt_delivery' IS DISTINCT FROM 'false' OR r->>'redispatch_permitted' IS DISTINCT FROM 'false' OR r->>'request_id' IS DISTINCT FROM inverse_request::text THEN RAISE EXCEPTION 'uncertain_provider_attempt_was_retried %',r;END IF;checks:=checks+1;
 PERFORM set_config('sandy.pending.checks',checks::text,true);
END $test$;
SELECT current_setting('sandy.pending.checks')::integer checks;
