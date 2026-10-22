-- Existing temporal RPC behavior, not customer/session authentication.
-- Synthetic facts exist only inside this transaction. No triggers/providers,
-- customer identities, settings, grants or persistent schema are changed.
BEGIN;
SET LOCAL lock_timeout='2s';
SET LOCAL statement_timeout='15s';
CREATE TEMP TABLE p0_temporal_checks(name text PRIMARY KEY) ON COMMIT DROP;
CREATE FUNCTION pg_temp.p0_temporal_assert(p_name text,p_value boolean) RETURNS void
LANGUAGE plpgsql AS $$ BEGIN
 IF p_value IS DISTINCT FROM true THEN RAISE EXCEPTION 'temporal contract assertion failed: %',p_name;END IF;
 INSERT INTO p0_temporal_checks VALUES(p_name);
END $$;
SELECT pg_temp.p0_temporal_assert('no external or application trigger can observe fixtures',
 NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='public.sandy_temporal_facts'::regclass AND NOT tgisinternal));
SELECT pg_temp.p0_temporal_assert('public anonymous and user roles cannot call the service-only RPC',
 NOT has_function_privilege('anon','public.sandy_temporal_current(uuid,timestamp with time zone,integer)','EXECUTE') AND
 NOT has_function_privilege('authenticated','public.sandy_temporal_current(uuid,timestamp with time zone,integer)','EXECUTE'));
DO $$ DECLARE
 cid uuid:=gen_random_uuid();other_cid uuid:=gen_random_uuid();old_id uuid:=gen_random_uuid();correction_id uuid:=gen_random_uuid();
 rejected_old uuid:=gen_random_uuid();at_time timestamptz:='2026-10-21T12:00:00Z';
BEGIN
 IF EXISTS(SELECT 1 FROM public.sandy_temporal_facts WHERE customer_id IN(cid,other_cid)) THEN RAISE EXCEPTION 'synthetic customer collision';END IF;
 INSERT INTO public.sandy_temporal_facts(id,customer_id,subject_type,subject_id,predicate,value,state,source_channel,source_ref,recorded_at,observed_at)
 VALUES(old_id,cid,'person','fixture-one','preferred_language','"old-value"','confirmed','test','p0-temporal-contract:original',at_time-interval '2 days',at_time-interval '2 days'),
 (rejected_old,cid,'person','fixture-one','rejected_fact','"superseded-value"','confirmed','test','p0-temporal-contract:original',at_time-interval '2 days',at_time-interval '2 days');
 INSERT INTO public.sandy_temporal_facts(id,customer_id,subject_type,subject_id,predicate,value,state,source_channel,source_ref,recorded_at,observed_at,supersedes_id)
 VALUES(correction_id,cid,'person','fixture-one','preferred_language','"corrected-value"','confirmed','test','p0-temporal-contract:correction',at_time-interval '1 day',at_time-interval '1 day',old_id),
 (gen_random_uuid(),cid,'person','fixture-one','rejected_fact','"rejection-marker"','rejected','test','p0-temporal-contract:correction',at_time-interval '1 day',at_time-interval '1 day',rejected_old);
 INSERT INTO public.sandy_temporal_facts(customer_id,subject_type,subject_id,predicate,value,state,source_channel,source_ref,recorded_at,observed_at,review_status,valid_from,expires_at)
 VALUES(cid,'person','fixture-two','preferred_language','"other-subject-value"','confirmed','test','p0-temporal-contract',at_time-interval '1 day',at_time-interval '1 day','none',null,null),
 (cid,'person','fixture-one','inferred_fact','"inferred-value"','inferred','test','p0-temporal-contract',at_time-interval '1 day',at_time-interval '1 day','none',null,null),
 (cid,'person','fixture-one','pending_fact','"pending-value"','confirmed','test','p0-temporal-contract',at_time-interval '1 day',at_time-interval '1 day','pending',null,null),
 (cid,'person','fixture-one','future_fact','"future-value"','confirmed','test','p0-temporal-contract',at_time-interval '1 day',at_time-interval '1 day','none',at_time+interval '1 day',null),
 (cid,'person','fixture-one','expired_fact','"expired-value"','confirmed','test','p0-temporal-contract:original',at_time-interval '2 days',at_time-interval '2 days','none',null,at_time-interval '1 day'),
 (other_cid,'person','fixture-one','foreign_fact','"foreign-value"','confirmed','test','p0-temporal-contract',at_time-interval '1 day',at_time-interval '1 day','none',null,null);
 PERFORM pg_temp.p0_temporal_assert('current correction replaces the old fact',
  EXISTS(SELECT 1 FROM public.sandy_temporal_current(cid,at_time,40) WHERE id=correction_id) AND
  NOT EXISTS(SELECT 1 FROM public.sandy_temporal_current(cid,at_time,40) WHERE id=old_id));
 PERFORM pg_temp.p0_temporal_assert('recorded rejection does not resurrect an older assertion',
  NOT EXISTS(SELECT 1 FROM public.sandy_temporal_current(cid,at_time,40) WHERE predicate='rejected_fact'));
 PERFORM pg_temp.p0_temporal_assert('same predicate retains distinct subjects',
  (SELECT count(*)=2 FROM public.sandy_temporal_current(cid,at_time,40) WHERE predicate='preferred_language'));
 PERFORM pg_temp.p0_temporal_assert('projection retains inferred uncertainty',
  EXISTS(SELECT 1 FROM public.sandy_temporal_current(cid,at_time,40) WHERE predicate='inferred_fact' AND state='inferred'));
 PERFORM pg_temp.p0_temporal_assert('pending future and expired facts remain excluded',
  NOT EXISTS(SELECT 1 FROM public.sandy_temporal_current(cid,at_time,40) WHERE predicate IN('pending_fact','future_fact','expired_fact')));
 PERFORM pg_temp.p0_temporal_assert('RPC filters the requested customer',
  NOT EXISTS(SELECT 1 FROM public.sandy_temporal_current(cid,at_time,40) WHERE customer_id<>cid) AND
  (SELECT count(*)=1 FROM public.sandy_temporal_current(other_cid,at_time,40)));
 PERFORM pg_temp.p0_temporal_assert('historical projection preserves the then-current original',
  EXISTS(SELECT 1 FROM public.sandy_temporal_current(cid,at_time-interval '36 hours',40) WHERE id=old_id) AND
  NOT EXISTS(SELECT 1 FROM public.sandy_temporal_current(cid,at_time-interval '36 hours',40) WHERE id=correction_id));
 PERFORM pg_temp.p0_temporal_assert('read limit remains bounded',
  (SELECT count(*)=1 FROM public.sandy_temporal_current(cid,at_time,1)));
END $$;
SELECT 'database_contract_rollback' AS test_class,count(*) AS passed,jsonb_agg(name ORDER BY name) AS checks,
 false AS customer_auth_tested,false AS quality_acceptance_passed FROM p0_temporal_checks;
ROLLBACK;
