-- Actual PostgreSQL component tests only. Synthetic Auth rows, no HTTP session or provider calls.
-- Installed09100/09110 base; apply only additive09120 plus this fixture in one BEGIN/ROLLBACK.
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

CREATE TEMP TABLE commerce_checks(label text PRIMARY KEY,payload jsonb) ON COMMIT DROP;
GRANT SELECT,INSERT ON pg_temp.commerce_checks TO authenticated;
CREATE FUNCTION pg_temp.commerce_check(label text,condition boolean,payload jsonb DEFAULT '{}') RETURNS void LANGUAGE plpgsql AS $$BEGIN IF condition IS DISTINCT FROM true THEN RAISE EXCEPTION 'Commerce assertion %: %',label,payload;END IF;INSERT INTO pg_temp.commerce_checks VALUES(label,payload);END $$;
GRANT EXECUTE ON FUNCTION pg_temp.commerce_check(text,boolean,jsonb) TO authenticated;
DO $fixture$
DECLARE actor uuid:=gen_random_uuid();other uuid:=gen_random_uuid();owner uuid:=gen_random_uuid();customer uuid:=gen_random_uuid();foreign_customer uuid:=gen_random_uuid();email text;foreign_email text;
BEGIN
 email:='sandy-commerce-rollback-'||actor::text||'@example.invalid';foreign_email:='sandy-commerce-rollback-'||other::text||'@example.invalid';
 PERFORM set_config('commerce.test.actor',actor::text,true);PERFORM set_config('commerce.test.other',other::text,true);PERFORM set_config('commerce.test.owner',owner::text,true);PERFORM set_config('commerce.test.customer',customer::text,true);PERFORM set_config('commerce.test.foreign',foreign_customer::text,true);
 INSERT INTO auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data) VALUES(actor,'authenticated','authenticated',email,now(),'{"provider":"email"}','{"sandy_commerce_rollback_fixture":true}'),(other,'authenticated','authenticated',foreign_email,now(),'{"provider":"email"}','{"sandy_commerce_rollback_fixture":true}'),(owner,'authenticated','authenticated','sandy-commerce-rollback-'||owner::text||'@example.invalid',now(),'{"provider":"email"}','{"sandy_commerce_rollback_fixture":true}');
 INSERT INTO public.email_customers(id,display_name,google_drive_folder_status) VALUES(customer,'Commerce rollback fixture','excluded'),(foreign_customer,'Commerce foreign rollback fixture','excluded');
 UPDATE public.sandy_memory_settings SET enabled=false,learning_enabled=false,proactive_enabled=false WHERE customer_id IN(customer,foreign_customer);
 INSERT INTO public.email_customer_addresses(customer_id,email_address,is_primary,verified_at) VALUES(customer,email,true,now()),(foreign_customer,foreign_email,true,now());
 INSERT INTO public.sandy_memory_portal_accounts(auth_user_id,customer_id) VALUES(actor,customer),(other,foreign_customer);
 INSERT INTO public.sandy_controller_admins(auth_user_id,role,enabled) VALUES(owner,'owner',true);
 UPDATE public.sandy_operation_registry SET api_exposed=true,ai_exposed=true,verified=true WHERE handler='sandy-commerce-ledger-api';
 PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',actor,'role','authenticated','email',email)::text,true);
END $fixture$;
-- Temporary privileged fixture helper only, invisible outside this connection and
-- removed by ROLLBACK. It creates actual scoped approval rows for owner DB cases.
CREATE FUNCTION pg_temp.commerce_approval(op text,args jsonb) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE actor uuid:=auth.uid();change_id uuid;job uuid;contract jsonb;manifest jsonb;
BEGIN
 IF actor IS DISTINCT FROM current_setting('commerce.test.owner')::uuid THEN RAISE EXCEPTION 'fixture_owner_only';END IF;
 SELECT c.contract INTO contract FROM public.sandy_commerce_contracts c WHERE operation=op;
 INSERT INTO public.sandy_engineering_changes(title,problem,expected_behavior,requested_by,status,change_purpose,feature_improvement) VALUES('Rollback component fixture','Validate isolated commerce workflows','Persist then read back inside complete rollback',actor,'approved','Rollback-only fixture approval','Validate scoped owner grants and internal state') RETURNING id INTO change_id;
 manifest:=jsonb_build_object('operation',op,'input_sha256',encode(extensions.digest(args::text,'sha256'),'hex'),'contract_sha256',contract->>'contract_sha256','scope_sha256',public.sandy_commerce_scope_sha(op,actor,NULL,'api',contract->>'contract_sha256'),'maximum_declared_cost_units',0);
 INSERT INTO public.sandy_deployment_jobs(requested_by,provider,operation,target,payload,idempotency_key,status,approved_by,approved_at,engineering_change_id) VALUES(actor::text,'supabase','write','rollback-component-only',jsonb_build_object('sandy_api_execution',manifest),gen_random_uuid()::text,'approved',actor::text,clock_timestamp(),change_id) RETURNING id INTO job;RETURN job;
END $$;
GRANT EXECUTE ON FUNCTION pg_temp.commerce_approval(text,jsonb) TO authenticated;
CREATE FUNCTION pg_temp.commerce_invoke(op text,args jsonb DEFAULT '{}') RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE admission jsonb;output jsonb;request_id uuid:=coalesce((args->>'idempotency_key')::uuid,gen_random_uuid());approval uuid;
BEGIN
 IF auth.uid()=current_setting('commerce.test.owner')::uuid AND op<>'commerce.processor.capabilities' THEN approval:=pg_temp.commerce_approval(op,args);END IF;
 admission:=public.sandy_commerce_admit(op,args,args::text,request_id,'api',approval);
 IF admission->>'ok' IS DISTINCT FROM 'true' OR admission->>'allowed' IS DISTINCT FROM 'true' THEN RETURN admission;END IF;
 output:=public.sandy_commerce_execute((admission->>'admission_id')::uuid,(admission->>'grant_id')::uuid,args,args::text,'api');
 IF output->>'ok'='true' THEN output:=output||jsonb_build_object('operation',op,'contract_version','1.1.0');END IF;RETURN output;
