-- PostgreSQL component fixture only. No HTTP Auth session or provider calls.
BEGIN;
SET LOCAL statement_timeout='45s';SET LOCAL lock_timeout='3s';
DO $trigger_guard$
BEGIN
 IF EXISTS(
  SELECT 1 FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid
  JOIN pg_namespace n ON n.oid=c.relnamespace JOIN pg_proc p ON p.oid=t.tgfoid
  WHERE NOT t.tgisinternal AND (
   n.nspname='auth' AND c.relname='users' OR n.nspname='public' AND c.relname IN
   ('email_customers','sandy_agenda_access','sandy_tasks','sandy_calendar_events',
    'sandy_universal_files','sandy_agenda_companies','sandy_agenda_categories',
    'sandy_memory_portal_accounts','email_customer_addresses','sandy_memory_settings',
    'sandy_temporal_facts','sandy_temporal_triggers','sandy_task_events'))
  AND NOT EXISTS(SELECT 1 FROM (VALUES
   ('net','http_post','05103078b4b36c776bc0925f4fecf8e2'),
   ('public','sandy_agenda_category_prevent_cycle','e7c1ae21e27ff5ee1f38c8a5f12e48e0'),
   ('public','sandy_agenda_task_company_guard','a12c1f18921df22ff346f83aaffe52ba'),
   ('public','sandy_calendar_enqueue_event','549bb2516d861abf39232bce49a02dbe'),
   ('public','sandy_calendar_plan_task_dates','8794732d85f6f73aadbf423c50499faf'),
   ('public','sandy_calendar_propose_due_changes','a0def30314192eb96338ab5ed179ff31'),
   ('public','sandy_calendar_replan_on_event_change','ecaa8aae639fb4387c1e08baeea1231b'),
   ('public','sandy_company_prevent_duplicate','ecf56d01c77909395e64034094549d7d'),
   ('public','sandy_company_prevent_duplicate','8b73dcba4cb3c07b9a37c16e79cb9a9d'),
   ('public','sandy_default_task_responsibility','f9c5d6e2476bfa9081211af7290e8160'),
   ('public','sandy_initialise_member_memory','40515b54d1cccfd1d671f6d33cb4c754'),
   ('public','sandy_life_settings_seed_trigger','1b207174e593ce00beb2a36253e6da7b'),
   ('public','sandy_life_task_default_context','7cb49cc3a348a3a5e7f5d390b7a3f562'),
   ('public','sandy_mission_enqueue_new','889bbb237231b30bc98b77bafd0f812d'),
   ('public','sandy_mission_guard_review_status','a29ef62cc45007549b97c3295623efc3'),
   ('public','sandy_queue_new_customer_drive','7b200107d31e8915d7a756383d86614a'),
   ('public','sandy_task_enqueue_analysis','b897552ed35245daab4f23d08c882960'),
   ('public','sandy_task_event_audit','52e91a2f057d05c9ee47db9d55c37454'),
   ('public','sandy_task_stamp_and_validate','dfdc9cb6623e492c7fd9de5e9e87aa21'),
   ('public','sandy_temporal_dependency_unblocked','46d7e4ce4aac885292e18efcd5e989a6'),
   ('public','sandy_temporal_task_change','4f497435196c2e2b5fc09f41f516423a')
  ) safe(schema_name,function_name,source_md5)
  WHERE safe.schema_name=(SELECT nspname FROM pg_namespace WHERE oid=p.pronamespace)
   AND safe.function_name=p.proname AND safe.source_md5=md5(pg_get_functiondef(p.oid)))
 ) THEN RAISE EXCEPTION 'Fixture trigger drift: inspect deployed trigger source before running'; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='net' AND p.proname='http_post' AND md5(pg_get_functiondef(p.oid))='05103078b4b36c776bc0925f4fecf8e2') THEN
  RAISE EXCEPTION 'PG-net asynchronous queue implementation changed: no task-create fixture permitted';
 END IF;
