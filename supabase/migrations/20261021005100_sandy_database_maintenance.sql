-- Fixed-project maintenance boundary. Native VACUUM is issued on one verified
-- direct TLS session by the handler, outside a transaction; never through SQL
-- network relays. Cron stores only a bounded, separately approved standing plan.
-- All objects are private to the Management database role. Registry activation
-- and real provider verification are separate from installing this migration.
BEGIN;
CREATE TABLE public.sandy_database_maintenance_commands(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 admission_id uuid NOT NULL UNIQUE REFERENCES public.sandy_api_execution_admissions(id),
 actor_id uuid NOT NULL,request_id uuid NOT NULL,context jsonb NOT NULL,
 target_table text NOT NULL,target_oid oid NOT NULL,lease_token uuid NOT NULL DEFAULT gen_random_uuid(),
 backend_pid integer NOT NULL,state text NOT NULL CHECK(state IN('reserved','running','observed','accepted','unknown','failed')),
 before_stats jsonb NOT NULL,reserved_at timestamptz NOT NULL DEFAULT clock_timestamp(),started_at timestamptz,
 finished_at timestamptz,result jsonb,UNIQUE(actor_id,request_id)
);
CREATE TABLE public.sandy_database_maintenance_schedules(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),actor_id uuid NOT NULL,cron_job_id bigint UNIQUE,
 revision integer NOT NULL DEFAULT 1 CHECK(revision>0),active boolean NOT NULL DEFAULT false,
 runs integer NOT NULL DEFAULT 0,last_run_at timestamptz,created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE public.sandy_database_maintenance_schedule_versions(
 schedule_id uuid NOT NULL REFERENCES public.sandy_database_maintenance_schedules(id),revision integer NOT NULL,
 admission_id uuid NOT NULL UNIQUE REFERENCES public.sandy_api_execution_admissions(id),context jsonb NOT NULL,
 label text NOT NULL,schedule text NOT NULL,plan jsonb NOT NULL,plan_sha256 text NOT NULL,
 expires_at timestamptz NOT NULL,max_runs integer NOT NULL CHECK(max_runs BETWEEN 1 AND 100),
 min_interval_seconds integer NOT NULL CHECK(min_interval_seconds BETWEEN 60 AND 86400),
 max_affected_rows integer NOT NULL CHECK(max_affected_rows BETWEEN 1 AND 100),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),PRIMARY KEY(schedule_id,revision)
);
CREATE TABLE public.sandy_database_maintenance_cron_runs(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),schedule_id uuid NOT NULL,revision integer NOT NULL,
 run_number integer NOT NULL,started_at timestamptz NOT NULL DEFAULT clock_timestamp(),finished_at timestamptz,
 state text NOT NULL CHECK(state IN('running','observed','failed','rejected')),affected_rows bigint,
 result_sha256 text,error_code text,
 FOREIGN KEY(schedule_id,revision) REFERENCES public.sandy_database_maintenance_schedule_versions(schedule_id,revision),
 UNIQUE(schedule_id,revision,run_number)
);
CREATE TABLE public.sandy_database_maintenance_schedule_receipts(
 admission_id uuid PRIMARY KEY REFERENCES public.sandy_api_execution_admissions(id),actor_id uuid NOT NULL,
 request_id uuid NOT NULL,result jsonb NOT NULL,recorded_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['sandy_database_maintenance_commands','sandy_database_maintenance_schedules','sandy_database_maintenance_schedule_versions','sandy_database_maintenance_cron_runs','sandy_database_maintenance_schedule_receipts'] LOOP
  EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC,anon,authenticated,service_role',t);
 END LOOP;
END $$;
CREATE FUNCTION public.sandy_api_maintenance_immutable() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
BEGIN RAISE EXCEPTION 'maintenance_immutable_record'; END $$;
CREATE TRIGGER sandy_maintenance_version_immutable BEFORE UPDATE OR DELETE ON public.sandy_database_maintenance_schedule_versions FOR EACH ROW EXECUTE FUNCTION public.sandy_api_maintenance_immutable();
CREATE TRIGGER sandy_maintenance_schedule_receipt_immutable BEFORE UPDATE OR DELETE ON public.sandy_database_maintenance_schedule_receipts FOR EACH ROW EXECUTE FUNCTION public.sandy_api_maintenance_immutable();

-- Standing authorization is explicitly limited to the original exact owner
-- approval and immutable command. It is not an Auth session or a reusable grant.
-- Original enqueue TTL is replaced only by the approved <=24h standing bounds.
CREATE FUNCTION public.sandy_api_maintenance_standing_authorized(p jsonb) RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE a public.sandy_api_execution_admissions%ROWTYPE;r public.sandy_operation_registry%ROWTYPE;
BEGIN
 SELECT * INTO a FROM public.sandy_api_execution_admissions WHERE id=(p->>'admission_id')::uuid;
 IF NOT FOUND OR a.state NOT IN('consumed','accepted') OR a.credential_id IS NOT NULL OR a.tenant_id IS NOT NULL
  OR a.approval_id IS NULL OR a.actor_id IS DISTINCT FROM (p->>'actor_id')::uuid
  OR a.request_id IS DISTINCT FROM (p->>'request_id')::uuid OR a.grant_id IS DISTINCT FROM (p->>'grant_id')::uuid
  OR a.operation IS DISTINCT FROM p->>'operation' OR a.input_sha256 IS DISTINCT FROM p->>'input_sha256'
  OR a.contract_sha256 IS DISTINCT FROM p->>'contract_sha256' OR a.scope_sha256 IS DISTINCT FROM p->>'scope_sha256'
  OR p->>'tenant_id' IS NOT NULL OR p->>'credential_id' IS NOT NULL
  OR NOT public.sandy_api_current_owner(a.actor_id)
  OR (p->>'arguments_canonical')::jsonb IS DISTINCT FROM p->'arguments'
  OR encode(extensions.digest(p->>'arguments_canonical','sha256'),'hex') IS DISTINCT FROM a.input_sha256
  OR a.scope_sha256 IS DISTINCT FROM encode(extensions.digest('{"database":"postgres","project_ref":"zmqlyygzqoidkcwdysok","provider":"supabase","schema":"public"}','sha256'),'hex') THEN RETURN false; END IF;
 SELECT * INTO r FROM public.sandy_operation_registry WHERE operation=a.operation;
 IF r.handler IS DISTINCT FROM 'sandy-database-operation-api' OR r.api_exposed IS DISTINCT FROM true OR r.verified IS DISTINCT FROM true
  OR r.error_contract->>'requires_approval' IS DISTINCT FROM 'true' OR r.error_contract->>'requires_grant' IS DISTINCT FROM 'true'
  OR r.error_contract->>'contract_sha256' IS DISTINCT FROM a.contract_sha256
  OR a.registry_revision_sha256 IS DISTINCT FROM public.sandy_api_registry_revision(a.operation) THEN RETURN false;END IF;
 RETURN EXISTS(SELECT 1 FROM public.sandy_api_mutation_approval_snapshots proof
  JOIN public.sandy_deployment_jobs job ON job.id=proof.job_id
  JOIN public.sandy_engineering_changes change ON change.id=proof.engineering_change_id
  WHERE proof.job_id=a.approval_id AND job.status='running' AND change.status='approved'
   AND proof.actor_id=a.actor_id AND proof.operation=a.operation AND proof.input_sha256=a.input_sha256
   AND proof.contract_sha256=a.contract_sha256 AND proof.scope_sha256=a.scope_sha256
   AND proof.maximum_declared_cost_units>=a.declared_cost_units
   AND proof.job_fingerprint_sha256=public.sandy_api_job_fingerprint(job));
EXCEPTION WHEN OTHERS THEN RETURN false; END $$;

CREATE FUNCTION public.sandy_api_maintenance_stats(p_oid oid) RETURNS jsonb
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
 SELECT coalesce((SELECT jsonb_build_object('table_oid',c.oid,'vacuum_count',s.vacuum_count,'last_vacuum',s.last_vacuum)
  FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace LEFT JOIN pg_stat_all_tables s ON s.relid=c.oid
  WHERE c.oid=p_oid AND n.nspname='public' AND c.relkind='r'),'{}'::jsonb)
$$;
CREATE FUNCTION public.sandy_api_maintenance_native_target(p_table text) RETURNS oid
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE target oid;
BEGIN
 PERFORM public.sandy_api_database_passive_relations(jsonb_build_object('passive_relations',jsonb_build_array(jsonb_build_object('schema','public','name',p_table))));
 target:=to_regclass(format('public.%I',p_table));
 -- VACUUM/ANALYZE can invoke access-method handlers or index expressions.
 -- Triggers/defaults/FKs are not run by native VACUUM and need not be excluded.
 IF EXISTS(SELECT 1 FROM pg_inherits WHERE inhrelid=target OR inhparent=target)
  OR EXISTS(SELECT 1 FROM pg_index WHERE indrelid=target AND (indexprs IS NOT NULL OR indpred IS NOT NULL))
  OR EXISTS(SELECT 1 FROM pg_index i CROSS JOIN LATERAL unnest(i.indclass) x(class_oid) JOIN pg_opclass o ON o.oid=x.class_oid JOIN pg_namespace n ON n.oid=o.opcnamespace WHERE i.indrelid=target AND n.nspname<>'pg_catalog')
  OR EXISTS(SELECT 1 FROM pg_class c JOIN pg_am am ON am.oid=c.relam JOIN pg_proc f ON f.oid=am.amhandler JOIN pg_namespace n ON n.oid=f.pronamespace WHERE c.oid IN(SELECT target UNION ALL SELECT indexrelid FROM pg_index WHERE indrelid=target) AND n.nspname<>'pg_catalog') THEN
  RAISE EXCEPTION 'maintenance_native_hidden_effect_refused';END IF;
 RETURN target;
END $$;
CREATE FUNCTION public.sandy_api_maintenance_reserve(p jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE permission jsonb;c public.sandy_database_maintenance_commands%ROWTYPE;target oid;name text;
BEGIN
 permission:=public.sandy_api_database_authorize(p);IF permission->>'ok'<>'true' THEN RETURN permission;END IF;
 name:=p->>'target_table';
 IF p->>'operation' IS DISTINCT FROM 'supabase.database.vacuum' OR name IS DISTINCT FROM p->'arguments'->>'table'
  OR name IS NULL OR name !~ '^[a-z_][a-z0-9_]{0,62}$' THEN RAISE EXCEPTION 'maintenance_target_binding_invalid'; END IF;
 target:=public.sandy_api_maintenance_native_target(name);
 INSERT INTO public.sandy_database_maintenance_commands(admission_id,actor_id,request_id,context,target_table,target_oid,backend_pid,state,before_stats)
 VALUES((p->>'admission_id')::uuid,(p->>'actor_id')::uuid,(p->>'request_id')::uuid,p,name,target,pg_backend_pid(),'reserved',public.sandy_api_maintenance_stats(target))
 ON CONFLICT(admission_id) DO NOTHING;
 SELECT * INTO c FROM public.sandy_database_maintenance_commands WHERE admission_id=(p->>'admission_id')::uuid FOR UPDATE;
 IF c.context IS DISTINCT FROM p OR c.backend_pid<>pg_backend_pid() OR c.state<>'reserved' THEN
  RETURN jsonb_build_object('ok',false,'error','maintenance_command_already_reserved','http_status',409);END IF;
 RETURN jsonb_build_object('ok',true,'command_id',c.id,'lease_token',c.lease_token,'backend_pid',c.backend_pid,'state',c.state,'reserved',true);
EXCEPTION WHEN OTHERS THEN RETURN jsonb_build_object('ok',false,'error',CASE WHEN SQLERRM IN('maintenance_target_binding_invalid','maintenance_native_hidden_effect_refused','database_protected_object_refused','database_sensitive_source_refused','database_passive_relation_required') THEN SQLERRM ELSE 'maintenance_reservation_failed' END,'http_status',409);END $$;
CREATE FUNCTION public.sandy_api_maintenance_start(p_command_id uuid,p_lease_token uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE c public.sandy_database_maintenance_commands%ROWTYPE;permission jsonb;
BEGIN
 SELECT * INTO c FROM public.sandy_database_maintenance_commands WHERE id=p_command_id FOR UPDATE;
 IF NOT FOUND OR c.lease_token IS DISTINCT FROM p_lease_token OR c.backend_pid<>pg_backend_pid() OR c.state<>'reserved' THEN
  RETURN jsonb_build_object('ok',false,'error','maintenance_lease_refused','http_status',409);END IF;
 permission:=public.sandy_api_database_authorize(c.context);IF permission->>'ok'<>'true' THEN RETURN permission;END IF;
 IF to_regclass(format('public.%I',c.target_table))::oid IS DISTINCT FROM c.target_oid THEN RETURN jsonb_build_object('ok',false,'error','maintenance_target_changed','http_status',409); END IF;
 PERFORM public.sandy_api_maintenance_native_target(c.target_table);
 UPDATE public.sandy_database_maintenance_commands SET state='running',started_at=clock_timestamp() WHERE id=c.id;
 RETURN jsonb_build_object('ok',true,'command_id',c.id,'state','running');
EXCEPTION WHEN OTHERS THEN RETURN jsonb_build_object('ok',false,'error',CASE WHEN SQLERRM IN('maintenance_native_hidden_effect_refused','database_protected_object_refused','database_sensitive_source_refused','database_passive_relation_required') THEN SQLERRM ELSE 'maintenance_start_failed' END,'http_status',409);END $$;
CREATE FUNCTION public.sandy_api_maintenance_finish(p_command_id uuid,p_lease_token uuid,p_outcome text,p_evidence jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE c public.sandy_database_maintenance_commands%ROWTYPE;after_stats jsonb;observed boolean:=false;outcome text;receipt jsonb;
BEGIN
 SELECT * INTO c FROM public.sandy_database_maintenance_commands WHERE id=p_command_id FOR UPDATE;
 IF NOT FOUND OR c.lease_token IS DISTINCT FROM p_lease_token OR c.backend_pid<>pg_backend_pid() OR c.state<>'running'
  OR p_outcome IS NULL OR p_outcome NOT IN('observed','accepted','unknown','failed') THEN
  RETURN jsonb_build_object('ok',false,'error','maintenance_lease_refused','http_status',409);END IF;
 IF p_outcome IN('accepted','observed') AND (p_evidence->>'provider_protocol' IS DISTINCT FROM 'postgres'
  OR p_evidence->>'provider_command_tag' IS DISTINCT FROM 'VACUUM' OR p_evidence->>'command_completed' IS DISTINCT FROM 'true') THEN
  RETURN jsonb_build_object('ok',false,'error','maintenance_native_completion_required','http_status',409);END IF;
 PERFORM pg_stat_clear_snapshot();after_stats:=public.sandy_api_maintenance_stats(c.target_oid);
 IF to_regclass(format('public.%I',c.target_table))::oid=c.target_oid THEN
  observed:=coalesce((after_stats->>'vacuum_count')::bigint>(c.before_stats->>'vacuum_count')::bigint,false)
   OR coalesce((after_stats->>'last_vacuum')::timestamptz>=c.started_at,false);
 END IF;
 outcome:=CASE WHEN p_outcome IN('accepted','observed') THEN CASE WHEN observed THEN 'observed' ELSE 'accepted' END ELSE p_outcome END;
 receipt:=jsonb_build_object('command_id',c.id,'operation','supabase.database.vacuum','project_ref','zmqlyygzqoidkcwdysok',
  'request_state',outcome,'provider_protocol','postgres','provider_command_tag',CASE WHEN p_outcome IN('accepted','observed') THEN 'VACUUM' ELSE NULL END,
  'command_completed',p_outcome IN('accepted','observed'),'transactional',false,'verification_passed',outcome='observed',
  'independently_observed',outcome='observed','readback',jsonb_build_object('before',c.before_stats,'after',after_stats,'same_relation',to_regclass(format('public.%I',c.target_table))::oid IS NOT DISTINCT FROM c.target_oid),'reconciliation_required',outcome IN('accepted','unknown'));
 UPDATE public.sandy_database_maintenance_commands SET state=outcome,finished_at=clock_timestamp(),result=receipt WHERE id=c.id;
 RETURN jsonb_build_object('ok',true,'result',receipt);
END $$;
CREATE FUNCTION public.sandy_api_maintenance_mark_unknown(p_admission_id uuid,p_reason text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE c public.sandy_database_maintenance_commands%ROWTYPE;receipt jsonb;
BEGIN
 SELECT * INTO c FROM public.sandy_database_maintenance_commands WHERE admission_id=p_admission_id FOR UPDATE;
 IF NOT FOUND OR c.backend_pid<>pg_backend_pid() OR c.state NOT IN('reserved','running') OR NOT public.sandy_api_maintenance_standing_authorized(c.context) THEN RETURN jsonb_build_object('ok',false,'error','maintenance_unknown_transition_refused','http_status',409);END IF;
 receipt:=jsonb_build_object('command_id',c.id,'operation','supabase.database.vacuum','project_ref','zmqlyygzqoidkcwdysok','request_state','unknown',
  'provider_protocol','postgres','provider_command_tag',NULL,'command_completed',false,'transactional',false,'verification_passed',false,'independently_observed',false,'reconciliation_required',true);
 UPDATE public.sandy_database_maintenance_commands SET state='unknown',finished_at=clock_timestamp(),result=receipt WHERE id=c.id;
 RETURN jsonb_build_object('ok',true,'result',receipt);
END $$;
-- Native completion is not an HTTP 200. This narrowly bound finalizer records
-- the exact durable VACUUM receipt with a NULL HTTP status and no registry change.
CREATE FUNCTION public.sandy_api_maintenance_finish_native(p_admission_id uuid,p_result_canonical text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE c public.sandy_database_maintenance_commands%ROWTYPE;a public.sandy_api_execution_admissions%ROWTYPE;sha text;
BEGIN
 SELECT * INTO c FROM public.sandy_database_maintenance_commands WHERE admission_id=p_admission_id FOR UPDATE;
 SELECT * INTO a FROM public.sandy_api_execution_admissions WHERE id=p_admission_id FOR UPDATE;
 IF c.id IS NULL OR a.id IS NULL OR c.backend_pid<>pg_backend_pid() OR c.state NOT IN('observed','accepted')
  OR a.operation<>'supabase.database.vacuum' OR c.result IS DISTINCT FROM p_result_canonical::jsonb
  OR c.result->>'provider_protocol'<>'postgres' OR c.result->>'provider_command_tag'<>'VACUUM'
  OR c.result->>'command_completed'<>'true' OR NOT public.sandy_api_maintenance_standing_authorized(c.context) THEN
  RETURN jsonb_build_object('ok',false,'error','maintenance_native_receipt_refused','http_status',409);END IF;
 sha:=encode(extensions.digest(p_result_canonical,'sha256'),'hex');
 IF a.state='accepted' THEN
  IF a.result_sha256=sha AND a.provider_http_status IS NULL AND a.provider_request_id_sha256 IS NULL THEN RETURN jsonb_build_object('ok',true,'admission_id',a.id,'state','accepted','reused',true);END IF;
  RETURN jsonb_build_object('ok',false,'error','execution_receipt_conflict','http_status',409);
 END IF;
 IF a.state<>'consumed' THEN RETURN jsonb_build_object('ok',false,'error','execution_grant_not_consumed','http_status',409);END IF;
 UPDATE public.sandy_api_execution_admissions SET state='accepted',finished_at=clock_timestamp(),provider_http_status=NULL,provider_request_id_sha256=NULL,result_sha256=sha WHERE id=a.id;
 UPDATE public.sandy_deployment_jobs SET result=jsonb_build_object('source','sandy-api','admission_id',a.id,'result_sha256',sha,'provider_protocol','postgres','provider_http_status',NULL,'reconciliation_required',c.state='accepted'),error=NULL,updated_at=clock_timestamp() WHERE id=a.approval_id AND status='running';
 PERFORM public.sandy_api_append_audit(a.actor_id,a.operation,a.request_id,NULL,a.id,'native_postgres','accepted',a.input_sha256,sha,NULL,NULL);
 RETURN jsonb_build_object('ok',true,'admission_id',a.id,'state','accepted','reused',false,'provider_protocol','postgres','provider_http_status',NULL);
EXCEPTION WHEN invalid_text_representation THEN RETURN jsonb_build_object('ok',false,'error','maintenance_native_receipt_refused','http_status',409);END $$;

-- Freeze the exact referenced plain public relations against concurrent DDL.
-- The intentionally narrow supported subset excludes hidden trigger/rule/RLS,
-- FK cascade and custom expression effects, including expression indexes.
CREATE FUNCTION public.sandy_api_maintenance_lock_plan(p_plan jsonb) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE ref record;target oid;statement jsonb;
BEGIN
 FOR ref IN SELECT DISTINCT elem->>'schema' AS schema_name,elem->>'name' AS table_name
  FROM jsonb_array_elements(jsonb_build_array(p_plan->'statement')||coalesce(p_plan->'verifications','[]')) st,
   LATERAL jsonb_array_elements(coalesce(st->'passive_relations','[]')) elem ORDER BY 1,2 LOOP
  IF ref.schema_name IS DISTINCT FROM 'public' OR ref.table_name IS NULL OR ref.table_name !~ '^[a-z_][a-z0-9_]{0,62}$' THEN RAISE EXCEPTION 'maintenance_plain_public_relations_required';END IF;
  EXECUTE format('LOCK TABLE public.%I IN SHARE ROW EXCLUSIVE MODE',ref.table_name);
 END LOOP;
 FOR statement IN SELECT value FROM jsonb_array_elements(jsonb_build_array(p_plan->'statement')||coalesce(p_plan->'verifications','[]')) LOOP
  PERFORM public.sandy_api_database_passive_relations(statement);
  FOR ref IN SELECT value->>'name' AS table_name FROM jsonb_array_elements(coalesce(statement->'passive_relations','[]')) LOOP
   target:=to_regclass(format('public.%I',ref.table_name));
   IF EXISTS(SELECT 1 FROM pg_class WHERE oid=target AND (relrowsecurity OR relforcerowsecurity OR relispartition))
    OR EXISTS(SELECT 1 FROM pg_inherits WHERE inhrelid=target OR inhparent=target)
    OR EXISTS(SELECT 1 FROM pg_policy WHERE polrelid=target)
    OR EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid=target AND NOT tgisinternal)
    OR EXISTS(SELECT 1 FROM pg_rewrite WHERE ev_class=target AND rulename<>'_RETURN')
    OR EXISTS(SELECT 1 FROM pg_constraint WHERE contype='f' AND (conrelid=target OR confrelid=target))
    OR EXISTS(SELECT 1 FROM pg_attrdef WHERE adrelid=target)
    OR EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid=target AND contype IN('c','x'))
    OR EXISTS(SELECT 1 FROM pg_index WHERE indrelid=target AND (indexprs IS NOT NULL OR indpred IS NOT NULL))
    OR EXISTS(SELECT 1 FROM pg_index i CROSS JOIN LATERAL unnest(i.indclass) x(class_oid) JOIN pg_opclass o ON o.oid=x.class_oid JOIN pg_namespace n ON n.oid=o.opcnamespace WHERE i.indrelid=target AND n.nspname<>'pg_catalog')
    OR EXISTS(SELECT 1 FROM pg_class c JOIN pg_am am ON am.oid=c.relam JOIN pg_proc f ON f.oid=am.amhandler JOIN pg_namespace n ON n.oid=f.pronamespace WHERE c.oid IN(SELECT target UNION ALL SELECT indexrelid FROM pg_index WHERE indrelid=target) AND n.nspname<>'pg_catalog') THEN
    RAISE EXCEPTION 'maintenance_hidden_relation_effect_refused';END IF;
  END LOOP;
 END LOOP;
END $$;
CREATE FUNCTION public.sandy_api_maintenance_cron_pause(p_job_id bigint) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
BEGIN
 IF p_job_id IS NOT NULL AND to_regprocedure('cron.alter_job(bigint,text,text,text,text,boolean)') IS NOT NULL THEN
  EXECUTE 'SELECT cron.alter_job($1,active := false)' USING p_job_id;
 END IF;
END $$;
CREATE FUNCTION public.sandy_api_maintenance_schedule_projection(p_schedule_id uuid) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
 SELECT jsonb_build_object('schedule_id',s.id,'cron_job_id',s.cron_job_id,'revision',s.revision,'active',s.active,'runs',s.runs,'expires_at',v.expires_at,'command_sha256',v.plan_sha256,'standing_authorization',true)
 FROM public.sandy_database_maintenance_schedules s JOIN public.sandy_database_maintenance_schedule_versions v ON v.schedule_id=s.id AND v.revision=s.revision WHERE s.id=p_schedule_id
$$;
CREATE FUNCTION public.sandy_api_maintenance_cron_upsert(p jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE permission jsonb;s public.sandy_database_maintenance_schedules%ROWTYPE;prior public.sandy_database_maintenance_schedule_receipts%ROWTYPE;
 args jsonb;plan jsonb;standing jsonb;expiry timestamptz;label text;wrapper text;job_id bigint;receipt jsonb;desired_active boolean;max_runs integer;interval_seconds integer;max_rows integer;
BEGIN
 permission:=public.sandy_api_database_authorize(p);IF permission->>'ok'<>'true' THEN RETURN permission;END IF;
 IF p->>'operation' NOT IN('supabase.database.cron.jobs.create','supabase.database.cron.jobs.update') THEN RAISE EXCEPTION 'maintenance_operation_invalid';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('sandy_maintenance_actor:'||(p->>'actor_id'),0));
 SELECT * INTO prior FROM public.sandy_database_maintenance_schedule_receipts WHERE admission_id=(p->>'admission_id')::uuid;
 IF FOUND THEN RETURN jsonb_build_object('ok',true,'result',prior.result,'reused',true);END IF;
 IF to_regprocedure('cron.schedule(text,text,text)') IS NULL OR to_regprocedure('cron.alter_job(bigint,text,text,text,text,boolean)') IS NULL THEN
  RETURN jsonb_build_object('ok',false,'error','maintenance_pg_cron_entitlement_unavailable','http_status',424);END IF;
 args:=p->'arguments';plan:=p->'plan';standing:=p->'standing';
 expiry:=(standing->>'expires_at')::timestamptz;max_runs:=(standing->>'max_runs')::integer;interval_seconds:=(standing->>'min_interval_seconds')::integer;max_rows:=(standing->>'max_affected_rows')::integer;
 IF expiry IS NULL OR expiry<=clock_timestamp() OR expiry>clock_timestamp()+interval '24 hours'
  OR max_runs IS NULL OR max_runs NOT BETWEEN 1 AND 100 OR interval_seconds IS NULL OR interval_seconds NOT BETWEEN 60 AND 86400
  OR max_rows IS NULL OR max_rows NOT BETWEEN 1 AND 100 OR standing-'max_affected_rows' IS DISTINCT FROM args->'standing'
  OR max_rows IS DISTINCT FROM (args->'command'->>'max_affected_rows')::integer
  OR args->>'schedule' IS NULL OR args->>'schedule' !~ '^[0-9*/,\-]+ [0-9*/,\-]+ [0-9*/,\-]+ [0-9*/,\-]+ [0-9*/,\-]+$'
  OR length(args->>'schedule')>100 OR plan->>'canonical' IS NULL
  OR (plan->>'canonical')::jsonb IS DISTINCT FROM plan-'canonical'-'sha256'
  OR encode(extensions.digest(plan->>'canonical','sha256'),'hex') IS DISTINCT FROM plan->>'sha256'
  OR coalesce(plan->'statement'->>'mode','') NOT IN('dml','query')
  OR jsonb_typeof(plan->'verifications') IS DISTINCT FROM 'array'
  OR jsonb_array_length(plan->'verifications') NOT BETWEEN 1 AND 5 THEN RAISE EXCEPTION 'maintenance_standing_plan_invalid';END IF;
 PERFORM public.sandy_api_maintenance_lock_plan(plan);
 desired_active:=coalesce((args->>'active')::boolean,true);
 IF p->>'operation'='supabase.database.cron.jobs.create' THEN
  label:=args->>'name';
  INSERT INTO public.sandy_database_maintenance_schedules(actor_id) VALUES((p->>'actor_id')::uuid) RETURNING * INTO s;
 ELSE
  SELECT * INTO s FROM public.sandy_database_maintenance_schedules WHERE id=(args->>'schedule_id')::uuid FOR UPDATE;
  IF NOT FOUND OR s.actor_id IS DISTINCT FROM (p->>'actor_id')::uuid OR s.revision IS DISTINCT FROM (args->>'expected_revision')::integer THEN RAISE EXCEPTION 'maintenance_schedule_revision_conflict';END IF;
  SELECT coalesce(args->>'name',v.label) INTO label FROM public.sandy_database_maintenance_schedule_versions v WHERE schedule_id=s.id AND revision=s.revision;
  s.revision:=s.revision+1;
 END IF;
 IF label IS NULL OR length(label) NOT BETWEEN 1 AND 120 THEN RAISE EXCEPTION 'maintenance_schedule_label_invalid';END IF;
 IF desired_active AND (SELECT count(*) FROM public.sandy_database_maintenance_schedules WHERE actor_id=s.actor_id AND active AND id<>s.id)>=10 THEN RAISE EXCEPTION 'maintenance_actor_schedule_limit';END IF;
 INSERT INTO public.sandy_database_maintenance_schedule_versions(schedule_id,revision,admission_id,context,label,schedule,plan,plan_sha256,expires_at,max_runs,min_interval_seconds,max_affected_rows)
 VALUES(s.id,s.revision,(p->>'admission_id')::uuid,p,label,args->>'schedule',plan,plan->>'sha256',expiry,max_runs,interval_seconds,max_rows);
 wrapper:=format('SET statement_timeout = ''15s''; SET lock_timeout = ''3s''; SET search_path = pg_catalog; SELECT public.sandy_api_maintenance_cron_run(%L::uuid)',s.id::text);
 IF s.cron_job_id IS NULL THEN
  EXECUTE 'SELECT cron.schedule($1,$2,$3)' INTO job_id USING 'sandy-maintenance-'||s.id::text,args->>'schedule',wrapper;
 ELSE
  job_id:=s.cron_job_id;
  EXECUTE 'SELECT cron.alter_job($1,schedule := $2,command := $3,active := $4)' USING job_id,args->>'schedule',wrapper,desired_active;
 END IF;
 IF NOT desired_active THEN PERFORM public.sandy_api_maintenance_cron_pause(job_id);END IF;
 UPDATE public.sandy_database_maintenance_schedules SET cron_job_id=job_id,revision=s.revision,active=desired_active,runs=0,last_run_at=NULL,updated_at=clock_timestamp() WHERE id=s.id;
 receipt:=public.sandy_api_maintenance_schedule_projection(s.id);
 INSERT INTO public.sandy_database_maintenance_schedule_receipts VALUES((p->>'admission_id')::uuid,(p->>'actor_id')::uuid,(p->>'request_id')::uuid,receipt,clock_timestamp());
 RETURN jsonb_build_object('ok',true,'result',receipt,'reused',false);
EXCEPTION WHEN OTHERS THEN RETURN jsonb_build_object('ok',false,'error',CASE WHEN SQLERRM IN('maintenance_standing_plan_invalid','maintenance_operation_invalid','maintenance_schedule_revision_conflict','maintenance_schedule_label_invalid','maintenance_actor_schedule_limit','maintenance_hidden_relation_effect_refused','maintenance_plain_public_relations_required','database_protected_object_refused','database_sensitive_source_refused','database_passive_relation_required') THEN SQLERRM ELSE 'maintenance_schedule_write_failed' END,'http_status',409);END $$;

CREATE FUNCTION public.sandy_api_maintenance_cron_run(p_schedule_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE s public.sandy_database_maintenance_schedules%ROWTYPE;v public.sandy_database_maintenance_schedule_versions%ROWTYPE;
 run_id uuid;rate_window_start timestamptz;rate_requests integer;rate_units bigint;statement jsonb;verification jsonb;rows jsonb;row_json jsonb;row_record record;
 affected bigint;returned_rows bigint;result_hash text;failure text;receipt jsonb;
BEGIN
 IF coalesce((SELECT setting::integer FROM pg_settings WHERE name='statement_timeout'),0) NOT BETWEEN 1 AND 15000
  OR coalesce((SELECT setting::integer FROM pg_settings WHERE name='lock_timeout'),0) NOT BETWEEN 1 AND 3000 THEN
  RETURN jsonb_build_object('ok',false,'error','maintenance_server_deadline_required');END IF;
 SELECT * INTO s FROM public.sandy_database_maintenance_schedules WHERE id=p_schedule_id FOR UPDATE SKIP LOCKED;
 IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'error','maintenance_schedule_busy_or_absent');END IF;
 SELECT * INTO v FROM public.sandy_database_maintenance_schedule_versions WHERE schedule_id=s.id AND revision=s.revision;
 IF NOT s.active THEN RETURN jsonb_build_object('ok',false,'error','maintenance_schedule_paused');END IF;
 IF v.expires_at<=clock_timestamp() OR s.runs>=v.max_runs OR NOT public.sandy_api_maintenance_standing_authorized(v.context) THEN
  UPDATE public.sandy_database_maintenance_schedules SET active=false,updated_at=clock_timestamp() WHERE id=s.id;
  PERFORM public.sandy_api_maintenance_cron_pause(s.cron_job_id);
  PERFORM public.sandy_api_append_audit(s.actor_id,v.context->>'operation',(v.context->>'request_id')::uuid,NULL,v.admission_id,'scheduled_owner_authorization','rejected',v.context->>'input_sha256');
  RETURN jsonb_build_object('ok',false,'error','maintenance_standing_authorization_expired_or_changed');END IF;
 IF s.last_run_at IS NOT NULL AND s.last_run_at+make_interval(secs=>v.min_interval_seconds)>clock_timestamp() THEN RETURN jsonb_build_object('ok',false,'error','maintenance_minimum_interval');END IF;
 rate_window_start:=date_trunc('minute',clock_timestamp());
 INSERT INTO public.sandy_api_rate_windows VALUES(s.actor_id,'principal',rate_window_start,0,0) ON CONFLICT DO NOTHING;
 SELECT w.requests,w.declared_units INTO rate_requests,rate_units FROM public.sandy_api_rate_windows w WHERE w.actor_id=s.actor_id AND w.bucket='principal' AND w.window_start=rate_window_start FOR UPDATE;
 IF rate_requests>=60 OR rate_units+1>1000000 THEN RETURN jsonb_build_object('ok',false,'error','maintenance_principal_rate_limit');END IF;
 UPDATE public.sandy_api_rate_windows w SET requests=w.requests+1,declared_units=w.declared_units+1 WHERE w.actor_id=s.actor_id AND w.bucket='principal' AND w.window_start=rate_window_start;
 INSERT INTO public.sandy_database_maintenance_cron_runs(schedule_id,revision,run_number,state) VALUES(s.id,s.revision,s.runs+1,'running') RETURNING id INTO run_id;
 UPDATE public.sandy_database_maintenance_schedules SET runs=runs+1,last_run_at=clock_timestamp(),updated_at=clock_timestamp() WHERE id=s.id;
 PERFORM public.sandy_api_append_audit(s.actor_id,v.context->>'operation',(v.context->>'request_id')::uuid,NULL,v.admission_id,'scheduled_owner_authorization','admitted',v.context->>'input_sha256');
 BEGIN
  IF (v.plan->>'canonical')::jsonb IS DISTINCT FROM v.plan-'canonical'-'sha256' OR encode(extensions.digest(v.plan->>'canonical','sha256'),'hex') IS DISTINCT FROM v.plan_sha256 THEN RAISE EXCEPTION 'maintenance_plan_integrity_failed';END IF;
  PERFORM public.sandy_api_maintenance_lock_plan(v.plan);
  statement:=v.plan->'statement';
  -- Compiler admits exactly one DML statement with RETURNING. Counting its CTE
  -- result bounds effects before the containing subtransaction can commit.
  IF statement->>'mode'='dml' THEN
   EXECUTE 'WITH sandy_maintenance_effect AS ('||(statement->>'sql')||E'\n) SELECT count(*) FROM sandy_maintenance_effect' INTO affected USING statement->'parameters';
  ELSE
   EXECUTE 'SELECT count(*) FROM ('||(statement->>'sql')||E'\n) sandy_maintenance_query' INTO returned_rows USING statement->'parameters';
   IF returned_rows>100 THEN RAISE EXCEPTION 'maintenance_result_limit_or_sensitive';END IF;
   affected:=0;
  END IF;
  IF affected>v.max_affected_rows THEN RAISE EXCEPTION 'maintenance_affected_row_limit';END IF;
  FOR verification IN SELECT value FROM jsonb_array_elements(v.plan->'verifications') LOOP
   rows:='[]';
   FOR row_record IN EXECUTE verification->>'sql' USING verification->'parameters' LOOP
    row_json:=to_jsonb(row_record);
    IF jsonb_array_length(rows)>=100 OR NOT public.sandy_api_database_result_safe(row_json) THEN RAISE EXCEPTION 'maintenance_result_limit_or_sensitive';END IF;
    rows:=rows||jsonb_build_array(row_json);
    IF octet_length(rows::text)>131072 THEN RAISE EXCEPTION 'maintenance_result_size_limit';END IF;
   END LOOP;
   IF rows IS DISTINCT FROM verification->'expected_rows' THEN RAISE EXCEPTION 'maintenance_postcondition_failed';END IF;
  END LOOP;
  receipt:=jsonb_build_object('run_id',run_id,'schedule_id',s.id,'revision',s.revision,'affected_rows',affected,'verification_passed',true,'command_sha256',v.plan_sha256);
  result_hash:=encode(extensions.digest(receipt::text,'sha256'),'hex');
 EXCEPTION WHEN query_canceled THEN
  -- OTHERS deliberately excludes query_canceled in PostgreSQL. A real server
  -- statement deadline must also roll back effects and permanently pause this
  -- schedule instead of silently allowing the scheduler to retry next minute.
  failure:='maintenance_command_timeout';
 WHEN OTHERS THEN
  failure:=CASE WHEN SQLERRM IN('maintenance_plan_integrity_failed','maintenance_affected_row_limit','maintenance_result_limit_or_sensitive','maintenance_result_size_limit','maintenance_postcondition_failed','maintenance_hidden_relation_effect_refused','maintenance_plain_public_relations_required','database_protected_object_refused','database_sensitive_source_refused','database_passive_relation_required') THEN SQLERRM ELSE 'maintenance_command_failed' END;
 END;
 IF failure IS NOT NULL THEN
  UPDATE public.sandy_database_maintenance_cron_runs SET state='failed',finished_at=clock_timestamp(),error_code=failure WHERE id=run_id;
  UPDATE public.sandy_database_maintenance_schedules SET active=false,updated_at=clock_timestamp() WHERE id=s.id;
  PERFORM public.sandy_api_maintenance_cron_pause(s.cron_job_id);
  PERFORM public.sandy_api_append_audit(s.actor_id,v.context->>'operation',(v.context->>'request_id')::uuid,NULL,v.admission_id,'scheduled_execution','failed',v.context->>'input_sha256');
  RETURN jsonb_build_object('ok',false,'error',failure,'paused',true,'run_id',run_id);END IF;
 UPDATE public.sandy_database_maintenance_cron_runs SET state='observed',finished_at=clock_timestamp(),affected_rows=affected,result_sha256=result_hash WHERE id=run_id;
 IF s.runs+1>=v.max_runs THEN
  UPDATE public.sandy_database_maintenance_schedules SET active=false,updated_at=clock_timestamp() WHERE id=s.id;
  PERFORM public.sandy_api_maintenance_cron_pause(s.cron_job_id);
 END IF;
 PERFORM public.sandy_api_append_audit(s.actor_id,v.context->>'operation',(v.context->>'request_id')::uuid,NULL,v.admission_id,'scheduled_execution','observed',v.context->>'input_sha256',result_hash);
 RETURN jsonb_build_object('ok',true,'result',receipt);
END $$;
CREATE FUNCTION public.sandy_api_maintenance_receipt(p jsonb) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE permission jsonb;receipt jsonb;
BEGIN
 permission:=public.sandy_api_database_authorize(p);IF permission->>'ok'<>'true' THEN RETURN permission;END IF;
 IF p->>'operation' IS DISTINCT FROM 'supabase.database.maintenance.receipt.get' THEN RETURN jsonb_build_object('ok',false,'error','maintenance_receipt_context_invalid','http_status',403);END IF;
 SELECT c.result INTO receipt FROM public.sandy_database_maintenance_commands c WHERE c.actor_id=(p->>'actor_id')::uuid AND c.request_id=(p->'arguments'->>'request_id')::uuid;
 IF receipt IS NULL THEN SELECT r.result INTO receipt FROM public.sandy_database_maintenance_schedule_receipts r WHERE r.actor_id=(p->>'actor_id')::uuid AND r.request_id=(p->'arguments'->>'request_id')::uuid;END IF;
 RETURN jsonb_build_object('ok',true,'result',receipt);
EXCEPTION WHEN invalid_text_representation THEN RETURN jsonb_build_object('ok',false,'error','maintenance_receipt_context_invalid','http_status',403);END $$;

-- Supabase default privileges may grant newly created objects to app roles.
-- Revoke explicitly after every function exists, including internal helpers.
DO $$ DECLARE f record; BEGIN
 FOR f IN SELECT p.oid::regprocedure AS signature FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='public' AND p.proname LIKE 'sandy_api_maintenance_%' LOOP
  EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon,authenticated,service_role',f.signature);
 END LOOP;
END $$;

-- SANDY_MAINTENANCE_REGISTRY_ROWS: generated contract rows are appended here.
-- Supersede only known disabled v1 maintenance contracts. A verified or
-- differently installed contract requires a separate reviewed cutover.
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM public.sandy_operation_registry WHERE (operation='supabase.database.vacuum' AND (handler IS DISTINCT FROM 'sandy-database-operation-api' OR api_exposed IS DISTINCT FROM false OR verified IS DISTINCT FROM false OR error_contract->>'contract_sha256' IS NULL OR error_contract->>'contract_sha256' NOT IN('d00c9ab758fd7ac583d2ca50799e333af71a4d26f3efb5e2d35af70f0fcd819b','30804bb4a0b46cd264ddc7b58453a8cd65e44ff5f489fdb92fe81a75961ce0c1'))) OR (operation='supabase.database.cron.jobs.create' AND (handler IS DISTINCT FROM 'sandy-database-operation-api' OR api_exposed IS DISTINCT FROM false OR verified IS DISTINCT FROM false OR error_contract->>'contract_sha256' IS NULL OR error_contract->>'contract_sha256' NOT IN('f27817e4080ccf1a7c4e80b76fe118c4eab593e20e6ae4eba9fe41dea9a38077','1260b7fb145d663d0c73ee42eb5809beb6d462775689be678850c7b5c90363b2'))) OR (operation='supabase.database.cron.jobs.update' AND (handler IS DISTINCT FROM 'sandy-database-operation-api' OR api_exposed IS DISTINCT FROM false OR verified IS DISTINCT FROM false OR error_contract->>'contract_sha256' IS NULL OR error_contract->>'contract_sha256' NOT IN('b4b94ecf6a12c4a17146b1fae55d52bdae24c1c6c4a13ec8112121b223957a8b','9b734f0350e0c56744f82202c01710d3bc185267880dd71ca44a2cafb2a098e7'))) OR (operation='supabase.database.maintenance.receipt.get' AND (handler IS DISTINCT FROM 'sandy-database-operation-api' OR api_exposed IS DISTINCT FROM false OR verified IS DISTINCT FROM false OR error_contract->>'contract_sha256' IS NULL OR error_contract->>'contract_sha256' NOT IN('31f43facdc91439d2d288c78c559c074d2e0912c34d474223aea3e5c6291f64e')))) THEN
  RAISE EXCEPTION 'maintenance_contract_cutover_conflict';
 END IF;
END $$;
INSERT INTO public.sandy_operation_registry(operation,domain,description,permission_scope,is_mutation,input_schema,output_schema,handler,api_exposed,ui_exposed,ai_exposed,verified,implementation_state,source_repository,source_path,dependencies,retry_policy,rollback_policy,error_contract) VALUES
 ('supabase.database.vacuum','supabase','Run one table VACUUM outside a transaction over an explicitly configured, certificate-verified direct project PostgreSQL session with server deadlines. Record command completion separately from pg_stat readback; no automatic retry or invented HTTP status. Contract v2.0.0.','infrastructure:write',true,'{"type":"object","properties":{"table":{"type":"string","pattern":"^[a-z_][a-z0-9_]{0,62}$"},"analyze":{"type":"boolean"},"freeze":{"type":"boolean"}},"required":["table"],"additionalProperties":false}'::jsonb,'{"type":"object","properties":{"ok":{"const":true},"operation":{"const":"supabase.database.vacuum"},"contract_version":{"const":"2.0.0"},"provider":{"const":"supabase"},"project_ref":{"const":"zmqlyygzqoidkcwdysok"},"provider_protocol":{"enum":["postgres","management_https"]},"provider_http_status":{"type":["integer","null"],"minimum":100,"maximum":599},"admission_id":{"type":"string","format":"uuid"},"request_state":{"enum":["accepted","observed"]},"executed":{"const":true},"result":{"type":"object","maxProperties":50}},"required":["ok","operation","contract_version","provider","project_ref","provider_protocol","provider_http_status","admission_id","request_state","executed","result"],"additionalProperties":false}'::jsonb,'sandy-database-operation-api',false,false,false,false,'source_ready','ausstyle/web-staging','supabase/functions/sandy-database-operation-api/index.ts','["enabled_controller_owner","normal_owner_session","exact_one_use_scoped_approval","verified_contract","sandy_api_access_audit_schema","sandy_database_maintenance_schema","runtime_provider_egress","SANDY_DATABASE_MAINTENANCE_URL_fixed_project_direct_verified_TLS"]'::jsonb,'{"automatic":false,"safe_to_retry":false,"unknown_outcome":"Reconcile owned durable receipt using a fresh read grant"}'::jsonb,'{"automatic":false,"vacuum":"Maintenance effects cannot be rolled back","cron":"Run effects and postconditions atomic; failed schedule paused"}'::jsonb,'{"version":"2.0.0","contract_sha256":"d00c9ab758fd7ac583d2ca50799e333af71a4d26f3efb5e2d35af70f0fcd819b","requires_grant":true,"requires_approval":true,"api_key_delegable":false,"sensitive_response":true,"requirement":98,"scope":{"provider":"supabase","project_ref":"zmqlyygzqoidkcwdysok","database":"postgres","schema":"public"},"execution":"One reserved certificate-verified direct PostgreSQL session; VACUUM outside transaction; private exact-proof native finalizer with NULL HTTP status","unknown_outcome":"Fresh approved supabase.database.maintenance.receipt.get; no automatic redispatch","provider_verification":"Not established by source installation or component tests; registry stays disabled and unverified","configuration_dependency":"SANDY_DATABASE_MAINTENANCE_URL","readback":"Actual pg_stat_all_tables before/after when available; accepted and unverified otherwise"}'::jsonb),
 ('supabase.database.cron.jobs.create','supabase','Create a guarded pg_cron wrapper with exact approved command and finite revocable standing authorization. Every run rechecks owner, contract, approval, schema and shared rate limits, with atomic postconditions and no retry after failure. Contract v2.0.0.','infrastructure:write',true,'{"type":"object","properties":{"name":{"type":"string","minLength":1,"maxLength":120},"schedule":{"type":"string","minLength":9,"maxLength":100,"pattern":"^[0-9*/,-]+ [0-9*/,-]+ [0-9*/,-]+ [0-9*/,-]+ [0-9*/,-]+$"},"command":{"type":"object","properties":{"sql":{"type":"string","minLength":1,"maxLength":4096},"parameters":{"type":"array","maxItems":32,"items":{"type":"object","properties":{"type":{"enum":["text","int4","int8","numeric","bool","uuid","timestamptz","date","jsonb"]},"value":{}},"required":["type","value"],"additionalProperties":false}},"max_affected_rows":{"type":"integer","minimum":1,"maximum":100},"verifications":{"type":"array","minItems":1,"maxItems":5,"items":{"type":"object","properties":{"sql":{"type":"string","minLength":1,"maxLength":4096},"parameters":{"type":"array","maxItems":32,"items":{"type":"object","properties":{"type":{"enum":["text","int4","int8","numeric","bool","uuid","timestamptz","date","jsonb"]},"value":{}},"required":["type","value"],"additionalProperties":false}},"expected_rows":{"type":"array","maxItems":100,"items":{"type":"object","maxProperties":100}}},"required":["sql","expected_rows"],"additionalProperties":false}}},"required":["sql","max_affected_rows","verifications"],"additionalProperties":false},"standing":{"type":"object","properties":{"expires_at":{"type":"string","format":"date-time"},"max_runs":{"type":"integer","minimum":1,"maximum":100},"min_interval_seconds":{"type":"integer","minimum":60,"maximum":86400}},"required":["expires_at","max_runs","min_interval_seconds"],"additionalProperties":false}},"required":["name","schedule","command","standing"],"additionalProperties":false}'::jsonb,'{"type":"object","properties":{"ok":{"const":true},"operation":{"const":"supabase.database.cron.jobs.create"},"contract_version":{"const":"2.0.0"},"provider":{"const":"supabase"},"project_ref":{"const":"zmqlyygzqoidkcwdysok"},"provider_protocol":{"enum":["postgres","management_https"]},"provider_http_status":{"type":["integer","null"],"minimum":100,"maximum":599},"admission_id":{"type":"string","format":"uuid"},"request_state":{"enum":["accepted","observed"]},"executed":{"const":true},"result":{"type":"object","maxProperties":50}},"required":["ok","operation","contract_version","provider","project_ref","provider_protocol","provider_http_status","admission_id","request_state","executed","result"],"additionalProperties":false}'::jsonb,'sandy-database-operation-api',false,false,false,false,'source_ready','ausstyle/web-staging','supabase/functions/sandy-database-operation-api/index.ts','["enabled_controller_owner","normal_owner_session","exact_one_use_scoped_approval","verified_contract","sandy_api_access_audit_schema","sandy_database_maintenance_schema","runtime_provider_egress","supabase_management_consumer","sandy_credential_consumer_schema","existing_pg_cron_extension","finite_explicit_standing_approval","passive_plain_public_relations"]'::jsonb,'{"automatic":false,"safe_to_retry":false,"unknown_outcome":"Reconcile owned durable receipt using a fresh read grant"}'::jsonb,'{"automatic":false,"vacuum":"Maintenance effects cannot be rolled back","cron":"Run effects and postconditions atomic; failed schedule paused"}'::jsonb,'{"version":"2.0.0","contract_sha256":"f27817e4080ccf1a7c4e80b76fe118c4eab593e20e6ae4eba9fe41dea9a38077","requires_grant":true,"requires_approval":true,"api_key_delegable":false,"sensitive_response":true,"requirement":101,"scope":{"provider":"supabase","project_ref":"zmqlyygzqoidkcwdysok","database":"postgres","schema":"public"},"execution":"Fixed-project Management RPC after consumed exact owner grant and current credential consumer resolution","unknown_outcome":"Fresh approved supabase.database.maintenance.receipt.get; no automatic redispatch","provider_verification":"Not established by source installation or component tests; registry stays disabled and unverified","standing_authorization":"Exact immutable approved command; <=24h, <=100 runs, >=60s interval, <=100 affected rows, <=10 active schedules per owner; each run rechecks current owner, registry revision, approval, schema and shared principal quotas","failure":"Atomic SQL effects/postcondition/audit; pause on first failure, no automatic retry","provider_dependency":"Existing pg_cron; no automatic extension installation"}'::jsonb),
 ('supabase.database.cron.jobs.update','supabase','Replace an owned guarded schedule at its expected revision using a fresh exact approval and complete finite standing policy. Ordinary or foreign pg_cron jobs cannot be adopted. Contract v2.0.0.','infrastructure:write',true,'{"type":"object","properties":{"schedule_id":{"type":"string","format":"uuid"},"expected_revision":{"type":"integer","minimum":1},"name":{"type":"string","minLength":1,"maxLength":120},"schedule":{"type":"string","minLength":9,"maxLength":100,"pattern":"^[0-9*/,-]+ [0-9*/,-]+ [0-9*/,-]+ [0-9*/,-]+ [0-9*/,-]+$"},"command":{"type":"object","properties":{"sql":{"type":"string","minLength":1,"maxLength":4096},"parameters":{"type":"array","maxItems":32,"items":{"type":"object","properties":{"type":{"enum":["text","int4","int8","numeric","bool","uuid","timestamptz","date","jsonb"]},"value":{}},"required":["type","value"],"additionalProperties":false}},"max_affected_rows":{"type":"integer","minimum":1,"maximum":100},"verifications":{"type":"array","minItems":1,"maxItems":5,"items":{"type":"object","properties":{"sql":{"type":"string","minLength":1,"maxLength":4096},"parameters":{"type":"array","maxItems":32,"items":{"type":"object","properties":{"type":{"enum":["text","int4","int8","numeric","bool","uuid","timestamptz","date","jsonb"]},"value":{}},"required":["type","value"],"additionalProperties":false}},"expected_rows":{"type":"array","maxItems":100,"items":{"type":"object","maxProperties":100}}},"required":["sql","expected_rows"],"additionalProperties":false}}},"required":["sql","max_affected_rows","verifications"],"additionalProperties":false},"standing":{"type":"object","properties":{"expires_at":{"type":"string","format":"date-time"},"max_runs":{"type":"integer","minimum":1,"maximum":100},"min_interval_seconds":{"type":"integer","minimum":60,"maximum":86400}},"required":["expires_at","max_runs","min_interval_seconds"],"additionalProperties":false},"active":{"type":"boolean"}},"required":["schedule_id","expected_revision","schedule","command","standing"],"additionalProperties":false}'::jsonb,'{"type":"object","properties":{"ok":{"const":true},"operation":{"const":"supabase.database.cron.jobs.update"},"contract_version":{"const":"2.0.0"},"provider":{"const":"supabase"},"project_ref":{"const":"zmqlyygzqoidkcwdysok"},"provider_protocol":{"enum":["postgres","management_https"]},"provider_http_status":{"type":["integer","null"],"minimum":100,"maximum":599},"admission_id":{"type":"string","format":"uuid"},"request_state":{"enum":["accepted","observed"]},"executed":{"const":true},"result":{"type":"object","maxProperties":50}},"required":["ok","operation","contract_version","provider","project_ref","provider_protocol","provider_http_status","admission_id","request_state","executed","result"],"additionalProperties":false}'::jsonb,'sandy-database-operation-api',false,false,false,false,'source_ready','ausstyle/web-staging','supabase/functions/sandy-database-operation-api/index.ts','["enabled_controller_owner","normal_owner_session","exact_one_use_scoped_approval","verified_contract","sandy_api_access_audit_schema","sandy_database_maintenance_schema","runtime_provider_egress","supabase_management_consumer","sandy_credential_consumer_schema","existing_pg_cron_extension","finite_explicit_standing_approval","passive_plain_public_relations"]'::jsonb,'{"automatic":false,"safe_to_retry":false,"unknown_outcome":"Reconcile owned durable receipt using a fresh read grant"}'::jsonb,'{"automatic":false,"vacuum":"Maintenance effects cannot be rolled back","cron":"Run effects and postconditions atomic; failed schedule paused"}'::jsonb,'{"version":"2.0.0","contract_sha256":"b4b94ecf6a12c4a17146b1fae55d52bdae24c1c6c4a13ec8112121b223957a8b","requires_grant":true,"requires_approval":true,"api_key_delegable":false,"sensitive_response":true,"requirement":101,"scope":{"provider":"supabase","project_ref":"zmqlyygzqoidkcwdysok","database":"postgres","schema":"public"},"execution":"Fixed-project Management RPC after consumed exact owner grant and current credential consumer resolution","unknown_outcome":"Fresh approved supabase.database.maintenance.receipt.get; no automatic redispatch","provider_verification":"Not established by source installation or component tests; registry stays disabled and unverified","standing_authorization":"Exact immutable approved command; <=24h, <=100 runs, >=60s interval, <=100 affected rows, <=10 active schedules per owner; each run rechecks current owner, registry revision, approval, schema and shared principal quotas","failure":"Atomic SQL effects/postcondition/audit; pause on first failure, no automatic retry","provider_dependency":"Existing pg_cron; no automatic extension installation"}'::jsonb),
 ('supabase.database.maintenance.receipt.get','supabase','Read an owned maintenance receipt under a fresh verified owner read approval, without repeating an expired or unknown native command or exposing private leases, connection credentials or SQL. Contract v2.0.0.','infrastructure:read',false,'{"type":"object","properties":{"request_id":{"type":"string","format":"uuid"}},"required":["request_id"],"additionalProperties":false}'::jsonb,'{"type":"object","properties":{"ok":{"const":true},"operation":{"const":"supabase.database.maintenance.receipt.get"},"contract_version":{"const":"2.0.0"},"provider":{"const":"supabase"},"project_ref":{"const":"zmqlyygzqoidkcwdysok"},"provider_protocol":{"enum":["postgres","management_https"]},"provider_http_status":{"type":["integer","null"],"minimum":100,"maximum":599},"admission_id":{"type":"string","format":"uuid"},"request_state":{"enum":["accepted","observed"]},"executed":{"const":true},"result":{"type":"object","maxProperties":50}},"required":["ok","operation","contract_version","provider","project_ref","provider_protocol","provider_http_status","admission_id","request_state","executed","result"],"additionalProperties":false}'::jsonb,'sandy-database-operation-api',false,false,false,false,'source_ready','ausstyle/web-staging','supabase/functions/sandy-database-operation-api/index.ts','["enabled_controller_owner","normal_owner_session","exact_one_use_scoped_approval","verified_contract","sandy_api_access_audit_schema","sandy_database_maintenance_schema","runtime_provider_egress","supabase_management_consumer","sandy_credential_consumer_schema"]'::jsonb,'{"automatic":false,"safe_to_retry":false,"unknown_outcome":"Reconcile owned durable receipt using a fresh read grant"}'::jsonb,'{"automatic":false,"vacuum":"Maintenance effects cannot be rolled back","cron":"Run effects and postconditions atomic; failed schedule paused"}'::jsonb,'{"version":"2.0.0","contract_sha256":"31f43facdc91439d2d288c78c559c074d2e0912c34d474223aea3e5c6291f64e","requires_grant":true,"requires_approval":true,"api_key_delegable":false,"sensitive_response":true,"requirement":98,"scope":{"provider":"supabase","project_ref":"zmqlyygzqoidkcwdysok","database":"postgres","schema":"public"},"execution":"Fixed-project Management RPC after consumed exact owner grant and current credential consumer resolution","unknown_outcome":"Fresh approved supabase.database.maintenance.receipt.get; no automatic redispatch","provider_verification":"Not established by source installation or component tests; registry stays disabled and unverified"}'::jsonb)
ON CONFLICT(operation) DO UPDATE SET description=EXCLUDED.description,permission_scope=EXCLUDED.permission_scope,is_mutation=EXCLUDED.is_mutation,input_schema=EXCLUDED.input_schema,output_schema=EXCLUDED.output_schema,handler=EXCLUDED.handler,api_exposed=false,ui_exposed=false,ai_exposed=false,verified=false,implementation_state=EXCLUDED.implementation_state,source_repository=EXCLUDED.source_repository,source_path=EXCLUDED.source_path,dependencies=EXCLUDED.dependencies,retry_policy=EXCLUDED.retry_policy,rollback_policy=EXCLUDED.rollback_policy,error_contract=EXCLUDED.error_contract,updated_at=clock_timestamp();
COMMIT;
