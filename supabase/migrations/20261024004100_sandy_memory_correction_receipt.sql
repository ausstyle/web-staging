-- SANDY-ENG-0006 canonical correction; reuse the existing actual-session
-- mutation receipt transaction and the original Memory Centre business action.
BEGIN;
SET LOCAL lock_timeout='2s';
SET LOCAL statement_timeout='15s';
DO $install$
DECLARE target oid:='public.sandy_api_customer_mutation(text,jsonb,text)'::regprocedure; definition text; body text;
BEGIN
 SELECT prosrc,pg_get_functiondef(oid) INTO body,definition FROM pg_proc WHERE oid=target;
 IF encode(sha256(convert_to(body,'UTF8')),'hex')<>'8113c2c2b53c21933a6ba6140c5d742798e79509bdf1d14c5fa6e115a81ec95d' THEN RAISE EXCEPTION 'shared customer mutation source changed';END IF;
 IF encode(sha256(convert_to((SELECT prosrc FROM pg_proc WHERE oid='sandy_private.correct_customer_fact(uuid,uuid,text)'::regprocedure),'UTF8')),'hex')<>'55580a2e2c228ab373a65659d5304da42e36d2425a577eb90bc537f294f84b50' THEN RAISE EXCEPTION 'verified original correction prerequisite missing';END IF;
 IF NOT (SELECT prosecdef AND proconfig=ARRAY['search_path=pg_catalog, pg_temp'] FROM pg_proc WHERE oid=target)
  OR has_function_privilege('anon',target,'EXECUTE') OR has_function_privilege('service_role',target,'EXECUTE') OR NOT has_function_privilege('authenticated',target,'EXECUTE') THEN RAISE EXCEPTION 'shared mutation actual-user boundary changed';END IF;
 EXECUTE replace(definition,body,$candidate$
DECLARE
 actor uuid; tenant uuid; area text; action text;
 target_table text; owner_column text; allowed text[]; fields jsonb; item jsonb;
 existing_receipt public.sandy_customer_mutation_receipts%ROWTYPE;
 digest text; mutation_uuid uuid; columns_sql text; updates_sql text; k text; v jsonb;
 existing_task public.sandy_tasks%ROWTYPE; existing_calendar public.sandy_calendar_events%ROWTYPE; effective_start timestamptz; effective_end timestamptz;
 company uuid; category uuid; parent uuid; message text;
 original_fact public.email_ai_profile_facts%ROWTYPE; corrected_fact public.email_ai_profile_facts%ROWTYPE;
 rejection public.sandy_memory_rejected_facts%ROWTYPE; corrected_id uuid; correction_value text; original_state text;
BEGIN
 actor:=auth.uid();
 IF actor IS NULL OR auth.role() IS DISTINCT FROM 'authenticated' THEN
  RETURN jsonb_build_object('ok',false,'error','customer_session_required','http_status',401);
 END IF;
 IF p_operation='memory.fact_correct' THEN
  -- Match the original Memory Centre's normal Owner-for-records resolver;
  -- Agenda membership and Controller authority confer no private memory access.
  SELECT CASE WHEN count(*)=1 THEN min(a.customer_id::text)::uuid ELSE NULL END INTO tenant FROM auth.users u
   JOIN public.sandy_memory_portal_accounts a ON a.auth_user_id=u.id AND a.revoked_at IS NULL
   JOIN public.email_customer_addresses e ON e.customer_id=a.customer_id AND e.is_primary=true
   WHERE u.id=actor AND u.email_confirmed_at IS NOT NULL AND e.normalized_email=lower(u.email);
 ELSE tenant:=public.sandy_api_current_agenda_customer_id(); END IF;
 IF tenant IS NULL THEN RETURN jsonb_build_object('ok',false,'error','customer_access_required','http_status',403); END IF;
 IF p_operation IS NULL OR p_operation NOT IN ('tasks.create','tasks.update','tasks.complete','tasks.archive','calendar.create','calendar.update','calendar.cancel','files.rename','files.set_description','files.archive','memory.fact_correct')
  OR jsonb_typeof(p_arguments) IS DISTINCT FROM 'object' OR p_idempotency_key IS NULL
  OR p_idempotency_key !~ '^[A-Za-z0-9:_-]{12,128}$' THEN
  RETURN jsonb_build_object('ok',false,'error','invalid_customer_mutation_arguments','http_status',400);
 END IF;
 area:=split_part(p_operation,'.',1); action:=split_part(p_operation,'.',2);
 IF NOT EXISTS(SELECT 1 FROM public.sandy_operation_registry WHERE operation=p_operation
  AND handler=CASE WHEN p_operation='memory.fact_correct' THEN 'sandy-memory-centre' ELSE 'sandy-operations-api' END AND permission_scope=area||':write' AND is_mutation=true
  AND api_exposed=true AND verified=true) THEN
  RETURN jsonb_build_object('ok',false,'error','operation_requires_live_verification','http_status',424);
 END IF;
 IF area='memory' THEN
  allowed:=ARRAY['id','confirm','new_value'];
 ELSIF area='tasks' THEN
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
 IF area='memory' AND ((p_arguments->'confirm') IS DISTINCT FROM 'true'::jsonb OR NOT p_arguments ? 'new_value'
  OR jsonb_typeof(p_arguments->'new_value') NOT IN ('string','null')
  OR (jsonb_typeof(p_arguments->'new_value')='string' AND (length(p_arguments->>'new_value')<2 OR length(p_arguments->>'new_value')>1000))) THEN
  RETURN jsonb_build_object('ok',false,'error','invalid_customer_mutation_arguments','http_status',400);
 END IF;
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
 IF area='memory' THEN
  SELECT * INTO original_fact FROM public.email_ai_profile_facts WHERE id=(p_arguments->>'id')::uuid AND customer_id=tenant AND status='active' FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'error','customer_item_not_found','http_status',404); END IF;
  correction_value:=CASE WHEN p_arguments->'new_value'='null'::jsonb THEN NULL ELSE public.sandy_api_customer_text(p_arguments->>'new_value',1001,true) END;
  IF correction_value IS NOT NULL AND (length(correction_value)<2 OR length(correction_value)>1000 OR public.sandy_api_customer_text(correction_value,1000,false)<>correction_value) THEN
   RETURN jsonb_build_object('ok',false,'error','invalid_customer_mutation_arguments','http_status',400);
  END IF;
  -- One business action: the exact existing Memory Centre RPC and its rejection
  -- trigger. Effect and existing shared idempotency receipt commit together.
  corrected_id:=public.sandy_memory_correct_fact(tenant,original_fact.id,correction_value);
  SELECT * INTO corrected_fact FROM public.email_ai_profile_facts WHERE id=corrected_id AND customer_id=tenant;
  SELECT status INTO original_state FROM public.email_ai_profile_facts WHERE id=original_fact.id AND customer_id=tenant;
  SELECT * INTO rejection FROM public.sandy_memory_rejected_facts WHERE original_fact_id=original_fact.id AND customer_id=tenant;
  IF corrected_fact.id IS NULL OR
    (correction_value IS NULL AND (corrected_id<>original_fact.id OR corrected_fact.status<>'rejected' OR original_state<>'rejected' OR rejection.id IS NULL OR rejection.rejected_value<>original_fact.fact_value OR rejection.corrected_value IS NOT NULL)) OR
    (correction_value IS NOT NULL AND (corrected_fact.status<>'active' OR corrected_fact.fact_value<>correction_value OR
      (corrected_id=original_fact.id AND (original_state<>'active' OR rejection.id IS NOT NULL)) OR
      (corrected_id<>original_fact.id AND (original_state<>'superseded' OR corrected_fact.supersedes_fact_id IS DISTINCT FROM original_fact.id OR rejection.id IS NULL OR rejection.rejected_value<>original_fact.fact_value OR rejection.corrected_value IS DISTINCT FROM correction_value)))) THEN
   RAISE EXCEPTION 'memory correction effect readback failed';
  END IF;
  INSERT INTO public.sandy_memory_audit(owner_customer_id,action,actor,detail)
   VALUES(tenant,CASE WHEN correction_value IS NULL THEN 'portal_fact_rejected' ELSE 'portal_fact_corrected' END,'authenticated_customer_portal',jsonb_build_object('original_id',original_fact.id,'new_id',corrected_id,'correction',correction_value IS NOT NULL,'transport','sandy_api_customer_mutation','auth_user_id',actor));
  item:=jsonb_build_object('id',corrected_fact.id,'customer_id',tenant,'original_fact_id',original_fact.id,'status',corrected_fact.status,'original_status',original_state,
    'fact_value',corrected_fact.fact_value,'supersedes_fact_id',corrected_fact.supersedes_fact_id,'rejection_id',rejection.id,'rejected_value',rejection.rejected_value,'corrected_value',rejection.corrected_value);
 ELSE
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
 END IF; -- memory versus existing task/calendar/file business actions
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
END $candidate$);
END $install$;
-- Contracts are installed separately from exposure and verified evidence. No
-- operation is inserted, enabled or marked verified by this migration.
DO $contract$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.sandy_operation_registry WHERE operation='memory.fact_correct' AND handler='sandy-memory-centre' AND permission_scope='memory:write' AND is_mutation=true AND api_exposed=false AND ai_exposed=false AND verified=false
  AND input_schema='{"type": "object", "required": ["id", "confirm", "new_value"], "properties": {"id": {"type": "string", "format": "uuid"}, "confirm": {"const": true}, "new_value": {"type": ["string", "null"], "maxLength": 1000, "minLength": 2}}, "additionalProperties": false}'::jsonb AND output_schema='{"type": "object", "required": ["ok", "contract_version", "note"], "properties": {"ok": {"const": true}, "note": {"type": "string", "maxLength": 2000, "minLength": 1}, "contract_version": {"const": "1.0.0"}}, "additionalProperties": true}'::jsonb) THEN RAISE EXCEPTION 'closed existing memory correction contract changed';END IF;