END $trigger_guard$;
DO $approval_trigger_guard$ BEGIN IF EXISTS(SELECT 1 FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_proc p ON p.oid=t.tgfoid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE NOT t.tgisinternal AND n.nspname='public' AND c.relname IN('sandy_controller_admins','sandy_engineering_changes','sandy_deployment_jobs') AND NOT EXISTS(SELECT 1 FROM(VALUES ('sandy_api_capture_mutation_approval','b95469e8fc5337dd01a18fc64e633a28'),('sandy_api_capture_read_job_approval','05809076f961fa8fef71be6da2ee2eeb'),('sandy_api_read_retry_job_scope','8eb63ada7681b1ff7306e45589502240'),('sandy_api_update_read_retry_target_pin','79c54b42562a576636b23274df5a4236'),('sandy_orch_legacy_job_pin','b3012701c2fe98755641e9f9dfe9acc8'),('sandy_orch_legacy_request_scope','051e4ed896cde2c520ba32d0e9cecc78'),('sandy_require_engineering_change_write','ebac0f91a816e77f351911eb8ba5ea24'))safe(name,source_md5) WHERE safe.name=t.tgname AND safe.source_md5=md5(pg_get_functiondef(p.oid)))) THEN RAISE EXCEPTION 'approval_fixture_trigger_drift';END IF;END $approval_trigger_guard$;

CREATE TEMP TABLE metadata_checks(label text PRIMARY KEY,payload jsonb) ON COMMIT DROP;
GRANT SELECT,INSERT ON pg_temp.metadata_checks TO service_role;
CREATE FUNCTION pg_temp.metadata_check(label text,condition boolean,payload jsonb DEFAULT '{}') RETURNS void LANGUAGE plpgsql AS $$BEGIN IF condition IS DISTINCT FROM true THEN RAISE EXCEPTION 'Metadata assertion %: %',label,payload;END IF;INSERT INTO pg_temp.metadata_checks VALUES(label,payload);END $$;
GRANT EXECUTE ON FUNCTION pg_temp.metadata_check(text,boolean,jsonb) TO service_role;
DO $metadata_fixture$
DECLARE owner uuid:=gen_random_uuid();other uuid:=gen_random_uuid();actor uuid:=gen_random_uuid();customer uuid:=gen_random_uuid();foreign_customer uuid:=gen_random_uuid();
BEGIN
 IF EXISTS(SELECT 1 FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid WHERE NOT t.tgisinternal AND c.relnamespace='public'::regnamespace AND c.relname IN('sandy_composio_connections','sandy_capability_runtime_state')) THEN RAISE EXCEPTION 'metadata_fixture_trigger_drift';END IF;
 PERFORM set_config('metadata.test.owner',owner::text,true);PERFORM set_config('metadata.test.other',other::text,true);PERFORM set_config('metadata.test.actor',actor::text,true);PERFORM set_config('metadata.test.customer',customer::text,true);PERFORM set_config('metadata.test.foreign',foreign_customer::text,true);
 INSERT INTO auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data) VALUES(owner,'authenticated','authenticated','sandy-metadata-rollback-'||owner::text||'@example.invalid',now(),'{"provider":"email"}','{"sandy_system_metadata_rollback_fixture":true}'),(other,'authenticated','authenticated','sandy-metadata-rollback-'||other::text||'@example.invalid',now(),'{"provider":"email"}','{"sandy_system_metadata_rollback_fixture":true}'),(actor,'authenticated','authenticated','sandy-metadata-rollback-'||actor::text||'@example.invalid',now(),'{"provider":"email"}','{"sandy_system_metadata_rollback_fixture":true}');
 INSERT INTO public.email_customers(id,display_name,google_drive_folder_status) VALUES(customer,'Metadata rollback fixture','excluded'),(foreign_customer,'Metadata foreign rollback fixture','excluded');
 UPDATE public.sandy_memory_settings SET enabled=false,learning_enabled=false,proactive_enabled=false WHERE customer_id IN(customer,foreign_customer);
 INSERT INTO public.sandy_controller_admins(auth_user_id,role,enabled) VALUES(owner,'owner',true),(other,'owner',true);
 INSERT INTO public.sandy_composio_connections(customer_id,connected_account_id,toolkit_slug,status) VALUES(customer,'rollback-only-a-'||owner::text,'fixture_provider','ACTIVE'),(customer,'rollback-only-b-'||owner::text,'fixture_provider','INACTIVE'),(foreign_customer,'rollback-only-c-'||owner::text,'foreign_fixture_provider','ACTIVE');
 UPDATE public.sandy_operation_registry SET api_exposed=true,ai_exposed=true,verified=true WHERE handler='sandy-system-metadata-api';
 PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',owner,'role','service_role')::text,true);