END $$;
GRANT EXECUTE ON FUNCTION pg_temp.commerce_invoke(text,jsonb) TO authenticated;
SET LOCAL ROLE authenticated;
DO $tenant_workflows$
DECLARE r jsonb;again jsonb;args jsonb;lines jsonb;bad_lines jsonb;cash uuid;income uuid;entry uuid;draft uuid;statement uuid;recon uuid;invoice uuid;request_id uuid;admission jsonb;
BEGIN
 r:=pg_temp.commerce_invoke('commerce.configuration.get');PERFORM pg_temp.commerce_check('configuration.closed_default',r->'result'->'item'->>'configured'='false' AND r->'result'->'item'->>'version'='0',r);
 r:=pg_temp.commerce_invoke('commerce.accounts.create',jsonb_build_object('code','cash','name','Fixture cash','kind','asset','idempotency_key',gen_random_uuid()));PERFORM pg_temp.commerce_check('configuration.required_before_account',r->>'http_status'='424',r);
 args:=jsonb_build_object('currency','NZD','minor_unit_exponent',2,'invoice_prefix','TEST','default_terms_days',14,'expected_version',0,'idempotency_key',gen_random_uuid());r:=pg_temp.commerce_invoke('commerce.configuration.update',args);PERFORM pg_temp.commerce_check('configuration.persisted',r->'result'->'item'->>'currency'='NZD' AND r->'result'->'item'->>'version'='1',r);
 again:=public.sandy_commerce_admit('commerce.configuration.update',args,args::text,(args->>'idempotency_key')::uuid);PERFORM pg_temp.commerce_check('idempotency.replay_same_receipt',again->>'reused'='true' AND again->'receipt'=r->'result',again);
 request_id:=(args->>'idempotency_key')::uuid;PERFORM set_config('commerce.test.request',request_id::text,true);
 args:=jsonb_set(args,'{invoice_prefix}','"MUTATED"');again:=public.sandy_commerce_admit('commerce.configuration.update',args,args::text,request_id);PERFORM pg_temp.commerce_check('idempotency.changed_input_denied',again->>'http_status'='409',again);
 r:=public.sandy_commerce_get_receipt(request_id)||jsonb_build_object('operation','commerce.executions.get','contract_version','1.1.0');PERFORM pg_temp.commerce_check('receipt.own_no_redispatch',r->>'ok'='true' AND r->'result'->'item'->>'redispatch_permitted'='false',r);
 r:=pg_temp.commerce_invoke('commerce.consent.get');PERFORM pg_temp.commerce_check('consent.closed_default',r->'result'->'item'->>'record_current'='false' AND r->'result'->'item'->>'authorizes_processor_charge'='false',r);
 r:=pg_temp.commerce_invoke('commerce.consent.set',jsonb_build_object('terms_version','terms.fixture','invoice_forwarding_allowed',true,'automatic_renewal_recorded',true,'expires_at',clock_timestamp()+interval '1 day','idempotency_key',gen_random_uuid()));PERFORM pg_temp.commerce_check('consent.record_is_not_charge_authority',r->'result'->'item'->>'record_current'='true' AND r->'result'->'item'->>'terms_validated'='false' AND r->'result'->'item'->>'authorizes_processor_charge'='false',r);
 r:=pg_temp.commerce_invoke('commerce.consent.set',jsonb_build_object('terms_version','terms.fixture','invoice_forwarding_allowed',true,'automatic_renewal_recorded',true,'expires_at',clock_timestamp()-interval '1 day','idempotency_key',gen_random_uuid()));PERFORM pg_temp.commerce_check('consent.expired_rejected',r->>'http_status'='400',r);
 r:=pg_temp.commerce_invoke('commerce.consent.revoke',jsonb_build_object('idempotency_key',gen_random_uuid()));PERFORM pg_temp.commerce_check('consent.revoked',r->'result'->'item'->>'record_current'='false' AND r->'result'->'item'->>'invoice_forwarding_allowed'='false' AND r->'result'->'item'->>'automatic_renewal_recorded'='false',r);
 r:=pg_temp.commerce_invoke('commerce.accounts.create',jsonb_build_object('code','cash','name','Fixture cash','kind','asset','idempotency_key',gen_random_uuid()));cash:=(r->'result'->'item'->>'id')::uuid;PERFORM set_config('commerce.test.cash',cash::text,true);PERFORM pg_temp.commerce_check('accounts.create',cash IS NOT NULL AND r->'result'->'item'->>'version'='1',r);
 r:=pg_temp.commerce_invoke('commerce.accounts.create',jsonb_build_object('code','income','name','Fixture income','kind','income','idempotency_key',gen_random_uuid()));income:=(r->'result'->'item'->>'id')::uuid;PERFORM pg_temp.commerce_check('accounts.second',income IS NOT NULL,r);
 r:=pg_temp.commerce_invoke('commerce.accounts.get',jsonb_build_object('account_id',cash));PERFORM pg_temp.commerce_check('accounts.get',r->'result'->'item'->>'id'=cash::text AND NOT r->'result'->'item' ? 'customer_id',r);
 r:=pg_temp.commerce_invoke('commerce.accounts.update',jsonb_build_object('account_id',cash,'name','Renamed fixture cash','expected_version',1,'idempotency_key',gen_random_uuid()));PERFORM pg_temp.commerce_check('accounts.versioned_update',r->'result'->'item'->>'version'='2',r);
 r:=pg_temp.commerce_invoke('commerce.accounts.update',jsonb_build_object('account_id',cash,'name','Stale update','expected_version',1,'idempotency_key',gen_random_uuid()));PERFORM pg_temp.commerce_check('accounts.stale_update_denied',r->>'http_status'='409',r);
 r:=pg_temp.commerce_invoke('commerce.configuration.update',jsonb_build_object('currency','USD','minor_unit_exponent',2,'invoice_prefix','TEST','default_terms_days',14,'expected_version',1,'idempotency_key',gen_random_uuid()));PERFORM pg_temp.commerce_check('configuration.currency_locked_by_records',r->>'http_status'='409',r);
 r:=pg_temp.commerce_invoke('commerce.accounts.list',jsonb_build_object('limit',1));PERFORM pg_temp.commerce_check('accounts.pagination',jsonb_array_length(r->'result'->'items')=1 AND r->'result'->>'next_cursor' IS NOT NULL,r);
 r:=pg_temp.commerce_invoke('commerce.accounts.list',jsonb_build_object('limit',1,'after_id',r->'result'->>'next_cursor'));PERFORM pg_temp.commerce_check('accounts.pagination_next',jsonb_array_length(r->'result'->'items')=1,r);
 lines:=jsonb_build_array(jsonb_build_object('account_id',cash,'debit_minor','9007199254740993','credit_minor','0'),jsonb_build_object('account_id',income,'debit_minor','0','credit_minor','9007199254740993'));
 bad_lines:=jsonb_set(lines,'{1,credit_minor}','"5"');
 args:=jsonb_build_object('description','Unbalanced draft','external_reference','manual-one','effective_at','2026-10-20T00:00:00Z','lines',bad_lines,'idempotency_key',gen_random_uuid());r:=pg_temp.commerce_invoke('commerce.entries.create',args);entry:=(r->'result'->'item'->>'id')::uuid;PERFORM set_config('commerce.test.entry',entry::text,true);PERFORM pg_temp.commerce_check('entries.draft_large_decimal_string',r->'result'->'item'->>'state'='draft' AND EXISTS(SELECT 1 FROM jsonb_array_elements(r->'result'->'item'->'lines')l WHERE l->>'debit_minor'='9007199254740993'),r);
 r:=pg_temp.commerce_invoke('commerce.entries.post',jsonb_build_object('entry_id',entry,'expected_version',1,'idempotency_key',gen_random_uuid()));PERFORM pg_temp.commerce_check('entries.unbalanced_post_denied',r->>'http_status'='409',r);
 again:=public.sandy_commerce_get_receipt((r->>'request_id')::uuid);PERFORM pg_temp.commerce_check('receipt.known_failed_post_is_terminal_unexecuted',again->'result'->'item'->>'state'='failed' AND again->>'executed'='false' AND again->'result'->'item'->'result'->'item'->>'internal_effect_committed'='false',again);
 args:=jsonb_build_object('entry_id',entry,'description','Balanced fixture','external_reference','manual-one','effective_at','2026-10-20T00:00:00Z','lines',lines,'expected_version',1,'idempotency_key',gen_random_uuid());r:=pg_temp.commerce_invoke('commerce.entries.update',args);PERFORM pg_temp.commerce_check('entries.draft_update',r->'result'->'item'->>'version'='2',r);
 r:=pg_temp.commerce_invoke('commerce.entries.post',jsonb_build_object('entry_id',entry,'expected_version',2,'idempotency_key',gen_random_uuid()));PERFORM pg_temp.commerce_check('entries.balanced_post',r->'result'->'item'->>'state'='posted' AND r->'result'->'item'->>'version'='3',r);
 r:=pg_temp.commerce_invoke('commerce.entries.get',jsonb_build_object('entry_id',entry));PERFORM pg_temp.commerce_check('entries.get_lines',jsonb_array_length(r->'result'->'item'->'lines')=2,r);
 r:=pg_temp.commerce_invoke('commerce.entries.list');PERFORM pg_temp.commerce_check('entries.list',jsonb_array_length(r->'result'->'items')=1,r);
 r:=pg_temp.commerce_invoke('commerce.entries.delete',jsonb_build_object('entry_id',entry,'expected_version',3,'idempotency_key',gen_random_uuid()));PERFORM pg_temp.commerce_check('entries.posted_delete_denied',r->>'http_status'='409',r);
 r:=pg_temp.commerce_invoke('commerce.entries.update',args||jsonb_build_object('expected_version',3,'idempotency_key',gen_random_uuid()));PERFORM pg_temp.commerce_check('entries.posted_edit_denied',r->>'http_status'='409',r);
 r:=pg_temp.commerce_invoke('commerce.reports.trial_balance');PERFORM pg_temp.commerce_check('reports.precise_trial_balance',EXISTS(SELECT 1 FROM jsonb_array_elements(r->'result'->'items')i WHERE i->>'id'=cash::text AND i->>'recorded_balance_minor'='9007199254740993') AND(SELECT sum((i->>'recorded_balance_minor')::numeric)=0 FROM jsonb_array_elements(r->'result'->'items')i),r);
 r:=pg_temp.commerce_invoke('commerce.reports.account_ledger',jsonb_build_object('account_id',cash));PERFORM pg_temp.commerce_check('reports.precise_ledger',r->'result'->'items'->0->>'recorded_delta_minor'='9007199254740993',r);
 r:=pg_temp.commerce_invoke('commerce.reports.income_expense');PERFORM pg_temp.commerce_check('reports.income_expense',jsonb_array_length(r->'result'->'items')=1 AND r->'result'->'items'->0->>'recorded_balance_minor'='-9007199254740993',r);
 r:=pg_temp.commerce_invoke('commerce.reports.trial_balance',jsonb_build_object('as_of','2026-10-19T00:00:00Z'));PERFORM pg_temp.commerce_check('reports.date_fence',NOT EXISTS(SELECT 1 FROM jsonb_array_elements(r->'result'->'items')i WHERE i->>'recorded_balance_minor'<>'0'),r);
 r:=pg_temp.commerce_invoke('commerce.statements.import',jsonb_build_object('account_id',cash,'source_reference','manual-fixture','lines',jsonb_build_array(jsonb_build_object('external_reference','manual-one','effective_at','2026-10-20T00:00:00Z','amount_minor','9007199254740993')),'idempotency_key',gen_random_uuid()));statement:=(r->'result'->'item'->>'id')::uuid;PERFORM set_config('commerce.test.statement',statement::text,true);PERFORM pg_temp.commerce_check('statements.manual_unverified_precise',statement IS NOT NULL AND r->'result'->'item'->>'source_kind'='manual_unverified' AND r->'result'->'item'->'lines'->0->>'amount_minor'='9007199254740993',r);
 r:=pg_temp.commerce_invoke('commerce.statements.get',jsonb_build_object('statement_id',statement));PERFORM pg_temp.commerce_check('statements.get',r->'result'->'item'->>'id'=statement::text,r);
 r:=pg_temp.commerce_invoke('commerce.statements.list');PERFORM pg_temp.commerce_check('statements.list',jsonb_array_length(r->'result'->'items')=1,r);
 r:=pg_temp.commerce_invoke('commerce.reconciliation.preview',jsonb_build_object('statement_id',statement));PERFORM pg_temp.commerce_check('reconciliation.preview_not_provider_verified',r->'result'->'item'->'matches'->0->>'state'='proposed_internal_match' AND r->'result'->>'provider_verified'='false',r);
 r:=pg_temp.commerce_invoke('commerce.reconciliation.run',jsonb_build_object('statement_id',statement,'idempotency_key',gen_random_uuid()));recon:=(r->'result'->'item'->>'id')::uuid;PERFORM set_config('commerce.test.recon',recon::text,true);PERFORM pg_temp.commerce_check('reconciliation.persisted_snapshot',recon IS NOT NULL AND r->'result'->'item'->>'state'='proposed_internal',r);
 r:=pg_temp.commerce_invoke('commerce.reconciliation.review',jsonb_build_object('reconciliation_id',recon,'expected_version',1,'confirm_internal_match',true,'idempotency_key',gen_random_uuid()));PERFORM pg_temp.commerce_check('reconciliation.review_internal_only',r->'result'->'item'->>'state'='reviewed_internal' AND r->'result'->'item'->>'version'='2',r);
 r:=pg_temp.commerce_invoke('commerce.reconciliation.get',jsonb_build_object('reconciliation_id',recon));PERFORM pg_temp.commerce_check('reconciliation.readback',r->'result'->'item'->>'state'='reviewed_internal',r);
 r:=pg_temp.commerce_invoke('commerce.reconciliation.list');PERFORM pg_temp.commerce_check('reconciliation.list',jsonb_array_length(r->'result'->'items')=1 AND NOT r->'result'->'items'->0 ? 'matches',r);
 r:=pg_temp.commerce_invoke('commerce.statements.delete',jsonb_build_object('statement_id',statement,'idempotency_key',gen_random_uuid()));PERFORM pg_temp.commerce_check('statements.reconciled_retained',r->>'http_status'='409',r);
 r:=pg_temp.commerce_invoke('commerce.entries.reverse',jsonb_build_object('entry_id',entry,'description','Explicit fixture reversal','effective_at','2026-10-21T00:00:00Z','idempotency_key',gen_random_uuid()));PERFORM pg_temp.commerce_check('entries.explicit_reversal',r->'result'->'item'->>'state'='posted' AND r->'result'->'item'->>'reversal_of'=entry::text,r);
 r:=pg_temp.commerce_invoke('commerce.entries.reverse',jsonb_build_object('entry_id',entry,'description','Duplicate reversal','effective_at','2026-10-21T00:00:00Z','idempotency_key',gen_random_uuid()));PERFORM pg_temp.commerce_check('entries.second_reversal_denied',r->>'http_status'='409',r);
 r:=pg_temp.commerce_invoke('commerce.reports.trial_balance');PERFORM pg_temp.commerce_check('reports.reversal_nets_zero',NOT EXISTS(SELECT 1 FROM jsonb_array_elements(r->'result'->'items')i WHERE i->>'recorded_balance_minor'<>'0'),r);
 args:=jsonb_build_object('description','Deletable draft','external_reference','draft-delete','effective_at','2026-10-20T00:00:00Z','lines',lines,'idempotency_key',gen_random_uuid());r:=pg_temp.commerce_invoke('commerce.entries.create',args);draft:=(r->'result'->'item'->>'id')::uuid;r:=pg_temp.commerce_invoke('commerce.entries.delete',jsonb_build_object('entry_id',draft,'expected_version',1,'idempotency_key',gen_random_uuid()));PERFORM pg_temp.commerce_check('entries.delete_draft_with_lines',r->'result'->'item'->>'state'='deleted_draft',r);
 r:=pg_temp.commerce_invoke('commerce.statements.import',jsonb_build_object('account_id',cash,'source_reference','deletable-manual','lines',jsonb_build_array(jsonb_build_object('external_reference','unmatched','effective_at','2026-10-20T00:00:00Z','amount_minor','-1')),'idempotency_key',gen_random_uuid()));draft:=(r->'result'->'item'->>'id')::uuid;r:=pg_temp.commerce_invoke('commerce.reconciliation.run',jsonb_build_object('statement_id',draft,'idempotency_key',gen_random_uuid()));recon:=(r->'result'->'item'->>'id')::uuid;r:=pg_temp.commerce_invoke('commerce.reconciliation.review',jsonb_build_object('reconciliation_id',recon,'expected_version',1,'confirm_internal_match',true,'idempotency_key',gen_random_uuid()));PERFORM pg_temp.commerce_check('reconciliation.unmatched_confirmation_denied',r->>'http_status'='409',r);
 r:=pg_temp.commerce_invoke('commerce.statements.import',jsonb_build_object('account_id',cash,'source_reference','delete-unreconciled','lines',jsonb_build_array(jsonb_build_object('external_reference','delete-unmatched','effective_at','2026-10-20T00:00:00Z','amount_minor','-1')),'idempotency_key',gen_random_uuid()));draft:=(r->'result'->'item'->>'id')::uuid;r:=pg_temp.commerce_invoke('commerce.statements.delete',jsonb_build_object('statement_id',draft,'idempotency_key',gen_random_uuid()));PERFORM pg_temp.commerce_check('statements.delete_unreconciled',r->'result'->'item'->>'state'='deleted_unreconciled_manual_statement',r);
 args:=jsonb_build_object('counterparty_name','Synthetic counterparty','external_reference','invoice-fixture','items',jsonb_build_array(jsonb_build_object('description','Unverified internal line','quantity',2,'unit_minor','9007199254740993')),'tax_minor','3','discount_minor','1','due_at','2026-11-01T00:00:00Z','idempotency_key',gen_random_uuid());r:=pg_temp.commerce_invoke('commerce.invoices.create',args);invoice:=(r->'result'->'item'->>'id')::uuid;PERFORM set_config('commerce.test.invoice',invoice::text,true);PERFORM pg_temp.commerce_check('invoices.precise_totals_unverified_tax',r->'result'->'item'->>'subtotal_minor'='18014398509481986' AND r->'result'->'item'->>'total_minor'='18014398509481988' AND r->'result'->'item'->>'tax_provenance'='user_supplied_unverified' AND r->'result'->'item'->>'payment_status'='unverified',r);
 args:=args||jsonb_build_object('invoice_id',invoice,'counterparty_name','Updated synthetic name','expected_version',1,'idempotency_key',gen_random_uuid());r:=pg_temp.commerce_invoke('commerce.invoices.update',args);PERFORM pg_temp.commerce_check('invoices.draft_update',r->'result'->'item'->>'version'='2',r);
 r:=pg_temp.commerce_invoke('commerce.invoices.issue',jsonb_build_object('invoice_id',invoice,'expected_version',2,'idempotency_key',gen_random_uuid()));PERFORM pg_temp.commerce_check('invoices.issue_local_number_no_payment',r->'result'->'item'->>'invoice_number'='TEST-1' AND r->'result'->'item'->>'state'='issued_internal' AND r->'result'->'item'->>'payment_status'='unverified',r);
 r:=pg_temp.commerce_invoke('commerce.invoices.update',args||jsonb_build_object('expected_version',3,'idempotency_key',gen_random_uuid()));PERFORM pg_temp.commerce_check('invoices.issued_values_immutable',r->>'http_status'='409',r);
 r:=pg_temp.commerce_invoke('commerce.invoices.get',jsonb_build_object('invoice_id',invoice));PERFORM pg_temp.commerce_check('invoices.get',r->'result'->'item'->>'id'=invoice::text,r);
 r:=pg_temp.commerce_invoke('commerce.invoices.list');PERFORM pg_temp.commerce_check('invoices.list_precise_projection',r->'result'->'items'->0->>'total_minor'='18014398509481988',r);
 r:=pg_temp.commerce_invoke('commerce.invoices.forwarding_status.get',jsonb_build_object('invoice_id',invoice));PERFORM pg_temp.commerce_check('invoices.forwarding_not_observed_never_paid',r->'result'->'item'->>'forwarding_status'='not_observed' AND r->'result'->'item'->>'payment_status'='unverified',r);
 r:=pg_temp.commerce_invoke('commerce.invoices.reconcile_forwarding_status',jsonb_build_object('invoice_id',invoice,'source_message_id',gen_random_uuid(),'idempotency_key',gen_random_uuid()));PERFORM pg_temp.commerce_check('invoices.forwarding_unowned_source_denied',r->>'http_status'='404',r);
 r:=pg_temp.commerce_invoke('commerce.invoices.void',jsonb_build_object('invoice_id',invoice,'expected_version',3,'idempotency_key',gen_random_uuid()));PERFORM pg_temp.commerce_check('invoices.void_is_not_refund',r->'result'->'item'->>'state'='void' AND r->'result'->'item'->>'payment_status'='unverified' AND r->'result'->>'payment_executed'='false',r);
 r:=pg_temp.commerce_invoke('commerce.entitlements.check',jsonb_build_object('feature_key','fixture.feature'));PERFORM pg_temp.commerce_check('entitlements.closed_default',r->'result'->'item'->>'enabled'='false',r);
 r:=pg_temp.commerce_invoke('commerce.entitlements.list');PERFORM pg_temp.commerce_check('entitlements.empty_list',r->'result'->'items'='[]',r);
 r:=pg_temp.commerce_invoke('commerce.plans.list');PERFORM pg_temp.commerce_check('owner.read_denied_to_customer',r->>'http_status'='403',r);
 r:=pg_temp.commerce_invoke('commerce.entitlements.grant',jsonb_build_object('customer_id',current_setting('commerce.test.customer'),'feature_key','fixture.feature','expires_at',clock_timestamp()+interval '1 day','reason','Forbidden customer self grant','idempotency_key',gen_random_uuid()));PERFORM pg_temp.commerce_check('entitlements.customer_cannot_grant',r->>'http_status'='403',r);
 r:=pg_temp.commerce_invoke('commerce.audit.list');PERFORM pg_temp.commerce_check('audit.actual_internal_effects',jsonb_array_length(r->'result'->'items')>10 AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(r->'result'->'items')i WHERE i->>'actor_kind'<>'tenant'),r);
 r:=pg_temp.commerce_invoke('commerce.accounts.close',jsonb_build_object('account_id',cash,'expected_version',2,'idempotency_key',gen_random_uuid()));PERFORM pg_temp.commerce_check('accounts.close_preserves_history',r->'result'->'item'->>'active'='false',r);
 r:=public.sandy_commerce_admit('commerce.accounts.list','{"customer_id":"00000000-0000-0000-0000-000000000000"}','{"customer_id":"00000000-0000-0000-0000-000000000000"}',gen_random_uuid());PERFORM pg_temp.commerce_check('tenant.argument_injection_denied',r->>'http_status'='400',r);
 admission:=public.sandy_commerce_admit('commerce.accounts.list','{}','{}',gen_random_uuid());r:=public.sandy_commerce_execute((admission->>'admission_id')::uuid,gen_random_uuid(),'{}','{}');PERFORM pg_temp.commerce_check('grant.wrong_grant_denied',r->>'http_status'='403',r);
 r:=public.sandy_commerce_execute((admission->>'admission_id')::uuid,(admission->>'grant_id')::uuid,'{}','{}','mcp');PERFORM pg_temp.commerce_check('grant.channel_bound',r->>'http_status'='409',r);
 r:=public.sandy_commerce_execute((admission->>'admission_id')::uuid,(admission->>'grant_id')::uuid,'{}','{}');PERFORM pg_temp.commerce_check('grant.consume_once',r->>'ok'='true',r);
 r:=public.sandy_commerce_execute((admission->>'admission_id')::uuid,(admission->>'grant_id')::uuid,'{}','{}');PERFORM pg_temp.commerce_check('grant.reconsume_denied',r->>'http_status'='409',r);
