-- Administrative database component integration only. This is not an
-- authenticated Controller-session test and never invokes a worker or provider.
-- Run after the completion and retry migrations. Every fixture is rolled back.
BEGIN;
CREATE TEMP TABLE sandy_read_retry_test_fixture (unused boolean) ON COMMIT DROP;
CREATE FUNCTION pg_temp.sandy_failed_read(p_approver text, p_target text,
  p_operation text DEFAULT 'get_vm') RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE job_id uuid := gen_random_uuid();
BEGIN
  INSERT INTO public.sandy_deployment_jobs(id,requested_by,provider,operation,target,
    payload,idempotency_key,status,approved_by,approved_at)
  VALUES(job_id,'sandy-read-retry-rollback-test','google_cloud',p_operation,p_target,
    '{"fixture":true}'::jsonb,job_id::text,'approved',p_approver,now());
  UPDATE public.sandy_deployment_jobs SET status='failed',started_at=now(),finished_at=now(),
    error=CASE WHEN p_operation='get_logs' THEN 'google_logging_http_503:fixture'
      ELSE 'google_compute_http_503:fixture' END WHERE id=job_id;
  RETURN job_id;
END $$;
CREATE FUNCTION pg_temp.sandy_assert_retry_error(p_job uuid,p_actor uuid,p_error text)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE reply jsonb;
BEGIN
  reply := public.sandy_api_retry_read_deployment_job(p_job,p_actor);
  IF reply->>'ok' IS DISTINCT FROM 'false' OR reply->>'error' IS DISTINCT FROM p_error THEN
    RAISE EXCEPTION 'retry refusal assertion failed: expected %',p_error;
  END IF;
END $$;

DO $$
DECLARE
  owner_id uuid := gen_random_uuid();
  revoked_id uuid := gen_random_uuid();
  viewer_id uuid := gen_random_uuid();
  target_name text := 'sandy-retry-test-' || gen_random_uuid()::text;
  other_target text := 'sandy-retry-test-' || gen_random_uuid()::text;
  fixture_job_id uuid;
  source_id uuid;
  child_id uuid;
  next_id uuid;
  reply jsonb;
  original jsonb;
  altered jsonb;
  label text;
  depth integer;