END $metadata_fixture$;
CREATE FUNCTION pg_temp.metadata_scope(op text,args jsonb) RETURNS jsonb LANGUAGE sql AS $$SELECT jsonb_build_object('sandy_project_ref','zmqlyygzqoidkcwdysok','permission_scope','system:read','service','system_metadata_v1')||CASE WHEN op='system.connections' THEN jsonb_build_object('customer_id',(args->>'customer_id')::uuid::text) ELSE '{}'::jsonb END$$;
CREATE FUNCTION pg_temp.metadata_approval(op text,args jsonb,scope jsonb) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE actor uuid:=auth.uid();change_id uuid;job uuid;contract jsonb;manifest jsonb;
BEGIN
 IF actor NOT IN(current_setting('metadata.test.owner')::uuid,current_setting('metadata.test.other')::uuid) THEN RAISE EXCEPTION 'fixture_owner_only';END IF;
 SELECT c.contract INTO contract FROM public.sandy_system_metadata_contracts c WHERE c.operation=op;
 INSERT INTO public.sandy_engineering_changes(title,problem,expected_behavior,requested_by,status,change_purpose,feature_improvement) VALUES('Rollback metadata component fixture','Validate isolated owner read proof','Read metadata only inside full rollback',actor,'approved','Rollback-only component fixture approval','Validate scoped metadata reads') RETURNING id INTO change_id;
 manifest:=jsonb_build_object('operation',op,'input_sha256',encode(extensions.digest(args::text,'sha256'),'hex'),'contract_sha256',contract->>'contract_sha256','scope_sha256',encode(extensions.digest(scope::text,'sha256'),'hex'),'maximum_declared_cost_units',0);
 INSERT INTO public.sandy_deployment_jobs(requested_by,provider,operation,target,payload,idempotency_key,status,approved_by,approved_at,engineering_change_id) VALUES(actor::text,'supabase','write','rollback-metadata-only',jsonb_build_object('sandy_api_execution',manifest),gen_random_uuid()::text,'approved',actor::text,clock_timestamp(),change_id) RETURNING id INTO job;RETURN job;
END $$;
CREATE FUNCTION pg_temp.metadata_admit(op text,args jsonb DEFAULT '{}',request_id uuid DEFAULT gen_random_uuid()) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE config jsonb;approval uuid;scope jsonb:=pg_temp.metadata_scope(op,args);
BEGIN
 SELECT c.contract INTO config FROM public.sandy_system_metadata_contracts c WHERE c.operation=op;
 IF config->>'requires_approval'='true' THEN approval:=pg_temp.metadata_approval(op,args,scope);END IF;
 RETURN public.sandy_api_admit_execution(auth.uid(),NULL,op,encode(extensions.digest(args::text,'sha256'),'hex'),request_id,NULL,config->>'contract_sha256',encode(extensions.digest(scope::text,'sha256'),'hex'),0,approval)||jsonb_build_object('request_id',request_id);
END $$;
CREATE FUNCTION pg_temp.metadata_invoke(op text,args jsonb DEFAULT '{}') RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE admission jsonb:=pg_temp.metadata_admit(op,args);
BEGIN
 IF admission->>'allowed' IS DISTINCT FROM 'true' THEN RETURN admission;END IF;
 RETURN public.sandy_system_metadata_execute(op,args,args::text,pg_temp.metadata_scope(op,args)::text,auth.uid(),(admission->>'request_id')::uuid,(admission->>'admission_id')::uuid,(admission->>'grant_id')::uuid,'api');
