-- Real PostgreSQL component test, not an Auth/MCP acceptance claim.
-- All synthetic users/sessions, customer data and trigger effects roll back.
BEGIN;
SET LOCAL statement_timeout='20s';
SET LOCAL lock_timeout='3s';
CREATE TEMP TABLE sandy_read_test(label text PRIMARY KEY,passed boolean) ON COMMIT DROP;
CREATE FUNCTION pg_temp.sandy_read_assert(p_ok boolean,p_label text) RETURNS void LANGUAGE plpgsql AS $assert$
BEGIN IF p_ok IS DISTINCT FROM true THEN RAISE EXCEPTION 'Read projection assertion: %',p_label;END IF;
INSERT INTO pg_temp.sandy_read_test VALUES(p_label,true);END $assert$;
DO $fixture$
DECLARE actor uuid:=gen_random_uuid();other uuid:=gen_random_uuid();customer uuid:=gen_random_uuid();foreign_customer uuid:=gen_random_uuid();sid uuid:=gen_random_uuid();task uuid:=gen_random_uuid();email text:='sandy-read-rollback-'||gen_random_uuid()::text||'@example.invalid';
BEGIN
 PERFORM set_config('sandy.read.actor',actor::text,true);PERFORM set_config('sandy.read.customer',customer::text,true);
 PERFORM set_config('sandy.read.session',sid::text,true);PERFORM set_config('sandy.read.task',task::text,true);
 INSERT INTO auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data)
 VALUES(actor,'authenticated','authenticated',email,now(),'{}','{}');
 INSERT INTO auth.sessions(id,user_id) VALUES(sid,actor);
 INSERT INTO public.email_customers(id,display_name,google_drive_folder_status)
 VALUES(customer,'Sandy rollback-only read fixture','excluded'),(foreign_customer,'Sandy rollback-only foreign read fixture','excluded');
 UPDATE public.sandy_memory_settings SET enabled=false,learning_enabled=false,proactive_enabled=false WHERE customer_id IN(customer,foreign_customer);
 INSERT INTO public.sandy_agenda_access(email,customer_id,enabled) VALUES(email,customer,true);
 INSERT INTO public.sandy_memory_portal_accounts(auth_user_id,customer_id) VALUES(actor,customer);
 INSERT INTO public.sandy_tasks(id,customer_id,title,source_kind) VALUES(task,customer,'Read projection fixture','sandy_api_fixture'),(other,foreign_customer,'Foreign read fixture','sandy_api_fixture');
 INSERT INTO public.sandy_task_pins(customer_id,task_id,position) VALUES(customer,task,0),(foreign_customer,other,0);
 INSERT INTO public.sandy_timezone_profiles(customer_id,home_timezone) VALUES(customer,'Europe/Rome'),(foreign_customer,'Australia/Sydney');
 PERFORM set_config('request.jwt.claim.sub',actor::text,true);
 PERFORM set_config('request.jwt.claim.role','authenticated',true);
 PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',actor,'role','authenticated','session_id',sid)::text,true);
 PERFORM pg_temp.sandy_read_assert(public.sandy_api_agenda_list_pins()->'pins'->0->>'task_id'=task::text,'actual_owned_pin');
 PERFORM pg_temp.sandy_read_assert(jsonb_array_length(public.sandy_api_agenda_list_pins()->'pins')=1,'foreign_pin_absent');
 PERFORM pg_temp.sandy_read_assert(public.sandy_api_calendar_timezone_get()->'profile'->>'home_timezone'='Europe/Rome','actual_owned_timezone');
 UPDATE public.sandy_memory_portal_accounts SET revoked_at=clock_timestamp() WHERE auth_user_id=actor;
 BEGIN PERFORM public.sandy_api_agenda_list_pins();RAISE EXCEPTION 'revoked portal admitted';EXCEPTION WHEN insufficient_privilege THEN PERFORM pg_temp.sandy_read_assert(true,'revoked_portal_denied');END;
 PERFORM pg_temp.sandy_read_assert(public.sandy_api_calendar_timezone_get()->'profile'->>'home_timezone'='Europe/Rome','timezone_keeps_existing_agenda_only_contract');
 UPDATE public.sandy_memory_portal_accounts SET revoked_at=NULL WHERE auth_user_id=actor;
 UPDATE public.sandy_agenda_access SET enabled=false WHERE customer_id=customer;
 BEGIN PERFORM public.sandy_api_calendar_timezone_get();RAISE EXCEPTION 'revoked agenda admitted';EXCEPTION WHEN insufficient_privilege THEN PERFORM pg_temp.sandy_read_assert(true,'revoked_agenda_denied');END;
 UPDATE public.sandy_agenda_access SET enabled=true WHERE customer_id=customer;
 DELETE FROM auth.sessions WHERE id=sid;
 BEGIN PERFORM public.sandy_api_agenda_list_pins();RAISE EXCEPTION 'retired session admitted';EXCEPTION WHEN insufficient_privilege THEN PERFORM pg_temp.sandy_read_assert(true,'retired_session_denied');END;
 INSERT INTO auth.sessions(id,user_id) VALUES(sid,actor);
 UPDATE auth.users SET banned_until=now()+interval '1 hour' WHERE id=actor;
 BEGIN PERFORM public.sandy_api_calendar_timezone_get();RAISE EXCEPTION 'banned user admitted';EXCEPTION WHEN insufficient_privilege THEN PERFORM pg_temp.sandy_read_assert(true,'banned_user_denied');END;
END $fixture$;
DO $privileges$
BEGIN
 PERFORM pg_temp.sandy_read_assert(NOT has_table_privilege('service_role','public.sandy_task_pins','SELECT'),'pins_table_stays_private');
 PERFORM pg_temp.sandy_read_assert(NOT has_table_privilege('service_role','public.sandy_timezone_profiles','SELECT'),'timezone_table_stays_private');
 PERFORM pg_temp.sandy_read_assert(NOT has_function_privilege('anon','public.sandy_api_agenda_list_pins()','EXECUTE'),'anonymous_RPC_denied');
 PERFORM pg_temp.sandy_read_assert(NOT has_function_privilege('service_role','public.sandy_api_calendar_timezone_get()','EXECUTE'),'service_role_not_customer');
 PERFORM pg_temp.sandy_read_assert(NOT has_function_privilege('authenticated','public.sandy_api_customer_read_customer(boolean)','EXECUTE'),'private_principal_not_public');
END $privileges$;
SELECT count(*) assertions,bool_and(passed) passed FROM pg_temp.sandy_read_test;
ROLLBACK;
