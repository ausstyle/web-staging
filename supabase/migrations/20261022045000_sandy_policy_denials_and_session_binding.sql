BEGIN;
-- Session renewal is append-only: never rewrite an immutable authorization or
-- rebind an already admitted/consumed provider request.
ALTER TABLE public.sandy_engineering_identity_events DROP CONSTRAINT sandy_engineering_identity_events_event_type_check;
ALTER TABLE public.sandy_engineering_identity_events ADD CONSTRAINT sandy_engineering_identity_events_event_type_check CHECK(event_type IN('provisioned','authorized','session_issued','session_retired','execution_authorized','credential_rotation_started','credential_rotated','bootstrap_installed','bootstrap_delivered','revoked','scope_authorized','scope_revoked','execution_session_rebound'));
CREATE OR REPLACE FUNCTION public.sandy_engineering_policy_job_authorized(p_job_id uuid, p_expected_state text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
DECLARE e public.sandy_engineering_execution_authorizations;d public.sandy_engineering_standing_delegations;j public.sandy_deployment_jobs;r jsonb;binding jsonb;binding_session uuid;binding_epoch integer;
BEGIN
 SELECT * INTO e FROM public.sandy_engineering_execution_authorizations WHERE job_id=p_job_id AND delegation_id IS NOT NULL;
 SELECT * INTO d FROM public.sandy_engineering_standing_delegations WHERE id=e.delegation_id;
 SELECT * INTO j FROM public.sandy_deployment_jobs WHERE id=p_job_id;
 IF e.job_id IS NULL OR d.id IS NULL OR d.version IS DISTINCT FROM e.delegation_version OR d.revoked_at IS NOT NULL OR d.expires_at<=clock_timestamp()
 OR j.status IS DISTINCT FROM p_expected_state OR j.requested_by IS DISTINCT FROM e.identity_user_id::text OR j.approved_by IS NOT NULL OR j.approved_at IS NOT NULL
 OR d.owner_authority_id IS DISTINCT FROM e.owner_authority_id OR j.payload->>'authorization_mode' IS DISTINCT FROM 'authorized_by_policy'
 THEN RETURN false;END IF;
 SELECT ev.detail INTO binding FROM public.sandy_engineering_identity_events ev
 WHERE ev.identity_user_id=e.identity_user_id AND ev.owner_authority_id=e.owner_authority_id
 AND ev.actor_kind='verified_auth_workload' AND ev.event_type='execution_session_rebound'
 AND ev.detail->>'job_id'=e.job_id::text AND ev.detail->>'request_id'=e.request_id::text
 AND ev.detail->>'input_sha256'=e.input_sha256 AND ev.detail->>'contract_sha256'=e.contract_sha256 AND ev.detail->>'scope_sha256'=e.scope_sha256
 AND ev.detail->>'delegation_id'=d.id::text AND ev.detail->>'delegation_version'=d.version::text
 AND NOT EXISTS(SELECT 1 FROM public.sandy_api_execution_admissions a WHERE a.approval_id=e.job_id AND a.created_at<ev.occurred_at)
 ORDER BY ev.id DESC LIMIT 1;
 binding_session:=CASE WHEN binding IS NULL THEN e.session_id ELSE (binding->>'session_id')::uuid END;
 binding_epoch:=CASE WHEN binding IS NULL THEN e.credential_epoch ELSE (binding->>'credential_epoch')::integer END;
 r:=public.sandy_engineering_resolve_identity(e.identity_user_id,binding_session,binding_epoch);
 RETURN r->>'ok'='true' AND EXISTS(SELECT 1 FROM public.sandy_engineering_operation_classes c JOIN public.sandy_operation_registry reg USING(operation)
 WHERE c.operation=e.operation AND c.contract_sha256=e.contract_sha256 AND reg.error_contract->>'contract_sha256'=c.contract_sha256
 AND d.policy->'classes'->c.provider ? c.operation_class AND c.operation_class<>'restricted');
END $function$
;
CREATE OR REPLACE FUNCTION public.sandy_engineering_prepare_delegated(p_user_id uuid, p_session_id uuid, p_epoch integer, p_request_id uuid, p_operation text, p_canonical_arguments text, p_contract_sha256 text, p_canonical_scope text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
DECLARE r jsonb;a jsonb;s jsonb;d public.sandy_engineering_standing_delegations;c public.sandy_engineering_operation_classes;
 prior public.sandy_engineering_execution_authorizations;input_hash text;scope_hash text;job uuid;count_recent integer;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended(p_user_id::text||':'||p_request_id::text,0));
 r:=public.sandy_engineering_resolve_standing(p_user_id,p_session_id,p_epoch);
 IF r->>'ok' IS DISTINCT FROM 'true' THEN RETURN r;END IF;
 IF p_request_id IS NULL OR p_canonical_arguments IS NULL OR octet_length(p_canonical_arguments)>1550000 OR octet_length(p_canonical_scope)>8192
 THEN RETURN jsonb_build_object('ok',false,'error','invalid_delegated_request','http_status',400);END IF;
 a:=p_canonical_arguments::jsonb;s:=p_canonical_scope::jsonb;
 SELECT * INTO d FROM public.sandy_engineering_standing_delegations WHERE id=(r->>'delegation_id')::uuid FOR UPDATE;
 IF d.id IS NULL OR d.revoked_at IS NOT NULL OR d.expires_at<=clock_timestamp() OR d.version::text IS DISTINCT FROM r->>'version' THEN
 RETURN jsonb_build_object('ok',false,'error','standing_delegation_inactive','http_status',403);END IF;
 SELECT * INTO c FROM public.sandy_engineering_operation_classes WHERE operation=p_operation;
 IF NOT (r->'operations' ? p_operation) OR c.contract_sha256 IS DISTINCT FROM p_contract_sha256
 OR NOT public.sandy_engineering_policy_target(d.policy,p_operation,a,s) THEN
 RETURN jsonb_build_object('ok',false,'error','engineering_policy_blocked','http_status',403,'authorization_state','policy_blocked');END IF;
 input_hash:=encode(extensions.digest(p_canonical_arguments,'sha256'),'hex');scope_hash:=encode(extensions.digest(p_canonical_scope,'sha256'),'hex');
 SELECT * INTO prior FROM public.sandy_engineering_execution_authorizations WHERE identity_user_id=p_user_id AND request_id=p_request_id;
 IF FOUND THEN
  IF prior.operation IS DISTINCT FROM p_operation OR prior.input_sha256 IS DISTINCT FROM input_hash OR prior.contract_sha256 IS DISTINCT FROM p_contract_sha256
   OR prior.scope_sha256 IS DISTINCT FROM scope_hash OR prior.delegation_id IS DISTINCT FROM d.id OR prior.delegation_version IS DISTINCT FROM d.version THEN
   RETURN jsonb_build_object('ok',false,'error','engineering_request_conflict','http_status',409);END IF;
  IF NOT EXISTS(SELECT 1 FROM public.sandy_api_execution_admissions WHERE approval_id=prior.job_id)
   AND EXISTS(SELECT 1 FROM public.sandy_deployment_jobs WHERE id=prior.job_id AND status='authorized_by_policy') THEN
   IF NOT EXISTS(SELECT 1 FROM public.sandy_engineering_identity_events ev WHERE ev.identity_user_id=p_user_id
     AND ev.event_type='execution_session_rebound' AND ev.detail->>'job_id'=prior.job_id::text AND ev.detail->>'session_id'=p_session_id::text
     AND ev.detail->>'credential_epoch'=p_epoch::text)
    AND (prior.session_id IS DISTINCT FROM p_session_id OR prior.credential_epoch IS DISTINCT FROM p_epoch) THEN
    INSERT INTO public.sandy_engineering_identity_events(identity_user_id,owner_authority_id,actor_kind,event_type,detail)
    VALUES(p_user_id,d.owner_authority_id,'verified_auth_workload','execution_session_rebound',jsonb_build_object(
      'job_id',prior.job_id,'request_id',prior.request_id,'input_sha256',prior.input_sha256,'contract_sha256',prior.contract_sha256,
      'scope_sha256',prior.scope_sha256,'session_id',p_session_id,'credential_epoch',p_epoch,'delegation_id',d.id,'delegation_version',d.version));
   END IF;
  END IF;
  RETURN jsonb_build_object('ok',true,'authorization_id',prior.job_id,'authorization_state','authorized_by_policy','delegation_id',d.id,'version',d.version,'reused',true);
 END IF;
 SELECT count(*) INTO count_recent FROM public.sandy_engineering_execution_authorizations WHERE identity_user_id=p_user_id AND created_at>=date_trunc('minute',clock_timestamp());
 IF count_recent>=30 THEN RETURN jsonb_build_object('ok',false,'error','engineering_rate_limited','http_status',429);END IF;
 INSERT INTO public.sandy_deployment_jobs(requested_by,provider,operation,target,payload,idempotency_key,status,engineering_change_id)
 VALUES(p_user_id::text,CASE WHEN c.provider='gcp' THEN 'google_cloud' ELSE c.provider END,p_operation,coalesce(s->>'repository',s->>'project_ref',s->>'project_id'),
 jsonb_build_object('authorization_mode','authorized_by_policy','delegation_id',d.id,'delegation_version',d.version,'operation_class',c.operation_class,
 'input_sha256',input_hash,'contract_sha256',c.contract_sha256,'scope_sha256',scope_hash,'source_policy_sha256',d.source_sha256,'source_commit',d.source_commit,
 'recovery',jsonb_build_object('expected_blob_sha',a->'body'->>'sha','branch',coalesce(a->'body'->>'branch',a->'body'->>'ref'),'path',a->'path'->>'path')),
 'standing-engineering:'||p_user_id::text||':'||p_request_id::text,'authorized_by_policy',d.engineering_change_id) RETURNING id INTO job;
 INSERT INTO public.sandy_engineering_execution_authorizations(identity_user_id,request_id,owner_authority_id,session_id,credential_epoch,operation,input_sha256,contract_sha256,scope_sha256,job_id,delegation_id,delegation_version)
 VALUES(p_user_id,p_request_id,d.owner_authority_id,p_session_id,p_epoch,p_operation,input_hash,c.contract_sha256,scope_hash,job,d.id,d.version);
 INSERT INTO public.sandy_engineering_identity_events(identity_user_id,owner_authority_id,actor_kind,event_type,detail)
 VALUES(p_user_id,d.owner_authority_id,'verified_auth_workload','execution_authorized',jsonb_build_object('authorization_state','authorized_by_policy','delegation_id',d.id,'version',d.version,'job_id',job,'operation',p_operation,'request_id',p_request_id,'input_sha256',input_hash));
 RETURN jsonb_build_object('ok',true,'authorization_id',job,'authorization_state','authorized_by_policy','delegation_id',d.id,'version',d.version,'reused',false);
EXCEPTION WHEN invalid_text_representation THEN RETURN jsonb_build_object('ok',false,'error','invalid_delegated_request','http_status',400);
END $function$
;

CREATE FUNCTION public.sandy_engineering_record_policy_denial(p_user_id uuid,p_session_id uuid,p_epoch integer,p_request_id uuid,p_operation text,p_input_sha256 text,p_error text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE r jsonb;seq bigint;
BEGIN
 r:=public.sandy_engineering_resolve_identity(p_user_id,p_session_id,p_epoch);
 IF r->>'ok' IS DISTINCT FROM 'true' OR p_request_id IS NULL OR p_input_sha256 IS NULL OR p_input_sha256 !~ '^[a-f0-9]{64}$'
 OR p_error IS NULL OR p_error !~ '^[a-z][a-z0-9_]{2,80}$' OR NOT EXISTS(SELECT 1 FROM public.sandy_operation_registry WHERE operation=p_operation)
 THEN RETURN jsonb_build_object('ok',false);END IF;
 -- Digests only; no rejected source, credentials or user arguments are logged.
 seq:=public.sandy_api_append_audit((r->>'owner_authority_id')::uuid,p_operation,p_request_id,NULL,NULL,'policy','rejected',p_input_sha256,encode(extensions.digest(p_error,'sha256'),'hex'),NULL,NULL);
 RETURN jsonb_build_object('ok',true,'audit_sequence',seq);
END $$;
REVOKE ALL ON FUNCTION public.sandy_engineering_record_policy_denial(uuid,uuid,integer,uuid,text,text,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.sandy_engineering_record_policy_denial(uuid,uuid,integer,uuid,text,text,text) TO service_role;
NOTIFY pgrst,'reload schema';
COMMIT;
