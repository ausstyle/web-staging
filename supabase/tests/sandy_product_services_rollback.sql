-- Component evidence only: no HTTP authentication or external provider calls.
-- Execute atomically with09000/09010 migrations inside ONE BEGIN...ROLLBACK.
BEGIN;
SET LOCAL statement_timeout='45s';
SET LOCAL lock_timeout='3s';
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

CREATE TEMP TABLE product_checks(label text PRIMARY KEY,payload jsonb) ON COMMIT DROP;
GRANT SELECT,INSERT ON pg_temp.product_checks TO authenticated;
CREATE FUNCTION pg_temp.product_check(label text,condition boolean,payload jsonb DEFAULT '{}') RETURNS void LANGUAGE plpgsql AS $$BEGIN IF condition IS DISTINCT FROM true THEN RAISE EXCEPTION 'Product assertion %: %',label,payload;END IF;INSERT INTO pg_temp.product_checks VALUES(label,payload);END $$;
GRANT EXECUTE ON FUNCTION pg_temp.product_check(text,boolean,jsonb) TO authenticated;
DO $fixture$
DECLARE actor uuid:=gen_random_uuid();other uuid:=gen_random_uuid();owner uuid:=gen_random_uuid();customer uuid:=gen_random_uuid();foreign_customer uuid:=gen_random_uuid();email text;foreign_email text;
BEGIN
 email:='sandy-product-rollback-'||actor::text||'@example.invalid';foreign_email:='sandy-product-rollback-'||other::text||'@example.invalid';
 PERFORM set_config('product.test.actor',actor::text,true);PERFORM set_config('product.test.other',other::text,true);PERFORM set_config('product.test.owner',owner::text,true);PERFORM set_config('product.test.customer',customer::text,true);PERFORM set_config('product.test.foreign',foreign_customer::text,true);
 INSERT INTO auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data) VALUES(actor,'authenticated','authenticated',email,now(),'{"provider":"email"}','{"sandy_product_rollback_fixture":true}'),(other,'authenticated','authenticated',foreign_email,now(),'{"provider":"email"}','{"sandy_product_rollback_fixture":true}'),(owner,'authenticated','authenticated','sandy-product-rollback-'||owner::text||'@example.invalid',now(),'{"provider":"email"}','{"sandy_product_rollback_fixture":true}');
 INSERT INTO public.email_customers(id,display_name,google_drive_folder_status) VALUES(customer,'Product rollback fixture','excluded'),(foreign_customer,'Product foreign rollback fixture','excluded');
 UPDATE public.sandy_memory_settings SET enabled=false,learning_enabled=false,proactive_enabled=false WHERE customer_id IN(customer,foreign_customer);
 INSERT INTO public.email_customer_addresses(customer_id,email_address,is_primary,verified_at) VALUES(customer,email,true,now()),(foreign_customer,foreign_email,true,now());
 INSERT INTO public.sandy_memory_portal_accounts(auth_user_id,customer_id) VALUES(actor,customer),(other,foreign_customer);
 INSERT INTO public.sandy_controller_admins(auth_user_id,role,enabled) VALUES(owner,'owner',true);
 UPDATE public.sandy_operation_registry SET api_exposed=true,ai_exposed=true,verified=true WHERE handler='sandy-product-service-api';
 PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',actor,'role','authenticated','email',email)::text,true);
END $fixture$;
-- Temporary privileged fixture helper only, invisible outside this connection and
-- removed by ROLLBACK. It creates actual scoped approval rows for owner DB cases.
CREATE FUNCTION pg_temp.product_approval(op text,args jsonb) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE actor uuid:=auth.uid();change_id uuid;job uuid;contract jsonb;manifest jsonb;
BEGIN
 IF actor IS DISTINCT FROM current_setting('product.test.owner')::uuid THEN RAISE EXCEPTION 'fixture_owner_only';END IF;
 SELECT c.contract INTO contract FROM public.sandy_product_operation_contracts c WHERE operation=op;
 INSERT INTO public.sandy_engineering_changes(title,problem,expected_behavior,requested_by,status,change_purpose,feature_improvement) VALUES('Rollback component fixture','Validate isolated product workflows','Persist then read back inside complete rollback',actor,'approved','Rollback-only fixture approval','Validate scoped owner grants and internal state') RETURNING id INTO change_id;
 manifest:=jsonb_build_object('operation',op,'input_sha256',encode(extensions.digest(args::text,'sha256'),'hex'),'contract_sha256',contract->>'contract_sha256','scope_sha256',public.sandy_product_scope_sha(op,actor,NULL,'api',contract->>'contract_sha256'),'maximum_declared_cost_units',0);
 INSERT INTO public.sandy_deployment_jobs(requested_by,provider,operation,target,payload,idempotency_key,status,approved_by,approved_at,engineering_change_id) VALUES(actor::text,'supabase','write','rollback-component-only',jsonb_build_object('sandy_api_execution',manifest),gen_random_uuid()::text,'approved',actor::text,clock_timestamp(),change_id) RETURNING id INTO job;RETURN job;
