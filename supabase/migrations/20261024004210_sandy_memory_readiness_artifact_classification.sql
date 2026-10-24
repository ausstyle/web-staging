-- Forward repair only: use existing Control artifact classifications. Neither
-- artifact CHECK is widened, and no Owner/customer/standing authority is added.
BEGIN;
SET LOCAL lock_timeout='2s';SET LOCAL statement_timeout='15s';
DO $repair$
DECLARE target oid;body text;definition text;old text;replacement text;expected text;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM supabase_migrations.schema_migrations WHERE version='20261024004200') THEN RAISE EXCEPTION 'original reviewed readiness migration required';END IF;
 IF EXISTS(SELECT 1 FROM public.sandy_engineering_change_events i JOIN public.sandy_engineering_artifacts a ON a.id=(i.detail->>'artifact_id')::uuid
 WHERE i.event_type='memory_private_readiness_installed' AND (a.metadata->>'expires_at')::timestamptz>clock_timestamp()
 AND NOT EXISTS(SELECT 1 FROM public.sandy_engineering_change_events e WHERE e.event_type='memory_private_readiness_revoked' AND e.detail->>'artifact_id'=a.id::text)) THEN RAISE EXCEPTION 'retire existing readiness before source repair';END IF;
 FOREACH target IN ARRAY ARRAY['public.sandy_guard_memory_private_readiness_event()'::regprocedure::oid,'public.sandy_api_memory_private_readiness(uuid,text,text,uuid,text)'::regprocedure::oid] LOOP
  SELECT prosrc,pg_get_functiondef(oid) INTO body,definition FROM pg_proc WHERE oid=target;
  IF target='public.sandy_guard_memory_private_readiness_event()'::regprocedure THEN
   expected:='d89802db201bb22ba0cf684dd7dfe72a832809b3d141d91e4acde89087de6cfc';
   old:=$old$a.artifact_type<>'runtime_private_certification' OR a.target<>'memory.fact_correct' OR a.rollback_strategy<>'revoke_readiness_only'$old$;
  ELSE
   expected:='62f4e382b31cdbf94110dc629df9bbe3a73f847ed637043148ca0ac07c9c3c98';
   old:=$old$a.artifact_type<>'runtime_private_certification' OR a.target<>'memory.fact_correct'$old$;
  END IF;
  replacement:=$new$a.artifact_type<>'configuration' OR a.target<>'memory.fact_correct' OR a.rollback_strategy<>'manual_review' OR a.metadata->>'kind' IS DISTINCT FROM 'runtime_private_certification'$new$;
  IF encode(sha256(convert_to(body,'UTF8')),'hex')<>expected OR (length(body)-length(replace(body,old,'')))/length(old)<>1 THEN RAISE EXCEPTION 'exact source-attested readiness preimage required';END IF;
  EXECUTE replace(definition,old,replacement);
 END LOOP;
END $repair$;
COMMIT;