END $$;
GRANT EXECUTE ON FUNCTION pg_temp.metadata_scope(text,jsonb),pg_temp.metadata_admit(text,jsonb,uuid),pg_temp.metadata_invoke(text,jsonb) TO service_role;
SET LOCAL ROLE service_role;
DO $metadata_reads$
DECLARE r jsonb;again jsonb;first_op text;first_feature text;args jsonb;admission jsonb;rid uuid;
BEGIN
 r:=pg_temp.metadata_invoke('system.catalog',jsonb_build_object('limit',1));first_op:=r->'result'->'items'->0->>'operation';PERFORM pg_temp.metadata_check('catalog.bounded_safe_projection',r->>'ok'='true' AND jsonb_array_length(r->'result'->'items')=1 AND r->'result'->>'possibly_truncated'='true' AND NOT r->'result'->'items'->0 ? 'input_schema' AND NOT r->'result'->'items'->0 ? 'dependencies',r);rid:=(r->>'request_id')::uuid;PERFORM set_config('metadata.test.prior_request',rid::text,true);
 r:=pg_temp.metadata_invoke('system.catalog',jsonb_build_object('limit',1,'after_operation',r->'result'->>'next_cursor'));PERFORM pg_temp.metadata_check('catalog.keyset_continues',r->'result'->'items'->0->>'operation'>first_op,r);
 r:=pg_temp.metadata_invoke('system.catalog',jsonb_build_object('search','cloud.vm.exec'));PERFORM pg_temp.metadata_check('catalog.includes_disabled_registration',jsonb_array_length(r->'result'->'items')=1 AND r->'result'->'items'->0->>'handler'='unassigned' AND r->'result'->'items'->0->>'api_exposed'='false',r);
 r:=pg_temp.metadata_invoke('system.operation_catalog',jsonb_build_object('search','cloud.vm.exec'));PERFORM pg_temp.metadata_check('operation_catalog.exposed_only_distinction',r->'result'->'items'='[]',r);
 r:=pg_temp.metadata_invoke('system.operation_catalog',jsonb_build_object('limit',10,'domain','system','is_mutation',false,'verified',true));PERFORM pg_temp.metadata_check('operation_catalog.meaningful_filters',jsonb_array_length(r->'result'->'items')>0 AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(r->'result'->'items')i WHERE i->>'domain'<>'system' OR i->>'api_exposed'<>'true' OR i->>'is_mutation'<>'false' OR i->>'verified'<>'true'),r);
 r:=pg_temp.metadata_invoke('system.coverage',jsonb_build_object('domain','system','limit',1));PERFORM pg_temp.metadata_check('coverage.flag_counts_not_original161_completion',(r->'result'->'item'->>'registered')::integer>0 AND r->'result'->'item'->>'original_161_completion_not_established'='true' AND r->'result'->'item'->>'count_scope'='filtered_registry',r);
 r:=pg_temp.metadata_invoke('system.capabilities',jsonb_build_object('limit',1));first_feature:=r->'result'->'items'->0->>'feature_key';PERFORM pg_temp.metadata_check('capabilities.actual_recorded_safe_projection',jsonb_array_length(r->'result'->'items')=1 AND NOT r->'result'->'items'->0 ? 'scope_key' AND NOT r->'result'->'items'->0 ? 'evidence_event_id' AND r->'result'->'items'->0->>'provider_verified'='false',r);
 args:=jsonb_build_object('limit',1,'cursor',r->'result'->'next_cursor');again:=pg_temp.metadata_invoke('system.capabilities',args);PERFORM pg_temp.metadata_check('capabilities.keyset_continues',again->>'ok'='true' AND again->'result'->'items'<>r->'result'->'items',again);
 r:=pg_temp.metadata_invoke('system.runtime',jsonb_build_object('limit',1));PERFORM pg_temp.metadata_check('runtime.recorded_not_attested',jsonb_array_length(r->'result'->'items')=1 AND r->'result'->>'provider_verified'='false' AND r->'result'->>'executability_not_implied'='true',r);
 again:=pg_temp.metadata_invoke('system.runtime',jsonb_build_object('limit',1,'cursor',r->'result'->'next_cursor'));PERFORM pg_temp.metadata_check('runtime.checked_time_keyset_continues',again->>'ok'='true' AND again->'result'->'items'<>r->'result'->'items',again);
 r:=pg_temp.metadata_invoke('system.connections',jsonb_build_object('customer_id',current_setting('metadata.test.customer'),'limit',1));PERFORM pg_temp.metadata_check('connections.exact_customer_approved_projection',jsonb_array_length(r->'result'->'items')=1 AND r->'result'->>'possibly_truncated'='true' AND r->'result'->'items'->0->>'provider'='fixture_provider' AND NOT r->'result'->'items'->0 ? 'connected_account_id' AND NOT r->'result'->'items'->0 ? 'customer_id',r);
 again:=pg_temp.metadata_invoke('system.connections',jsonb_build_object('customer_id',current_setting('metadata.test.customer'),'limit',1,'after_fingerprint',r->'result'->>'next_cursor'));PERFORM pg_temp.metadata_check('connections.fingerprint_cursor_continues',jsonb_array_length(again->'result'->'items')=1 AND again->'result'->'items'<>r->'result'->'items',again);
 r:=pg_temp.metadata_invoke('system.connections',jsonb_build_object('customer_id',current_setting('metadata.test.customer'),'status','ACTIVE','provider','fixture_provider'));PERFORM pg_temp.metadata_check('connections.filters_exclude_other_tenant',jsonb_array_length(r->'result'->'items')=1 AND r->'result'->'items'->0->>'recorded_status'='ACTIVE',r);
 r:=pg_temp.metadata_invoke('system.operation_status',jsonb_build_object('request_id',rid));PERFORM pg_temp.metadata_check('operation_status.actual_owned_receipt_no_redispatch',r->'result'->'item'->>'request_id'=rid::text AND r->'result'->'item'->>'request_state'='succeeded' AND r->'result'->'item'->>'redispatch_permitted'='false',r);
 admission:=pg_temp.metadata_admit('system.catalog');r:=public.sandy_system_metadata_execute('system.catalog','{}','{}',pg_temp.metadata_scope('system.catalog','{}')::text,auth.uid(),(admission->>'request_id')::uuid,(admission->>'admission_id')::uuid,gen_random_uuid());PERFORM pg_temp.metadata_check('grant.wrong_proof_denied',r->>'http_status'='403',r);
 r:=public.sandy_system_metadata_execute('system.catalog','{}','{}',pg_temp.metadata_scope('system.catalog','{}')::text,auth.uid(),(admission->>'request_id')::uuid,(admission->>'admission_id')::uuid,(admission->>'grant_id')::uuid);PERFORM pg_temp.metadata_check('grant.once_consumed_finished',r->>'ok'='true',r);
 r:=public.sandy_system_metadata_execute('system.catalog','{}','{}',pg_temp.metadata_scope('system.catalog','{}')::text,auth.uid(),(admission->>'request_id')::uuid,(admission->>'admission_id')::uuid,(admission->>'grant_id')::uuid);PERFORM pg_temp.metadata_check('grant.replay_never_reexecutes',r->>'http_status'='403',r);
