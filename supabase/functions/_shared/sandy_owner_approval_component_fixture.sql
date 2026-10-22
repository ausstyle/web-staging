-- Test fixture only; include inside a transaction that always ROLLBACKs.
-- Administrative SQL seeds synthetic proof records to exercise DB invariants.
-- It creates no Auth/Controller membership, JWT, real customer approval or job
-- dispatch. Never describe this fixture as an authenticated approval test.
CREATE FUNCTION pg_temp.sandy_owner_component_admission(p_operation text,p_arguments jsonb,p_scope_sha256 text) RETURNS uuid
LANGUAGE plpgsql AS $$
DECLARE actor uuid;admission uuid:=gen_random_uuid();change_id uuid:=gen_random_uuid();job_id uuid:=gen_random_uuid();canonical text:=p_arguments::text;entry public.sandy_operation_registry;job public.sandy_deployment_jobs;
BEGIN
 SELECT auth_user_id INTO actor FROM public.sandy_controller_admins WHERE role='owner' AND enabled ORDER BY created_at LIMIT 1;
 IF actor IS NULL THEN RAISE EXCEPTION 'component_existing_owner_metadata_required';END IF;
 SELECT * INTO entry FROM public.sandy_operation_registry WHERE operation=p_operation;
 IF entry.operation IS NULL THEN RAISE EXCEPTION 'component_operation_missing';END IF;
 INSERT INTO public.sandy_engineering_changes(id,title,problem,expected_behavior,status,requested_by)
 VALUES(change_id,'SYNTHETIC ROLLBACK ONLY approval-link fixture','Administrative DB invariant fixture, no session or deployment','The entire fixture is rolled back, no provider dispatch','approved',actor);
 INSERT INTO public.sandy_deployment_jobs(id,requested_by,provider,operation,target,idempotency_key,status,engineering_change_id,approved_by,approved_at)
 VALUES(job_id,'sandy_rollback_component_fixture','google_cloud','get_vm','SYNTHETIC-NO-PROVIDER-DISPATCH',job_id::text,'running',change_id,actor::text,clock_timestamp()) RETURNING * INTO job;
 INSERT INTO public.sandy_api_mutation_approval_snapshots(job_id,actor_id,engineering_change_id,operation,input_sha256,contract_sha256,scope_sha256,maximum_declared_cost_units,job_fingerprint_sha256)
 VALUES(job_id,actor,change_id,p_operation,encode(extensions.digest(canonical,'sha256'),'hex'),entry.error_contract->>'contract_sha256',p_scope_sha256,0,public.sandy_api_job_fingerprint(job));
 INSERT INTO public.sandy_api_execution_admissions(id,actor_id,operation,request_id,is_mutation,input_sha256,contract_sha256,scope_sha256,registry_revision_sha256,declared_cost_units,state,expires_at,approval_id)
 VALUES(admission,actor,p_operation,gen_random_uuid(),entry.is_mutation,encode(extensions.digest(canonical,'sha256'),'hex'),entry.error_contract->>'contract_sha256',p_scope_sha256,public.sandy_api_registry_revision(p_operation),0,'consumed',clock_timestamp()+interval '60 seconds',job_id);
 RETURN admission;
END $$;
