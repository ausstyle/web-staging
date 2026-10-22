-- Inject at SANDY_EXTRA_COMPONENT_ASSERTIONS in sandy_customer_mutations_rollback.sql.
-- DB COMPONENT assertions only: fresh synthetic Auth IDs and SET LOCAL claims
-- inside the parent transaction. No login, access token or HTTP auth is tested.
-- The parent owns fixture setup and final ROLLBACK. This file creates no fixtures.
RESET ROLE;
-- Temporary local verification/exposure only to exercise the DB service: the
-- enclosing ROLLBACK restores production gates and this is not certification.
UPDATE public.sandy_operation_registry SET verified=false,api_exposed=false WHERE operation='agenda.pins.save';
SELECT set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('sandy.test.actor_id'),'role','authenticated')::text,true);
SELECT set_config('request.jwt.claim.sub',current_setting('sandy.test.actor_id'),true);
SELECT set_config('request.jwt.claim.role','authenticated',true);
SET LOCAL ROLE authenticated;
DO $pin_verification_gate$
DECLARE r jsonb;
BEGIN
 r:=public.sandy_api_agenda_save_pins(ARRAY[current_setting('sandy.test.task_id')::uuid]);
 ASSERT r->>'ok'='false' AND (r->>'http_status')::integer=424,'direct_rpc_must_not_bypass_unverified_registry_gate';
END $pin_verification_gate$;
RESET ROLE;
UPDATE public.sandy_operation_registry SET verified=true,api_exposed=true WHERE operation='agenda.pins.save';
SET LOCAL ROLE authenticated;
DO $pin_component$
DECLARE r jsonb; task_id uuid:=current_setting('sandy.test.task_id')::uuid;
 other_task_id uuid:=current_setting('sandy.test.other_task_id')::uuid;
BEGIN
 r:=public.sandy_api_agenda_save_pins(ARRAY[task_id]);
 ASSERT r->>'ok'='true' AND r->>'reused'='false' AND r->'task_ids'=jsonb_build_array(task_id),'pin_save_must_replace_the_owned_set';
 r:=public.sandy_api_agenda_save_pins(ARRAY[task_id]);
 ASSERT r->>'ok'='true' AND r->>'reused'='true','identical_pin_set_must_be_idempotent';
 r:=public.sandy_api_agenda_save_pins(ARRAY[task_id,task_id]);
 ASSERT r->>'ok'='false' AND (r->>'http_status')::integer=400,'duplicate_pins_must_fail';
 r:=public.sandy_api_agenda_save_pins(NULL);
 ASSERT r->>'ok'='false' AND (r->>'http_status')::integer=400,'null_pin_input_must_fail';
 r:=public.sandy_api_agenda_save_pins(ARRAY[NULL::uuid]);
 ASSERT r->>'ok'='false' AND (r->>'http_status')::integer=400,'null_pin_elements_must_fail';
 r:=public.sandy_api_agenda_save_pins(ARRAY[[task_id,other_task_id]]);
 ASSERT r->>'ok'='false' AND (r->>'http_status')::integer=400,'multidimensional_pin_arrays_must_fail_structurally';
 r:=public.sandy_api_agenda_save_pins(array_fill(task_id,ARRAY[101]));
 ASSERT r->>'ok'='false' AND (r->>'http_status')::integer=400,'pin_count_is_bounded';
 r:=public.sandy_api_agenda_save_pins(ARRAY[other_task_id]);
 ASSERT r->>'ok'='false' AND (r->>'http_status')::integer=403,'foreign_tenant_pin_must_fail';
 r:=public.sandy_api_agenda_save_pins(ARRAY[task_id]);
 ASSERT r->>'ok'='true' AND r->>'reused'='true','refused_calls_must_not_replace_existing_pins';
 r:=public.sandy_api_agenda_save_pins(ARRAY[]::uuid[]);
 ASSERT r->>'ok'='true' AND r->>'reused'='false' AND r->'task_ids'='[]'::jsonb,'empty_set_must_clear_pins';
 r:=public.sandy_api_agenda_save_pins(ARRAY[]::uuid[]);
 ASSERT r->>'ok'='true' AND r->>'reused'='true','repeated_clear_must_be_idempotent';
END $pin_component$;
RESET ROLE;
SELECT set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('sandy.test.other_actor_id'),'role','authenticated')::text,true);
SELECT set_config('request.jwt.claim.sub',current_setting('sandy.test.other_actor_id'),true);
SET LOCAL ROLE authenticated;
DO $cross_tenant$
DECLARE r jsonb;
BEGIN
 r:=public.sandy_api_agenda_save_pins(ARRAY[current_setting('sandy.test.task_id')::uuid]);
 ASSERT r->>'ok'='false' AND (r->>'http_status')::integer=403,'second_enrolled_tenant_cannot_pin_first_tenant_task';
END $cross_tenant$;
RESET ROLE;
SELECT set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('sandy.test.actor_id'),'role','authenticated')::text,true);
SELECT set_config('request.jwt.claim.sub',current_setting('sandy.test.actor_id'),true);
DO $pin_audit$
DECLARE event_count integer; v_customer_id uuid:=current_setting('sandy.test.customer_id')::uuid;
BEGIN
 ASSERT has_function_privilege('authenticated','public.sandy_api_agenda_save_pins(uuid[])','EXECUTE'),'actual_user_role_needs_pin_rpc';
 ASSERT NOT has_function_privilege('anon','public.sandy_api_agenda_save_pins(uuid[])','EXECUTE'),'anonymous_role_must_not_pin';
 ASSERT NOT has_function_privilege('service_role','public.sandy_api_agenda_save_pins(uuid[])','EXECUTE'),'service_role_is_not_a_customer_session';
 ASSERT NOT has_function_privilege('authenticated','public.sandy_api_current_agenda_customer_id()','EXECUTE'),'directory_resolver_is_private';
 ASSERT NOT has_table_privilege('authenticated','public.sandy_api_agenda_pin_events','SELECT,INSERT,UPDATE,DELETE'),'audit_is_not_directly_customer_accessible';
 SELECT count(*) INTO event_count FROM public.sandy_api_agenda_pin_events e WHERE e.customer_id=v_customer_id;
 ASSERT event_count=2,'only_changed_sets_create_audit_events';
 ASSERT NOT EXISTS(SELECT 1 FROM public.sandy_task_pins p WHERE p.customer_id=v_customer_id),'cleared_pins_must_read_back_empty';
 ASSERT EXISTS(SELECT 1 FROM public.sandy_api_agenda_pin_events e WHERE e.customer_id=v_customer_id AND e.actor_id=current_setting('sandy.test.actor_id')::uuid AND e.before_task_ids=ARRAY[]::uuid[] AND e.after_task_ids=ARRAY[current_setting('sandy.test.task_id')::uuid]),'audit_requires_actual_actor_and_before_after';
 BEGIN
  UPDATE public.sandy_api_agenda_pin_events e SET occurred_at=clock_timestamp() WHERE e.customer_id=v_customer_id;
  RAISE EXCEPTION 'audit_update_was_not_rejected';
 EXCEPTION WHEN check_violation THEN NULL;
 END;
END $pin_audit$;
SELECT jsonb_build_object('suite','sandy_agenda_pins_db_component','synthetic_auth_claims_only',true,'http_authenticated_session_tested',false,'pin_rpc_assertions_passed',true,'rollback_owned_by_parent',true) AS sandy_pin_component_result;

INSERT INTO pg_temp.sandy_customer_component_results(label,payload) VALUES('agenda.pins.assertions','{"database_component_only":true,"passed":true}'::jsonb);
