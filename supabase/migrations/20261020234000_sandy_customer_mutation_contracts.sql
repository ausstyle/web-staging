-- Shared customer mutation service. Uses the actual authenticated request JWT;
-- no caller-supplied actor/tenant, no service-role session substitution.
-- Existing task/business/audit/queue triggers remain enabled. Registry verification
-- gates remain closed for these previously unverified operations.
BEGIN;
DO $guard$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_constraint c WHERE c.conrelid='public.sandy_agenda_companies'::regclass
  AND c.contype IN ('p','u') AND (SELECT array_agg(a.attname ORDER BY x.ordinality)
  FROM unnest(c.conkey) WITH ORDINALITY x(attnum,ordinality)
  JOIN pg_attribute a ON a.attrelid=c.conrelid AND a.attnum=x.attnum)=ARRAY['id','customer_id']::name[]) THEN
  RAISE EXCEPTION 'Missing companies tenant uniqueness prerequisite';
 END IF;
 IF EXISTS(SELECT 1 FROM public.sandy_calendar_events e LEFT JOIN public.sandy_agenda_companies c
  ON c.id=e.company_id AND c.customer_id=e.customer_id WHERE e.company_id IS NOT NULL AND c.id IS NULL) THEN
  RAISE EXCEPTION 'Existing calendar company/tenant violations require reconciliation';
 END IF;
 IF to_regprocedure('extensions.digest(text,text)') IS NULL THEN RAISE EXCEPTION 'Missing pgcrypto prerequisite'; END IF;
END $guard$;
ALTER TABLE public.sandy_calendar_events ADD CONSTRAINT sandy_calendar_events_company_tenant_fk
 FOREIGN KEY(company_id,customer_id) REFERENCES public.sandy_agenda_companies(id,customer_id) NOT VALID;
ALTER TABLE public.sandy_calendar_events VALIDATE CONSTRAINT sandy_calendar_events_company_tenant_fk;

CREATE TABLE public.sandy_customer_mutation_receipts (
 mutation_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 customer_id uuid NOT NULL REFERENCES public.email_customers(id) ON DELETE CASCADE,
 auth_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
 operation text NOT NULL,
 idempotency_key text NOT NULL CHECK(idempotency_key ~ '^[A-Za-z0-9:_-]{12,128}$'),
 arguments_sha256 text NOT NULL CHECK(arguments_sha256 ~ '^[a-f0-9]{64}$'),
 result jsonb NOT NULL CHECK(jsonb_typeof(result)='object'),
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(customer_id,auth_user_id,operation,idempotency_key)
);
ALTER TABLE public.sandy_customer_mutation_receipts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.sandy_customer_mutation_receipts FROM PUBLIC,anon,authenticated,service_role;

-- Private resolver shared by trusted customer mutation services. Request identity
-- is taken from the authenticated JWT, then reconciled with Auth and the enabled
-- Agenda directory; neither an actor nor a customer can be supplied by a caller.
CREATE FUNCTION public.sandy_api_current_agenda_customer_id()
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $customer$
 SELECT a.customer_id FROM auth.users u
 JOIN public.sandy_agenda_access a ON a.email=lower(u.email) AND a.enabled=true
 WHERE u.id=auth.uid() AND auth.role()='authenticated'
$customer$;
REVOKE ALL ON FUNCTION public.sandy_api_current_agenda_customer_id() FROM PUBLIC,anon,authenticated,service_role;

-- Match JS trim + UTF-16 slice for the existing file backend, without issuing
-- provider work or allowing an invalid split-surrogate JSON value to be stored.
CREATE FUNCTION public.sandy_api_customer_text(p_text text,p_limit integer,p_trim boolean)
RETURNS text LANGUAGE plpgsql IMMUTABLE STRICT SET search_path=pg_catalog,pg_temp AS $text$
DECLARE source text:=p_text; letter text; result text:=''; units integer:=0; width integer;
BEGIN
 IF p_trim THEN source:=btrim(source,U&'\0009\000A\000B\000C\000D\0020\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF'); END IF;
 FOR letter IN SELECT regexp_split_to_table(source,'') LOOP
  width:=CASE WHEN ascii(letter)>65535 THEN 2 ELSE 1 END;
  IF units+width>p_limit THEN
   IF units<p_limit THEN RAISE EXCEPTION 'Invalid UTF-16 slice boundary' USING ERRCODE='22023'; END IF;
   EXIT;
  END IF;
  result:=result||letter; units:=units+width;
 END LOOP;
 RETURN result;
