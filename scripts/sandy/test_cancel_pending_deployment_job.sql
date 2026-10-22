-- Administrative database integration only, not a Controller-session test.
-- All fixture rows are uncommitted and rolled back. No provider work is requested.
BEGIN;
SET LOCAL ROLE service_role;
DO $$
DECLARE owner_id uuid; fixture_job_id uuid := gen_random_uuid(); reply jsonb; event_count integer;
BEGIN
  SELECT auth_user_id INTO owner_id FROM public.sandy_controller_admins
    WHERE role = 'owner' AND enabled = true LIMIT 1;
  IF owner_id IS NULL THEN RAISE EXCEPTION 'test prerequisite: enabled owner'; END IF;
  IF has_function_privilege('anon','public.sandy_api_cancel_deployment_job(uuid,uuid)','EXECUTE')
     OR has_function_privilege('authenticated','public.sandy_api_cancel_deployment_job(uuid,uuid)','EXECUTE') THEN
    RAISE EXCEPTION 'cancellation RPC must not be callable directly by customer roles';
  END IF;
  INSERT INTO public.sandy_deployment_jobs(id,requested_by,provider,operation,target,idempotency_key,status)
    VALUES(fixture_job_id,'sandy-api-cancellation-isolated-test','supabase','read','no-provider-target',fixture_job_id::text,'pending_approval');
  reply := public.sandy_api_cancel_deployment_job(fixture_job_id,gen_random_uuid());
  IF reply->>'error' IS DISTINCT FROM 'owner_required' THEN RAISE EXCEPTION 'non-owner cancellation accepted'; END IF;
  reply := public.sandy_api_cancel_deployment_job(gen_random_uuid(),owner_id);
  IF reply->>'error' IS DISTINCT FROM 'job_not_found' THEN RAISE EXCEPTION 'missing job reported as cancelled'; END IF;
  reply := public.sandy_api_cancel_deployment_job(fixture_job_id,owner_id);
  IF reply->>'state' IS DISTINCT FROM 'cancelled' OR reply->>'already_cancelled' IS DISTINCT FROM 'false' THEN
    RAISE EXCEPTION 'pending job cancellation failed';
  END IF;
  IF (SELECT status FROM public.sandy_deployment_jobs WHERE id=fixture_job_id) IS DISTINCT FROM 'cancelled' THEN
    RAISE EXCEPTION 'cancellation not persisted within transaction';
  END IF;
  reply := public.sandy_api_cancel_deployment_job(fixture_job_id,owner_id);
  SELECT count(*) INTO event_count FROM public.sandy_deployment_events WHERE job_id=fixture_job_id;
  IF reply->>'already_cancelled' IS DISTINCT FROM 'true' OR event_count <> 1 THEN
    RAISE EXCEPTION 'cancellation retry was not idempotent';
  END IF;
  UPDATE public.sandy_deployment_jobs SET status='running',approved_by='synthetic-test',approved_at=now() WHERE id=fixture_job_id;
  reply := public.sandy_api_cancel_deployment_job(fixture_job_id,owner_id);
  IF reply->>'error' IS DISTINCT FROM 'job_not_cancellable' OR
     (SELECT status FROM public.sandy_deployment_jobs WHERE id=fixture_job_id) IS DISTINCT FROM 'running' THEN
    RAISE EXCEPTION 'running provider job was incorrectly cancelled';
  END IF;
END $$;
SELECT jsonb_build_object('passed',true,'layer','service_role_database_rpc',
  'checks',ARRAY['owner_only','customer_rpc_denied','missing_job','pending_cancel','idempotency','single_audit_event','running_refused'],
  'fixtures','rolled_back','controller_session_tested',false) AS evidence;
ROLLBACK;
