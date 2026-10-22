-- Administrative DATABASE COMPONENT test only; this creates no Auth session,
-- token or HTTP credential and does not certify Sandy API customer authentication.
-- Run this complete file in ONE connection/request. It must end in ROLLBACK.
-- The fresh synthetic Auth/customer rows, receipts, tasks and every queue write
-- remain uncommitted. Never remove the ROLLBACK or run individual fixture inserts.
-- Raw tasks use integration_test. The tasks.create RPC intentionally retains its
-- manual default: its deployed net.http_post only inserts a transactional PG-net
-- queue row; workers cannot see that row before commit. This transaction never commits.
BEGIN;
SET LOCAL statement_timeout='30s';
SET LOCAL lock_timeout='3s';

-- Refuse new/drifted trigger implementations before creating any fixture.
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

CREATE TEMP TABLE sandy_customer_component_results(label text PRIMARY KEY,payload jsonb NOT NULL) ON COMMIT DROP;
GRANT SELECT,INSERT ON pg_temp.sandy_customer_component_results TO authenticated;
CREATE FUNCTION pg_temp.sandy_component_assert(p_ok boolean,p_message text)
RETURNS void LANGUAGE plpgsql AS $assert$
BEGIN IF p_ok IS DISTINCT FROM true THEN RAISE EXCEPTION 'Customer component assertion: %',p_message; END IF; END $assert$;
GRANT EXECUTE ON FUNCTION pg_temp.sandy_component_assert(boolean,text) TO authenticated;

DO $fixture$
DECLARE
 actor uuid:=gen_random_uuid(); other_actor uuid:=gen_random_uuid();
 customer uuid:=gen_random_uuid(); other_customer uuid:=gen_random_uuid();
 task uuid:=gen_random_uuid(); mutation_task uuid:=gen_random_uuid(); other_task uuid:=gen_random_uuid();
 parent uuid:=gen_random_uuid(); child uuid:=gen_random_uuid(); review uuid:=gen_random_uuid();
 company uuid:=gen_random_uuid(); other_company uuid:=gen_random_uuid(); category uuid:=gen_random_uuid();
 file uuid:=gen_random_uuid(); other_file uuid:=gen_random_uuid();
 email text; other_email text;
