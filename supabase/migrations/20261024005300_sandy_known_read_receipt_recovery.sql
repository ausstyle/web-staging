-- Recognise an already observed provider read before expired-lease replay.
-- Missing durable output remains needs_reconciliation, never fabricated success.
BEGIN;
SET LOCAL lock_timeout='2s'; SET LOCAL statement_timeout='15s';
CREATE FUNCTION public.sandy_orch_known_expired_workload_read(p_job_id uuid) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
 SELECT jsonb_build_object('admission_id',a.id,'dispatch_id',t.dispatch_id,
  'provider_http_status',a.provider_http_status,'provider_result_sha256',a.result_sha256)
 FROM public.sandy_orch_jobs j JOIN public.sandy_orch_attempts t ON t.job_id=j.id AND t.attempt=j.attempts
 JOIN public.sandy_api_execution_admissions a ON a.request_id=t.dispatch_id
 WHERE j.id=p_job_id AND j.principal_kind='engineering_workload' AND NOT j.is_mutation AND j.state='running'
 AND t.finished_at IS NULL AND t.outcome IS NULL AND a.state='succeeded'
 AND a.provider_http_status BETWEEN 200 AND 299 AND a.result_sha256 ~ '^[a-f0-9]{64}$'
 AND public.sandy_orch_workload_receipt_matches(j.id,a.id,t.dispatch_id)
 ORDER BY a.id LIMIT 1
$$;
REVOKE ALL ON FUNCTION public.sandy_orch_known_expired_workload_read(uuid) FROM PUBLIC,anon,authenticated,service_role;
DO $claim_guard$
DECLARE definition text;old text;replacement text;
BEGIN
 IF (SELECT encode(sha256(convert_to(prosrc,'UTF8')),'hex') FROM pg_proc WHERE oid='public.sandy_orch_claim(uuid,integer,integer)'::regprocedure)
 IS DISTINCT FROM 'a035a008fce93bfcb3876a7f4adc202e7a8863d0429b5ca4515c12d8bd361910' THEN
  RAISE EXCEPTION 'exact_workload_claim_preimage_required';
 END IF;
 SELECT pg_get_functiondef('public.sandy_orch_claim(uuid,integer,integer)'::regprocedure) INTO definition;
 old:=$declare$until_time timestamptz;$declare$;
 IF (length(definition)-length(replace(definition,old,'')))/length(old)<>1 THEN RAISE EXCEPTION 'claim_declaration_anchor_changed';END IF;
 definition:=replace(definition,old,'until_time timestamptz; known_receipt jsonb;');
 old:=$old$FOR UPDATE OF j,o SKIP LOCKED LIMIT 100 LOOP
  UPDATE public.sandy_orch_jobs$old$;
 replacement:=$replacement$FOR UPDATE OF j,o SKIP LOCKED LIMIT 100 LOOP
  known_receipt:=public.sandy_orch_known_expired_workload_read(record_row.id);
  IF known_receipt IS NOT NULL THEN
   UPDATE public.sandy_orch_jobs SET state='needs_reconciliation',error_code='known_provider_read_result_requires_reconciliation',updated_at=now(),finished_at=now() WHERE id=record_row.id;
   UPDATE public.sandy_orch_outbox SET worker_id=NULL,lease_token=NULL,lease_until=NULL WHERE job_id=record_row.id;
   UPDATE public.sandy_orch_attempts SET finished_at=now(),outcome='unknown',execution_admission_id=(known_receipt->>'admission_id')::uuid
    WHERE job_id=record_row.id AND attempt=record_row.attempts AND finished_at IS NULL;
   INSERT INTO public.sandy_orch_events(job_id,event_type,details) VALUES(record_row.id,'expired_read_canonical_receipt_observed',
    known_receipt||jsonb_build_object('safe_to_retry',false,'durable_result_available',false,'provider_execution_claimed_by_this_recovery',false));
   CONTINUE;
  END IF;
  UPDATE public.sandy_orch_jobs$replacement$;
 IF (length(definition)-length(replace(definition,old,'')))/length(old)<>1 THEN RAISE EXCEPTION 'expired_claim_anchor_changed';END IF;
 EXECUTE replace(definition,old,replacement);
END $claim_guard$;
NOTIFY pgrst,'reload schema';
COMMIT;
