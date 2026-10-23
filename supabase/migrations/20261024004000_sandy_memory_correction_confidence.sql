-- SANDY-ENG-0006: repair the existing invoker function; no new privilege,
-- memory store, consent, identity or correction path is introduced.
BEGIN;
SET LOCAL lock_timeout='2s';
SET LOCAL statement_timeout='15s';
DO $repair$
DECLARE
  target oid := 'sandy_private.correct_customer_fact(uuid,uuid,text)'::regprocedure;
  body text;
  definition text;
BEGIN
  SELECT p.prosrc,pg_get_functiondef(p.oid) INTO body,definition FROM pg_proc p WHERE p.oid=target;
  IF encode(sha256(convert_to(body,'UTF8')),'hex') <> '625992b76d2eedf3d8169f27902e18c39860157c961e0113714f98856ddf3f34' THEN
    RAISE EXCEPTION 'memory correction source changed; reconcile before release';
  END IF;
  IF has_function_privilege('anon',target,'EXECUTE') OR has_function_privilege('authenticated',target,'EXECUTE')
     OR NOT has_function_privilege('service_role',target,'EXECUTE')
     OR EXISTS(SELECT 1 FROM pg_proc p WHERE p.oid=target AND (p.prosecdef OR p.proconfig IS DISTINCT FROM ARRAY['search_path=""'])) THEN
    RAISE EXCEPTION 'memory correction privilege boundary changed';
  END IF;
  IF (length(body)-length(replace(body,'''high'',''active''','')))/length('''high'',''active''') <> 1 THEN
    RAISE EXCEPTION 'memory correction source anchor changed';
  END IF;
  -- CREATE OR REPLACE retains the existing function OID, owner and ACL. Explicit
  -- customer correction matches the table's existing explicit/inferred domain.
  EXECUTE replace(definition,'''high'',''active''','''explicit'',''active''');
END $repair$;
COMMIT;
