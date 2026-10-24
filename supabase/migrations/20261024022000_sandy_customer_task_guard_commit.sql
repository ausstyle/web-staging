-- Execute the existing deferred guard while the canonical RPC still owns its
-- security context. No table grants, trigger authority or caller grants change.
BEGIN;
DO $patch$
DECLARE body text; definition text; anchor text := ' mutation_uuid:=gen_random_uuid();';
BEGIN
 SELECT prosrc,pg_get_functiondef(oid) INTO body,definition FROM pg_proc
 WHERE oid='public.sandy_api_customer_mutation(text,jsonb,text)'::regprocedure;
 IF encode(sha256(convert_to(body,'UTF8')),'hex') <> '2a06079d2ab9a630be5c28b126fb8526b12d6e17750c86500bd6cf7fb42a48db'
 OR (length(body)-length(replace(body,anchor,'')))/length(anchor) <> 1 THEN
  RAISE EXCEPTION 'reviewed canonical mutation preimage changed';
 END IF;
 IF NOT EXISTS (SELECT 1 FROM pg_trigger t JOIN pg_proc p ON p.oid=t.tgfoid
 WHERE t.tgrelid='public.sandy_tasks'::regclass AND t.tgname='sandy_agenda_task_company_check'
 AND t.tgdeferrable AND t.tginitdeferred AND t.tgenabled='O'
 AND p.oid='public.sandy_agenda_task_company_guard()'::regprocedure AND NOT p.prosecdef
 AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')='877199298ed083b4afe1a579fc366b1158c5517b7f748d1064d08e10e58e5cd5') THEN
  RAISE EXCEPTION 'reviewed deferred task guard changed';
 END IF;
 EXECUTE replace(definition,anchor,$replacement$
 -- PostgREST commits after this SECURITY DEFINER function returns. Flush only
 -- the existing task constraint before recording a receipt, while its reads
 -- retain this function's authority. Keep it immediate for this transaction;
 -- do not relax a caller's constraint mode or change the trigger default.
 IF area='tasks' THEN
  SET CONSTRAINTS public.sandy_agenda_task_company_check IMMEDIATE;
 END IF;
 mutation_uuid:=gen_random_uuid();$replacement$);
END $patch$;
COMMIT;