BEGIN
  INSERT INTO public.sandy_controller_admins(auth_user_id,role,enabled)
    VALUES(owner_id,'owner',true),(revoked_id,'owner',true),(viewer_id,'viewer',true);
  INSERT INTO public.sandy_cloud_targets(name,project_id,zone,protected,purpose)
    VALUES(target_name,'fixture-project','fixture-zone',false,'rollback-only API test'),
      (other_target,'fixture-project','fixture-zone',false,'rollback-only API test');

  IF has_function_privilege('anon','public.sandy_api_retry_read_deployment_job(uuid,uuid)','EXECUTE')
    OR has_function_privilege('authenticated','public.sandy_api_retry_read_deployment_job(uuid,uuid)','EXECUTE')
    OR NOT has_function_privilege('service_role','public.sandy_api_retry_read_deployment_job(uuid,uuid)','EXECUTE') THEN
    RAISE EXCEPTION 'retry RPC role permissions incorrect';
  END IF;
  FOREACH label IN ARRAY ARRAY['sandy_api_capture_read_job_approval','sandy_api_maintain_read_retry_target_pin','sandy_api_guard_read_retry_job_scope'] LOOP
    IF has_function_privilege('anon','public.' || label || '()','EXECUTE')
      OR has_function_privilege('authenticated','public.' || label || '()','EXECUTE')
      OR has_function_privilege('service_role','public.' || label || '()','EXECUTE') THEN
      RAISE EXCEPTION 'trigger functions must not be exposed for direct invocation';
    END IF;
  END LOOP;
  IF NOT has_table_privilege('service_role','public.sandy_api_read_job_approval_snapshots','SELECT')
    OR has_table_privilege('service_role','public.sandy_api_read_job_approval_snapshots','INSERT')
    OR has_table_privilege('service_role','public.sandy_api_read_job_approval_snapshots','UPDATE')
    OR has_table_privilege('service_role','public.sandy_api_read_job_approval_snapshots','DELETE')
    OR NOT has_table_privilege('service_role','public.sandy_api_read_job_retries','SELECT')
    OR NOT has_table_privilege('service_role','public.sandy_api_read_job_retries','INSERT')
    OR has_table_privilege('service_role','public.sandy_api_read_job_retries','UPDATE')
    OR has_table_privilege('service_role','public.sandy_api_read_job_retries','DELETE')
    OR has_table_privilege('anon','public.sandy_api_read_job_retries','SELECT')
    OR has_table_privilege('authenticated','public.sandy_api_read_job_retries','SELECT')
    OR has_table_privilege('anon','public.sandy_api_read_job_approval_snapshots','SELECT')
    OR has_table_privilege('authenticated','public.sandy_api_read_job_approval_snapshots','SELECT')
    OR has_table_privilege('service_role','public.sandy_api_active_read_retry_targets','INSERT')
    OR has_table_privilege('service_role','public.sandy_api_active_read_retry_targets','UPDATE')
    OR has_table_privilege('service_role','public.sandy_api_active_read_retry_targets','DELETE') THEN
    RAISE EXCEPTION 'retry evidence table permissions incorrect';
  END IF;
  PERFORM pg_temp.sandy_assert_retry_error(gen_random_uuid(),owner_id,'job_not_found');
  fixture_job_id := pg_temp.sandy_failed_read(owner_id::text,target_name);
  PERFORM pg_temp.sandy_assert_retry_error(fixture_job_id,viewer_id,'owner_required');
  PERFORM pg_temp.sandy_assert_retry_error(fixture_job_id,gen_random_uuid(),'owner_required');
  FOREACH label IN ARRAY ARRAY['pending_approval','approved','running','succeeded','cancelled'] LOOP
    UPDATE public.sandy_deployment_jobs SET status=label WHERE id=fixture_job_id;
    PERFORM pg_temp.sandy_assert_retry_error(fixture_job_id,owner_id,'only_failed_jobs_can_retry');
  END LOOP;
  UPDATE public.sandy_deployment_jobs SET status='failed',provider='supabase',operation='read' WHERE id=fixture_job_id;
  PERFORM pg_temp.sandy_assert_retry_error(fixture_job_id,owner_id,'retry_operation_not_supported');
  UPDATE public.sandy_deployment_jobs SET provider='google_cloud',operation='stop_vm' WHERE id=fixture_job_id;
  PERFORM pg_temp.sandy_assert_retry_error(fixture_job_id,owner_id,'retry_operation_not_supported');

  fixture_job_id := pg_temp.sandy_failed_read(owner_id::text,target_name);
  UPDATE public.sandy_deployment_jobs SET result='{"provider_read_may_have_completed":true}' WHERE id=fixture_job_id;
  PERFORM pg_temp.sandy_assert_retry_error(fixture_job_id,owner_id,'retry_requires_outcome_reconciliation');
  UPDATE public.sandy_deployment_jobs SET result=NULL,started_at=NULL WHERE id=fixture_job_id;
  PERFORM pg_temp.sandy_assert_retry_error(fixture_job_id,owner_id,'retry_requires_outcome_reconciliation');
  UPDATE public.sandy_deployment_jobs SET started_at=now(),finished_at=NULL WHERE id=fixture_job_id;
  PERFORM pg_temp.sandy_assert_retry_error(fixture_job_id,owner_id,'retry_requires_outcome_reconciliation');
  UPDATE public.sandy_deployment_jobs SET finished_at=now(),error=NULL WHERE id=fixture_job_id;
  PERFORM pg_temp.sandy_assert_retry_error(fixture_job_id,owner_id,'retry_requires_outcome_reconciliation');
  FOREACH label IN ARRAY ARRAY['receipt_persistence_failed','google_compute_http_403:fixture',
    'google_compute_http_5030:fixture','prefix google_compute_http_503:fixture',
    'google_logging_http_503:wrong-provider','unknown_error'] LOOP
    UPDATE public.sandy_deployment_jobs SET error=label WHERE id=fixture_job_id;
    PERFORM pg_temp.sandy_assert_retry_error(fixture_job_id,owner_id,'failure_not_classified_retryable');
  END LOOP;

  fixture_job_id := pg_temp.sandy_failed_read(revoked_id::text,target_name);
  UPDATE public.sandy_controller_admins SET enabled=false WHERE auth_user_id=revoked_id;
  PERFORM pg_temp.sandy_assert_retry_error(fixture_job_id,owner_id,'original_approval_not_current');

  -- Legacy failed jobs are never assigned a retrospective snapshot.
  fixture_job_id := gen_random_uuid();
  INSERT INTO public.sandy_deployment_jobs(id,requested_by,provider,operation,target,idempotency_key,
    status,approved_by,approved_at,started_at,finished_at,error)
  VALUES(fixture_job_id,'sandy-read-retry-legacy-fixture','google_cloud','get_vm',target_name,fixture_job_id::text,
    'failed','sandy_read_policy_v2',now(),now(),now(),'google_compute_http_503:fixture');
  PERFORM pg_temp.sandy_assert_retry_error(fixture_job_id,owner_id,'approved_target_snapshot_missing');

  -- Simulate a historical approved fixture that predates snapshot capture.
  fixture_job_id := pg_temp.sandy_failed_read('sandy_read_policy_v2',target_name);
  UPDATE public.sandy_deployment_jobs SET status='approved' WHERE id=fixture_job_id;
  DELETE FROM public.sandy_api_read_job_approval_snapshots snapshot WHERE snapshot.job_id=fixture_job_id;
  UPDATE public.sandy_deployment_jobs SET status=status WHERE id=fixture_job_id;
  IF EXISTS (SELECT 1 FROM public.sandy_api_read_job_approval_snapshots snapshot WHERE snapshot.job_id=fixture_job_id) THEN
    RAISE EXCEPTION 'historical approval no-op was retroactively snapshotted';
  END IF;

  FOREACH label IN ARRAY ARRAY['payload','operation','target','requested_by','approved_by','approved_at'] LOOP
    fixture_job_id := pg_temp.sandy_failed_read(owner_id::text,target_name);
    CASE label
      WHEN 'payload' THEN UPDATE public.sandy_deployment_jobs SET payload='{"changed":true}' WHERE id=fixture_job_id;
      WHEN 'operation' THEN UPDATE public.sandy_deployment_jobs SET operation='list_vms' WHERE id=fixture_job_id;
      WHEN 'target' THEN UPDATE public.sandy_deployment_jobs SET target=other_target WHERE id=fixture_job_id;
      WHEN 'requested_by' THEN UPDATE public.sandy_deployment_jobs SET requested_by='changed-fixture' WHERE id=fixture_job_id;
      WHEN 'approved_by' THEN UPDATE public.sandy_deployment_jobs SET approved_by='sandy_read_policy_v2' WHERE id=fixture_job_id;
      WHEN 'approved_at' THEN UPDATE public.sandy_deployment_jobs SET approved_at=approved_at+interval '1 second' WHERE id=fixture_job_id;
    END CASE;
    -- Reentering approved must not overwrite an earlier approval snapshot.
    UPDATE public.sandy_deployment_jobs SET status='approved' WHERE id=fixture_job_id;
    UPDATE public.sandy_deployment_jobs SET status='failed' WHERE id=fixture_job_id;
    PERFORM pg_temp.sandy_assert_retry_error(fixture_job_id,owner_id,'approved_job_scope_changed');
  END LOOP;

  fixture_job_id := pg_temp.sandy_failed_read('sandy_read_policy_v2',other_target);
  UPDATE public.sandy_cloud_targets SET project_id='changed-project' WHERE name=other_target;
  PERFORM pg_temp.sandy_assert_retry_error(fixture_job_id,owner_id,'approved_target_scope_changed');
  DELETE FROM public.sandy_cloud_targets WHERE name=other_target;
  PERFORM pg_temp.sandy_assert_retry_error(fixture_job_id,owner_id,'registered_target_required');

  -- New standing-policy approvals are reachable through the existing approver;
  -- the original policy actor remains unchanged on child and lineage records.
  source_id := gen_random_uuid();
  INSERT INTO public.sandy_deployment_jobs(id,requested_by,provider,operation,target,idempotency_key,status)
    VALUES(source_id,'sandy-read-retry-policy-fixture','google_cloud','get_vm',target_name,source_id::text,'pending_approval');
  IF public.sandy_approve_cloud_diagnostic_job(source_id) IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'existing policy approval prerequisite failed';
  END IF;
  UPDATE public.sandy_deployment_jobs SET status='failed',started_at=now(),finished_at=now(),
    error='google_compute_http_429:fixture' WHERE id=source_id;
  SELECT to_jsonb(job) INTO original FROM public.sandy_deployment_jobs job WHERE id=source_id;
  reply := public.sandy_api_retry_read_deployment_job(source_id,owner_id);
  child_id := (reply->>'retry_job_id')::uuid;
  IF reply->>'accepted' IS DISTINCT FROM 'true' OR reply->>'executed' IS DISTINCT FROM 'false'
    OR reply->>'request_state' IS DISTINCT FROM 'recorded' OR reply->>'reused' IS DISTINCT FROM 'false'
    OR reply->>'dispatch_required' IS DISTINCT FROM 'true' OR reply->>'retry_depth' IS DISTINCT FROM '1'
    OR child_id IS NULL OR child_id=source_id THEN
    RAISE EXCEPTION 'policy retry admission did not report an unexecuted durable child';
  END IF;
  SELECT to_jsonb(job) INTO altered FROM public.sandy_deployment_jobs job WHERE id=source_id;
  IF original IS DISTINCT FROM altered THEN RAISE EXCEPTION 'failed source evidence mutated'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.sandy_deployment_jobs WHERE id=child_id AND status='approved'
    AND approved_by='sandy_read_policy_v2' AND result IS NULL AND error IS NULL
    AND started_at IS NULL AND finished_at IS NULL
    AND payload=original->'payload' AND approved_at=(original->>'approved_at')::timestamptz)
    OR NOT EXISTS (SELECT 1 FROM public.sandy_api_read_job_retries WHERE parent_job_id=source_id
      AND retry_job_id=child_id AND root_job_id=source_id AND requested_by=owner_id
      AND original_approved_by='sandy_read_policy_v2' AND target_project_id='fixture-project') THEN
    RAISE EXCEPTION 'retry did not preserve original approval and pinned scope';
  END IF;
  reply := public.sandy_api_retry_read_deployment_job(source_id,owner_id);
  IF reply->>'retry_job_id' IS DISTINCT FROM child_id::text OR reply->>'reused' IS DISTINCT FROM 'true'
    OR (SELECT count(*) FROM public.sandy_deployment_events WHERE job_id=child_id AND event_type='read_retry_recorded') <> 1
    OR (SELECT count(*) FROM public.sandy_api_read_job_retries WHERE parent_job_id=source_id) <> 1 THEN
    RAISE EXCEPTION 'duplicate retry created another child or audit event';
  END IF;
  BEGIN
    UPDATE public.sandy_cloud_targets SET zone='changed-zone' WHERE name=target_name;
    RAISE EXCEPTION 'active retry target update was accepted';
  EXCEPTION WHEN foreign_key_violation THEN
    NULL;
  END;
  BEGIN
    DELETE FROM public.sandy_cloud_targets WHERE name=target_name;
    RAISE EXCEPTION 'active retry target delete was accepted';
  EXCEPTION WHEN foreign_key_violation THEN
    NULL;
  END;

  BEGIN
    UPDATE public.sandy_deployment_jobs SET payload='{"retargeted":true}' WHERE id=child_id;
    RAISE EXCEPTION 'retry child payload edit was accepted';
  EXCEPTION WHEN check_violation THEN
    IF SQLERRM <> 'retry_child_approved_scope_is_immutable' THEN RAISE; END IF;
  END;
  UPDATE public.sandy_deployment_jobs SET status='running',started_at=now() WHERE id=child_id;
  BEGIN
    UPDATE public.sandy_deployment_jobs SET target='different-target' WHERE id=child_id;
    RAISE EXCEPTION 'retry child target edit was accepted';
  EXCEPTION WHEN check_violation THEN
    IF SQLERRM <> 'retry_child_approved_scope_is_immutable' THEN RAISE; END IF;
  END;

  -- A replay after another authorized executor advanced the job is still only
  -- a receipt. Retry never claims, completes, or rewinds the child.
  UPDATE public.sandy_deployment_jobs SET status='running',started_at=now() WHERE id=child_id;
  reply := public.sandy_api_retry_read_deployment_job(source_id,owner_id);
  IF reply->>'retry_job_status' IS DISTINCT FROM 'running' OR reply->>'executed' IS DISTINCT FROM 'false'
    OR reply->>'dispatch_required' IS DISTINCT FROM 'false' THEN RAISE EXCEPTION 'replay execution claim incorrect'; END IF;
  UPDATE public.sandy_deployment_jobs SET status='failed',error='google_compute_http_503:fixture',finished_at=now() WHERE id=child_id;
  FOR depth IN 2..3 LOOP
    reply := public.sandy_api_retry_read_deployment_job(child_id,owner_id);
    next_id := (reply->>'retry_job_id')::uuid;
    IF reply->>'retry_depth' IS DISTINCT FROM depth::text OR next_id IS NULL
      OR NOT EXISTS (SELECT 1 FROM public.sandy_api_read_job_retries WHERE retry_job_id=next_id AND root_job_id=source_id) THEN
      RAISE EXCEPTION 'bounded child retry chain failed';
    END IF;
    child_id := next_id;
    UPDATE public.sandy_deployment_jobs SET status='failed',started_at=now(),finished_at=now(),
      error='google_compute_http_503:fixture' WHERE id=child_id;
  END LOOP;
  PERFORM pg_temp.sandy_assert_retry_error(child_id,owner_id,'retry_limit_reached');
  UPDATE public.sandy_cloud_targets SET project_id='temporary-terminal-project' WHERE name=target_name;
  UPDATE public.sandy_cloud_targets SET project_id='fixture-project' WHERE name=target_name;

  -- Every supported read family accepts only its own classified provider error.
  FOREACH label IN ARRAY ARRAY['get_vm','list_vms','get_logs'] LOOP
    fixture_job_id := gen_random_uuid();
    INSERT INTO public.sandy_deployment_jobs(id,requested_by,provider,operation,target,idempotency_key,status)
      VALUES(fixture_job_id,'sandy-read-retry-policy-family','google_cloud',label,target_name,fixture_job_id::text,'pending_approval');
    IF public.sandy_approve_cloud_diagnostic_job(fixture_job_id) IS DISTINCT FROM true THEN
      RAISE EXCEPTION 'read-family policy approval failed';
    END IF;
    UPDATE public.sandy_deployment_jobs SET status='failed',started_at=now(),finished_at=now(),
      error=CASE WHEN label='get_logs' THEN 'google_logging_http_503:fixture' ELSE 'google_compute_http_503:fixture' END
      WHERE id=fixture_job_id;
    reply := public.sandy_api_retry_read_deployment_job(fixture_job_id,owner_id);
    IF reply->>'accepted' IS DISTINCT FROM 'true' OR reply->>'executed' IS DISTINCT FROM 'false' THEN
      RAISE EXCEPTION 'supported read retry rejected: %',label;
    END IF;
  END LOOP;

  -- A colliding deterministic key is not adopted as if it were this retry.
  fixture_job_id := pg_temp.sandy_failed_read(owner_id::text,target_name);
  INSERT INTO public.sandy_deployment_jobs(requested_by,provider,operation,target,idempotency_key,status)
    VALUES('sandy-read-retry-collision-fixture','google_cloud','get_vm',target_name,
      'sandy-api:read-retry:' || fixture_job_id::text,'pending_approval');
  PERFORM pg_temp.sandy_assert_retry_error(fixture_job_id,owner_id,'retry_idempotency_collision');
  IF EXISTS (SELECT 1 FROM public.sandy_api_read_job_retries WHERE parent_job_id=fixture_job_id) THEN
    RAISE EXCEPTION 'idempotency collision left partial retry evidence';
  END IF;

  -- These values stay only in this transaction, for the actual service-role call.
  PERFORM set_config('sandy.retry_test_owner',owner_id::text,true);
  PERFORM set_config('sandy.retry_test_job',pg_temp.sandy_failed_read('sandy_read_policy_v2',target_name)::text,true);