END $$;
GRANT EXECUTE ON FUNCTION pg_temp.product_approval(text,jsonb) TO authenticated;
CREATE FUNCTION pg_temp.product_invoke(op text,args jsonb DEFAULT '{}') RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE admission jsonb;request_id uuid:=coalesce((args->>'idempotency_key')::uuid,gen_random_uuid());approval uuid;
BEGIN
 IF auth.uid()=current_setting('product.test.owner')::uuid AND args ? 'idempotency_key' THEN approval:=pg_temp.product_approval(op,args);END IF;
 admission:=public.sandy_product_admit(op,args,args::text,request_id,'api',approval);
 IF admission->>'ok' IS DISTINCT FROM 'true' OR admission->>'allowed' IS DISTINCT FROM 'true' THEN RETURN admission;END IF;
 RETURN public.sandy_product_execute_db((admission->>'admission_id')::uuid,(admission->>'grant_id')::uuid,args,args::text,'api');
END $$;
GRANT EXECUTE ON FUNCTION pg_temp.product_invoke(text,jsonb) TO authenticated;
SET LOCAL ROLE authenticated;
DO $tenant_workflows$
DECLARE r jsonb;args jsonb;case_id uuid;notification uuid;admission jsonb;again jsonb;rid uuid;
BEGIN
 r:=pg_temp.product_invoke('customer.profile.get');PERFORM pg_temp.product_check('profile.get',r->'result'->'item'->>'id'=current_setting('product.test.customer'),r);
 r:=pg_temp.product_invoke('customer.profile.update',jsonb_build_object('display_name','Updated rollback profile','idempotency_key',gen_random_uuid()));PERFORM pg_temp.product_check('profile.update',r->'result'->'item'->>'display_name'='Updated rollback profile',r);
 r:=pg_temp.product_invoke('customer.addresses.list');PERFORM pg_temp.product_check('addresses.owned',jsonb_array_length(r->'result'->'items')=1,r);
 args:=jsonb_build_object('subject','Privacy request','details','Please explain supported export process. No erasure execution requested.','category','privacy','idempotency_key',gen_random_uuid());r:=pg_temp.product_invoke('support.cases.create',args);case_id:=(r->'result'->'item'->>'id')::uuid;PERFORM set_config('product.test.case',case_id::text,true);PERFORM pg_temp.product_check('support.create',r->>'ok'='true' AND r->'result'->'item'->>'state'='open' AND r->'result'->'item'->>'version'='1',r);
 again:=public.sandy_product_admit('support.cases.create',args,args::text,(args->>'idempotency_key')::uuid);PERFORM pg_temp.product_check('support.stable_replay',again->>'reused'='true' AND again->'receipt'=r->'result',again);
 args:=jsonb_set(args,'{subject}','"Conflicting reuse"');again:=public.sandy_product_admit('support.cases.create',args,args::text,(args->>'idempotency_key')::uuid);PERFORM pg_temp.product_check('support.conflicting_reuse',again->>'http_status'='409',again);
 r:=pg_temp.product_invoke('support.cases.get',jsonb_build_object('case_id',case_id));PERFORM pg_temp.product_check('support.get',r->'result'->'item'->>'id'=case_id::text AND NOT r->'result'->'item' ? 'customer_id',r);
 r:=pg_temp.product_invoke('support.cases.list');PERFORM pg_temp.product_check('support.list',jsonb_array_length(r->'result'->'items')=1,r);
 r:=pg_temp.product_invoke('support.cases.update',jsonb_build_object('case_id',case_id,'subject','Updated request','details','Updated rollback-only details','expected_version',1,'idempotency_key',gen_random_uuid()));PERFORM pg_temp.product_check('support.update',r->'result'->'item'->>'version'='2',r);
 r:=pg_temp.product_invoke('support.cases.close',jsonb_build_object('case_id',case_id,'expected_version',1,'idempotency_key',gen_random_uuid()));PERFORM pg_temp.product_check('support.version_conflict',r->>'http_status'='409',r);
 r:=pg_temp.product_invoke('support.cases.close',jsonb_build_object('case_id',case_id,'expected_version',2,'idempotency_key',gen_random_uuid()));PERFORM pg_temp.product_check('support.close',r->'result'->'item'->>'state'='closed' AND r->'result'->'item'->>'version'='3',r);
 r:=pg_temp.product_invoke('support.cases.reopen',jsonb_build_object('case_id',case_id,'expected_version',3,'idempotency_key',gen_random_uuid()));PERFORM pg_temp.product_check('support.reopen',r->'result'->'item'->>'state'='open' AND r->'result'->'item'->>'version'='4',r);
 r:=pg_temp.product_invoke('support.comments.create',jsonb_build_object('case_id',case_id,'body','Rollback-only comment','idempotency_key',gen_random_uuid()));PERFORM pg_temp.product_check('support.comment.create',r->'result'->'item'->>'body'='Rollback-only comment' AND NOT r->'result'->'item' ? 'actor_id',r);
 r:=pg_temp.product_invoke('support.comments.list',jsonb_build_object('case_id',case_id));PERFORM pg_temp.product_check('support.comments.list',jsonb_array_length(r->'result'->'items')=1,r);
 r:=pg_temp.product_invoke('notifications.inbox.list');notification:=(r->'result'->'items'->0->>'id')::uuid;PERFORM pg_temp.product_check('inbox.persisted_support_events',jsonb_array_length(r->'result'->'items')=5,r);
 r:=pg_temp.product_invoke('notifications.inbox.get',jsonb_build_object('notification_id',notification));PERFORM pg_temp.product_check('inbox.get',r->'result'->'item'->>'id'=notification::text,r);
 r:=pg_temp.product_invoke('notifications.inbox.acknowledge',jsonb_build_object('notification_id',notification,'idempotency_key',gen_random_uuid()));PERFORM pg_temp.product_check('inbox.acknowledge',r->'result'->'item'->>'acknowledged_at' IS NOT NULL,r);
 r:=pg_temp.product_invoke('notifications.preferences.get');PERFORM pg_temp.product_check('preferences.closed_default',r->'result'->'item'->>'email_enabled'='false' AND r->'result'->'item'->>'whatsapp_enabled'='false',r);
 r:=pg_temp.product_invoke('notifications.preferences.update',jsonb_build_object('email_enabled',false,'whatsapp_enabled',false,'file_alerts_enabled',true,'idempotency_key',gen_random_uuid()));PERFORM pg_temp.product_check('preferences.update',r->'result'->'item'->>'file_alerts_enabled'='true',r);
 r:=pg_temp.product_invoke('notifications.quiet_hours.get');PERFORM pg_temp.product_check('quiet_hours.default',r->'result'->'item'->>'timezone'='UTC',r);
 r:=pg_temp.product_invoke('notifications.quiet_hours.update',jsonb_build_object('enabled',true,'timezone','Pacific/Auckland','start_minute',1320,'end_minute',420,'idempotency_key',gen_random_uuid()));PERFORM pg_temp.product_check('quiet_hours.update',r->'result'->'item'->>'timezone'='Pacific/Auckland',r);
 r:=pg_temp.product_invoke('notifications.quiet_hours.update',jsonb_build_object('enabled',true,'timezone','Not/A_Timezone','start_minute',1320,'end_minute',420,'idempotency_key',gen_random_uuid()));PERFORM pg_temp.product_check('quiet_hours.invalid_zone',r->>'http_status'='400',r);
 r:=pg_temp.product_invoke('notifications.subscriptions.update',jsonb_build_object('topic','support','enabled',false,'idempotency_key',gen_random_uuid()));PERFORM pg_temp.product_check('subscriptions.update',r->>'ok'='true',r);
 r:=pg_temp.product_invoke('notifications.subscriptions.list');PERFORM pg_temp.product_check('subscriptions.readback',EXISTS(SELECT 1 FROM jsonb_array_elements(r->'result'->'items')v WHERE v->>'topic'='support' AND v->>'enabled'='false'),r);
 r:=pg_temp.product_invoke('support.comments.create',jsonb_build_object('case_id',case_id,'body','Silent subscribed-off comment','idempotency_key',gen_random_uuid()));PERFORM pg_temp.product_check('support.comment_after_optout',r->>'ok'='true',r);
 r:=pg_temp.product_invoke('notifications.inbox.list');PERFORM pg_temp.product_check('subscriptions.actually_suppress_inbox_event',jsonb_array_length(r->'result'->'items')=5,r);
 r:=pg_temp.product_invoke('whatsapp.messages.list');PERFORM pg_temp.product_check('whatsapp.empty_owned_list',r->'result'->'items'='[]',r);
 r:=pg_temp.product_invoke('graph.messages.list');PERFORM pg_temp.product_check('graph.empty_owned_list',r->'result'->'items'='[]',r);
 r:=pg_temp.product_invoke('notifications.file_alerts.list');PERFORM pg_temp.product_check('alerts.empty_owned_list',r->'result'->'items'='[]',r);
 r:=pg_temp.product_invoke('notifications.improvements.list');PERFORM pg_temp.product_check('improvements.empty_owned_list',r->'result'->'items'='[]',r);
 -- Provider operations cannot be dispatched through the database CASE executor.
 args:=jsonb_build_object('message_id',gen_random_uuid());admission:=public.sandy_product_admit('graph.messages.get',args,args::text,gen_random_uuid());r:=public.sandy_product_execute_db((admission->>'admission_id')::uuid,(admission->>'grant_id')::uuid,args,args::text);PERFORM pg_temp.product_check('executor.fence',r->>'error'='not_a_database_product_operation',r);
 r:=public.sandy_product_bind_provider((admission->>'admission_id')::uuid,(admission->>'grant_id')::uuid,args,args::text);PERFORM pg_temp.product_check('provider.owned_resource_required',r->>'http_status'='404',r);
 args:='{}';rid:=gen_random_uuid();admission:=public.sandy_product_admit('customer.profile.get',args,args::text,rid);r:=public.sandy_product_execute_db((admission->>'admission_id')::uuid,gen_random_uuid(),args,args::text);PERFORM pg_temp.product_check('grant.wrong_grant',r->>'http_status'='403',r);
 r:=public.sandy_product_execute_db((admission->>'admission_id')::uuid,(admission->>'grant_id')::uuid,args,args::text,'mcp');PERFORM pg_temp.product_check('grant.channel_fenced',r->>'http_status'='409',r);
 r:=public.sandy_product_execute_db((admission->>'admission_id')::uuid,(admission->>'grant_id')::uuid,args,args::text);PERFORM pg_temp.product_check('grant.consume_once',r->>'ok'='true',r);
 r:=public.sandy_product_execute_db((admission->>'admission_id')::uuid,(admission->>'grant_id')::uuid,args,args::text);PERFORM pg_temp.product_check('grant.reconsume_rejected',r->>'http_status'='409',r);
 r:=public.sandy_product_get_receipt(rid);PERFORM pg_temp.product_check('receipt.own',r->>'ok'='true' AND r->'result'->'item'->>'redispatch_permitted'='false',r);
 r:=public.sandy_product_admit('customer.profile.get','{"customer_id":"00000000-0000-0000-0000-000000000000"}','{"customer_id":"00000000-0000-0000-0000-000000000000"}',gen_random_uuid());PERFORM pg_temp.product_check('tenant.argument_injection_denied',r->>'http_status'='400',r);
 r:=pg_temp.product_invoke('product.configuration.providers.list');PERFORM pg_temp.product_check('owner.operation_denied_to_customer',r->>'http_status'='403',r);
