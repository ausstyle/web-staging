-- Real PostgreSQL routing/ACL component checks only. No Auth session, worker,
-- HTTP/provider call, cancellation, retry or compensation executes. All fixtures
-- and temporary registry flags are rolled back. Synthetic snapshot rows below
-- test association only; they are not evidence of valid provider preimages.
BEGIN;
DO $$ BEGIN
 IF has_function_privilege('anon','public.sandy_api_resolve_job_route(uuid,uuid,text,text,uuid,text[])','EXECUTE')
 OR has_function_privilege('authenticated','public.sandy_api_resolve_job_route(uuid,uuid,text,text,uuid,text[])','EXECUTE')
 OR NOT has_function_privilege('service_role','public.sandy_api_resolve_job_route(uuid,uuid,text,text,uuid,text[])','EXECUTE') THEN
  RAISE EXCEPTION 'job_route_acl_invalid'; END IF;
END $$;
DO $$
DECLARE owner_id uuid:=gen_random_uuid(); other_owner uuid:=gen_random_uuid(); viewer_id uuid:=gen_random_uuid();
 plan_id uuid:=gen_random_uuid(); foreign_plan uuid:=gen_random_uuid(); durable_job uuid:=gen_random_uuid(); foreign_job uuid:=gen_random_uuid();
 legacy_job uuid:=gen_random_uuid(); key_id uuid:=gen_random_uuid(); admission uuid:=gen_random_uuid(); source_request uuid:=gen_random_uuid();
 collision_id uuid:=gen_random_uuid(); second_admission uuid:=gen_random_uuid(); second_source uuid:=gen_random_uuid();
 reply jsonb; action text; snapshot uuid;
