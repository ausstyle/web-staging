-- Run after 05100 in the SAME transaction. This is a real-provider compile,
-- private ACL, disabled registry and no-grant refusal check, not an Auth session
-- or provider business-execution test. All migration/test changes roll back.
BEGIN;
SET LOCAL statement_timeout='15s';
SET LOCAL lock_timeout='3s';
DO $$ DECLARE f record;t text;role_name text;result jsonb;count_rows integer;
BEGIN
 SELECT count(*) INTO count_rows FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname LIKE 'sandy_api_maintenance_%';
 IF count_rows<12 THEN RAISE EXCEPTION 'maintenance_functions_missing';END IF;
 FOR f IN SELECT p.oid,p.prosecdef FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname LIKE 'sandy_api_maintenance_%' LOOP
  IF NOT f.prosecdef THEN RAISE EXCEPTION 'maintenance_function_not_security_definer';END IF;
  FOREACH role_name IN ARRAY ARRAY['anon','authenticated','service_role'] LOOP
   IF has_function_privilege(role_name,f.oid,'EXECUTE') THEN RAISE EXCEPTION 'maintenance_function_acl_exposed';END IF;
  END LOOP;
 END LOOP;
 FOREACH t IN ARRAY ARRAY['sandy_database_maintenance_commands','sandy_database_maintenance_schedules','sandy_database_maintenance_schedule_versions','sandy_database_maintenance_cron_runs','sandy_database_maintenance_schedule_receipts'] LOOP
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid=to_regclass('public.'||t)) THEN RAISE EXCEPTION 'maintenance_private_table_rls_missing';END IF;
  FOREACH role_name IN ARRAY ARRAY['anon','authenticated','service_role'] LOOP
   IF has_table_privilege(role_name,'public.'||t,'SELECT,INSERT,UPDATE,DELETE') THEN RAISE EXCEPTION 'maintenance_private_table_acl_exposed';END IF;
  END LOOP;
 END LOOP;
 SELECT count(*) INTO count_rows FROM public.sandy_operation_registry WHERE operation IN('supabase.database.vacuum','supabase.database.cron.jobs.create','supabase.database.cron.jobs.update','supabase.database.maintenance.receipt.get') AND handler='sandy-database-operation-api' AND NOT api_exposed AND NOT verified AND NOT ui_exposed AND NOT ai_exposed AND error_contract->>'version'='2.0.0';
 IF count_rows<>4 THEN RAISE EXCEPTION 'maintenance_registry_not_closed';END IF;
 result:=public.sandy_api_maintenance_reserve('{}');IF result->>'ok'='true' THEN RAISE EXCEPTION 'maintenance_reserve_without_grant';END IF;
 result:=public.sandy_api_maintenance_cron_upsert('{}');IF result->>'ok'='true' THEN RAISE EXCEPTION 'maintenance_cron_without_grant';END IF;
 result:=public.sandy_api_maintenance_receipt('{}');IF result->>'ok'='true' THEN RAISE EXCEPTION 'maintenance_receipt_without_grant';END IF;
 result:=public.sandy_api_maintenance_finish_native(gen_random_uuid(),'{}');IF result->>'ok'='true' THEN RAISE EXCEPTION 'maintenance_native_forged_proof';END IF;
 result:=public.sandy_api_maintenance_mark_unknown(gen_random_uuid(),'fixture');IF result->>'ok'='true' THEN RAISE EXCEPTION 'maintenance_unknown_without_command';END IF;
 result:=public.sandy_api_maintenance_cron_run(gen_random_uuid());IF result->>'ok'='true' THEN RAISE EXCEPTION 'maintenance_unowned_schedule';END IF;
 IF EXISTS(SELECT 1 FROM public.sandy_database_maintenance_commands) OR EXISTS(SELECT 1 FROM public.sandy_database_maintenance_schedules) OR EXISTS(SELECT 1 FROM public.sandy_database_maintenance_cron_runs) THEN RAISE EXCEPTION 'maintenance_no_grant_created_effect';END IF;
END $$;
SELECT jsonb_build_object('ok',true,'checks',6,'validation','real_project_private_boundary_full_rollback','native_tls_executed',false,'pg_cron_scheduled',false,'controller_session_executed',false,'pg_cron_present',EXISTS(SELECT 1 FROM pg_extension WHERE extname='pg_cron')) AS result;
ROLLBACK;
