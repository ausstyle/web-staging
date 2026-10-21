-- Shared execution policy, short-lived read API credentials and digest-only audit.
-- Service RPC callers must supply an actor already verified by normal Auth.
-- This does not convert Management/service credentials into a customer session.
-- Hash-chain checkpoints require independent external retention for external trust.
BEGIN;
CREATE TABLE public.sandy_api_credentials (
 id uuid PRIMARY KEY, principal_id uuid NOT NULL, tenant_id uuid,
 secret_sha256 text NOT NULL UNIQUE CHECK(secret_sha256 ~ '^[a-f0-9]{64}$'),
 allowed_operations text[] NOT NULL CHECK(cardinality(allowed_operations) BETWEEN 1 AND 32),
 issued_at timestamptz NOT NULL DEFAULT clock_timestamp(), expires_at timestamptz NOT NULL,
 revoked_at timestamptz, requests_per_minute integer NOT NULL CHECK(requests_per_minute BETWEEN 1 AND 60),
 declared_unit_budget bigint NOT NULL CHECK(declared_unit_budget BETWEEN 0 AND 1000000),
 admitted_requests bigint NOT NULL DEFAULT 0, admitted_units bigint NOT NULL DEFAULT 0,
 CHECK(expires_at>issued_at AND expires_at<=issued_at+interval '1 hour')
);
CREATE TABLE public.sandy_api_execution_admissions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), grant_id uuid NOT NULL UNIQUE DEFAULT gen_random_uuid(),
 actor_id uuid NOT NULL, tenant_id uuid, operation text NOT NULL, request_id uuid NOT NULL, is_mutation boolean NOT NULL,
 credential_id uuid REFERENCES public.sandy_api_credentials(id) ON DELETE RESTRICT,
 input_sha256 text NOT NULL CHECK(input_sha256 ~ '^[a-f0-9]{64}$'),
 contract_sha256 text NOT NULL CHECK(contract_sha256 ~ '^[a-f0-9]{64}$'),
 scope_sha256 text NOT NULL CHECK(scope_sha256 ~ '^[a-f0-9]{64}$'),
 registry_revision_sha256 text NOT NULL, declared_cost_units bigint NOT NULL,
 approval_id uuid UNIQUE REFERENCES public.sandy_deployment_jobs(id) ON DELETE RESTRICT,
 state text NOT NULL DEFAULT 'admitted' CHECK(state IN ('admitted','consumed','accepted','succeeded','failed','unknown','rejected')),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(), expires_at timestamptz NOT NULL,
 consumed_at timestamptz, finished_at timestamptz, provider_http_status integer,
 provider_request_id_sha256 text, result_sha256 text,
 UNIQUE(actor_id,request_id), CHECK(declared_cost_units BETWEEN 0 AND 1000000)
);
CREATE TABLE public.sandy_api_rate_windows (
 actor_id uuid NOT NULL, bucket text NOT NULL, window_start timestamptz NOT NULL, requests integer NOT NULL,
 declared_units bigint NOT NULL, PRIMARY KEY(actor_id,bucket,window_start)
);
CREATE TABLE public.sandy_api_mutation_approval_snapshots (
 job_id uuid PRIMARY KEY REFERENCES public.sandy_deployment_jobs(id) ON DELETE RESTRICT,
 actor_id uuid NOT NULL, engineering_change_id uuid NOT NULL,
 operation text NOT NULL, input_sha256 text NOT NULL, contract_sha256 text NOT NULL,
 scope_sha256 text NOT NULL, maximum_declared_cost_units bigint NOT NULL,
 job_fingerprint_sha256 text NOT NULL, recorded_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE SEQUENCE public.sandy_api_audit_sequence;
CREATE TABLE public.sandy_api_audit_events (
 sequence bigint PRIMARY KEY, id uuid NOT NULL UNIQUE, occurred_at timestamptz NOT NULL,
 actor_id uuid, operation text, request_id uuid, credential_id uuid, admission_id uuid,
 phase text NOT NULL, outcome text NOT NULL, input_sha256 text, result_sha256 text,
 provider_http_status integer, provider_request_id_sha256 text,
 previous_sha256 text NOT NULL, event_sha256 text NOT NULL,
 format text NOT NULL DEFAULT 'pg_jsonb_v1' CHECK(format='pg_jsonb_v1')
);
CREATE TABLE public.sandy_api_audit_head (
 singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton), sequence bigint NOT NULL,
 event_sha256 text NOT NULL
);
INSERT INTO public.sandy_api_audit_head VALUES(true,0,repeat('0',64));
CREATE TABLE public.sandy_api_audit_checkpoints (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), sequence bigint NOT NULL,
 event_sha256 text NOT NULL, recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 recorded_by uuid NOT NULL
);
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['sandy_api_credentials','sandy_api_execution_admissions','sandy_api_rate_windows','sandy_api_mutation_approval_snapshots','sandy_api_audit_events','sandy_api_audit_head','sandy_api_audit_checkpoints'] LOOP
  EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC,anon,authenticated,service_role',t);
 END LOOP;
