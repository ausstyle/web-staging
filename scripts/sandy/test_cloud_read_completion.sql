-- Real database integration for the deployed GCP worker completion RPC.
-- Run as an administrator after 20261020202000; customer/provider calls are absent.
-- Every job/event fixture is synthetic, uncommitted and rolled back.
BEGIN;

DO $$
BEGIN
  IF has_function_privilege('anon','public.sandy_finish_cloud_read_job(uuid,jsonb)','EXECUTE')
     OR has_function_privilege('authenticated','public.sandy_finish_cloud_read_job(uuid,jsonb)','EXECUTE')
     OR NOT has_function_privilege('service_role','public.sandy_finish_cloud_read_job(uuid,jsonb)','EXECUTE') THEN
    RAISE EXCEPTION 'cloud completion RPC must remain worker-only';
  END IF;
END $$;

SET LOCAL ROLE anon;
DO $$
BEGIN
  BEGIN
    PERFORM public.sandy_finish_cloud_read_job('00000000-0000-0000-0000-000000000000'::uuid,'{}'::jsonb);
    RAISE EXCEPTION 'anonymous execution unexpectedly allowed';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END $$;

RESET ROLE;
SET LOCAL ROLE authenticated;
DO $$
BEGIN
  BEGIN
    PERFORM public.sandy_finish_cloud_read_job('00000000-0000-0000-0000-000000000000'::uuid,'{}'::jsonb);
    RAISE EXCEPTION 'authenticated customer execution unexpectedly allowed';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END $$;

RESET ROLE;
SET LOCAL ROLE service_role;
DO $$
DECLARE
  fixture_id uuid;
  op text;
  job_state text;
  expected_result jsonb;
  before_row jsonb;
  actual_reply boolean;
  event_count integer;
BEGIN
  actual_reply := public.sandy_finish_cloud_read_job(gen_random_uuid(),'{}'::jsonb);
  IF actual_reply IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'missing job unexpectedly completed';
  END IF;

  FOREACH op IN ARRAY ARRAY['get_logs','get_vm','list_vms'] LOOP
    fixture_id := gen_random_uuid();
    expected_result := CASE op
      WHEN 'get_logs' THEN '{"source":"google_cloud_logging","period_hours":24,"entries":[{"timestamp":"2026-01-01T00:00:00Z","severity":"INFO","logName":"synthetic-completion-test","message":"synthetic entry"}],"notice":"Cloud Logging only; does not prove Asterisk service health or OS resource usage"}'::jsonb
      WHEN 'get_vm' THEN '{"name":"synthetic-completion-test","status":"RUNNING"}'::jsonb
      ELSE '{"items":[]}'::jsonb END;
    INSERT INTO public.sandy_deployment_jobs
      (id,requested_by,provider,operation,target,idempotency_key,status,approved_by,approved_at,started_at)
      VALUES(fixture_id,'sandy-cloud-read-completion-isolated-test','google_cloud',op,
        'no-provider-target',fixture_id::text,'running','synthetic-test',now(),now());
    actual_reply := public.sandy_finish_cloud_read_job(fixture_id,expected_result);
    IF actual_reply IS DISTINCT FROM true THEN
      RAISE EXCEPTION 'running supported read did not complete: %',op;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.sandy_deployment_jobs WHERE id=fixture_id
      AND status='succeeded' AND result=expected_result AND finished_at IS NOT NULL) THEN
      RAISE EXCEPTION 'completion result not persisted: %',op;
    END IF;
    SELECT count(*) INTO event_count FROM public.sandy_deployment_events WHERE job_id=fixture_id;
    IF event_count <> 1 OR NOT EXISTS (SELECT 1 FROM public.sandy_deployment_events
      WHERE job_id=fixture_id AND event_type='completed' AND actor='sandy_gcp_worker'
        AND details='{"verified_persist":true}'::jsonb) THEN
      RAISE EXCEPTION 'completion audit event incorrect: %',op;
    END IF;
    SELECT to_jsonb(j) INTO before_row FROM public.sandy_deployment_jobs j WHERE id=fixture_id;
    actual_reply := public.sandy_finish_cloud_read_job(fixture_id,'{"replacement":true}'::jsonb);
    SELECT count(*) INTO event_count FROM public.sandy_deployment_events WHERE job_id=fixture_id;
    IF actual_reply IS DISTINCT FROM false OR event_count <> 1 OR
       (SELECT to_jsonb(j) FROM public.sandy_deployment_jobs j WHERE id=fixture_id) IS DISTINCT FROM before_row THEN
      RAISE EXCEPTION 'repeat completion changed first result or audit: %',op;
    END IF;
  END LOOP;

  FOREACH op IN ARRAY ARRAY['create_vm','start_vm','stop_vm','restart_vm','delete_vm','execute_command','unknown_read'] LOOP
    fixture_id := gen_random_uuid();
    INSERT INTO public.sandy_deployment_jobs
      (id,requested_by,provider,operation,target,idempotency_key,status,approved_by,approved_at,started_at)
      VALUES(fixture_id,'sandy-cloud-read-completion-isolated-test','google_cloud',op,
        'no-provider-target',fixture_id::text,'running','synthetic-test',now(),now());
    SELECT to_jsonb(j) INTO before_row FROM public.sandy_deployment_jobs j WHERE id=fixture_id;
    actual_reply := public.sandy_finish_cloud_read_job(fixture_id,'{"unexpected":true}'::jsonb);
    IF actual_reply IS DISTINCT FROM false OR
       (SELECT to_jsonb(j) FROM public.sandy_deployment_jobs j WHERE id=fixture_id) IS DISTINCT FROM before_row OR
       EXISTS (SELECT 1 FROM public.sandy_deployment_events WHERE job_id=fixture_id) THEN
      RAISE EXCEPTION 'write or unsupported job incorrectly completed: %',op;
    END IF;
  END LOOP;

  FOREACH job_state IN ARRAY ARRAY['pending_approval','approved','failed','cancelled','succeeded'] LOOP
    fixture_id := gen_random_uuid();
    INSERT INTO public.sandy_deployment_jobs
      (id,requested_by,provider,operation,target,idempotency_key,status,approved_by,approved_at)
      VALUES(fixture_id,'sandy-cloud-read-completion-isolated-test','google_cloud','get_logs',
        'no-provider-target',fixture_id::text,job_state,'synthetic-test',now());
    SELECT to_jsonb(j) INTO before_row FROM public.sandy_deployment_jobs j WHERE id=fixture_id;
    actual_reply := public.sandy_finish_cloud_read_job(fixture_id,'{"unexpected":true}'::jsonb);
    IF actual_reply IS DISTINCT FROM false OR
       (SELECT to_jsonb(j) FROM public.sandy_deployment_jobs j WHERE id=fixture_id) IS DISTINCT FROM before_row OR
       EXISTS (SELECT 1 FROM public.sandy_deployment_events WHERE job_id=fixture_id) THEN
      RAISE EXCEPTION 'non-running read incorrectly completed: %',job_state;
    END IF;
  END LOOP;
END $$;

SELECT jsonb_build_object('passed',true,'layer','service_role_database_rpc',
  'checks',ARRAY['anon_denied','authenticated_denied','service_role_allowed',
    'get_logs_completion','get_vm_preserved','list_vms_preserved','single_completion_event',
    'duplicate_returns_false_without_changes','write_jobs_refused','unsupported_jobs_refused',
    'non_running_states_refused','missing_job_refused'],
  'fixtures','rolled_back','provider_called',false,'controller_session_tested',false) AS evidence;
ROLLBACK;
