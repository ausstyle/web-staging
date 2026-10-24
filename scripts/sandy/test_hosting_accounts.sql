-- Isolated synthetic PostgreSQL fixture only. Never run against production.
INSERT INTO public.email_customers VALUES('10000000-0000-4000-8000-000000000001'),('20000000-0000-4000-8000-000000000002');
INSERT INTO auth.users(id,email,email_confirmed_at,is_anonymous) VALUES
 ('10000000-0000-4000-8000-000000000001','one@example.invalid',now(),false),
 ('20000000-0000-4000-8000-000000000002','two@example.invalid',now(),false);
INSERT INTO public.email_customer_addresses VALUES
 ('10000000-0000-4000-8000-000000000001','one@example.invalid',true),
 ('20000000-0000-4000-8000-000000000002','two@example.invalid',true);
INSERT INTO public.sandy_memory_portal_accounts(auth_user_id,customer_id) SELECT id,id FROM public.email_customers;
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.role','authenticated',false);
DO $$ DECLARE a jsonb;b jsonb;account_id text;args jsonb:='{"plan":"starter","idempotency_key":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"}';
BEGIN
 a:=public.sandy_hosting_account_execute('hosting.accounts.create',args,gen_random_uuid());
 IF a->>'error'<>'verified_customer_access_required' THEN RAISE EXCEPTION 'missing session accepted';END IF;
 PERFORM set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000001',false);
 a:=public.sandy_hosting_account_execute('hosting.accounts.create',args,gen_random_uuid());
 IF a->>'ok'<>'true' OR a->'result'->>'state'<>'logical_only' OR a->'result'->>'billing_activated'<>'false' OR a->'result'->>'provider_resources_created'<>'false' THEN RAISE EXCEPTION 'logical account creation failed: %',a;END IF;
 account_id:=a->'result'->>'account_id';
 b:=public.sandy_hosting_account_execute('hosting.accounts.create',args,gen_random_uuid());
 IF b->>'reused'<>'true' OR b->'result'->>'account_id'<>account_id OR b->>'request_id'=a->>'request_id' THEN RAISE EXCEPTION 'same-key replay failed';END IF;
 b:=public.sandy_hosting_account_execute('hosting.accounts.create',args||'{"plan":"business"}',gen_random_uuid());
 IF b->>'error'<>'request_id_conflict' THEN RAISE EXCEPTION 'changed-key payload accepted';END IF;
 b:=public.sandy_hosting_account_execute('hosting.accounts.create',args||'{"idempotency_key":"bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"}',gen_random_uuid());
 IF b->'result'->>'account_id'<>account_id OR b->>'reused'<>'true' THEN RAISE EXCEPTION 'second key duplicated account';END IF;
 b:=public.sandy_hosting_account_execute('hosting.accounts.create',args||'{"customer_id":"20000000-0000-4000-8000-000000000002"}',gen_random_uuid());
 IF b->>'error'<>'invalid_hosting_arguments' THEN RAISE EXCEPTION 'caller tenant accepted';END IF;
 b:=public.sandy_hosting_account_execute('hosting.accounts.create',args||'{"plan":"premium","idempotency_key":"cccccccc-cccc-4ccc-8ccc-cccccccccccc"}',gen_random_uuid());
 IF b->>'error'<>'hosting_account_plan_conflict' THEN RAISE EXCEPTION 'plan implicitly upgraded';END IF;
 b:=public.sandy_hosting_account_execute('hosting.accounts.get',jsonb_build_object('account_id',account_id),gen_random_uuid());
 IF b->'result'->>'account_id'<>account_id THEN RAISE EXCEPTION 'own get failed';END IF;
 PERFORM set_config('request.jwt.claim.sub','20000000-0000-4000-8000-000000000002',false);
 b:=public.sandy_hosting_account_execute('hosting.accounts.get',jsonb_build_object('account_id',account_id),gen_random_uuid());
 IF b->>'error'<>'hosting_account_not_found' THEN RAISE EXCEPTION 'cross tenant read';END IF;
 b:=public.sandy_hosting_account_execute('hosting.accounts.create',args,gen_random_uuid());
 IF b->>'ok'<>'true' OR b->'result'->>'account_id'=account_id THEN RAISE EXCEPTION 'tenant key collision';END IF;
 BEGIN PERFORM 1 FROM public.sandy_hosting_accounts; RAISE EXCEPTION 'direct table read allowed';EXCEPTION WHEN insufficient_privilege THEN NULL;END;
 RAISE NOTICE '10 identity/idempotency/ownership checks passed';