END $tenant_workflows$;
RESET ROLE;
SELECT set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('product.test.other'),'role','authenticated')::text,true);
SET LOCAL ROLE authenticated;
DO $foreign_checks$
DECLARE r jsonb;
BEGIN
 r:=pg_temp.product_invoke('support.cases.get',jsonb_build_object('case_id',current_setting('product.test.case')));PERFORM pg_temp.product_check('tenant.foreign_case_denied',r->>'http_status'='404',r);
 r:=pg_temp.product_invoke('support.comments.create',jsonb_build_object('case_id',current_setting('product.test.case'),'body','Foreign write forbidden','idempotency_key',gen_random_uuid()));PERFORM pg_temp.product_check('tenant.foreign_comment_denied',r->>'http_status'='404',r);
 r:=pg_temp.product_invoke('support.cases.list');PERFORM pg_temp.product_check('tenant.foreign_list_empty',r->'result'->'items'='[]',r);
 r:=pg_temp.product_invoke('notifications.inbox.list');PERFORM pg_temp.product_check('tenant.foreign_inbox_empty',r->'result'->'items'='[]',r);
END $foreign_checks$;
RESET ROLE;
SELECT set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('product.test.owner'),'role','authenticated')::text,true);
SET LOCAL ROLE authenticated;
DO $owner_workflows$
DECLARE r jsonb;template uuid;config jsonb;snapshot uuid;stamp text;
BEGIN
 r:=pg_temp.product_invoke('notifications.templates.create',jsonb_build_object('name','rollback_template_'||replace(gen_random_uuid()::text,'-',''),'body_text','Internal rollback-only notification template','idempotency_key',gen_random_uuid()));template:=(r->'result'->'item'->>'id')::uuid;PERFORM pg_temp.product_check('templates.create_scoped_approval',r->>'ok'='true' AND r->'result'->'item'->>'version'='1',r);
 r:=pg_temp.product_invoke('notifications.templates.get',jsonb_build_object('template_id',template));PERFORM pg_temp.product_check('templates.get',r->'result'->'item'->>'id'=template::text,r);
 r:=pg_temp.product_invoke('notifications.templates.update',jsonb_build_object('template_id',template,'body_text','Updated internal template','expected_version',1,'idempotency_key',gen_random_uuid()));PERFORM pg_temp.product_check('templates.versioned_update',r->'result'->'item'->>'version'='2',r);
 r:=pg_temp.product_invoke('notifications.templates.update',jsonb_build_object('template_id',template,'body_text','Stale write','expected_version',1,'idempotency_key',gen_random_uuid()));PERFORM pg_temp.product_check('templates.stale_version_denied',r->>'http_status'='409',r);
 r:=pg_temp.product_invoke('notifications.templates.delete',jsonb_build_object('template_id',template,'expected_version',2,'confirm',true,'idempotency_key',gen_random_uuid()));PERFORM pg_temp.product_check('templates.delete',r->'result'->'item'->>'deleted_at' IS NOT NULL,r);
 r:=pg_temp.product_invoke('notifications.templates.get',jsonb_build_object('template_id',template));PERFORM pg_temp.product_check('templates.deleted_not_returned',r->>'http_status'='404',r);
 r:=pg_temp.product_invoke('product.configuration.providers.list');config:=r->'result'->'items'->0;PERFORM pg_temp.product_check('configuration.existing_provider_read',config->>'provider_key' IS NOT NULL,r);
 r:=pg_temp.product_invoke('product.configuration.providers.update',jsonb_build_object('provider_key',config->>'provider_key','model_name',config->>'model_name','enabled',(config->>'enabled')::boolean,'is_default',(config->>'is_default')::boolean,'expected_updated_at',config->>'updated_at','idempotency_key',gen_random_uuid()));snapshot:=(r->'result'->'item'->>'snapshot_id')::uuid;stamp:=r->'result'->'item'->>'updated_at';PERFORM pg_temp.product_check('configuration.versioned_update_snapshot',r->>'ok'='true' AND snapshot IS NOT NULL,r);
 r:=pg_temp.product_invoke('product.configuration.snapshots.get',jsonb_build_object('snapshot_id',snapshot));PERFORM pg_temp.product_check('configuration.snapshot_before_after',r->'result'->'item'->'before_row'->>'provider_key'=config->>'provider_key' AND r->'result'->'item'->'after_row'->>'updated_at'=stamp,r);
 r:=pg_temp.product_invoke('product.configuration.providers.restore',jsonb_build_object('snapshot_id',snapshot,'expected_updated_at',stamp,'idempotency_key',gen_random_uuid()));PERFORM pg_temp.product_check('configuration.restore',r->'result'->'item'->>'provider_key'=config->>'provider_key' AND r->'result'->'item'->>'model_name'=config->>'model_name',r);
