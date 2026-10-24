-- Add supported modern Supabase private-key format without creating authority.
-- Preserve exact installed guards, same-key custody, fixed route and private ACL.
BEGIN;
DO $$ BEGIN
 IF (SELECT encode(sha256(convert_to(prosrc,'UTF8')),'hex') FROM pg_proc WHERE oid='public.sandy_orch_worker_bind_transport(text)'::regprocedure)
 IS DISTINCT FROM '9efca2bb90f3cae73ee445624c2b0a0df843e12733ef9b48d3ea6dfab7f13af7'
 OR (SELECT encode(sha256(convert_to(prosrc,'UTF8')),'hex') FROM pg_proc WHERE oid='public.sandy_orch_worker_tick()'::regprocedure)
 IS DISTINCT FROM '5d1a5164c7fa95b25bca48a3cd066f65a9abe5e2d2eb873b4b5300463efa9cf2' THEN
  RAISE EXCEPTION 'existing_private_transport_source_changed';
 END IF;
 PERFORM 1 FROM public.sandy_orch_worker_control WHERE singleton AND NOT enabled AND transport_secret_id IS NULL
 AND release_change_id IS NULL AND source_commit IS NULL AND last_request_id IS NULL FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'disabled_unbound_existing_timer_required';END IF;
END $$;
CREATE OR REPLACE FUNCTION public.sandy_orch_worker_bind_transport(p_secret text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE c public.sandy_orch_worker_control; secret_id uuid; existing_secret text;
BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' OR p_secret IS NULL OR NOT ((length(p_secret) BETWEEN 100 AND 8192 AND p_secret ~ '^[A-Za-z0-9_-]+[.][A-Za-z0-9_-]+[.][A-Za-z0-9_-]+$') OR p_secret ~ '^sb_secret_[A-Za-z0-9_-]{20,128}$') THEN
  RAISE EXCEPTION 'private_worker_transport_binding_required' USING ERRCODE='42501';
 END IF;
 SELECT * INTO c FROM public.sandy_orch_worker_control WHERE singleton FOR UPDATE;
 IF c.singleton IS NULL OR c.enabled OR c.release_change_id IS NOT NULL OR c.source_commit IS NOT NULL OR c.last_request_id IS NOT NULL
 OR NOT EXISTS(SELECT 1 FROM public.sandy_engineering_changes WHERE id='740a56f8-a582-419f-a4d9-9440af5e57f9' AND title='Activate existing durable read dispatcher timer'
  AND expected_behavior='Resume only already admitted fenced read jobs; no authority or job creation' AND status='proposed'
  AND requested_by IN(SELECT user_id FROM public.sandy_engineering_test_identities)) THEN
  RAISE EXCEPTION 'disabled_unactivated_existing_timer_required' USING ERRCODE='42501';
 END IF;
 IF c.transport_secret_id IS NOT NULL THEN
  SELECT decrypted_secret INTO existing_secret FROM vault.decrypted_secrets WHERE id=c.transport_secret_id AND name='sandy-orchestration-worker/service-transport';
  IF existing_secret IS NULL OR sha256(convert_to(existing_secret,'UTF8')) IS DISTINCT FROM sha256(convert_to(p_secret,'UTF8')) THEN
   RAISE EXCEPTION 'transport_replacement_requires_separate_configuration' USING ERRCODE='42501';
  END IF;
 ELSE
  SELECT vault.create_secret(p_secret,'sandy-orchestration-worker/service-transport','Private existing Sandy API worker transport; never customer or Owner authority') INTO secret_id;
  UPDATE public.sandy_orch_worker_control SET transport_secret_id=secret_id,updated_at=clock_timestamp() WHERE singleton;
 END IF;
 RETURN jsonb_build_object('ok',true,'bound',true,'authority_expanded',false);
END $$;
CREATE OR REPLACE FUNCTION public.sandy_orch_worker_tick() RETURNS jsonb
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
 IF transport IS NULL OR NOT ((length(transport) BETWEEN 100 AND 8192 AND transport ~ '^[A-Za-z0-9_-]+[.][A-Za-z0-9_-]+[.][A-Za-z0-9_-]+$') OR transport ~ '^sb_secret_[A-Za-z0-9_-]{20,128}$') THEN
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
REVOKE ALL ON FUNCTION public.sandy_orch_worker_bind_transport(text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.sandy_orch_worker_bind_transport(text) TO service_role;
REVOKE ALL ON FUNCTION public.sandy_orch_worker_tick() FROM PUBLIC,anon,authenticated,service_role;
NOTIFY pgrst,'reload schema';
COMMIT;
