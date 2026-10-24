-- A private rollout-quality allowance, never customer or workload authority.
-- Existing Auth/portal/own-record/confirmation/receipt rules remain mandatory.
BEGIN;
SET LOCAL lock_timeout='2s';SET LOCAL statement_timeout='15s';
LOCK TABLE public.sandy_engineering_change_events IN SHARE ROW EXCLUSIVE MODE;
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM public.sandy_engineering_change_events WHERE event_type IN('customer_mutation_private_readiness_installed','customer_mutation_private_readiness_revoked')) THEN RAISE EXCEPTION 'preexisting readiness event requires independent reconciliation';END IF;
END $$;

CREATE FUNCTION public.sandy_customer_mutation_contracts_v1() RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path=pg_catalog,pg_temp AS $contracts$ SELECT '{"tasks.create":"adf9fc55cfdd23f7cab23864a3ff9d811bc1008eda718efd1780c0e61d314f3d","tasks.update":"d14a757c041f6f6658d50093aa6de841f8300da480a7db76e6936dd8f44ddedf","tasks.complete":"cdea3fa30e988574a2684e3529abd2bb4df38ca19c6d1edc2728a1251afc3a30","tasks.archive":"ef688481fef6ae638aea0f046c3ebab0c7241a32c95d61761046d1bddaaa0ee6","calendar.create":"cfa3ec3b0f209edd438af98546a6ff2659e2f48bcca08cdf0bd9c8c3ae3b9af6","calendar.update":"3de2256cf563456ab345af428495bf5d5186c389db288eb9a1f020bdb281d9f3","calendar.cancel":"44a3bf8dec3e699ae425a6408407e8cd80672e64dc31cf7a6bdedfe6ce26c368","files.rename":"cfc7e70a32a2fef57c401a4db0b172009962f95ed98d3f2eedf2a549cc0e5ef9","files.set_description":"5a25bda4e07d5b98cf0a012653029f7b81caf8a32134dadef2d3d484ad634d01","files.archive":"f187e978f4d18a23a2a14ea97bc6096476cfd2513ae68940925171696cae325d"}'::jsonb $contracts$;
REVOKE ALL ON FUNCTION public.sandy_customer_mutation_contracts_v1() FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION public.sandy_customer_mutation_fixture_owned(m jsonb,area text,target uuid,tenant uuid,allow_created boolean DEFAULT false) RETURNS boolean LANGUAGE plpgsql SET search_path=pg_catalog,pg_temp AS $$
DECLARE generated boolean:=false;
BEGIN
 IF target IS NULL THEN RETURN false;END IF;
 IF allow_created AND area IN('tasks','calendar') THEN SELECT EXISTS(SELECT 1 FROM public.sandy_customer_mutation_receipts r WHERE r.customer_id=tenant AND r.auth_user_id=(m->>'fixture_user_id')::uuid AND r.operation=area||'.create' AND left(r.idempotency_key,length(m->>'idempotency_prefix'))=m->>'idempotency_prefix' AND r.result->'item'->>'id'=target::text) INTO generated;END IF;
 IF NOT generated AND NOT coalesce(m->(CASE area WHEN 'tasks' THEN 'task_ids' WHEN 'calendar' THEN 'calendar_ids' WHEN 'files' THEN 'file_ids' WHEN 'companies' THEN 'company_ids' ELSE 'category_ids' END),'[]'::jsonb)@>jsonb_build_array(target::text) THEN RETURN false;END IF;
 CASE area
 WHEN 'tasks' THEN RETURN EXISTS(SELECT 1 FROM public.sandy_tasks t WHERE t.id=target AND t.customer_id=tenant AND (generated OR t.source_kind='sandy_api_fixture'));
 WHEN 'calendar' THEN RETURN EXISTS(SELECT 1 FROM public.sandy_calendar_events t WHERE t.id=target AND t.customer_id=tenant AND t.sync_state='local');
 WHEN 'files' THEN RETURN EXISTS(SELECT 1 FROM public.sandy_universal_files t WHERE t.id=target AND t.owner_customer_id=tenant AND t.metadata->>'customer_mutation_fixture'=m->>'fixture_nonce' AND t.storage_bucket='sandy-task-artifacts' AND t.storage_path='customer_mutation_fixtures/'||tenant::text||'/'||(m->>'fixture_nonce')||'.docx' AND t.provider IS NULL AND t.provider_file_id IS NULL AND EXISTS(SELECT 1 FROM storage.objects o WHERE o.bucket_id=t.storage_bucket AND o.name=t.storage_path));
 WHEN 'companies' THEN RETURN EXISTS(SELECT 1 FROM public.sandy_agenda_companies t WHERE t.id=target AND t.customer_id=tenant AND t.name LIKE 'Isolated mutation fixture %');
 WHEN 'categories' THEN RETURN EXISTS(SELECT 1 FROM public.sandy_agenda_categories t WHERE t.id=target AND t.customer_id=tenant AND t.name LIKE 'Isolated mutation fixture %');
 ELSE RETURN false;END CASE;