END $metadata_reads$;
RESET ROLE;
DO $metadata_boundaries$
DECLARE r jsonb;admission jsonb;args jsonb;scope jsonb;
BEGIN
 admission:=pg_temp.metadata_admit('system.catalog');UPDATE public.sandy_operation_registry SET ai_exposed=false WHERE operation='system.catalog';r:=public.sandy_system_metadata_execute('system.catalog','{}','{}',pg_temp.metadata_scope('system.catalog','{}')::text,auth.uid(),(admission->>'request_id')::uuid,(admission->>'admission_id')::uuid,(admission->>'grant_id')::uuid,'mcp');PERFORM pg_temp.metadata_check('grant.current_mcp_exposure_rechecked',r->>'http_status'='409',r);UPDATE public.sandy_operation_registry SET ai_exposed=true WHERE operation='system.catalog';
 admission:=pg_temp.metadata_admit('system.catalog');r:=public.sandy_system_metadata_execute('system.catalog','{}','{}','{"sandy_project_ref":"wrong-project"}',auth.uid(),(admission->>'request_id')::uuid,(admission->>'admission_id')::uuid,(admission->>'grant_id')::uuid);PERFORM pg_temp.metadata_check('scope.fixed_project_required',r->>'http_status'='403',r);
 args:=jsonb_build_object('customer_id',current_setting('metadata.test.customer'));admission:=pg_temp.metadata_admit('system.connections',args);args:=jsonb_set(args,'{customer_id}',to_jsonb(current_setting('metadata.test.foreign')));r:=public.sandy_system_metadata_execute('system.connections',args,args::text,pg_temp.metadata_scope('system.connections',args)::text,auth.uid(),(admission->>'request_id')::uuid,(admission->>'admission_id')::uuid,(admission->>'grant_id')::uuid);PERFORM pg_temp.metadata_check('scope.customer_target_cannot_be_replaced',r->>'http_status'='403',r);
 admission:=pg_temp.metadata_admit('system.catalog');UPDATE public.sandy_operation_registry SET error_contract=jsonb_set(error_contract,'{api_key_delegable}','true') WHERE operation='system.catalog';r:=public.sandy_system_metadata_execute('system.catalog','{}','{}',pg_temp.metadata_scope('system.catalog','{}')::text,auth.uid(),(admission->>'request_id')::uuid,(admission->>'admission_id')::uuid,(admission->>'grant_id')::uuid);PERFORM pg_temp.metadata_check('contract.non_delegable_flag_immutable',r->>'http_status'='409',r);UPDATE public.sandy_operation_registry SET error_contract=jsonb_set(error_contract,'{api_key_delegable}','false') WHERE operation='system.catalog';
 admission:=pg_temp.metadata_admit('system.catalog');UPDATE auth.users SET email_confirmed_at=NULL WHERE id=current_setting('metadata.test.owner')::uuid;r:=public.sandy_system_metadata_execute('system.catalog','{}','{}',pg_temp.metadata_scope('system.catalog','{}')::text,auth.uid(),(admission->>'request_id')::uuid,(admission->>'admission_id')::uuid,(admission->>'grant_id')::uuid);PERFORM pg_temp.metadata_check('identity.actual_owner_confirmation_rechecked',r->>'http_status'='403',r);UPDATE auth.users SET email_confirmed_at=clock_timestamp() WHERE id=current_setting('metadata.test.owner')::uuid;
 admission:=pg_temp.metadata_admit('system.catalog');UPDATE public.sandy_controller_admins SET enabled=false WHERE auth_user_id=current_setting('metadata.test.owner')::uuid;r:=public.sandy_system_metadata_execute('system.catalog','{}','{}',pg_temp.metadata_scope('system.catalog','{}')::text,auth.uid(),(admission->>'request_id')::uuid,(admission->>'admission_id')::uuid,(admission->>'grant_id')::uuid);PERFORM pg_temp.metadata_check('identity.actual_owner_revocation_rechecked',r->>'http_status'='403',r);UPDATE public.sandy_controller_admins SET enabled=true WHERE auth_user_id=current_setting('metadata.test.owner')::uuid;
 PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('metadata.test.other'),'role','service_role')::text,true);r:=pg_temp.metadata_invoke('system.operation_status',jsonb_build_object('request_id',current_setting('metadata.test.prior_request')));PERFORM pg_temp.metadata_check('receipt.foreign_owner_receipt_hidden',r->>'http_status'='404',r);
 PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('metadata.test.actor'),'role','service_role')::text,true);r:=pg_temp.metadata_invoke('system.catalog');PERFORM pg_temp.metadata_check('identity.nonowner_not_admitted',r->>'http_status'='403',r);
 PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('metadata.test.owner'),'role','authenticated')::text,true);r:=public.sandy_system_metadata_execute('system.catalog','{}','{}','{}',auth.uid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid());PERFORM pg_temp.metadata_check('transport.user_cannot_call_service_rpc',r->>'http_status'='403',r);
 PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('metadata.test.owner'),'role','service_role')::text,true);
 PERFORM pg_temp.metadata_check('acl.private_source_tables_and_helper',NOT has_table_privilege('service_role','public.sandy_system_metadata_contracts','SELECT') AND NOT has_function_privilege('authenticated','public.sandy_system_metadata_execute(text,jsonb,text,text,uuid,uuid,uuid,uuid,text)','EXECUTE') AND NOT has_function_privilege('service_role','public.sandy_system_metadata_registry_rows(jsonb,boolean)','EXECUTE'));
 PERFORM pg_temp.metadata_check('source.cloud_vm_exec_still_missing',(SELECT handler='unassigned' AND NOT api_exposed AND NOT verified FROM public.sandy_operation_registry WHERE operation='cloud.vm.exec'));
 PERFORM pg_temp.metadata_check('contracts.exactly7_no_duplicate_execution',(SELECT count(*) FROM public.sandy_system_metadata_contracts)=7 AND NOT EXISTS(SELECT 1 FROM public.sandy_system_metadata_contracts c JOIN public.sandy_operation_registry r USING(operation) WHERE c.contract->'input_schema' IS DISTINCT FROM r.input_schema OR c.contract->'output_schema' IS DISTINCT FROM r.output_schema OR c.contract->>'contract_sha256' IS DISTINCT FROM r.error_contract->>'contract_sha256'));
 r:=public.sandy_api_verify_audit(current_setting('metadata.test.owner')::uuid,0,NULL,5000);PERFORM pg_temp.metadata_check('audit.valid_hash_links_sequence_gaps_allowed',r->>'valid'='true',r);
END $metadata_boundaries$;
SELECT jsonb_build_object('checks',(SELECT count(*) FROM pg_temp.metadata_checks),'contracts',(SELECT count(*) FROM public.sandy_system_metadata_contracts),'labels',(SELECT jsonb_agg(label ORDER BY label) FROM pg_temp.metadata_checks),'outputs',(SELECT jsonb_agg(payload ORDER BY label) FROM pg_temp.metadata_checks WHERE payload->>'ok'='true' AND payload ? 'operation'),'http_auth_session',false,'external_provider_calls',false) AS evidence;
ROLLBACK;
