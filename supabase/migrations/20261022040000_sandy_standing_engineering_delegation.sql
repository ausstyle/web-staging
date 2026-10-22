BEGIN;
-- A policy record and a compiled-contract classification index, not another job
-- or receipt ledger. Neither the workload nor its service transport can edit it.
CREATE TABLE public.sandy_engineering_standing_delegations (
 identity_user_id uuid PRIMARY KEY REFERENCES public.sandy_engineering_test_identities(user_id),
 id uuid NOT NULL UNIQUE DEFAULT gen_random_uuid(), version integer NOT NULL DEFAULT 1 CHECK(version>0),
 owner_authority_id uuid NOT NULL,policy jsonb NOT NULL,
 tenant_id uuid CHECK(tenant_id IS NULL),source_commit text NOT NULL CHECK(source_commit ~ '^[a-f0-9]{40}$'),
 source_sha256 text NOT NULL CHECK(source_sha256 ~ '^[a-f0-9]{64}$'),
 established_by text NOT NULL,established_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 engineering_change_id uuid NOT NULL REFERENCES public.sandy_engineering_changes(id),
 expires_at timestamptz NOT NULL,revoked_at timestamptz,
 CHECK(jsonb_typeof(policy)='object' AND octet_length(policy::text)<=8192)
);
CREATE TABLE public.sandy_engineering_operation_classes (
 operation text PRIMARY KEY,provider text NOT NULL CHECK(provider IN('github','supabase','gcp')),
 operation_class text NOT NULL CHECK(operation_class IN('metadata_read','source_read','code_write','git_write','pull_request_write','restricted')),
 method text NOT NULL,path text NOT NULL,is_mutation boolean NOT NULL,
 contract_sha256 text NOT NULL CHECK(contract_sha256 ~ '^[a-f0-9]{64}$'),source_path text NOT NULL
);
ALTER TABLE public.sandy_engineering_standing_delegations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sandy_engineering_operation_classes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.sandy_engineering_standing_delegations,public.sandy_engineering_operation_classes FROM PUBLIC,anon,authenticated,service_role;
ALTER TABLE public.sandy_engineering_execution_authorizations
 ADD COLUMN delegation_id uuid REFERENCES public.sandy_engineering_standing_delegations(id),
 ADD COLUMN delegation_version integer;
ALTER TABLE public.sandy_engineering_changes DROP CONSTRAINT sandy_engineering_changes_status_check;
ALTER TABLE public.sandy_engineering_changes ADD CONSTRAINT sandy_engineering_changes_status_check
 CHECK(status IN('proposed','approved','implementing','committed','deployed','verified','failed','rolled_back','cancelled','authorized_by_policy','policy_blocked','executing','unknown_outcome'));
-- Preserve historical states. New routine jobs carry no approved_by/approved_at.
ALTER TABLE public.sandy_deployment_jobs DROP CONSTRAINT IF EXISTS sandy_deployment_jobs_status_check;
ALTER TABLE public.sandy_deployment_jobs ADD CONSTRAINT sandy_deployment_jobs_status_check
 CHECK(status IN('pending_approval','approved','rejected','queued','running','succeeded','failed','cancelled','authorized_by_policy','unknown_outcome','verified','policy_blocked'));
ALTER TABLE public.sandy_deployment_jobs DROP CONSTRAINT sandy_deployment_approval;
ALTER TABLE public.sandy_deployment_jobs ADD CONSTRAINT sandy_deployment_approval CHECK(
 status NOT IN('approved','running','succeeded') OR (approved_by IS NOT NULL AND approved_at IS NOT NULL)
 OR (status IN('running','succeeded') AND approved_by IS NULL AND approved_at IS NULL AND payload->>'authorization_mode'='authorized_by_policy'
 AND coalesce(payload->>'delegation_id','') ~ '^[a-f0-9-]{36}$' AND coalesce(payload->>'source_policy_sha256','') ~ '^[a-f0-9]{64}$'));

