-- Administrative PostgreSQL component test only. All owner, catalogue, queue
-- and registry fixtures roll back. No customer session or provider is invoked.
BEGIN;
DO $$
DECLARE actor uuid:=gen_random_uuid(); worker uuid:=gen_random_uuid(); reply jsonb; entry jsonb; original_error jsonb; steps jsonb; job uuid; lease uuid;
BEGIN
 IF EXISTS(SELECT 1 FROM public.sandy_orch_jobs) THEN RAISE EXCEPTION 'test_requires_isolated_orchestration_queue'; END IF;
 INSERT INTO public.sandy_controller_admins(auth_user_id,role,enabled) VALUES(actor,'owner',true);
 SELECT error_contract INTO original_error FROM public.sandy_operation_registry WHERE operation='supabase.project.config.auth.get';
 entry:=public.sandy_orch_snapshot('supabase.project.config.auth.get','api');
 IF entry IS NULL OR entry->>'handler'<>'sandy-provider-operation-api' THEN RAISE EXCEPTION 'reviewed metadata GET not delegated'; END IF;
 IF public.sandy_orch_snapshot('github.files.content.get','api') IS NOT NULL OR public.sandy_orch_snapshot('gcp.compute.instances.start','api') IS NOT NULL THEN RAISE EXCEPTION 'sensitive/approved/mutation operation delegated'; END IF;
 UPDATE public.sandy_operation_registry SET error_contract=jsonb_set(original_error,'{requires_cost_approval}','true') WHERE operation='supabase.project.config.auth.get';
 IF public.sandy_orch_snapshot('supabase.project.config.auth.get','api') IS NOT NULL THEN RAISE EXCEPTION 'newly cost-gated operation remained delegated'; END IF;
 UPDATE public.sandy_operation_registry SET error_contract=jsonb_set(original_error,'{sensitive_response}','true') WHERE operation='supabase.project.config.auth.get';
 IF public.sandy_orch_snapshot('supabase.project.config.auth.get','api') IS NOT NULL THEN RAISE EXCEPTION 'newly sensitive operation remained delegated'; END IF;
 UPDATE public.sandy_operation_registry SET error_contract=jsonb_set(original_error,'{contract_sha256}',to_jsonb(repeat('f',64))) WHERE operation='supabase.project.config.auth.get';
 IF public.sandy_orch_snapshot('supabase.project.config.auth.get','api') IS NOT NULL THEN RAISE EXCEPTION 'unreviewed provider contract remained delegated'; END IF;
 UPDATE public.sandy_operation_registry SET error_contract=original_error WHERE operation='supabase.project.config.auth.get';
 reply:=public.sandy_orch_catalogue(actor,'api');
 SELECT value INTO entry FROM jsonb_array_elements(reply->'operations') WHERE value->>'operation'='supabase.project.config.auth.get';
 IF entry IS NULL THEN RAISE EXCEPTION 'owned provider read catalogue unavailable'; END IF;
 steps:=jsonb_build_array(jsonb_build_object('key','project','operation','supabase.project.config.auth.get','arguments','{}'::jsonb,'depends_on','[]'::jsonb,'input_sha256',encode(sha256(convert_to('{}','UTF8')),'hex'),'registry_revision',entry->>'registry_revision'));
 reply:=public.sandy_orch_admit(actor,'api','operation','provider-read-dag-component',steps);job:=(reply->'jobs'->0->>'job_id')::uuid;
 IF reply->>'accepted' IS DISTINCT FROM 'true' OR reply->>'executed' IS DISTINCT FROM 'false' OR job IS NULL THEN RAISE EXCEPTION 'provider read durable admission failed'; END IF;
 reply:=public.sandy_orch_claim(worker,1,90);lease:=(reply->'claims'->0->>'lease_token')::uuid;
 reply:=public.sandy_orch_resolve_dispatch(job,lease,worker);
 IF reply->>'principal_id' IS DISTINCT FROM actor::text OR reply->'registry_contract'->>'handler' IS DISTINCT FROM 'sandy-provider-operation-api'
  OR reply->>'operation' IS DISTINCT FROM 'supabase.project.config.auth.get' THEN RAISE EXCEPTION 'provider dispatch context not pinned'; END IF;
END $$;
SELECT jsonb_build_object('passed',true,'layer','administrative_database_component','provider_called',false,'controller_session_tested',false,'fixtures','rolled_back',
 'checks',ARRAY['reviewed_provider_get_eligibility','sensitive_read_refusal','mutation_refusal','cost_gate_drift_refusal','sensitive_flag_drift_refusal','provider_contract_drift_refusal','owned_catalogue','transactional_read_admission','immutable_scoped_dispatch']) AS evidence;
ROLLBACK;