END $tenant_workflows$;
RESET ROLE;
-- Independent component phases share one rollback transaction. First exercise
-- the real60/min admission limit, then remove ONLY this newly created synthetic
-- actor's transactional rate-window fixture so later boundary assertions fit.
-- No production actor, sequence, setting or deployed limiter is changed.
DO $fixture_phase_rate_boundary$
DECLARE r jsonb;n integer;
BEGIN
 FOR n IN 1..61 LOOP r:=public.sandy_commerce_admit('commerce.configuration.get','{}','{}',gen_random_uuid());EXIT WHEN r->>'http_status'='429';END LOOP;
 PERFORM pg_temp.commerce_check('rate.real_sixty_request_limit',r->>'http_status'='429',r);
 DELETE FROM public.sandy_api_rate_windows WHERE actor_id=current_setting('commerce.test.actor')::uuid AND bucket='commerce:'||current_setting('commerce.test.customer');
END $fixture_phase_rate_boundary$;
SET LOCAL ROLE authenticated;
DO $strict_additional_variants$
DECLARE r jsonb;
BEGIN
 r:=pg_temp.commerce_invoke('commerce.configuration.get');PERFORM pg_temp.commerce_check('strict.configuration_configured_variant',r->'result'->'item'->>'configured'='true' AND r->'result'->'item'->>'currency'='NZD',r);
 r:=pg_temp.commerce_invoke('commerce.consent.get');PERFORM pg_temp.commerce_check('strict.consent_full_revoked_variant',r->'result'->'item'->>'revoked_at' IS NOT NULL AND r->'result'->'item'->>'record_current'='false',r);