BEGIN
 INSERT INTO public.sandy_controller_admins(auth_user_id,role,enabled) VALUES(owner_id,'owner',true),(other_owner,'owner',true),(viewer_id,'viewer',true);
 INSERT INTO public.sandy_orch_plans(id,actor_id,admission_kind,idempotency_key,request_sha256,request_document,channel) VALUES
 (plan_id,owner_id,'operation','job-route-'||plan_id::text,repeat('0',64),'[]','api'),
 (foreign_plan,other_owner,'operation','job-route-'||foreign_plan::text,repeat('0',64),'[]','api');
 INSERT INTO public.sandy_orch_jobs(id,plan_id,step_key,actor_id,operation,registry_revision,input_sha256,handler,permission_scope,is_mutation,input_schema,output_schema,arguments,channel) VALUES
 (durable_job,plan_id,'owned',owner_id,'supabase.projects.get',repeat('0',64),repeat('0',64),'sandy-provider-read-api','infrastructure:read',false,'{}','{}','{}','api'),
 (foreign_job,foreign_plan,'foreign',other_owner,'supabase.projects.get',repeat('0',64),repeat('0',64),'sandy-provider-read-api','infrastructure:read',false,'{}','{}','{}','api'),
 (collision_id,plan_id,'collision',owner_id,'supabase.projects.get',repeat('0',64),repeat('0',64),'sandy-provider-read-api','infrastructure:read',false,'{}','{}','{}','api');
 INSERT INTO public.sandy_deployment_jobs(id,requested_by,provider,operation,target,payload,idempotency_key,status) VALUES
 (legacy_job,'sandy_api:'||owner_id::text,'google_cloud','get_vm','route-component-fixture','{}','job-route-'||legacy_job::text,'pending_approval'),
 (collision_id,'sandy_api:'||owner_id::text,'google_cloud','get_vm','route-component-fixture','{}','job-route-'||collision_id::text,'pending_approval');
 UPDATE public.sandy_operation_registry SET api_exposed=true,ai_exposed=true
 WHERE operation IN ('orchestration.jobs.get','orchestration.jobs.events','orchestration.jobs.cancel','orchestration.jobs.retry',
 'deployment.jobs.get','deployment.jobs.events','deployment.jobs.cancel','deployment.jobs.retry','system.lifecycle.compensate');
 FOREACH action IN ARRAY ARRAY['get','events','cancel','retry'] LOOP
  reply:=public.sandy_api_resolve_job_route(owner_id,durable_job,action,'api');
  IF reply->>'ok'<>'true' OR reply->>'operation'<>'orchestration.jobs.'||action OR reply->>'job_kind'<>'durable' THEN RAISE EXCEPTION 'durable_route_incorrect_%',action; END IF;
  reply:=public.sandy_api_resolve_job_route(owner_id,legacy_job,action,'api');
  IF reply->>'ok'<>'true' OR reply->>'operation'<>'deployment.jobs.'||action OR reply->>'job_kind'<>'legacy' THEN RAISE EXCEPTION 'legacy_route_incorrect_%',action; END IF;
 END LOOP;
 reply:=public.sandy_api_resolve_job_route(viewer_id,legacy_job,'get','api');
 IF reply->>'error'<>'job_not_found' OR reply->>'http_status'<>'404' THEN RAISE EXCEPTION 'viewer_job_disclosure'; END IF;
 reply:=public.sandy_api_resolve_job_route(owner_id,foreign_job,'get','api');
 IF reply->>'error'<>'job_not_found' THEN RAISE EXCEPTION 'foreign_durable_job_disclosure'; END IF;
 -- Existing legacy project-owner administration remains available to another
 -- enabled owner, while durable jobs retain their explicit actor ownership.
 reply:=public.sandy_api_resolve_job_route(other_owner,legacy_job,'get','api');
 IF reply->>'ok'<>'true' THEN RAISE EXCEPTION 'legacy_owner_compatibility_changed'; END IF;
 reply:=public.sandy_api_resolve_job_route(owner_id,collision_id,'cancel','api');
 IF reply->>'error'<>'ambiguous_job_id' THEN RAISE EXCEPTION 'ambiguous_job_dispatched'; END IF;
 UPDATE public.sandy_operation_registry SET ai_exposed=false WHERE operation='deployment.jobs.get';
 reply:=public.sandy_api_resolve_job_route(owner_id,legacy_job,'get','mcp');
 IF reply->>'error'<>'job_not_found' THEN RAISE EXCEPTION 'ai_exposure_bypass'; END IF;
 reply:=public.sandy_api_resolve_job_route(owner_id,legacy_job,'get','api');
 IF reply->>'ok'<>'true' THEN RAISE EXCEPTION 'ai_api_flags_conflated'; END IF;
 UPDATE public.sandy_operation_registry SET api_exposed=false WHERE operation='orchestration.jobs.get';
 reply:=public.sandy_api_resolve_job_route(owner_id,durable_job,'get','api');
 IF reply->>'error'<>'job_not_found' THEN RAISE EXCEPTION 'api_exposure_bypass'; END IF;
 UPDATE public.sandy_operation_registry SET api_exposed=true WHERE operation='orchestration.jobs.get';
 INSERT INTO public.sandy_api_credentials(id,principal_id,secret_sha256,allowed_operations,expires_at,requests_per_minute,declared_unit_budget)
 VALUES(key_id,owner_id,encode(sha256(convert_to(gen_random_uuid()::text,'UTF8')),'hex'),ARRAY['deployment.jobs.get'],clock_timestamp()+interval '10 minutes',5,10);
 reply:=public.sandy_api_resolve_job_route(owner_id,legacy_job,'get','api',key_id,ARRAY['deployment.jobs.get']);
 IF reply->>'ok'<>'true' THEN RAISE EXCEPTION 'exact_key_read_refused'; END IF;
 reply:=public.sandy_api_resolve_job_route(owner_id,durable_job,'get','api',key_id,ARRAY['orchestration.jobs.get']);
 IF reply->>'error'<>'job_not_found' THEN RAISE EXCEPTION 'key_scope_from_caller'; END IF;
 reply:=public.sandy_api_resolve_job_route(owner_id,legacy_job,'get','api',key_id,ARRAY['orchestration.jobs.get']);
 IF reply->>'error'<>'job_not_found' THEN RAISE EXCEPTION 'stale_frontend_scope_ignored'; END IF;
 reply:=public.sandy_api_resolve_job_route(owner_id,legacy_job,'cancel','api',key_id,ARRAY['deployment.jobs.cancel']);
 IF reply->>'error'<>'job_not_found' THEN RAISE EXCEPTION 'key_mutation_route_allowed'; END IF;
 UPDATE public.sandy_api_credentials SET revoked_at=clock_timestamp() WHERE id=key_id;
 reply:=public.sandy_api_resolve_job_route(owner_id,legacy_job,'get','api',key_id,ARRAY['deployment.jobs.get']);
 IF reply->>'error'<>'job_not_found' THEN RAISE EXCEPTION 'revoked_key_route_allowed'; END IF;
 reply:=public.sandy_api_resolve_job_route(owner_id,legacy_job,'rollback','api');
 IF reply->>'error'<>'job_rollback_snapshot_required' OR reply->>'http_status'<>'424' THEN RAISE EXCEPTION 'historical_rollback_fabricated'; END IF;
 -- Direct synthetic rows exercise only private FK association. They are not
 -- passed to the compensation executor and cannot attest provider effects.
 INSERT INTO public.sandy_api_execution_admissions(id,actor_id,operation,request_id,is_mutation,input_sha256,contract_sha256,scope_sha256,registry_revision_sha256,declared_cost_units,approval_id,state,expires_at)
 VALUES(admission,owner_id,'gcp.compute.instances.stop',source_request,true,repeat('0',64),repeat('0',64),repeat('0',64),repeat('0',64),0,legacy_job,'accepted',clock_timestamp()+interval '1 minute');
 INSERT INTO public.sandy_lifecycle_snapshots(actor_id,source_admission_id,source_request_id,source_operation,source_arguments,record)
 VALUES(owner_id,admission,source_request,'gcp.compute.instances.stop','{}','{"component_fixture_only":true}') RETURNING id INTO snapshot;
 reply:=public.sandy_api_resolve_job_route(owner_id,legacy_job,'rollback','api');
 IF reply->>'operation'<>'system.lifecycle.compensate' OR (reply->>'source_request_id')::uuid<>source_request THEN RAISE EXCEPTION 'rollback_source_not_server_derived'; END IF;
 reply:=public.sandy_api_resolve_job_route(other_owner,legacy_job,'rollback','api');
 IF reply->>'error'<>'job_rollback_snapshot_required' THEN RAISE EXCEPTION 'foreign_snapshot_disclosure'; END IF;
 -- The durable association uses the attempt's recorded canonical admission,
 -- rather than the caller's source request or a legacy approval/job ID.
 INSERT INTO public.sandy_orch_attempts(job_id,attempt,lease_token,worker_id,execution_admission_id)
 VALUES(durable_job,1,gen_random_uuid(),gen_random_uuid(),admission);
 reply:=public.sandy_api_resolve_job_route(owner_id,durable_job,'rollback','api');
 IF reply->>'operation'<>'system.lifecycle.compensate' OR (reply->>'source_request_id')::uuid<>source_request THEN RAISE EXCEPTION 'durable_rollback_source_not_server_derived'; END IF;
 INSERT INTO public.sandy_api_execution_admissions(id,actor_id,operation,request_id,is_mutation,input_sha256,contract_sha256,scope_sha256,registry_revision_sha256,declared_cost_units,approval_id,state,expires_at)
 VALUES(second_admission,owner_id,'gcp.compute.instances.stop',second_source,true,repeat('0',64),repeat('0',64),repeat('0',64),repeat('0',64),0,collision_id,'accepted',clock_timestamp()+interval '1 minute');
 INSERT INTO public.sandy_lifecycle_snapshots(actor_id,source_admission_id,source_request_id,source_operation,source_arguments,record)
 VALUES(owner_id,second_admission,second_source,'gcp.compute.instances.stop','{}','{"component_fixture_only":true}');
 reply:=public.sandy_api_resolve_job_route(owner_id,legacy_job,'rollback','api');
 IF (reply->>'source_request_id')::uuid<>source_request THEN RAISE EXCEPTION 'unrelated_approval_snapshot_used'; END IF;
 INSERT INTO public.sandy_orch_attempts(job_id,attempt,lease_token,worker_id,execution_admission_id)
 VALUES(durable_job,2,gen_random_uuid(),gen_random_uuid(),second_admission);
 reply:=public.sandy_api_resolve_job_route(owner_id,durable_job,'rollback','api');
 IF reply->>'error'<>'ambiguous_job_rollback_source' OR reply->>'http_status'<>'409' THEN RAISE EXCEPTION 'durable_ambiguous_rollback_source_guessed'; END IF;
 IF (SELECT status FROM public.sandy_deployment_jobs WHERE id=legacy_job)<>'pending_approval'
 OR (SELECT state FROM public.sandy_orch_jobs WHERE id=durable_job)<>'queued'
 OR (SELECT state FROM public.sandy_api_execution_admissions WHERE id=admission)<>'accepted' THEN RAISE EXCEPTION 'router_executed_business_mutation'; END IF;
 UPDATE public.sandy_controller_admins SET enabled=false WHERE auth_user_id=owner_id;
 reply:=public.sandy_api_resolve_job_route(owner_id,durable_job,'get','api');
 IF reply->>'error'<>'job_not_found' THEN RAISE EXCEPTION 'revoked_owner_routed'; END IF;
 -- Actual service-role call after resetting the enabled synthetic membership.
 UPDATE public.sandy_controller_admins SET enabled=true WHERE auth_user_id=owner_id;
 PERFORM set_config('sandy.job_router_fixture_actor',owner_id::text,true);
 PERFORM set_config('sandy.job_router_fixture_job',durable_job::text,true);
