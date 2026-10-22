-- Legacy provider component fixture only. No HTTP Auth session/provider calls/credential material.
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

CREATE TEMP TABLE legacy_provider_checks(label text PRIMARY KEY) ON COMMIT DROP;
CREATE FUNCTION pg_temp.legacy_check(label text,condition boolean) RETURNS void LANGUAGE plpgsql AS $$BEGIN IF condition IS DISTINCT FROM true THEN RAISE EXCEPTION 'Legacy provider check failed: %',label;END IF;INSERT INTO pg_temp.legacy_provider_checks VALUES(label);END $$;
CREATE FUNCTION pg_temp.legacy_admit(op text,args jsonb,canonical_arguments text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE actor uuid:=current_setting('legacy.test.owner')::uuid; config public.sandy_legacy_provider_contracts;change_id uuid;approval uuid;manifest jsonb;rid uuid:=gen_random_uuid();admission jsonb;
BEGIN
 PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',actor,'role','authenticated')::text,true);
 SELECT * INTO config FROM public.sandy_legacy_provider_contracts WHERE operation=op;
 INSERT INTO public.sandy_engineering_changes(title,problem,expected_behavior,requested_by,status,change_purpose,feature_improvement) VALUES('Legacy rollback fixture','Verify exact compatibility proof','No provider call',actor,'approved','Rollback component only','Validate one-use original alias') RETURNING id INTO change_id;
 manifest:=jsonb_build_object('operation',op,'input_sha256',encode(extensions.digest(canonical_arguments,'sha256'),'hex'),'contract_sha256',config.contract_sha256,'scope_sha256',encode(extensions.digest(config.canonical_scope,'sha256'),'hex'),'maximum_declared_cost_units',0);
 INSERT INTO public.sandy_deployment_jobs(requested_by,provider,operation,target,payload,idempotency_key,status,approved_by,approved_at,engineering_change_id) VALUES(actor::text,CASE WHEN op LIKE 'github.%' THEN 'github' ELSE 'supabase' END,'write','legacy-full-rollback-only',jsonb_build_object('sandy_api_execution',manifest),gen_random_uuid()::text,'approved',actor::text,clock_timestamp(),change_id) RETURNING id INTO approval;
 admission:=public.sandy_api_admit_execution(actor,NULL,op,encode(extensions.digest(canonical_arguments,'sha256'),'hex'),rid,NULL,config.contract_sha256,encode(extensions.digest(config.canonical_scope,'sha256'),'hex'),0,approval);
 IF admission->>'allowed' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'Fixture admit refused: %',admission;END IF;
 PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',actor,'role','service_role')::text,true);
 RETURN jsonb_build_object('operation',op,'arguments',args,'canonical_arguments',canonical_arguments,'actor_id',actor,'tenant_id',NULL,'credential_id',NULL,'request_id',rid,'grant_id',admission->>'grant_id','admission_id',admission->>'admission_id');
END $$;
CREATE TEMP TABLE legacy_inputs(operation text,arguments jsonb,canonical_arguments text) ON COMMIT DROP;
INSERT INTO pg_temp.legacy_inputs VALUES('github.read','{"path":{"path":"docs/sandy-api/compensation-fixtures/legacy.txt"},"query":{"ref":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}}'::jsonb,'{"path":{"path":"docs/sandy-api/compensation-fixtures/legacy.txt"},"query":{"ref":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}}');
INSERT INTO pg_temp.legacy_inputs VALUES('github.update_file','{"body":{"branch":"fixture","content":"YWJj","message":"Scoped legacy update","sha":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"},"path":{"path":"docs/sandy-api/compensation-fixtures/legacy.txt"}}'::jsonb,'{"body":{"branch":"fixture","content":"YWJj","message":"Scoped legacy update","sha":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"},"path":{"path":"docs/sandy-api/compensation-fixtures/legacy.txt"}}');
INSERT INTO pg_temp.legacy_inputs VALUES('github.commit','{"body":{"message":"Detached immutable commit","parents":["aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"],"tree":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}}'::jsonb,'{"body":{"message":"Detached immutable commit","parents":["aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"],"tree":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}}');
INSERT INTO pg_temp.legacy_inputs VALUES('github.merge','{"body":{"merge_method":"merge","sha":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"},"path":{"pull_number":123}}'::jsonb,'{"body":{"merge_method":"merge","sha":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"},"path":{"pull_number":123}}');
INSERT INTO pg_temp.legacy_inputs VALUES('supabase.apply_migration','{"body":{"name":"legacy_fixture","query":"SELECT 1;"},"migration_ref":"17db4fd369edb9244b9f91d9aeed145c3d04ad8ba6e95d06247f07a63527d11a","project_id":"zmqlyygzqoidkcwdysok"}'::jsonb,'{"body":{"name":"legacy_fixture","query":"SELECT 1;"},"migration_ref":"17db4fd369edb9244b9f91d9aeed145c3d04ad8ba6e95d06247f07a63527d11a","project_id":"zmqlyygzqoidkcwdysok"}');
INSERT INTO pg_temp.legacy_inputs VALUES('github.push_files','{"branch":"compat-fixture","expected_head_oid":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","files":[{"content_base64":"YWxwaGE=","path":"docs/sandy-api/compensation-fixtures/batch-a.txt","sha256":"8ed3f6ad685b959ead7022518e1af76cd816f8e8ec7ccdda1ed4018e8f2223f8"},{"content_base64":"YmV0YQ==","path":"docs/sandy-api/compensation-fixtures/batch-b.txt","sha256":"f44e64e75f3948e9f73f8dfa94721c4ce8cbb4f265c4790c702b2d41cfbf2753"}],"files_sha256":"24620490037f547f36e7f307be0a18315a8559e69b7966a3d809511cd9964942","headline":"Scoped two-file commit","repository":"ausstyle/web-staging"}'::jsonb,'{"branch":"compat-fixture","expected_head_oid":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","files":[{"content_base64":"YWxwaGE=","path":"docs/sandy-api/compensation-fixtures/batch-a.txt","sha256":"8ed3f6ad685b959ead7022518e1af76cd816f8e8ec7ccdda1ed4018e8f2223f8"},{"content_base64":"YmV0YQ==","path":"docs/sandy-api/compensation-fixtures/batch-b.txt","sha256":"f44e64e75f3948e9f73f8dfa94721c4ce8cbb4f265c4790c702b2d41cfbf2753"}],"files_sha256":"24620490037f547f36e7f307be0a18315a8559e69b7966a3d809511cd9964942","headline":"Scoped two-file commit","repository":"ausstyle/web-staging"}');
INSERT INTO pg_temp.legacy_inputs VALUES('supabase.deploy_edge_function','{"artifact_ref":"c198b5dfbc4b4bc0fb736b732187d759e8bd336486a6a08a00f2a4da56520093","entrypoint_path":"index.ts","files":[{"content_base64":"RGVuby5zZXJ2ZSgoKT0+UmVzcG9uc2UuanNvbih7Zml4dHVyZTp0cnVlfSkpOw==","path":"index.ts","sha256":"d2cecfdca4bed0f086fdb1a1934fa36c1d158d9134ea8153ec92aec7b2b9f5be"}],"name":"compat-fixture","project_id":"zmqlyygzqoidkcwdysok","slug":"compat-fixture","verify_jwt":true}'::jsonb,'{"artifact_ref":"c198b5dfbc4b4bc0fb736b732187d759e8bd336486a6a08a00f2a4da56520093","entrypoint_path":"index.ts","files":[{"content_base64":"RGVuby5zZXJ2ZSgoKT0+UmVzcG9uc2UuanNvbih7Zml4dHVyZTp0cnVlfSkpOw==","path":"index.ts","sha256":"d2cecfdca4bed0f086fdb1a1934fa36c1d158d9134ea8153ec92aec7b2b9f5be"}],"name":"compat-fixture","project_id":"zmqlyygzqoidkcwdysok","slug":"compat-fixture","verify_jwt":true}');
DO $fixture$
DECLARE actor uuid:=gen_random_uuid();c jsonb;op text;args jsonb;canonical text;config public.sandy_legacy_provider_contracts;proof jsonb;bad jsonb;old_contract jsonb;denied boolean;expected_consumer text;
BEGIN
 PERFORM set_config('legacy.test.owner',actor::text,true);
 INSERT INTO auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data) VALUES(actor,'authenticated','authenticated','sandy-legacy-provider-rollback-'||actor::text||'@example.invalid',now(),'{"provider":"email"}','{"sandy_legacy_provider_fixture":true}');
 INSERT INTO public.sandy_controller_admins(auth_user_id,role,enabled) VALUES(actor,'owner',true);
 PERFORM pg_temp.legacy_check('seven_closed_contracts',(SELECT count(*)=7 FROM public.sandy_operation_registry WHERE handler='sandy-legacy-compatibility-api' AND NOT api_exposed AND NOT ai_exposed AND NOT ui_exposed AND NOT verified));
 PERFORM pg_temp.legacy_check('private_contract_acl',NOT has_table_privilege('service_role','public.sandy_legacy_provider_contracts','SELECT') AND NOT has_table_privilege('authenticated','public.sandy_legacy_provider_contracts','SELECT'));
 PERFORM pg_temp.legacy_check('private_context_acl',NOT has_function_privilege('authenticated','public.sandy_legacy_provider_context(jsonb,text)','EXECUTE') AND NOT has_function_privilege('anon','public.sandy_legacy_provider_context(jsonb,text)','EXECUTE'));
 -- Fail before any resolver call if production has an active consumer binding;
 -- fixture verification never reads actual credential material or changes bindings.
 IF EXISTS(SELECT 1 FROM public.sandy_credential_consumer_bindings WHERE consumer IN('github_api','supabase_management')) THEN RAISE EXCEPTION 'Fixture requires absent active consumer bindings; no production credential read permitted';END IF;
 UPDATE public.sandy_operation_registry SET api_exposed=true,ai_exposed=true,verified=true WHERE handler='sandy-legacy-compatibility-api';
 FOR op,args,canonical IN SELECT operation,arguments,canonical_arguments FROM pg_temp.legacy_inputs LOOP
  SELECT * INTO config FROM public.sandy_legacy_provider_contracts WHERE operation=op;
  c:=pg_temp.legacy_admit(op,args,canonical);
  PERFORM pg_temp.legacy_check(op||'_admitted',public.sandy_legacy_provider_context(c)->>'allowed'='true');
  PERFORM pg_temp.legacy_check(op||'_foreign_actor',public.sandy_legacy_provider_context(c||jsonb_build_object('actor_id',gen_random_uuid()))->>'allowed'='false');
  PERFORM pg_temp.legacy_check(op||'_canonical_operation_not_alias',public.sandy_legacy_provider_context(c||jsonb_build_object('operation','github.repos.get'))->>'allowed'='false');
  PERFORM pg_temp.legacy_check(op||'_input_drift',public.sandy_legacy_provider_context(c||jsonb_build_object('canonical_arguments','{}','arguments','{}'::jsonb))->>'allowed'='false');
  UPDATE auth.users SET email_confirmed_at=NULL WHERE id=actor;
  PERFORM pg_temp.legacy_check(op||'_unconfirmed_owner',public.sandy_legacy_provider_context(c)->>'allowed'='false');
  UPDATE auth.users SET email_confirmed_at=clock_timestamp() WHERE id=actor;
  SELECT error_contract INTO old_contract FROM public.sandy_operation_registry WHERE operation=op;
  UPDATE public.sandy_operation_registry SET error_contract=error_contract||'{"requires_approval":false}'::jsonb WHERE operation=op;
  PERFORM pg_temp.legacy_check(op||'_approval_flag_drift',public.sandy_legacy_provider_context(c)->>'allowed'='false');
  UPDATE public.sandy_operation_registry SET error_contract=old_contract WHERE operation=op;
  proof:=public.sandy_api_consume_execution_grant((c->>'grant_id')::uuid,actor,NULL,op,encode(extensions.digest(canonical,'sha256'),'hex'),(c->>'request_id')::uuid,config.contract_sha256,encode(extensions.digest(config.canonical_scope,'sha256'),'hex'));
  PERFORM pg_temp.legacy_check(op||'_consume_once',proof->>'allowed'='true');
  PERFORM pg_temp.legacy_check(op||'_consumed_context',public.sandy_legacy_provider_context(c,'consumed')->>'allowed'='true');
  PERFORM pg_temp.legacy_check(op||'_already_consumed_refuses_admit_context',public.sandy_legacy_provider_context(c)->>'allowed'='false');
  expected_consumer:=config.consumer;
  proof:=public.sandy_credential_resolve_consumer(expected_consumer,actor,(c->>'admission_id')::uuid,op);
  PERFORM pg_temp.legacy_check(op||'_credential_configuration_only',proof->>'source'='existing_configuration' AND NOT proof ? 'material');
  denied:=false;BEGIN PERFORM public.sandy_credential_resolve_consumer('gcp_access_token',actor,(c->>'admission_id')::uuid,op);EXCEPTION WHEN OTHERS THEN IF SQLERRM<>'consumer_scoped_admission_required' THEN RAISE;END IF;denied:=true;END;
  PERFORM pg_temp.legacy_check(op||'_wrong_consumer_refused',denied);
  proof:=public.sandy_api_consume_execution_grant((c->>'grant_id')::uuid,actor,NULL,op,encode(extensions.digest(canonical,'sha256'),'hex'),(c->>'request_id')::uuid,config.contract_sha256,encode(extensions.digest(config.canonical_scope,'sha256'),'hex'));
  PERFORM pg_temp.legacy_check(op||'_consume_replay_refused',proof->>'allowed'='false');
 END LOOP;
END $fixture$;
SELECT jsonb_build_object('passed',true,'checks',(SELECT count(*) FROM pg_temp.legacy_provider_checks),'labels',(SELECT jsonb_agg(label ORDER BY label) FROM pg_temp.legacy_provider_checks),'actual_auth_session',false,'provider_called',false,'credential_material_read',false,'full_rollback',true) AS evidence;
ROLLBACK;