END $strict_additional_variants$;
RESET ROLE;


SELECT set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('commerce.test.other'),'role','authenticated')::text,true);
SET LOCAL ROLE authenticated;
DO $foreign_checks$
DECLARE r jsonb;
BEGIN
 r:=pg_temp.commerce_invoke('commerce.accounts.get',jsonb_build_object('account_id',current_setting('commerce.test.cash')));PERFORM pg_temp.commerce_check('tenant.foreign_account_hidden',r->>'http_status'='404',r);
 r:=pg_temp.commerce_invoke('commerce.entries.get',jsonb_build_object('entry_id',current_setting('commerce.test.entry')));PERFORM pg_temp.commerce_check('tenant.foreign_entry_hidden',r->>'http_status'='404',r);
 r:=pg_temp.commerce_invoke('commerce.invoices.get',jsonb_build_object('invoice_id',current_setting('commerce.test.invoice')));PERFORM pg_temp.commerce_check('tenant.foreign_invoice_hidden',r->>'http_status'='404',r);
 r:=pg_temp.commerce_invoke('commerce.reconciliation.get',jsonb_build_object('reconciliation_id',current_setting('commerce.test.recon')));PERFORM pg_temp.commerce_check('tenant.foreign_reconciliation_hidden',r->>'http_status'='404',r);
 r:=public.sandy_commerce_get_receipt(current_setting('commerce.test.request')::uuid);PERFORM pg_temp.commerce_check('tenant.foreign_receipt_hidden',r->>'http_status'='404',r);
 r:=pg_temp.commerce_invoke('commerce.accounts.list');PERFORM pg_temp.commerce_check('tenant.foreign_list_empty',r->'result'->'items'='[]',r);
 r:=pg_temp.commerce_invoke('commerce.consent.revoke',jsonb_build_object('idempotency_key',gen_random_uuid()));PERFORM pg_temp.commerce_check('strict.empty_consent_revoke_variant',r->'result'->'item'->>'revision'='0' AND r->'result'->>'changed'='false',r);