END $contract$;
UPDATE public.sandy_operation_registry SET input_schema='{"type": "object", "properties": {"id": {"type": "string", "format": "uuid"}, "confirm": {"const": true}, "new_value": {"type": ["string", "null"], "minLength": 2, "maxLength": 1000}, "idempotency_key": {"type": "string", "minLength": 12, "maxLength": 128, "pattern": "^[A-Za-z0-9:_-]+$"}}, "required": ["id", "confirm", "new_value", "idempotency_key"], "additionalProperties": false}'::jsonb,output_schema='{"type": "object", "additionalProperties": false, "required": ["ok", "contract_version", "operation", "mutation_id", "reused", "item"], "properties": {"ok": {"const": true}, "contract_version": {"const": "1.0.0"}, "operation": {"const": "memory.fact_correct"}, "mutation_id": {"type": "string", "format": "uuid"}, "reused": {"type": "boolean"}, "item": {"type": "object", "additionalProperties": false, "required": ["id", "customer_id", "original_fact_id", "status", "original_status", "fact_value", "supersedes_fact_id", "rejection_id", "rejected_value", "corrected_value"], "properties": {"id": {"type": "string", "format": "uuid"}, "customer_id": {"type": "string", "format": "uuid"}, "original_fact_id": {"type": "string", "format": "uuid"}, "status": {"type": "string", "enum": ["active", "rejected"]}, "original_status": {"type": "string", "enum": ["active", "superseded", "rejected"]}, "fact_value": {"type": "string", "minLength": 1, "maxLength": 2000}, "supersedes_fact_id": {"type": ["string", "null"], "format": "uuid"}, "rejection_id": {"type": ["string", "null"], "format": "uuid"}, "rejected_value": {"type": ["string", "null"]}, "corrected_value": {"type": ["string", "null"]}}}}}'::jsonb,
 description='Correct or reject one own active profile fact through the existing Memory Centre action, actual portal session, explicit confirmation and atomic idempotency receipt; base-row supersession and rejection provenance are checked.',
 error_contract=coalesce(error_contract,'{}'::jsonb)||'{"authentication":"actual_customer_session_and_current_portal_primary_email","idempotency":"existing_customer_mutation_receipts_atomic_with_effect","unknown_outcome":"reconcile_or_explicit_same_key_replay_only","automatic_retry":false,"foreign_record":"customer_item_not_found"}'::jsonb,updated_at=now()
 WHERE operation='memory.fact_correct';
COMMIT;
