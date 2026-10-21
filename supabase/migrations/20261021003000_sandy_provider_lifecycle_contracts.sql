-- Conditional provider compensation. All evidence refers to an actual canonical
-- execution admission; customers cannot supply or edit preimages directly.
BEGIN;
CREATE TABLE public.sandy_lifecycle_snapshots (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), actor_id uuid NOT NULL,
 source_admission_id uuid NOT NULL UNIQUE REFERENCES public.sandy_api_execution_admissions(id) ON DELETE RESTRICT,
 source_request_id uuid NOT NULL, source_operation text NOT NULL,
 source_arguments jsonb NOT NULL, record jsonb NOT NULL, captured_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(actor_id,source_request_id)
);
CREATE TABLE public.sandy_lifecycle_compensations (
 snapshot_id uuid PRIMARY KEY REFERENCES public.sandy_lifecycle_snapshots(id) ON DELETE RESTRICT,
 actor_id uuid NOT NULL, request_id uuid NOT NULL UNIQUE DEFAULT gen_random_uuid(),
 approval_id uuid NOT NULL REFERENCES public.sandy_deployment_jobs(id) ON DELETE RESTRICT,
 state text NOT NULL DEFAULT 'reserved' CHECK(state IN ('reserved','accepted','failed','unknown','verified')),
 reserved_at timestamptz NOT NULL DEFAULT clock_timestamp(), finished_at timestamptz,
 admission_id uuid REFERENCES public.sandy_api_execution_admissions(id) ON DELETE RESTRICT
);
CREATE TABLE public.sandy_lifecycle_observations (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), snapshot_id uuid NOT NULL REFERENCES public.sandy_lifecycle_snapshots(id) ON DELETE RESTRICT,
 read_admission_id uuid NOT NULL REFERENCES public.sandy_api_execution_admissions(id) ON DELETE RESTRICT,
 phase text NOT NULL CHECK(phase IN ('source','compensation')), matched boolean NOT NULL,
 observation jsonb NOT NULL, recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(snapshot_id,read_admission_id,phase)
);
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['sandy_lifecycle_snapshots','sandy_lifecycle_compensations','sandy_lifecycle_observations'] LOOP
  EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC,anon,authenticated,service_role',t);
 END LOOP;
END $$;
CREATE FUNCTION public.sandy_lifecycle_immutable() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,pg_temp AS $$
BEGIN RAISE EXCEPTION 'provider_lifecycle_evidence_is_immutable' USING ERRCODE='23514'; END $$;
CREATE TRIGGER sandy_lifecycle_snapshot_immutable BEFORE UPDATE OR DELETE ON public.sandy_lifecycle_snapshots FOR EACH ROW EXECUTE FUNCTION public.sandy_lifecycle_immutable();
CREATE TRIGGER sandy_lifecycle_observation_immutable BEFORE UPDATE OR DELETE ON public.sandy_lifecycle_observations FOR EACH ROW EXECUTE FUNCTION public.sandy_lifecycle_immutable();

CREATE FUNCTION public.sandy_lifecycle_json_proof(p_value jsonb,p_canonical text,p_sha256 text) RETURNS boolean
LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog,pg_temp AS $$
BEGIN
 RETURN coalesce(p_canonical::jsonb=p_value AND p_sha256 ~ '^[a-f0-9]{64}$' AND
  encode(sha256(convert_to(p_canonical,'UTF8')),'hex')=p_sha256,false);
EXCEPTION WHEN OTHERS THEN RETURN false;
END $$;
CREATE FUNCTION public.sandy_lifecycle_blob_sha(p_content text) RETURNS text
LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog,pg_temp AS $$
DECLARE content_bytes bytea;
BEGIN
 content_bytes:=decode(p_content,'base64'); IF octet_length(content_bytes)>65536 THEN RETURN NULL; END IF;
 RETURN encode(extensions.digest(convert_to('blob '||octet_length(content_bytes)::text,'UTF8')||decode('00','hex')||content_bytes,'sha1'),'hex');
EXCEPTION WHEN OTHERS THEN RETURN NULL;
END $$;
CREATE FUNCTION public.sandy_lifecycle_vm_identity(p_result jsonb) RETURNS jsonb
LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog,pg_temp AS $$
BEGIN
 IF p_result->>'id' IS NULL OR p_result->>'id' !~ '^[1-9][0-9]{0,19}$' OR p_result->>'name' IS NULL
 OR p_result->>'name' !~ '^[a-z][-a-z0-9]{0,62}$' OR p_result->>'status' NOT IN ('RUNNING','TERMINATED')
 OR p_result->>'zone' IS DISTINCT FROM 'https://www.googleapis.com/compute/v1/projects/elaborate-haven-511518-a5/zones/europe-west1-b'
 OR p_result->>'selfLink' IS DISTINCT FROM ('https://www.googleapis.com/compute/v1/projects/elaborate-haven-511518-a5/zones/europe-west1-b/instances/'||(p_result->>'name'))
 OR p_result->>'creationTimestamp' IS NULL OR jsonb_typeof(p_result->'disks') IS DISTINCT FROM 'array'
 OR EXISTS(SELECT 1 FROM jsonb_array_elements(p_result->'disks') d WHERE d->>'type' IS DISTINCT FROM 'PERSISTENT') THEN RETURN NULL; END IF;
 PERFORM (p_result->>'creationTimestamp')::timestamptz;
 RETURN jsonb_build_object('id',p_result->'id','name',p_result->'name','zone',p_result->'zone','selfLink',p_result->'selfLink','creationTimestamp',p_result->'creationTimestamp','status',p_result->'status');
