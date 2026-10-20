-- Additive durable orchestration. Queue admission is never provider execution.
-- Initial delegation is owner-authorized infrastructure reads only. Customer JWTs
-- are never persisted. Provider dispatch stays in Sandy API's governed executor.
BEGIN;
CREATE TABLE public.sandy_orch_delegated_operations (
  operation text PRIMARY KEY,
  handler text NOT NULL CHECK (handler IN ('sandy-provider-read-api','sandy-infrastructure-read')),
  enabled boolean NOT NULL DEFAULT true
);
INSERT INTO public.sandy_orch_delegated_operations(operation,handler)
SELECT operation,handler FROM public.sandy_operation_registry
WHERE operation IN (
 'supabase.functions.list','supabase.functions.get','supabase.project.status',
 'system.registry.list','system.registry.describe','system.registry.summary',
 'deployment.jobs.get','deployment.jobs.list','deployment.jobs.events','deployment.audit.list',
 'engineering.changes.list','engineering.change.detail','engineering.change.events','engineering.change.tests','engineering.change.artifacts',
 'supabase.db.migrations.list','supabase.database.inspect','supabase.schema.tables.list','supabase.schema.functions.list','supabase.schema.indexes.list',
 'supabase.database.connections.list','supabase.schema.views.list','supabase.schema.materialized_views.list','supabase.schema.triggers.list',
 'supabase.schema.constraints.list','supabase.schema.types.list','supabase.schema.extensions.list','supabase.database.roles.list',
 'supabase.database.grants.list','supabase.database.default_privileges.list','supabase.database.rls.policies.list','supabase.database.locks.list',
 'supabase.database.cron.jobs.list','supabase.projects.get','supabase.project.health','supabase.branches.list','supabase.branches.get',
 'supabase.network.restrictions.get','supabase.domains.get','supabase.functions.secrets.list','supabase.backups.list'
) AND handler IN ('sandy-provider-read-api','sandy-infrastructure-read') AND is_mutation=false;

