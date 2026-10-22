-- Composio customer component fixture only. Full rollback; no actual Auth session or provider calls.
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
CREATE TEMP TABLE composio_checks(label text PRIMARY KEY,payload jsonb) ON COMMIT DROP;
CREATE FUNCTION pg_temp.composio_check(label text,condition boolean,payload jsonb DEFAULT '{}') RETURNS void LANGUAGE plpgsql AS $$BEGIN IF condition IS DISTINCT FROM true THEN RAISE EXCEPTION 'Composio assertion %: %',label,payload;END IF;INSERT INTO pg_temp.composio_checks VALUES(label,payload);END $$;
DO $fixture$
DECLARE actor uuid:=gen_random_uuid();other uuid:=gen_random_uuid();customer uuid:=gen_random_uuid();foreign_customer uuid:=gen_random_uuid();email text;foreign_email text;
BEGIN
 IF EXISTS(SELECT 1 FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid WHERE NOT t.tgisinternal AND c.relnamespace='public'::regnamespace AND c.relname IN('sandy_composio_connections','sandy_ai_integrations')) THEN RAISE EXCEPTION 'composio_fixture_trigger_drift';END IF;
 PERFORM set_config('composio.test.actor',actor::text,true);PERFORM set_config('composio.test.other',other::text,true);PERFORM set_config('composio.test.customer',customer::text,true);PERFORM set_config('composio.test.foreign',foreign_customer::text,true);
 email:='sandy-composio-rollback-'||actor::text||'@example.invalid';foreign_email:='sandy-composio-rollback-'||other::text||'@example.invalid';
 INSERT INTO auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data) VALUES(actor,'authenticated','authenticated',email,now(),'{"provider":"email"}','{"sandy_composio_rollback_fixture":true}'),(other,'authenticated','authenticated',foreign_email,now(),'{"provider":"email"}','{"sandy_composio_rollback_fixture":true}');
 INSERT INTO public.email_customers(id,display_name,google_drive_folder_status) VALUES(customer,'Composio rollback fixture','excluded'),(foreign_customer,'Composio foreign rollback fixture','excluded');
 UPDATE public.sandy_memory_settings SET enabled=false,learning_enabled=false,proactive_enabled=false WHERE customer_id IN(customer,foreign_customer);
 INSERT INTO public.email_customer_addresses(customer_id,email_address,is_primary,verified_at) VALUES(customer,email,true,now()),(foreign_customer,foreign_email,true,now());
 INSERT INTO public.sandy_memory_portal_accounts(auth_user_id,customer_id) VALUES(actor,customer),(other,foreign_customer);
 INSERT INTO public.sandy_composio_connections(customer_id,connected_account_id,toolkit_slug,status) VALUES(customer,'rollback-only-customer-'||actor::text,'fixture','ACTIVE'),(foreign_customer,'rollback-only-foreign-'||other::text,'fixture','ACTIVE');
 UPDATE public.sandy_ai_integrations SET enabled=true WHERE integration_key='composio_connector';
 PERFORM pg_temp.composio_check('contracts.closed_and_private',(SELECT count(*)=2 FROM public.sandy_composio_read_contracts) AND NOT EXISTS(SELECT 1 FROM public.sandy_operation_registry WHERE handler='sandy-composio-read-api' AND(api_exposed OR ai_exposed OR verified)));
 PERFORM pg_temp.composio_check('profiles.no_guessed_provider_tool',(SELECT count(*)=0 FROM public.sandy_composio_read_profiles));
 INSERT INTO public.sandy_composio_read_profiles VALUES('fixture_read','fixture','FIXTURE_READ',repeat('a',64),'{"type":"object","properties":{"query":{"type":"string","maxLength":20}},"required":["query"],"additionalProperties":false}','{"type":"object","properties":{"text":{"type":"string","maxLength":100}},"required":["text"],"additionalProperties":false}','reviewed_read_only','component-fixture-not-live-provider-proof',true);
 UPDATE public.sandy_operation_registry SET api_exposed=true,ai_exposed=true,verified=true WHERE handler='sandy-composio-read-api';
 PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',actor,'role','authenticated')::text,true);