END $owner_workflows$;
RESET ROLE;
-- Synthetic provider responses below test only local protocol persistence.
SELECT set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('product.test.actor'),'role','authenticated')::text,true);
SET LOCAL ROLE authenticated;
DO $draft_compose_admit$
DECLARE args jsonb;admission jsonb;r jsonb;address uuid;
BEGIN
 r:=pg_temp.product_invoke('customer.addresses.list');address:=(r->'result'->'items'->0->>'id')::uuid;
 args:=jsonb_build_object('recipient_address_id',address,'subject','Synthetic unsent draft','body_text','Rollback-only component text','idempotency_key',gen_random_uuid());admission:=public.sandy_product_admit('graph.drafts.create',args,args::text,(args->>'idempotency_key')::uuid);r:=public.sandy_product_bind_provider((admission->>'admission_id')::uuid,(admission->>'grant_id')::uuid,args,args::text);PERFORM pg_temp.product_check('draft.verified_owned_recipient_binding',r->>'ok'='true' AND r->'context'->>'recipient' LIKE '%@example.invalid',r);PERFORM set_config('product.test.draft_admission',admission::text,true);
END $draft_compose_admit$;
RESET ROLE;
DO $draft_compose_callback$
DECLARE admission jsonb:=current_setting('product.test.draft_admission')::jsonb;r jsonb;
BEGIN
 PERFORM set_config('request.jwt.claims','{"role":"service_role"}',true);
 r:=public.sandy_product_finish_provider((admission->>'admission_id')::uuid,(admission->>'grant_id')::uuid,current_setting('product.test.actor')::uuid,current_setting('product.test.customer')::uuid,public.sandy_product_result()||'{"provider_id":"synthetic_rollback_only_draft"}'::jsonb,'accepted',201,'{}');PERFORM pg_temp.product_check('draft.synthetic_callback_private_state',r->>'ok'='true' AND r->'result'->'item'->>'state'='draft',r);PERFORM set_config('product.test.draft_id',r->'result'->'item'->>'id',true);
 PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('product.test.actor'),'role','authenticated')::text,true);