BEGIN
 email:='sandy-db-component-'||actor::text||'@example.invalid';
 other_email:='sandy-db-component-'||other_actor::text||'@example.invalid';
 PERFORM set_config('sandy.test.actor_id',actor::text,true);
 PERFORM set_config('sandy.test.other_actor_id',other_actor::text,true);
 PERFORM set_config('sandy.test.customer_id',customer::text,true);
 PERFORM set_config('sandy.test.other_customer_id',other_customer::text,true);
 PERFORM set_config('sandy.test.task_id',task::text,true);
 PERFORM set_config('sandy.test.mutation_task_id',mutation_task::text,true);
 PERFORM set_config('sandy.test.other_task_id',other_task::text,true);
 PERFORM set_config('sandy.test.parent_id',parent::text,true);
 PERFORM set_config('sandy.test.child_id',child::text,true);
 PERFORM set_config('sandy.test.review_id',review::text,true);
 PERFORM set_config('sandy.test.company_id',company::text,true);
 PERFORM set_config('sandy.test.other_company_id',other_company::text,true);
 PERFORM set_config('sandy.test.category_id',category::text,true);
 PERFORM set_config('sandy.test.file_id',file::text,true);
 PERFORM set_config('sandy.test.other_file_id',other_file::text,true);
 INSERT INTO auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data)
 VALUES(actor,'authenticated','authenticated',email,now(),'{"provider":"email","providers":["email"]}','{"sandy_database_component_fixture":true}'),
 (other_actor,'authenticated','authenticated',other_email,now(),'{"provider":"email","providers":["email"]}','{"sandy_database_component_fixture":true}');
 INSERT INTO public.email_customers(id,display_name,google_drive_folder_status)
 VALUES(customer,'Sandy rollback-only component fixture','excluded'),(other_customer,'Sandy rollback-only other component fixture','excluded');
 UPDATE public.sandy_memory_settings SET enabled=false,learning_enabled=false,proactive_enabled=false WHERE customer_id IN(customer,other_customer);
 INSERT INTO public.email_customer_addresses(customer_id,email_address,is_primary,verified_at)
 VALUES(customer,email,true,now()),(other_customer,other_email,true,now());
 INSERT INTO public.sandy_memory_portal_accounts(auth_user_id,customer_id)
 VALUES(actor,customer),(other_actor,other_customer);
 INSERT INTO public.sandy_agenda_access(email,customer_id,enabled,onboarding_source)
 VALUES(email,customer,true,'admin_approved'),(other_email,other_customer,true,'admin_approved');
 INSERT INTO public.sandy_agenda_companies(id,customer_id,name)
 VALUES(company,customer,'Synthetic component company'),(other_company,other_customer,'Synthetic other component company');
 INSERT INTO public.sandy_agenda_categories(id,customer_id,company_id,name)
 VALUES(category,customer,company,'Synthetic component category');
 INSERT INTO public.sandy_tasks(id,customer_id,title,source_kind)
 VALUES(task,customer,'Active fixture reserved for pin assertions','integration_test'),
 (mutation_task,customer,'Mutable synthetic fixture','integration_test'),
 (other_task,other_customer,'Foreign synthetic fixture','integration_test'),
 (parent,customer,'Parent completion guard fixture','integration_test');
 INSERT INTO public.sandy_tasks(id,customer_id,parent_task_id,title,source_kind)
 VALUES(child,customer,parent,'Child completion guard fixture','integration_test');
 INSERT INTO public.sandy_tasks(id,customer_id,title,source_kind,metadata)
 VALUES(review,customer,'Mission review guard fixture','integration_test',jsonb_build_object('stage','deliverable_review','work_product_id',gen_random_uuid()));
 INSERT INTO public.sandy_universal_files(id,owner_customer_id,display_name,provider,provider_file_id,description)
 VALUES(file,customer,'Synthetic fixture file','integration_test',file::text,'Original'),
 (other_file,other_customer,'Foreign synthetic fixture file','integration_test',other_file::text,'Original');
 -- This verification change is local to this rolled-back transaction, invisible
 -- to HTTP clients and restored completely by ROLLBACK. It is no certification.
 UPDATE public.sandy_operation_registry SET verified=true WHERE operation IN
 ('tasks.create','tasks.update','tasks.complete','tasks.archive','calendar.create','calendar.update','calendar.cancel','files.rename','files.set_description','files.archive');
 PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',actor,'role','authenticated','email',email)::text,true);
END $fixture$;

SET LOCAL ROLE authenticated;
DO $writes$
DECLARE
 actor uuid:=current_setting('sandy.test.actor_id')::uuid;
 customer uuid:=current_setting('sandy.test.customer_id')::uuid;
 task uuid:=current_setting('sandy.test.mutation_task_id')::uuid;
 company uuid:=current_setting('sandy.test.company_id')::uuid;
 category uuid:=current_setting('sandy.test.category_id')::uuid;
 file uuid:=current_setting('sandy.test.file_id')::uuid;
 event uuid; result jsonb; replay jsonb; before_receipt jsonb;