EXCEPTION WHEN OTHERS THEN RETURN NULL;
END $$;
CREATE FUNCTION public.sandy_lifecycle_valid_preimage(p_operation text,p_request_id uuid,p_record jsonb) RETURNS boolean
LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog,pg_temp AS $$
DECLARE args jsonb:=p_record->'source_arguments'; observed jsonb:=p_record->'read_result'; inverse jsonb:=p_record->'compensation_arguments'; identity jsonb; expected jsonb; target_sha text; file_path text;
BEGIN
 IF p_operation='github.files.upsert' THEN
  file_path:=args->'path'->>'path';target_sha:=public.sandy_lifecycle_blob_sha(args->'body'->>'content');
  IF target_sha IS NULL OR file_path IS NULL OR file_path NOT LIKE 'docs/sandy-api/compensation-fixtures/%' OR file_path ~ '(^|/)\.\.?(/|$)'
   OR args->'body'->>'branch' IS DISTINCT FROM 'main' OR inverse->'path' IS DISTINCT FROM args->'path'
   OR inverse->'body'->>'branch' IS DISTINCT FROM 'main' OR inverse->'body'->>'sha' IS DISTINCT FROM target_sha
   OR inverse->'body'->>'message' IS DISTINCT FROM 'Sandy compensation for '||p_request_id::text
   OR p_record->'read_arguments' IS DISTINCT FROM jsonb_build_object('path',args->'path','query',jsonb_build_object('ref','main'))
   OR p_record->'verify_arguments' IS DISTINCT FROM p_record->'read_arguments'
   OR p_record->'expected_effect' IS DISTINCT FROM jsonb_build_object('exists',true,'sha',target_sha) THEN RETURN false; END IF;
  IF p_record->'baseline'->>'exists'='false' THEN
   RETURN coalesce(NOT (args->'body' ? 'sha') AND observed=jsonb_build_object('error','provider_resource_not_found','provider_http_status',404)
    AND p_record->>'compensation_operation'='github.files.delete' AND NOT (inverse->'body' ? 'content'),false);
  END IF;
  RETURN coalesce(observed->>'path'=file_path AND observed->>'type'='file' AND observed->>'encoding'='base64'
   AND observed->>'sha'=public.sandy_lifecycle_blob_sha(observed->>'content') AND observed->>'sha'<>target_sha
   AND args->'body'->>'sha'=observed->>'sha' AND inverse->'body'->>'content'=observed->>'content'
   AND p_record->>'compensation_operation'='github.files.upsert'
   AND p_record->'baseline'=jsonb_build_object('exists',true,'sha',observed->'sha'),false);
 END IF;
 identity:=public.sandy_lifecycle_vm_identity(observed);
 IF identity IS NULL OR identity->>'status' IS DISTINCT FROM (CASE WHEN p_operation='gcp.compute.instances.start' THEN 'TERMINATED' ELSE 'RUNNING' END)
  OR args->'path'->>'instance' NOT IN (identity->>'name',identity->>'id')
  OR (args ? 'query' AND EXISTS(SELECT 1 FROM jsonb_object_keys(args->'query') k WHERE k<>'requestId'))
  OR inverse->'path' IS DISTINCT FROM jsonb_build_object('instance',identity->'id')
  OR p_record->'verify_arguments' IS DISTINCT FROM jsonb_build_object('path',jsonb_build_object('instance',identity->'id'))
  OR p_record->'baseline' IS DISTINCT FROM identity THEN RETURN false; END IF;
 expected:=jsonb_set(identity,'{status}',to_jsonb(CASE WHEN p_operation='gcp.compute.instances.start' THEN 'RUNNING' ELSE 'TERMINATED' END));
 RETURN coalesce(p_record->'expected_effect'=expected,false);
EXCEPTION WHEN OTHERS THEN RETURN false;
END $$;
CREATE FUNCTION public.sandy_lifecycle_effect_matches(p_operation text,p_record jsonb,p_phase text,p_observed jsonb,p_absent boolean) RETURNS boolean
LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog,pg_temp AS $$
DECLARE expected jsonb:=p_record->(CASE WHEN p_phase='source' THEN 'expected_effect' ELSE 'baseline' END);
BEGIN
 IF p_operation='github.files.upsert' THEN
  IF expected->>'exists'='false' THEN RETURN p_absent; END IF;
  RETURN coalesce(NOT p_absent AND p_observed->>'path'=p_record->'resource'->>'path' AND p_observed->>'type'='file' AND p_observed->>'sha'=expected->>'sha',false);
 END IF;
 RETURN coalesce(NOT p_absent AND public.sandy_lifecycle_vm_identity(p_observed)=expected,false);