END $$;
RESET ROLE;
DO $$BEGIN
 IF (SELECT count(*) FROM public.sandy_hosting_accounts)<>2 THEN RAISE EXCEPTION 'duplicate accounts';END IF;
 IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid='public.sandy_hosting_accounts'::regclass) THEN RAISE EXCEPTION 'RLS absent';END IF;
 IF has_function_privilege('anon','public.sandy_hosting_account_execute(text,jsonb,uuid)','execute') OR has_function_privilege('service_role','public.sandy_hosting_account_execute(text,jsonb,uuid)','execute') THEN RAISE EXCEPTION 'non-customer role can call account RPC';END IF;
END $$;
-- Revocation and re-linking cannot recover a prior customer's receipt.
UPDATE public.sandy_memory_portal_accounts SET revoked_at=now() WHERE auth_user_id='10000000-0000-4000-8000-000000000001';
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000001',false);
DO $$DECLARE r jsonb;BEGIN
 r:=public.sandy_hosting_account_execute('hosting.accounts.create','{"plan":"starter","idempotency_key":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"}',gen_random_uuid());
 IF r->>'error'<>'verified_customer_access_required' THEN RAISE EXCEPTION 'revoked customer replay succeeded';END IF;
END $$;
RESET ROLE;
UPDATE public.sandy_memory_portal_accounts SET revoked_at=NULL,customer_id='20000000-0000-4000-8000-000000000002' WHERE auth_user_id='10000000-0000-4000-8000-000000000001';
UPDATE auth.users SET email='two@example.invalid' WHERE id='10000000-0000-4000-8000-000000000001';
SET ROLE authenticated;
DO $$DECLARE r jsonb;BEGIN
 r:=public.sandy_hosting_account_execute('hosting.accounts.create','{"plan":"starter","idempotency_key":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"}',gen_random_uuid());
 IF r->>'error'<>'request_id_conflict' THEN RAISE EXCEPTION 'relinked customer leaked old receipt';END IF;
END $$;
RESET ROLE;
-- Fault injection: event failure rolls back the account and receipt atomically.
INSERT INTO public.email_customers VALUES('30000000-0000-4000-8000-000000000003');
INSERT INTO auth.users(id,email,email_confirmed_at,is_anonymous) VALUES('30000000-0000-4000-8000-000000000003','three@example.invalid',now(),false);
INSERT INTO public.email_customer_addresses VALUES('30000000-0000-4000-8000-000000000003','three@example.invalid',true);
INSERT INTO public.sandy_memory_portal_accounts(auth_user_id,customer_id) VALUES('30000000-0000-4000-8000-000000000003','30000000-0000-4000-8000-000000000003');
CREATE FUNCTION public.hosting_test_fault() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN RAISE EXCEPTION 'injected audit failure';END $$;
CREATE TRIGGER hosting_test_fault BEFORE INSERT ON public.sandy_customer_provisioning_events FOR EACH ROW EXECUTE FUNCTION public.hosting_test_fault();
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','30000000-0000-4000-8000-000000000003',false);
DO $$BEGIN
 BEGIN
  PERFORM public.sandy_hosting_account_execute('hosting.accounts.create','{"plan":"starter","idempotency_key":"dddddddd-dddd-4ddd-8ddd-dddddddddddd"}',gen_random_uuid());
  RAISE EXCEPTION 'fault did not fire';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'injected audit failure' THEN RAISE;END IF;END;
END $$;
RESET ROLE;
DO $$BEGIN
 IF EXISTS(SELECT 1 FROM public.sandy_hosting_accounts WHERE customer_id='30000000-0000-4000-8000-000000000003') OR EXISTS(SELECT 1 FROM public.sandy_customer_provisioning_receipts WHERE actor_id='30000000-0000-4000-8000-000000000003') THEN RAISE EXCEPTION 'partial transaction committed';END IF;
 RAISE NOTICE '7 RLS/role/revocation/relink/atomicity checks passed';
END $$;

DO $$BEGIN
 IF (SELECT count(*) FROM public.sandy_operation_registry)<>2 OR EXISTS(SELECT 1 FROM public.sandy_operation_registry WHERE api_exposed OR ai_exposed OR ui_exposed OR verified OR implementation_state<>'awaiting_deployment') THEN RAISE EXCEPTION 'premature registry activation';END IF;
 RAISE NOTICE 'registry remains unexposed and unverified';
END $$;