BEGIN
 result:=public.sandy_api_customer_mutation('tasks.create',jsonb_build_object('title','  Component created task  ','company_id',company,'category_id',category),'customer-component-tasks-create-0001');
 PERFORM pg_temp.sandy_component_assert(result->>'ok'='true' AND result->>'operation'='tasks.create' AND result->'item'->>'customer_id'=customer::text AND result->'item'->>'title'='Component created task','tasks.create receipt and tenant');
 INSERT INTO pg_temp.sandy_customer_component_results VALUES('tasks.create',result);
 replay:=public.sandy_api_customer_mutation('tasks.create',jsonb_build_object('title','  Component created task  ','company_id',company,'category_id',category),'customer-component-tasks-create-0001');
 PERFORM pg_temp.sandy_component_assert(replay=result||'{"reused":true}'::jsonb,'tasks.create stable replay');
 result:=public.sandy_api_customer_mutation('tasks.update',jsonb_build_object('id',task,'title','Updated component task','priority','high'),'customer-component-tasks-update-0001');
 PERFORM pg_temp.sandy_component_assert(result->>'ok'='true' AND result->'item'->>'id'=task::text AND result->'item'->>'priority'='high','tasks.update fields');
 INSERT INTO pg_temp.sandy_customer_component_results VALUES('tasks.update',result);
 before_receipt:=result;
 result:=public.sandy_api_customer_mutation('tasks.update',jsonb_build_object('id',task,'title','Conflict must not apply'),'customer-component-tasks-update-0001');
 PERFORM pg_temp.sandy_component_assert(result->>'error'='idempotency_key_conflict' AND result->>'http_status'='409','different arguments conflict');
 result:=public.sandy_api_customer_mutation('tasks.complete',jsonb_build_object('id',task),'customer-component-tasks-complete-0001');
 PERFORM pg_temp.sandy_component_assert(result->>'ok'='true' AND result->'item'->>'status'='completed' AND result->'item'->>'completed_at' IS NOT NULL,'tasks.complete effect');
 INSERT INTO pg_temp.sandy_customer_component_results VALUES('tasks.complete',result);
 replay:=public.sandy_api_customer_mutation('tasks.complete',jsonb_build_object('id',task),'customer-component-tasks-complete-0001');
 PERFORM pg_temp.sandy_component_assert(replay=result||'{"reused":true}'::jsonb,'tasks.complete replay does not increment version');
 result:=public.sandy_api_customer_mutation('tasks.archive',jsonb_build_object('id',task),'customer-component-tasks-archive-0001');
 PERFORM pg_temp.sandy_component_assert(result->>'ok'='true' AND result->'item'->>'archived_at' IS NOT NULL,'tasks.archive effect');
 INSERT INTO pg_temp.sandy_customer_component_results VALUES('tasks.archive',result);
 replay:=public.sandy_api_customer_mutation('tasks.archive',jsonb_build_object('id',task),'customer-component-tasks-archive-0001');
 PERFORM pg_temp.sandy_component_assert(replay=result||'{"reused":true}'::jsonb,'archived task remains replayable before active resource lookup');

 result:=public.sandy_api_customer_mutation('calendar.create',jsonb_build_object('title','Component event','starts_at','2026-11-01T10:00:00Z','ends_at','2026-11-01T11:00:00Z','company_id',company),'customer-component-calendar-create-0001');
 PERFORM pg_temp.sandy_component_assert(result->>'ok'='true' AND result->'item'->>'customer_id'=customer::text AND result->'item'->>'sync_state'='local','calendar.create tenant and safe default');
 event:=(result->'item'->>'id')::uuid;
 PERFORM set_config('sandy.test.calendar_id',event::text,true);
 INSERT INTO pg_temp.sandy_customer_component_results VALUES('calendar.create',result);
 result:=public.sandy_api_customer_mutation('calendar.update',jsonb_build_object('id',event,'location','Component location','ends_at','2026-11-01T12:00:00Z'),'customer-component-calendar-update-0001');
 PERFORM pg_temp.sandy_component_assert(result->>'ok'='true' AND result->'item'->>'location'='Component location','calendar.update fields');
 INSERT INTO pg_temp.sandy_customer_component_results VALUES('calendar.update',result);
 result:=public.sandy_api_customer_mutation('calendar.update',jsonb_build_object('id',event,'starts_at','2026-11-01T13:00:00Z'),'customer-component-calendar-invalid-0001');
 PERFORM pg_temp.sandy_component_assert(result->>'error'='Event end must follow start' AND result->>'http_status'='400','partial calendar interval validation');
 result:=public.sandy_api_customer_mutation('calendar.cancel',jsonb_build_object('id',event),'customer-component-calendar-cancel-0001');
 PERFORM pg_temp.sandy_component_assert(result->>'ok'='true' AND result->'item'->>'status'='cancelled','calendar.cancel effect');
 INSERT INTO pg_temp.sandy_customer_component_results VALUES('calendar.cancel',result);

 result:=public.sandy_api_customer_mutation('files.rename',jsonb_build_object('id',file,'name',U&'\FEFF\0009'||repeat(U&'\+01F600',130)||'  '),'customer-component-files-rename-0001');
 PERFORM pg_temp.sandy_component_assert(result->>'ok'='true' AND result->'item'->>'display_name'=repeat(U&'\+01F600',125),'files.rename JS whitespace and UTF16 bound');
 INSERT INTO pg_temp.sandy_customer_component_results VALUES('files.rename',result);
 result:=public.sandy_api_customer_mutation('files.set_description',jsonb_build_object('id',file),'customer-component-files-description-0001');
 PERFORM pg_temp.sandy_component_assert(result->>'ok'='true' AND result->'item'->>'description'='','omitted files description clears');
 INSERT INTO pg_temp.sandy_customer_component_results VALUES('files.set_description',result);
 result:=public.sandy_api_customer_mutation('files.archive',jsonb_build_object('id',file),'customer-component-files-archive-0001');
 PERFORM pg_temp.sandy_component_assert(result->>'ok'='true' AND result->'item'->>'library_state'='archived' AND result->'item'->>'library_state_changed_at' IS NOT NULL,'files.archive effect');
 INSERT INTO pg_temp.sandy_customer_component_results VALUES('files.archive',result);

 result:=public.sandy_api_customer_mutation('tasks.complete',jsonb_build_object('id',current_setting('sandy.test.parent_id')),'customer-component-parent-guard-0001');
 PERFORM pg_temp.sandy_component_assert(result->>'error'='Complete or cancel subtasks before completing parent' AND result->>'http_status'='409','existing child completion trigger remains active');
 result:=public.sandy_api_customer_mutation('tasks.update',jsonb_build_object('id',current_setting('sandy.test.parent_id'),'parent_task_id',current_setting('sandy.test.child_id')),'customer-component-cycle-guard-0001');
 PERFORM pg_temp.sandy_component_assert(result->>'error'='Cannot create a task cycle' AND result->>'http_status'='409','existing cycle trigger remains active');
 result:=public.sandy_api_customer_mutation('tasks.complete',jsonb_build_object('id',current_setting('sandy.test.review_id')),'customer-component-mission-guard-0001');
 PERFORM pg_temp.sandy_component_assert(result->>'error'='Review the Sandy draft in Missions before completing this task' AND result->>'http_status'='409','existing mission review trigger remains active');
 result:=public.sandy_api_customer_mutation('tasks.update',jsonb_build_object('id',current_setting('sandy.test.task_id'),'parent_task_id',current_setting('sandy.test.other_task_id')),'customer-component-parent-tenant-0001');
 PERFORM pg_temp.sandy_component_assert(result->>'error'='Parent task inaccessible' AND result->>'http_status'='403','foreign parent refusal');
 result:=public.sandy_api_customer_mutation('tasks.update',jsonb_build_object('id',current_setting('sandy.test.task_id'),'company_id',current_setting('sandy.test.other_company_id')),'customer-component-company-tenant-0001');
 PERFORM pg_temp.sandy_component_assert(result->>'error'='Company inaccessible' AND result->>'http_status'='403','foreign company refusal');
 result:=public.sandy_api_customer_mutation('calendar.create',jsonb_build_object('title','Forbidden event','starts_at','2026-11-01T10:00:00Z','ends_at','2026-11-01T11:00:00Z','company_id',current_setting('sandy.test.other_company_id')),'customer-component-calendar-tenant-0001');
 PERFORM pg_temp.sandy_component_assert(result->>'error'='customer_reference_inaccessible' AND result->>'http_status'='403','calendar company FK tenant refusal');
 result:=public.sandy_api_customer_mutation('files.rename',jsonb_build_object('id',current_setting('sandy.test.other_file_id'),'name','Forbidden rename'),'customer-component-file-tenant-0001');
 PERFORM pg_temp.sandy_component_assert(result->>'error'='customer_item_not_found' AND result->>'http_status'='404','foreign file inaccessible');
 result:=public.sandy_api_customer_mutation('tasks.create',jsonb_build_object('title','Forbidden tenant override','customer_id',current_setting('sandy.test.other_customer_id')),'customer-component-tenant-override-0001');
 PERFORM pg_temp.sandy_component_assert(result->>'error'='invalid_customer_mutation_arguments' AND result->>'http_status'='400','caller tenant override refused');
 -- A missing Auth row is denied despite synthetically supplied local claims.
 PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',gen_random_uuid(),'role','authenticated')::text,true);
 result:=public.sandy_api_customer_mutation('files.archive',jsonb_build_object('id',file),'customer-component-no-auth-row-0001');
 PERFORM pg_temp.sandy_component_assert(result->>'error'='customer_access_required' AND result->>'http_status'='403','actual Auth row lookup is required');
 PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',actor,'role','service_role')::text,true);
 result:=public.sandy_api_customer_mutation('files.archive',jsonb_build_object('id',file),'customer-component-no-service-session-0001');
 PERFORM pg_temp.sandy_component_assert(result->>'error'='customer_session_required' AND result->>'http_status'='401','service role cannot substitute a customer session');
 PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',actor,'role','authenticated')::text,true);
