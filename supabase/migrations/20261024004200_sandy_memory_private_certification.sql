-- A private rollout-quality allowance, never customer or workload authority.
-- Existing Auth/portal/own-record/confirmation/receipt rules remain mandatory.
BEGIN;
SET LOCAL lock_timeout='2s';SET LOCAL statement_timeout='15s';
LOCK TABLE public.sandy_engineering_change_events IN SHARE ROW EXCLUSIVE MODE;
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM public.sandy_engineering_change_events WHERE event_type IN('memory_private_readiness_installed','memory_private_readiness_revoked')) THEN RAISE EXCEPTION 'preexisting readiness event requires independent reconciliation';END IF;
END $$;
CREATE FUNCTION public.sandy_guard_memory_private_readiness_event() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,pg_temp AS $$
DECLARE a public.sandy_engineering_artifacts%ROWTYPE; m jsonb;
BEGIN
 IF (TG_OP='DELETE' AND OLD.event_type IN('memory_private_readiness_installed','memory_private_readiness_revoked')) OR
  (TG_OP='UPDATE' AND (OLD.event_type IN('memory_private_readiness_installed','memory_private_readiness_revoked') OR NEW.event_type IN('memory_private_readiness_installed','memory_private_readiness_revoked'))) THEN
  RAISE EXCEPTION 'private readiness audit is immutable' USING ERRCODE='42501';
 END IF;
 IF TG_OP='DELETE' THEN RETURN OLD;END IF;
 IF NEW.event_type NOT IN('memory_private_readiness_installed','memory_private_readiness_revoked') THEN RETURN NEW;END IF;
 -- Management's independently protected project release is postgres/postgres.
 -- A service RPC, including a SECURITY DEFINER workload function, cannot forge
 -- this event: its original database session is the PostgREST authenticator.
 IF TG_OP<>'INSERT' OR current_user<>'postgres' OR session_user<>'postgres' OR NEW.actor IS NOT NULL OR coalesce(auth.role(),'') IN('anon','authenticated','service_role') THEN
  RAISE EXCEPTION 'independent protected project release required' USING ERRCODE='42501';
 END IF;
 SELECT * INTO a FROM public.sandy_engineering_artifacts WHERE id=(NEW.detail->>'artifact_id')::uuid AND change_id=NEW.change_id;
 IF NOT FOUND OR a.artifact_type<>'runtime_private_certification' OR a.target<>'memory.fact_correct' OR a.rollback_strategy<>'revoke_readiness_only' THEN RAISE EXCEPTION 'fixed readiness artifact required';END IF;
 IF NEW.event_type='memory_private_readiness_revoked' THEN
  IF NOT EXISTS(SELECT 1 FROM public.sandy_engineering_change_events e WHERE e.change_id=a.change_id AND e.event_type='memory_private_readiness_installed' AND e.detail->>'artifact_id'=a.id::text) THEN RAISE EXCEPTION 'original protected readiness audit required';END IF;
  RETURN NEW;
 END IF;
 m:=a.metadata;
 IF jsonb_typeof(m) IS DISTINCT FROM 'object' OR NOT m ?& ARRAY['schema_version','operation','fixture_user_id','fixture_customer_id','release_commit','api_bundle_sha256','api_deployment_id','contract_sha256','idempotency_prefix','fact_ids','max_mutations','budget_units','expires_at']
  OR EXISTS(SELECT 1 FROM jsonb_each(m) field WHERE field.value='null'::jsonb) THEN RAISE EXCEPTION 'complete readiness metadata required';END IF;
 IF jsonb_typeof(m) IS DISTINCT FROM 'object' OR m->>'schema_version'<>'1' OR m->>'operation'<>'memory.fact_correct'
  OR m->>'fixture_user_id' !~ '^[a-f0-9-]{36}$' OR m->>'fixture_customer_id' !~ '^[a-f0-9-]{36}$'
  OR m->>'release_commit' !~ '^[a-f0-9]{40}$' OR m->>'api_bundle_sha256' !~ '^[a-f0-9]{64}$'
  OR m->>'api_deployment_id' !~ '^zmqlyygzqoidkcwdysok_6e50ff35-5878-42e2-982c-c205df6cac2e_[1-9][0-9]{0,8}$'
  OR m->>'contract_sha256'<>'731b0f287fb36c073017f47fa7b5f4c4b525e3f7e04dfa6e73ace41c10a5cf6a'
  OR m->>'idempotency_prefix' !~ '^memory_cert_[a-f0-9]{32}:$'
  OR jsonb_typeof(m->'fact_ids') IS DISTINCT FROM 'array' OR jsonb_array_length(m->'fact_ids') NOT BETWEEN 1 AND 3
  OR (m->>'max_mutations')::integer NOT BETWEEN 1 AND 3 OR (m->>'budget_units')::integer<>0
  OR (m->>'expires_at')::timestamptz<=clock_timestamp() OR (m->>'expires_at')::timestamptz>a.created_at+interval '15 minutes'
  OR a.created_at<clock_timestamp()-interval '2 minutes'
  OR NEW.detail->>'artifact_sha256' IS DISTINCT FROM encode(sha256(convert_to(to_jsonb(a)::text,'UTF8')),'hex')
  OR NEW.detail->>'release_commit' IS DISTINCT FROM m->>'release_commit'
  OR NEW.detail->>'api_bundle_sha256' IS DISTINCT FROM m->>'api_bundle_sha256'
  OR NEW.detail->>'api_deployment_id' IS DISTINCT FROM m->>'api_deployment_id'
  OR NEW.detail->>'contract_sha256' IS DISTINCT FROM m->>'contract_sha256' THEN RAISE EXCEPTION 'bounded source-attested readiness required';END IF;
 IF NOT EXISTS(SELECT 1 FROM auth.users u JOIN public.sandy_memory_portal_accounts p ON p.auth_user_id=u.id AND p.revoked_at IS NULL
  JOIN public.email_customer_addresses e ON e.customer_id=p.customer_id AND e.is_primary AND e.normalized_email=lower(u.email)
  WHERE u.id=(m->>'fixture_user_id')::uuid AND p.customer_id=(m->>'fixture_customer_id')::uuid AND u.email_confirmed_at IS NOT NULL
  AND u.email ~ '^sandy-service-acceptance-[a-f0-9-]{36}@example[.]invalid$' AND u.created_at>=clock_timestamp()-interval '20 minutes'
  AND NOT EXISTS(SELECT 1 FROM public.sandy_controller_admins c WHERE c.auth_user_id=u.id))
  OR EXISTS(SELECT 1 FROM jsonb_array_elements_text(m->'fact_ids') x(id) LEFT JOIN public.email_ai_profile_facts f ON f.id=x.id::uuid AND f.customer_id=(m->>'fixture_customer_id')::uuid WHERE f.id IS NULL)
  THEN RAISE EXCEPTION 'new isolated normal customer fixture required';END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.sandy_guard_memory_private_readiness_event() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER sandy_memory_private_readiness_event_guard BEFORE INSERT OR UPDATE OR DELETE ON public.sandy_engineering_change_events