END $$;
REVOKE ALL ON SEQUENCE public.sandy_api_audit_sequence FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.sandy_api_current_owner(p_actor_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
 SELECT EXISTS(SELECT 1 FROM public.sandy_controller_admins WHERE auth_user_id=p_actor_id AND enabled=true AND role='owner')
$$;
CREATE FUNCTION public.sandy_api_registry_revision(p_operation text) RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
 SELECT encode(extensions.digest(jsonb_build_object('operation',operation,'handler',handler,
 'permission_scope',permission_scope,'is_mutation',is_mutation,'input_schema',input_schema,
 'output_schema',output_schema,'api_exposed',api_exposed,'verified',verified,'error_contract',error_contract)::text,'sha256'),'hex')
 FROM public.sandy_operation_registry WHERE operation=p_operation
$$;
CREATE FUNCTION public.sandy_api_job_fingerprint(p_job public.sandy_deployment_jobs) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path=pg_catalog,pg_temp AS $$
 SELECT encode(extensions.digest(jsonb_build_object('id',p_job.id,'requested_by',p_job.requested_by,
 'provider',p_job.provider,'operation',p_job.operation,'target',p_job.target,'payload',p_job.payload,
 'approved_by',p_job.approved_by,'approved_at',to_char(p_job.approved_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
 'engineering_change_id',p_job.engineering_change_id)::text,'sha256'),'hex')
$$;
CREATE FUNCTION public.sandy_api_audit_payload(p_event public.sandy_api_audit_events) RETURNS jsonb
LANGUAGE sql IMMUTABLE SET search_path=pg_catalog,pg_temp AS $$
 SELECT jsonb_build_object('format',p_event.format,'sequence',p_event.sequence,'id',p_event.id,
 'occurred_at',to_char(p_event.occurred_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'actor_id',p_event.actor_id,'operation',p_event.operation,
 'request_id',p_event.request_id,'credential_id',p_event.credential_id,'admission_id',p_event.admission_id,
 'phase',p_event.phase,'outcome',p_event.outcome,'input_sha256',p_event.input_sha256,
 'result_sha256',p_event.result_sha256,'provider_http_status',p_event.provider_http_status,
 'provider_request_id_sha256',p_event.provider_request_id_sha256)
$$;
CREATE FUNCTION public.sandy_api_append_audit(p_actor_id uuid,p_operation text,p_request_id uuid,
 p_credential_id uuid,p_admission_id uuid,p_phase text,p_outcome text,p_input_sha256 text DEFAULT NULL,
 p_result_sha256 text DEFAULT NULL,p_provider_http_status integer DEFAULT NULL,
 p_provider_request_id_sha256 text DEFAULT NULL) RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE e public.sandy_api_audit_events%ROWTYPE; previous_hash text;
BEGIN
 SELECT event_sha256 INTO previous_hash FROM public.sandy_api_audit_head WHERE singleton FOR UPDATE;
 e.sequence:=nextval('public.sandy_api_audit_sequence');e.id:=gen_random_uuid();e.occurred_at:=clock_timestamp();
 e.actor_id:=p_actor_id;e.operation:=p_operation;e.request_id:=p_request_id;e.credential_id:=p_credential_id;
 e.admission_id:=p_admission_id;e.phase:=p_phase;e.outcome:=p_outcome;e.input_sha256:=p_input_sha256;
 e.result_sha256:=p_result_sha256;e.provider_http_status:=p_provider_http_status;
 e.provider_request_id_sha256:=p_provider_request_id_sha256;e.previous_sha256:=previous_hash;e.format:='pg_jsonb_v1';
 e.event_sha256:=encode(extensions.digest(previous_hash||public.sandy_api_audit_payload(e)::text,'sha256'),'hex');
 INSERT INTO public.sandy_api_audit_events SELECT e.*;
 UPDATE public.sandy_api_audit_head SET sequence=e.sequence,event_sha256=e.event_sha256 WHERE singleton;
 RETURN e.sequence;
END $$;
CREATE FUNCTION public.sandy_api_refuse_audit_edit() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,pg_temp AS $$ BEGIN
 RAISE EXCEPTION 'sandy_api_append_only_audit' USING ERRCODE='23514';
END $$;
CREATE TRIGGER sandy_api_audit_append_only BEFORE UPDATE OR DELETE ON public.sandy_api_audit_events
FOR EACH ROW EXECUTE FUNCTION public.sandy_api_refuse_audit_edit();
CREATE TRIGGER sandy_api_checkpoint_append_only BEFORE UPDATE OR DELETE ON public.sandy_api_audit_checkpoints
FOR EACH ROW EXECUTE FUNCTION public.sandy_api_refuse_audit_edit();

CREATE FUNCTION public.sandy_api_refuse_approval_snapshot_edit() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,pg_temp AS $$ BEGIN
 RAISE EXCEPTION 'sandy_api_immutable_approval_snapshot' USING ERRCODE='23514';
END $$;
CREATE TRIGGER sandy_api_approval_snapshot_immutable BEFORE UPDATE OR DELETE ON public.sandy_api_mutation_approval_snapshots
FOR EACH ROW EXECUTE FUNCTION public.sandy_api_refuse_approval_snapshot_edit();

CREATE FUNCTION public.sandy_api_capture_mutation_approval() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE manifest jsonb; approver uuid; cap bigint;
BEGIN
 IF NEW.status<>'approved' OR (TG_OP='UPDATE' AND OLD.status<>'pending_approval')
  OR NEW.approved_at IS NULL OR NEW.engineering_change_id IS NULL THEN RETURN NEW; END IF;
 manifest:=NEW.payload->'sandy_api_execution';
 IF jsonb_typeof(manifest) IS DISTINCT FROM 'object' OR NEW.approved_by IS NULL
  OR NEW.approved_by !~* '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$' THEN RETURN NEW; END IF;
 approver:=NEW.approved_by::uuid;
 IF NOT public.sandy_api_current_owner(approver) OR NOT EXISTS(SELECT 1 FROM public.sandy_engineering_changes
  WHERE id=NEW.engineering_change_id AND status='approved') THEN RETURN NEW; END IF;
 IF coalesce(manifest->>'operation','') !~ '^[a-z][a-z0-9_.-]{2,100}$'
  OR coalesce(manifest->>'input_sha256','') !~ '^[a-f0-9]{64}$'
  OR coalesce(manifest->>'contract_sha256','') !~ '^[a-f0-9]{64}$'
  OR coalesce(manifest->>'scope_sha256','') !~ '^[a-f0-9]{64}$'
  OR coalesce(manifest->>'maximum_declared_cost_units','') !~ '^[0-9]{1,7}$' THEN RETURN NEW; END IF;
 cap:=(manifest->>'maximum_declared_cost_units')::bigint;
 IF cap>1000000 THEN RETURN NEW; END IF;
 INSERT INTO public.sandy_api_mutation_approval_snapshots(job_id,actor_id,engineering_change_id,operation,
  input_sha256,contract_sha256,scope_sha256,maximum_declared_cost_units,job_fingerprint_sha256)
 VALUES(NEW.id,approver,NEW.engineering_change_id,manifest->>'operation',manifest->>'input_sha256',
  manifest->>'contract_sha256',manifest->>'scope_sha256',cap,public.sandy_api_job_fingerprint(NEW))
 ON CONFLICT(job_id) DO NOTHING;
 RETURN NEW;
END $$;
CREATE TRIGGER sandy_api_capture_mutation_approval AFTER INSERT OR UPDATE OF status ON public.sandy_deployment_jobs
FOR EACH ROW EXECUTE FUNCTION public.sandy_api_capture_mutation_approval();

CREATE FUNCTION public.sandy_api_issue_credential(p_actor_id uuid,p_credential_id uuid,p_secret_sha256 text,
 p_tenant_id uuid,p_allowed_operations text[],p_ttl_seconds integer,p_requests_per_minute integer,
 p_declared_unit_budget bigint) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE allowed_op text; entry public.sandy_operation_registry%ROWTYPE; issued timestamptz:=clock_timestamp();
BEGIN
 IF NOT public.sandy_api_current_owner(p_actor_id) THEN RETURN jsonb_build_object('ok',false,'error','owner_required','http_status',403); END IF;
 IF p_tenant_id IS NOT NULL THEN RETURN jsonb_build_object('ok',false,'error','tenant_api_key_backend_unavailable','http_status',422); END IF;
 IF p_credential_id IS NULL OR p_secret_sha256 IS NULL OR p_ttl_seconds IS NULL OR p_requests_per_minute IS NULL OR p_declared_unit_budget IS NULL OR p_secret_sha256 !~ '^[a-f0-9]{64}$' OR p_ttl_seconds NOT BETWEEN 60 AND 3600
  OR p_requests_per_minute NOT BETWEEN 1 AND 60 OR p_declared_unit_budget NOT BETWEEN 0 AND 1000000
  OR cardinality(p_allowed_operations) NOT BETWEEN 1 AND 32 OR p_allowed_operations IS NULL
  OR EXISTS(SELECT 1 FROM unnest(p_allowed_operations) AS op GROUP BY op HAVING count(*)>1) THEN
  RETURN jsonb_build_object('ok',false,'error','invalid_credential_policy','http_status',400); END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('credential:'||p_actor_id::text,0));
 IF (SELECT count(*) FROM public.sandy_api_credentials WHERE principal_id=p_actor_id AND revoked_at IS NULL AND expires_at>clock_timestamp())>=32 THEN
 RETURN jsonb_build_object('ok',false,'error','credential_limit_exceeded','http_status',429); END IF;
 FOREACH allowed_op IN ARRAY p_allowed_operations LOOP
  SELECT * INTO entry FROM public.sandy_operation_registry WHERE sandy_operation_registry.operation=allowed_op;
  IF NOT FOUND OR entry.api_exposed IS DISTINCT FROM true OR entry.is_mutation IS DISTINCT FROM false
   OR entry.handler IS NULL OR entry.permission_scope IS NULL
   OR entry.handler NOT IN ('sandy-provider-read-api','sandy-infrastructure-read','sandy-deploy-provision','sandy-provider-operation-api')
   OR entry.permission_scope NOT IN ('infrastructure:read','deployment:read','engineering:read','system:read')
   OR entry.error_contract->>'requires_approval'='true'
   OR entry.error_contract->>'api_key_delegable'='false'
   OR (entry.handler='sandy-provider-operation-api' AND entry.error_contract->>'api_key_delegable' IS DISTINCT FROM 'true') THEN
   RETURN jsonb_build_object('ok',false,'error','credential_operation_not_delegable','http_status',403); END IF;
 END LOOP;
 INSERT INTO public.sandy_api_credentials(id,principal_id,tenant_id,secret_sha256,allowed_operations,
 issued_at,expires_at,requests_per_minute,declared_unit_budget)
 VALUES(p_credential_id,p_actor_id,p_tenant_id,p_secret_sha256,p_allowed_operations,issued,
 issued+make_interval(secs=>p_ttl_seconds),p_requests_per_minute,p_declared_unit_budget);
 PERFORM public.sandy_api_append_audit(p_actor_id,'security.api_keys.issue',NULL,p_credential_id,NULL,'credential','issued');
 RETURN jsonb_build_object('ok',true,'credential_id',p_credential_id,'principal_id',p_actor_id,'tenant_id',p_tenant_id,
 'allowed_operations',p_allowed_operations,'expires_at',issued+make_interval(secs=>p_ttl_seconds),
 'requests_per_minute',p_requests_per_minute,'declared_unit_budget',p_declared_unit_budget,'unit_kind','caller_declared_units_not_money');
END $$;
CREATE FUNCTION public.sandy_api_authenticate_credential(p_credential_id uuid,p_secret_sha256 text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE credential public.sandy_api_credentials%ROWTYPE;
BEGIN
 SELECT * INTO credential FROM public.sandy_api_credentials WHERE id=p_credential_id;
 IF NOT FOUND OR p_secret_sha256 IS DISTINCT FROM credential.secret_sha256 OR credential.revoked_at IS NOT NULL
 OR credential.expires_at<=clock_timestamp() OR NOT public.sandy_api_current_owner(credential.principal_id) THEN
  RETURN jsonb_build_object('ok',false,'error','invalid_api_credential','http_status',401); END IF;
 RETURN jsonb_build_object('ok',true,'credential_id',credential.id,'principal_id',credential.principal_id,
 'tenant_id',credential.tenant_id,'allowed_operations',credential.allowed_operations,'expires_at',credential.expires_at);
END $$;
CREATE FUNCTION public.sandy_api_revoke_credential(p_actor_id uuid,p_credential_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE revoked timestamptz; principal uuid;
BEGIN
 IF NOT public.sandy_api_current_owner(p_actor_id) THEN RETURN jsonb_build_object('ok',false,'error','owner_required','http_status',403); END IF;
 SELECT principal_id,revoked_at INTO principal,revoked FROM public.sandy_api_credentials WHERE id=p_credential_id FOR UPDATE;
 IF NOT FOUND OR principal IS DISTINCT FROM p_actor_id THEN RETURN jsonb_build_object('ok',false,'error','credential_not_found','http_status',404); END IF;
 IF revoked IS NULL THEN
  UPDATE public.sandy_api_credentials SET revoked_at=clock_timestamp() WHERE id=p_credential_id;
  PERFORM public.sandy_api_append_audit(p_actor_id,'security.api_keys.revoke',NULL,p_credential_id,NULL,'credential','revoked');
 END IF;
 RETURN jsonb_build_object('ok',true,'credential_id',p_credential_id,'revoked',true,'already_revoked',revoked IS NOT NULL);
END $$;

CREATE FUNCTION public.sandy_api_admit_execution(p_actor_id uuid,p_tenant_id uuid,p_operation text,p_input_sha256 text,
 p_request_id uuid,p_credential_id uuid DEFAULT NULL,p_contract_sha256 text DEFAULT NULL,p_scope_sha256 text DEFAULT NULL,
 p_declared_cost_units bigint DEFAULT 0,p_approval_id uuid DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE entry public.sandy_operation_registry%ROWTYPE; prior public.sandy_api_execution_admissions%ROWTYPE;
 credential public.sandy_api_credentials%ROWTYPE; proof public.sandy_api_mutation_approval_snapshots%ROWTYPE;
 job public.sandy_deployment_jobs%ROWTYPE; active_window timestamptz:=date_trunc('minute',clock_timestamp());
 requests integer; units bigint; request_limit integer:=60; admission public.sandy_api_execution_admissions%ROWTYPE;
BEGIN
 IF NOT public.sandy_api_current_owner(p_actor_id) THEN RETURN jsonb_build_object('ok',false,'allowed',false,'error','owner_required','http_status',403); END IF;
 IF p_tenant_id IS NOT NULL THEN RETURN jsonb_build_object('ok',false,'allowed',false,'error','tenant_execution_policy_unavailable','http_status',422); END IF;
 IF p_request_id IS NULL OR p_operation IS NULL OR p_input_sha256 IS NULL OR p_declared_cost_units IS NULL OR p_operation !~ '^[a-z][a-z0-9_.-]{2,100}$' OR p_input_sha256 !~ '^[a-f0-9]{64}$'
  OR p_contract_sha256 IS NULL OR p_contract_sha256 !~ '^[a-f0-9]{64}$' OR p_scope_sha256 IS NULL OR p_scope_sha256 !~ '^[a-f0-9]{64}$'
  OR p_declared_cost_units NOT BETWEEN 0 AND 1000000 THEN RETURN jsonb_build_object('ok',false,'allowed',false,'error','invalid_execution_admission','http_status',400); END IF;
 -- Actor/request lock serializes retries before any counter, approval or audit write.
 PERFORM pg_advisory_xact_lock(hashtextextended(p_actor_id::text||':'||p_request_id::text,0));
 SELECT * INTO prior FROM public.sandy_api_execution_admissions WHERE actor_id=p_actor_id AND request_id=p_request_id;
 IF FOUND THEN
  IF prior.tenant_id IS DISTINCT FROM p_tenant_id OR prior.operation IS DISTINCT FROM p_operation
   OR prior.input_sha256 IS DISTINCT FROM p_input_sha256 OR prior.contract_sha256 IS DISTINCT FROM p_contract_sha256
   OR prior.scope_sha256 IS DISTINCT FROM p_scope_sha256 OR prior.credential_id IS DISTINCT FROM p_credential_id
   OR prior.approval_id IS DISTINCT FROM p_approval_id OR prior.declared_cost_units IS DISTINCT FROM p_declared_cost_units THEN
   RETURN jsonb_build_object('ok',false,'allowed',false,'error','request_id_conflict','http_status',409); END IF;
  RETURN jsonb_build_object('ok',true,'allowed',false,'admission_id',prior.id,'grant_id',prior.grant_id,
   'reused',true,'state',prior.state,'expires_at',prior.expires_at,'executed',false,'error','admission_already_recorded','http_status',409);
 END IF;
 SELECT * INTO entry FROM public.sandy_operation_registry WHERE operation=p_operation;
 IF NOT FOUND OR entry.api_exposed IS DISTINCT FROM true THEN RETURN jsonb_build_object('ok',false,'allowed',false,'error','operation_not_exposed','http_status',404); END IF;
 IF entry.error_contract ? 'contract_sha256' AND entry.error_contract->>'contract_sha256' IS DISTINCT FROM p_contract_sha256 THEN RETURN jsonb_build_object('ok',false,'allowed',false,'error','execution_contract_changed','http_status',409); END IF;
 IF p_credential_id IS NOT NULL THEN
  SELECT * INTO credential FROM public.sandy_api_credentials WHERE id=p_credential_id FOR UPDATE;
  IF NOT FOUND OR credential.principal_id<>p_actor_id OR credential.tenant_id IS DISTINCT FROM p_tenant_id
   OR credential.revoked_at IS NOT NULL OR credential.expires_at<=clock_timestamp()
   OR NOT p_operation=ANY(credential.allowed_operations) OR entry.is_mutation IS DISTINCT FROM false
   OR entry.handler IS NULL OR entry.permission_scope IS NULL
   OR entry.handler NOT IN ('sandy-provider-read-api','sandy-infrastructure-read','sandy-deploy-provision','sandy-provider-operation-api')
   OR entry.permission_scope NOT IN ('infrastructure:read','deployment:read','engineering:read','system:read')
   OR entry.error_contract->>'requires_approval'='true'
   OR entry.error_contract->>'api_key_delegable'='false'
   OR (entry.handler='sandy-provider-operation-api' AND entry.error_contract->>'api_key_delegable' IS DISTINCT FROM 'true') THEN
   RETURN jsonb_build_object('ok',false,'allowed',false,'error','credential_scope_denied','http_status',403); END IF;
  IF credential.admitted_units+p_declared_cost_units>credential.declared_unit_budget THEN
   RETURN jsonb_build_object('ok',false,'allowed',false,'error','declared_unit_budget_exceeded','http_status',429); END IF;
  request_limit:=credential.requests_per_minute;
 END IF;
 IF entry.is_mutation OR entry.error_contract->>'requires_approval'='true' THEN
  IF p_credential_id IS NOT NULL OR entry.verified IS DISTINCT FROM true THEN
   RETURN jsonb_build_object('ok',false,'allowed',false,'error','mutation_requires_verified_auth_approval','http_status',424); END IF;
  SELECT * INTO proof FROM public.sandy_api_mutation_approval_snapshots WHERE job_id=p_approval_id;
  SELECT * INTO job FROM public.sandy_deployment_jobs WHERE id=p_approval_id FOR UPDATE;
  IF proof.job_id IS NULL OR job.id IS NULL OR job.status<>'approved' OR proof.actor_id<>p_actor_id
   OR NOT public.sandy_api_current_owner(proof.actor_id) OR proof.operation<>p_operation
   OR proof.input_sha256<>p_input_sha256 OR proof.contract_sha256<>p_contract_sha256 OR proof.scope_sha256<>p_scope_sha256
   OR p_declared_cost_units>proof.maximum_declared_cost_units
   OR proof.job_fingerprint_sha256<>public.sandy_api_job_fingerprint(job)
   OR NOT EXISTS(SELECT 1 FROM public.sandy_engineering_changes WHERE id=proof.engineering_change_id AND status='approved') THEN
   RETURN jsonb_build_object('ok',false,'allowed',false,'error','scoped_mutation_approval_required','http_status',403); END IF;
 ELSE
  IF p_approval_id IS NOT NULL THEN RETURN jsonb_build_object('ok',false,'allowed',false,'error','read_approval_unexpected','http_status',400); END IF;
 END IF;
 INSERT INTO public.sandy_api_rate_windows(actor_id,bucket,window_start,requests,declared_units)
 VALUES(p_actor_id,'principal',active_window,0,0) ON CONFLICT DO NOTHING;
 SELECT w.requests,w.declared_units INTO requests,units FROM public.sandy_api_rate_windows w
 WHERE actor_id=p_actor_id AND w.bucket='principal' AND w.window_start=active_window FOR UPDATE;
 IF requests>=60 OR units+p_declared_cost_units>1000000 THEN
  RETURN jsonb_build_object('ok',false,'allowed',false,'error','admission_rate_or_declared_units_exceeded','http_status',429); END IF;
 IF p_credential_id IS NOT NULL THEN
  INSERT INTO public.sandy_api_rate_windows(actor_id,bucket,window_start,requests,declared_units)
  VALUES(p_actor_id,p_credential_id::text,active_window,0,0) ON CONFLICT DO NOTHING;
  SELECT w.requests INTO requests FROM public.sandy_api_rate_windows w WHERE actor_id=p_actor_id
   AND w.bucket=p_credential_id::text AND w.window_start=active_window FOR UPDATE;
  IF requests>=request_limit THEN RETURN jsonb_build_object('ok',false,'allowed',false,'error','admission_rate_or_declared_units_exceeded','http_status',429); END IF;
 END IF;
 INSERT INTO public.sandy_api_execution_admissions(actor_id,tenant_id,operation,request_id,is_mutation,credential_id,input_sha256,
 contract_sha256,scope_sha256,registry_revision_sha256,declared_cost_units,approval_id,expires_at)
 VALUES(p_actor_id,p_tenant_id,p_operation,p_request_id,entry.is_mutation,p_credential_id,p_input_sha256,p_contract_sha256,p_scope_sha256,
 public.sandy_api_registry_revision(p_operation),p_declared_cost_units,p_approval_id,clock_timestamp()+interval '60 seconds') RETURNING * INTO admission;
 UPDATE public.sandy_api_rate_windows w SET requests=w.requests+1,declared_units=w.declared_units+p_declared_cost_units
 WHERE actor_id=p_actor_id AND w.bucket='principal' AND w.window_start=active_window;
 IF p_credential_id IS NOT NULL THEN
 UPDATE public.sandy_api_rate_windows w SET requests=w.requests+1,declared_units=w.declared_units+p_declared_cost_units
 WHERE actor_id=p_actor_id AND w.bucket=p_credential_id::text AND w.window_start=active_window;
 UPDATE public.sandy_api_credentials SET admitted_requests=admitted_requests+1,
 admitted_units=admitted_units+p_declared_cost_units WHERE id=p_credential_id; END IF;
 PERFORM public.sandy_api_append_audit(p_actor_id,p_operation,p_request_id,p_credential_id,admission.id,'admission','admitted',p_input_sha256);
 RETURN jsonb_build_object('ok',true,'allowed',true,'admission_id',admission.id,'grant_id',admission.grant_id,
 'reused',false,'state','admitted','expires_at',admission.expires_at,'executed',false,
 'unit_kind','caller_declared_units_not_money','provider_price_known',false);
END $$;

CREATE FUNCTION public.sandy_api_consume_execution_grant(p_grant_id uuid,p_actor_id uuid,p_tenant_id uuid,
 p_operation text,p_input_sha256 text,p_request_id uuid,p_contract_sha256 text,p_scope_sha256 text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE admission public.sandy_api_execution_admissions%ROWTYPE; credential public.sandy_api_credentials%ROWTYPE;
 entry public.sandy_operation_registry%ROWTYPE; proof public.sandy_api_mutation_approval_snapshots%ROWTYPE;
 job public.sandy_deployment_jobs%ROWTYPE;
BEGIN
 SELECT * INTO admission FROM public.sandy_api_execution_admissions WHERE grant_id=p_grant_id FOR UPDATE;
 IF NOT FOUND OR NOT public.sandy_api_current_owner(p_actor_id) OR admission.actor_id IS DISTINCT FROM p_actor_id
  OR admission.tenant_id IS DISTINCT FROM p_tenant_id OR admission.operation IS DISTINCT FROM p_operation
  OR admission.input_sha256 IS DISTINCT FROM p_input_sha256 OR admission.request_id IS DISTINCT FROM p_request_id
  OR admission.contract_sha256 IS DISTINCT FROM p_contract_sha256 OR admission.scope_sha256 IS DISTINCT FROM p_scope_sha256 THEN
  RETURN jsonb_build_object('ok',false,'allowed',false,'error','execution_grant_scope_denied','http_status',403,'executed',false); END IF;
 IF admission.state<>'admitted' OR admission.expires_at<=clock_timestamp() THEN
  RETURN jsonb_build_object('ok',false,'allowed',false,'error','execution_grant_used_or_expired','http_status',409,'executed',false); END IF;
 SELECT * INTO entry FROM public.sandy_operation_registry WHERE operation=p_operation;
 IF entry.operation IS NULL OR entry.api_exposed IS DISTINCT FROM true OR
  admission.registry_revision_sha256 IS DISTINCT FROM public.sandy_api_registry_revision(p_operation) THEN
  RETURN jsonb_build_object('ok',false,'allowed',false,'error','execution_contract_changed','http_status',409,'executed',false); END IF;
 IF admission.credential_id IS NOT NULL THEN
  SELECT * INTO credential FROM public.sandy_api_credentials WHERE id=admission.credential_id;
  IF credential.revoked_at IS NOT NULL OR credential.expires_at<=clock_timestamp() OR
   NOT p_operation=ANY(credential.allowed_operations) THEN RETURN jsonb_build_object('ok',false,'allowed',false,
   'error','execution_credential_revoked_or_expired','http_status',403,'executed',false); END IF;
 END IF;
 IF entry.is_mutation OR entry.error_contract->>'requires_approval'='true' THEN
  SELECT * INTO proof FROM public.sandy_api_mutation_approval_snapshots WHERE job_id=admission.approval_id;
  SELECT * INTO job FROM public.sandy_deployment_jobs WHERE id=admission.approval_id FOR UPDATE;
  IF entry.verified IS DISTINCT FROM true OR admission.credential_id IS NOT NULL OR proof.job_id IS NULL
   OR job.status IS DISTINCT FROM 'approved' OR proof.actor_id IS DISTINCT FROM p_actor_id
   OR proof.job_fingerprint_sha256 IS DISTINCT FROM public.sandy_api_job_fingerprint(job)
   OR NOT EXISTS(SELECT 1 FROM public.sandy_engineering_changes WHERE id=proof.engineering_change_id AND status='approved') THEN
   RETURN jsonb_build_object('ok',false,'allowed',false,'error','mutation_approval_changed','http_status',409,'executed',false); END IF;
  UPDATE public.sandy_deployment_jobs SET status='running',started_at=clock_timestamp(),updated_at=clock_timestamp()
   WHERE id=admission.approval_id;
 END IF;
 UPDATE public.sandy_api_execution_admissions SET state='consumed',consumed_at=clock_timestamp() WHERE id=admission.id;
 PERFORM public.sandy_api_append_audit(p_actor_id,p_operation,p_request_id,admission.credential_id,admission.id,'grant','consumed',p_input_sha256);
 RETURN jsonb_build_object('ok',true,'allowed',true,'admission_id',admission.id,'reused',false,'executed',false);
END $$;

CREATE FUNCTION public.sandy_api_finish_execution(p_admission_id uuid,p_outcome text,p_provider_http_status integer,
 p_provider_request_id text,p_result_sha256 text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE admission public.sandy_api_execution_admissions%ROWTYPE; request_hash text;
BEGIN
 IF p_outcome IS NULL OR p_outcome NOT IN ('accepted','succeeded','failed','unknown') OR p_result_sha256 IS NULL OR p_result_sha256 !~ '^[a-f0-9]{64}$'
 OR (p_provider_http_status IS NOT NULL AND p_provider_http_status NOT BETWEEN 100 AND 599)
 OR (p_outcome='accepted' AND (p_provider_http_status IS NULL OR p_provider_http_status NOT BETWEEN 200 AND 299))
 OR length(coalesce(p_provider_request_id,''))>1000 THEN RETURN jsonb_build_object('ok',false,'error','invalid_execution_receipt','http_status',400); END IF;
 request_hash:=CASE WHEN p_provider_request_id IS NULL THEN NULL ELSE encode(extensions.digest(p_provider_request_id,'sha256'),'hex') END;
 SELECT * INTO admission FROM public.sandy_api_execution_admissions WHERE id=p_admission_id FOR UPDATE;
 IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'error','admission_not_found','http_status',404); END IF;
 IF admission.is_mutation AND p_outcome='succeeded' THEN RETURN jsonb_build_object('ok',false,'error','mutation_readback_required','http_status',409); END IF;
 IF admission.state IN ('accepted','succeeded','failed','unknown') THEN
  IF admission.state=p_outcome AND admission.provider_http_status IS NOT DISTINCT FROM p_provider_http_status
   AND admission.provider_request_id_sha256 IS NOT DISTINCT FROM request_hash AND admission.result_sha256=p_result_sha256 THEN
   RETURN jsonb_build_object('ok',true,'admission_id',admission.id,'state',admission.state,'reused',true); END IF;
  RETURN jsonb_build_object('ok',false,'error','execution_receipt_conflict','http_status',409); END IF;
 IF admission.state<>'consumed' THEN RETURN jsonb_build_object('ok',false,'error','execution_grant_not_consumed','http_status',409); END IF;
 UPDATE public.sandy_api_execution_admissions SET state=p_outcome,finished_at=clock_timestamp(),
 provider_http_status=p_provider_http_status,provider_request_id_sha256=request_hash,result_sha256=p_result_sha256 WHERE id=p_admission_id;
 IF admission.approval_id IS NOT NULL THEN
  UPDATE public.sandy_deployment_jobs SET status=CASE WHEN p_outcome IN ('accepted','unknown') THEN 'running' ELSE p_outcome END,
   result=jsonb_build_object('source','sandy-api','admission_id',admission.id,'result_sha256',p_result_sha256,
    'provider_http_status',p_provider_http_status,'provider_request_id_sha256',request_hash,
    'reconciliation_required',p_outcome IN ('accepted','unknown'),'provider_request_accepted',p_outcome='accepted'),
   error=CASE WHEN p_outcome='unknown' THEN 'provider_outcome_unknown_reconciliation_required' WHEN p_outcome='failed' THEN 'provider_execution_failed' ELSE NULL END,
   finished_at=CASE WHEN p_outcome IN ('accepted','unknown') THEN NULL ELSE clock_timestamp() END,updated_at=clock_timestamp()
  WHERE id=admission.approval_id AND status='running';
 END IF;
 PERFORM public.sandy_api_append_audit(admission.actor_id,admission.operation,admission.request_id,admission.credential_id,
 admission.id,'execution',p_outcome,admission.input_sha256,p_result_sha256,p_provider_http_status,request_hash);
 RETURN jsonb_build_object('ok',true,'admission_id',admission.id,'state',p_outcome,'reused',false,
 'reconciliation_required',p_outcome IN ('accepted','unknown'));
END $$;

-- A receipt is evidence of an existing attempt, never permission to redispatch.
-- API keys may inspect only attempts originally admitted under that exact key.
CREATE FUNCTION public.sandy_api_get_execution_receipt(p_actor_id uuid,p_request_id uuid,
 p_credential_id uuid DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE admission public.sandy_api_execution_admissions%ROWTYPE; credential public.sandy_api_credentials%ROWTYPE;
 dispatched boolean; reconcile boolean;
BEGIN
 IF NOT public.sandy_api_current_owner(p_actor_id) THEN RETURN jsonb_build_object('ok',false,'error','owner_required','http_status',403); END IF;
 IF p_request_id IS NULL THEN RETURN jsonb_build_object('ok',false,'error','invalid_execution_receipt','http_status',400); END IF;
 IF p_credential_id IS NOT NULL THEN
  SELECT * INTO credential FROM public.sandy_api_credentials WHERE id=p_credential_id;
  IF NOT FOUND OR credential.principal_id IS DISTINCT FROM p_actor_id OR credential.tenant_id IS NOT NULL
   OR credential.revoked_at IS NOT NULL OR credential.expires_at<=clock_timestamp() THEN
   RETURN jsonb_build_object('ok',false,'error','invalid_api_credential','http_status',401); END IF;
 END IF;
 SELECT * INTO admission FROM public.sandy_api_execution_admissions WHERE actor_id=p_actor_id AND request_id=p_request_id;
 IF NOT FOUND OR (p_credential_id IS NOT NULL AND (admission.credential_id IS DISTINCT FROM p_credential_id
  OR NOT admission.operation=ANY(credential.allowed_operations))) THEN
  RETURN jsonb_build_object('ok',false,'error','admission_not_found','http_status',404); END IF;
 dispatched:=CASE WHEN admission.state IN ('admitted','rejected') THEN false
  WHEN admission.state IN ('accepted','succeeded') THEN true
  WHEN admission.state='failed' AND admission.provider_http_status IS NOT NULL THEN true ELSE NULL END;
 reconcile:=admission.state IN ('consumed','accepted','unknown');
 RETURN jsonb_build_object('ok',true,'admission_id',admission.id,'request_id',admission.request_id,
  'operation',admission.operation,'request_state',admission.state,'accepted',admission.state='accepted',
  'executed',dispatched,'completed',admission.state='succeeded',
  'outcome',CASE WHEN admission.state IN ('admitted','consumed') THEN 'pending' ELSE admission.state END,
  'provider_http_status',admission.provider_http_status,'provider_request_id_sha256',admission.provider_request_id_sha256,
  'result_sha256',admission.result_sha256,'reconciliation_required',reconcile,
  'redispatch_permitted',false,'created_at',admission.created_at,'finished_at',admission.finished_at);
END $$;

CREATE FUNCTION public.sandy_api_read_audit(p_actor_id uuid,p_after_sequence bigint DEFAULT 0,p_limit integer DEFAULT 100,
 p_operation text DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE rows jsonb;
BEGIN
 IF NOT public.sandy_api_current_owner(p_actor_id) THEN RETURN jsonb_build_object('ok',false,'error','owner_required','http_status',403); END IF;
 IF p_after_sequence IS NULL OR p_limit IS NULL OR p_after_sequence<0 OR p_limit NOT BETWEEN 1 AND 500 OR (p_operation IS NOT NULL AND p_operation !~ '^[a-z][a-z0-9_.-]{2,100}$') THEN
 RETURN jsonb_build_object('ok',false,'error','invalid_audit_query','http_status',400); END IF;
 SELECT coalesce(jsonb_agg(to_jsonb(e) ORDER BY sequence),'[]'::jsonb) INTO rows FROM
 (SELECT * FROM public.sandy_api_audit_events WHERE sequence>p_after_sequence
 AND (p_operation IS NULL OR operation=p_operation) ORDER BY sequence LIMIT p_limit) AS e;
 RETURN jsonb_build_object('ok',true,'events',rows,'limit',p_limit,'possibly_truncated',jsonb_array_length(rows)=p_limit,
 'external_anchor_established',false);
END $$;
CREATE FUNCTION public.sandy_api_checkpoint_audit(p_actor_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE head public.sandy_api_audit_head%ROWTYPE; checkpoint public.sandy_api_audit_checkpoints%ROWTYPE;
BEGIN
 IF NOT public.sandy_api_current_owner(p_actor_id) THEN RETURN jsonb_build_object('ok',false,'error','owner_required','http_status',403); END IF;
 SELECT * INTO head FROM public.sandy_api_audit_head WHERE singleton FOR SHARE;
 INSERT INTO public.sandy_api_audit_checkpoints(sequence,event_sha256,recorded_by)
 VALUES(head.sequence,head.event_sha256,p_actor_id) RETURNING * INTO checkpoint;
 RETURN jsonb_build_object('ok',true,'checkpoint',to_jsonb(checkpoint),'external_anchor_established',false,
 'limitation','Database administrators can rewrite both chain and checkpoints; retain checkpoint externally for independent trust');
END $$;
CREATE FUNCTION public.sandy_api_verify_audit(p_actor_id uuid,p_after_sequence bigint DEFAULT 0,
 p_expected_previous_sha256 text DEFAULT NULL,p_limit integer DEFAULT 1000) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE head public.sandy_api_audit_head%ROWTYPE; e public.sandy_api_audit_events%ROWTYPE;
 previous_hash text:=repeat('0',64); last_sequence bigint:=p_after_sequence; n integer:=0; expected_hash text;
BEGIN
 IF NOT public.sandy_api_current_owner(p_actor_id) THEN RETURN jsonb_build_object('ok',false,'error','owner_required','http_status',403); END IF;
 IF p_after_sequence IS NULL OR p_limit IS NULL OR p_after_sequence<0 OR p_limit NOT BETWEEN 1 AND 5000 OR
 (p_expected_previous_sha256 IS NOT NULL AND p_expected_previous_sha256 !~ '^[a-f0-9]{64}$') THEN
 RETURN jsonb_build_object('ok',false,'error','invalid_audit_verification','http_status',400); END IF;
 SELECT * INTO head FROM public.sandy_api_audit_head WHERE singleton FOR SHARE;
 IF (SELECT coalesce(max(sequence),0) FROM public.sandy_api_audit_events)<>head.sequence THEN
  RETURN jsonb_build_object('ok',true,'valid',false,'error','audit_head_mismatch','external_anchor_established',false); END IF;
 IF p_after_sequence>0 THEN
  SELECT event_sha256 INTO previous_hash FROM public.sandy_api_audit_events WHERE sequence=p_after_sequence;
  IF previous_hash IS NULL THEN RETURN jsonb_build_object('ok',false,'error','audit_anchor_not_found','http_status',404); END IF;
 END IF;
 IF p_expected_previous_sha256 IS NOT NULL AND p_expected_previous_sha256<>previous_hash THEN
 RETURN jsonb_build_object('ok',false,'valid',false,'error','audit_anchor_mismatch','http_status',409); END IF;
 FOR e IN SELECT * FROM public.sandy_api_audit_events WHERE sequence>p_after_sequence AND sequence<=head.sequence ORDER BY sequence LIMIT p_limit LOOP
  expected_hash:=encode(extensions.digest(previous_hash||public.sandy_api_audit_payload(e)::text,'sha256'),'hex');
  IF e.previous_sha256<>previous_hash OR e.event_sha256<>expected_hash THEN
   RETURN jsonb_build_object('ok',true,'valid',false,'failed_sequence',e.sequence,'checked_events',n,'external_anchor_established',false); END IF;
  previous_hash:=e.event_sha256;last_sequence:=e.sequence;n:=n+1;
 END LOOP;
 IF last_sequence=head.sequence AND previous_hash<>head.event_sha256 THEN
  RETURN jsonb_build_object('ok',true,'valid',false,'error','audit_head_mismatch','checked_events',n,'external_anchor_established',false); END IF;
 RETURN jsonb_build_object('ok',true,'valid',true,'checked_events',n,'last_sequence',last_sequence,
 'last_sha256',previous_hash,'complete',last_sequence=head.sequence,'external_anchor_established',false,
 'caller_supplied_anchor',p_expected_previous_sha256 IS NOT NULL);
END $$;

-- No table writes or internal helper/trigger calls are delegated to service_role.
DO $$ DECLARE f record; BEGIN
 FOR f IN SELECT p.oid::regprocedure AS signature FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
 WHERE n.nspname='public' AND p.proname IN ('sandy_api_current_owner','sandy_api_registry_revision','sandy_api_job_fingerprint',
 'sandy_api_audit_payload','sandy_api_append_audit','sandy_api_refuse_audit_edit','sandy_api_refuse_approval_snapshot_edit','sandy_api_capture_mutation_approval',
 'sandy_api_issue_credential','sandy_api_authenticate_credential','sandy_api_revoke_credential','sandy_api_admit_execution',
 'sandy_api_consume_execution_grant','sandy_api_finish_execution','sandy_api_get_execution_receipt','sandy_api_read_audit','sandy_api_checkpoint_audit','sandy_api_verify_audit') LOOP
  EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon,authenticated,service_role',f.signature);
 END LOOP;
 FOR f IN SELECT p.oid::regprocedure AS signature FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
 WHERE n.nspname='public' AND p.proname IN ('sandy_api_issue_credential','sandy_api_authenticate_credential',
 'sandy_api_revoke_credential','sandy_api_admit_execution','sandy_api_consume_execution_grant','sandy_api_finish_execution','sandy_api_get_execution_receipt',
 'sandy_api_read_audit','sandy_api_checkpoint_audit','sandy_api_verify_audit') LOOP
  EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role',f.signature);
 END LOOP;
END $$;
-- Remains unavailable until the canonical gateway route is deployed and tested.
INSERT INTO public.sandy_operation_registry(operation,domain,description,permission_scope,is_mutation,input_schema,
 output_schema,handler,api_exposed,ui_exposed,ai_exposed,verified,implementation_state,source_repository,source_path,error_contract)
VALUES('system.execution.get','system','Read an owned execution receipt without redispatch; API keys see only receipts admitted under that exact active key. Unknown dispatch and asynchronous acceptance require reconciliation.',
 'system:read',false,
 '{"type":"object","required":["request_id"],"properties":{"request_id":{"type":"string","format":"uuid"}},"additionalProperties":false}'::jsonb,
 '{"type":"object","required":["ok","admission_id","request_id","operation","request_state","accepted","executed","completed","outcome","provider_http_status","provider_request_id_sha256","result_sha256","reconciliation_required","redispatch_permitted","created_at","finished_at"],"properties":{"ok":{"const":true},"admission_id":{"type":"string","format":"uuid"},"request_id":{"type":"string","format":"uuid"},"operation":{"type":"string"},"request_state":{"enum":["admitted","consumed","accepted","succeeded","failed","unknown","rejected"]},"accepted":{"type":"boolean"},"executed":{"type":["boolean","null"]},"completed":{"type":"boolean"},"outcome":{"enum":["pending","accepted","succeeded","failed","unknown","rejected"]},"provider_http_status":{"type":["integer","null"],"minimum":100,"maximum":599},"provider_request_id_sha256":{"type":["string","null"],"pattern":"^[a-f0-9]{64}$"},"result_sha256":{"type":["string","null"],"pattern":"^[a-f0-9]{64}$"},"reconciliation_required":{"type":"boolean"},"redispatch_permitted":{"const":false},"created_at":{"type":"string","format":"date-time"},"finished_at":{"type":["string","null"],"format":"date-time"}},"additionalProperties":false}'::jsonb,
 'sandy-operation-api',false,false,false,false,'source_ready','ausstyle/web-staging',
 'supabase/functions/sandy-operation-api/access_policy.ts',
 '{"version":"1.0.0","api_key_delegable":false,"receipt_scope":"original_actor_and_exact_credential","retry_dispatch":false}'::jsonb)
ON CONFLICT(operation) DO NOTHING;
COMMIT;