END $text$;
REVOKE ALL ON FUNCTION public.sandy_api_customer_text(text,integer,boolean) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.sandy_api_customer_mutation(p_operation text,p_arguments jsonb,p_idempotency_key text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $mutation$
DECLARE
 actor uuid; tenant uuid; area text; action text;
 target_table text; owner_column text; allowed text[]; fields jsonb; item jsonb;
 existing_receipt public.sandy_customer_mutation_receipts%ROWTYPE;
 digest text; mutation_uuid uuid; columns_sql text; updates_sql text; k text; v jsonb;
 existing_task public.sandy_tasks%ROWTYPE; existing_calendar public.sandy_calendar_events%ROWTYPE; effective_start timestamptz; effective_end timestamptz;
 company uuid; category uuid; parent uuid; message text;
BEGIN
 actor:=auth.uid();
 IF actor IS NULL OR auth.role() IS DISTINCT FROM 'authenticated' THEN
  RETURN jsonb_build_object('ok',false,'error','customer_session_required','http_status',401);
 END IF;
 tenant:=public.sandy_api_current_agenda_customer_id();
 IF tenant IS NULL THEN RETURN jsonb_build_object('ok',false,'error','customer_access_required','http_status',403); END IF;
 IF p_operation IS NULL OR p_operation NOT IN ('tasks.create','tasks.update','tasks.complete','tasks.archive','calendar.create','calendar.update','calendar.cancel','files.rename','files.set_description','files.archive')
  OR jsonb_typeof(p_arguments) IS DISTINCT FROM 'object' OR p_idempotency_key IS NULL
  OR p_idempotency_key !~ '^[A-Za-z0-9:_-]{12,128}$' THEN
  RETURN jsonb_build_object('ok',false,'error','invalid_customer_mutation_arguments','http_status',400);
 END IF;
 area:=split_part(p_operation,'.',1); action:=split_part(p_operation,'.',2);
 IF NOT EXISTS(SELECT 1 FROM public.sandy_operation_registry WHERE operation=p_operation
  AND handler='sandy-operations-api' AND permission_scope=area||':write' AND is_mutation=true
  AND api_exposed=true AND verified=true) THEN
  RETURN jsonb_build_object('ok',false,'error','operation_requires_live_verification','http_status',424);
 END IF;
 IF area='tasks' THEN
  target_table:='public.sandy_tasks'; owner_column:='customer_id';
  allowed:=CASE WHEN action IN ('complete','archive') THEN ARRAY['id'] ELSE
   ARRAY['title','details','status','priority','due_at','start_at','next_review_at','parent_task_id','company_id','category_id','position']||CASE WHEN action='update' THEN ARRAY['id'] ELSE ARRAY[]::text[] END END;
 ELSIF area='calendar' THEN
  target_table:='public.sandy_calendar_events'; owner_column:='customer_id';
  allowed:=CASE WHEN action='cancel' THEN ARRAY['id'] ELSE
   ARRAY['title','description','starts_at','ends_at','timezone','all_day','location','status','company_id']||CASE WHEN action='update' THEN ARRAY['id'] ELSE ARRAY[]::text[] END END;
 ELSE
  target_table:='public.sandy_universal_files'; owner_column:='owner_customer_id';
  allowed:=CASE WHEN action='rename' THEN ARRAY['id','name'] WHEN action='set_description' THEN ARRAY['id','description'] ELSE ARRAY['id'] END;
 END IF;
 IF EXISTS(SELECT 1 FROM jsonb_object_keys(p_arguments) AS field(key) WHERE NOT key=ANY(allowed))
  OR (action<>'create' AND (coalesce(p_arguments->>'id','') !~* '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$'))
  OR (action='create' AND (jsonb_typeof(p_arguments->'title') IS DISTINCT FROM 'string' OR length(btrim(p_arguments->>'title'))=0))
  OR (action='update' AND (SELECT count(*) FROM jsonb_object_keys(p_arguments))<2) THEN
  RETURN jsonb_build_object('ok',false,'error','invalid_customer_mutation_arguments','http_status',400);
 END IF;
 FOR k,v IN SELECT key,value FROM jsonb_each(p_arguments) LOOP
  IF k IN ('starts_at','ends_at','due_at','start_at','next_review_at') AND jsonb_typeof(v)='string' AND (v#>>'{}') !~* '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}([.][0-9]+)?(Z|[+-][0-9]{2}:[0-9]{2})$' THEN
   RETURN jsonb_build_object('ok',false,'error','invalid_customer_mutation_arguments','http_status',400);
  END IF;
  IF (k IN ('id','title','details','status','priority','timezone','starts_at','name') AND jsonb_typeof(v)<>'string')
   OR (k IN ('description','location','ends_at','due_at','start_at','next_review_at','parent_task_id','company_id','category_id') AND jsonb_typeof(v) NOT IN ('string','null'))
   OR (k='all_day' AND jsonb_typeof(v)<>'boolean') OR (k='position' AND (jsonb_typeof(v)<>'number' OR (v#>>'{}') !~ '^-?[0-9]+$')) THEN
   RETURN jsonb_build_object('ok',false,'error','invalid_customer_mutation_arguments','http_status',400);
  END IF;
 END LOOP;
 IF area='tasks' AND p_arguments ? 'title' AND (length(p_arguments->>'title')>240 OR length(btrim(p_arguments->>'title'))=0) THEN
  RETURN jsonb_build_object('ok',false,'error','Invalid title','http_status',400);
 END IF;
 IF area='calendar' AND p_arguments ? 'title' AND length(btrim(p_arguments->>'title'))=0 THEN
  RETURN jsonb_build_object('ok',false,'error','Invalid title','http_status',400);
 END IF;
 IF area='calendar' AND action='create' AND (p_arguments->>'starts_at' IS NULL OR p_arguments->>'ends_at' IS NULL) THEN
  RETURN jsonb_build_object('ok',false,'error','title, starts_at and ends_at required','http_status',400);
 END IF;
 -- Serialize this shared service's mutations for one customer, including different
 -- idempotency keys. Existing database constraints remain authoritative for other
 -- writers; a unique receipt plus rollback also prevents duplicate effects.
 PERFORM pg_advisory_xact_lock(hashtextextended('sandy_customer_mutation:'||tenant::text,0));
 digest:=encode(extensions.digest(jsonb_build_object('operation',p_operation,'arguments',p_arguments)::text,'sha256'),'hex');
 SELECT * INTO existing_receipt FROM public.sandy_customer_mutation_receipts
  WHERE customer_id=tenant AND auth_user_id=actor AND operation=p_operation AND idempotency_key=p_idempotency_key FOR UPDATE;
 IF FOUND THEN
  IF existing_receipt.arguments_sha256<>digest THEN RETURN jsonb_build_object('ok',false,'error','idempotency_key_conflict','http_status',409); END IF;
  RETURN existing_receipt.result||jsonb_build_object('reused',true);
 END IF;
 IF area='tasks' AND action<>'create' THEN
  SELECT * INTO existing_task FROM public.sandy_tasks WHERE id=(p_arguments->>'id')::uuid AND customer_id=tenant AND archived_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'error','customer_item_not_found','http_status',404); END IF;
 END IF;
 fields:=p_arguments-'id';
 IF area='tasks' THEN
  IF action='complete' THEN fields:=jsonb_build_object('status','completed','completed_at',now()); END IF;
  IF action='archive' THEN fields:=jsonb_build_object('archived_at',now()); END IF;
 ELSIF area='calendar' THEN
  IF action='cancel' THEN fields:=jsonb_build_object('status','cancelled'); END IF;
 ELSE
  IF action='rename' THEN
   fields:=jsonb_build_object('display_name',public.sandy_api_customer_text(coalesce(p_arguments->>'name',''),250,true));
   IF fields->>'display_name'='' THEN RETURN jsonb_build_object('ok',false,'error','Name required','http_status',400); END IF;
  ELSIF action='set_description' THEN fields:=jsonb_build_object('description',public.sandy_api_customer_text(coalesce(p_arguments->>'description',''),4000,false));
  ELSE fields:=jsonb_build_object('library_state','archived','library_state_changed_at',now()); END IF;
 END IF;
 IF action='create' THEN fields:=fields||jsonb_build_object(owner_column,tenant); END IF;
 IF area='tasks' THEN
  parent:=CASE WHEN fields ? 'parent_task_id' THEN (fields->>'parent_task_id')::uuid ELSE existing_task.parent_task_id END;
  company:=CASE WHEN fields ? 'company_id' THEN (fields->>'company_id')::uuid ELSE existing_task.company_id END;
  category:=CASE WHEN fields ? 'category_id' THEN (fields->>'category_id')::uuid ELSE existing_task.category_id END;
  IF parent IS NOT NULL THEN
   PERFORM id FROM public.sandy_tasks WHERE id=parent AND customer_id=tenant FOR SHARE;
   IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'error','Parent task inaccessible','http_status',403); END IF;
  END IF;
  IF company IS NOT NULL THEN
   PERFORM id FROM public.sandy_agenda_companies WHERE id=company AND customer_id=tenant FOR KEY SHARE;
   IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'error','Company inaccessible','http_status',403); END IF;
  END IF;
  IF category IS NOT NULL THEN
   PERFORM id FROM public.sandy_agenda_categories WHERE id=category AND customer_id=tenant AND company_id IS NOT DISTINCT FROM company FOR KEY SHARE;
   IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'error','Category does not belong to this workspace','http_status',403); END IF;
  END IF;
 END IF;
 -- Calendar's composite FK makes company ownership atomic. Lock the current event
 -- to validate a partial date update against its actual other endpoint.
 IF area='calendar' THEN
  IF action<>'create' THEN
   SELECT * INTO existing_calendar FROM public.sandy_calendar_events WHERE id=(p_arguments->>'id')::uuid AND customer_id=tenant FOR UPDATE;
   IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'error','customer_item_not_found','http_status',404); END IF;
  END IF;
  effective_start:=CASE WHEN fields ? 'starts_at' THEN (fields->>'starts_at')::timestamptz ELSE existing_calendar.starts_at END;
  effective_end:=CASE WHEN fields ? 'ends_at' THEN (fields->>'ends_at')::timestamptz ELSE existing_calendar.ends_at END;
  IF effective_end IS NOT NULL AND effective_end<=effective_start THEN RETURN jsonb_build_object('ok',false,'error','Event end must follow start','http_status',400); END IF;
 END IF;
 -- All identifiers below are fixed table/owner choices or keys from a closed
 -- allowlist. Values are parameters passed to jsonb_populate_record, never SQL.
 SELECT string_agg(format('%I',key),',' ORDER BY key),string_agg(format('%1$I=incoming.%1$I',key),',' ORDER BY key)
  INTO columns_sql,updates_sql FROM jsonb_object_keys(fields) AS field(key);
 IF columns_sql IS NULL THEN RETURN jsonb_build_object('ok',false,'error','No valid fields','http_status',400); END IF;
 IF action='create' THEN
  EXECUTE format('INSERT INTO %1$s AS target (%2$s) SELECT %2$s FROM jsonb_populate_record(NULL::%1$s,$1) AS incoming RETURNING to_jsonb(target.*)',target_table,columns_sql)
   INTO item USING fields;
 ELSE
  EXECUTE format('UPDATE %1$s AS target SET %2$s FROM jsonb_populate_record(NULL::%1$s,$1) AS incoming WHERE target.%3$I=$2 AND target.id=$3 %4$s RETURNING to_jsonb(target.*)',
   target_table,updates_sql,owner_column,CASE WHEN area='tasks' THEN 'AND target.archived_at IS NULL' ELSE '' END)
   INTO item USING fields,tenant,(p_arguments->>'id')::uuid;
 END IF;
 IF item IS NULL THEN RETURN jsonb_build_object('ok',false,'error','customer_item_not_found','http_status',404); END IF;
 mutation_uuid:=gen_random_uuid();
 item:=jsonb_build_object('ok',true,'contract_version','1.0.0','operation',p_operation,'mutation_id',mutation_uuid,'reused',false,'item',item);
 INSERT INTO public.sandy_customer_mutation_receipts(mutation_id,customer_id,auth_user_id,operation,idempotency_key,arguments_sha256,result)
  VALUES(mutation_uuid,tenant,actor,p_operation,p_idempotency_key,digest,item);
 RETURN item;