END $foreign_checks$;
RESET ROLE;
SELECT set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('commerce.test.owner'),'role','authenticated')::text,true);
SET LOCAL ROLE authenticated;
DO $owner_workflows$
DECLARE r jsonb;plan uuid;price uuid;admission jsonb;args jsonb;
BEGIN
 r:=public.sandy_commerce_admit('commerce.plans.list','{}','{}',gen_random_uuid());PERFORM pg_temp.commerce_check('owner.sensitive_read_requires_approval',r->>'http_status'='403',r);
 args:=jsonb_build_object('code','fixture.'||replace(gen_random_uuid()::text,'-',''),'name','Synthetic plan','description','Internal commercial configuration only','idempotency_key',gen_random_uuid());r:=pg_temp.commerce_invoke('commerce.plans.create',args);plan:=(r->'result'->'item'->>'id')::uuid;PERFORM pg_temp.commerce_check('plans.create_exact_approval',plan IS NOT NULL AND r->'result'->'item'->>'version'='1',r);
 r:=pg_temp.commerce_invoke('commerce.plans.get',jsonb_build_object('plan_id',plan));PERFORM pg_temp.commerce_check('plans.approved_sensitive_read',r->'result'->'item'->>'id'=plan::text,r);
 r:=pg_temp.commerce_invoke('commerce.plans.list');PERFORM pg_temp.commerce_check('plans.list',jsonb_array_length(r->'result'->'items')=1,r);
 r:=pg_temp.commerce_invoke('commerce.plans.update',jsonb_build_object('plan_id',plan,'name','Updated synthetic plan','description','Still internal only','expected_version',1,'idempotency_key',gen_random_uuid()));PERFORM pg_temp.commerce_check('plans.versioned_update',r->'result'->'item'->>'version'='2',r);
 r:=pg_temp.commerce_invoke('commerce.prices.create',jsonb_build_object('plan_id',plan,'currency','NZD','minor_unit_exponent',2,'unit_minor','9007199254740993','interval','month','idempotency_key',gen_random_uuid()));price:=(r->'result'->'item'->>'id')::uuid;PERFORM pg_temp.commerce_check('prices.internal_configuration_not_provider_price',r->'result'->'item'->>'unit_minor'='9007199254740993' AND r->'result'->'item'->>'provider_price_created'='false',r);
 r:=pg_temp.commerce_invoke('commerce.prices.get',jsonb_build_object('price_id',price));PERFORM pg_temp.commerce_check('prices.get',r->'result'->'item'->>'id'=price::text,r);
 r:=pg_temp.commerce_invoke('commerce.prices.list',jsonb_build_object('plan_id',plan));PERFORM pg_temp.commerce_check('prices.list_precise',r->'result'->'items'->0->>'unit_minor'='9007199254740993',r);
 r:=pg_temp.commerce_invoke('commerce.prices.archive',jsonb_build_object('price_id',price,'idempotency_key',gen_random_uuid()));PERFORM pg_temp.commerce_check('prices.archive',r->'result'->'item'->>'active'='false',r);
 r:=pg_temp.commerce_invoke('commerce.plans.archive',jsonb_build_object('plan_id',plan,'expected_version',2,'idempotency_key',gen_random_uuid()));PERFORM pg_temp.commerce_check('plans.archive',r->'result'->'item'->>'active'='false' AND r->'result'->'item'->>'version'='3',r);
 r:=pg_temp.commerce_invoke('commerce.plans.list',jsonb_build_object('search','updated synthetic','active',false));PERFORM pg_temp.commerce_check('filter.plans_name_active',jsonb_array_length(r->'result'->'items')=1,r);
 r:=pg_temp.commerce_invoke('commerce.prices.list',jsonb_build_object('plan_id',plan,'currency','NZD','interval','month','active',false));PERFORM pg_temp.commerce_check('filter.prices_currency_interval_active',jsonb_array_length(r->'result'->'items')=1,r);
 r:=pg_temp.commerce_invoke('commerce.prices.list',jsonb_build_object('plan_id',plan,'currency','USD'));PERFORM pg_temp.commerce_check('filter.prices_currency_exclusion',r->'result'->'items'='[]',r);
 r:=pg_temp.commerce_invoke('commerce.entitlements.grant',jsonb_build_object('customer_id',current_setting('commerce.test.customer'),'feature_key','fixture.feature','expires_at',clock_timestamp()+interval '1 day','reason','Explicit approved internal fixture entitlement','idempotency_key',gen_random_uuid()));PERFORM pg_temp.commerce_check('entitlements.owner_grant',r->'result'->'item'->>'version'='1' AND r->'result'->'item'->>'feature_key'='fixture.feature',r);
 r:=pg_temp.commerce_invoke('commerce.processor.capabilities');PERFORM pg_temp.commerce_check('processor.unconfigured_truthful',r->'result'->'item'->'configured_processor'='null' AND r->'result'->'item'->>'processor_payments'='false' AND r->'result'->'item'->>'refunds'='false' AND r->'result'->'item'->>'payouts'='false',r);