END $$;
REVOKE ALL ON FUNCTION public.sandy_customer_mutation_fixture_owned(jsonb,text,uuid,uuid,boolean) FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION public.sandy_customer_mutation_fixture_set_valid(m jsonb,tenant uuid) RETURNS boolean LANGUAGE plpgsql SET search_path=pg_catalog,pg_temp AS $$
DECLARE area text;key text;v jsonb;x text;
BEGIN
 FOREACH area IN ARRAY ARRAY['tasks','calendar','files','companies','categories'] LOOP
 key:=CASE area WHEN 'tasks' THEN 'task_ids' WHEN 'calendar' THEN 'calendar_ids' WHEN 'files' THEN 'file_ids' WHEN 'companies' THEN 'company_ids' ELSE 'category_ids' END;v:=m->key;
 IF jsonb_typeof(v) IS DISTINCT FROM 'array' OR jsonb_array_length(v) NOT BETWEEN 1 AND 4 THEN RETURN false;END IF;
 FOR x IN SELECT jsonb_array_elements_text(v) LOOP IF x !~ '^[a-f0-9-]{36}$' OR NOT public.sandy_customer_mutation_fixture_owned(m,area,x::uuid,tenant,false) THEN RETURN false;END IF;END LOOP;
 END LOOP;RETURN true;