EXCEPTION
 WHEN foreign_key_violation THEN RETURN jsonb_build_object('ok',false,'error','customer_reference_inaccessible','http_status',403);
 WHEN unique_violation THEN RETURN jsonb_build_object('ok',false,'error','idempotency_or_record_conflict','http_status',409);
 WHEN check_violation OR not_null_violation OR data_exception THEN RETURN jsonb_build_object('ok',false,'error','invalid_customer_mutation_arguments','http_status',400);
 WHEN raise_exception THEN
  GET STACKED DIAGNOSTICS message=MESSAGE_TEXT;
  IF message=ANY(ARRAY['Parent task must belong to your Sandy account','Company must belong to your Sandy account','Category does not belong to this workspace','Task ownership is immutable','Invalid parent or task nesting exceeds five levels','Cannot create a task cycle','Reopen the parent before reopening a subtask','Complete or cancel subtasks before completing parent','Review the Sandy draft in Missions before completing this task']) THEN
   RETURN jsonb_build_object('ok',false,'error',message,'http_status',409);
  END IF;
  RETURN jsonb_build_object('ok',false,'error','customer_mutation_transaction_failed','http_status',503,'reconciliation_required',true);
 WHEN OTHERS THEN RETURN jsonb_build_object('ok',false,'error','customer_mutation_transaction_failed','http_status',503,'reconciliation_required',true);
