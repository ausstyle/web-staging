-- Reuse durable plans/jobs/outbox/attempts for normal, renewable engineering
-- workload read execution. Never call the workload an Owner or expand a grant.
BEGIN;
ALTER TABLE public.sandy_orch_jobs
 ADD COLUMN principal_kind text NOT NULL DEFAULT 'controller_owner' CHECK(principal_kind IN('controller_owner','engineering_workload')),
 ADD COLUMN delegation_id uuid REFERENCES public.sandy_engineering_standing_delegations(id),
 ADD COLUMN delegation_version integer,
 ADD COLUMN execution_scope jsonb,
 ADD CONSTRAINT sandy_orch_workload_scope CHECK(
 (principal_kind='controller_owner' AND delegation_id IS NULL AND delegation_version IS NULL AND execution_scope IS NULL) OR
 (principal_kind='engineering_workload' AND delegation_id IS NOT NULL AND delegation_version IS NOT NULL AND delegation_version>0 AND execution_scope IS NOT NULL AND jsonb_typeof(execution_scope)='object'));

CREATE FUNCTION public.sandy_orch_workload_snapshot(p_operation text) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
 SELECT jsonb_build_object('operation',r.operation,'handler',r.handler,'permission_scope',r.permission_scope,
 'is_mutation',r.is_mutation,'input_schema',r.input_schema,'output_schema',r.output_schema,'api_exposed',r.api_exposed,'ai_exposed',r.ai_exposed,
 'contract_sha256',c.contract_sha256)
 FROM public.sandy_operation_registry r JOIN public.sandy_engineering_operation_classes c USING(operation)
 WHERE r.operation=p_operation AND r.handler='sandy-provider-operation-api' AND r.api_exposed AND r.ai_exposed AND NOT r.is_mutation
 AND c.provider IN('github','supabase') AND c.operation_class='metadata_read' AND c.method='GET' AND NOT c.is_mutation
 AND c.contract_sha256=r.error_contract->>'contract_sha256' AND c.contract_sha256 ~ '^[a-f0-9]{64}$'
 AND r.permission_scope='infrastructure:read' AND jsonb_typeof(r.input_schema)='object' AND jsonb_typeof(r.output_schema)='object'
$$;
REVOKE ALL ON FUNCTION public.sandy_orch_workload_snapshot(text) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.sandy_orch_workload_job_current(p_job_id uuid) RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE j public.sandy_orch_jobs; d public.sandy_engineering_standing_delegations; i public.sandy_engineering_test_identities; snapshot jsonb;
BEGIN
 SELECT * INTO j FROM public.sandy_orch_jobs WHERE id=p_job_id;
 IF j.id IS NULL THEN RETURN false;END IF;
 IF j.principal_kind='controller_owner' THEN RETURN public.sandy_orch_owner(j.actor_id);END IF;
 SELECT * INTO d FROM public.sandy_engineering_standing_delegations WHERE id=j.delegation_id AND identity_user_id=j.actor_id;
 SELECT * INTO i FROM public.sandy_engineering_test_identities WHERE user_id=j.actor_id;
 snapshot:=public.sandy_orch_workload_snapshot(j.operation);
 RETURN coalesce(d.id IS NOT NULL AND d.version=j.delegation_version AND d.revoked_at IS NULL AND d.expires_at>clock_timestamp()
 AND i.enabled AND i.revoked_at IS NULL AND i.rotation_state='ready' AND i.authorized_by=d.owner_authority_id
 AND public.sandy_api_current_owner(d.owner_authority_id) AND NOT EXISTS(SELECT 1 FROM public.sandy_controller_admins WHERE auth_user_id=j.actor_id)
 AND EXISTS(SELECT 1 FROM auth.users WHERE id=j.actor_id AND role='authenticated' AND email='sandy-engineering-test@sandy-ai.internal'
  AND raw_app_meta_data->>'sandy_engineering_test'='true' AND raw_app_meta_data->>'sandy_engineering_epoch'=i.credential_epoch::text
  AND (banned_until IS NULL OR banned_until<=clock_timestamp()))
 AND snapshot IS NOT NULL AND public.sandy_orch_revision(snapshot)=j.registry_revision
 AND public.sandy_engineering_policy_target(d.policy,j.operation,j.arguments,j.execution_scope),false);