END $draft_compose_callback$;
SET LOCAL ROLE authenticated;
DO $draft_edit_lease$
DECLARE args jsonb:=jsonb_build_object('draft_id',current_setting('product.test.draft_id'),'body_text','Only a synthetic lease','idempotency_key',gen_random_uuid());admission jsonb;r jsonb;
BEGIN
 args:=jsonb_build_object('draft_id',current_setting('product.test.draft_id'),'expected_version',2,'reviewed_content_sha256',repeat('0',64),'confirm',true,'max_provider_units',1,'idempotency_key',gen_random_uuid());admission:=public.sandy_product_admit('graph.drafts.confirm_send',args,args::text,(args->>'idempotency_key')::uuid);r:=public.sandy_product_bind_provider((admission->>'admission_id')::uuid,(admission->>'grant_id')::uuid,args,args::text);PERFORM pg_temp.product_check('draft.stale_preview_version_denied_before_send',r->>'http_status'='409',r);
 args:=jsonb_build_object('draft_id',current_setting('product.test.draft_id'),'body_text','Only a synthetic edit lease','idempotency_key',gen_random_uuid());
 admission:=public.sandy_product_admit('graph.drafts.update',args,args::text,(args->>'idempotency_key')::uuid);r:=public.sandy_product_bind_provider((admission->>'admission_id')::uuid,(admission->>'grant_id')::uuid,args,args::text);PERFORM set_config('product.test.draft_edit_admission',admission::text,true);PERFORM pg_temp.product_check('draft.private_provider_id_and_recipients',r->>'ok'='true' AND r->'context'->>'provider_message_id'='synthetic_rollback_only_draft' AND jsonb_array_length(r->'context'->'recipients')=1,r);
 args:=jsonb_set(args,'{idempotency_key}',to_jsonb(gen_random_uuid()));admission:=public.sandy_product_admit('graph.drafts.update',args,args::text,(args->>'idempotency_key')::uuid);r:=public.sandy_product_bind_provider((admission->>'admission_id')::uuid,(admission->>'grant_id')::uuid,args,args::text);PERFORM pg_temp.product_check('draft.concurrent_edit_or_send_denied',r->>'http_status'='409',r);
END $draft_edit_lease$;
RESET ROLE;
DO $known_preflight_failure_receipt$
DECLARE admission jsonb:=current_setting('product.test.draft_edit_admission')::jsonb;r jsonb;
BEGIN
 PERFORM set_config('request.jwt.claims','{"role":"service_role"}',true);
 r:=public.sandy_product_finish_provider((admission->>'admission_id')::uuid,(admission->>'grant_id')::uuid,current_setting('product.test.actor')::uuid,current_setting('product.test.customer')::uuid,public.sandy_product_result(),'failed',NULL,'{"execution_attempted":false}');PERFORM pg_temp.product_check('receipt.preflight_failure_is_not_provider_execution',r->>'executed'='false' AND r->>'request_state'='failed',r);
 PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('product.test.actor'),'role','authenticated')::text,true);r:=public.sandy_product_get_receipt((admission->>'request_id')::uuid);PERFORM pg_temp.product_check('receipt.preflight_failure_readback_stays_unexecuted',r->>'executed'='false',r);