END $$;
REVOKE ALL ON FUNCTION public.sandy_customer_mutation_fixture_set_valid(jsonb,uuid) FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION public.sandy_guard_customer_mutation_private_readiness_event() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,pg_temp AS $$
DECLARE a public.sandy_engineering_artifacts%ROWTYPE; m jsonb;
BEGIN
 IF (TG_OP='DELETE' AND OLD.event_type IN('customer_mutation_private_readiness_installed','customer_mutation_private_readiness_revoked')) OR
  (TG_OP='UPDATE' AND (OLD.event_type IN('customer_mutation_private_readiness_installed','customer_mutation_private_readiness_revoked') OR NEW.event_type IN('customer_mutation_private_readiness_installed','customer_mutation_private_readiness_revoked'))) THEN
  RAISE EXCEPTION 'private readiness audit is immutable' USING ERRCODE='42501';
 END IF;
 IF TG_OP='DELETE' THEN RETURN OLD;END IF;
 IF NEW.event_type NOT IN('customer_mutation_private_readiness_installed','customer_mutation_private_readiness_revoked') THEN RETURN NEW;END IF;
 -- Management's independently protected project release is postgres/postgres.
 -- A service RPC, including a SECURITY DEFINER workload function, cannot forge
 -- this event: its original database session is the PostgREST authenticator.
 IF TG_OP<>'INSERT' OR current_user<>'postgres' OR session_user<>'postgres' OR NEW.actor IS NOT NULL OR coalesce(auth.role(),'') IN('anon','authenticated','service_role') THEN
  RAISE EXCEPTION 'independent protected project release required' USING ERRCODE='42501';
 END IF;
 SELECT * INTO a FROM public.sandy_engineering_artifacts WHERE id=(NEW.detail->>'artifact_id')::uuid AND change_id=NEW.change_id;
 IF NOT FOUND OR (a.artifact_type<>'configuration' OR a.metadata->>'kind' IS DISTINCT FROM 'runtime_customer_mutation_certification') OR a.target<>'customer.mutations' OR a.rollback_strategy<>'manual_review' THEN RAISE EXCEPTION 'fixed readiness artifact required';END IF;
 IF NEW.event_type='customer_mutation_private_readiness_revoked' THEN
  IF NOT EXISTS(SELECT 1 FROM public.sandy_engineering_change_events e WHERE e.change_id=a.change_id AND e.event_type='customer_mutation_private_readiness_installed' AND e.detail->>'artifact_id'=a.id::text) THEN RAISE EXCEPTION 'original protected readiness audit required';END IF;
  RETURN NEW;
 END IF;
 m:=a.metadata;
 IF jsonb_typeof(m) IS DISTINCT FROM 'object' OR NOT m ?& ARRAY['schema_version','operation','fixture_user_id','fixture_customer_id','release_commit','api_bundle_sha256','api_deployment_id','contract_sha256','idempotency_prefix','task_ids','max_mutations','budget_units','expires_at','fixture_nonce','calendar_ids','file_ids','company_ids','category_ids','contracts','analysis_mode']
  OR EXISTS(SELECT 1 FROM jsonb_each(m) field WHERE field.value='null'::jsonb) THEN RAISE EXCEPTION 'complete readiness metadata required';END IF;
 IF jsonb_typeof(m) IS DISTINCT FROM 'object' OR m->>'schema_version'<>'1' OR m->>'operation'<>'customer.mutations'
  OR m->>'fixture_user_id' !~ '^[a-f0-9-]{36}$' OR m->>'fixture_customer_id' !~ '^[a-f0-9-]{36}$'
  OR m->>'release_commit' !~ '^[a-f0-9]{40}$' OR m->>'api_bundle_sha256' !~ '^[a-f0-9]{64}$'
  OR m->>'api_deployment_id' !~ '^zmqlyygzqoidkcwdysok_6e50ff35-5878-42e2-982c-c205df6cac2e_[1-9][0-9]{0,8}$'
  OR m->>'contract_sha256'<>'d25812379110342b5ff7fbd363a6adec85ab58e0a6351dd22eea7d9c196403cb'
  OR m->>'idempotency_prefix' IS DISTINCT FROM 'customer_mutation_cert_'||(m->>'fixture_nonce')||':'
  OR jsonb_typeof(m->'task_ids') IS DISTINCT FROM 'array' OR jsonb_array_length(m->'task_ids') NOT BETWEEN 1 AND 4
  OR (m->>'max_mutations')::integer <>26 OR (m->>'budget_units')::integer<>0
  OR (m->>'expires_at')::timestamptz<=clock_timestamp() OR (m->>'expires_at')::timestamptz>a.created_at+interval '15 minutes'
  OR a.created_at<clock_timestamp()-interval '2 minutes' OR m->>'fixture_nonce' !~ '^[a-f0-9]{32}$' OR m->'contracts' IS DISTINCT FROM public.sandy_customer_mutation_contracts_v1() OR m->>'analysis_mode' IS DISTINCT FROM 'normal_queue_literal_title_only_no_model'
  OR NEW.detail->>'artifact_sha256' IS DISTINCT FROM encode(sha256(convert_to(to_jsonb(a)::text,'UTF8')),'hex')
  OR NEW.detail->>'release_commit' IS DISTINCT FROM m->>'release_commit'
  OR NEW.detail->>'api_bundle_sha256' IS DISTINCT FROM m->>'api_bundle_sha256'
  OR NEW.detail->>'api_deployment_id' IS DISTINCT FROM m->>'api_deployment_id'
  OR NEW.detail->>'contract_sha256' IS DISTINCT FROM m->>'contract_sha256' THEN RAISE EXCEPTION 'bounded source-attested readiness required';END IF;
 IF NOT EXISTS(SELECT 1 FROM auth.users u JOIN public.sandy_memory_portal_accounts p ON p.auth_user_id=u.id AND p.revoked_at IS NULL
  JOIN public.email_customer_addresses e ON e.customer_id=p.customer_id AND e.is_primary AND e.normalized_email=lower(u.email)
  WHERE u.id=(m->>'fixture_user_id')::uuid AND p.customer_id=(m->>'fixture_customer_id')::uuid AND u.email_confirmed_at IS NOT NULL
  AND u.raw_user_meta_data->>'sandy_api_isolated_session_test'='true'
  AND EXISTS(SELECT 1 FROM public.email_customers c JOIN public.sandy_memory_settings ms ON ms.customer_id=c.id WHERE c.id=p.customer_id AND c.display_name='Isolated Sandy API service acceptance' AND c.google_drive_folder_status='excluded' AND NOT ms.learning_enabled AND NOT ms.proactive_enabled)
  AND u.email ~ '^sandy-service-acceptance-[a-f0-9-]{36}@example[.]invalid$' AND u.created_at>=clock_timestamp()-interval '20 minutes'
  AND NOT EXISTS(SELECT 1 FROM public.sandy_controller_admins c WHERE c.auth_user_id=u.id))
  OR NOT public.sandy_customer_mutation_fixture_set_valid(m,(m->>'fixture_customer_id')::uuid)
  THEN RAISE EXCEPTION 'new isolated normal customer fixture required';END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.sandy_guard_customer_mutation_private_readiness_event() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER sandy_customer_mutation_private_readiness_event_guard BEFORE INSERT OR UPDATE OR DELETE ON public.sandy_engineering_change_events