END $mutation$;
REVOKE ALL ON FUNCTION public.sandy_api_customer_mutation(text,jsonb,text) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.sandy_api_customer_mutation(text,jsonb,text) TO authenticated;

-- Guard exact observed broad contracts before versioning them. Existing flags and
-- test/deployment evidence are preserved; no operation is marked verified here.
DO $registry_guard$
BEGIN
 PERFORM operation FROM public.sandy_operation_registry WHERE operation IN ('tasks.create','tasks.update','tasks.complete','tasks.archive','calendar.create','calendar.update','calendar.cancel','files.rename','files.set_description','files.archive') FOR UPDATE;
 IF (SELECT count(*) FROM public.sandy_operation_registry WHERE operation IN ('tasks.create','tasks.update','tasks.complete','tasks.archive','calendar.create','calendar.update','calendar.cancel','files.rename','files.set_description','files.archive')
  AND handler='sandy-operations-api' AND is_mutation=true
  AND permission_scope=split_part(operation,'.',1)||':write'
  AND input_schema='{}'::jsonb AND output_schema='{}'::jsonb
  AND description IS NULL AND error_contract='{}'::jsonb) <> 10 THEN
  RAISE EXCEPTION 'Customer mutation contract drift; inspect before applying';
 END IF;
END $registry_guard$;
WITH contracts(operation,description,input_schema,output_schema) AS (VALUES
 ('tasks.create','Tenant-scoped tasks.create through the shared actual-session transaction and stable idempotency receipt. Contract v1.0.0; task triggers remain active; verification and approval gates remain required.','{"type":"object","properties":{"title":{"type":"string","minLength":1,"maxLength":240},"details":{"type":"string"},"status":{"type":"string","enum":["todo","in_progress","waiting","blocked","completed","cancelled"]},"priority":{"type":"string","enum":["low","normal","high","urgent"]},"due_at":{"type":["string","null"],"format":"date-time"},"start_at":{"type":["string","null"],"format":"date-time"},"next_review_at":{"type":["string","null"],"format":"date-time"},"parent_task_id":{"type":["string","null"],"format":"uuid"},"company_id":{"type":["string","null"],"format":"uuid"},"category_id":{"type":["string","null"],"format":"uuid"},"position":{"type":"integer","minimum":-2147483648,"maximum":2147483647},"idempotency_key":{"type":"string","minLength":12,"maxLength":128,"pattern":"^[A-Za-z0-9:_-]+$"}},"required":["title","idempotency_key"],"additionalProperties":false}'::jsonb,'{"type":"object","required":["ok","contract_version","operation","mutation_id","reused","item"],"properties":{"ok":{"const":true},"contract_version":{"const":"1.0.0"},"operation":{"const":"tasks.create"},"mutation_id":{"type":"string","format":"uuid"},"reused":{"type":"boolean"},"item":{"type":"object","properties":{"id":{"type":"string","format":"uuid"},"customer_id":{"type":"string","format":"uuid"},"title":{"type":"string","minLength":1,"maxLength":240},"status":{"type":"string","enum":["todo","in_progress","waiting","blocked","completed","cancelled"]},"priority":{"type":"string","enum":["low","normal","high","urgent"]},"version":{"type":"integer","minimum":1}},"required":["id","customer_id","title","status","priority","version"],"additionalProperties":true}},"additionalProperties":false}'::jsonb),
 ('tasks.update','Tenant-scoped tasks.update through the shared actual-session transaction and stable idempotency receipt. Contract v1.0.0; task triggers remain active; verification and approval gates remain required.','{"type":"object","properties":{"id":{"type":"string","format":"uuid"},"title":{"type":"string","minLength":1,"maxLength":240},"details":{"type":"string"},"status":{"type":"string","enum":["todo","in_progress","waiting","blocked","completed","cancelled"]},"priority":{"type":"string","enum":["low","normal","high","urgent"]},"due_at":{"type":["string","null"],"format":"date-time"},"start_at":{"type":["string","null"],"format":"date-time"},"next_review_at":{"type":["string","null"],"format":"date-time"},"parent_task_id":{"type":["string","null"],"format":"uuid"},"company_id":{"type":["string","null"],"format":"uuid"},"category_id":{"type":["string","null"],"format":"uuid"},"position":{"type":"integer","minimum":-2147483648,"maximum":2147483647},"idempotency_key":{"type":"string","minLength":12,"maxLength":128,"pattern":"^[A-Za-z0-9:_-]+$"}},"required":["id","idempotency_key"],"additionalProperties":false,"minProperties":3}'::jsonb,'{"type":"object","required":["ok","contract_version","operation","mutation_id","reused","item"],"properties":{"ok":{"const":true},"contract_version":{"const":"1.0.0"},"operation":{"const":"tasks.update"},"mutation_id":{"type":"string","format":"uuid"},"reused":{"type":"boolean"},"item":{"type":"object","properties":{"id":{"type":"string","format":"uuid"},"customer_id":{"type":"string","format":"uuid"},"title":{"type":"string","minLength":1,"maxLength":240},"status":{"type":"string","enum":["todo","in_progress","waiting","blocked","completed","cancelled"]},"priority":{"type":"string","enum":["low","normal","high","urgent"]},"version":{"type":"integer","minimum":1}},"required":["id","customer_id","title","status","priority","version"],"additionalProperties":true}},"additionalProperties":false}'::jsonb),
 ('tasks.complete','Tenant-scoped tasks.complete through the shared actual-session transaction and stable idempotency receipt. Contract v1.0.0; task triggers remain active; verification and approval gates remain required.','{"type":"object","properties":{"id":{"type":"string","format":"uuid"},"idempotency_key":{"type":"string","minLength":12,"maxLength":128,"pattern":"^[A-Za-z0-9:_-]+$"}},"required":["id","idempotency_key"],"additionalProperties":false}'::jsonb,'{"type":"object","required":["ok","contract_version","operation","mutation_id","reused","item"],"properties":{"ok":{"const":true},"contract_version":{"const":"1.0.0"},"operation":{"const":"tasks.complete"},"mutation_id":{"type":"string","format":"uuid"},"reused":{"type":"boolean"},"item":{"type":"object","properties":{"id":{"type":"string","format":"uuid"},"customer_id":{"type":"string","format":"uuid"},"title":{"type":"string","minLength":1,"maxLength":240},"status":{"const":"completed"},"priority":{"type":"string","enum":["low","normal","high","urgent"]},"version":{"type":"integer","minimum":1},"completed_at":{"type":"string","format":"date-time"}},"required":["id","customer_id","title","status","priority","version","completed_at"],"additionalProperties":true}},"additionalProperties":false}'::jsonb),
 ('tasks.archive','Tenant-scoped tasks.archive through the shared actual-session transaction and stable idempotency receipt. Contract v1.0.0; task triggers remain active; verification and approval gates remain required.','{"type":"object","properties":{"id":{"type":"string","format":"uuid"},"idempotency_key":{"type":"string","minLength":12,"maxLength":128,"pattern":"^[A-Za-z0-9:_-]+$"}},"required":["id","idempotency_key"],"additionalProperties":false}'::jsonb,'{"type":"object","required":["ok","contract_version","operation","mutation_id","reused","item"],"properties":{"ok":{"const":true},"contract_version":{"const":"1.0.0"},"operation":{"const":"tasks.archive"},"mutation_id":{"type":"string","format":"uuid"},"reused":{"type":"boolean"},"item":{"type":"object","properties":{"id":{"type":"string","format":"uuid"},"customer_id":{"type":"string","format":"uuid"},"title":{"type":"string","minLength":1,"maxLength":240},"status":{"type":"string","enum":["todo","in_progress","waiting","blocked","completed","cancelled"]},"priority":{"type":"string","enum":["low","normal","high","urgent"]},"version":{"type":"integer","minimum":1},"archived_at":{"type":"string","format":"date-time"}},"required":["id","customer_id","title","status","priority","version","archived_at"],"additionalProperties":true}},"additionalProperties":false}'::jsonb),
 ('calendar.create','Tenant-scoped calendar.create through the shared actual-session transaction and stable idempotency receipt. Contract v1.0.0; task triggers remain active; verification and approval gates remain required.','{"type":"object","properties":{"title":{"type":"string","minLength":1},"description":{"type":["string","null"]},"starts_at":{"type":"string","format":"date-time"},"ends_at":{"type":"string","format":"date-time"},"timezone":{"type":"string","minLength":1},"all_day":{"type":"boolean"},"location":{"type":["string","null"]},"status":{"type":"string","enum":["confirmed","tentative","cancelled"]},"company_id":{"type":["string","null"],"format":"uuid"},"idempotency_key":{"type":"string","minLength":12,"maxLength":128,"pattern":"^[A-Za-z0-9:_-]+$"}},"required":["title","starts_at","ends_at","idempotency_key"],"additionalProperties":false}'::jsonb,'{"type":"object","required":["ok","contract_version","operation","mutation_id","reused","item"],"properties":{"ok":{"const":true},"contract_version":{"const":"1.0.0"},"operation":{"const":"calendar.create"},"mutation_id":{"type":"string","format":"uuid"},"reused":{"type":"boolean"},"item":{"type":"object","properties":{"id":{"type":"string","format":"uuid"},"customer_id":{"type":"string","format":"uuid"},"title":{"type":"string","minLength":1},"starts_at":{"type":"string","format":"date-time"},"ends_at":{"type":["string","null"],"format":"date-time"},"status":{"type":"string","enum":["confirmed","tentative","cancelled"]}},"required":["id","customer_id","title","starts_at","ends_at","status"],"additionalProperties":true}},"additionalProperties":false}'::jsonb),
 ('calendar.update','Tenant-scoped calendar.update through the shared actual-session transaction and stable idempotency receipt. Contract v1.0.0; task triggers remain active; verification and approval gates remain required.','{"type":"object","properties":{"id":{"type":"string","format":"uuid"},"title":{"type":"string","minLength":1},"description":{"type":["string","null"]},"starts_at":{"type":"string","format":"date-time"},"ends_at":{"type":["string","null"],"format":"date-time"},"timezone":{"type":"string","minLength":1},"all_day":{"type":"boolean"},"location":{"type":["string","null"]},"status":{"type":"string","enum":["confirmed","tentative","cancelled"]},"company_id":{"type":["string","null"],"format":"uuid"},"idempotency_key":{"type":"string","minLength":12,"maxLength":128,"pattern":"^[A-Za-z0-9:_-]+$"}},"required":["id","idempotency_key"],"additionalProperties":false,"minProperties":3}'::jsonb,'{"type":"object","required":["ok","contract_version","operation","mutation_id","reused","item"],"properties":{"ok":{"const":true},"contract_version":{"const":"1.0.0"},"operation":{"const":"calendar.update"},"mutation_id":{"type":"string","format":"uuid"},"reused":{"type":"boolean"},"item":{"type":"object","properties":{"id":{"type":"string","format":"uuid"},"customer_id":{"type":"string","format":"uuid"},"title":{"type":"string","minLength":1},"starts_at":{"type":"string","format":"date-time"},"ends_at":{"type":["string","null"],"format":"date-time"},"status":{"type":"string","enum":["confirmed","tentative","cancelled"]}},"required":["id","customer_id","title","starts_at","ends_at","status"],"additionalProperties":true}},"additionalProperties":false}'::jsonb),
 ('calendar.cancel','Tenant-scoped calendar.cancel through the shared actual-session transaction and stable idempotency receipt. Contract v1.0.0; task triggers remain active; verification and approval gates remain required.','{"type":"object","properties":{"id":{"type":"string","format":"uuid"},"idempotency_key":{"type":"string","minLength":12,"maxLength":128,"pattern":"^[A-Za-z0-9:_-]+$"}},"required":["id","idempotency_key"],"additionalProperties":false}'::jsonb,'{"type":"object","required":["ok","contract_version","operation","mutation_id","reused","item"],"properties":{"ok":{"const":true},"contract_version":{"const":"1.0.0"},"operation":{"const":"calendar.cancel"},"mutation_id":{"type":"string","format":"uuid"},"reused":{"type":"boolean"},"item":{"type":"object","properties":{"id":{"type":"string","format":"uuid"},"customer_id":{"type":"string","format":"uuid"},"title":{"type":"string","minLength":1},"starts_at":{"type":"string","format":"date-time"},"ends_at":{"type":["string","null"],"format":"date-time"},"status":{"const":"cancelled"}},"required":["id","customer_id","title","starts_at","ends_at","status"],"additionalProperties":true}},"additionalProperties":false}'::jsonb),
 ('files.rename','Tenant-scoped files.rename through the shared actual-session transaction and stable idempotency receipt. Contract v1.0.0; task triggers remain active; verification and approval gates remain required.','{"type":"object","properties":{"id":{"type":"string","format":"uuid"},"name":{"type":"string","minLength":1},"idempotency_key":{"type":"string","minLength":12,"maxLength":128,"pattern":"^[A-Za-z0-9:_-]+$"}},"required":["id","name","idempotency_key"],"additionalProperties":false}'::jsonb,'{"type":"object","required":["ok","contract_version","operation","mutation_id","reused","item"],"properties":{"ok":{"const":true},"contract_version":{"const":"1.0.0"},"operation":{"const":"files.rename"},"mutation_id":{"type":"string","format":"uuid"},"reused":{"type":"boolean"},"item":{"type":"object","properties":{"id":{"type":"string","format":"uuid"},"owner_customer_id":{"type":"string","format":"uuid"},"display_name":{"type":"string","minLength":1,"maxLength":250}},"required":["id","owner_customer_id","display_name"],"additionalProperties":true}},"additionalProperties":false}'::jsonb),
 ('files.set_description','Tenant-scoped files.set_description through the shared actual-session transaction and stable idempotency receipt. Contract v1.0.0; task triggers remain active; verification and approval gates remain required.','{"type":"object","properties":{"id":{"type":"string","format":"uuid"},"description":{"type":["string","null"]},"idempotency_key":{"type":"string","minLength":12,"maxLength":128,"pattern":"^[A-Za-z0-9:_-]+$"}},"required":["id","idempotency_key"],"additionalProperties":false}'::jsonb,'{"type":"object","required":["ok","contract_version","operation","mutation_id","reused","item"],"properties":{"ok":{"const":true},"contract_version":{"const":"1.0.0"},"operation":{"const":"files.set_description"},"mutation_id":{"type":"string","format":"uuid"},"reused":{"type":"boolean"},"item":{"type":"object","properties":{"id":{"type":"string","format":"uuid"},"owner_customer_id":{"type":"string","format":"uuid"},"description":{"type":"string"}},"required":["id","owner_customer_id","description"],"additionalProperties":true}},"additionalProperties":false}'::jsonb),
 ('files.archive','Tenant-scoped files.archive through the shared actual-session transaction and stable idempotency receipt. Contract v1.0.0; task triggers remain active; verification and approval gates remain required.','{"type":"object","properties":{"id":{"type":"string","format":"uuid"},"idempotency_key":{"type":"string","minLength":12,"maxLength":128,"pattern":"^[A-Za-z0-9:_-]+$"}},"required":["id","idempotency_key"],"additionalProperties":false}'::jsonb,'{"type":"object","required":["ok","contract_version","operation","mutation_id","reused","item"],"properties":{"ok":{"const":true},"contract_version":{"const":"1.0.0"},"operation":{"const":"files.archive"},"mutation_id":{"type":"string","format":"uuid"},"reused":{"type":"boolean"},"item":{"type":"object","properties":{"id":{"type":"string","format":"uuid"},"owner_customer_id":{"type":"string","format":"uuid"},"library_state":{"const":"archived"},"library_state_changed_at":{"type":"string","format":"date-time"}},"required":["id","owner_customer_id","library_state","library_state_changed_at"],"additionalProperties":true}},"additionalProperties":false}'::jsonb)
)
UPDATE public.sandy_operation_registry r SET description=c.description,input_schema=c.input_schema,output_schema=c.output_schema,error_contract='{"version":"1.0.0","authentication":"actual_authenticated_user_session_and_enabled_customer_directory","atomic_idempotency":"canonical_shared_rpc_only","legacy_v6_direct_endpoint_atomic_idempotency":false,"idempotency_scope":["auth_user_id","customer_id","operation","idempotency_key","request_arguments_sha256"],"replay":"same_key_and_arguments_returns_original_receipt_without_trigger_reexecution","key_conflict":"idempotency_key_conflict","response_loss":"customer_mutation_outcome_unknown","response_loss_execution_state":"unknown","response_loss_retry":"same_idempotency_key_only","calendar_company_tenancy":"composite_foreign_key","task_guards":"existing_database_triggers_retained","fixture_warning":"task_creation_and_title_updates_can_enqueue_analysis; no live customer/task fixtures were created","verification":"required_by_gateway_and_rpc; migration_preserves_all_flags"}'::jsonb,updated_at=now()
FROM contracts c WHERE r.operation=c.operation;
COMMIT;