END $writes$;
RESET ROLE;

DO $readback$
DECLARE customer uuid:=current_setting('sandy.test.customer_id')::uuid; task uuid:=current_setting('sandy.test.mutation_task_id')::uuid; created uuid; event uuid:=current_setting('sandy.test.calendar_id')::uuid; rejected boolean:=false; duplicate_rejected boolean:=false; duplicate_message text;
BEGIN
 PERFORM pg_temp.sandy_component_assert((SELECT count(*)=10 FROM pg_temp.sandy_customer_component_results),'exactly ten supported operations returned successful receipts');
 PERFORM pg_temp.sandy_component_assert((SELECT count(*)=10 FROM public.sandy_customer_mutation_receipts WHERE customer_id=customer),'only ten successful mutations committed inside transaction');
 PERFORM pg_temp.sandy_component_assert((SELECT count(DISTINCT mutation_id)=10 FROM public.sandy_customer_mutation_receipts WHERE customer_id=customer),'stable independent mutation IDs');
 PERFORM pg_temp.sandy_component_assert((SELECT title='Updated component task' AND priority='high' AND status='completed' AND archived_at IS NOT NULL AND version=4 FROM public.sandy_tasks WHERE id=task),'task actual readback and replay did not repeat trigger/version effects');
 PERFORM pg_temp.sandy_component_assert((SELECT count(*)=4 FROM public.sandy_task_events WHERE task_id=task),'task audit trigger remains active, no replay events');
 SELECT (payload->'item'->>'id')::uuid INTO created FROM pg_temp.sandy_customer_component_results WHERE label='tasks.create';
 PERFORM pg_temp.sandy_component_assert((SELECT count(*)=1 FROM public.sandy_tasks WHERE id=created AND customer_id=customer AND source_kind='manual' AND version=1),'task create preserves actual defaults and inserts once');
 PERFORM pg_temp.sandy_component_assert((SELECT count(*)=1 FROM public.sandy_task_analysis_queue WHERE task_id=created),'existing task analysis queue trigger retained; queue remains uncommitted');
 PERFORM pg_temp.sandy_component_assert((SELECT count(*)=1 FROM public.sandy_task_events WHERE task_id=created),'created-task replay did not repeat audit');
 PERFORM pg_temp.sandy_component_assert((SELECT status='cancelled' AND location='Component location' AND starts_at='2026-11-01T10:00:00Z'::timestamptz AND ends_at='2026-11-01T12:00:00Z'::timestamptz AND sync_state='local' FROM public.sandy_calendar_events WHERE id=event),'calendar actual readback, partial-date refusal and local sync');
 PERFORM pg_temp.sandy_component_assert(NOT EXISTS(SELECT 1 FROM public.sandy_calendar_outbox WHERE customer_id=customer),'no calendar external-sync queue');
 PERFORM pg_temp.sandy_component_assert((SELECT display_name=repeat(U&'\+01F600',125) AND description='' AND library_state='archived' FROM public.sandy_universal_files WHERE id=current_setting('sandy.test.file_id')::uuid),'file actual readback');
 PERFORM pg_temp.sandy_component_assert(NOT EXISTS(SELECT 1 FROM public.sandy_client_drive_provisioning WHERE customer_id IN(customer,current_setting('sandy.test.other_customer_id')::uuid)),'synthetic customers excluded from Drive provisioning');
 PERFORM pg_temp.sandy_component_assert(NOT EXISTS(SELECT 1 FROM public.sandy_mission_runs WHERE customer_id=customer),'no synthetic mission worker runs');
 PERFORM pg_temp.sandy_component_assert((SELECT bool_and(NOT learning_enabled AND NOT proactive_enabled) FROM public.sandy_memory_settings WHERE customer_id IN(customer,current_setting('sandy.test.other_customer_id')::uuid)),'fixture learning and proactive processing disabled');
 BEGIN
  INSERT INTO public.sandy_calendar_events(customer_id,title,starts_at,ends_at,company_id)
  VALUES(customer,'Rejected raw cross-tenant calendar','2026-11-01T10:00:00Z','2026-11-01T11:00:00Z',current_setting('sandy.test.other_company_id')::uuid);
 EXCEPTION WHEN foreign_key_violation THEN rejected:=true;
 END;
 PERFORM pg_temp.sandy_component_assert(rejected,'calendar composite tenant FK protects independent legacy writers too');
 -- The existing duplicate-name guard must choose a real UUID without invoking
 -- PostgreSQL's nonexistent min(uuid) aggregate. Check its actual trigger error,
 -- not just a fallback unique index, while the attempted insert rolls back.
 BEGIN
  INSERT INTO public.sandy_agenda_companies(id,customer_id,name)
  VALUES(gen_random_uuid(),customer,'Synthetic component company');
 EXCEPTION WHEN unique_violation THEN
  GET STACKED DIAGNOSTICS duplicate_message=MESSAGE_TEXT;
  duplicate_rejected:=duplicate_message='company_name_matches_existing: '||current_setting('sandy.test.company_id');
 END;
 PERFORM pg_temp.sandy_component_assert(duplicate_rejected,'duplicate company guard resolves existing UUID and preserves rejection');

 PERFORM pg_temp.sandy_component_assert(NOT has_table_privilege('authenticated','public.sandy_customer_mutation_receipts','SELECT') AND NOT has_function_privilege('authenticated','public.sandy_api_current_agenda_customer_id()','EXECUTE'),'receipt table and auth resolver remain private');
END $readback$;

-- Parent may inject the separately reviewed Agenda pin assertions here. They must
-- retain the enclosing transaction and return with RESET ROLE.
-- SANDY_EXTRA_COMPONENT_ASSERTIONS

SELECT jsonb_build_object('ok',true,'test_type','database_component_only','operations',10,'agenda_pin_assertions_passed',EXISTS(SELECT 1 FROM pg_temp.sandy_customer_component_results WHERE label='agenda.pins.assertions'),'duplicate_company_guard_tested',true,'rolled_back',true,'http_authentication_verified',false) AS component_evidence;
ROLLBACK;