END $$;
SET LOCAL ROLE service_role;
DO $$
DECLARE reply jsonb;
BEGIN
  reply := public.sandy_api_retry_read_deployment_job(
    current_setting('sandy.retry_test_job')::uuid,current_setting('sandy.retry_test_owner')::uuid);
  IF reply->>'accepted' IS DISTINCT FROM 'true' OR reply->>'executed' IS DISTINCT FROM 'false' THEN
    RAISE EXCEPTION 'service-role retry invocation failed';
  END IF;
END $$;
RESET ROLE;
SELECT jsonb_build_object('passed',true,'layer','administrative_database_rpc',
  'checks',ARRAY['owner_only','customer_rpc_denied','minimal_table_privileges','trigger_only_functions',
    'source_states_refused','writes_refused','ambiguous_outcomes_refused','transient_error_classification',
    'revoked_approver_refused','legacy_approval_not_backfilled','historical_status_noop_not_backfilled','approval_snapshot_immutable',
    'payload_operation_actor_timestamp_target_tamper_refused','target_drift_refused',
    'standing_policy_approval_path','source_evidence_preserved','single_child_and_audit',
    'active_target_scope_pinned','retry_child_scope_immutable','terminal_target_scope_released','replay_current_status_truthful','bounded_chain',
    'three_read_families','idempotency_collision','service_role_invocation'],
  'fixtures','rolled_back','provider_execution_tested',false,'controller_session_tested',false,
  'dispatch','required_separately') AS evidence;
ROLLBACK;