END $known_preflight_failure_receipt$;
-- No provider HTTP occurs. The following callback payloads are synthetic DB
-- fixtures used solely to exercise receipt persistence, ACL and cursor leases.
SELECT set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('product.test.actor'),'role','authenticated')::text,true);
SET LOCAL ROLE authenticated;
DO $media_admit$
DECLARE args jsonb:=jsonb_build_object('filename','rollback.pdf','content_type','application/pdf','content_base64','JVBERi1maXh0dXJl','idempotency_key',gen_random_uuid());admission jsonb;r jsonb;
BEGIN
 admission:=public.sandy_product_admit('whatsapp.media.upload',args,args::text,(args->>'idempotency_key')::uuid);r:=public.sandy_product_bind_provider((admission->>'admission_id')::uuid,(admission->>'grant_id')::uuid,args,args::text);PERFORM pg_temp.product_check('media.bind_actual_customer_grant',r->>'ok'='true' AND r->>'actor_id'=current_setting('product.test.actor'),r);PERFORM set_config('product.test.media_admission',admission::text,true);
END $media_admit$;
RESET ROLE;
DO $media_callback$
DECLARE admission jsonb:=current_setting('product.test.media_admission')::jsonb;r jsonb;
BEGIN
 PERFORM set_config('request.jwt.claims','{"role":"service_role"}',true);
 r:=public.sandy_product_finish_provider((admission->>'admission_id')::uuid,(admission->>'grant_id')::uuid,current_setting('product.test.other')::uuid,current_setting('product.test.customer')::uuid,public.sandy_product_result()||'{"provider_id":"synthetic_rollback_only_media"}'::jsonb,'accepted',200,'{}');PERFORM pg_temp.product_check('provider.callback_actor_mismatch_denied',r->>'http_status'='409',r);
 r:=public.sandy_product_finish_provider((admission->>'admission_id')::uuid,(admission->>'grant_id')::uuid,current_setting('product.test.actor')::uuid,current_setting('product.test.customer')::uuid,public.sandy_product_result()||'{"provider_id":"synthetic_rollback_only_media"}'::jsonb,'accepted',200,'{}');PERFORM pg_temp.product_check('media.synthetic_callback_local_readback',r->>'ok'='true' AND r->'result'->'item'->>'id' IS NOT NULL,r);PERFORM set_config('product.test.media_id',r->'result'->'item'->>'id',true);
 r:=public.sandy_product_finish_provider((admission->>'admission_id')::uuid,(admission->>'grant_id')::uuid,current_setting('product.test.actor')::uuid,current_setting('product.test.customer')::uuid,'{}','accepted',200,'{}');PERFORM pg_temp.product_check('provider.callback_replay_never_redispatches',r->>'http_status'='409',r);
 PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('product.test.other'),'role','authenticated')::text,true);
END $media_callback$;
SET LOCAL ROLE authenticated;
DO $foreign_media$
DECLARE args jsonb:=jsonb_build_object('media_id',current_setting('product.test.media_id'));admission jsonb;r jsonb;
BEGIN
 admission:=public.sandy_product_admit('whatsapp.media.get',args,args::text,gen_random_uuid());r:=public.sandy_product_bind_provider((admission->>'admission_id')::uuid,(admission->>'grant_id')::uuid,args,args::text);PERFORM pg_temp.product_check('media.foreign_private_binding_denied',r->>'http_status'='404',r);
END $foreign_media$;
RESET ROLE;
SELECT set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('product.test.owner'),'role','authenticated')::text,true);
SET LOCAL ROLE authenticated;
DO $delta_admit$
DECLARE args jsonb:=jsonb_build_object('confirm',true,'idempotency_key',gen_random_uuid());admission jsonb;r jsonb;approval uuid;
BEGIN
 approval:=pg_temp.product_approval('graph.delta.start',args);admission:=public.sandy_product_admit('graph.delta.start',args,args::text,(args->>'idempotency_key')::uuid,'api',approval);r:=public.sandy_product_bind_provider((admission->>'admission_id')::uuid,(admission->>'grant_id')::uuid,args,args::text);PERFORM pg_temp.product_check('delta.approved_owner_grant',r->>'ok'='true',r);PERFORM set_config('product.test.delta_admission',admission::text,true);
END $delta_admit$;
RESET ROLE;
DO $delta_callback$
DECLARE admission jsonb:=current_setting('product.test.delta_admission')::jsonb;r jsonb;
BEGIN
 PERFORM set_config('request.jwt.claims','{"role":"service_role"}',true);
 r:=public.sandy_product_finish_provider((admission->>'admission_id')::uuid,(admission->>'grant_id')::uuid,current_setting('product.test.owner')::uuid,NULL,public.sandy_product_result(),'accepted',200,'{"next_url":"https://graph.microsoft.com/v1.0/users/ai%40email.com.au/messages/delta?$skiptoken=synthetic_rollback_only","complete":false}');PERFORM pg_temp.product_check('delta.synthetic_callback_persists_private_cursor',r->>'ok'='true' AND r->'result'->'item'->>'version'='1' AND NOT r::text LIKE '%skiptoken%',r);PERFORM set_config('product.test.sync_id',r->'result'->'item'->>'id',true);
 PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('product.test.owner'),'role','authenticated')::text,true);