END $owner_workflows$;
RESET ROLE;
SELECT set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('commerce.test.actor'),'role','authenticated')::text,true);
SET LOCAL ROLE authenticated;
DO $entitlement_readback$
DECLARE r jsonb;
BEGIN r:=pg_temp.commerce_invoke('commerce.entitlements.check',jsonb_build_object('feature_key','fixture.feature'));PERFORM pg_temp.commerce_check('entitlements.real_customer_readback',r->'result'->'item'->>'enabled'='true' AND r->'result'->'item'->>'payment_verified'='false',r);END $entitlement_readback$;
RESET ROLE;
SELECT set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('commerce.test.owner'),'role','authenticated')::text,true);
SET LOCAL ROLE authenticated;
DO $entitlement_revoke$
DECLARE r jsonb;
BEGIN r:=pg_temp.commerce_invoke('commerce.entitlements.revoke',jsonb_build_object('customer_id',current_setting('commerce.test.customer'),'feature_key','fixture.feature','reason','Explicit approved fixture revoke','idempotency_key',gen_random_uuid()));PERFORM pg_temp.commerce_check('entitlements.owner_revoke',r->'result'->'item'->>'revoked_at' IS NOT NULL AND r->'result'->'item'->>'version'='2',r);END $entitlement_revoke$;
RESET ROLE;
SELECT set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('commerce.test.actor'),'role','authenticated')::text,true);
SET LOCAL ROLE authenticated;
DO $revoked_readback$
DECLARE r jsonb;
BEGIN r:=pg_temp.commerce_invoke('commerce.entitlements.check',jsonb_build_object('feature_key','fixture.feature'));PERFORM pg_temp.commerce_check('entitlements.revoked_readback',r->'result'->'item'->>'enabled'='false',r);END $revoked_readback$;
RESET ROLE;
DO $immutable_and_acl$
DECLARE blocked boolean:=false;
BEGIN
 BEGIN UPDATE public.sandy_commerce_entries SET description='Direct forbidden edit' WHERE id=current_setting('commerce.test.entry')::uuid;EXCEPTION WHEN check_violation THEN blocked:=true;END;PERFORM pg_temp.commerce_check('database.posted_journal_guard',blocked);
 blocked:=false;BEGIN UPDATE public.sandy_commerce_entry_lines SET debit_minor=debit_minor+1 WHERE entry_id=current_setting('commerce.test.entry')::uuid;EXCEPTION WHEN check_violation THEN blocked:=true;END;PERFORM pg_temp.commerce_check('database.posted_line_guard',blocked);
 blocked:=false;BEGIN UPDATE public.sandy_commerce_invoices SET total_minor=total_minor+1 WHERE id=current_setting('commerce.test.invoice')::uuid;EXCEPTION WHEN check_violation THEN blocked:=true;END;PERFORM pg_temp.commerce_check('database.issued_invoice_guard',blocked);
 PERFORM pg_temp.commerce_check('acl.private_tables',NOT EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname LIKE 'sandy_commerce_%' AND c.relkind='r' AND(c.relrowsecurity IS DISTINCT FROM true OR has_table_privilege('authenticated',c.oid,'SELECT,INSERT,UPDATE,DELETE') OR has_table_privilege('anon',c.oid,'SELECT,INSERT,UPDATE,DELETE') OR has_table_privilege('service_role',c.oid,'SELECT,INSERT,UPDATE,DELETE'))));
 PERFORM pg_temp.commerce_check('acl.private_helpers',NOT has_function_privilege('authenticated','public.sandy_commerce_minor(text,boolean)','EXECUTE') AND NOT has_function_privilege('service_role','public.sandy_commerce_execute(uuid,uuid,jsonb,text,text)','EXECUTE'));
 PERFORM pg_temp.commerce_check('scope.no_provider_operations',NOT EXISTS(SELECT 1 FROM public.sandy_commerce_contracts WHERE(contract->>'consumes_provider_units')::boolean));
END $immutable_and_acl$;

-- Inspected source guard: these fixtures cannot enqueue provider work. Email is
-- outgoing/empty; memory capture is disabled; universal event insert is local.
DO $email_fixture_source_guard$
BEGIN
 IF EXISTS(SELECT 1 FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace JOIN pg_proc p ON p.oid=t.tgfoid JOIN pg_namespace pn ON pn.oid=p.pronamespace WHERE NOT t.tgisinternal AND n.nspname='public' AND c.relname IN('email_messages','email_conversations','sandy_email_action_receipts','sandy_universal_message_events') AND NOT EXISTS(SELECT 1 FROM(VALUES('email_messages','sandy_capture_email_improvement','public','sandy_capture_explicit_improvement','31adad5863ecf669c088a26f4bcc6f1a'),('email_messages','sandy_capture_email_memory','sandy_private','capture_email','5c012579293e2fbf9749767ba3eb7c3c'),('email_messages','sandy_temporal_email_enqueue','public','sandy_temporal_enqueue_messages','dd0499f2e6d7e3ee8eb33e1f45bbd1a1'),('email_messages','sandy_universal_email_insert','public','sandy_capture_universal_email_event','8d6eb48a77aa49f6162a27b4c795f519'))safe(tbl,trg,ns,fn,source_md5) WHERE safe.tbl=c.relname AND safe.trg=t.tgname AND safe.ns=pn.nspname AND safe.fn=p.proname AND safe.source_md5=md5(pg_get_functiondef(p.oid)))) OR NOT EXISTS(SELECT 1 FROM pg_proc p WHERE p.oid='sandy_private.can_capture(uuid)'::regprocedure AND md5(pg_get_functiondef(p.oid))='cfc97ba2fdc992333201d8a26e519844') THEN RAISE EXCEPTION 'email_fixture_source_drift';END IF;
 IF sandy_private.can_capture(current_setting('commerce.test.customer')::uuid) THEN RAISE EXCEPTION 'fixture_memory_capture_must_be_disabled';END IF;