END $$;
REVOKE ALL ON FUNCTION public.sandy_orch_workload_job_current(uuid) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.sandy_orch_admit_workload_read(p_operation text,p_canonical_arguments text,p_idempotency_key text,p_not_before timestamptz DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE actor uuid:=auth.uid(); claims jsonb:=auth.jwt(); resolved jsonb; d public.sandy_engineering_standing_delegations; a jsonb; snapshot jsonb; scope jsonb; provider text; digest text; existing public.sandy_orch_plans; plan uuid; job uuid;
BEGIN
 IF auth.role() IS DISTINCT FROM 'authenticated' OR actor IS NULL OR claims->>'role' IS DISTINCT FROM 'authenticated'
 OR claims->>'aud' IS DISTINCT FROM 'authenticated' OR claims->'app_metadata'->>'sandy_engineering_test' IS DISTINCT FROM 'true'
 OR claims->>'session_id' IS NULL OR claims->'app_metadata'->>'sandy_engineering_epoch' IS NULL THEN
  RAISE EXCEPTION 'normal_authenticated_engineering_workload_required' USING ERRCODE='42501';
 END IF;
 resolved:=public.sandy_engineering_resolve_standing(actor,(claims->>'session_id')::uuid,(claims->'app_metadata'->>'sandy_engineering_epoch')::integer);
 IF resolved->>'ok' IS DISTINCT FROM 'true' THEN RETURN resolved;END IF;
 IF (p_not_before IS NOT NULL AND p_not_before>clock_timestamp()+interval '24 hours') OR p_canonical_arguments IS NULL OR octet_length(p_canonical_arguments)>16384 OR p_idempotency_key IS NULL OR p_idempotency_key !~ '^[A-Za-z0-9:_-]{12,128}$' THEN
  RETURN jsonb_build_object('ok',false,'error','invalid_durable_workload_read','http_status',400);
 END IF;
 a:=p_canonical_arguments::jsonb;snapshot:=public.sandy_orch_workload_snapshot(p_operation);
 IF jsonb_typeof(a) IS DISTINCT FROM 'object' OR snapshot IS NULL OR NOT (resolved->'operations' ? p_operation) THEN
  RETURN jsonb_build_object('ok',false,'error','operation_not_delegated_metadata_read','http_status',403);
 END IF;
 SELECT * INTO d FROM public.sandy_engineering_standing_delegations WHERE id=(resolved->>'delegation_id')::uuid FOR SHARE;
 SELECT c.provider INTO provider FROM public.sandy_engineering_operation_classes c WHERE operation=p_operation;
 scope:=CASE provider WHEN 'github' THEN '{"provider":"github","repository":"ausstyle/web-staging"}'::jsonb ELSE '{"provider":"supabase","project_ref":"zmqlyygzqoidkcwdysok"}'::jsonb END;
 IF d.id IS NULL OR d.version::text IS DISTINCT FROM resolved->>'version' OR d.revoked_at IS NOT NULL OR d.expires_at<=clock_timestamp()
 OR NOT public.sandy_engineering_policy_target(d.policy,p_operation,a,scope) THEN
  RETURN jsonb_build_object('ok',false,'error','engineering_policy_blocked','http_status',403);
 END IF;
 -- Enqueue does not confer execution authority: full typed contract and live
 -- standing policy are checked again by normal Sandy API after token renewal.
 -- Serialize all admissions for this actor, including different idempotency
 -- keys, so pending-job and per-minute limits cannot race.
 PERFORM pg_advisory_xact_lock(hashtextextended(actor::text||':workload-read-admission',0));
 digest:=encode(sha256(convert_to(jsonb_build_object('operation',p_operation,'canonical_arguments',p_canonical_arguments,'delegation_id',d.id,'version',d.version,'registry_revision',public.sandy_orch_revision(snapshot),'not_before',p_not_before)::text,'UTF8')),'hex');
 SELECT * INTO existing FROM public.sandy_orch_plans WHERE actor_id=actor AND admission_kind='operation' AND idempotency_key=p_idempotency_key;
 IF FOUND THEN
  IF existing.request_sha256 IS DISTINCT FROM digest THEN RETURN jsonb_build_object('ok',false,'error','idempotency_conflict','http_status',409);END IF;
  SELECT id INTO job FROM public.sandy_orch_jobs WHERE plan_id=existing.id;
  RETURN jsonb_build_object('ok',true,'accepted',true,'executed',false,'plan_id',existing.id,'job_id',job,'reused',true,'principal_kind','engineering_workload');
 END IF;
 IF (SELECT count(*) FROM public.sandy_orch_jobs WHERE actor_id=actor AND principal_kind='engineering_workload' AND state IN('queued','leased','running'))>=20
 OR (SELECT count(*) FROM public.sandy_orch_jobs WHERE actor_id=actor AND principal_kind='engineering_workload' AND created_at>=date_trunc('minute',clock_timestamp()))>=least(30,coalesce((d.policy->>'requests_per_minute')::integer,0)) THEN
  RETURN jsonb_build_object('ok',false,'error','durable_workload_budget_exhausted','http_status',429);
 END IF;
 INSERT INTO public.sandy_orch_plans(actor_id,admission_kind,idempotency_key,request_sha256,request_document,channel)
 VALUES(actor,'operation',p_idempotency_key,digest,jsonb_build_array(jsonb_build_object('operation',p_operation,'arguments',a)),'api') RETURNING id INTO plan;
 INSERT INTO public.sandy_orch_jobs(plan_id,step_key,actor_id,operation,registry_revision,input_sha256,handler,permission_scope,is_mutation,input_schema,output_schema,arguments,channel,principal_kind,delegation_id,delegation_version,execution_scope)
 VALUES(plan,'read',actor,p_operation,public.sandy_orch_revision(snapshot),encode(sha256(convert_to(p_canonical_arguments,'UTF8')),'hex'),snapshot->>'handler',snapshot->>'permission_scope',false,snapshot->'input_schema',snapshot->'output_schema',a,'api','engineering_workload',d.id,d.version,scope) RETURNING id INTO job;
 INSERT INTO public.sandy_orch_outbox(job_id,available_at) VALUES(job,coalesce(p_not_before,clock_timestamp()));
 INSERT INTO public.sandy_orch_events(job_id,event_type,details) VALUES(job,'workload_read_admitted',jsonb_build_object('principal_kind','engineering_workload','delegation_id',d.id,'delegation_version',d.version,'provider_executed',false));
 RETURN jsonb_build_object('ok',true,'accepted',true,'executed',false,'plan_id',plan,'job_id',job,'reused',false,'principal_kind','engineering_workload');
EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN RETURN jsonb_build_object('ok',false,'error','invalid_durable_workload_read','http_status',400);
END $$;
REVOKE ALL ON FUNCTION public.sandy_orch_admit_workload_read(text,text,text,timestamptz) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.sandy_orch_admit_workload_read(text,text,text,timestamptz) TO authenticated;

CREATE FUNCTION public.sandy_orch_resolve_workload_dispatch(p_job_id uuid,p_lease_token uuid,p_worker_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE j public.sandy_orch_jobs; lease public.sandy_orch_outbox; dispatch uuid;
BEGIN
 SELECT * INTO j FROM public.sandy_orch_jobs WHERE id=p_job_id FOR UPDATE;
 IF j.id IS NULL OR j.principal_kind<>'engineering_workload' THEN RETURN jsonb_build_object('ok',false,'error','not_workload_route','http_status',404);END IF;
 SELECT * INTO lease FROM public.sandy_orch_outbox WHERE job_id=j.id FOR UPDATE;
 IF j.state<>'leased' OR lease.lease_token IS DISTINCT FROM p_lease_token OR lease.worker_id IS DISTINCT FROM p_worker_id OR lease.lease_until<=clock_timestamp() THEN
  RETURN jsonb_build_object('ok',false,'error','invalid_or_expired_job_lease','http_status',403);
 END IF;
 IF NOT public.sandy_orch_workload_job_current(j.id) THEN
  UPDATE public.sandy_orch_jobs SET state='blocked',error_code='workload_authorization_or_contract_changed',finished_at=now(),updated_at=now() WHERE id=j.id;
  UPDATE public.sandy_orch_outbox SET worker_id=NULL,lease_token=NULL,lease_until=NULL WHERE job_id=j.id;
  INSERT INTO public.sandy_orch_events(job_id,event_type) VALUES(j.id,'workload_dispatch_authorization_refused');
  RETURN jsonb_build_object('ok',false,'error','workload_authorization_or_contract_changed','http_status',403);
 END IF;
 UPDATE public.sandy_orch_jobs SET state='running',started_at=coalesce(started_at,now()),updated_at=now() WHERE id=j.id;
 INSERT INTO public.sandy_orch_attempts(job_id,attempt,lease_token,worker_id) VALUES(j.id,j.attempts,p_lease_token,p_worker_id) RETURNING dispatch_id INTO dispatch;
 INSERT INTO public.sandy_orch_events(job_id,event_type,details) VALUES(j.id,'workload_dispatch_authorized',jsonb_build_object('dispatch_id',dispatch,'principal_kind','engineering_workload','delegation_id',j.delegation_id,'delegation_version',j.delegation_version));
 RETURN jsonb_build_object('ok',true,'job_id',j.id,'identity_user_id',j.actor_id,'dispatch_id',dispatch,'operation',j.operation,'arguments',j.arguments,'input_sha256',j.input_sha256,'registry_revision',j.registry_revision);
END $$;
REVOKE ALL ON FUNCTION public.sandy_orch_resolve_workload_dispatch(uuid,uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.sandy_orch_resolve_workload_dispatch(uuid,uuid,uuid) TO service_role;

CREATE FUNCTION public.sandy_orch_workload_receipt_matches(p_job_id uuid,p_admission uuid,p_dispatch uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
 SELECT EXISTS(SELECT 1 FROM public.sandy_orch_jobs j JOIN public.sandy_engineering_execution_authorizations e
  ON e.identity_user_id=j.actor_id AND e.request_id=p_dispatch AND e.operation=j.operation AND e.input_sha256=j.input_sha256
  AND e.delegation_id=j.delegation_id AND e.delegation_version=j.delegation_version
 JOIN public.sandy_api_execution_admissions a ON a.approval_id=e.job_id AND a.actor_id=e.owner_authority_id AND a.request_id=e.request_id
  AND a.operation=e.operation AND a.input_sha256=e.input_sha256 AND a.contract_sha256=e.contract_sha256 AND a.scope_sha256=e.scope_sha256
 WHERE j.id=p_job_id AND j.principal_kind='engineering_workload' AND a.id=p_admission AND a.tenant_id IS NULL
 AND a.credential_id IS NULL AND a.customer_key_id IS NULL AND a.registry_revision_sha256=public.sandy_api_registry_revision(a.operation))
$$;
REVOKE ALL ON FUNCTION public.sandy_orch_workload_receipt_matches(uuid,uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.sandy_orch_workload_job(p_job_id uuid,p_cancel boolean DEFAULT false) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE actor uuid:=auth.uid(); claims jsonb:=auth.jwt(); resolved jsonb; j public.sandy_orch_jobs;
BEGIN
 IF auth.role() IS DISTINCT FROM 'authenticated' OR actor IS NULL OR claims->>'role' IS DISTINCT FROM 'authenticated'
 OR claims->>'aud' IS DISTINCT FROM 'authenticated' OR claims->'app_metadata'->>'sandy_engineering_test' IS DISTINCT FROM 'true' THEN
  RAISE EXCEPTION 'normal_authenticated_engineering_workload_required' USING ERRCODE='42501';
 END IF;
 resolved:=public.sandy_engineering_resolve_identity(actor,(claims->>'session_id')::uuid,(claims->'app_metadata'->>'sandy_engineering_epoch')::integer);
 IF resolved->>'ok' IS DISTINCT FROM 'true' THEN RETURN resolved;END IF;
 SELECT * INTO j FROM public.sandy_orch_jobs WHERE id=p_job_id AND actor_id=actor AND principal_kind='engineering_workload' FOR UPDATE;
 IF j.id IS NULL THEN RETURN jsonb_build_object('ok',false,'error','job_not_found','http_status',404);END IF;
 IF p_cancel THEN
  IF j.state='cancelled' THEN RETURN jsonb_build_object('ok',true,'job_id',j.id,'state','cancelled','reused',true,'provider_cancellation',false);END IF;
  IF j.state NOT IN('queued','leased') THEN RETURN jsonb_build_object('ok',false,'error','job_not_cancellable','state',j.state,'http_status',409,'provider_cancellation',false);END IF;
  UPDATE public.sandy_orch_jobs SET state='cancelled',finished_at=now(),updated_at=now() WHERE id=j.id;
  UPDATE public.sandy_orch_outbox SET worker_id=NULL,lease_token=NULL,lease_until=NULL WHERE job_id=j.id;
  INSERT INTO public.sandy_orch_events(job_id,event_type,details) VALUES(j.id,'workload_cancelled',jsonb_build_object('previous_state',j.state,'provider_cancellation',false));
  RETURN jsonb_build_object('ok',true,'job_id',j.id,'state','cancelled','reused',false,'provider_cancellation',false);
 END IF;
 RETURN jsonb_build_object('ok',true,'job_id',j.id,'state',j.state,'operation',j.operation,'attempts',j.attempts,'error_code',j.error_code,'result',j.result,
 'principal_kind','engineering_workload','delegation_id',j.delegation_id,'delegation_version',j.delegation_version,
 'latest_attempt',(SELECT jsonb_build_object('dispatch_id',a.dispatch_id,'outcome',a.outcome,'execution_admission_id',a.execution_admission_id,'finished_at',a.finished_at) FROM public.sandy_orch_attempts a WHERE a.job_id=j.id ORDER BY a.attempt DESC LIMIT 1));
EXCEPTION WHEN invalid_text_representation THEN RETURN jsonb_build_object('ok',false,'error','invalid_workload_session','http_status',403);
END $$;
REVOKE ALL ON FUNCTION public.sandy_orch_workload_job(uuid,boolean) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.sandy_orch_workload_job(uuid,boolean) TO authenticated;

-- Exact, source-pinned changes to two existing RPCs, preserving legacy Owner
-- semantics and every existing lease/retry/receipt check.
DO $$ DECLARE definition text; BEGIN
 IF (SELECT encode(extensions.digest(prosrc,'sha256'),'hex') FROM pg_proc WHERE oid='public.sandy_orch_claim(uuid,integer,integer)'::regprocedure) IS DISTINCT FROM '92a343abf3b7256159b5f8bdee2f2edae33dca5d78fedadd53d9afc4e282da3c' THEN RAISE EXCEPTION 'claim_source_preimage_changed';END IF;
 SELECT pg_get_functiondef('public.sandy_orch_claim(uuid,integer,integer)'::regprocedure) INTO definition;
 IF position('IF NOT public.sandy_orch_owner(record_row.actor_id) THEN' IN definition)=0 THEN RAISE EXCEPTION 'claim_authority_anchor_changed';END IF;
 definition:=replace(definition,'IF NOT public.sandy_orch_owner(record_row.actor_id) THEN','IF NOT public.sandy_orch_workload_job_current(record_row.id) THEN');
 IF position('''lease_until'',until_time));' IN definition)=0 THEN RAISE EXCEPTION 'claim_route_anchor_changed';END IF;
 definition:=replace(definition,'''lease_until'',until_time));','''lease_until'',until_time,''principal_kind'',(SELECT principal_kind FROM public.sandy_orch_jobs WHERE id=record_row.id)));');
 EXECUTE definition;
 IF (SELECT encode(extensions.digest(prosrc,'sha256'),'hex') FROM pg_proc WHERE oid='public.sandy_orch_finish(uuid,uuid,uuid,uuid,text,jsonb,text,text,uuid)'::regprocedure) IS DISTINCT FROM 'de925660da26023e690bac3abb66dfabd66a154150665946fdaac66f6a369697' THEN RAISE EXCEPTION 'finish_source_preimage_changed';END IF;
 SELECT pg_get_functiondef('public.sandy_orch_finish(uuid,uuid,uuid,uuid,text,jsonb,text,text,uuid)'::regprocedure) INTO definition;
 IF position('admission->>''actor_id'' IS DISTINCT FROM job.actor_id::text' IN definition)=0 THEN RAISE EXCEPTION 'receipt_actor_anchor_changed';END IF;
 definition:=replace(definition,'admission->>''actor_id'' IS DISTINCT FROM job.actor_id::text','(admission->>''actor_id'' IS DISTINCT FROM job.actor_id::text AND NOT public.sandy_orch_workload_receipt_matches(job.id,p_execution_admission_id,p_dispatch_id))');
 IF position(' -- This migration is additive and may precede the shared execution policy.' IN definition)=0 THEN RAISE EXCEPTION 'receipt_required_anchor_changed';END IF;
 definition:=replace(definition,' -- This migration is additive and may precede the shared execution policy.',
 ' IF job.principal_kind=''engineering_workload'' AND p_outcome=''succeeded'' AND p_execution_admission_id IS NULL THEN
  RETURN jsonb_build_object(''ok'',false,''error'',''execution_admission_required'',''http_status'',409);
 END IF;
 -- This migration is additive and may precede the shared execution policy.');
 EXECUTE definition;
END $$;
NOTIFY pgrst,'reload schema';
COMMIT;
