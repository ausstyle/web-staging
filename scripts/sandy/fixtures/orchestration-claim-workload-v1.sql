CREATE OR REPLACE FUNCTION public.sandy_orch_claim(p_worker_id uuid, p_limit integer DEFAULT 1, p_lease_seconds integer DEFAULT 30)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
DECLARE record_row record; claimed jsonb:='[]'; token uuid; until_time timestamptz;
BEGIN
 IF p_worker_id IS NULL OR p_limit IS NULL OR p_lease_seconds IS NULL OR p_limit NOT BETWEEN 1 AND 20 OR p_lease_seconds NOT BETWEEN 5 AND 300 THEN RETURN jsonb_build_object('ok',false,'error','invalid_worker_claim','http_status',400); END IF;
 -- Lease expiry never turns an uncertain mutation into an automatic retry.
 FOR record_row IN SELECT j.id,j.is_mutation,j.attempts,j.max_attempts,j.state FROM public.sandy_orch_jobs j JOIN public.sandy_orch_outbox o ON o.job_id=j.id
  WHERE j.state IN ('leased','running') AND o.lease_until<clock_timestamp() ORDER BY o.lease_until FOR UPDATE OF j,o SKIP LOCKED LIMIT 100 LOOP
  UPDATE public.sandy_orch_jobs SET state=CASE WHEN record_row.is_mutation THEN 'needs_reconciliation' WHEN attempts>=max_attempts THEN 'dead_letter' ELSE 'queued' END,
   error_code='lease_expired_outcome_unknown',updated_at=now(),finished_at=CASE WHEN record_row.is_mutation OR attempts>=max_attempts THEN now() ELSE NULL END WHERE id=record_row.id;
  UPDATE public.sandy_orch_outbox SET worker_id=NULL,lease_token=NULL,lease_until=NULL,available_at=clock_timestamp()+make_interval(secs=>least(300,power(2,record_row.attempts)::integer)+random()) WHERE job_id=record_row.id;
  UPDATE public.sandy_orch_attempts SET finished_at=coalesce(finished_at,now()),outcome=coalesce(outcome,'lease_expired_outcome_unknown') WHERE job_id=record_row.id AND attempt=record_row.attempts;
  INSERT INTO public.sandy_orch_events(job_id,event_type,details) VALUES(record_row.id,'lease_expired',jsonb_build_object('previous_state',record_row.state,'outcome_known',false,'safe_to_retry',NOT record_row.is_mutation));
 END LOOP;
 -- Failed/cancelled prerequisites block descendants rather than being skipped.
 FOR record_row IN WITH RECURSIVE blocked_jobs(id) AS (
  SELECT id FROM public.sandy_orch_jobs WHERE state IN ('failed','cancelled','blocked','dead_letter','needs_reconciliation')
  UNION SELECT e.job_id FROM public.sandy_orch_dependencies e JOIN blocked_jobs b ON b.id=e.depends_on
 ) UPDATE public.sandy_orch_jobs j SET state='blocked',error_code='dependency_not_succeeded',finished_at=now(),updated_at=now()
 WHERE j.state='queued' AND j.id IN (SELECT id FROM blocked_jobs) RETURNING j.id LOOP
  INSERT INTO public.sandy_orch_events(job_id,event_type) VALUES(record_row.id,'dependency_blocked');
 END LOOP;
 FOR record_row IN SELECT j.id,j.actor_id FROM public.sandy_orch_jobs j JOIN public.sandy_orch_outbox o ON o.job_id=j.id
  WHERE j.state='queued' AND o.available_at<=clock_timestamp()
  AND NOT EXISTS(SELECT 1 FROM public.sandy_orch_dependencies e JOIN public.sandy_orch_jobs p ON p.id=e.depends_on WHERE e.job_id=j.id AND p.state<>'succeeded')
  ORDER BY o.available_at,j.created_at,j.id FOR UPDATE OF j,o SKIP LOCKED LIMIT p_limit LOOP
  IF NOT public.sandy_orch_workload_job_current(record_row.id) THEN
   UPDATE public.sandy_orch_jobs SET state='blocked',error_code='owner_authorization_revoked',finished_at=now(),updated_at=now() WHERE id=record_row.id;
   INSERT INTO public.sandy_orch_events(job_id,event_type) VALUES(record_row.id,'authorization_revoked');
   CONTINUE;
  END IF;
  token:=gen_random_uuid();until_time:=clock_timestamp()+make_interval(secs=>p_lease_seconds);
  UPDATE public.sandy_orch_outbox SET worker_id=p_worker_id,lease_token=token,lease_until=until_time WHERE job_id=record_row.id;
  UPDATE public.sandy_orch_jobs SET state='leased',attempts=attempts+1,updated_at=now() WHERE id=record_row.id;
  INSERT INTO public.sandy_orch_events(job_id,event_type,details) VALUES(record_row.id,'leased',jsonb_build_object('worker_id',p_worker_id,'lease_until',until_time,'provider_execution_started',false));
  claimed:=claimed||jsonb_build_array(jsonb_build_object('job_id',record_row.id,'lease_token',token,'worker_id',p_worker_id,'lease_until',until_time,'principal_kind',(SELECT principal_kind FROM public.sandy_orch_jobs WHERE id=record_row.id)));
 END LOOP;
 RETURN jsonb_build_object('ok',true,'claims',claimed);
END $function$
;