END $email_fixture_source_guard$;
DO $synthetic_forwarding_receipt$
DECLARE conversation uuid;message uuid;
BEGIN
 INSERT INTO public.email_conversations(customer_id,subject) VALUES(current_setting('commerce.test.customer')::uuid,'Synthetic rollback only') RETURNING id INTO conversation;
 INSERT INTO public.email_messages(customer_id,conversation_id,sender_address,direction,delivery_status,body_text) VALUES(current_setting('commerce.test.customer')::uuid,conversation,'synthetic@example.invalid','outgoing','draft','') RETURNING id INTO message;
 INSERT INTO public.sandy_email_action_receipts(source_message_id,action_key,action_type,status,provider_message_id) VALUES(message,'rollback:'||gen_random_uuid()::text,'invoice_forward','submitted','synthetic_component_only_not_a_provider_response');
 PERFORM set_config('commerce.test.source_message',message::text,true);
END $synthetic_forwarding_receipt$;
SELECT set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('commerce.test.actor'),'role','authenticated')::text,true);
SET LOCAL ROLE authenticated;
DO $forward_status_component$
DECLARE r jsonb;empty_account uuid;zero_statement uuid;
BEGIN
 r:=pg_temp.commerce_invoke('commerce.invoices.reconcile_forwarding_status',jsonb_build_object('invoice_id',current_setting('commerce.test.invoice'),'source_message_id',current_setting('commerce.test.source_message'),'idempotency_key',gen_random_uuid()));PERFORM pg_temp.commerce_check('invoices.submitted_forward_is_not_payment',r->'result'->'item'->>'forwarding_status'='submitted' AND r->'result'->'item'->>'payment_status'='unverified' AND r->'result'->>'provider_verified'='false' AND r->'result'->'item'->>'invoice_source_correspondence_verified'='false' AND r->'result'->'item'->>'source_linkage'='customer_asserted',r);
 r:=pg_temp.commerce_invoke('commerce.invoices.forwarding_status.get',jsonb_build_object('invoice_id',current_setting('commerce.test.invoice')));PERFORM pg_temp.commerce_check('invoices.forward_receipt_readback',jsonb_array_length(r->'result'->'items')=1 AND r->'result'->'items'->0->>'status'='submitted' AND r->'result'->'item'->>'payment_status'='unverified',r);

 r:=pg_temp.commerce_invoke('commerce.accounts.list',jsonb_build_object('search','renamed fixture','kind','asset','active',false));PERFORM pg_temp.commerce_check('filter.accounts_name_kind_active',jsonb_array_length(r->'result'->'items')=1,r);
 r:=pg_temp.commerce_invoke('commerce.accounts.list',jsonb_build_object('search','no_matching_account'));PERFORM pg_temp.commerce_check('filter.accounts_literal_search',r->'result'->'items'='[]',r);
 r:=pg_temp.commerce_invoke('commerce.entries.list',jsonb_build_object('search','balanced fixture','state','posted','from_at','2026-10-19T00:00:00Z','to_at','2026-10-20T23:59:59Z'));PERFORM pg_temp.commerce_check('filter.entries_search_state_dates',jsonb_array_length(r->'result'->'items')=1,r);
 r:=pg_temp.commerce_invoke('commerce.statements.list',jsonb_build_object('account_id',current_setting('commerce.test.cash'),'search','manual-fixture'));PERFORM pg_temp.commerce_check('filter.statements_account_source',jsonb_array_length(r->'result'->'items')=1,r);
 r:=pg_temp.commerce_invoke('commerce.reconciliation.list',jsonb_build_object('statement_id',current_setting('commerce.test.statement'),'state','reviewed_internal'));PERFORM pg_temp.commerce_check('filter.reconciliation_statement_state',jsonb_array_length(r->'result'->'items')=1,r);
 r:=pg_temp.commerce_invoke('commerce.invoices.list',jsonb_build_object('search','updated synthetic','state','void','forwarding_status','submitted','due_before','2027-01-01T00:00:00Z'));PERFORM pg_temp.commerce_check('filter.invoices_search_state_forward_due',jsonb_array_length(r->'result'->'items')=1,r);
 r:=pg_temp.commerce_invoke('commerce.invoices.list',jsonb_build_object('due_before','2020-01-01T00:00:00Z'));PERFORM pg_temp.commerce_check('filter.invoices_due_bound',r->'result'->'items'='[]',r);
 r:=pg_temp.commerce_invoke('commerce.entitlements.list',jsonb_build_object('feature_key','fixture.feature','enabled',false));PERFORM pg_temp.commerce_check('filter.entitlements_current_revocation',jsonb_array_length(r->'result'->'items')=1,r);
 r:=pg_temp.commerce_invoke('commerce.audit.list',jsonb_build_object('operation','commerce.invoices.issue','from_at','2020-01-01T00:00:00Z','to_at','2030-01-01T00:00:00Z'));PERFORM pg_temp.commerce_check('filter.audit_operation_dates',jsonb_array_length(r->'result'->'items')=1,r);

 r:=pg_temp.commerce_invoke('commerce.accounts.create',jsonb_build_object('code','empty-account','name','Unrelated empty account','kind','asset','idempotency_key',gen_random_uuid()));empty_account:=(r->'result'->'item'->>'id')::uuid;
 r:=pg_temp.commerce_invoke('commerce.statements.import',jsonb_build_object('account_id',empty_account,'source_reference','zero-unrelated','lines',jsonb_build_array(jsonb_build_object('external_reference','manual-one','effective_at','2026-10-20T00:00:00Z','amount_minor','0')),'idempotency_key',gen_random_uuid()));zero_statement:=(r->'result'->'item'->>'id')::uuid;
 r:=pg_temp.commerce_invoke('commerce.reconciliation.preview',jsonb_build_object('statement_id',zero_statement));PERFORM pg_temp.commerce_check('reconciliation.zero_value_requires_actual_account_line',r->'result'->'item'->'matches'->0->>'state'='unmatched' AND r->'result'->'item'->'matches'->0->>'candidate_count'='0',r);
END $forward_status_component$;
RESET ROLE;
-- One large record is created through the actual normal-actor RPC boundary.
-- Additional identical, legitimate-size rows are private rollback-only fixtures
-- to exercise the aggregate response budget; they trigger no provider work.
SET LOCAL ROLE authenticated;
DO $large_record_create$
DECLARE r jsonb;items jsonb;
BEGIN
 SELECT jsonb_agg(jsonb_build_object('description',repeat('x',900),'quantity',1,'unit_minor','1')) INTO items FROM generate_series(1,50);
 r:=pg_temp.commerce_invoke('commerce.invoices.create',jsonb_build_object('counterparty_name','Large fixture','external_reference','large-fixture','items',items,'tax_minor','0','discount_minor','0','due_at','2026-11-01T00:00:00Z','idempotency_key',gen_random_uuid()));PERFORM pg_temp.commerce_check('capacity.legitimate_large_invoice_created',r->>'ok'='true' AND octet_length((r->'result')::text)>40000,r);PERFORM set_config('commerce.test.large_invoice',r->'result'->'item'->>'id',true);
END $large_record_create$;
RESET ROLE;
INSERT INTO public.sandy_commerce_invoices(customer_id,counterparty_name,external_reference,currency,minor_unit_exponent,items,subtotal_minor,tax_minor,discount_minor,total_minor,due_at)
 SELECT customer_id,counterparty_name,external_reference||'-clone-'||n,currency,minor_unit_exponent,items,subtotal_minor,tax_minor,discount_minor,total_minor,due_at FROM public.sandy_commerce_invoices CROSS JOIN generate_series(1,19)n WHERE id=current_setting('commerce.test.large_invoice')::uuid;
INSERT INTO public.sandy_email_action_receipts(source_message_id,action_key,action_type,status,provider_message_id)
 SELECT current_setting('commerce.test.source_message')::uuid,'rollback:'||gen_random_uuid()::text,'invoice_forward','submitted','synthetic_component_only_not_a_provider_response' FROM generate_series(1,2);
