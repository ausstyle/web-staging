-- The deployed GCP read worker already supports get_logs and uses this RPC.
-- Keep completion authorization, state transitions, audit details and grants intact.
-- Baseline source SHA-256: 20e4188cfae99e63469d0e7bf32ec2f038962fc9c5669e9102893ccf941b8470.
BEGIN;

DO $guard$
DECLARE routine_oid oid := pg_catalog.to_regprocedure('public.sandy_finish_cloud_read_job(uuid,jsonb)');
BEGIN
  IF routine_oid IS NULL THEN
    RAISE EXCEPTION 'cloud read completion baseline missing; inspect live routine before migration';
  END IF;
  IF pg_catalog.md5(pg_catalog.pg_get_functiondef(routine_oid))
       IS DISTINCT FROM '02d14879b964e3d942465d7cf1f2544c'
     OR NOT EXISTS (
       SELECT 1 FROM pg_catalog.pg_proc
       WHERE oid = routine_oid
         AND pg_catalog.pg_get_userbyid(proowner) = 'postgres'
         AND prosecdef
         AND proconfig = ARRAY['search_path=public, pg_temp']::text[]
         AND proacl::text = '{postgres=X/postgres,service_role=X/postgres}'
     ) THEN
    RAISE EXCEPTION 'cloud read completion baseline drift; inspect live source and privileges before migration';
  END IF;
END $guard$;

CREATE OR REPLACE FUNCTION public.sandy_finish_cloud_read_job(p_job_id uuid, p_result jsonb)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare n integer;
begin
 update public.sandy_deployment_jobs
 set status='succeeded',result=p_result,finished_at=now(),updated_at=now()
 where id=p_job_id and status='running' and provider='google_cloud' and operation in ('get_vm','list_vms','get_logs');
 get diagnostics n=row_count;
 if n=1 then
 insert into public.sandy_deployment_events(job_id,event_type,actor,details)
 values(p_job_id,'completed','sandy_gcp_worker','{"verified_persist":true}'::jsonb);
 end if;
 return n=1;
end $function$;

-- CREATE OR REPLACE preserves the existing owner and ACL. Fail the whole
-- transaction if these worker-only privileges or security settings changed.
DO $guard$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_proc
    WHERE oid = 'public.sandy_finish_cloud_read_job(uuid,jsonb)'::regprocedure
      AND pg_catalog.pg_get_userbyid(proowner) = 'postgres'
      AND prosecdef
      AND proconfig = ARRAY['search_path=public, pg_temp']::text[]
      AND proacl::text = '{postgres=X/postgres,service_role=X/postgres}'
  ) THEN
    RAISE EXCEPTION 'cloud read completion security settings changed; rolling back';
  END IF;
END $guard$;

COMMIT;