CREATE TABLE public.sandy_orch_plans (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), actor_id uuid NOT NULL,
 tenant_id uuid CHECK (tenant_id IS NULL),
 admission_kind text NOT NULL CHECK(admission_kind IN ('operation','plan')),
 idempotency_key text NOT NULL CHECK(idempotency_key ~ '^[A-Za-z0-9:_-]{12,128}$'),
 request_sha256 text NOT NULL CHECK(request_sha256 ~ '^[a-f0-9]{64}$'),
 request_document jsonb NOT NULL CHECK(jsonb_typeof(request_document)='array'),
 channel text NOT NULL CHECK(channel IN ('api','mcp')),
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(actor_id,admission_kind,idempotency_key)
);
CREATE TABLE public.sandy_orch_jobs (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), plan_id uuid NOT NULL REFERENCES public.sandy_orch_plans(id) ON DELETE RESTRICT,
 step_key text NOT NULL CHECK(step_key ~ '^[a-z][a-z0-9_-]{0,63}$'), actor_id uuid NOT NULL,
 tenant_id uuid CHECK(tenant_id IS NULL), operation text NOT NULL,
 registry_revision text NOT NULL CHECK(registry_revision ~ '^[a-f0-9]{64}$'),
 input_sha256 text NOT NULL CHECK(input_sha256 ~ '^[a-f0-9]{64}$'),
 handler text NOT NULL, permission_scope text NOT NULL, is_mutation boolean NOT NULL CHECK(is_mutation=false),
 input_schema jsonb NOT NULL, output_schema jsonb NOT NULL, arguments jsonb NOT NULL CHECK(jsonb_typeof(arguments)='object'),
 channel text NOT NULL CHECK(channel IN ('api','mcp')),
 state text NOT NULL DEFAULT 'queued' CHECK(state IN ('queued','leased','running','succeeded','failed','cancelled','blocked','needs_reconciliation','dead_letter')),
 result jsonb, error_code text, attempts integer NOT NULL DEFAULT 0 CHECK(attempts BETWEEN 0 AND 5),
 max_attempts integer NOT NULL DEFAULT 3 CHECK(max_attempts BETWEEN 1 AND 5),
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 started_at timestamptz, finished_at timestamptz,
 UNIQUE(plan_id,step_key)
);
CREATE TABLE public.sandy_orch_dependencies (
 job_id uuid NOT NULL REFERENCES public.sandy_orch_jobs(id) ON DELETE RESTRICT,
 depends_on uuid NOT NULL REFERENCES public.sandy_orch_jobs(id) ON DELETE RESTRICT,
 PRIMARY KEY(job_id,depends_on), CHECK(job_id<>depends_on)
);
CREATE TABLE public.sandy_orch_outbox (
 job_id uuid PRIMARY KEY REFERENCES public.sandy_orch_jobs(id) ON DELETE RESTRICT,
 available_at timestamptz NOT NULL DEFAULT now(),
 worker_id uuid, lease_token uuid, lease_until timestamptz,
 CHECK ((worker_id IS NULL AND lease_token IS NULL AND lease_until IS NULL) OR
        (worker_id IS NOT NULL AND lease_token IS NOT NULL AND lease_until IS NOT NULL))
);
CREATE INDEX sandy_orch_outbox_available_idx ON public.sandy_orch_outbox(available_at,job_id);
CREATE TABLE public.sandy_orch_events (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 job_id uuid NOT NULL REFERENCES public.sandy_orch_jobs(id) ON DELETE RESTRICT,
 event_type text NOT NULL, details jsonb NOT NULL DEFAULT '{}', created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX sandy_orch_events_job_cursor_idx ON public.sandy_orch_events(job_id,id);
CREATE TABLE public.sandy_orch_attempts (
 job_id uuid NOT NULL REFERENCES public.sandy_orch_jobs(id) ON DELETE RESTRICT,
 attempt integer NOT NULL CHECK(attempt>0), lease_token uuid NOT NULL, worker_id uuid NOT NULL,
 dispatch_id uuid NOT NULL DEFAULT gen_random_uuid() UNIQUE,
 started_at timestamptz NOT NULL DEFAULT now(), finished_at timestamptz,
 outcome text, provider_request_id text, result_sha256 text,
 execution_admission_id uuid,
 PRIMARY KEY(job_id,attempt)
);
DO $$ DECLARE table_name text; BEGIN
 FOREACH table_name IN ARRAY ARRAY['sandy_orch_delegated_operations','sandy_orch_plans','sandy_orch_jobs','sandy_orch_dependencies','sandy_orch_outbox','sandy_orch_events','sandy_orch_attempts'] LOOP
  EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',table_name);
  EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC,anon,authenticated,service_role',table_name);
 END LOOP;
END $$;
REVOKE ALL ON SEQUENCE public.sandy_orch_events_id_seq FROM PUBLIC,anon,authenticated,service_role;
-- Data is available only through scoped RPCs; possession of an internal service
-- identity does not allow edits to immutable approval snapshots or lease rows.
CREATE FUNCTION public.sandy_orch_owner(p_actor uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
 SELECT EXISTS(SELECT 1 FROM public.sandy_controller_admins WHERE auth_user_id=p_actor AND enabled=true AND role='owner')
$$;
CREATE FUNCTION public.sandy_orch_revision(p_entry jsonb) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path=pg_catalog,pg_temp AS $$
 SELECT encode(sha256(convert_to((p_entry - ARRAY['description','last_test_result','last_verified_at','updated_at'])::text,'UTF8')),'hex')
$$;
CREATE FUNCTION public.sandy_orch_snapshot(p_operation text,p_channel text) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
 SELECT jsonb_build_object('operation',r.operation,'handler',r.handler,'permission_scope',r.permission_scope,
  'is_mutation',r.is_mutation,'input_schema',r.input_schema,'output_schema',r.output_schema,
  'api_exposed',r.api_exposed,'ai_exposed',r.ai_exposed,'verified',r.verified)
 FROM public.sandy_operation_registry r JOIN public.sandy_orch_delegated_operations d ON d.operation=r.operation AND d.handler=r.handler AND d.enabled
 WHERE r.operation=p_operation AND r.api_exposed=true AND r.is_mutation=false
 AND r.permission_scope IN ('infrastructure:read','deployment:read','engineering:read','system:read')
 AND (p_channel='api' OR (p_channel='mcp' AND r.ai_exposed=true))
$$;
CREATE FUNCTION public.sandy_orch_catalogue(p_actor_id uuid,p_channel text DEFAULT 'api') RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE entries jsonb;
BEGIN
 IF NOT public.sandy_orch_owner(p_actor_id) THEN RETURN jsonb_build_object('ok',false,'error','owner_required','http_status',403); END IF;
 IF p_channel IS NULL OR p_channel NOT IN ('api','mcp') THEN RETURN jsonb_build_object('ok',false,'error','invalid_channel','http_status',400); END IF;
 SELECT coalesce(jsonb_agg(snapshot || jsonb_build_object('registry_revision',public.sandy_orch_revision(snapshot)) ORDER BY snapshot->>'operation'),'[]') INTO entries
 FROM (SELECT public.sandy_orch_snapshot(operation,p_channel) AS snapshot FROM public.sandy_orch_delegated_operations WHERE enabled) q WHERE snapshot IS NOT NULL;
 RETURN jsonb_build_object('ok',true,'operations',entries,'tenant_execution_supported',false,'mutation_execution_supported',false);
END $$;
CREATE FUNCTION public.sandy_orch_immutable_job() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,pg_temp AS $$
BEGIN
 IF (to_jsonb(NEW) - ARRAY['state','result','error_code','attempts','updated_at','started_at','finished_at']) IS DISTINCT FROM
    (to_jsonb(OLD) - ARRAY['state','result','error_code','attempts','updated_at','started_at','finished_at']) THEN
  RAISE EXCEPTION 'durable_job_approval_snapshot_is_immutable' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER sandy_orch_job_immutable BEFORE UPDATE ON public.sandy_orch_jobs FOR EACH ROW EXECUTE FUNCTION public.sandy_orch_immutable_job();
CREATE FUNCTION public.sandy_orch_admit(p_actor_id uuid,p_channel text,p_kind text,p_idempotency_key text,p_steps jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE existing public.sandy_orch_plans%ROWTYPE; plan_uuid uuid; step jsonb; snapshot jsonb; step_id uuid; mapping jsonb:='{}'; digest text; keys text[]; dep text;
BEGIN
 IF NOT public.sandy_orch_owner(p_actor_id) THEN RETURN jsonb_build_object('ok',false,'error','owner_required','http_status',403); END IF;
 IF p_channel IS NULL OR p_kind IS NULL OR p_channel NOT IN ('api','mcp') OR p_kind NOT IN ('operation','plan') OR p_idempotency_key IS NULL OR p_idempotency_key !~ '^[A-Za-z0-9:_-]{12,128}$'
 OR jsonb_typeof(p_steps) IS DISTINCT FROM 'array' OR jsonb_array_length(p_steps) NOT BETWEEN 1 AND 50 OR octet_length(p_steps::text)>262144
 OR (p_kind='operation' AND jsonb_array_length(p_steps)<>1) THEN RETURN jsonb_build_object('ok',false,'error','invalid_plan','http_status',400); END IF;
 SELECT array_agg(value->>'key') INTO keys FROM jsonb_array_elements(p_steps);
 IF array_length(keys,1) IS DISTINCT FROM (SELECT count(DISTINCT key) FROM unnest(keys) key)
 OR EXISTS(SELECT 1 FROM jsonb_array_elements(p_steps) s WHERE jsonb_typeof(s)<>'object' OR (s->>'key') IS NULL OR (s->>'key') !~ '^[a-z][a-z0-9_-]{0,63}$'
   OR (s->>'input_sha256') IS NULL OR (s->>'input_sha256') !~ '^[a-f0-9]{64}$' OR jsonb_typeof(s->'arguments') IS DISTINCT FROM 'object' OR jsonb_typeof(s->'depends_on') IS DISTINCT FROM 'array'
   OR EXISTS(SELECT 1 FROM jsonb_array_elements(s->'depends_on') d WHERE jsonb_typeof(d)<>'string' OR NOT (d#>>'{}'=ANY(keys)))) THEN
  RETURN jsonb_build_object('ok',false,'error','invalid_plan_dependencies','http_status',400);
 END IF;
 IF EXISTS(WITH RECURSIVE edges AS (SELECT s->>'key' AS node,d#>>'{}' AS dep FROM jsonb_array_elements(p_steps)s CROSS JOIN LATERAL jsonb_array_elements(s->'depends_on')d),
  walk AS (SELECT e.node,e.dep,ARRAY[e.node,e.dep] AS path,e.node=e.dep AS cycle FROM edges e UNION ALL SELECT w.node,e.dep,w.path||e.dep,e.dep=ANY(w.path) FROM walk w JOIN edges e ON e.node=w.dep WHERE NOT w.cycle)
  SELECT 1 FROM walk w WHERE w.cycle) THEN RETURN jsonb_build_object('ok',false,'error','plan_cycle','http_status',400); END IF;
 digest:=encode(sha256(convert_to(jsonb_build_object('channel',p_channel,'steps',p_steps)::text,'UTF8')),'hex');
 PERFORM pg_advisory_xact_lock(hashtextextended(p_actor_id::text||':'||p_kind||':'||p_idempotency_key,0));
 SELECT * INTO existing FROM public.sandy_orch_plans WHERE actor_id=p_actor_id AND admission_kind=p_kind AND idempotency_key=p_idempotency_key;
 IF FOUND THEN
  IF existing.request_sha256<>digest THEN RETURN jsonb_build_object('ok',false,'error','idempotency_conflict','http_status',409); END IF;
  RETURN jsonb_build_object('ok',true,'accepted',true,'executed',false,'request_state','recorded','plan_id',existing.id,'reused',true,'dispatch_required',EXISTS(SELECT 1 FROM public.sandy_orch_jobs WHERE plan_id=existing.id AND state='queued'),
   'jobs',(SELECT jsonb_agg(jsonb_build_object('job_id',id,'step_key',step_key,'state',state) ORDER BY step_key) FROM public.sandy_orch_jobs WHERE plan_id=existing.id));
 END IF;
 -- Lock every actual registry row until the immutable admission commits.
 FOR step IN SELECT value FROM jsonb_array_elements(p_steps) ORDER BY value->>'operation' LOOP
  PERFORM operation FROM public.sandy_operation_registry WHERE operation=step->>'operation' FOR SHARE;
  snapshot:=public.sandy_orch_snapshot(step->>'operation',p_channel);
  IF snapshot IS NULL OR public.sandy_orch_revision(snapshot) IS DISTINCT FROM step->>'registry_revision' THEN
   RETURN jsonb_build_object('ok',false,'error','operation_contract_not_delegated_or_changed','http_status',409,'step_key',step->>'key');
  END IF;
 END LOOP;
 INSERT INTO public.sandy_orch_plans(actor_id,admission_kind,idempotency_key,request_sha256,request_document,channel)
 VALUES(p_actor_id,p_kind,p_idempotency_key,digest,p_steps,p_channel) RETURNING id INTO plan_uuid;
 FOR step IN SELECT value FROM jsonb_array_elements(p_steps) LOOP
  snapshot:=public.sandy_orch_snapshot(step->>'operation',p_channel);
  INSERT INTO public.sandy_orch_jobs(plan_id,step_key,actor_id,operation,registry_revision,input_sha256,handler,permission_scope,is_mutation,input_schema,output_schema,arguments,channel)
  VALUES(plan_uuid,step->>'key',p_actor_id,step->>'operation',step->>'registry_revision',step->>'input_sha256',snapshot->>'handler',snapshot->>'permission_scope',false,snapshot->'input_schema',snapshot->'output_schema',step->'arguments',p_channel) RETURNING id INTO step_id;
  mapping:=mapping||jsonb_build_object(step->>'key',step_id);
  INSERT INTO public.sandy_orch_outbox(job_id) VALUES(step_id);
  INSERT INTO public.sandy_orch_events(job_id,event_type,details) VALUES(step_id,'recorded',jsonb_build_object('provider_execution_started',false,'registry_revision',step->>'registry_revision'));
 END LOOP;
 FOR step IN SELECT value FROM jsonb_array_elements(p_steps) LOOP
  FOR dep IN SELECT DISTINCT value FROM jsonb_array_elements_text(step->'depends_on') LOOP
   INSERT INTO public.sandy_orch_dependencies(job_id,depends_on) VALUES((mapping->> (step->>'key'))::uuid,(mapping->>dep)::uuid);
  END LOOP;
 END LOOP;
 RETURN jsonb_build_object('ok',true,'accepted',true,'executed',false,'request_state','recorded','plan_id',plan_uuid,'reused',false,'dispatch_required',true,
  'jobs',(SELECT jsonb_agg(jsonb_build_object('job_id',id,'step_key',step_key,'state',state) ORDER BY step_key) FROM public.sandy_orch_jobs WHERE plan_id=plan_uuid));
END $$;
CREATE FUNCTION public.sandy_orch_claim(p_worker_id uuid,p_limit integer DEFAULT 1,p_lease_seconds integer DEFAULT 30) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
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
  IF NOT public.sandy_orch_owner(record_row.actor_id) THEN
   UPDATE public.sandy_orch_jobs SET state='blocked',error_code='owner_authorization_revoked',finished_at=now(),updated_at=now() WHERE id=record_row.id;
   INSERT INTO public.sandy_orch_events(job_id,event_type) VALUES(record_row.id,'authorization_revoked');
   CONTINUE;
  END IF;
  token:=gen_random_uuid();until_time:=clock_timestamp()+make_interval(secs=>p_lease_seconds);
  UPDATE public.sandy_orch_outbox SET worker_id=p_worker_id,lease_token=token,lease_until=until_time WHERE job_id=record_row.id;
  UPDATE public.sandy_orch_jobs SET state='leased',attempts=attempts+1,updated_at=now() WHERE id=record_row.id;
  INSERT INTO public.sandy_orch_events(job_id,event_type,details) VALUES(record_row.id,'leased',jsonb_build_object('worker_id',p_worker_id,'lease_until',until_time,'provider_execution_started',false));
  claimed:=claimed||jsonb_build_array(jsonb_build_object('job_id',record_row.id,'lease_token',token,'worker_id',p_worker_id,'lease_until',until_time));
 END LOOP;
 RETURN jsonb_build_object('ok',true,'claims',claimed);
END $$;
CREATE FUNCTION public.sandy_orch_resolve_dispatch(p_job_id uuid,p_lease_token uuid,p_worker_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE job public.sandy_orch_jobs%ROWTYPE; lease public.sandy_orch_outbox%ROWTYPE; snapshot jsonb; dispatch_uuid uuid;
BEGIN
 SELECT * INTO job FROM public.sandy_orch_jobs WHERE id=p_job_id FOR UPDATE;
 SELECT * INTO lease FROM public.sandy_orch_outbox WHERE job_id=p_job_id FOR UPDATE;
 IF job.id IS NULL OR lease.job_id IS NULL OR lease.lease_token IS DISTINCT FROM p_lease_token OR lease.worker_id IS DISTINCT FROM p_worker_id OR lease.lease_until<=clock_timestamp() THEN
  RETURN jsonb_build_object('ok',false,'error','invalid_or_expired_job_lease','http_status',403);
 END IF;
 IF job.state='running' THEN RETURN jsonb_build_object('ok',false,'error','dispatch_already_started','http_status',409); END IF;
 IF job.state<>'leased' THEN RETURN jsonb_build_object('ok',false,'error','job_not_dispatchable','http_status',409); END IF;
 snapshot:=public.sandy_orch_snapshot(job.operation,job.channel);
 IF NOT public.sandy_orch_owner(job.actor_id) OR snapshot IS NULL OR public.sandy_orch_revision(snapshot)<>job.registry_revision THEN
  UPDATE public.sandy_orch_jobs SET state='blocked',error_code='execution_authorization_or_contract_changed',finished_at=now(),updated_at=now() WHERE id=p_job_id;
  UPDATE public.sandy_orch_outbox SET worker_id=NULL,lease_token=NULL,lease_until=NULL WHERE job_id=p_job_id;
  INSERT INTO public.sandy_orch_events(job_id,event_type) VALUES(p_job_id,'dispatch_authorization_refused');
  RETURN jsonb_build_object('ok',false,'error','execution_authorization_or_contract_changed','http_status',403);
 END IF;
 UPDATE public.sandy_orch_jobs SET state='running',started_at=coalesce(started_at,now()),updated_at=now() WHERE id=p_job_id;
 INSERT INTO public.sandy_orch_attempts(job_id,attempt,lease_token,worker_id) VALUES(p_job_id,job.attempts,p_lease_token,p_worker_id) RETURNING dispatch_id INTO dispatch_uuid;
 INSERT INTO public.sandy_orch_events(job_id,event_type,details) VALUES(p_job_id,'dispatch_authorized',jsonb_build_object('dispatch_id',dispatch_uuid,'attempt',job.attempts));
 RETURN jsonb_build_object('ok',true,'job_id',job.id,'principal_id',job.actor_id,'tenant_id',job.tenant_id,'operation',job.operation,'arguments',job.arguments,
  'input_sha256',job.input_sha256,'original_channel',job.channel,'registry_revision',job.registry_revision,'registry_contract',snapshot,
  'dispatch_id',dispatch_uuid,'attempt',job.attempts,'lease_until',lease.lease_until);
END $$;
CREATE FUNCTION public.sandy_orch_heartbeat(p_job_id uuid,p_lease_token uuid,p_worker_id uuid,p_lease_seconds integer DEFAULT 30) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE until_time timestamptz;
BEGIN
 IF p_lease_seconds IS NULL OR p_lease_seconds NOT BETWEEN 5 AND 300 THEN RETURN jsonb_build_object('ok',false,'error','invalid_lease_duration','http_status',400); END IF;
 UPDATE public.sandy_orch_outbox o SET lease_until=clock_timestamp()+make_interval(secs=>p_lease_seconds)
 WHERE o.job_id=p_job_id AND o.lease_token=p_lease_token AND o.worker_id=p_worker_id AND o.lease_until>clock_timestamp()
 AND EXISTS(SELECT 1 FROM public.sandy_orch_jobs j WHERE j.id=o.job_id AND j.state IN ('leased','running')) RETURNING lease_until INTO until_time;
 IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'error','invalid_or_expired_job_lease','http_status',403); END IF;
 RETURN jsonb_build_object('ok',true,'lease_until',until_time);
END $$;
CREATE FUNCTION public.sandy_orch_finish(p_job_id uuid,p_lease_token uuid,p_worker_id uuid,p_dispatch_id uuid,p_outcome text,
 p_result jsonb DEFAULT NULL,p_error_code text DEFAULT NULL,p_provider_request_id text DEFAULT NULL,p_execution_admission_id uuid DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE job public.sandy_orch_jobs%ROWTYPE; lease public.sandy_orch_outbox%ROWTYPE; receipt public.sandy_orch_attempts%ROWTYPE; new_state text; admission jsonb;
BEGIN
 IF p_outcome IS NULL OR p_outcome NOT IN ('succeeded','failed','retryable','unknown') OR coalesce(octet_length(p_result::text),0)>1048576
 OR (p_error_code IS NOT NULL AND p_error_code !~ '^[a-zA-Z0-9_.:-]{1,120}$') OR length(p_provider_request_id)>200 THEN
  RETURN jsonb_build_object('ok',false,'error','invalid_execution_receipt','http_status',400);
 END IF;
 SELECT * INTO job FROM public.sandy_orch_jobs WHERE id=p_job_id FOR UPDATE;
 SELECT * INTO lease FROM public.sandy_orch_outbox WHERE job_id=p_job_id FOR UPDATE;
 SELECT * INTO receipt FROM public.sandy_orch_attempts WHERE job_id=p_job_id AND dispatch_id=p_dispatch_id FOR UPDATE;
 IF job.id IS NULL OR receipt.job_id IS NULL OR receipt.lease_token IS DISTINCT FROM p_lease_token OR receipt.worker_id IS DISTINCT FROM p_worker_id THEN RETURN jsonb_build_object('ok',false,'error','execution_receipt_not_found','http_status',404); END IF;
 IF receipt.finished_at IS NOT NULL THEN
  RETURN jsonb_build_object('ok',true,'job_id',p_job_id,'state',job.state,'reused',true,'receipt_outcome',receipt.outcome);
 END IF;
 IF job.state<>'running' OR lease.worker_id IS DISTINCT FROM p_worker_id OR lease.lease_token IS DISTINCT FROM p_lease_token OR lease.lease_until<=clock_timestamp() THEN
  RETURN jsonb_build_object('ok',false,'error','stale_execution_receipt','http_status',409);
 END IF;
 -- This migration is additive and may precede the shared execution policy.
 -- A supplied proof must resolve to the actual canonical dispatch admission;
 -- an arbitrary UUID must never become evidence of provider execution.
 IF p_execution_admission_id IS NOT NULL THEN
  IF to_regclass('public.sandy_api_execution_admissions') IS NULL THEN
   RETURN jsonb_build_object('ok',false,'error','execution_admission_unavailable','http_status',424);
  END IF;
  EXECUTE 'SELECT to_jsonb(a) FROM public.sandy_api_execution_admissions a WHERE a.id=$1 FOR SHARE'
   INTO admission USING p_execution_admission_id;
  IF admission IS NULL OR admission->>'actor_id' IS DISTINCT FROM job.actor_id::text
   OR admission->>'tenant_id' IS DISTINCT FROM job.tenant_id::text OR admission->>'operation' IS DISTINCT FROM job.operation
   OR admission->>'input_sha256' IS DISTINCT FROM job.input_sha256 OR admission->>'request_id' IS DISTINCT FROM p_dispatch_id::text
   OR NOT coalesce((CASE p_outcome WHEN 'succeeded' THEN admission->>'state'='succeeded'
     WHEN 'failed' THEN admission->>'state' IN ('failed','rejected')
     WHEN 'retryable' THEN admission->>'state' IN ('failed','rejected')
     ELSE admission->>'state' IN ('admitted','consumed','accepted','unknown') END),false) THEN
   RETURN jsonb_build_object('ok',false,'error','execution_admission_invalid','http_status',409);
  END IF;
 END IF;
 new_state:=CASE WHEN p_outcome='succeeded' THEN 'succeeded' WHEN p_outcome='failed' THEN 'failed'
  WHEN job.is_mutation THEN 'needs_reconciliation' WHEN job.attempts>=job.max_attempts THEN 'dead_letter' ELSE 'queued' END;
 UPDATE public.sandy_orch_attempts SET finished_at=now(),outcome=p_outcome,provider_request_id=p_provider_request_id,
  result_sha256=CASE WHEN p_result IS NULL THEN NULL ELSE encode(sha256(convert_to(p_result::text,'UTF8')),'hex') END,
  execution_admission_id=p_execution_admission_id WHERE job_id=p_job_id AND attempt=job.attempts;
 UPDATE public.sandy_orch_jobs SET state=new_state,result=CASE WHEN p_outcome='succeeded' THEN p_result ELSE NULL END,error_code=p_error_code,
  updated_at=now(),finished_at=CASE WHEN new_state='queued' THEN NULL ELSE now() END WHERE id=p_job_id;
 UPDATE public.sandy_orch_outbox SET worker_id=NULL,lease_token=NULL,lease_until=NULL,
  available_at=clock_timestamp()+make_interval(secs=>least(300,power(2,job.attempts)::integer)+random()) WHERE job_id=p_job_id;
 INSERT INTO public.sandy_orch_events(job_id,event_type,details) VALUES(p_job_id,'attempt_finished',jsonb_build_object('dispatch_id',p_dispatch_id,'outcome',p_outcome,'state',new_state,'provider_request_id',p_provider_request_id,'result_persisted',p_outcome='succeeded'));
 RETURN jsonb_build_object('ok',true,'job_id',p_job_id,'state',new_state,'reused',false,'receipt_outcome',p_outcome);
END $$;
CREATE FUNCTION public.sandy_orch_job(p_actor_id uuid,p_job_id uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE record_row public.sandy_orch_jobs%ROWTYPE;
BEGIN
 IF NOT public.sandy_orch_owner(p_actor_id) THEN RETURN jsonb_build_object('ok',false,'error','owner_required','http_status',403); END IF;
 SELECT * INTO record_row FROM public.sandy_orch_jobs WHERE id=p_job_id AND actor_id=p_actor_id;
 IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'error','job_not_found','http_status',404); END IF;
 RETURN jsonb_build_object('ok',true,'job',jsonb_build_object('id',record_row.id,'plan_id',record_row.plan_id,'step_key',record_row.step_key,
  'operation',record_row.operation,'state',record_row.state,'attempts',record_row.attempts,'max_attempts',record_row.max_attempts,'result',record_row.result,
  'latest_attempt',(SELECT jsonb_build_object('attempt',a.attempt,'dispatch_id',a.dispatch_id,'started_at',a.started_at,'finished_at',a.finished_at,
    'outcome',a.outcome,'provider_request_id',a.provider_request_id,'execution_admission_id',a.execution_admission_id)
    FROM public.sandy_orch_attempts a WHERE a.job_id=p_job_id ORDER BY a.attempt DESC LIMIT 1),
  'error_code',record_row.error_code,'created_at',record_row.created_at,'started_at',record_row.started_at,'finished_at',record_row.finished_at,
  'provider_execution_completed',record_row.state='succeeded','rollback_available',false));
END $$;
CREATE FUNCTION public.sandy_orch_events_page(p_actor_id uuid,p_job_id uuid,p_after bigint DEFAULT 0,p_limit integer DEFAULT 100) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE events jsonb; last_cursor bigint;
BEGIN
 IF NOT public.sandy_orch_owner(p_actor_id) THEN RETURN jsonb_build_object('ok',false,'error','owner_required','http_status',403); END IF;
 IF p_after IS NULL OR p_limit IS NULL OR p_after<0 OR p_limit NOT BETWEEN 1 AND 200 THEN RETURN jsonb_build_object('ok',false,'error','invalid_event_cursor','http_status',400); END IF;
 IF NOT EXISTS(SELECT 1 FROM public.sandy_orch_jobs WHERE id=p_job_id AND actor_id=p_actor_id) THEN RETURN jsonb_build_object('ok',false,'error','job_not_found','http_status',404); END IF;
 SELECT coalesce(jsonb_agg(to_jsonb(q) ORDER BY id),'[]'),max(id) INTO events,last_cursor FROM
  (SELECT id,event_type,details,created_at FROM public.sandy_orch_events WHERE job_id=p_job_id AND id>p_after ORDER BY id LIMIT p_limit)q;
 RETURN jsonb_build_object('ok',true,'job_id',p_job_id,'events',events,'next_cursor',CASE WHEN jsonb_array_length(events)=p_limit THEN last_cursor ELSE NULL END);
END $$;
CREATE FUNCTION public.sandy_orch_cancel(p_actor_id uuid,p_job_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE job public.sandy_orch_jobs%ROWTYPE;
BEGIN
 IF NOT public.sandy_orch_owner(p_actor_id) THEN RETURN jsonb_build_object('ok',false,'error','owner_required','http_status',403); END IF;
 SELECT * INTO job FROM public.sandy_orch_jobs WHERE id=p_job_id AND actor_id=p_actor_id FOR UPDATE;
 IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'error','job_not_found','http_status',404); END IF;
 IF job.state='cancelled' THEN RETURN jsonb_build_object('ok',true,'job_id',p_job_id,'state','cancelled','reused',true,'provider_cancellation',false); END IF;
 IF job.state NOT IN ('queued','leased') THEN RETURN jsonb_build_object('ok',false,'error','job_not_cancellable','http_status',409,'state',job.state); END IF;
 UPDATE public.sandy_orch_jobs SET state='cancelled',finished_at=now(),updated_at=now() WHERE id=p_job_id;
 UPDATE public.sandy_orch_outbox SET worker_id=NULL,lease_token=NULL,lease_until=NULL WHERE job_id=p_job_id;
 INSERT INTO public.sandy_orch_events(job_id,event_type,details) VALUES(p_job_id,'cancelled',jsonb_build_object('previous_state',job.state,'provider_cancellation',false));
 RETURN jsonb_build_object('ok',true,'job_id',p_job_id,'state','cancelled','reused',false,'provider_cancellation',false);
END $$;
CREATE FUNCTION public.sandy_orch_retry(p_actor_id uuid,p_job_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE job public.sandy_orch_jobs%ROWTYPE; snapshot jsonb;
BEGIN
 IF NOT public.sandy_orch_owner(p_actor_id) THEN RETURN jsonb_build_object('ok',false,'error','owner_required','http_status',403); END IF;
 SELECT * INTO job FROM public.sandy_orch_jobs WHERE id=p_job_id AND actor_id=p_actor_id FOR UPDATE;
 IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'error','job_not_found','http_status',404); END IF;
 IF job.state='queued' AND job.error_code IN ('transient_provider_failure','read_transport_outcome_unknown') THEN RETURN jsonb_build_object('ok',true,'accepted',true,'executed',false,'job_id',p_job_id,'state','queued','reused',true); END IF;
 IF job.is_mutation OR job.state<>'failed' OR job.error_code<>'transient_provider_failure' OR job.attempts>=job.max_attempts THEN
  RETURN jsonb_build_object('ok',false,'error','retry_not_safe_or_exhausted','http_status',409);
 END IF;
 snapshot:=public.sandy_orch_snapshot(job.operation,job.channel);
 IF snapshot IS NULL OR public.sandy_orch_revision(snapshot)<>job.registry_revision THEN RETURN jsonb_build_object('ok',false,'error','operation_contract_not_delegated_or_changed','http_status',409); END IF;
 UPDATE public.sandy_orch_jobs SET state='queued',finished_at=NULL,updated_at=now() WHERE id=p_job_id;
 UPDATE public.sandy_orch_outbox SET available_at=clock_timestamp()+make_interval(secs=>least(300,power(2,job.attempts)::integer)+random()),worker_id=NULL,lease_token=NULL,lease_until=NULL WHERE job_id=p_job_id;
 INSERT INTO public.sandy_orch_events(job_id,event_type) VALUES(p_job_id,'retry_recorded');
 RETURN jsonb_build_object('ok',true,'accepted',true,'executed',false,'job_id',p_job_id,'state','queued','reused',false);
END $$;
CREATE FUNCTION public.sandy_orch_plan(p_actor_id uuid,p_plan_id uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE jobs jsonb; plan_state text;
BEGIN
 IF NOT public.sandy_orch_owner(p_actor_id) THEN RETURN jsonb_build_object('ok',false,'error','owner_required','http_status',403); END IF;
 IF NOT EXISTS(SELECT 1 FROM public.sandy_orch_plans WHERE id=p_plan_id AND actor_id=p_actor_id) THEN RETURN jsonb_build_object('ok',false,'error','plan_not_found','http_status',404); END IF;
 SELECT coalesce(jsonb_agg(jsonb_build_object('job_id',id,'step_key',step_key,'operation',operation,'state',state) ORDER BY step_key),'[]'),
 CASE WHEN bool_and(state='succeeded') THEN 'succeeded' WHEN bool_or(state='needs_reconciliation') THEN 'needs_reconciliation'
 WHEN bool_or(state IN ('failed','blocked','dead_letter')) THEN 'failed' WHEN bool_and(state='cancelled') THEN 'cancelled'
 WHEN bool_or(state IN ('running','leased')) THEN 'running' ELSE 'recorded' END INTO jobs,plan_state FROM public.sandy_orch_jobs WHERE plan_id=p_plan_id;
 RETURN jsonb_build_object('ok',true,'plan_id',p_plan_id,'state',plan_state,'jobs',jobs,'atomic_provider_execution',false);
END $$;
-- Safe recovery lookup: reveals an already-created dispatch ID without granting
-- or replaying dispatch after an HTTP response is lost.
CREATE FUNCTION public.sandy_orch_attempt_receipt(p_job_id uuid,p_lease_token uuid,p_worker_id uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE receipt public.sandy_orch_attempts%ROWTYPE; current_state text;
BEGIN
 SELECT a.* INTO receipt FROM public.sandy_orch_attempts a WHERE a.job_id=p_job_id AND a.lease_token=p_lease_token AND a.worker_id=p_worker_id;
 SELECT state INTO current_state FROM public.sandy_orch_jobs WHERE id=p_job_id;
 IF FOUND AND receipt.job_id IS NOT NULL THEN RETURN jsonb_build_object('ok',true,'started',true,'dispatch_id',receipt.dispatch_id,'state',current_state,'finished',receipt.finished_at IS NOT NULL); END IF;
 IF EXISTS(SELECT 1 FROM public.sandy_orch_outbox WHERE job_id=p_job_id AND lease_token=p_lease_token AND worker_id=p_worker_id) THEN
  RETURN jsonb_build_object('ok',true,'started',false,'state',current_state);
 END IF;
 RETURN jsonb_build_object('ok',false,'error','invalid_job_lease','http_status',403);
END $$;

-- Central compatibility request service. Existing worker tables and approval
-- functions remain authoritative; neither MCP transport inserts jobs/events.
CREATE TABLE public.sandy_orch_legacy_requests (
 job_id uuid PRIMARY KEY REFERENCES public.sandy_deployment_jobs(id) ON DELETE RESTRICT,
 actor_id uuid NOT NULL, request_document jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
 target_name text, target_project_id text, target_zone text
);
CREATE TABLE public.sandy_orch_legacy_target_pins (
 job_id uuid PRIMARY KEY REFERENCES public.sandy_orch_legacy_requests(job_id) ON DELETE RESTRICT,
 target_name text NOT NULL,target_project_id text NOT NULL,target_zone text NOT NULL,
 FOREIGN KEY(target_name,target_project_id,target_zone) REFERENCES public.sandy_cloud_targets(name,project_id,zone) ON UPDATE RESTRICT ON DELETE RESTRICT
);
ALTER TABLE public.sandy_orch_legacy_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sandy_orch_legacy_target_pins ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.sandy_orch_legacy_requests,public.sandy_orch_legacy_target_pins FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION public.sandy_orch_guard_legacy_request() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
BEGIN
 IF EXISTS(SELECT 1 FROM public.sandy_orch_legacy_requests WHERE job_id=OLD.id) AND
 (NEW.requested_by IS DISTINCT FROM OLD.requested_by OR NEW.provider IS DISTINCT FROM OLD.provider OR NEW.operation IS DISTINCT FROM OLD.operation
 OR NEW.target IS DISTINCT FROM OLD.target OR NEW.payload IS DISTINCT FROM OLD.payload OR NEW.idempotency_key IS DISTINCT FROM OLD.idempotency_key
 OR NEW.engineering_change_id IS DISTINCT FROM OLD.engineering_change_id) THEN
  RAISE EXCEPTION 'legacy_api_job_request_scope_is_immutable' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER sandy_orch_legacy_request_scope BEFORE UPDATE OF requested_by,provider,operation,target,payload,idempotency_key,engineering_change_id
ON public.sandy_deployment_jobs FOR EACH ROW EXECUTE FUNCTION public.sandy_orch_guard_legacy_request();
CREATE FUNCTION public.sandy_orch_maintain_legacy_pin() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
BEGIN
 IF NEW.status IN ('pending_approval','approved','running') THEN
  INSERT INTO public.sandy_orch_legacy_target_pins(job_id,target_name,target_project_id,target_zone)
  SELECT job_id,target_name,target_project_id,target_zone FROM public.sandy_orch_legacy_requests WHERE job_id=NEW.id AND target_project_id IS NOT NULL
  ON CONFLICT(job_id) DO NOTHING;
 ELSE DELETE FROM public.sandy_orch_legacy_target_pins WHERE job_id=NEW.id; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER sandy_orch_legacy_job_pin AFTER UPDATE OF status ON public.sandy_deployment_jobs FOR EACH ROW EXECUTE FUNCTION public.sandy_orch_maintain_legacy_pin();
CREATE FUNCTION public.sandy_api_request_legacy_deployment_job(p_actor_id uuid,p_request jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE provider_name text; operation_name text; target text; key text; payload jsonb; normalized jsonb;
 scope public.sandy_cloud_targets%ROWTYPE; existing public.sandy_deployment_jobs%ROWTYPE; job_uuid uuid;
BEGIN
 IF NOT public.sandy_orch_owner(p_actor_id) THEN RETURN jsonb_build_object('ok',false,'error','owner_required','http_status',403); END IF;
 IF jsonb_typeof(p_request) IS DISTINCT FROM 'object' OR EXISTS(SELECT 1 FROM jsonb_object_keys(p_request) k WHERE k NOT IN ('provider','operation','target','payload','idempotency_key')) THEN
  RETURN jsonb_build_object('ok',false,'error','invalid_deployment_request','http_status',400);
 END IF;
 provider_name:=p_request->>'provider';operation_name:=p_request->>'operation';target:=p_request->>'target';key:=p_request->>'idempotency_key';payload:=coalesce(p_request->'payload','{}');
 IF key IS NULL OR key !~ '^[A-Za-z0-9:_-]{12,128}$' OR target IS NULL OR length(target) NOT BETWEEN 2 AND 200
 OR jsonb_typeof(payload) IS DISTINCT FROM 'object' OR octet_length(payload::text)>12000 THEN RETURN jsonb_build_object('ok',false,'error','invalid_deployment_request','http_status',400); END IF;
 IF provider_name IS NULL OR operation_name IS NULL OR NOT ((provider_name='google_cloud' AND operation_name IN ('get_vm','list_vms','create_vm','start_vm','stop_vm','restart_vm','resize_vm','snapshot_disk','delete_vm','get_logs','install_worker'))
 OR (provider_name IN ('github','supabase') AND operation_name='read')) THEN RETURN jsonb_build_object('ok',false,'error','deployment_request_requires_existing_engineering_service_or_is_unsupported','http_status',422); END IF;
 IF operation_name='install_worker' AND (target<>'sandy-deploy' OR payload<>'{"installer":"restricted_deployment_worker_v1"}'::jsonb) THEN
  RETURN jsonb_build_object('ok',false,'error','fixed_worker_installer_required','http_status',400);
 END IF;
 normalized:=jsonb_build_object('provider',provider_name,'operation',operation_name,'target',target,'payload',payload);
 PERFORM pg_advisory_xact_lock(hashtextextended('sandy-legacy-request:'||key,0));
 SELECT * INTO existing FROM public.sandy_deployment_jobs WHERE idempotency_key=key FOR UPDATE;
 IF FOUND THEN
  IF existing.requested_by NOT IN ('sandy_api:'||p_actor_id::text,'sandy_mcp:'||p_actor_id::text,p_actor_id::text)
   OR existing.provider IS DISTINCT FROM provider_name OR existing.operation IS DISTINCT FROM operation_name OR existing.target IS DISTINCT FROM target OR existing.payload IS DISTINCT FROM payload THEN
   RETURN jsonb_build_object('ok',false,'error','idempotency_conflict','http_status',409);
  END IF;
  RETURN jsonb_build_object('ok',true,'accepted',true,'executed',false,'job_id',existing.id,'state',existing.status,'reused',true,'dispatch_required',existing.status='approved');
 END IF;
 IF provider_name='google_cloud' THEN
  SELECT * INTO scope FROM public.sandy_cloud_targets WHERE name=target FOR SHARE;
  IF NOT FOUND OR nullif(btrim(scope.project_id),'') IS NULL OR nullif(btrim(scope.zone),'') IS NULL THEN RETURN jsonb_build_object('ok',false,'error','registered_cloud_target_required','http_status',409); END IF;
  IF scope.protected AND operation_name NOT IN ('get_vm','list_vms','get_logs')
   AND NOT(target='sandy-video' AND operation_name='create_vm') AND operation_name<>'install_worker' THEN
   RETURN jsonb_build_object('ok',false,'error','cloud_target_protected','http_status',403);
  END IF;
  IF target='sandy-video' AND operation_name='create_vm' AND payload->>'profile' IS DISTINCT FROM 'livekit-dedicated-v1' THEN
   RETURN jsonb_build_object('ok',false,'error','fixed_video_profile_required','http_status',400);
  END IF;
 END IF;
 BEGIN
  INSERT INTO public.sandy_deployment_jobs(requested_by,provider,operation,target,payload,idempotency_key,status)
  VALUES('sandy_api:'||p_actor_id::text,provider_name,operation_name,target,payload,key,'pending_approval') RETURNING id INTO job_uuid;
  INSERT INTO public.sandy_orch_legacy_requests(job_id,actor_id,request_document,target_name,target_project_id,target_zone)
  VALUES(job_uuid,p_actor_id,normalized,CASE WHEN provider_name='google_cloud' THEN scope.name END,CASE WHEN provider_name='google_cloud' THEN scope.project_id END,CASE WHEN provider_name='google_cloud' THEN scope.zone END);
  IF provider_name='google_cloud' THEN INSERT INTO public.sandy_orch_legacy_target_pins(job_id,target_name,target_project_id,target_zone) VALUES(job_uuid,scope.name,scope.project_id,scope.zone); END IF;
  INSERT INTO public.sandy_deployment_events(job_id,event_type,actor,details) VALUES(job_uuid,'requested',p_actor_id::text,jsonb_build_object('source','sandy-operation-api','provider',provider_name,'operation',operation_name,'target',target,'executed',false));
 EXCEPTION WHEN unique_violation THEN RETURN jsonb_build_object('ok',false,'error','idempotency_conflict','http_status',409); END;
 RETURN jsonb_build_object('ok',true,'accepted',true,'executed',false,'job_id',job_uuid,'state','pending_approval','reused',false,'dispatch_required',false);
END $$;
-- Explicit ACLs override project default privileges. Helper/trigger functions are
-- never directly executable by customer or service roles.
DO $$ DECLARE fn record; BEGIN
 FOR fn IN SELECT p.oid::regprocedure AS identity FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='public' AND (strpos(p.proname,'sandy_orch_')=1 OR p.proname='sandy_api_request_legacy_deployment_job') LOOP
  EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon,authenticated,service_role',fn.identity);
 END LOOP;
END $$;
GRANT EXECUTE ON FUNCTION public.sandy_orch_catalogue(uuid,text),public.sandy_orch_admit(uuid,text,text,text,jsonb),
 public.sandy_orch_claim(uuid,integer,integer),public.sandy_orch_resolve_dispatch(uuid,uuid,uuid),public.sandy_orch_heartbeat(uuid,uuid,uuid,integer),
 public.sandy_orch_finish(uuid,uuid,uuid,uuid,text,jsonb,text,text,uuid),public.sandy_orch_attempt_receipt(uuid,uuid,uuid),
 public.sandy_orch_job(uuid,uuid),public.sandy_orch_events_page(uuid,uuid,bigint,integer),public.sandy_orch_cancel(uuid,uuid),
 public.sandy_orch_retry(uuid,uuid),public.sandy_orch_plan(uuid,uuid),public.sandy_api_request_legacy_deployment_job(uuid,jsonb) TO service_role;
-- Mutating admission/lifecycle contracts stay closed pending live attestation.
INSERT INTO public.sandy_operation_registry(operation,domain,description,permission_scope,is_mutation,input_schema,output_schema,handler,api_exposed,ui_exposed,ai_exposed,verified,implementation_state,source_repository,source_path,dependencies,retry_policy,rollback_policy) VALUES ('orchestration.operations.enqueue','system','Durably record one delegated owner infrastructure read with principal-scoped idempotency and immutable contract/input snapshots; acceptance does not execute a provider; contract v1.0.0.','orchestration:write',true,'{"type":"object","required":["operation","idempotency_key"],"properties":{"operation":{"type":"string","pattern":"^[a-z][a-z0-9_.-]{2,100}$"},"arguments":{"type":"object"},"idempotency_key":{"type":"string","pattern":"^[A-Za-z0-9:_-]{12,128}$"}},"additionalProperties":false}'::jsonb,'{"type":"object","required":["ok","accepted","executed","request_state","plan_id","reused","dispatch_required","jobs"],"properties":{"ok":{"const":true},"accepted":{"const":true},"executed":{"const":false},"request_state":{"const":"recorded"},"plan_id":{"type":"string","format":"uuid"},"reused":{"type":"boolean"},"dispatch_required":{"type":"boolean"},"jobs":{"type":"array","minItems":1,"maxItems":50,"items":{"type":"object","required":["job_id","step_key","state"],"properties":{"job_id":{"type":"string","format":"uuid"},"step_key":{"type":"string"},"state":{"type":"string","enum":["queued","leased","running","succeeded","failed","cancelled","blocked","needs_reconciliation","dead_letter"]}},"additionalProperties":false}}},"additionalProperties":false}'::jsonb,'sandy-orchestration-api',false,false,false,false,'source_ready','ausstyle/web-staging','supabase/functions/sandy-orchestration-api/index.ts','["enabled_controller_owner","durable_orchestration_schema","canonical_api_scoped_lease_dispatch"]'::jsonb,'{"safe_to_retry":true,"automatic":false,"reason":"admission idempotency key or read-only status; provider retry is governed separately"}'::jsonb,'{"applicable":false,"reason":"initial delegation is nonmutating infrastructure reads; no provider compensation is claimed"}'::jsonb) ON CONFLICT(operation) DO NOTHING;
INSERT INTO public.sandy_operation_registry(operation,domain,description,permission_scope,is_mutation,input_schema,output_schema,handler,api_exposed,ui_exposed,ai_exposed,verified,implementation_state,source_repository,source_path,dependencies,retry_policy,rollback_policy) VALUES ('orchestration.plans.validate','system','Validate a bounded delegated-read DAG against current owner grants, registry schemas and dependency cycles. Reports absent provider pricing and no provider dry run truthfully; contract v1.0.0.','orchestration:read',false,'{"type":"object","required":["steps"],"properties":{"steps":{"type":"array","minItems":1,"maxItems":50,"items":{"type":"object","required":["key","operation"],"properties":{"key":{"type":"string","pattern":"^[a-z][a-z0-9_-]{0,63}$"},"operation":{"type":"string","pattern":"^[a-z][a-z0-9_.-]{2,100}$"},"arguments":{"type":"object"},"depends_on":{"type":"array","maxItems":50,"uniqueItems":true,"items":{"type":"string","pattern":"^[a-z][a-z0-9_-]{0,63}$"}}},"additionalProperties":false}}},"additionalProperties":false}'::jsonb,'{"type":"object","required":["ok","contract_version","valid","steps","blockers","provider_dry_run_performed","execution_authorization_rechecked_at_dispatch","tenant_execution_supported","cost_estimate","blast_radius"],"properties":{"ok":{"const":true},"contract_version":{"const":"1.0.0"},"valid":{"type":"boolean"},"steps":{"type":"array","maxItems":50,"items":{"type":"object","required":["key","operation","arguments","depends_on","registry_revision","input_sha256"],"properties":{"key":{"type":"string"},"operation":{"type":"string"},"arguments":{"type":"object"},"depends_on":{"type":"array","items":{"type":"string"}},"registry_revision":{"type":"string","pattern":"^[a-f0-9]{64}$"},"input_sha256":{"type":"string","pattern":"^[a-f0-9]{64}$"}},"additionalProperties":false}},"blockers":{"type":"array","items":{"type":"object","required":["code"],"properties":{"step_key":{"type":"string"},"code":{"type":"string"}},"additionalProperties":false}},"provider_dry_run_performed":{"const":false},"execution_authorization_rechecked_at_dispatch":{"const":true},"tenant_execution_supported":{"const":false},"cost_estimate":{"type":"object","required":["monetary_total","pricing_status","max_api_calls","model_calls"],"properties":{"monetary_total":{"type":"null"},"pricing_status":{"const":"unavailable"},"max_api_calls":{"type":"integer","minimum":0,"maximum":50},"model_calls":{"const":0}},"additionalProperties":false},"blast_radius":{"type":"object","required":["effect","provider_writes","maximum_steps"],"properties":{"effect":{"const":"infrastructure_read_only"},"provider_writes":{"const":false},"maximum_steps":{"type":"integer","minimum":0,"maximum":50}},"additionalProperties":false}},"additionalProperties":false}'::jsonb,'sandy-orchestration-api',true,false,true,false,'source_ready','ausstyle/web-staging','supabase/functions/sandy-orchestration-api/index.ts','["enabled_controller_owner","durable_orchestration_schema","canonical_api_scoped_lease_dispatch"]'::jsonb,'{"safe_to_retry":true,"automatic":false,"reason":"admission idempotency key or read-only status; provider retry is governed separately"}'::jsonb,'{"applicable":false,"reason":"initial delegation is nonmutating infrastructure reads; no provider compensation is claimed"}'::jsonb) ON CONFLICT(operation) DO NOTHING;
INSERT INTO public.sandy_operation_registry(operation,domain,description,permission_scope,is_mutation,input_schema,output_schema,handler,api_exposed,ui_exposed,ai_exposed,verified,implementation_state,source_repository,source_path,dependencies,retry_policy,rollback_policy) VALUES ('orchestration.plans.execute','system','Transactionally record a validated delegated-read DAG and outbox; dependencies execute through Sandy API, without promising atomic multi-provider effects; contract v1.0.0.','orchestration:write',true,'{"type":"object","required":["steps","idempotency_key"],"properties":{"steps":{"type":"array","minItems":1,"maxItems":50,"items":{"type":"object","required":["key","operation"],"properties":{"key":{"type":"string","pattern":"^[a-z][a-z0-9_-]{0,63}$"},"operation":{"type":"string","pattern":"^[a-z][a-z0-9_.-]{2,100}$"},"arguments":{"type":"object"},"depends_on":{"type":"array","maxItems":50,"uniqueItems":true,"items":{"type":"string","pattern":"^[a-z][a-z0-9_-]{0,63}$"}}},"additionalProperties":false}},"idempotency_key":{"type":"string","pattern":"^[A-Za-z0-9:_-]{12,128}$"}},"additionalProperties":false}'::jsonb,'{"type":"object","required":["ok","accepted","executed","request_state","plan_id","reused","dispatch_required","jobs"],"properties":{"ok":{"const":true},"accepted":{"const":true},"executed":{"const":false},"request_state":{"const":"recorded"},"plan_id":{"type":"string","format":"uuid"},"reused":{"type":"boolean"},"dispatch_required":{"type":"boolean"},"jobs":{"type":"array","minItems":1,"maxItems":50,"items":{"type":"object","required":["job_id","step_key","state"],"properties":{"job_id":{"type":"string","format":"uuid"},"step_key":{"type":"string"},"state":{"type":"string","enum":["queued","leased","running","succeeded","failed","cancelled","blocked","needs_reconciliation","dead_letter"]}},"additionalProperties":false}}},"additionalProperties":false}'::jsonb,'sandy-orchestration-api',false,false,false,false,'source_ready','ausstyle/web-staging','supabase/functions/sandy-orchestration-api/index.ts','["enabled_controller_owner","durable_orchestration_schema","canonical_api_scoped_lease_dispatch"]'::jsonb,'{"safe_to_retry":true,"automatic":false,"reason":"admission idempotency key or read-only status; provider retry is governed separately"}'::jsonb,'{"applicable":false,"reason":"initial delegation is nonmutating infrastructure reads; no provider compensation is claimed"}'::jsonb) ON CONFLICT(operation) DO NOTHING;
INSERT INTO public.sandy_operation_registry(operation,domain,description,permission_scope,is_mutation,input_schema,output_schema,handler,api_exposed,ui_exposed,ai_exposed,verified,implementation_state,source_repository,source_path,dependencies,retry_policy,rollback_policy) VALUES ('orchestration.plans.get','system','Read the authenticated owner''s durable plan and derived job states; contract v1.0.0.','orchestration:read',false,'{"type":"object","required":["plan_id"],"properties":{"plan_id":{"type":"string","format":"uuid"}},"additionalProperties":false}'::jsonb,'{"type":"object","required":["ok","plan_id","state","jobs","atomic_provider_execution"],"properties":{"ok":{"const":true},"plan_id":{"type":"string","format":"uuid"},"state":{"type":"string","enum":["recorded","running","succeeded","failed","cancelled","needs_reconciliation"]},"jobs":{"type":"array","maxItems":50,"items":{"type":"object","required":["job_id","step_key","operation","state"],"properties":{"job_id":{"type":"string","format":"uuid"},"step_key":{"type":"string"},"operation":{"type":"string"},"state":{"type":"string","enum":["queued","leased","running","succeeded","failed","cancelled","blocked","needs_reconciliation","dead_letter"]}},"additionalProperties":false}},"atomic_provider_execution":{"const":false}},"additionalProperties":false}'::jsonb,'sandy-orchestration-api',true,false,true,false,'source_ready','ausstyle/web-staging','supabase/functions/sandy-orchestration-api/index.ts','["enabled_controller_owner","durable_orchestration_schema","canonical_api_scoped_lease_dispatch"]'::jsonb,'{"safe_to_retry":true,"automatic":false,"reason":"admission idempotency key or read-only status; provider retry is governed separately"}'::jsonb,'{"applicable":false,"reason":"initial delegation is nonmutating infrastructure reads; no provider compensation is claimed"}'::jsonb) ON CONFLICT(operation) DO NOTHING;
INSERT INTO public.sandy_operation_registry(operation,domain,description,permission_scope,is_mutation,input_schema,output_schema,handler,api_exposed,ui_exposed,ai_exposed,verified,implementation_state,source_repository,source_path,dependencies,retry_policy,rollback_policy) VALUES ('orchestration.jobs.get','system','Read one owned durable job, attempts and persisted result without exposing lease credentials; contract v1.0.0.','orchestration:read',false,'{"type":"object","required":["job_id"],"properties":{"job_id":{"type":"string","format":"uuid"}},"additionalProperties":false}'::jsonb,'{"type":"object","required":["ok","job"],"properties":{"ok":{"const":true},"job":{"type":"object","required":["id","plan_id","step_key","operation","state","attempts","max_attempts","latest_attempt","result","error_code","created_at","started_at","finished_at","provider_execution_completed","rollback_available"],"properties":{"id":{"type":"string","format":"uuid"},"plan_id":{"type":"string","format":"uuid"},"step_key":{"type":"string"},"operation":{"type":"string"},"state":{"type":"string","enum":["queued","leased","running","succeeded","failed","cancelled","blocked","needs_reconciliation","dead_letter"]},"attempts":{"type":"integer","minimum":0,"maximum":5},"max_attempts":{"type":"integer","minimum":1,"maximum":5},"latest_attempt":{"anyOf":[{"type":"null"},{"type":"object","required":["attempt","dispatch_id","started_at","finished_at","outcome","provider_request_id","execution_admission_id"],"properties":{"attempt":{"type":"integer","minimum":1,"maximum":5},"dispatch_id":{"type":"string","format":"uuid"},"started_at":{"type":"string","format":"date-time"},"finished_at":{"type":["string","null"],"format":"date-time"},"outcome":{"type":["string","null"],"enum":[null,"succeeded","failed","retryable","unknown","lease_expired_outcome_unknown"]},"provider_request_id":{"type":["string","null"],"maxLength":200},"execution_admission_id":{"type":["string","null"],"format":"uuid"}},"additionalProperties":false}]},"result":{},"error_code":{"type":["string","null"]},"created_at":{"type":"string","format":"date-time"},"started_at":{"type":["string","null"],"format":"date-time"},"finished_at":{"type":["string","null"],"format":"date-time"},"provider_execution_completed":{"type":"boolean"},"rollback_available":{"const":false}},"additionalProperties":false}},"additionalProperties":false}'::jsonb,'sandy-orchestration-api',true,false,true,false,'source_ready','ausstyle/web-staging','supabase/functions/sandy-orchestration-api/index.ts','["enabled_controller_owner","durable_orchestration_schema","canonical_api_scoped_lease_dispatch"]'::jsonb,'{"safe_to_retry":true,"automatic":false,"reason":"admission idempotency key or read-only status; provider retry is governed separately"}'::jsonb,'{"applicable":false,"reason":"initial delegation is nonmutating infrastructure reads; no provider compensation is claimed"}'::jsonb) ON CONFLICT(operation) DO NOTHING;
INSERT INTO public.sandy_operation_registry(operation,domain,description,permission_scope,is_mutation,input_schema,output_schema,handler,api_exposed,ui_exposed,ai_exposed,verified,implementation_state,source_repository,source_path,dependencies,retry_policy,rollback_policy) VALUES ('orchestration.jobs.events','system','Read ordered owned-job progress with an exclusive cursor and bounded page; no lease tokens or payloads; contract v1.0.0.','orchestration:read',false,'{"type":"object","required":["job_id"],"properties":{"job_id":{"type":"string","format":"uuid"},"after":{"type":"integer","minimum":0,"maximum":9007199254740991},"limit":{"type":"integer","minimum":1,"maximum":200}},"additionalProperties":false}'::jsonb,'{"type":"object","required":["ok","job_id","events","next_cursor"],"properties":{"ok":{"const":true},"job_id":{"type":"string","format":"uuid"},"events":{"type":"array","maxItems":200,"items":{"type":"object","required":["id","event_type","details","created_at"],"properties":{"id":{"type":"integer","minimum":1},"event_type":{"type":"string"},"details":{"type":"object"},"created_at":{"type":"string","format":"date-time"}},"additionalProperties":false}},"next_cursor":{"type":["integer","null"],"minimum":1}},"additionalProperties":false}'::jsonb,'sandy-orchestration-api',true,false,true,false,'source_ready','ausstyle/web-staging','supabase/functions/sandy-orchestration-api/index.ts','["enabled_controller_owner","durable_orchestration_schema","canonical_api_scoped_lease_dispatch"]'::jsonb,'{"safe_to_retry":true,"automatic":false,"reason":"admission idempotency key or read-only status; provider retry is governed separately"}'::jsonb,'{"applicable":false,"reason":"initial delegation is nonmutating infrastructure reads; no provider compensation is claimed"}'::jsonb) ON CONFLICT(operation) DO NOTHING;
INSERT INTO public.sandy_operation_registry(operation,domain,description,permission_scope,is_mutation,input_schema,output_schema,handler,api_exposed,ui_exposed,ai_exposed,verified,implementation_state,source_repository,source_path,dependencies,retry_policy,rollback_policy) VALUES ('orchestration.jobs.cancel','system','Idempotently cancel owned queued/leased durable jobs before dispatch CAS; refuses running/terminal provider work; contract v1.0.0.','orchestration:write',true,'{"type":"object","required":["job_id"],"properties":{"job_id":{"type":"string","format":"uuid"}},"additionalProperties":false}'::jsonb,'{"type":"object","required":["ok","job_id","state","reused","provider_cancellation"],"properties":{"ok":{"const":true},"job_id":{"type":"string","format":"uuid"},"state":{"const":"cancelled"},"reused":{"type":"boolean"},"provider_cancellation":{"const":false}},"additionalProperties":false}'::jsonb,'sandy-orchestration-api',false,false,false,false,'source_ready','ausstyle/web-staging','supabase/functions/sandy-orchestration-api/index.ts','["enabled_controller_owner","durable_orchestration_schema","canonical_api_scoped_lease_dispatch"]'::jsonb,'{"safe_to_retry":true,"automatic":false,"reason":"admission idempotency key or read-only status; provider retry is governed separately"}'::jsonb,'{"applicable":false,"reason":"initial delegation is nonmutating infrastructure reads; no provider compensation is claimed"}'::jsonb) ON CONFLICT(operation) DO NOTHING;
INSERT INTO public.sandy_operation_registry(operation,domain,description,permission_scope,is_mutation,input_schema,output_schema,handler,api_exposed,ui_exposed,ai_exposed,verified,implementation_state,source_repository,source_path,dependencies,retry_policy,rollback_policy) VALUES ('orchestration.jobs.retry','system','Requeue only an owned failed classified transient read within immutable contract and attempt budget; bounded exponential backoff with jitter, no mutation retry; contract v1.0.0.','orchestration:write',true,'{"type":"object","required":["job_id"],"properties":{"job_id":{"type":"string","format":"uuid"}},"additionalProperties":false}'::jsonb,'{"type":"object","required":["ok","accepted","executed","job_id","state","reused"],"properties":{"ok":{"const":true},"accepted":{"const":true},"executed":{"const":false},"job_id":{"type":"string","format":"uuid"},"state":{"const":"queued"},"reused":{"type":"boolean"}},"additionalProperties":false}'::jsonb,'sandy-orchestration-api',false,false,false,false,'source_ready','ausstyle/web-staging','supabase/functions/sandy-orchestration-api/index.ts','["enabled_controller_owner","durable_orchestration_schema","canonical_api_scoped_lease_dispatch"]'::jsonb,'{"safe_to_retry":true,"automatic":false,"reason":"admission idempotency key or read-only status; provider retry is governed separately"}'::jsonb,'{"applicable":false,"reason":"initial delegation is nonmutating infrastructure reads; no provider compensation is claimed"}'::jsonb) ON CONFLICT(operation) DO NOTHING;
COMMIT;
