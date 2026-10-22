BEGIN;
CREATE OR REPLACE FUNCTION public.sandy_engineering_reserve_compensation(p_user_id uuid, p_session_id uuid, p_epoch integer, p_snapshot_id uuid, p_observation_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
DECLARE s public.sandy_lifecycle_snapshots;c public.sandy_lifecycle_compensations;ctx jsonb;prepared jsonb;contract text;request_id uuid:=gen_random_uuid();
BEGIN
 SELECT * INTO s FROM public.sandy_lifecycle_snapshots WHERE id=p_snapshot_id FOR UPDATE;
 IF s.id IS NULL OR s.record->>'proof_version' IS DISTINCT FROM '2' THEN RETURN jsonb_build_object('ok',false,'error','immutable_provider_preimage_missing','http_status',424);END IF;
 ctx:=public.sandy_engineering_recovery_context(p_user_id,p_session_id,p_epoch,s.source_request_id);IF ctx->>'ok' IS DISTINCT FROM 'true' THEN RETURN ctx;END IF;
 SELECT * INTO c FROM public.sandy_lifecycle_compensations WHERE snapshot_id=s.id;
 IF FOUND THEN
  -- Redeliver only the original bound request when the durable provider ledger
  -- proves there has been no admission. One-use admission/consumption is still
  -- authoritative if a previous delivery races this one. Never retry a consumed
  -- or uncertain provider mutation under another request ID.
  IF c.state IN('reserved','unknown') AND NOT EXISTS(SELECT 1 FROM public.sandy_api_execution_admissions a WHERE a.actor_id=c.actor_id AND a.request_id=c.request_id) THEN
   IF NOT EXISTS(SELECT 1 FROM public.sandy_lifecycle_observations o WHERE o.id=p_observation_id AND o.snapshot_id=s.id AND o.phase='source' AND o.matched AND o.recorded_at>clock_timestamp()-interval '30 seconds') THEN
    RETURN jsonb_build_object('ok',false,'error','compensation_resource_changed','http_status',409);END IF;
   SELECT error_contract->>'contract_sha256' INTO contract FROM public.sandy_operation_registry WHERE operation=s.record->>'compensation_operation';
   prepared:=public.sandy_engineering_prepare_delegated(p_user_id,p_session_id,p_epoch,c.request_id,s.record->>'compensation_operation',s.record->>'compensation_arguments_canonical',contract,'{"provider":"github","repository":"ausstyle/web-staging"}');
   IF prepared->>'ok' IS DISTINCT FROM 'true' THEN RETURN prepared;END IF;
   IF prepared->>'authorization_id' IS DISTINCT FROM c.approval_id::text OR NOT public.sandy_engineering_policy_job_authorized(c.approval_id,'authorized_by_policy') THEN
    RETURN jsonb_build_object('ok',false,'error','compensation_not_resumable','http_status',409);END IF;
   UPDATE public.sandy_lifecycle_compensations SET state='reserved',finished_at=NULL WHERE snapshot_id=s.id;
   PERFORM public.sandy_api_append_audit(c.actor_id,s.record->>'compensation_operation',c.request_id,NULL,NULL,'recovery','unadmitted_delivery_resumed',s.record->>'compensation_input_sha256',NULL,NULL,NULL);
   RETURN jsonb_build_object('ok',true,'reused',true,'request_id',c.request_id,'authorization_id',c.approval_id,'state','reserved','redispatch_permitted',false,'attempt_delivery',true);
  END IF;
  RETURN jsonb_build_object('ok',true,'reused',true,'request_id',c.request_id,'authorization_id',c.approval_id,'state',c.state,'redispatch_permitted',false,'attempt_delivery',false);
 END IF;
 IF NOT EXISTS(SELECT 1 FROM public.sandy_lifecycle_observations o WHERE o.id=p_observation_id AND o.snapshot_id=s.id AND o.phase='source' AND o.matched AND o.recorded_at>clock_timestamp()-interval '30 seconds') THEN
 RETURN jsonb_build_object('ok',false,'error','compensation_resource_changed','http_status',409);END IF;
 SELECT error_contract->>'contract_sha256' INTO contract FROM public.sandy_operation_registry WHERE operation=s.record->>'compensation_operation';
 prepared:=public.sandy_engineering_prepare_delegated(p_user_id,p_session_id,p_epoch,request_id,s.record->>'compensation_operation',s.record->>'compensation_arguments_canonical',contract,'{"provider":"github","repository":"ausstyle/web-staging"}');
 IF prepared->>'ok' IS DISTINCT FROM 'true' THEN RETURN prepared;END IF;
 INSERT INTO public.sandy_lifecycle_compensations(snapshot_id,actor_id,approval_id,request_id) VALUES(s.id,s.actor_id,(prepared->>'authorization_id')::uuid,request_id) RETURNING * INTO c;
 RETURN jsonb_build_object('ok',true,'reused',false,'request_id',c.request_id,'authorization_id',c.approval_id,'state',c.state,'redispatch_permitted',true);
END $function$
;
NOTIFY pgrst,'reload schema';
COMMIT;