FOR EACH ROW EXECUTE FUNCTION public.sandy_guard_customer_mutation_private_readiness_event();

CREATE FUNCTION public.sandy_api_customer_mutation_private_readiness(p_artifact_id uuid,p_api_deployment_id text,p_contract_sha256 text,p_operation text,p_arguments jsonb,p_idempotency_key text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE a public.sandy_engineering_artifacts%ROWTYPE;m jsonb;actor uuid:=auth.uid();tenant uuid;area text;target uuid;used integer;opused integer;cap integer;r jsonb;
BEGIN
 IF actor IS NULL OR auth.role() IS DISTINCT FROM 'authenticated' THEN RETURN jsonb_build_object('ok',false,'error','private_readiness_normal_customer_required','http_status',401);END IF;
 SELECT CASE WHEN count(*)=1 THEN min(p.customer_id::text)::uuid ELSE NULL END INTO tenant FROM auth.users u JOIN public.sandy_memory_portal_accounts p ON p.auth_user_id=u.id AND p.revoked_at IS NULL JOIN public.email_customer_addresses e ON e.customer_id=p.customer_id AND e.is_primary AND e.normalized_email=lower(u.email) WHERE u.id=actor AND u.email_confirmed_at IS NOT NULL;
 IF tenant IS NULL THEN RETURN jsonb_build_object('ok',false,'error','private_readiness_customer_required','http_status',403);END IF;
 SELECT * INTO a FROM public.sandy_engineering_artifacts WHERE id=p_artifact_id;m:=a.metadata;
 -- Preserve old cancellation custody. It cannot inherit wider QA permission.
 IF m->>'kind'='runtime_task_cancel_certification' AND p_operation='tasks.update' AND p_arguments=jsonb_build_object('id',p_arguments->>'id','status','cancelled') THEN
 r:=public.sandy_api_task_cancel_private_readiness(p_artifact_id,p_api_deployment_id,p_contract_sha256,(p_arguments->>'id')::uuid,p_idempotency_key);RETURN r||jsonb_build_object('operation',p_operation);END IF;
 IF a.id IS NULL OR a.artifact_type<>'configuration' OR a.target<>'customer.mutations' OR a.rollback_strategy<>'manual_review' OR m->>'kind' IS DISTINCT FROM 'runtime_customer_mutation_certification' OR m->>'fixture_user_id' IS DISTINCT FROM actor::text OR m->>'fixture_customer_id' IS DISTINCT FROM tenant::text
 OR m->>'api_deployment_id' IS DISTINCT FROM p_api_deployment_id OR p_contract_sha256 IS DISTINCT FROM(public.sandy_customer_mutation_contracts_v1()->>p_operation) OR m->'contracts' IS DISTINCT FROM public.sandy_customer_mutation_contracts_v1() OR p_operation IS NULL OR NOT(public.sandy_customer_mutation_contracts_v1()?p_operation) OR jsonb_typeof(p_arguments) IS DISTINCT FROM 'object'
 OR (m->>'expires_at')::timestamptz<=clock_timestamp() OR (m->>'expires_at')::timestamptz>a.created_at+interval '15 minutes' OR p_idempotency_key IS NULL OR left(p_idempotency_key,length(m->>'idempotency_prefix')) IS DISTINCT FROM m->>'idempotency_prefix'
 OR EXISTS(SELECT 1 FROM public.sandy_controller_admins c WHERE c.auth_user_id=actor)
 OR NOT EXISTS(SELECT 1 FROM auth.users u JOIN public.email_customers c ON c.id=tenant JOIN public.sandy_memory_settings s ON s.customer_id=c.id WHERE u.id=actor AND u.email ~ '^sandy-service-acceptance-[a-f0-9-]{36}@example[.]invalid$' AND u.created_at>=a.created_at-interval '20 minutes' AND u.raw_user_meta_data->>'sandy_api_isolated_session_test'='true' AND c.display_name='Isolated Sandy API service acceptance' AND c.google_drive_folder_status='excluded' AND NOT s.learning_enabled AND NOT s.proactive_enabled)
 OR NOT EXISTS(SELECT 1 FROM public.sandy_engineering_change_events e WHERE e.change_id=a.change_id AND e.event_type='customer_mutation_private_readiness_installed' AND e.actor IS NULL AND e.detail->>'artifact_id'=a.id::text AND e.detail->>'artifact_sha256'=encode(sha256(convert_to(to_jsonb(a)::text,'UTF8')),'hex') AND e.detail->>'release_commit'=m->>'release_commit' AND e.detail->>'api_bundle_sha256'=m->>'api_bundle_sha256' AND e.detail->>'api_deployment_id'=p_api_deployment_id)
 OR EXISTS(SELECT 1 FROM public.sandy_engineering_change_events e WHERE e.event_type='customer_mutation_private_readiness_revoked' AND e.detail->>'artifact_id'=a.id::text)
 OR NOT EXISTS(SELECT 1 FROM public.sandy_operation_registry r WHERE r.operation=p_operation AND r.handler='sandy-operations-api' AND r.permission_scope=split_part(p_operation,'.',1)||':write' AND r.is_mutation AND r.api_exposed AND r.ai_exposed AND NOT r.verified) THEN RETURN jsonb_build_object('ok',false,'error','private_readiness_denied','http_status',403);END IF;
 area:=split_part(p_operation,'.',1);
 IF p_operation='tasks.create' AND NOT coalesce(length(p_arguments->>'title') BETWEEN 3 AND 240 AND ((left(p_arguments->>'title',1)='"' AND right(p_arguments->>'title',1)='"') OR (left(p_arguments->>'title',1)='“' AND right(p_arguments->>'title',1)='”')),false) THEN RETURN jsonb_build_object('ok',false,'error','private_readiness_literal_task_required','http_status',403);END IF;
 IF p_operation NOT IN('tasks.create','calendar.create') THEN
 target:=(p_arguments->>'id')::uuid;
 IF NOT public.sandy_customer_mutation_fixture_owned(m,area,target,tenant,true) THEN RETURN jsonb_build_object('ok',false,'error','private_readiness_target_denied','http_status',403);END IF;
 IF area='tasks' AND p_arguments?'title' AND EXISTS(SELECT 1 FROM public.sandy_tasks t WHERE t.id=target AND t.customer_id=tenant AND t.source_kind<>'sandy_api_fixture') AND NOT coalesce((left(p_arguments->>'title',1)='"' AND right(p_arguments->>'title',1)='"') OR(left(p_arguments->>'title',1)='“' AND right(p_arguments->>'title',1)='”'),false) THEN RETURN jsonb_build_object('ok',false,'error','private_readiness_literal_task_required','http_status',403);END IF;
 END IF;
 IF (p_arguments?'company_id' AND p_arguments->>'company_id' IS NOT NULL AND NOT public.sandy_customer_mutation_fixture_owned(m,'companies',(p_arguments->>'company_id')::uuid,tenant,false)) OR (p_arguments?'category_id' AND p_arguments->>'category_id' IS NOT NULL AND NOT public.sandy_customer_mutation_fixture_owned(m,'categories',(p_arguments->>'category_id')::uuid,tenant,false)) OR (p_arguments?'parent_task_id' AND p_arguments->>'parent_task_id' IS NOT NULL AND NOT public.sandy_customer_mutation_fixture_owned(m,'tasks',(p_arguments->>'parent_task_id')::uuid,tenant,true)) THEN RETURN jsonb_build_object('ok',false,'error','private_readiness_reference_denied','http_status',403);END IF;
 cap:=CASE p_operation WHEN 'tasks.update' THEN 10 WHEN 'calendar.update' THEN 4 WHEN 'files.rename' THEN 3 WHEN 'files.set_description' THEN 3 ELSE 1 END;
 SELECT count(*),count(*) FILTER(WHERE x.operation=p_operation) INTO used,opused FROM public.sandy_customer_mutation_receipts x WHERE x.customer_id=tenant AND x.auth_user_id=actor AND left(x.idempotency_key,length(m->>'idempotency_prefix'))=m->>'idempotency_prefix';
 IF (used>=26 OR opused>=cap) AND NOT EXISTS(SELECT 1 FROM public.sandy_customer_mutation_receipts x WHERE x.customer_id=tenant AND x.auth_user_id=actor AND x.operation=p_operation AND x.idempotency_key=p_idempotency_key) THEN RETURN jsonb_build_object('ok',false,'error','private_readiness_budget_exhausted','http_status',429);END IF;
 RETURN jsonb_build_object('ok',true,'readiness_id',a.id,'customer_id',tenant,'operation',p_operation,'expires_at',m->>'expires_at');
EXCEPTION WHEN OTHERS THEN RETURN jsonb_build_object('ok',false,'error','private_readiness_unavailable','http_status',503);
END $$;
REVOKE ALL ON FUNCTION public.sandy_api_customer_mutation_private_readiness(uuid,text,text,text,jsonb,text) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.sandy_api_customer_mutation_private_readiness(uuid,text,text,text,jsonb,text) TO authenticated;
DO $patch$
DECLARE body text;definition text;old text:='AND ((api_exposed=true AND verified=true) OR (p_operation=''tasks.update''';replacement text:=$gate$AND ((api_exposed=true AND verified=true) OR (
(public.sandy_api_customer_mutation_private_readiness(
(nullif(coalesce(nullif(current_setting('request.headers',true),''),'{}')::jsonb->>'x-sandy-certification-id',''))::uuid,
coalesce(nullif(current_setting('request.headers',true),''),'{}')::jsonb->>'x-sandy-api-deployment-id',
public.sandy_customer_mutation_contracts_v1()->>p_operation,p_operation,p_arguments,p_idempotency_key)->>'ok')='true') OR (p_operation='tasks.update'$gate$;
BEGIN
 SELECT prosrc,pg_get_functiondef(oid) INTO body,definition FROM pg_proc WHERE oid='public.sandy_api_customer_mutation(text,jsonb,text)'::regprocedure;
 IF encode(sha256(convert_to(body,'UTF8')),'hex')<>'55f7b4cdccb319437bd0a88b65a2461cc27c55d18271a9b400fc1d352fa19b9b' OR (length(body)-length(replace(body,old,'')))/length(old)<>1 THEN RAISE EXCEPTION 'reviewed atomic mutation preimage changed';END IF;
 definition:=replace(definition,'IF p_operation IN (''memory.fact_correct'',''tasks.update'') THEN PERFORM pg_advisory_xact_lock','IF p_operation=''memory.fact_correct'' OR public.sandy_customer_mutation_contracts_v1()?p_operation THEN PERFORM pg_advisory_xact_lock');
 EXECUTE replace(definition,old,replacement);
END $patch$;
COMMIT;