END $fixture$;
CREATE FUNCTION pg_temp.composio_admit(op text,args jsonb,rid uuid DEFAULT gen_random_uuid(),channel text DEFAULT 'api') RETURNS jsonb LANGUAGE sql AS $$SELECT public.sandy_composio_read_admit(op,args,args::text,rid,channel)$$;
CREATE FUNCTION pg_temp.composio_bind(a jsonb,args jsonb,channel text DEFAULT 'api') RETURNS jsonb LANGUAGE plpgsql AS $$DECLARE r jsonb;BEGIN PERFORM set_config('request.jwt.claims',jsonb_build_object('role','service_role')::text,true);r:=public.sandy_composio_read_bind((a->>'admission_id')::uuid,(a->>'grant_id')::uuid,current_setting('composio.test.actor')::uuid,args,args::text,channel);PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('composio.test.actor'),'role','authenticated')::text,true);RETURN r;END $$;
DO $boundaries$
DECLARE op text;args jsonb;a jsonb;r jsonb;receipt jsonb;rid uuid;actor uuid:=current_setting('composio.test.actor')::uuid;tenant uuid:=current_setting('composio.test.customer')::uuid;other uuid:=current_setting('composio.test.other')::uuid;old jsonb;
BEGIN
 PERFORM pg_temp.composio_check('identity.unique_actual_portal_tenant',public.sandy_composio_customer(actor)=tenant);
 PERFORM pg_temp.composio_check('acl.only_actual_session_admit_and_service_bind',has_function_privilege('authenticated','public.sandy_composio_read_admit(text,jsonb,text,uuid,text)','EXECUTE') AND NOT has_function_privilege('service_role','public.sandy_composio_read_admit(text,jsonb,text,uuid,text)','EXECUTE') AND NOT has_function_privilege('authenticated','public.sandy_composio_read_bind(uuid,uuid,uuid,jsonb,text,text)','EXECUTE') AND NOT has_table_privilege('service_role','public.sandy_composio_read_profiles','SELECT') AND NOT has_table_privilege('authenticated','public.sandy_composio_read_dispatches','SELECT'));
 FOREACH op IN ARRAY ARRAY['composio.discover_toolkits','composio.execute_read'] LOOP
  args:=CASE WHEN op='composio.execute_read' THEN '{"profile_id":"fixture_read","company_id":null,"arguments":{"query":"hello"}}'::jsonb ELSE '{}'::jsonb END;
  rid:=gen_random_uuid();a:=pg_temp.composio_admit(op,args,rid);PERFORM pg_temp.composio_check(op||'.actual_session_admitted',a->>'ok'='true' AND a->>'actor_id'=actor::text AND a->>'tenant_id'=tenant::text,a);
  r:=pg_temp.composio_admit(op,args,rid);PERFORM pg_temp.composio_check(op||'.admission_replay_no_new_grant',r->>'reused'='true' AND r->>'admission_id'=a->>'admission_id' AND NOT r ? 'grant_id',r);
  r:=pg_temp.composio_admit(op,jsonb_set(args,'{company_id}',to_jsonb(gen_random_uuid())),rid);PERFORM pg_temp.composio_check(op||'.foreign_workspace_denied',r->>'http_status'='403',r);
  PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',actor,'role','service_role')::text,true);r:=pg_temp.composio_admit(op,args);PERFORM pg_temp.composio_check(op||'.service_cannot_be_customer',r->>'http_status'='403',r);
  r:=public.sandy_composio_read_bind((a->>'admission_id')::uuid,(a->>'grant_id')::uuid,other,args,args::text);PERFORM pg_temp.composio_check(op||'.foreign_actor_cannot_bind',r->>'http_status'='409',r);
  PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',actor,'role','authenticated')::text,true);
  r:=public.sandy_composio_read_bind((a->>'admission_id')::uuid,(a->>'grant_id')::uuid,actor,args,args::text);PERFORM pg_temp.composio_check(op||'.user_cannot_call_service_transport',r->>'http_status'='403',r);
  UPDATE auth.users SET email_confirmed_at=NULL WHERE id=actor;r:=pg_temp.composio_bind(a,args);PERFORM pg_temp.composio_check(op||'.unconfirmed_at_dispatch_denied',r->>'http_status'='409',r);UPDATE auth.users SET email_confirmed_at=clock_timestamp() WHERE id=actor;
  UPDATE auth.users SET is_anonymous=true WHERE id=actor;r:=pg_temp.composio_bind(a,args);PERFORM pg_temp.composio_check(op||'.anonymous_at_dispatch_denied',r->>'http_status'='409',r);UPDATE auth.users SET is_anonymous=false WHERE id=actor;
  UPDATE public.sandy_memory_portal_accounts SET revoked_at=clock_timestamp() WHERE auth_user_id=actor;r:=pg_temp.composio_bind(a,args);PERFORM pg_temp.composio_check(op||'.revoked_portal_denied',r->>'http_status'='409',r);UPDATE public.sandy_memory_portal_accounts SET revoked_at=NULL WHERE auth_user_id=actor;
  UPDATE public.sandy_operation_registry SET ai_exposed=false WHERE operation=op;r:=pg_temp.composio_bind(a,args,'mcp');PERFORM pg_temp.composio_check(op||'.mcp_exposure_rechecked',r->>'http_status'='409',r);UPDATE public.sandy_operation_registry SET ai_exposed=true WHERE operation=op;
  SELECT error_contract INTO old FROM public.sandy_operation_registry WHERE operation=op;UPDATE public.sandy_operation_registry SET error_contract=error_contract||'{"api_key_delegable":true}' WHERE operation=op;r:=pg_temp.composio_bind(a,args);PERFORM pg_temp.composio_check(op||'.delegation_policy_drift_denied',r->>'http_status'='409',r);UPDATE public.sandy_operation_registry SET error_contract=old WHERE operation=op;
  r:=pg_temp.composio_bind(a,args||'{"connected_account_id":"foreign"}');PERFORM pg_temp.composio_check(op||'.caller_account_or_input_drift_denied',r->>'http_status'='409',r);
  r:=pg_temp.composio_bind(a,args);PERFORM pg_temp.composio_check(op||'.one_private_dispatch_owned_context',r->>'ok'='true' AND r->>'tenant_id'=tenant::text AND jsonb_array_length(r->'connections')=1 AND r->'connections'->0->>'connected_account_id' LIKE 'rollback-only-customer-%',r);
  receipt:=pg_temp.composio_bind(a,args);PERFORM pg_temp.composio_check(op||'.consume_replay_denied',receipt->>'http_status'='409',receipt);
  PERFORM set_config('request.jwt.claims',jsonb_build_object('role','service_role')::text,true);
  receipt:=public.sandy_composio_read_finish((a->>'admission_id')::uuid,gen_random_uuid(),actor,'succeeded',200,repeat('b',64));PERFORM pg_temp.composio_check(op||'.wrong_finish_claim_denied',receipt->>'http_status'='409',receipt);
  receipt:=public.sandy_composio_read_finish((a->>'admission_id')::uuid,(r->>'claim_id')::uuid,actor,'succeeded',200,repeat('b',64));PERFORM pg_temp.composio_check(op||'.minimal_receipt_persisted',receipt->>'ok'='true' AND receipt->>'result_sha256'=repeat('b',64),receipt);
  receipt:=public.sandy_composio_read_finish((a->>'admission_id')::uuid,(r->>'claim_id')::uuid,actor,'succeeded',200,repeat('b',64));PERFORM pg_temp.composio_check(op||'.finish_replay_denied',receipt->>'http_status'='409',receipt);
  PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',actor,'role','authenticated')::text,true);
  receipt:=pg_temp.composio_admit(op,args,rid);PERFORM pg_temp.composio_check(op||'.owned_replay_digest_no_payload',receipt->>'reused'='true' AND receipt->>'executed'='true' AND receipt->>'result_sha256'=repeat('b',64) AND NOT receipt ? 'data' AND NOT receipt ? 'connections',receipt);
  PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',other,'role','authenticated')::text,true);receipt:=pg_temp.composio_admit(op,args,rid);PERFORM pg_temp.composio_check(op||'.foreign_tenant_request_id_isolated',receipt->>'ok'='true' AND receipt->>'reused'='false' AND receipt->>'admission_id'<>a->>'admission_id',receipt);PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',actor,'role','authenticated')::text,true);
 END LOOP;
 args:='{"profile_id":"fixture_read","company_id":null,"arguments":{"query":"hello"}}';
 a:=pg_temp.composio_admit('composio.execute_read',args);UPDATE public.sandy_composio_read_profiles SET enabled=false WHERE profile_id='fixture_read';r:=pg_temp.composio_bind(a,args);PERFORM pg_temp.composio_check('profile.no_live_prefix_fallback',r->>'error'='reviewed_read_profile_required',r);UPDATE public.sandy_composio_read_profiles SET enabled=true WHERE profile_id='fixture_read';
 a:=pg_temp.composio_admit('composio.execute_read',jsonb_set(args,'{arguments}','{"query":"hello","extra":"no"}'));r:=pg_temp.composio_bind(a,jsonb_set(args,'{arguments}','{"query":"hello","extra":"no"}'));PERFORM pg_temp.composio_check('profile.strict_runtime_arguments',r->>'error'='read_profile_arguments_invalid',r);
 INSERT INTO public.sandy_composio_connections(customer_id,connected_account_id,toolkit_slug,status) VALUES(tenant,'rollback-only-duplicate-'||actor::text,'fixture','ACTIVE');a:=pg_temp.composio_admit('composio.execute_read',args);r:=pg_temp.composio_bind(a,args);PERFORM pg_temp.composio_check('profile.ambiguous_connection_denied',r->>'error'='connection_not_unique_or_inactive',r);
 r:=public.sandy_api_verify_audit(actor,0,NULL,5000);PERFORM pg_temp.composio_check('audit.customer_not_privileged_as_owner',r->>'error'='owner_required',r);
 PERFORM pg_temp.composio_check('audit.customer_event_hashes_valid',EXISTS(SELECT 1 FROM public.sandy_api_audit_events WHERE actor_id=actor) AND NOT EXISTS(SELECT 1 FROM public.sandy_api_audit_events e WHERE actor_id=actor AND e.event_sha256 IS DISTINCT FROM encode(extensions.digest(e.previous_sha256||public.sandy_api_audit_payload(e)::text,'sha256'),'hex')));
END $boundaries$;
SELECT jsonb_build_object('checks',(SELECT count(*) FROM pg_temp.composio_checks),'labels',(SELECT jsonb_agg(label ORDER BY label) FROM pg_temp.composio_checks),'actual_auth_session',false,'actual_provider_calls',0,'full_rollback',true) AS evidence;
ROLLBACK;
