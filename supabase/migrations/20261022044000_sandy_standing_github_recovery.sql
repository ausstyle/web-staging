BEGIN;
-- Standing recovery uses the existing private snapshot, observation, admission
-- and compensation ledgers. The caller supplies no source content or inverse.
CREATE FUNCTION public.sandy_engineering_recovery_context(p_user_id uuid,p_session_id uuid,p_epoch integer,p_request_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE owned jsonb;a public.sandy_api_execution_admissions;j public.sandy_deployment_jobs;
BEGIN
 owned:=public.sandy_engineering_owns_execution(p_user_id,p_session_id,p_epoch,p_request_id);
 IF owned->>'owned' IS DISTINCT FROM 'true' THEN RETURN jsonb_build_object('ok',false,'error','recovery_source_not_owned','http_status',404);END IF;
 SELECT admission.* INTO a FROM public.sandy_api_execution_admissions admission
 JOIN public.sandy_engineering_execution_authorizations e ON e.job_id=admission.approval_id AND admission.actor_id=e.owner_authority_id AND admission.request_id=e.request_id
 WHERE e.identity_user_id=p_user_id AND e.request_id=p_request_id;
 SELECT * INTO j FROM public.sandy_deployment_jobs WHERE id=a.approval_id;
 IF a.operation NOT IN('github.files.create','github.files.update','github.update_file') OR a.state IS DISTINCT FROM 'succeeded'
 OR a.effect_verification->>'kind' IS DISTINCT FROM 'github_file' OR a.effect_verification->>'repository' IS DISTINCT FROM 'ausstyle/web-staging'
 OR a.effect_verification->>'path' IS DISTINCT FROM j.payload->'recovery'->>'path'
 OR coalesce(j.payload->'recovery'->>'branch','') !~ '^engineering/[A-Za-z0-9_./-]+$'
 OR coalesce(a.effect_verification->>'commit_sha','') !~ '^[a-f0-9]{40}$'
 OR coalesce(a.effect_verification->>'blob_sha','') !~ '^[a-f0-9]{40}$'
 THEN RETURN jsonb_build_object('ok',false,'error','verified_github_recovery_source_required','http_status',424);END IF;
 RETURN jsonb_build_object('ok',true,'admission_id',a.id,'operation',a.operation,'commit_sha',a.effect_verification->'commit_sha',
 'blob_sha',a.effect_verification->'blob_sha','path',a.effect_verification->'path','branch',j.payload->'recovery'->'branch',
 'expected_blob_sha',j.payload->'recovery'->'expected_blob_sha','snapshot_exists',EXISTS(SELECT 1 FROM public.sandy_lifecycle_snapshots WHERE source_admission_id=a.id));
END $$;

CREATE FUNCTION public.sandy_engineering_capture_recovery(p_user_id uuid,p_session_id uuid,p_epoch integer,p_request_id uuid,p_record jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE ctx jsonb;source public.sandy_api_execution_admissions;c public.sandy_api_execution_admissions;b public.sandy_api_execution_admissions;
 inverse jsonb;verify_args jsonb;resource jsonb;parent text;prior public.sandy_lifecycle_snapshots;snapshot_id uuid;old_sha text;absent boolean;
BEGIN
 ctx:=public.sandy_engineering_recovery_context(p_user_id,p_session_id,p_epoch,p_request_id);IF ctx->>'ok' IS DISTINCT FROM 'true' THEN RETURN ctx;END IF;
 SELECT * INTO source FROM public.sandy_api_execution_admissions WHERE id=(ctx->>'admission_id')::uuid FOR UPDATE;
 SELECT * INTO prior FROM public.sandy_lifecycle_snapshots WHERE source_admission_id=source.id;
 IF FOUND THEN RETURN jsonb_build_object('ok',true,'snapshot_id',prior.id,'reused',true);END IF;
 IF p_record IS NULL OR jsonb_typeof(p_record) IS DISTINCT FROM 'object' OR octet_length(p_record::text)>800000 OR p_record->>'proof_version' IS DISTINCT FROM '2' THEN
 RETURN jsonb_build_object('ok',false,'error','immutable_recovery_proof_invalid','http_status',409);END IF;
 SELECT * INTO c FROM public.sandy_api_execution_admissions WHERE id=(p_record->>'commit_read_admission_id')::uuid;
 SELECT * INTO b FROM public.sandy_api_execution_admissions WHERE id=(p_record->>'read_admission_id')::uuid;
 parent:=p_record->'commit_read_result'->'parents'->0->>'sha';old_sha:=ctx->>'expected_blob_sha';absent:=old_sha IS NULL;
 resource:=jsonb_build_object('provider','github','repository','ausstyle/web-staging','branch',ctx->'branch','path',ctx->'path');
 verify_args:=jsonb_build_object('path',jsonb_build_object('path',ctx->'path'),'query',jsonb_build_object('ref',ctx->'branch'));
 inverse:=jsonb_build_object('path',verify_args->'path','body',jsonb_build_object('branch',ctx->'branch','sha',ctx->'blob_sha','message','Sandy compensation for '||p_request_id::text));
 IF NOT absent THEN inverse:=jsonb_set(inverse,'{body,content}',p_record->'read_result'->'content');END IF;
 IF c.id IS NULL OR b.id IS NULL OR parent IS NULL OR parent !~ '^[a-f0-9]{40}$'
 OR c.actor_id IS DISTINCT FROM source.actor_id OR b.actor_id IS DISTINCT FROM source.actor_id
 OR c.operation IS DISTINCT FROM 'github.git.commits.get' OR b.operation IS DISTINCT FROM 'github.files.content.get'
 OR c.state IS DISTINCT FROM 'succeeded' OR c.created_at<source.finished_at OR b.created_at<c.finished_at
 OR c.is_mutation OR b.is_mutation OR c.credential_id IS NOT NULL OR b.credential_id IS NOT NULL OR c.tenant_id IS NOT NULL OR b.tenant_id IS NOT NULL
 OR NOT EXISTS(SELECT 1 FROM public.sandy_engineering_execution_authorizations WHERE job_id=c.approval_id AND identity_user_id=p_user_id)
 OR NOT EXISTS(SELECT 1 FROM public.sandy_engineering_execution_authorizations WHERE job_id=b.approval_id AND identity_user_id=p_user_id)
 OR NOT public.sandy_lifecycle_json_proof(p_record->'commit_read_result',p_record->>'commit_read_result_canonical',c.result_sha256)
 OR NOT public.sandy_lifecycle_json_proof(jsonb_build_object('path',jsonb_build_object('commit_sha',ctx->'commit_sha')),p_record->>'commit_read_arguments_canonical',c.input_sha256)
 OR p_record->'commit_read_result'->>'sha' IS DISTINCT FROM ctx->>'commit_sha'
 OR NOT public.sandy_lifecycle_json_proof(p_record->'read_result',p_record->>'read_result_canonical',b.result_sha256)
 OR NOT public.sandy_lifecycle_json_proof(p_record->'read_arguments',p_record->>'read_arguments_canonical',b.input_sha256)
 OR p_record->'read_arguments' IS DISTINCT FROM jsonb_build_object('path',verify_args->'path','query',jsonb_build_object('ref',parent))
 OR p_record->>'read_operation' IS DISTINCT FROM b.operation
 OR (absent AND (b.state IS DISTINCT FROM 'failed' OR b.provider_http_status IS DISTINCT FROM 404 OR p_record->'read_result' IS DISTINCT FROM '{"error":"provider_resource_not_found","provider_http_status":404}'::jsonb))
 OR (NOT absent AND (b.state IS DISTINCT FROM 'succeeded' OR p_record->'read_result'->>'path' IS DISTINCT FROM ctx->>'path'
   OR p_record->'read_result'->>'sha' IS DISTINCT FROM old_sha OR public.sandy_lifecycle_blob_sha(p_record->'read_result'->>'content') IS DISTINCT FROM old_sha))
 OR p_record->'baseline' IS DISTINCT FROM (CASE WHEN absent THEN '{"exists":false}'::jsonb ELSE jsonb_build_object('exists',true,'sha',old_sha) END)
 OR p_record->'expected_effect' IS DISTINCT FROM jsonb_build_object('exists',true,'sha',ctx->'blob_sha') OR p_record->'resource' IS DISTINCT FROM resource
 OR p_record->>'verify_operation' IS DISTINCT FROM 'github.files.metadata.get' OR p_record->'verify_arguments' IS DISTINCT FROM verify_args
 OR NOT public.sandy_lifecycle_json_proof(verify_args,p_record->>'verify_arguments_canonical',p_record->>'verify_input_sha256')
 OR p_record->>'compensation_operation' IS DISTINCT FROM (CASE WHEN absent THEN 'github.files.delete' ELSE 'github.files.update' END)
 OR p_record->'compensation_arguments' IS DISTINCT FROM inverse
 OR NOT public.sandy_lifecycle_json_proof(inverse,p_record->>'compensation_arguments_canonical',p_record->>'compensation_input_sha256') THEN
 RETURN jsonb_build_object('ok',false,'error','immutable_recovery_proof_invalid','http_status',409);END IF;
 INSERT INTO public.sandy_lifecycle_snapshots(actor_id,source_admission_id,source_request_id,source_operation,source_arguments,record)
 VALUES(source.actor_id,source.id,source.request_id,source.operation,jsonb_build_object('path',verify_args->'path','body',jsonb_build_object('branch',ctx->'branch','sha',old_sha)),p_record) RETURNING id INTO snapshot_id;
 RETURN jsonb_build_object('ok',true,'snapshot_id',snapshot_id,'reused',false);
EXCEPTION WHEN invalid_text_representation THEN RETURN jsonb_build_object('ok',false,'error','immutable_recovery_proof_invalid','http_status',409);
END $$;

CREATE FUNCTION public.sandy_engineering_reserve_compensation(p_user_id uuid,p_session_id uuid,p_epoch integer,p_snapshot_id uuid,p_observation_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE s public.sandy_lifecycle_snapshots;c public.sandy_lifecycle_compensations;ctx jsonb;prepared jsonb;contract text;request_id uuid:=gen_random_uuid();
BEGIN
 SELECT * INTO s FROM public.sandy_lifecycle_snapshots WHERE id=p_snapshot_id FOR UPDATE;
 IF s.id IS NULL OR s.record->>'proof_version' IS DISTINCT FROM '2' THEN RETURN jsonb_build_object('ok',false,'error','immutable_provider_preimage_missing','http_status',424);END IF;
 ctx:=public.sandy_engineering_recovery_context(p_user_id,p_session_id,p_epoch,s.source_request_id);IF ctx->>'ok' IS DISTINCT FROM 'true' THEN RETURN ctx;END IF;
 SELECT * INTO c FROM public.sandy_lifecycle_compensations WHERE snapshot_id=s.id;
 IF FOUND THEN RETURN jsonb_build_object('ok',true,'reused',true,'request_id',c.request_id,'authorization_id',c.approval_id,'state',c.state,'redispatch_permitted',false);END IF;
 IF NOT EXISTS(SELECT 1 FROM public.sandy_lifecycle_observations o WHERE o.id=p_observation_id AND o.snapshot_id=s.id AND o.phase='source' AND o.matched AND o.recorded_at>clock_timestamp()-interval '30 seconds') THEN
 RETURN jsonb_build_object('ok',false,'error','compensation_resource_changed','http_status',409);END IF;
 SELECT error_contract->>'contract_sha256' INTO contract FROM public.sandy_operation_registry WHERE operation=s.record->>'compensation_operation';
 prepared:=public.sandy_engineering_prepare_delegated(p_user_id,p_session_id,p_epoch,request_id,s.record->>'compensation_operation',s.record->>'compensation_arguments_canonical',contract,'{"provider":"github","repository":"ausstyle/web-staging"}');
 IF prepared->>'ok' IS DISTINCT FROM 'true' THEN RETURN prepared;END IF;
 INSERT INTO public.sandy_lifecycle_compensations(snapshot_id,actor_id,approval_id,request_id) VALUES(s.id,s.actor_id,(prepared->>'authorization_id')::uuid,request_id) RETURNING * INTO c;
 RETURN jsonb_build_object('ok',true,'reused',false,'request_id',c.request_id,'authorization_id',c.approval_id,'state',c.state,'redispatch_permitted',true);
END $$;
REVOKE ALL ON FUNCTION public.sandy_engineering_recovery_context(uuid,uuid,integer,uuid),public.sandy_engineering_capture_recovery(uuid,uuid,integer,uuid,jsonb),public.sandy_engineering_reserve_compensation(uuid,uuid,integer,uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.sandy_engineering_recovery_context(uuid,uuid,integer,uuid),public.sandy_engineering_capture_recovery(uuid,uuid,integer,uuid,jsonb),public.sandy_engineering_reserve_compensation(uuid,uuid,integer,uuid,uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.sandy_engineering_resolve_standing(p_user_id uuid, p_session_id uuid, p_epoch integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
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
 ops:=ops||'["system.execution.get","system.lifecycle.get","system.lifecycle.verify","system.lifecycle.compensate"]'::jsonb;
 RETURN jsonb_build_object('ok',true,'identity_user_id',p_user_id,'owner_authority_id',d.owner_authority_id,'session_id',p_session_id,
 'delegation_id',d.id,'version',d.version,'operations',ops,'expires_at',d.expires_at,'policy',d.policy);
END $function$
;

CREATE OR REPLACE FUNCTION public.sandy_lifecycle_effect_matches(p_operation text, p_record jsonb, p_phase text, p_observed jsonb, p_absent boolean)
 RETURNS boolean
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
DECLARE expected jsonb:=p_record->(CASE WHEN p_phase='source' THEN 'expected_effect' ELSE 'baseline' END);
BEGIN
 IF p_operation IN('github.files.upsert','github.files.create','github.files.update','github.update_file') THEN
  IF expected->>'exists'='false' THEN RETURN p_absent; END IF;
  RETURN coalesce(NOT p_absent AND p_observed->>'path'=p_record->'resource'->>'path' AND p_observed->>'type'='file' AND p_observed->>'sha'=expected->>'sha',false);
 END IF;
 RETURN coalesce(NOT p_absent AND public.sandy_lifecycle_vm_identity(p_observed)=expected,false);
END $function$
;

CREATE OR REPLACE FUNCTION public.sandy_lifecycle_finish_compensation(p_actor_id uuid, p_snapshot_id uuid, p_request_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
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
  UPDATE public.sandy_lifecycle_compensations SET state=CASE WHEN a.state IN('accepted','succeeded') THEN 'accepted' WHEN a.state IN ('failed','rejected') THEN 'failed' ELSE 'unknown' END,
   admission_id=a.id,finished_at=clock_timestamp() WHERE snapshot_id=s.id RETURNING * INTO c;
 END IF;
 RETURN jsonb_build_object('ok',true,'request_id',c.request_id,'state',c.state,'admission_id',c.admission_id,'effect_confirmed',c.state='verified','redispatch_permitted',false);
END $function$
;

NOTIFY pgrst,'reload schema';
CREATE OR REPLACE FUNCTION public.sandy_lifecycle_observe(p_actor_id uuid, p_snapshot_id uuid, p_phase text, p_read_admission_id uuid, p_read_result jsonb, p_read_result_canonical text, p_matched boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
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
 -- A policy-bound delete may have an accepted/unknown response, followed by an
 -- actual canonical 404. Only this owned inverse and immutable snapshot can
 -- establish its absence proof; unrelated mutations cannot use this transition.
 IF p_phase='compensation' AND p_matched AND s.record->>'proof_version'='2'
 AND s.record->'baseline'->>'exists'='false' AND a.state='failed' AND a.provider_http_status=404 THEN
  UPDATE public.sandy_api_execution_admissions inverse SET state='succeeded',finished_at=clock_timestamp(),
   effect_verification=jsonb_build_object('version',1,'kind','github_compensation_absence','snapshot_id',s.id,'read_admission_id',a.id,'observation_id',observation_id),
   result_sha256=encode(extensions.digest(coalesce(inverse.result_sha256,'')||':'||a.result_sha256,'sha256'),'hex')
  WHERE inverse.id=c.admission_id AND inverse.operation='github.files.delete' AND inverse.state IN('accepted','unknown')
   AND inverse.consumed_at IS NOT NULL AND inverse.approval_id=c.approval_id
   AND inverse.input_sha256=s.record->>'compensation_input_sha256'
   AND public.sandy_engineering_policy_job_authorized(c.approval_id,'running');
  IF FOUND THEN
   UPDATE public.sandy_deployment_jobs SET status='succeeded',finished_at=clock_timestamp(),updated_at=clock_timestamp(),
    result=coalesce(result,'{}'::jsonb)||jsonb_build_object('effect_verified',true,'snapshot_id',s.id,'read_admission_id',a.id,'reconciliation_required',false) WHERE id=c.approval_id;
   PERFORM public.sandy_api_append_audit(p_actor_id,'github.files.delete',c.request_id,NULL,c.admission_id,'verification','succeeded',s.record->>'compensation_input_sha256',a.result_sha256,404,NULL);
  END IF;
 END IF;

 RETURN jsonb_build_object('ok',true,'observation_id',observation_id,'effect_confirmed',p_matched,'phase',p_phase,'read_admission_id',a.id);
END $function$
;
UPDATE public.sandy_operation_registry SET input_schema='{"type":"object","properties":{"source_request_id":{"type":"string","format":"uuid"}},"required":["source_request_id"],"additionalProperties":false}'::jsonb,output_schema='{"type":"object","properties":{"ok":{"const":true},"contract_version":{"const":"1.0.0"},"source_request_id":{"type":"string","format":"uuid"},"snapshot_id":{"type":"string","format":"uuid"},"source_operation":{"enum":["github.files.upsert","github.files.create","github.files.update","github.update_file","gcp.compute.instances.start","gcp.compute.instances.stop"]},"source_state":{"type":"string"},"captured_at":{"type":"string","format":"date-time"},"resource":{"oneOf":[{"type":"object","properties":{"provider":{"const":"github"},"repository":{"const":"ausstyle/web-staging"},"branch":{"type":"string","pattern":"^(main|engineering/[A-Za-z0-9_./-]+)$"},"path":{"type":"string","minLength":1,"maxLength":1024}},"required":["provider","repository","branch","path"],"additionalProperties":false},{"type":"object","properties":{"provider":{"const":"gcp"},"project_id":{"const":"elaborate-haven-511518-a5"},"zone":{"const":"europe-west1-b"},"instance_id":{"type":"string","pattern":"^[1-9][0-9]{0,19}$"},"instance_name":{"type":"string"}},"required":["provider","project_id","zone","instance_id","instance_name"],"additionalProperties":false}]},"compensation_operation":{"enum":["github.files.upsert","github.files.update","github.files.delete","gcp.compute.instances.start","gcp.compute.instances.stop"]},"compensation_input_sha256":{"type":"string","pattern":"^[a-f0-9]{64}$"},"latest_source_effect_confirmed":{"type":"boolean"},"compensation_request_id":{"type":["string","null"],"format":"uuid"},"compensation_state":{"type":["string","null"],"enum":[null,"reserved","accepted","failed","unknown","verified"]},"provider_state_cas_available":{"type":"boolean"},"limitations":{"type":"array","maxItems":3,"items":{"type":"string"}}},"required":["ok","contract_version","source_request_id","snapshot_id","source_operation","source_state","captured_at","resource","compensation_operation","compensation_input_sha256","latest_source_effect_confirmed","compensation_request_id","compensation_state","provider_state_cas_available","limitations"],"additionalProperties":false}'::jsonb,description='Read an owned immutable provider lifecycle snapshot summary, verified readback and compensation receipt. Historical requests without a server-captured preimage fail closed; private file content and arguments are excluded. Contract v1.0.0.',updated_at=clock_timestamp() WHERE operation='system.lifecycle.get' AND handler='sandy-operation-api';
UPDATE public.sandy_operation_registry SET input_schema='{"type":"object","properties":{"source_request_id":{"type":"string","format":"uuid"},"phase":{"enum":["source","compensation"]}},"required":["source_request_id"],"additionalProperties":false}'::jsonb,output_schema='{"type":"object","properties":{"ok":{"const":true},"contract_version":{"const":"1.0.0"},"source_request_id":{"type":"string","format":"uuid"},"phase":{"enum":["source","compensation"]},"observation_id":{"type":"string","format":"uuid"},"read_admission_id":{"type":"string","format":"uuid"},"effect_confirmed":{"type":"boolean"},"automatic_retry":{"const":false}},"required":["ok","contract_version","source_request_id","phase","observation_id","read_admission_id","effect_confirmed","automatic_retry"],"additionalProperties":false}'::jsonb,description='Read the real provider through canonical Sandy API and immutably record whether the approved source effect or conditional compensation is observed. This never retries a mutation or invents missing preimage evidence. Contract v1.0.0.',updated_at=clock_timestamp() WHERE operation='system.lifecycle.verify' AND handler='sandy-operation-api';
UPDATE public.sandy_operation_registry SET input_schema='{"type":"object","properties":{"source_request_id":{"type":"string","format":"uuid"},"compensation_approval_id":{"type":"string","format":"uuid"}},"required":["source_request_id"],"additionalProperties":false}'::jsonb,output_schema='{"type":"object","properties":{"ok":{"const":true},"contract_version":{"const":"1.0.0"},"source_request_id":{"type":"string","format":"uuid"},"request_id":{"type":"string","format":"uuid"},"request_state":{"enum":["reserved","accepted","failed","unknown","verified"]},"executed":{"type":["boolean","null"]},"effect_confirmed":{"type":"boolean"},"reconciliation_required":{"type":"boolean"},"redispatch_permitted":{"const":false},"admission_id":{"type":["string","null"],"format":"uuid"}},"required":["ok","contract_version","source_request_id","request_id","request_state","executed","effect_confirmed","reconciliation_required","redispatch_permitted","admission_id"],"additionalProperties":false}'::jsonb,description='Execute one authorized inverse from an immutable provider preimage after exact-resource readback. Standing engineering recovery derives its baseline from verified Git history and reauthorizes the inverse under the current resource policy. Other callers retain separately approved compensation. Ambiguous dispatch is never replayed. Contract v1.0.0.',updated_at=clock_timestamp() WHERE operation='system.lifecycle.compensate' AND handler='sandy-operation-api';
COMMIT;
