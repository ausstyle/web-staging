CREATE OR REPLACE FUNCTION public.sandy_api_customer_mutation(p_operation text, p_arguments jsonb, p_idempotency_key text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
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
END $function$