END $delta_callback$;
SET LOCAL ROLE authenticated;
DO $delta_lease$
DECLARE args jsonb:=jsonb_build_object('sync_id',current_setting('product.test.sync_id'),'expected_version',1,'idempotency_key',gen_random_uuid());admission jsonb;r jsonb;approval uuid;
BEGIN
 approval:=pg_temp.product_approval('graph.delta.next',args);admission:=public.sandy_product_admit('graph.delta.next',args,args::text,(args->>'idempotency_key')::uuid,'api',approval);r:=public.sandy_product_bind_provider((admission->>'admission_id')::uuid,(admission->>'grant_id')::uuid,args,args::text);PERFORM pg_temp.product_check('delta.persisted_cursor_claimed',r->>'ok'='true' AND r->'context'->>'next_url' LIKE '%synthetic_rollback_only%',r);
 args:=jsonb_set(args,'{idempotency_key}',to_jsonb(gen_random_uuid()));approval:=pg_temp.product_approval('graph.delta.next',args);admission:=public.sandy_product_admit('graph.delta.next',args,args::text,(args->>'idempotency_key')::uuid,'api',approval);r:=public.sandy_product_bind_provider((admission->>'admission_id')::uuid,(admission->>'grant_id')::uuid,args,args::text);PERFORM pg_temp.product_check('delta.concurrent_cursor_dispatch_denied',r->>'http_status'='409',r);