END $$;
CREATE FUNCTION public.sandy_lifecycle_source_guard(p_actor_id uuid,p_source_admission_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE a public.sandy_api_execution_admissions%ROWTYPE; j public.sandy_deployment_jobs%ROWTYPE; p public.sandy_api_mutation_approval_snapshots%ROWTYPE;
BEGIN
 IF NOT public.sandy_api_current_owner(p_actor_id) THEN RETURN jsonb_build_object('ok',false,'error','owner_required','http_status',403); END IF;
 SELECT * INTO a FROM public.sandy_api_execution_admissions WHERE id=p_source_admission_id;
 SELECT * INTO j FROM public.sandy_deployment_jobs WHERE id=a.approval_id;
 SELECT * INTO p FROM public.sandy_api_mutation_approval_snapshots WHERE job_id=a.approval_id;
 IF a.id IS NULL OR a.actor_id IS DISTINCT FROM p_actor_id OR a.tenant_id IS NOT NULL OR a.credential_id IS NOT NULL
 OR a.operation NOT IN ('github.files.upsert','gcp.compute.instances.start','gcp.compute.instances.stop')
 OR a.state<>'admitted' OR a.expires_at<=clock_timestamp() OR a.is_mutation IS DISTINCT FROM true
 OR j.status IS DISTINCT FROM 'approved' OR p.job_id IS NULL OR p.actor_id IS DISTINCT FROM p_actor_id
 OR p.operation IS DISTINCT FROM a.operation OR p.input_sha256 IS DISTINCT FROM a.input_sha256 OR p.scope_sha256 IS DISTINCT FROM a.scope_sha256 OR p.contract_sha256 IS DISTINCT FROM a.contract_sha256
 OR p.job_fingerprint_sha256 IS DISTINCT FROM public.sandy_api_job_fingerprint(j)
 OR NOT EXISTS(SELECT 1 FROM public.sandy_engineering_changes WHERE id=p.engineering_change_id AND status='approved')
 OR j.payload->'sandy_lifecycle'->>'capture_preimage' IS DISTINCT FROM 'true'
 OR NOT EXISTS(SELECT 1 FROM public.sandy_operation_registry r WHERE r.operation=a.operation AND r.verified AND r.api_exposed AND r.handler='sandy-provider-operation-api') THEN
  RETURN jsonb_build_object('ok',false,'error','verified_approved_preimage_scope_required','http_status',424);
 END IF;
 RETURN jsonb_build_object('ok',true,'source_request_id',a.request_id,'source_operation',a.operation,'source_input_sha256',a.input_sha256,
  'preimage_read_approval_id',j.payload->'sandy_lifecycle'->>'preimage_read_approval_id');
END $$;
CREATE FUNCTION public.sandy_lifecycle_capture(p_actor_id uuid,p_source_admission_id uuid,p_record jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE guard jsonb; source public.sandy_api_execution_admissions%ROWTYPE; observed public.sandy_api_execution_admissions%ROWTYPE; prior public.sandy_lifecycle_snapshots%ROWTYPE; snapshot_uuid uuid;
BEGIN
 guard:=public.sandy_lifecycle_source_guard(p_actor_id,p_source_admission_id); IF guard->>'ok'<>'true' THEN RETURN guard; END IF;
 SELECT * INTO source FROM public.sandy_api_execution_admissions WHERE id=p_source_admission_id FOR UPDATE;
 IF source.state IS DISTINCT FROM 'admitted' OR source.expires_at<=clock_timestamp() THEN RETURN jsonb_build_object('ok',false,'error','verified_approved_preimage_scope_required','http_status',424); END IF;
 IF jsonb_typeof(p_record) IS DISTINCT FROM 'object' OR octet_length(p_record::text)>800000 THEN RETURN jsonb_build_object('ok',false,'error','invalid_preimage_record','http_status',400); END IF;
 BEGIN SELECT * INTO observed FROM public.sandy_api_execution_admissions WHERE id=(p_record->>'read_admission_id')::uuid; EXCEPTION WHEN invalid_text_representation THEN RETURN jsonb_build_object('ok',false,'error','invalid_preimage_record','http_status',400); END;
 IF observed.id IS NULL OR observed.actor_id IS DISTINCT FROM p_actor_id OR observed.tenant_id IS NOT NULL OR observed.credential_id IS NOT NULL
 OR observed.is_mutation IS DISTINCT FROM false OR observed.operation IS DISTINCT FROM p_record->>'read_operation'
 OR observed.created_at<source.created_at OR observed.finished_at IS NULL
 OR NOT (observed.state='succeeded' OR (source.operation='github.files.upsert' AND observed.state='failed' AND observed.provider_http_status=404 AND p_record->'baseline'->>'exists'='false'))
 OR NOT public.sandy_lifecycle_json_proof(p_record->'source_arguments',p_record->>'source_arguments_canonical',source.input_sha256)
 OR NOT public.sandy_lifecycle_json_proof(p_record->'read_arguments',p_record->>'read_arguments_canonical',observed.input_sha256)
 OR NOT public.sandy_lifecycle_json_proof(p_record->'read_result',p_record->>'read_result_canonical',observed.result_sha256)
 OR NOT public.sandy_lifecycle_json_proof(p_record->'compensation_arguments',p_record->>'compensation_arguments_canonical',p_record->>'compensation_input_sha256')
 OR NOT public.sandy_lifecycle_json_proof(p_record->'verify_arguments',p_record->>'verify_arguments_canonical',p_record->>'verify_input_sha256')
 OR NOT public.sandy_lifecycle_valid_preimage(source.operation,source.request_id,p_record) THEN
  RETURN jsonb_build_object('ok',false,'error','preimage_admission_proof_invalid','http_status',409);
 END IF;
 IF (source.operation='github.files.upsert' AND (observed.operation<>'github.files.content.get' OR p_record->>'verify_operation'<>'github.files.metadata.get'
    OR p_record->>'compensation_operation' NOT IN ('github.files.upsert','github.files.delete') OR p_record->'source_arguments'->'body'->>'branch'<>'main'
    OR p_record->'source_arguments'->'path'->>'path' NOT LIKE 'docs/sandy-api/compensation-fixtures/%'))
 OR (source.operation<>'github.files.upsert' AND (observed.operation<>'gcp.compute.instances.get' OR p_record->>'verify_operation'<>'gcp.compute.instances.get'
    OR p_record->>'compensation_operation'<>(CASE WHEN source.operation='gcp.compute.instances.start' THEN 'gcp.compute.instances.stop' ELSE 'gcp.compute.instances.start' END))) THEN
  RETURN jsonb_build_object('ok',false,'error','unsupported_preimage_scope','http_status',422);
 END IF;
 SELECT * INTO prior FROM public.sandy_lifecycle_snapshots WHERE source_admission_id=source.id;
 IF FOUND THEN
  IF prior.record IS DISTINCT FROM p_record THEN RETURN jsonb_build_object('ok',false,'error','immutable_preimage_conflict','http_status',409); END IF;
  RETURN jsonb_build_object('ok',true,'snapshot_id',prior.id,'reused',true,'provider_dispatched',false);
 END IF;
 INSERT INTO public.sandy_lifecycle_snapshots(actor_id,source_admission_id,source_request_id,source_operation,source_arguments,record)
 VALUES(p_actor_id,source.id,source.request_id,source.operation,p_record->'source_arguments',p_record) RETURNING id INTO snapshot_uuid;
 RETURN jsonb_build_object('ok',true,'snapshot_id',snapshot_uuid,'reused',false,'provider_dispatched',false);
END $$;
CREATE FUNCTION public.sandy_lifecycle_context(p_actor_id uuid,p_source_request_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE s public.sandy_lifecycle_snapshots%ROWTYPE;
BEGIN
 IF NOT public.sandy_api_current_owner(p_actor_id) THEN RETURN jsonb_build_object('ok',false,'error','owner_required','http_status',403); END IF;
 SELECT * INTO s FROM public.sandy_lifecycle_snapshots WHERE actor_id=p_actor_id AND source_request_id=p_source_request_id;
 IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'error','immutable_provider_preimage_missing','http_status',424); END IF;
 RETURN jsonb_build_object('ok',true,'snapshot',to_jsonb(s),'source_state',(SELECT state FROM public.sandy_api_execution_admissions WHERE id=s.source_admission_id),
  'compensation',(SELECT to_jsonb(c) FROM public.sandy_lifecycle_compensations c WHERE snapshot_id=s.id),
  'observations',coalesce((SELECT jsonb_agg(to_jsonb(o) ORDER BY recorded_at) FROM (SELECT * FROM public.sandy_lifecycle_observations WHERE snapshot_id=s.id ORDER BY recorded_at DESC LIMIT 20) o),'[]'::jsonb));
END $$;
CREATE FUNCTION public.sandy_lifecycle_observe(p_actor_id uuid,p_snapshot_id uuid,p_phase text,p_read_admission_id uuid,
 p_read_result jsonb,p_read_result_canonical text,p_matched boolean) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE s public.sandy_lifecycle_snapshots%ROWTYPE; a public.sandy_api_execution_admissions%ROWTYPE; source public.sandy_api_execution_admissions%ROWTYPE; c public.sandy_lifecycle_compensations%ROWTYPE; observation_id uuid;
BEGIN
 IF NOT public.sandy_api_current_owner(p_actor_id) THEN RETURN jsonb_build_object('ok',false,'error','owner_required','http_status',403); END IF;
 IF p_phase IS NULL OR p_phase NOT IN ('source','compensation') OR p_matched IS NULL THEN RETURN jsonb_build_object('ok',false,'error','invalid_lifecycle_observation','http_status',400); END IF;
 SELECT * INTO s FROM public.sandy_lifecycle_snapshots WHERE id=p_snapshot_id AND actor_id=p_actor_id;
 SELECT * INTO source FROM public.sandy_api_execution_admissions WHERE id=s.source_admission_id;
 SELECT * INTO a FROM public.sandy_api_execution_admissions WHERE id=p_read_admission_id;
 SELECT * INTO c FROM public.sandy_lifecycle_compensations WHERE snapshot_id=p_snapshot_id;
 IF s.id IS NULL OR a.actor_id IS DISTINCT FROM p_actor_id OR a.tenant_id IS NOT NULL OR a.credential_id IS NOT NULL OR a.is_mutation IS DISTINCT FROM false
 OR source.state NOT IN ('accepted','unknown','succeeded') OR source.consumed_at IS NULL OR a.created_at<source.consumed_at
 OR a.operation IS DISTINCT FROM s.record->>'verify_operation' OR a.input_sha256 IS DISTINCT FROM s.record->>'verify_input_sha256'
 OR NOT (a.state='succeeded' OR (p_phase='compensation' AND s.record->'baseline'->>'exists'='false' AND a.state='failed' AND a.provider_http_status=404))
 OR NOT public.sandy_lifecycle_json_proof(p_read_result,p_read_result_canonical,a.result_sha256)
 OR p_matched IS DISTINCT FROM public.sandy_lifecycle_effect_matches(s.source_operation,s.record,p_phase,p_read_result,a.state='failed' AND a.provider_http_status=404)
 OR (p_phase='compensation' AND (c.snapshot_id IS NULL OR c.admission_id IS NULL OR c.state NOT IN ('accepted','unknown','verified') OR a.created_at<c.reserved_at
  OR NOT EXISTS(SELECT 1 FROM public.sandy_api_execution_admissions inverse WHERE inverse.id=c.admission_id AND inverse.state IN ('accepted','unknown','succeeded') AND inverse.consumed_at IS NOT NULL))) THEN
  RETURN jsonb_build_object('ok',false,'error','lifecycle_readback_proof_invalid','http_status',409);
 END IF;
 INSERT INTO public.sandy_lifecycle_observations(snapshot_id,read_admission_id,phase,matched,observation)
 VALUES(s.id,a.id,p_phase,p_matched,p_read_result) ON CONFLICT(snapshot_id,read_admission_id,phase) DO NOTHING RETURNING id INTO observation_id;
 IF observation_id IS NULL THEN SELECT id INTO observation_id FROM public.sandy_lifecycle_observations WHERE snapshot_id=s.id AND read_admission_id=a.id AND phase=p_phase AND matched=p_matched; END IF;
 IF observation_id IS NULL THEN RETURN jsonb_build_object('ok',false,'error','immutable_observation_conflict','http_status',409); END IF;
 IF p_phase='compensation' AND p_matched THEN UPDATE public.sandy_lifecycle_compensations SET state='verified',finished_at=clock_timestamp() WHERE snapshot_id=s.id; END IF;
 RETURN jsonb_build_object('ok',true,'observation_id',observation_id,'effect_confirmed',p_matched,'phase',p_phase,'read_admission_id',a.id);
END $$;
CREATE FUNCTION public.sandy_lifecycle_reserve_compensation(p_actor_id uuid,p_snapshot_id uuid,p_approval_id uuid,p_observation_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE s public.sandy_lifecycle_snapshots%ROWTYPE; p public.sandy_api_mutation_approval_snapshots%ROWTYPE; j public.sandy_deployment_jobs%ROWTYPE; c public.sandy_lifecycle_compensations%ROWTYPE;
BEGIN
 IF NOT public.sandy_api_current_owner(p_actor_id) THEN RETURN jsonb_build_object('ok',false,'error','owner_required','http_status',403); END IF;
 SELECT * INTO s FROM public.sandy_lifecycle_snapshots WHERE id=p_snapshot_id AND actor_id=p_actor_id FOR UPDATE;
 IF s.id IS NULL THEN RETURN jsonb_build_object('ok',false,'error','immutable_provider_preimage_missing','http_status',424); END IF;
 SELECT * INTO c FROM public.sandy_lifecycle_compensations WHERE snapshot_id=s.id;
 IF FOUND THEN RETURN jsonb_build_object('ok',true,'reused',true,'request_id',c.request_id,'state',c.state,'redispatch_permitted',false); END IF;
 SELECT * INTO p FROM public.sandy_api_mutation_approval_snapshots WHERE job_id=p_approval_id;
 SELECT * INTO j FROM public.sandy_deployment_jobs WHERE id=p_approval_id FOR UPDATE;
 IF p.job_id IS NULL OR p.actor_id IS DISTINCT FROM p_actor_id OR j.status IS DISTINCT FROM 'approved'
 OR p.operation IS DISTINCT FROM s.record->>'compensation_operation' OR p.input_sha256 IS DISTINCT FROM s.record->>'compensation_input_sha256'
 OR p.job_fingerprint_sha256 IS DISTINCT FROM public.sandy_api_job_fingerprint(j)
 OR j.payload->'sandy_lifecycle_compensation'->>'source_request_id' IS DISTINCT FROM s.source_request_id::text
 OR j.payload->'sandy_lifecycle_compensation'->>'snapshot_id' IS DISTINCT FROM s.id::text
 OR (s.source_operation<>'github.files.upsert' AND j.payload->'sandy_lifecycle_compensation'->>'acknowledge_no_provider_state_cas' IS DISTINCT FROM 'true')
 OR NOT EXISTS(SELECT 1 FROM public.sandy_engineering_changes WHERE id=p.engineering_change_id AND status='approved')
 OR NOT EXISTS(SELECT 1 FROM public.sandy_lifecycle_observations o WHERE o.id=p_observation_id AND o.snapshot_id=s.id AND o.phase='source' AND o.matched AND o.recorded_at>clock_timestamp()-interval '30 seconds') THEN
  RETURN jsonb_build_object('ok',false,'error','verified_scoped_compensation_approval_required','http_status',424);
 END IF;
 INSERT INTO public.sandy_lifecycle_compensations(snapshot_id,actor_id,approval_id) VALUES(s.id,p_actor_id,p_approval_id) RETURNING * INTO c;
 RETURN jsonb_build_object('ok',true,'reused',false,'request_id',c.request_id,'state',c.state,'redispatch_permitted',true);
END $$;
CREATE FUNCTION public.sandy_lifecycle_finish_compensation(p_actor_id uuid,p_snapshot_id uuid,p_request_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE s public.sandy_lifecycle_snapshots%ROWTYPE; c public.sandy_lifecycle_compensations%ROWTYPE; a public.sandy_api_execution_admissions%ROWTYPE;
BEGIN
 IF NOT public.sandy_api_current_owner(p_actor_id) THEN RETURN jsonb_build_object('ok',false,'error','owner_required','http_status',403); END IF;
 SELECT * INTO s FROM public.sandy_lifecycle_snapshots WHERE id=p_snapshot_id AND actor_id=p_actor_id;
 SELECT * INTO c FROM public.sandy_lifecycle_compensations WHERE snapshot_id=p_snapshot_id AND actor_id=p_actor_id AND request_id=p_request_id FOR UPDATE;
 IF c.snapshot_id IS NULL OR s.id IS NULL THEN RETURN jsonb_build_object('ok',false,'error','compensation_reservation_not_found','http_status',404); END IF;
 SELECT * INTO a FROM public.sandy_api_execution_admissions WHERE actor_id=p_actor_id AND request_id=p_request_id;
 IF a.id IS NOT NULL AND (a.operation IS DISTINCT FROM s.record->>'compensation_operation' OR a.input_sha256 IS DISTINCT FROM s.record->>'compensation_input_sha256' OR a.approval_id IS DISTINCT FROM c.approval_id) THEN
  RETURN jsonb_build_object('ok',false,'error','compensation_admission_scope_mismatch','http_status',409); END IF;
 IF c.state='reserved' THEN
  UPDATE public.sandy_lifecycle_compensations SET state=CASE WHEN a.state='accepted' THEN 'accepted' WHEN a.state IN ('failed','rejected') THEN 'failed' ELSE 'unknown' END,
   admission_id=a.id,finished_at=clock_timestamp() WHERE snapshot_id=s.id RETURNING * INTO c;
 END IF;
 RETURN jsonb_build_object('ok',true,'request_id',c.request_id,'state',c.state,'admission_id',c.admission_id,'effect_confirmed',c.state='verified','redispatch_permitted',false);
END $$;
DO $$ DECLARE f record; BEGIN
 FOR f IN SELECT p.oid::regprocedure AS signature FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND strpos(p.proname,'sandy_lifecycle_')=1 LOOP
  EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon,authenticated,service_role',f.signature);
 END LOOP;
END $$;
GRANT EXECUTE ON FUNCTION public.sandy_lifecycle_source_guard(uuid,uuid),public.sandy_lifecycle_capture(uuid,uuid,jsonb),
 public.sandy_lifecycle_context(uuid,uuid),public.sandy_lifecycle_observe(uuid,uuid,text,uuid,jsonb,text,boolean),
 public.sandy_lifecycle_reserve_compensation(uuid,uuid,uuid,uuid),public.sandy_lifecycle_finish_compensation(uuid,uuid,uuid) TO service_role;
-- Typed registry contracts generated from provider_lifecycle.ts.
INSERT INTO public.sandy_operation_registry(operation,domain,description,permission_scope,is_mutation,input_schema,output_schema,handler,api_exposed,ui_exposed,ai_exposed,verified,implementation_state,source_repository,source_path,dependencies,retry_policy,rollback_policy,error_contract) VALUES ('system.lifecycle.get','system','Read an owned immutable provider lifecycle snapshot summary, verified readback and compensation receipt. Historical requests without a server-captured preimage fail closed; private file content and arguments are excluded. Contract v1.0.0.','system:read',false,'{"type":"object","properties":{"source_request_id":{"type":"string","format":"uuid"}},"required":["source_request_id"],"additionalProperties":false}'::jsonb,'{"type":"object","properties":{"ok":{"const":true},"contract_version":{"const":"1.0.0"},"source_request_id":{"type":"string","format":"uuid"},"snapshot_id":{"type":"string","format":"uuid"},"source_operation":{"enum":["github.files.upsert","gcp.compute.instances.start","gcp.compute.instances.stop"]},"source_state":{"type":"string"},"captured_at":{"type":"string","format":"date-time"},"resource":{"oneOf":[{"type":"object","properties":{"provider":{"const":"github"},"repository":{"const":"ausstyle/web-staging"},"branch":{"const":"main"},"path":{"type":"string","minLength":1,"maxLength":1024}},"required":["provider","repository","branch","path"],"additionalProperties":false},{"type":"object","properties":{"provider":{"const":"gcp"},"project_id":{"const":"elaborate-haven-511518-a5"},"zone":{"const":"europe-west1-b"},"instance_id":{"type":"string","pattern":"^[1-9][0-9]{0,19}$"},"instance_name":{"type":"string"}},"required":["provider","project_id","zone","instance_id","instance_name"],"additionalProperties":false}]},"compensation_operation":{"enum":["github.files.upsert","github.files.delete","gcp.compute.instances.start","gcp.compute.instances.stop"]},"compensation_input_sha256":{"type":"string","pattern":"^[a-f0-9]{64}$"},"latest_source_effect_confirmed":{"type":"boolean"},"compensation_request_id":{"type":["string","null"],"format":"uuid"},"compensation_state":{"type":["string","null"],"enum":[null,"reserved","accepted","failed","unknown","verified"]},"provider_state_cas_available":{"type":"boolean"},"limitations":{"type":"array","maxItems":3,"items":{"type":"string"}}},"required":["ok","contract_version","source_request_id","snapshot_id","source_operation","source_state","captured_at","resource","compensation_operation","compensation_input_sha256","latest_source_effect_confirmed","compensation_request_id","compensation_state","provider_state_cas_available","limitations"],"additionalProperties":false}'::jsonb,'sandy-operation-api',true,false,true,false,'source_ready','ausstyle/web-staging','supabase/functions/sandy-operation-api/provider_lifecycle.ts','["enabled_controller_owner","canonical_provider_executor","immutable_provider_preimage","verified_scoped_source_approval","real_read_admission_evidence"]'::jsonb,'{"safe_to_retry":true,"automatic":false,"reason":"Read-only provider polling or owned evidence query; no mutation retry"}'::jsonb,'{"applicable":false,"conditional":true,"supported":["fixed_repository_fixture_file_expected_sha","exact_numeric_vm_identity_and_observed_state"],"provider_writes_verified":false,"automatic":false}'::jsonb,'{"version":"1.0.0","api_key_delegable":false,"normal_user_session_required":true,"tenant_execution_supported":false,"no_caller_preimage":true,"provider_effect_readback_required":true}'::jsonb) ON CONFLICT(operation) DO NOTHING;
INSERT INTO public.sandy_operation_registry(operation,domain,description,permission_scope,is_mutation,input_schema,output_schema,handler,api_exposed,ui_exposed,ai_exposed,verified,implementation_state,source_repository,source_path,dependencies,retry_policy,rollback_policy,error_contract) VALUES ('system.lifecycle.verify','system','Read the real provider through canonical Sandy API and immutably record whether the approved source effect or conditional compensation is observed. This never retries a mutation or invents missing preimage evidence. Contract v1.0.0.','system:read',false,'{"type":"object","properties":{"source_request_id":{"type":"string","format":"uuid"},"phase":{"enum":["source","compensation"]}},"required":["source_request_id"],"additionalProperties":false}'::jsonb,'{"type":"object","properties":{"ok":{"const":true},"contract_version":{"const":"1.0.0"},"source_request_id":{"type":"string","format":"uuid"},"phase":{"enum":["source","compensation"]},"observation_id":{"type":"string","format":"uuid"},"read_admission_id":{"type":"string","format":"uuid"},"effect_confirmed":{"type":"boolean"},"automatic_retry":{"const":false}},"required":["ok","contract_version","source_request_id","phase","observation_id","read_admission_id","effect_confirmed","automatic_retry"],"additionalProperties":false}'::jsonb,'sandy-operation-api',true,false,true,false,'source_ready','ausstyle/web-staging','supabase/functions/sandy-operation-api/provider_lifecycle.ts','["enabled_controller_owner","canonical_provider_executor","immutable_provider_preimage","verified_scoped_source_approval","real_read_admission_evidence"]'::jsonb,'{"safe_to_retry":true,"automatic":false,"reason":"Read-only provider polling or owned evidence query; no mutation retry"}'::jsonb,'{"applicable":false,"conditional":true,"supported":["fixed_repository_fixture_file_expected_sha","exact_numeric_vm_identity_and_observed_state"],"provider_writes_verified":false,"automatic":false}'::jsonb,'{"version":"1.0.0","api_key_delegable":false,"normal_user_session_required":true,"tenant_execution_supported":false,"no_caller_preimage":true,"provider_effect_readback_required":true}'::jsonb) ON CONFLICT(operation) DO NOTHING;
INSERT INTO public.sandy_operation_registry(operation,domain,description,permission_scope,is_mutation,input_schema,output_schema,handler,api_exposed,ui_exposed,ai_exposed,verified,implementation_state,source_repository,source_path,dependencies,retry_policy,rollback_policy,error_contract) VALUES ('system.lifecycle.poll','system','Poll one fixed-project GCP zone/global compute operation with a real canonical GET. DONE is distinct from successful effect verification; operation errors and pending states remain explicit. Contract v1.0.0.','infrastructure:read',false,'{"type":"object","properties":{"scope":{"enum":["zone","global"]},"operation_name":{"type":"string","pattern":"^[a-z][a-z0-9-]{0,100}$|^[1-9][0-9]{0,19}$"}},"required":["scope","operation_name"],"additionalProperties":false}'::jsonb,'{"type":"object","properties":{"ok":{"const":true},"contract_version":{"const":"1.0.0"},"read_admission_id":{"type":"string","format":"uuid"},"provider_operation":{"type":"object","properties":{"name":{"type":"string"},"status":{"enum":["DONE","PENDING","RUNNING"]},"target_id":{"type":["string","null"]},"target_link":{"type":["string","null"]},"operation_type":{"type":["string","null"]}},"required":["name","status","target_id","target_link","operation_type"],"additionalProperties":false},"terminal":{"type":"boolean"},"provider_reported_error":{"type":"boolean"},"effect_confirmed":{"const":false},"automatic_retry":{"const":false}},"required":["ok","contract_version","read_admission_id","provider_operation","terminal","provider_reported_error","effect_confirmed","automatic_retry"],"additionalProperties":false}'::jsonb,'sandy-operation-api',true,false,true,false,'source_ready','ausstyle/web-staging','supabase/functions/sandy-operation-api/provider_lifecycle.ts','["enabled_controller_owner","canonical_provider_executor","immutable_provider_preimage","verified_scoped_source_approval","real_read_admission_evidence"]'::jsonb,'{"safe_to_retry":true,"automatic":false,"reason":"Read-only provider polling or owned evidence query; no mutation retry"}'::jsonb,'{"applicable":false,"conditional":true,"supported":["fixed_repository_fixture_file_expected_sha","exact_numeric_vm_identity_and_observed_state"],"provider_writes_verified":false,"automatic":false}'::jsonb,'{"version":"1.0.0","api_key_delegable":false,"normal_user_session_required":false,"tenant_execution_supported":false,"no_caller_preimage":true,"provider_effect_readback_required":true}'::jsonb) ON CONFLICT(operation) DO NOTHING;
INSERT INTO public.sandy_operation_registry(operation,domain,description,permission_scope,is_mutation,input_schema,output_schema,handler,api_exposed,ui_exposed,ai_exposed,verified,implementation_state,source_repository,source_path,dependencies,retry_policy,rollback_policy,error_contract) VALUES ('system.lifecycle.compensate','system','Execute one separately approved inverse from a private immutable provider preimage, after immediate exact-resource readback. GitHub requires the current file SHA; GCP binds numeric VM identity and approved state-race acknowledgement. Ambiguous dispatch is never replayed. Disabled until real attestation. Contract v1.0.0.','system:write',true,'{"type":"object","properties":{"source_request_id":{"type":"string","format":"uuid"},"compensation_approval_id":{"type":"string","format":"uuid"}},"required":["source_request_id","compensation_approval_id"],"additionalProperties":false}'::jsonb,'{"type":"object","properties":{"ok":{"const":true},"contract_version":{"const":"1.0.0"},"source_request_id":{"type":"string","format":"uuid"},"request_id":{"type":"string","format":"uuid"},"request_state":{"enum":["reserved","accepted","failed","unknown","verified"]},"executed":{"type":["boolean","null"]},"effect_confirmed":{"type":"boolean"},"reconciliation_required":{"type":"boolean"},"redispatch_permitted":{"const":false},"admission_id":{"type":["string","null"],"format":"uuid"}},"required":["ok","contract_version","source_request_id","request_id","request_state","executed","effect_confirmed","reconciliation_required","redispatch_permitted","admission_id"],"additionalProperties":false}'::jsonb,'sandy-operation-api',false,false,false,false,'source_ready','ausstyle/web-staging','supabase/functions/sandy-operation-api/provider_lifecycle.ts','["enabled_controller_owner","canonical_provider_executor","immutable_provider_preimage","verified_scoped_source_approval","real_read_admission_evidence"]'::jsonb,'{"safe_to_retry":false,"automatic":false,"reason":"A durable one-use reservation prevents redispatch even after ambiguous provider outcomes"}'::jsonb,'{"applicable":true,"conditional":true,"supported":["fixed_repository_fixture_file_expected_sha","exact_numeric_vm_identity_and_observed_state"],"provider_writes_verified":false,"automatic":false}'::jsonb,'{"version":"1.0.0","api_key_delegable":false,"normal_user_session_required":true,"tenant_execution_supported":false,"no_caller_preimage":true,"provider_effect_readback_required":true}'::jsonb) ON CONFLICT(operation) DO NOTHING;
COMMIT;