END $$;
SET LOCAL ROLE authenticated;
DO $$ BEGIN
 BEGIN PERFORM public.sandy_api_resolve_job_route(gen_random_uuid(),gen_random_uuid(),'get','api');
 RAISE EXCEPTION 'customer_rpc_permission_granted'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;
SET LOCAL ROLE service_role;
DO $$ DECLARE result jsonb; BEGIN
 result:=public.sandy_api_resolve_job_route(current_setting('sandy.job_router_fixture_actor')::uuid,current_setting('sandy.job_router_fixture_job')::uuid,'get','api');
 IF result->>'ok'<>'true' THEN RAISE EXCEPTION 'service_rpc_not_executable'; END IF;
END $$;
RESET ROLE;
SELECT jsonb_build_object('passed',true,'layer','administrative_database_job_routing_component',
 'checks',jsonb_build_array('service_only_acl','fixed_canonical_selection','durable_actor_ownership','legacy_owner_compatibility',
 'foreign_job_404','ambiguous_id_refusal','independent_api_ai_flags','current_key_scope','key_scope_intersection','key_write_refusal',
 'key_revocation','historical_rollback_dependency','private_snapshot_association','durable_attempt_snapshot_association','ambiguous_rollback_refusal',
 'snapshot_owner_scope','no_execution_in_resolver','owner_revocation','actual_service_role_rpc'),
 'fixtures','rolled_back','auth_session_tested',false,'provider_called',false,'compensation_executed',false,'valid_provider_preimage_certified',false) AS evidence;
ROLLBACK;