END $delta_lease$;
RESET ROLE;
DO $private_boundary_checks$
DECLARE r jsonb;actor uuid:=current_setting('product.test.actor')::uuid;
BEGIN
 PERFORM pg_temp.product_check('catalogue.all98_typed_private_registry_contracts_agree',(SELECT count(*) FROM public.sandy_product_operation_contracts)=98 AND NOT EXISTS(SELECT 1 FROM public.sandy_product_operation_contracts c LEFT JOIN public.sandy_operation_registry r ON r.operation=c.operation WHERE r.handler IS DISTINCT FROM 'sandy-product-service-api' OR r.input_schema IS DISTINCT FROM c.contract->'input_schema' OR r.output_schema IS DISTINCT FROM c.contract->'output_schema' OR r.error_contract->>'contract_sha256' IS DISTINCT FROM c.contract->>'contract_sha256'));
 PERFORM pg_temp.product_check('acl.auth_cannot_finish_provider',NOT has_function_privilege('authenticated','public.sandy_product_finish_provider(uuid,uuid,uuid,uuid,jsonb,text,integer,jsonb)','EXECUTE'));
 PERFORM pg_temp.product_check('acl.service_cannot_admit_customer',NOT has_function_privilege('service_role','public.sandy_product_admit(text,jsonb,text,uuid,text,uuid)','EXECUTE'));
 PERFORM pg_temp.product_check('acl.auth_cannot_mutate_tables',NOT has_table_privilege('authenticated','public.sandy_product_support_cases','INSERT') AND NOT has_table_privilege('authenticated','public.sandy_product_results','SELECT'));
 PERFORM pg_temp.product_check('acl.helpers_private',NOT has_function_privilege('authenticated','public.sandy_product_consume(uuid,uuid,jsonb,text,text)','EXECUTE'));
 PERFORM pg_temp.product_check('ledger.normal_customer_actor_never_owner_impersonation',NOT EXISTS(SELECT 1 FROM public.sandy_api_execution_admissions WHERE tenant_id=current_setting('product.test.customer')::uuid AND(actor_id IS DISTINCT FROM actor OR principal_kind<>'auth_user' OR customer_key_id IS NOT NULL OR credential_id IS NOT NULL)));
 PERFORM pg_temp.product_check('ledger.support_exactly_one_from_replay',(SELECT count(*) FROM public.sandy_product_support_cases WHERE customer_id=current_setting('product.test.customer')::uuid)=1);
 PERFORM pg_temp.product_check('audit.all_accepted_internal_mutations_have_before_after',NOT EXISTS(SELECT 1 FROM public.sandy_api_execution_admissions a WHERE a.actor_id IN(current_setting('product.test.actor')::uuid,current_setting('product.test.owner')::uuid) AND a.is_mutation AND a.state='accepted' AND NOT EXISTS(SELECT 1 FROM public.sandy_product_mutation_evidence e WHERE e.admission_id=a.id AND e.after_state IS NOT NULL)));
 PERFORM pg_temp.product_check('preferences.actually_close_email_send',NOT public.sandy_product_send_allowed(current_setting('product.test.customer')::uuid,'email'));
 PERFORM pg_temp.product_check('preferences.actually_close_whatsapp_send',NOT public.sandy_product_send_allowed(current_setting('product.test.customer')::uuid,'whatsapp'));
 UPDATE public.sandy_product_notification_preferences SET email_enabled=true,whatsapp_enabled=true WHERE customer_id=current_setting('product.test.customer')::uuid;UPDATE public.sandy_product_notification_quiet_hours SET enabled=false WHERE customer_id=current_setting('product.test.customer')::uuid;
 PERFORM pg_temp.product_check('preferences.explicit_optin_actually_allows',public.sandy_product_send_allowed(current_setting('product.test.customer')::uuid,'email') AND public.sandy_product_send_allowed(current_setting('product.test.customer')::uuid,'whatsapp'));
 UPDATE public.sandy_product_notification_quiet_hours SET enabled=true,timezone='UTC',start_minute=(extract(hour FROM clock_timestamp() AT TIME ZONE 'UTC')::integer*60+extract(minute FROM clock_timestamp() AT TIME ZONE 'UTC')::integer+1439)%1440,end_minute=(extract(hour FROM clock_timestamp() AT TIME ZONE 'UTC')::integer*60+extract(minute FROM clock_timestamp() AT TIME ZONE 'UTC')::integer+1)%1440 WHERE customer_id=current_setting('product.test.customer')::uuid;
 PERFORM pg_temp.product_check('quiet_hours.actually_gate_provider_sends',NOT public.sandy_product_send_allowed(current_setting('product.test.customer')::uuid,'email') AND NOT public.sandy_product_send_allowed(current_setting('product.test.customer')::uuid,'whatsapp'));
 PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('product.test.owner'),'role','authenticated')::text,true);
 r:=public.sandy_product_admit('whatsapp.account.get','{}','{}',gen_random_uuid());PERFORM pg_temp.product_check('approval.sensitive_owner_read_requires_exact_job',r->>'error'='scoped_mutation_approval_required',r);
 UPDATE public.sandy_operation_registry SET error_contract=jsonb_set(error_contract,'{requires_approval}','false') WHERE operation='whatsapp.account.get';r:=public.sandy_product_admit('whatsapp.account.get','{}','{}',gen_random_uuid());PERFORM pg_temp.product_check('approval.immutable_sensitive_flag_drift_denied',r->>'error'='product_contract_not_enabled',r);UPDATE public.sandy_operation_registry SET error_contract=jsonb_set(error_contract,'{requires_approval}','true') WHERE operation='whatsapp.account.get';
 UPDATE public.sandy_operation_registry SET error_contract=jsonb_set(error_contract,'{api_key_delegable}','true') WHERE operation='whatsapp.account.get';r:=public.sandy_product_admit('whatsapp.account.get','{}','{}',gen_random_uuid());PERFORM pg_temp.product_check('approval.api_key_delegation_drift_denied',r->>'error'='product_contract_not_enabled',r);UPDATE public.sandy_operation_registry SET error_contract=jsonb_set(error_contract,'{api_key_delegable}','false') WHERE operation='whatsapp.account.get';
 r:=public.sandy_api_verify_audit(current_setting('product.test.owner')::uuid,0,NULL,5000);PERFORM pg_temp.product_check('audit.hash_chain_allows_normal_sequence_gaps',r->>'valid'='true',r);
 PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',actor,'role','authenticated')::text,true);
 r:=public.sandy_product_admit('graph.messages.set_categories','{"message_id":"00000000-0000-0000-0000-000000000001","categories":["same","same"],"confirm":true,"idempotency_key":"00000000-0000-0000-0000-000000000002"}','{"message_id":"00000000-0000-0000-0000-000000000001","categories":["same","same"],"confirm":true,"idempotency_key":"00000000-0000-0000-0000-000000000002"}','00000000-0000-0000-0000-000000000002');PERFORM pg_temp.product_check('input.array_duplicate_categories_denied',r->>'http_status'='400',r);
 r:=public.sandy_product_admit('customer.profile.get','{}','{}',gen_random_uuid(),'mcp');PERFORM set_config('product.test.channel_admission',r::text,true);UPDATE public.sandy_operation_registry SET ai_exposed=false WHERE operation='customer.profile.get';r:=public.sandy_product_execute_db((r->>'admission_id')::uuid,(r->>'grant_id')::uuid,'{}','{}','mcp');PERFORM pg_temp.product_check('grant.mcp_exposure_revocation_rechecked',r->>'http_status'='409',r);UPDATE public.sandy_operation_registry SET ai_exposed=true WHERE operation='customer.profile.get';
 UPDATE public.sandy_operation_registry SET api_exposed=false WHERE operation='product.executions.get';r:=public.sandy_product_get_receipt(gen_random_uuid());PERFORM pg_temp.product_check('receipt.closed_registry_gate_enforced',r->>'http_status'='403',r);UPDATE public.sandy_operation_registry SET api_exposed=true WHERE operation='product.executions.get';
 UPDATE auth.users SET email_confirmed_at=NULL WHERE id=actor;r:=public.sandy_product_admit('customer.profile.get','{}','{}',gen_random_uuid());PERFORM pg_temp.product_check('identity.actual_confirmation_rechecked',r->>'http_status'='403',r);UPDATE auth.users SET email_confirmed_at=clock_timestamp() WHERE id=actor;
 UPDATE public.sandy_memory_portal_accounts SET revoked_at=clock_timestamp() WHERE auth_user_id=actor;
 r:=public.sandy_product_admit('customer.profile.get','{}','{}',gen_random_uuid());PERFORM pg_temp.product_check('identity.portal_revocation_enforced',r->>'http_status'='403',r);
END $private_boundary_checks$;
SELECT jsonb_build_object('checks_passed',(SELECT count(*) FROM pg_temp.product_checks),'labels',(SELECT jsonb_agg(label ORDER BY label) FROM pg_temp.product_checks),'kind','real_postgresql_component_full_rollback','auth_session_created',false,'external_provider_requests',0,'all_new_operations_remain_production_disabled',true) AS evidence;

ROLLBACK;
