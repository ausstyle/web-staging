-- Guard the already installed timer transport configuration, not job authority.
-- No credential export/rotation, job admission, Owner session or provider effect.
BEGIN;
DO $$ BEGIN
 IF (SELECT encode(sha256(convert_to(prosrc,'UTF8')),'hex') FROM pg_proc WHERE oid='public.sandy_orch_worker_bind_transport(text)'::regprocedure)
 IS DISTINCT FROM 'b54c4c0cc928907397d2fa057e7febe60597a3b2b49320275fcbec21e9e0c15b' THEN RAISE EXCEPTION 'existing_transport_binder_source_changed';END IF;
END $$;
CREATE OR REPLACE FUNCTION public.sandy_orch_worker_bind_transport(p_secret text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE c public.sandy_orch_worker_control; secret_id uuid; existing_secret text;
BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' OR p_secret IS NULL OR length(p_secret) NOT BETWEEN 100 AND 8192 THEN
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
REVOKE ALL ON FUNCTION public.sandy_orch_worker_bind_transport(text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.sandy_orch_worker_bind_transport(text) TO service_role;
CREATE FUNCTION public.sandy_orch_worker_transport_state() RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE c public.sandy_orch_worker_control; pending integer;
BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'private_worker_configuration_required' USING ERRCODE='42501';END IF;
 SELECT * INTO c FROM public.sandy_orch_worker_control WHERE singleton;
 SELECT count(*) INTO pending FROM public.sandy_orch_jobs WHERE state IN('queued','leased','running');
 RETURN jsonb_build_object('ok',true,'enabled',c.enabled,'credential_bound',c.transport_secret_id IS NOT NULL,
 'unactivated',NOT c.enabled AND c.release_change_id IS NULL AND c.source_commit IS NULL AND c.last_request_id IS NULL,
 'active_jobs',pending,'tracking_change_id','740a56f8-a582-419f-a4d9-9440af5e57f9',
 'tracking_verified',EXISTS(SELECT 1 FROM public.sandy_engineering_changes WHERE id='740a56f8-a582-419f-a4d9-9440af5e57f9' AND title='Activate existing durable read dispatcher timer'
  AND expected_behavior='Resume only already admitted fenced read jobs; no authority or job creation' AND status='proposed' AND requested_by IN(SELECT user_id FROM public.sandy_engineering_test_identities)),
 'configuration_contract','private-durable-worker-transport-v2','authority_expanded',false);
END $$;
REVOKE ALL ON FUNCTION public.sandy_orch_worker_transport_state() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.sandy_orch_worker_transport_state() TO service_role;
NOTIFY pgrst,'reload schema';
COMMIT;
