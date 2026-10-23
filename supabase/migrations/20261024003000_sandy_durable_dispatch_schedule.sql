-- Activate the existing fenced read dispatcher; this is not a second queue or
-- permission grant. Credentials stay encrypted in Vault, never in cron.command.
BEGIN;
CREATE TABLE public.sandy_orch_worker_control (
 singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton),
 enabled boolean NOT NULL DEFAULT false,
 transport_secret_id uuid,
 release_change_id uuid REFERENCES public.sandy_engineering_changes(id),
 source_commit text CHECK(source_commit IS NULL OR source_commit ~ '^[a-f0-9]{40}$'),
 last_request_id bigint,
 last_requested_at timestamptz,
 updated_at timestamptz NOT NULL DEFAULT now(),
 CHECK(NOT enabled OR (transport_secret_id IS NOT NULL AND release_change_id IS NOT NULL AND source_commit IS NOT NULL))
);
INSERT INTO public.sandy_orch_worker_control(singleton) VALUES(true);
ALTER TABLE public.sandy_orch_worker_control ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.sandy_orch_worker_control FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.sandy_orch_worker_bind_transport(p_secret text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE secret_id uuid;
BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' OR p_secret IS NULL OR length(p_secret) NOT BETWEEN 100 AND 8192 THEN
  RAISE EXCEPTION 'private_worker_transport_binding_required' USING ERRCODE='42501';
 END IF;
 SELECT transport_secret_id INTO secret_id FROM public.sandy_orch_worker_control WHERE singleton FOR UPDATE;
 IF secret_id IS NULL THEN
  SELECT vault.create_secret(p_secret,'sandy-orchestration-worker/service-transport','Private existing Sandy API worker transport; never customer or Owner authority') INTO secret_id;
 ELSE
  PERFORM vault.update_secret(secret_id,p_secret);
 END IF;
 UPDATE public.sandy_orch_worker_control SET transport_secret_id=secret_id,updated_at=clock_timestamp() WHERE singleton;
 RETURN jsonb_build_object('ok',true,'bound',true,'authority_expanded',false);
END $$;
REVOKE ALL ON FUNCTION public.sandy_orch_worker_bind_transport(text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.sandy_orch_worker_bind_transport(text) TO service_role;

CREATE FUNCTION public.sandy_orch_worker_tick() RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE control public.sandy_orch_worker_control%ROWTYPE; transport text; request_id bigint;
BEGIN
 IF NOT pg_try_advisory_xact_lock(hashtextextended('sandy-orch-private-dispatch-tick-v1',0)) THEN
  RETURN jsonb_build_object('ok',true,'state','tick_already_running','provider_executed',false);
 END IF;
 SELECT * INTO control FROM public.sandy_orch_worker_control WHERE singleton FOR UPDATE;
 IF control.enabled IS DISTINCT FROM true THEN RETURN jsonb_build_object('ok',true,'state','disabled','provider_executed',false); END IF;
 -- Only the existing queue may wake the existing executor. Dependencies, live
 -- authority, contract drift, retry budget and dispatch fences remain its job.
 IF NOT EXISTS(SELECT 1 FROM public.sandy_orch_jobs j JOIN public.sandy_orch_outbox o ON o.job_id=j.id
   WHERE (j.state='queued' AND o.available_at<=clock_timestamp()) OR
         (j.state IN('leased','running') AND o.lease_until<clock_timestamp())) THEN
  RETURN jsonb_build_object('ok',true,'state','idle','provider_executed',false);
 END IF;
 IF control.last_requested_at>clock_timestamp()-interval '45 seconds' THEN
  RETURN jsonb_build_object('ok',true,'state','rate_limited','provider_executed',false);
 END IF;
 SELECT decrypted_secret INTO transport FROM vault.decrypted_secrets WHERE id=control.transport_secret_id;
 IF transport IS NULL OR length(transport) NOT BETWEEN 100 AND 8192 THEN
  RAISE EXCEPTION 'private_worker_transport_unavailable' USING ERRCODE='55000';
 END IF;
 SELECT net.http_post(
  url:='https://zmqlyygzqoidkcwdysok.supabase.co/functions/v1/sandy-orchestration-api',
  headers:=jsonb_build_object('authorization','Bearer '||transport,'apikey',transport,'content-type','application/json'),
  body:='{"action":"worker_run","arguments":{"limit":1,"lease_seconds":90}}'::jsonb,
  timeout_milliseconds:=30000) INTO request_id;
 UPDATE public.sandy_orch_worker_control SET last_request_id=request_id,last_requested_at=clock_timestamp(),updated_at=clock_timestamp() WHERE singleton;
 INSERT INTO public.sandy_engineering_change_events(change_id,event_type,actor,detail)
 VALUES(control.release_change_id,'durable_dispatch_tick_requested',NULL,jsonb_build_object('request_id',request_id,'source_commit',control.source_commit,'queue','sandy_orch_jobs','provider_executed',false,'authority_expanded',false));
 -- HTTP enqueue is not provider execution or durable-job completion.
 RETURN jsonb_build_object('ok',true,'state','dispatch_requested','request_id',request_id,'provider_executed',false);
END $$;
REVOKE ALL ON FUNCTION public.sandy_orch_worker_tick() FROM PUBLIC,anon,authenticated,service_role;
COMMENT ON TABLE public.sandy_orch_worker_control IS 'Private timer configuration only. Existing sandy_orch_jobs/outbox/attempts own durable execution. No grants, jobs, approvals or user sessions are created by this timer.';
DO $$ BEGIN
 IF to_regprocedure('cron.schedule(text,text,text)') IS NULL OR to_regprocedure('net.http_post(text,jsonb,jsonb,jsonb,integer)') IS NULL THEN
  RAISE EXCEPTION 'existing_pg_cron_and_pg_net_required';
 END IF;
 PERFORM cron.schedule('sandy-orchestration-dispatch-every-minute','* * * * *','SELECT public.sandy_orch_worker_tick()');
END $$;
COMMIT;
