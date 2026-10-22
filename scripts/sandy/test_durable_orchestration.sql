-- Real DB component tests only: no Auth sessions, workers, provider calls or HTTP.
-- Apply migration first; run in an otherwise empty new durable queue. All
-- membership, target, plan, job, outbox and event fixtures are rolled back.
BEGIN;
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM public.sandy_orch_jobs) THEN RAISE EXCEPTION 'test_requires_isolated_orchestration_queue'; END IF;
 IF has_function_privilege('anon','public.sandy_orch_admit(uuid,text,text,text,jsonb)','EXECUTE') OR
 has_function_privilege('authenticated','public.sandy_orch_resolve_dispatch(uuid,uuid,uuid)','EXECUTE') OR
 NOT has_function_privilege('service_role','public.sandy_orch_claim(uuid,integer,integer)','EXECUTE') OR
 has_table_privilege('service_role','public.sandy_orch_jobs','UPDATE') OR
 has_table_privilege('service_role','public.sandy_orch_outbox','SELECT') OR
 has_function_privilege('service_role','public.sandy_orch_snapshot(text,text)','EXECUTE') THEN
 RAISE EXCEPTION 'durable_orchestration_acl_incorrect'; END IF;
END $$;
SET LOCAL ROLE authenticated;
DO $$ BEGIN
 BEGIN PERFORM public.sandy_orch_catalogue(gen_random_uuid(),'api'); RAISE EXCEPTION 'customer RPC unexpectedly allowed';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;
DO $$
<<test_durable_orchestration>>
DECLARE owner_id uuid:=gen_random_uuid(); other_owner uuid:=gen_random_uuid(); viewer_id uuid:=gen_random_uuid(); worker uuid:=gen_random_uuid();
 catalogue jsonb; contract jsonb; steps jsonb; reply jsonb; again jsonb; plan_id uuid; first_job uuid; second_job uuid;
 claim jsonb; token uuid; dispatch_id uuid; cursor_id bigint; attempt_no integer;
 fixture_target text:='sandy-orch-test-'||gen_random_uuid()::text; legacy_job uuid;