FOR EACH ROW EXECUTE FUNCTION public.sandy_guard_memory_private_readiness_event();

CREATE FUNCTION public.sandy_api_memory_private_readiness(p_artifact_id uuid,p_api_deployment_id text,p_contract_sha256 text,p_fact_id uuid,p_idempotency_key text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE a public.sandy_engineering_artifacts%ROWTYPE;m jsonb;actor uuid:=auth.uid();tenant uuid;used integer;
BEGIN
 IF actor IS NULL OR auth.role() IS DISTINCT FROM 'authenticated' THEN RETURN jsonb_build_object('ok',false,'error','normal_customer_session_required','http_status',401);END IF;
 SELECT CASE WHEN count(*)=1 THEN min(p.customer_id::text)::uuid ELSE NULL END INTO tenant FROM auth.users u
 JOIN public.sandy_memory_portal_accounts p ON p.auth_user_id=u.id AND p.revoked_at IS NULL
 JOIN public.email_customer_addresses e ON e.customer_id=p.customer_id AND e.is_primary AND e.normalized_email=lower(u.email)
 WHERE u.id=actor AND u.email_confirmed_at IS NOT NULL;
 IF tenant IS NULL THEN RETURN jsonb_build_object('ok',false,'error','portal_customer_access_required','http_status',403);END IF;
 SELECT * INTO a FROM public.sandy_engineering_artifacts WHERE id=p_artifact_id;
 m:=a.metadata;
 IF a.id IS NULL OR a.artifact_type<>'runtime_private_certification' OR a.target<>'memory.fact_correct'
  OR m->>'operation'<>'memory.fact_correct' OR m->>'fixture_user_id' IS DISTINCT FROM actor::text OR m->>'fixture_customer_id' IS DISTINCT FROM tenant::text
  OR EXISTS(SELECT 1 FROM public.sandy_controller_admins c WHERE c.auth_user_id=actor)
  OR NOT EXISTS(SELECT 1 FROM auth.users u WHERE u.id=actor AND u.email ~ '^sandy-service-acceptance-[a-f0-9-]{36}@example[.]invalid$' AND u.created_at>=a.created_at-interval '20 minutes')
  OR m->>'api_deployment_id' IS DISTINCT FROM p_api_deployment_id OR m->>'contract_sha256' IS DISTINCT FROM p_contract_sha256 OR p_contract_sha256<>'731b0f287fb36c073017f47fa7b5f4c4b525e3f7e04dfa6e73ace41c10a5cf6a'
  OR (m->>'expires_at')::timestamptz<=clock_timestamp() OR (m->>'expires_at')::timestamptz>a.created_at+interval '15 minutes'
  OR NOT m->'fact_ids' @> jsonb_build_array(p_fact_id::text)
  OR p_idempotency_key IS NULL OR left(p_idempotency_key,length(m->>'idempotency_prefix')) IS DISTINCT FROM m->>'idempotency_prefix'
  OR NOT EXISTS(SELECT 1 FROM public.sandy_engineering_change_events e WHERE e.change_id=a.change_id AND e.event_type='memory_private_readiness_installed' AND e.actor IS NULL
    AND e.detail->>'artifact_id'=a.id::text AND e.detail->>'artifact_sha256'=encode(sha256(convert_to(to_jsonb(a)::text,'UTF8')),'hex')
    AND e.detail->>'api_bundle_sha256'=m->>'api_bundle_sha256' AND e.detail->>'api_deployment_id'=p_api_deployment_id
    AND e.detail->>'release_commit'=m->>'release_commit' AND e.detail->>'contract_sha256'=p_contract_sha256)
  OR EXISTS(SELECT 1 FROM public.sandy_engineering_change_events e WHERE e.event_type='memory_private_readiness_revoked' AND e.detail->>'artifact_id'=a.id::text)
  OR NOT EXISTS(SELECT 1 FROM public.sandy_operation_registry r WHERE r.operation='memory.fact_correct' AND r.handler='sandy-memory-centre' AND r.permission_scope='memory:write' AND r.is_mutation AND NOT r.api_exposed AND NOT r.ai_exposed AND NOT r.verified AND r.error_contract->>'contract_sha256'=p_contract_sha256)
  THEN RETURN jsonb_build_object('ok',false,'error','private_readiness_denied','http_status',403);END IF;
 -- Replays do not consume another mutation. The caller's existing shared
 -- customer advisory lock serializes this check with the actual effect/receipt.
 SELECT count(*) INTO used FROM public.sandy_customer_mutation_receipts r WHERE r.customer_id=tenant AND r.auth_user_id=actor AND r.operation='memory.fact_correct'
  AND left(r.idempotency_key,length(m->>'idempotency_prefix'))=m->>'idempotency_prefix';
 IF used>=(m->>'max_mutations')::integer AND NOT EXISTS(SELECT 1 FROM public.sandy_customer_mutation_receipts r WHERE r.customer_id=tenant AND r.auth_user_id=actor AND r.operation='memory.fact_correct' AND r.idempotency_key=p_idempotency_key) THEN
  RETURN jsonb_build_object('ok',false,'error','private_readiness_budget_exhausted','http_status',429);END IF;
 RETURN jsonb_build_object('ok',true,'readiness_id',a.id,'customer_id',tenant,'expires_at',m->>'expires_at');
EXCEPTION WHEN OTHERS THEN RETURN jsonb_build_object('ok',false,'error','private_readiness_unavailable','http_status',503);
END $$;
REVOKE ALL ON FUNCTION public.sandy_api_memory_private_readiness(uuid,text,text,uuid,text) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.sandy_api_memory_private_readiness(uuid,text,text,uuid,text) TO authenticated;

DO $patch$
DECLARE definition text;body text;old text:='AND api_exposed=true AND verified=true';replacement text:=$gate$AND ((api_exposed=true AND verified=true) OR (p_operation='memory.fact_correct' AND
   (public.sandy_api_memory_private_readiness(
    (nullif(coalesce(nullif(current_setting('request.headers',true),''),'{}')::jsonb->>'x-sandy-certification-id',''))::uuid,
    coalesce(nullif(current_setting('request.headers',true),''),'{}')::jsonb->>'x-sandy-api-deployment-id',
    error_contract->>'contract_sha256',(p_arguments->>'id')::uuid,p_idempotency_key)->>'ok')='true'))$gate$;
BEGIN
 SELECT prosrc,pg_get_functiondef(oid) INTO body,definition FROM pg_proc WHERE oid='public.sandy_api_customer_mutation(text,jsonb,text)'::regprocedure;
 IF encode(sha256(convert_to(body,'UTF8')),'hex')<>'f05b010393795666bdb9233f2cd1f88620be80a567d88b35af5e271f1ea4a4f1' OR
  (length(body)-length(replace(body,old,'')))/length(old)<>1 THEN RAISE EXCEPTION 'reviewed atomic correction preimage changed';END IF;
 -- No new function signature, database, receipt table or alternate action.
 -- Acquire the same lock before readiness count and effect, including retries.
 definition:=replace(definition,' area:=split_part(p_operation',
  ' IF p_operation=''memory.fact_correct'' THEN PERFORM pg_advisory_xact_lock(hashtextextended(''sandy_customer_mutation:''||tenant::text,0));END IF;'||chr(10)||' area:=split_part(p_operation');
 EXECUTE replace(definition,old,replacement);
END $patch$;
COMMIT;