CREATE FUNCTION public.sandy_engineering_admin_set_standing(p_identity uuid,p_policy jsonb,p_source_sha256 text,p_expires_at timestamptz,p_revoke boolean DEFAULT false,p_source_commit text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE i public.sandy_engineering_test_identities;d public.sandy_engineering_standing_delegations;k text;v jsonb;change_id uuid;
BEGIN
 -- EXECUTE belongs only to the database administrator. The service-role key
 -- used by the engineering runtime cannot invoke this function through REST.
 SELECT * INTO i FROM public.sandy_engineering_test_identities WHERE user_id=p_identity FOR UPDATE;
 IF i.user_id IS NULL OR NOT public.sandy_api_current_owner(i.authorized_by) OR EXISTS(SELECT 1 FROM public.sandy_controller_admins WHERE auth_user_id=p_identity)
 THEN RAISE EXCEPTION 'legitimate_engineering_identity_required' USING ERRCODE='42501';END IF;
 IF p_revoke THEN
  UPDATE public.sandy_engineering_standing_delegations SET revoked_at=coalesce(revoked_at,clock_timestamp()) WHERE identity_user_id=p_identity RETURNING * INTO d;
 ELSE
  IF NOT i.enabled OR i.revoked_at IS NOT NULL OR i.rotation_state<>'ready' OR p_policy IS NULL OR jsonb_typeof(p_policy)<>'object'
  OR p_policy->>'version' IS DISTINCT FROM 'standing-engineering-v1' OR p_policy->>'risk_ceiling' IS DISTINCT FROM 'routine'
  OR p_policy->>'declared_unit_budget' IS DISTINCT FROM '0' OR p_policy->>'requests_per_minute' IS DISTINCT FROM '30'
  OR jsonb_typeof(p_policy->'resources') IS DISTINCT FROM 'object' OR jsonb_typeof(p_policy->'classes') IS DISTINCT FROM 'object'
  OR p_policy->'environments' IS DISTINCT FROM '["test","production"]'::jsonb
  OR p_source_sha256 IS NULL OR p_source_sha256 !~ '^[a-f0-9]{64}$' OR p_source_commit IS NULL OR p_source_commit !~ '^[a-f0-9]{40}$' OR p_expires_at IS NULL OR p_expires_at<=clock_timestamp() OR p_expires_at>clock_timestamp()+interval '30 days'
  OR EXISTS(SELECT 1 FROM jsonb_object_keys(p_policy) x WHERE x NOT IN('version','risk_ceiling','declared_unit_budget','requests_per_minute','resources','classes','environments'))
  THEN RAISE EXCEPTION 'invalid_standing_engineering_policy' USING ERRCODE='22023';END IF;
  FOR k,v IN SELECT * FROM jsonb_each(p_policy->'resources') LOOP
   IF k NOT IN('github','supabase','gcp') OR jsonb_typeof(v)<>'array' OR jsonb_array_length(v)=0 OR jsonb_array_length(v)>16
    OR EXISTS(SELECT 1 FROM jsonb_array_elements_text(v) s WHERE length(s)>200 OR s !~ '^[A-Za-z0-9_./-]+$')
   THEN RAISE EXCEPTION 'invalid_delegated_resources' USING ERRCODE='22023';END IF;
  END LOOP;
  FOR k,v IN SELECT * FROM jsonb_each(p_policy->'classes') LOOP
   IF NOT p_policy->'resources' ? k OR jsonb_typeof(v)<>'array' OR jsonb_array_length(v)=0
    OR EXISTS(SELECT 1 FROM jsonb_array_elements_text(v) c WHERE c NOT IN('metadata_read','source_read','code_write','git_write','pull_request_write'))
    OR (k<>'github' AND v<>'["metadata_read"]'::jsonb)
   THEN RAISE EXCEPTION 'restricted_policy_required' USING ERRCODE='42501';END IF;
  END LOOP;
  INSERT INTO public.sandy_engineering_changes(title,problem,expected_behavior,change_purpose,feature_improvement,scope,risk,regression_rules,acceptance_criteria,requested_by,status)
  VALUES('Standing resource-bound engineering delegation',
   'Routine provider engineering is blocked by a fixture-only operation delegation.',
   'Authenticate the engineering workload normally and authorize reviewed operation classes within delegated resources without repeated human approval.',
   'Implement Master Scope v1.2 Amendment B through administrative standing policy establishment.',
   'Enable bounded platform engineering with source verification, immutable receipts and revocation at dispatch.',
   (SELECT jsonb_agg(resource_group.provider_name||':'||resource_item.resource_id) FROM jsonb_each(p_policy->'resources') resource_group(provider_name,resource_values) CROSS JOIN LATERAL jsonb_array_elements_text(resource_group.resource_values) resource_item(resource_id)),'normal','["Preserve normal Auth and provider IAM","Never expand workload authority","Retain source, recovery and append-only evidence"]',
   '["Authorized routine source cycle","Wrong target, expiry, revocation and restricted operations fail closed"]',
   p_identity,'authorized_by_policy') RETURNING id INTO change_id;
  INSERT INTO public.sandy_engineering_standing_delegations(identity_user_id,owner_authority_id,policy,source_sha256,source_commit,established_by,expires_at,engineering_change_id)
  VALUES(p_identity,i.authorized_by,p_policy,p_source_sha256,p_source_commit,session_user,p_expires_at,change_id)
  ON CONFLICT(identity_user_id) DO UPDATE SET version=sandy_engineering_standing_delegations.version+1,owner_authority_id=excluded.owner_authority_id,
  policy=excluded.policy,source_sha256=excluded.source_sha256,source_commit=excluded.source_commit,established_by=excluded.established_by,established_at=clock_timestamp(),expires_at=excluded.expires_at,engineering_change_id=excluded.engineering_change_id,revoked_at=NULL RETURNING * INTO d;
 END IF;
 INSERT INTO public.sandy_engineering_identity_events(identity_user_id,owner_authority_id,actor_kind,event_type,detail)
 VALUES(p_identity,i.authorized_by,'management_administration',CASE WHEN p_revoke THEN 'scope_revoked' ELSE 'scope_authorized' END,
 jsonb_build_object('mode','standing_policy_administration','administrator',session_user,'delegation_id',d.id,'version',d.version,
 'policy',d.policy,'source_sha256',d.source_sha256,'source_commit',d.source_commit,'tenant_id',d.tenant_id,'expires_at',d.expires_at,'interactive_owner_approval',false));
 RETURN jsonb_build_object('ok',true,'delegation_id',d.id,'version',d.version,'revoked',p_revoke);
END $$;
REVOKE ALL ON FUNCTION public.sandy_engineering_admin_set_standing(uuid,jsonb,text,timestamptz,boolean,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.sandy_engineering_admin_set_standing(uuid,jsonb,text,timestamptz,boolean,text) TO postgres;

CREATE FUNCTION public.sandy_engineering_resolve_standing(p_user_id uuid,p_session_id uuid,p_epoch integer)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE resolved jsonb;d public.sandy_engineering_standing_delegations;ops jsonb;
BEGIN
 resolved:=public.sandy_engineering_resolve_identity(p_user_id,p_session_id,p_epoch);
 IF resolved->>'ok' IS DISTINCT FROM 'true' THEN RETURN resolved;END IF;
 SELECT * INTO d FROM public.sandy_engineering_standing_delegations WHERE identity_user_id=p_user_id AND revoked_at IS NULL AND expires_at>clock_timestamp();
 IF d.id IS NULL OR d.owner_authority_id::text IS DISTINCT FROM resolved->>'owner_authority_id' THEN RETURN jsonb_build_object('ok',false,'error','standing_delegation_inactive','http_status',403);END IF;
 SELECT coalesce(jsonb_agg(c.operation ORDER BY c.operation),'[]'::jsonb) INTO ops
 FROM public.sandy_engineering_operation_classes c JOIN public.sandy_operation_registry r USING(operation)
 WHERE d.policy->'classes'->c.provider ? c.operation_class AND c.operation_class<>'restricted'
 AND r.error_contract->>'contract_sha256'=c.contract_sha256 AND r.is_mutation=c.is_mutation AND r.api_exposed AND r.ai_exposed;
 ops:=ops||'"system.execution.get"'::jsonb;
 RETURN jsonb_build_object('ok',true,'identity_user_id',p_user_id,'owner_authority_id',d.owner_authority_id,'session_id',p_session_id,
 'delegation_id',d.id,'version',d.version,'operations',ops,'expires_at',d.expires_at,'policy',d.policy);
END $$;

CREATE FUNCTION public.sandy_engineering_policy_target(p_policy jsonb,p_operation text,p_args jsonb,p_scope jsonb)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE c public.sandy_engineering_operation_classes;resource text;target text;branch text;v text;
BEGIN
 SELECT * INTO c FROM public.sandy_engineering_operation_classes WHERE operation=p_operation;
 IF c.operation IS NULL OR c.operation_class='restricted' OR (p_policy->'classes'->c.provider ? c.operation_class) IS DISTINCT FROM true
 OR p_scope->>'provider' IS DISTINCT FROM c.provider OR jsonb_typeof(p_args) IS DISTINCT FROM 'object' THEN RETURN false;END IF;
 resource:=CASE c.provider WHEN 'github' THEN p_scope->>'repository' WHEN 'supabase' THEN p_scope->>'project_ref' ELSE p_scope->>'project_id' END;
 IF resource IS NULL OR (p_policy->'resources'->c.provider ? resource) IS DISTINCT FROM true THEN RETURN false;END IF;
 IF c.provider='github' THEN
  IF c.operation_class IN('code_write','source_read') THEN
   target:=p_args->'path'->>'path';
   IF target IS NULL OR target='' OR target LIKE '/%' OR target ~ '(^|/)(\.|\.\.)(/|$)|[%\\?#[:cntrl:]]'
    OR lower(target) ~ '(^|/)(\.env[^/]*|\.git|\.github)(/|$)|(^|/)[^/]*(credential|private.?key|service.?account)[^/]*\.json$|\.(pem|key|p12|pfx)$'
   THEN RETURN false;END IF;
   IF c.operation_class='code_write' THEN
    branch:=p_args->'body'->>'branch';
    IF branch IS NULL OR branch NOT LIKE 'engineering/%' OR branch ~ '(^|/)\.\.?(/|$)|[%\\?#[:cntrl:]]' THEN RETURN false;END IF;
   ELSE
    branch:=p_args->'query'->>'ref';
    IF branch IS NULL OR branch !~ '^[a-f0-9]{40}$' THEN RETURN false;END IF;
   END IF;
  ELSIF c.operation_class='git_write' AND c.path ~ '/git/trees$' THEN
   FOR v IN SELECT t->>'path' FROM jsonb_array_elements(p_args->'body'->'tree') t LOOP
    IF v IS NULL OR v='' OR v LIKE '/%' OR v ~ '(^|/)(\.|\.\.)(/|$)|[%\\?#[:cntrl:]]'
     OR lower(v) ~ '(^|/)(\.env[^/]*|\.git|\.github)(/|$)|(^|/)[^/]*(credential|private.?key|service.?account)[^/]*\.json$|\.(pem|key|p12|pfx)$' THEN RETURN false;END IF;
   END LOOP;
  ELSIF c.operation_class='git_write' AND c.path ~ '/git/refs' THEN
   branch:=coalesce(p_args->'body'->>'ref',p_args->'path'->>'ref');
   IF branch IS NULL OR branch !~ '^(refs/)?heads/engineering/[A-Za-z0-9_./-]+$' OR branch ~ '(^|/)\.\.?(/|$)' OR coalesce((p_args->'body'->>'force')::boolean,false) THEN RETURN false;END IF;
  ELSIF c.operation_class='pull_request_write' THEN
   -- Routine draft creation is bounded to an engineering source branch. Changes
   -- to existing production PRs, merges and reviews require a restricted policy.
   IF c.method<>'POST' OR c.path<>'/repos/{owner}/{repo}/pulls' OR coalesce(p_args->'body'->>'head','') NOT LIKE 'engineering/%'
    OR p_args->'body'->>'base' IS DISTINCT FROM 'main' OR p_args->'body'->>'draft' IS DISTINCT FROM 'true' THEN RETURN false;END IF;
  END IF;
 ELSE
  FOR v IN SELECT s #>> '{}' FROM jsonb_path_query(p_args,'strict $.** ? (@.type() == "string")') s LOOP
   IF v ~ 'projects/[^/[:space:]"'']+' AND EXISTS(SELECT 1 FROM regexp_matches(v,'projects/([^/[:space:]"'']+)','g') m WHERE NOT(p_policy->'resources'->'gcp' ? m[1])) THEN RETURN false;END IF;
  END LOOP;
 END IF;
 RETURN true;
EXCEPTION WHEN others THEN RETURN false;
END $$;

CREATE FUNCTION public.sandy_engineering_policy_job_authorized(p_job_id uuid,p_expected_state text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE e public.sandy_engineering_execution_authorizations;d public.sandy_engineering_standing_delegations;j public.sandy_deployment_jobs;r jsonb;
BEGIN
 SELECT * INTO e FROM public.sandy_engineering_execution_authorizations WHERE job_id=p_job_id AND delegation_id IS NOT NULL;
 SELECT * INTO d FROM public.sandy_engineering_standing_delegations WHERE id=e.delegation_id;
 SELECT * INTO j FROM public.sandy_deployment_jobs WHERE id=p_job_id;
 IF e.job_id IS NULL OR d.id IS NULL OR d.version IS DISTINCT FROM e.delegation_version OR d.revoked_at IS NOT NULL OR d.expires_at<=clock_timestamp()
 OR j.status IS DISTINCT FROM p_expected_state OR j.requested_by IS DISTINCT FROM e.identity_user_id::text OR j.approved_by IS NOT NULL OR j.approved_at IS NOT NULL
 OR d.owner_authority_id IS DISTINCT FROM e.owner_authority_id OR j.payload->>'authorization_mode' IS DISTINCT FROM 'authorized_by_policy'
 THEN RETURN false;END IF;
 r:=public.sandy_engineering_resolve_identity(e.identity_user_id,e.session_id,e.credential_epoch);
 RETURN r->>'ok'='true' AND EXISTS(SELECT 1 FROM public.sandy_engineering_operation_classes c JOIN public.sandy_operation_registry reg USING(operation)
 WHERE c.operation=e.operation AND c.contract_sha256=e.contract_sha256 AND reg.error_contract->>'contract_sha256'=c.contract_sha256
 AND d.policy->'classes'->c.provider ? c.operation_class AND c.operation_class<>'restricted');
END $$;

CREATE FUNCTION public.sandy_engineering_prepare_delegated(p_user_id uuid,p_session_id uuid,p_epoch integer,p_request_id uuid,p_operation text,p_canonical_arguments text,p_contract_sha256 text,p_canonical_scope text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
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
   UPDATE public.sandy_engineering_execution_authorizations SET session_id=p_session_id,credential_epoch=p_epoch WHERE job_id=prior.job_id;
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
END $$;
REVOKE ALL ON FUNCTION public.sandy_engineering_resolve_standing(uuid,uuid,integer),public.sandy_engineering_policy_target(jsonb,text,jsonb,jsonb),
 public.sandy_engineering_policy_job_authorized(uuid,text),public.sandy_engineering_prepare_delegated(uuid,uuid,integer,uuid,text,text,text,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.sandy_engineering_resolve_standing(uuid,uuid,integer),public.sandy_engineering_prepare_delegated(uuid,uuid,integer,uuid,text,text,text,text),public.sandy_engineering_policy_job_authorized(uuid,text) TO service_role;
CREATE FUNCTION public.sandy_engineering_owns_execution(p_user_id uuid,p_session_id uuid,p_epoch integer,p_request_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE r jsonb;owned boolean;
BEGIN
 r:=public.sandy_engineering_resolve_standing(p_user_id,p_session_id,p_epoch);
 IF r->>'ok' IS DISTINCT FROM 'true' THEN RETURN jsonb_build_object('ok',false,'owned',false);END IF;
 SELECT EXISTS(SELECT 1 FROM public.sandy_engineering_execution_authorizations e JOIN public.sandy_api_execution_admissions a ON a.approval_id=e.job_id
 WHERE e.identity_user_id=p_user_id AND e.request_id=p_request_id AND e.owner_authority_id::text=r->>'owner_authority_id'
 AND a.request_id=e.request_id AND a.actor_id=e.owner_authority_id) INTO owned;
 RETURN jsonb_build_object('ok',true,'owned',owned);
END $$;
REVOKE ALL ON FUNCTION public.sandy_engineering_owns_execution(uuid,uuid,integer,uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.sandy_engineering_owns_execution(uuid,uuid,integer,uuid) TO service_role;
COMMIT;