BEGIN
 INSERT INTO public.sandy_controller_admins(auth_user_id,role,enabled) VALUES(owner_id,'owner',true),(other_owner,'owner',true),(viewer_id,'viewer',true);
 reply:=public.sandy_orch_catalogue(viewer_id,'api');
 IF reply->>'error'<>'owner_required' THEN RAISE EXCEPTION 'viewer catalogue allowed'; END IF;
 catalogue:=public.sandy_orch_catalogue(owner_id,'api');
 SELECT value INTO contract FROM jsonb_array_elements(catalogue->'operations') WHERE value->>'operation'='supabase.projects.get';
 IF contract IS NULL THEN RAISE EXCEPTION 'required existing delegated read missing'; END IF;
 steps:=jsonb_build_array(jsonb_build_object('key','identity','operation','supabase.projects.get','arguments','{}'::jsonb,'depends_on','[]'::jsonb,'registry_revision',contract->>'registry_revision','input_sha256',encode(sha256(convert_to('{}','UTF8')),'hex')),
   jsonb_build_object('key','dependent','operation','supabase.projects.get','arguments','{}'::jsonb,'depends_on','["identity"]'::jsonb,'registry_revision',contract->>'registry_revision','input_sha256',encode(sha256(convert_to('{}','UTF8')),'hex')));
 reply:=public.sandy_orch_admit(viewer_id,'api','plan','orchestration-test-viewer',steps);
 IF reply->>'error'<>'owner_required' THEN RAISE EXCEPTION 'viewer admission allowed'; END IF;
 reply:=public.sandy_orch_admit(owner_id,'api','plan','orchestration-test-plan',steps);
 IF reply->>'accepted'<>'true' OR reply->>'executed'<>'false' OR reply->>'request_state'<>'recorded' OR reply->>'reused'<>'false' THEN RAISE EXCEPTION 'admission claims invalid execution state'; END IF;
 plan_id:=(reply->>'plan_id')::uuid;
 SELECT id INTO first_job FROM public.sandy_orch_jobs AS fixture_job WHERE fixture_job.plan_id=test_durable_orchestration.plan_id AND step_key='identity';
 SELECT id INTO second_job FROM public.sandy_orch_jobs AS fixture_job WHERE fixture_job.plan_id=test_durable_orchestration.plan_id AND step_key='dependent';
 again:=public.sandy_orch_admit(owner_id,'api','plan','orchestration-test-plan',steps);
 IF again->>'plan_id'<>plan_id::text OR again->>'reused'<>'true' OR (SELECT count(*) FROM public.sandy_orch_jobs AS fixture_job WHERE fixture_job.plan_id=test_durable_orchestration.plan_id)<>2 THEN RAISE EXCEPTION 'admission not idempotent'; END IF;
 reply:=public.sandy_orch_admit(owner_id,'api','plan','orchestration-test-plan',jsonb_set(steps,'{0,input_sha256}',to_jsonb(repeat('a',64))));
 IF reply->>'error'<>'idempotency_conflict' THEN RAISE EXCEPTION 'changed idempotent request adopted'; END IF;
 reply:=public.sandy_orch_admit(owner_id,'api','plan','orchestration-test-cycle',jsonb_set(steps,'{0,depends_on}','["dependent"]'));
 IF reply->>'error'<>'plan_cycle' THEN RAISE EXCEPTION 'cycle admitted'; END IF;
 BEGIN UPDATE public.sandy_orch_jobs SET arguments='{"changed":true}' WHERE id=first_job; RAISE EXCEPTION 'immutable input changed';
 EXCEPTION WHEN check_violation THEN IF SQLERRM<>'durable_job_approval_snapshot_is_immutable' THEN RAISE; END IF; END;
 reply:=public.sandy_orch_job(other_owner,first_job); IF reply->>'error'<>'job_not_found' THEN RAISE EXCEPTION 'other owner read private job'; END IF;
 reply:=public.sandy_orch_claim(worker,3,90);
 IF jsonb_array_length(reply->'claims')<>1 THEN RAISE EXCEPTION 'dependency claimed before success'; END IF;
 claim:=reply->'claims'->0; token:=(claim->>'lease_token')::uuid;
 IF claim->>'job_id'<>first_job::text THEN RAISE EXCEPTION 'incorrect ready step claimed'; END IF;
 reply:=public.sandy_orch_resolve_dispatch(first_job,gen_random_uuid(),worker); IF reply->>'error'<>'invalid_or_expired_job_lease' THEN RAISE EXCEPTION 'forged lease accepted'; END IF;
 reply:=public.sandy_orch_resolve_dispatch(first_job,token,worker); dispatch_id:=(reply->>'dispatch_id')::uuid;
 IF reply->>'principal_id'<>owner_id::text OR reply->>'operation'<>'supabase.projects.get' OR reply->'arguments'<>'{}'::jsonb OR reply->>'input_sha256'<>encode(sha256(convert_to('{}','UTF8')),'hex') OR dispatch_id IS NULL THEN RAISE EXCEPTION 'dispatch context not pinned'; END IF;
 again:=public.sandy_orch_resolve_dispatch(first_job,token,worker); IF again->>'error'<>'dispatch_already_started' THEN RAISE EXCEPTION 'lease authorized twice'; END IF;
 reply:=public.sandy_orch_attempt_receipt(first_job,token,worker); IF reply->>'dispatch_id'<>dispatch_id::text OR reply->>'started'<>'true' THEN RAISE EXCEPTION 'receipt recovery failed'; END IF;
 reply:=public.sandy_orch_cancel(owner_id,first_job); IF reply->>'error'<>'job_not_cancellable' THEN RAISE EXCEPTION 'running read falsely cancelled'; END IF;
 reply:=public.sandy_orch_heartbeat(first_job,token,worker,90); IF reply->>'ok'<>'true' THEN RAISE EXCEPTION 'valid heartbeat failed'; END IF;
 reply:=public.sandy_orch_finish(first_job,token,worker,dispatch_id,'succeeded','{"ok":true,"synthetic":true}',NULL,'synthetic-request',gen_random_uuid());
 IF reply->>'error' NOT IN ('execution_admission_unavailable','execution_admission_invalid') OR NOT EXISTS(SELECT 1 FROM public.sandy_orch_jobs WHERE id=first_job AND state='running') THEN RAISE EXCEPTION 'nonexistent admission used as execution proof'; END IF;
 reply:=public.sandy_orch_finish(first_job,token,worker,dispatch_id,'succeeded','{"ok":true,"synthetic":true}',NULL,'synthetic-request',NULL);
 IF reply->>'state'<>'succeeded' THEN RAISE EXCEPTION 'read receipt did not persist'; END IF;
 reply:=public.sandy_orch_finish(first_job,token,worker,dispatch_id,'failed',NULL,'different');
 IF reply->>'reused'<>'true' OR (SELECT result FROM public.sandy_orch_jobs WHERE id=first_job)<>'{"ok":true,"synthetic":true}'::jsonb THEN RAISE EXCEPTION 'receipt replay overwrote outcome'; END IF;
 reply:=public.sandy_orch_job(owner_id,first_job);
 IF reply->'job'->'latest_attempt'->>'provider_request_id'<>'synthetic-request' OR reply->'job'->'latest_attempt'->>'dispatch_id'<>dispatch_id::text
  OR reply->'job'->'latest_attempt'->>'outcome'<>'succeeded' OR position(token::text IN reply::text)>0 OR reply->'job'->'latest_attempt'->>'execution_admission_id' IS NOT NULL THEN RAISE EXCEPTION 'owned job attempt metadata missing or exposes lease'; END IF;
 reply:=public.sandy_orch_events_page(owner_id,first_job,0,1); cursor_id:=(reply->>'next_cursor')::bigint;
 IF jsonb_array_length(reply->'events')<>1 OR cursor_id IS NULL OR position(token::text IN reply::text)>0 THEN RAISE EXCEPTION 'event page invalid or leaked lease'; END IF;
 again:=public.sandy_orch_events_page(owner_id,first_job,cursor_id,200);
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(again->'events') WHERE (value->>'id')::bigint<=cursor_id) THEN RAISE EXCEPTION 'event cursor not exclusive'; END IF;
 reply:=public.sandy_orch_claim(worker,3,90); claim:=reply->'claims'->0; token:=(claim->>'lease_token')::uuid;
 IF jsonb_array_length(reply->'claims')<>1 OR claim->>'job_id'<>second_job::text THEN RAISE EXCEPTION 'dependency not unlocked by persisted success'; END IF;
 reply:=public.sandy_orch_cancel(owner_id,second_job); IF reply->>'state'<>'cancelled' OR reply->>'reused'<>'false' THEN RAISE EXCEPTION 'leased cancellation failed'; END IF;
 again:=public.sandy_orch_cancel(owner_id,second_job); IF again->>'reused'<>'true' THEN RAISE EXCEPTION 'cancellation not idempotent'; END IF;
 reply:=public.sandy_orch_resolve_dispatch(second_job,token,worker); IF reply->>'ok'<>'false' THEN RAISE EXCEPTION 'cancelled lease dispatched'; END IF;
 -- New retry fixture. Failed read attempts have bounded backoff and dead letters.
 steps:=jsonb_build_array(steps->0);
 reply:=public.sandy_orch_admit(owner_id,'api','operation','orchestration-test-retries',steps); first_job:=(reply->'jobs'->0->>'job_id')::uuid;
 FOR attempt_no IN 1..3 LOOP
  UPDATE public.sandy_orch_outbox SET available_at=clock_timestamp()-interval '1 second' WHERE job_id=first_job;
  reply:=public.sandy_orch_claim(worker,1,90); claim:=reply->'claims'->0; token:=(claim->>'lease_token')::uuid;
  reply:=public.sandy_orch_resolve_dispatch(first_job,token,worker); dispatch_id:=(reply->>'dispatch_id')::uuid;
  reply:=public.sandy_orch_finish(first_job,token,worker,dispatch_id,'retryable',NULL,'transient_provider_failure');
  IF reply->>'state'<>(CASE WHEN attempt_no=3 THEN 'dead_letter' ELSE 'queued' END) THEN RAISE EXCEPTION 'read retry budget incorrect'; END IF;
  IF attempt_no<3 AND NOT EXISTS(SELECT 1 FROM public.sandy_orch_outbox WHERE job_id=first_job AND available_at>clock_timestamp()) THEN RAISE EXCEPTION 'retry backoff absent'; END IF;
 END LOOP;
 reply:=public.sandy_orch_retry(owner_id,first_job); IF reply->>'error'<>'retry_not_safe_or_exhausted' THEN RAISE EXCEPTION 'exhausted retry admitted'; END IF;
 -- Registry drift must be observed at dispatch, not only at admission.
 reply:=public.sandy_orch_admit(owner_id,'api','operation','orchestration-test-drift',steps); first_job:=(reply->'jobs'->0->>'job_id')::uuid;
 reply:=public.sandy_orch_claim(worker,1,90); token:=(reply->'claims'->0->>'lease_token')::uuid;
 UPDATE public.sandy_operation_registry SET api_exposed=false WHERE operation='supabase.projects.get';
 reply:=public.sandy_orch_resolve_dispatch(first_job,token,worker); IF reply->>'error'<>'execution_authorization_or_contract_changed' THEN RAISE EXCEPTION 'contract drift dispatched'; END IF;
 UPDATE public.sandy_operation_registry SET api_exposed=true WHERE operation='supabase.projects.get';
 -- Expired leases recover only read operations and never fake known outcome.
 reply:=public.sandy_orch_admit(owner_id,'api','operation','orchestration-test-expiry',steps); first_job:=(reply->'jobs'->0->>'job_id')::uuid;
 reply:=public.sandy_orch_claim(worker,1,90); token:=(reply->'claims'->0->>'lease_token')::uuid;
 UPDATE public.sandy_orch_outbox SET lease_until=clock_timestamp()-interval '1 second' WHERE job_id=first_job;
 PERFORM public.sandy_orch_claim(worker,1,90);
 IF NOT EXISTS(SELECT 1 FROM public.sandy_orch_jobs WHERE id=first_job AND state='queued' AND error_code='lease_expired_outcome_unknown') THEN RAISE EXCEPTION 'expired read lease not recovered truthfully'; END IF;
 -- Legacy requests retain existing table/approval path but eliminate transport INSERTs.
 INSERT INTO public.sandy_cloud_targets(name,project_id,zone,protected,purpose) VALUES(fixture_target,'fixture-project','fixture-zone',true,'rollback only');
 reply:=public.sandy_api_request_legacy_deployment_job(owner_id,jsonb_build_object('provider','google_cloud','operation','stop_vm','target',fixture_target,'idempotency_key','orchestration-legacy-deny'));
 IF reply->>'error'<>'cloud_target_protected' THEN RAISE EXCEPTION 'protected target write admitted'; END IF;
 reply:=public.sandy_api_request_legacy_deployment_job(owner_id,jsonb_build_object('provider','github','operation','push_files','target','owner/repository','idempotency_key','orchestration-legacy-write'));
 IF reply->>'http_status'<>'422' THEN RAISE EXCEPTION 'engineering write bypass admitted'; END IF;
 reply:=public.sandy_api_request_legacy_deployment_job(owner_id,jsonb_build_object('provider','google_cloud','operation','get_vm','target',fixture_target,'payload','{}'::jsonb,'idempotency_key','orchestration-legacy-read'));
 legacy_job:=(reply->>'job_id')::uuid;
 IF reply->>'state'<>'pending_approval' OR reply->>'executed'<>'false' OR reply->>'dispatch_required'<>'false' OR legacy_job IS NULL THEN RAISE EXCEPTION 'legacy request falsely executed'; END IF;
 again:=public.sandy_api_request_legacy_deployment_job(owner_id,jsonb_build_object('provider','google_cloud','operation','get_vm','target',fixture_target,'idempotency_key','orchestration-legacy-read'));
 IF again->>'job_id'<>legacy_job::text OR again->>'reused'<>'true' OR (SELECT count(*) FROM public.sandy_deployment_events WHERE job_id=legacy_job)<>1 THEN RAISE EXCEPTION 'legacy replay not atomic/idempotent'; END IF;
 again:=public.sandy_api_request_legacy_deployment_job(other_owner,jsonb_build_object('provider','google_cloud','operation','get_vm','target',fixture_target,'idempotency_key','orchestration-legacy-read'));
 IF again->>'error'<>'idempotency_conflict' THEN RAISE EXCEPTION 'cross-principal idempotency adopted'; END IF;
 BEGIN UPDATE public.sandy_deployment_jobs SET payload='{"altered":true}' WHERE id=legacy_job; RAISE EXCEPTION 'legacy request scope mutable';
 EXCEPTION WHEN check_violation THEN IF SQLERRM<>'legacy_api_job_request_scope_is_immutable' THEN RAISE; END IF; END;
 BEGIN UPDATE public.sandy_cloud_targets SET zone='changed' WHERE name=fixture_target; RAISE EXCEPTION 'pending target scope mutable'; EXCEPTION WHEN foreign_key_violation THEN NULL; END;
 PERFORM public.sandy_api_cancel_deployment_job(legacy_job,owner_id);
 UPDATE public.sandy_cloud_targets SET zone='changed' WHERE name=fixture_target;
 -- Save private fixture identifiers only for a real service-role RPC invocation.
 PERFORM set_config('sandy.orch_test_owner',owner_id::text,true);
END $$;
SET LOCAL ROLE service_role;
DO $$ DECLARE reply jsonb; BEGIN
 reply:=public.sandy_orch_catalogue(current_setting('sandy.orch_test_owner')::uuid,'api');
 IF reply->>'ok'<>'true' THEN RAISE EXCEPTION 'actual service-role RPC invocation failed'; END IF;
END $$;
RESET ROLE;
SELECT jsonb_build_object('passed',true,'layer','administrative_database_rpc','provider_called',false,'controller_session_tested',false,'fixtures','rolled_back',
 'checks',ARRAY['scoped_acl','owner_only','immutable_snapshot','transactional_outbox','idempotency_conflict','dependency_gating','cycle_refusal','lease_token_refusal','single_dispatch_cas','receipt_recovery','heartbeat','nonexistent_admission_refusal','receipt_idempotency','owned_attempt_metadata','event_cursor','no_lease_disclosure','queued_and_leased_cancel','running_cancel_refusal','bounded_read_retry','backoff','dead_letter','contract_drift','lease_expiry','legacy_request_atomicity','legacy_target_pin','legacy_scope_immutability','engineering_write_bypass_refusal','actual_service_role_rpc']) AS evidence;
ROLLBACK;