SET LOCAL ROLE authenticated;
DO $large_page_capacity$
DECLARE r jsonb;args jsonb:='{"limit":50}';seen text[]:=ARRAY[]::text[];value jsonb;n integer;total integer:=0;
BEGIN
 FOR n IN 1..20 LOOP
  r:=pg_temp.commerce_invoke('commerce.invoices.list',args);IF r->>'ok' IS DISTINCT FROM 'true' OR octet_length((r->'result')::text)>192000 THEN RAISE EXCEPTION 'large page failed or exceeded bound: %',r->>'error';END IF;
  IF n=1 THEN PERFORM pg_temp.commerce_check('capacity.byte_truncation_has_executable_cursor',r->'result'->>'possibly_truncated'='true' AND r->'result'->>'next_cursor' IS NOT NULL AND jsonb_array_length(r->'result'->'items')<50 AND octet_length((r->'result')::text)>100000,r);END IF;
  FOR value IN SELECT * FROM jsonb_array_elements(r->'result'->'items') LOOP IF value->>'id'=ANY(seen) THEN RAISE EXCEPTION 'byte pagination duplicate';END IF;seen:=array_append(seen,value->>'id');total:=total+1;END LOOP;
  EXIT WHEN r->'result'->>'next_cursor' IS NULL;
  args:=jsonb_build_object('limit',50,'after_id',r->'result'->>'next_cursor');
 END LOOP;
 PERFORM pg_temp.commerce_check('capacity.pagination_returns_all_large_records_once',total=21 AND r->'result'->>'next_cursor' IS NULL,jsonb_build_object('rows',total,'pages',n));
 r:=pg_temp.commerce_invoke('commerce.invoices.forwarding_status.get',jsonb_build_object('invoice_id',current_setting('commerce.test.invoice'),'limit',1));PERFORM pg_temp.commerce_check('forwarding.receipts_have_real_pagination',jsonb_array_length(r->'result'->'items')=1 AND r->'result'->>'possibly_truncated'='true' AND r->'result'->>'next_cursor' IS NOT NULL AND r->'result'->'item'->>'invoice_source_correspondence_verified'='false',r);
 r:=pg_temp.commerce_invoke('commerce.invoices.forwarding_status.get',jsonb_build_object('invoice_id',current_setting('commerce.test.invoice'),'limit',1,'after_id',r->'result'->>'next_cursor'));PERFORM pg_temp.commerce_check('forwarding.receipt_cursor_continues',jsonb_array_length(r->'result'->'items')=1,r);
END $large_page_capacity$;
RESET ROLE;
DO $immutable_policy_rechecks$
DECLARE r jsonb;admission jsonb;
BEGIN
 PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('commerce.test.owner'),'role','authenticated')::text,true);
 UPDATE public.sandy_operation_registry SET error_contract=jsonb_set(error_contract,'{requires_approval}','false') WHERE operation='commerce.plans.list';r:=public.sandy_commerce_admit('commerce.plans.list','{}','{}',gen_random_uuid());PERFORM pg_temp.commerce_check('approval.sensitive_flag_drift_denied',r->>'http_status'='403',r);UPDATE public.sandy_operation_registry SET error_contract=jsonb_set(error_contract,'{requires_approval}','true') WHERE operation='commerce.plans.list';
 UPDATE public.sandy_operation_registry SET error_contract=jsonb_set(error_contract,'{api_key_delegable}','true') WHERE operation='commerce.plans.list';r:=public.sandy_commerce_admit('commerce.plans.list','{}','{}',gen_random_uuid());PERFORM pg_temp.commerce_check('approval.delegation_flag_drift_denied',r->>'http_status'='403',r);UPDATE public.sandy_operation_registry SET error_contract=jsonb_set(error_contract,'{api_key_delegable}','false') WHERE operation='commerce.plans.list';
 r:=public.sandy_api_verify_audit(current_setting('commerce.test.owner')::uuid,0,NULL,5000);PERFORM pg_temp.commerce_check('audit.hash_links_accept_normal_rollback_sequence_gaps',r->>'valid'='true',r);
 PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('commerce.test.actor'),'role','authenticated')::text,true);
 admission:=public.sandy_commerce_admit('commerce.accounts.list','{}','{}',gen_random_uuid(),'mcp');UPDATE public.sandy_operation_registry SET ai_exposed=false WHERE operation='commerce.accounts.list';r:=public.sandy_commerce_execute((admission->>'admission_id')::uuid,(admission->>'grant_id')::uuid,'{}','{}','mcp');PERFORM pg_temp.commerce_check('grant.current_mcp_exposure_rechecked',r->>'http_status'='409',r);UPDATE public.sandy_operation_registry SET ai_exposed=true WHERE operation='commerce.accounts.list';
 UPDATE public.sandy_operation_registry SET api_exposed=false WHERE operation='commerce.executions.get';r:=public.sandy_commerce_get_receipt(current_setting('commerce.test.request')::uuid);PERFORM pg_temp.commerce_check('receipt.closed_gate_enforced',r->>'http_status'='403',r);UPDATE public.sandy_operation_registry SET api_exposed=true WHERE operation='commerce.executions.get';
 UPDATE auth.users SET email_confirmed_at=NULL WHERE id=current_setting('commerce.test.actor')::uuid;r:=public.sandy_commerce_admit('commerce.accounts.list','{}','{}',gen_random_uuid());PERFORM pg_temp.commerce_check('identity.actual_confirmation_rechecked',r->>'http_status'='403',r);UPDATE auth.users SET email_confirmed_at=clock_timestamp() WHERE id=current_setting('commerce.test.actor')::uuid;
 UPDATE public.sandy_memory_portal_accounts SET revoked_at=clock_timestamp() WHERE auth_user_id=current_setting('commerce.test.actor')::uuid;r:=public.sandy_commerce_admit('commerce.accounts.list','{}','{}',gen_random_uuid());PERFORM pg_temp.commerce_check('identity.actual_portal_revocation_rechecked',r->>'http_status'='403',r);
 PERFORM pg_temp.commerce_check('audit.all_mutations_have_evidence',NOT EXISTS(SELECT 1 FROM public.sandy_commerce_effects e WHERE NOT EXISTS(SELECT 1 FROM public.sandy_product_mutation_evidence m WHERE m.admission_id=e.admission_id AND m.after_state IS NOT NULL)));
 PERFORM pg_temp.commerce_check('ledger.genuine_tenant_actor_not_owner',NOT EXISTS(SELECT 1 FROM public.sandy_api_execution_admissions a WHERE a.operation IN(SELECT operation FROM public.sandy_commerce_contracts) AND a.actor_id=current_setting('commerce.test.actor')::uuid AND(a.tenant_id IS DISTINCT FROM current_setting('commerce.test.customer')::uuid OR a.principal_kind<>'auth_user' OR a.customer_key_id IS NOT NULL OR a.credential_id IS NOT NULL)));
END $immutable_policy_rechecks$;

SELECT jsonb_build_object('kind','real_postgresql_component_full_rollback','http_auth_session',false,'external_provider_calls',false,'contracts',(SELECT count(*) FROM public.sandy_commerce_contracts),'checks',(SELECT count(*) FROM pg_temp.commerce_checks),'labels',(SELECT jsonb_agg(label ORDER BY label) FROM pg_temp.commerce_checks),'outputs',(SELECT jsonb_agg(payload ORDER BY label) FROM pg_temp.commerce_checks WHERE payload->>'ok'='true' AND payload ? 'operation')) AS evidence;
ROLLBACK;
