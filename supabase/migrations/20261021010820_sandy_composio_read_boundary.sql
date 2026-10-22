-- Actual customer sessions; immutable developer-reviewed read profiles, no name heuristics.
BEGIN;
CREATE TABLE public.sandy_composio_read_contracts(operation text PRIMARY KEY,contract jsonb NOT NULL);
CREATE TABLE public.sandy_composio_read_profiles(
 profile_id text PRIMARY KEY CHECK(profile_id~'^[a-z0-9_-]{3,100}$'),
 toolkit_slug text NOT NULL CHECK(toolkit_slug~'^[a-z0-9_-]{2,80}$'),
 tool_slug text NOT NULL CHECK(tool_slug~'^[A-Za-z0-9_-]{3,120}$'),
 provider_definition_sha256 text NOT NULL CHECK(provider_definition_sha256~'^[a-f0-9]{64}$'),
 input_schema jsonb NOT NULL,output_schema jsonb NOT NULL,
 effect_contract text NOT NULL CHECK(effect_contract='reviewed_read_only'),
 review_reference text NOT NULL CHECK(length(review_reference) BETWEEN 8 AND 1000),
 enabled boolean NOT NULL DEFAULT true
);
-- Intentionally empty: a tool prefix/description is not provider effect evidence.
CREATE TABLE public.sandy_composio_read_dispatches(
 admission_id uuid PRIMARY KEY REFERENCES public.sandy_api_execution_admissions(id),
 claim_id uuid NOT NULL UNIQUE DEFAULT gen_random_uuid(),
 customer_id uuid NOT NULL REFERENCES public.email_customers(id),
 profile_id text REFERENCES public.sandy_composio_read_profiles(profile_id),
 state text NOT NULL DEFAULT 'dispatched' CHECK(state IN('dispatched','succeeded','failed','unknown')),
 provider_http_status integer CHECK(provider_http_status BETWEEN 100 AND 599),
 result_sha256 text CHECK(result_sha256~'^[a-f0-9]{64}$'),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),finished_at timestamptz
);
DO $$DECLARE t text;BEGIN FOREACH t IN ARRAY ARRAY['sandy_composio_read_contracts','sandy_composio_read_profiles','sandy_composio_read_dispatches'] LOOP EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',t);EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC,anon,authenticated,service_role',t);END LOOP;END $$;
CREATE FUNCTION public.sandy_composio_input_valid(p_schema jsonb,p_value jsonb,p_depth integer DEFAULT 0) RETURNS boolean
LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog,pg_temp AS $$
DECLARE kind text;field record;required text;candidate jsonb;
BEGIN
 IF p_depth>12 OR p_schema IS NULL OR p_value IS NULL THEN RETURN false;END IF;
 IF p_schema ? 'const' THEN RETURN p_schema->'const'=p_value;END IF;
 IF p_schema ? 'enum' AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(p_schema->'enum')v WHERE v=p_value) THEN RETURN false;END IF;
 IF jsonb_typeof(p_schema->'type')='array' THEN
  FOR candidate IN SELECT value FROM jsonb_array_elements(p_schema->'type') LOOP IF public.sandy_composio_input_valid(jsonb_set(p_schema,'{type}',candidate),p_value,p_depth+1) THEN RETURN true;END IF;END LOOP;RETURN false;
 END IF;
 kind:=p_schema->>'type';
 IF kind='object' THEN
  IF jsonb_typeof(p_value)<>'object' OR(SELECT count(*) FROM jsonb_object_keys(p_value))>coalesce((p_schema->>'maxProperties')::integer,100) THEN RETURN false;END IF;
  FOR required IN SELECT jsonb_array_elements_text(coalesce(p_schema->'required','[]')) LOOP IF NOT p_value ? required THEN RETURN false;END IF;END LOOP;
  FOR field IN SELECT key,value FROM jsonb_each(p_value) LOOP
   IF(p_schema->'properties') ? field.key THEN IF NOT public.sandy_composio_input_valid(p_schema->'properties'->field.key,field.value,p_depth+1) THEN RETURN false;END IF;
   ELSIF p_schema->>'additionalProperties'='false' THEN RETURN false;END IF;
  END LOOP;RETURN true;
 ELSIF kind='array' THEN
  IF jsonb_typeof(p_value)<>'array' OR jsonb_array_length(p_value)<coalesce((p_schema->>'minItems')::integer,0) OR jsonb_array_length(p_value)>coalesce((p_schema->>'maxItems')::integer,100) THEN RETURN false;END IF;
  FOR candidate IN SELECT value FROM jsonb_array_elements(p_value) LOOP IF NOT public.sandy_composio_input_valid(p_schema->'items',candidate,p_depth+1) THEN RETURN false;END IF;END LOOP;RETURN true;
 ELSIF kind='null' THEN RETURN jsonb_typeof(p_value)='null';
 ELSIF kind IN('number','integer') THEN
  RETURN jsonb_typeof(p_value)='number' AND(kind='number' OR(p_value#>>'{}')~'^-?[0-9]+$') AND(p_value#>>'{}')::numeric>=coalesce((p_schema->>'minimum')::numeric,-9007199254740991) AND(p_value#>>'{}')::numeric<=coalesce((p_schema->>'maximum')::numeric,9007199254740991);
 ELSE RETURN public.sandy_product_input_valid(p_schema,p_value,p_depth);
 END IF;
EXCEPTION WHEN data_exception THEN RETURN false;
END $$;
CREATE FUNCTION public.sandy_composio_customer(p_actor uuid) RETURNS uuid
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE tenant uuid;matches integer;
BEGIN
 SELECT min(p.customer_id::text)::uuid,count(*) INTO tenant,matches
 FROM public.sandy_memory_portal_accounts p JOIN auth.users u ON u.id=p.auth_user_id
 JOIN public.email_customer_addresses a ON a.customer_id=p.customer_id AND a.is_primary AND a.normalized_email=lower(u.email)
 WHERE p.auth_user_id=p_actor AND p.revoked_at IS NULL AND u.email_confirmed_at IS NOT NULL AND NOT coalesce(u.is_anonymous,false);
 IF matches IS DISTINCT FROM 1 THEN RETURN NULL;END IF;RETURN tenant;
END $$;
CREATE FUNCTION public.sandy_composio_contract_valid(p_operation text,p_channel text) RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE c jsonb;r public.sandy_operation_registry%ROWTYPE;
BEGIN
 SELECT contract INTO c FROM public.sandy_composio_read_contracts WHERE operation=p_operation;
 SELECT * INTO r FROM public.sandy_operation_registry WHERE operation=p_operation;
 RETURN coalesce(c IS NOT NULL AND p_channel IN('api','mcp') AND r.handler='sandy-composio-read-api'
 AND r.api_exposed AND(p_channel='api' OR r.ai_exposed) AND r.verified AND NOT r.is_mutation
 AND r.permission_scope='connections:read' AND r.input_schema=c->'input_schema' AND r.output_schema=c->'output_schema'
 AND r.error_contract->>'contract_sha256'=c->>'contract_sha256'
 AND r.error_contract->>'requires_approval'='false' AND r.error_contract->>'requires_grant'='true'
 AND r.error_contract->>'requires_real_user_session'='true' AND r.error_contract->>'api_key_delegable'='false',false);
END $$;
CREATE FUNCTION public.sandy_composio_scope(p_actor uuid,p_tenant uuid,p_operation text,p_channel text,p_contract text) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path=pg_catalog,pg_temp AS $$SELECT encode(extensions.digest('composio_customer_v1:'||p_actor::text||':'||p_tenant::text||':'||p_operation||':'||p_channel||':'||p_contract,'sha256'),'hex')$$;
CREATE FUNCTION public.sandy_composio_read_admit(p_operation text,p_arguments jsonb,p_canonical_arguments text,p_request_id uuid,p_channel text DEFAULT 'api') RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE actor uuid:=auth.uid();tenant uuid;config jsonb;prior public.sandy_api_execution_admissions%ROWTYPE;a public.sandy_api_execution_admissions%ROWTYPE;input_hash text;scope_hash text;active_window timestamptz:=date_trunc('minute',clock_timestamp());requests integer;units numeric;d public.sandy_composio_read_dispatches%ROWTYPE;
BEGIN
 tenant:=public.sandy_composio_customer(actor);
 IF auth.role() IS DISTINCT FROM 'authenticated' OR actor IS NULL OR tenant IS NULL THEN RETURN jsonb_build_object('ok',false,'error','actual_confirmed_customer_session_required','http_status',403);END IF;
 SELECT contract INTO config FROM public.sandy_composio_read_contracts WHERE operation=p_operation;
 IF NOT public.sandy_composio_contract_valid(p_operation,p_channel) THEN RETURN jsonb_build_object('ok',false,'error','composio_contract_or_exposure_changed','http_status',409);END IF;
 IF p_request_id IS NULL OR p_canonical_arguments IS NULL OR octet_length(p_canonical_arguments)>30000 OR p_canonical_arguments::jsonb IS DISTINCT FROM p_arguments OR NOT public.sandy_composio_input_valid(config->'input_schema',p_arguments) THEN RETURN jsonb_build_object('ok',false,'error','invalid_composio_arguments','http_status',400);END IF;
 IF p_arguments->>'company_id' IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.sandy_agenda_companies WHERE id=(p_arguments->>'company_id')::uuid AND customer_id=tenant) THEN RETURN jsonb_build_object('ok',false,'error','workspace_not_authorized','http_status',403);END IF;
 input_hash:=encode(extensions.digest(p_canonical_arguments,'sha256'),'hex');scope_hash:=public.sandy_composio_scope(actor,tenant,p_operation,p_channel,config->>'contract_sha256');
 PERFORM pg_advisory_xact_lock(hashtextextended('composio-read:'||actor::text||':'||p_request_id::text,0));
 SELECT * INTO prior FROM public.sandy_api_execution_admissions WHERE actor_id=actor AND request_id=p_request_id;
 IF FOUND THEN
  IF prior.operation IS DISTINCT FROM p_operation OR prior.tenant_id IS DISTINCT FROM tenant OR prior.input_sha256 IS DISTINCT FROM input_hash OR prior.contract_sha256 IS DISTINCT FROM config->>'contract_sha256' OR prior.scope_sha256 IS DISTINCT FROM scope_hash THEN RETURN jsonb_build_object('ok',false,'error','request_id_conflict','http_status',409);END IF;
  SELECT * INTO d FROM public.sandy_composio_read_dispatches WHERE admission_id=prior.id;
  RETURN jsonb_build_object('ok',true,'reused',true,'admission_id',prior.id,'request_id',prior.request_id,'state',prior.state,'result_sha256',d.result_sha256,'executed',CASE WHEN d.state='succeeded' THEN true WHEN d.state='failed' THEN false WHEN prior.state='admitted' THEN false ELSE NULL END);
 END IF;
 INSERT INTO public.sandy_api_rate_windows(actor_id,bucket,window_start,requests,declared_units) VALUES(actor,'composio-read:'||tenant::text,active_window,0,0) ON CONFLICT DO NOTHING;
 SELECT w.requests,w.declared_units INTO requests,units FROM public.sandy_api_rate_windows w WHERE w.actor_id=actor AND w.bucket='composio-read:'||tenant::text AND w.window_start=active_window FOR UPDATE;
 IF requests>=60 OR units>=10 THEN RETURN jsonb_build_object('ok',false,'error','composio_read_budget_exceeded','http_status',429);END IF;
 INSERT INTO public.sandy_api_execution_admissions(actor_id,tenant_id,operation,request_id,is_mutation,input_sha256,contract_sha256,scope_sha256,registry_revision_sha256,declared_cost_units,expires_at) VALUES(actor,tenant,p_operation,p_request_id,false,input_hash,config->>'contract_sha256',scope_hash,public.sandy_api_registry_revision(p_operation),1,clock_timestamp()+interval '60 seconds') RETURNING * INTO a;
 UPDATE public.sandy_api_rate_windows w SET requests=w.requests+1,declared_units=w.declared_units+1 WHERE w.actor_id=actor AND w.bucket='composio-read:'||tenant::text AND w.window_start=active_window;
 PERFORM public.sandy_api_append_audit(actor,p_operation,p_request_id,NULL,a.id,'admission','admitted',input_hash,NULL,NULL,NULL);
 RETURN jsonb_build_object('ok',true,'reused',false,'admission_id',a.id,'grant_id',a.grant_id,'request_id',p_request_id,'actor_id',actor,'tenant_id',tenant);
EXCEPTION WHEN data_exception THEN RETURN jsonb_build_object('ok',false,'error','invalid_composio_arguments','http_status',400);
END $$;
CREATE FUNCTION public.sandy_composio_read_bind(p_admission_id uuid,p_grant_id uuid,p_actor uuid,p_arguments jsonb,p_canonical_arguments text,p_channel text DEFAULT 'api') RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE a public.sandy_api_execution_admissions%ROWTYPE;config jsonb;tenant uuid;profile public.sandy_composio_read_profiles%ROWTYPE;connections jsonb;claim uuid;
BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' THEN RETURN jsonb_build_object('ok',false,'error','internal_service_transport_required','http_status',403);END IF;
 SELECT * INTO a FROM public.sandy_api_execution_admissions WHERE id=p_admission_id FOR UPDATE;
 tenant:=public.sandy_composio_customer(p_actor);SELECT contract INTO config FROM public.sandy_composio_read_contracts WHERE operation=a.operation;
 IF a.id IS NULL OR tenant IS NULL OR a.actor_id IS DISTINCT FROM p_actor OR a.tenant_id IS DISTINCT FROM tenant OR a.principal_kind IS DISTINCT FROM 'auth_user' OR a.customer_key_id IS NOT NULL OR a.credential_id IS NOT NULL OR a.approval_id IS NOT NULL OR a.grant_id IS DISTINCT FROM p_grant_id OR a.state IS DISTINCT FROM 'admitted' OR a.expires_at<=clock_timestamp() OR NOT public.sandy_composio_contract_valid(a.operation,p_channel) OR a.registry_revision_sha256 IS DISTINCT FROM public.sandy_api_registry_revision(a.operation) OR a.contract_sha256 IS DISTINCT FROM config->>'contract_sha256' OR a.scope_sha256 IS DISTINCT FROM public.sandy_composio_scope(p_actor,tenant,a.operation,p_channel,a.contract_sha256) OR p_canonical_arguments IS NULL OR octet_length(p_canonical_arguments)>30000 OR p_canonical_arguments::jsonb IS DISTINCT FROM p_arguments OR a.input_sha256 IS DISTINCT FROM encode(extensions.digest(p_canonical_arguments,'sha256'),'hex') OR NOT public.sandy_composio_input_valid(config->'input_schema',p_arguments) THEN RETURN jsonb_build_object('ok',false,'error','composio_grant_used_expired_or_changed','http_status',409);END IF;
 IF p_arguments->>'company_id' IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.sandy_agenda_companies WHERE id=(p_arguments->>'company_id')::uuid AND customer_id=tenant) THEN RETURN jsonb_build_object('ok',false,'error','workspace_not_authorized','http_status',403);END IF;
 IF NOT EXISTS(SELECT 1 FROM public.sandy_ai_integrations WHERE integration_key='composio_connector' AND enabled) THEN RETURN jsonb_build_object('ok',false,'error','composio_connector_not_enabled','http_status',424);END IF;
 IF a.operation='composio.execute_read' THEN
  SELECT * INTO profile FROM public.sandy_composio_read_profiles WHERE profile_id=p_arguments->>'profile_id' AND enabled;
  IF profile.profile_id IS NULL THEN RETURN jsonb_build_object('ok',false,'error','reviewed_read_profile_required','http_status',424);END IF;
  IF NOT public.sandy_composio_input_valid(profile.input_schema,p_arguments->'arguments') THEN RETURN jsonb_build_object('ok',false,'error','read_profile_arguments_invalid','http_status',400);END IF;
 END IF;
 SELECT coalesce(jsonb_agg(jsonb_build_object('connected_account_id',c.connected_account_id,'toolkit_slug',c.toolkit_slug,'company_id',c.company_id,'status',c.status) ORDER BY c.toolkit_slug,c.company_id,c.connected_account_id),'[]') INTO connections FROM public.sandy_composio_connections c WHERE c.customer_id=tenant AND (NOT p_arguments ? 'company_id' OR c.company_id IS NOT DISTINCT FROM (p_arguments->>'company_id')::uuid) AND(a.operation='composio.discover_toolkits' OR c.toolkit_slug=profile.toolkit_slug);
 IF jsonb_array_length(connections)>100 THEN RETURN jsonb_build_object('ok',false,'error','local_connection_inventory_incomplete','http_status',413);END IF;
 IF a.operation='composio.execute_read' THEN
  connections:=(SELECT coalesce(jsonb_agg(c),'[]') FROM jsonb_array_elements(connections)c WHERE upper(c->>'status')='ACTIVE');
  IF jsonb_array_length(connections)<>1 THEN RETURN jsonb_build_object('ok',false,'error','connection_not_unique_or_inactive','http_status',409);END IF;
 END IF;
 UPDATE public.sandy_api_execution_admissions SET state='consumed',consumed_at=clock_timestamp() WHERE id=a.id;
 PERFORM public.sandy_api_append_audit(a.actor_id,a.operation,a.request_id,NULL,a.id,'dispatch','consumed',a.input_sha256,NULL,NULL,NULL);
 INSERT INTO public.sandy_composio_read_dispatches(admission_id,customer_id,profile_id) VALUES(a.id,tenant,profile.profile_id) RETURNING claim_id INTO claim;
 RETURN jsonb_build_object('ok',true,'admission_id',a.id,'claim_id',claim,'actor_id',a.actor_id,'tenant_id',tenant,'operation',a.operation,'request_id',a.request_id,'connections',connections,'profile',CASE WHEN profile.profile_id IS NULL THEN NULL ELSE to_jsonb(profile) END,'profiles',(SELECT coalesce(jsonb_agg(jsonb_build_object('profile_id',profile_id,'toolkit_slug',toolkit_slug) ORDER BY profile_id),'[]') FROM public.sandy_composio_read_profiles WHERE enabled));
EXCEPTION WHEN data_exception THEN RETURN jsonb_build_object('ok',false,'error','invalid_composio_arguments','http_status',400);
END $$;
CREATE FUNCTION public.sandy_composio_read_finish(p_admission_id uuid,p_claim_id uuid,p_actor uuid,p_outcome text,p_provider_status integer,p_result_sha256 text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE a public.sandy_api_execution_admissions%ROWTYPE;d public.sandy_composio_read_dispatches%ROWTYPE;proof jsonb;
BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' THEN RETURN jsonb_build_object('ok',false,'error','internal_service_transport_required','http_status',403);END IF;
 SELECT * INTO a FROM public.sandy_api_execution_admissions WHERE id=p_admission_id FOR UPDATE;
 SELECT * INTO d FROM public.sandy_composio_read_dispatches WHERE admission_id=p_admission_id FOR UPDATE;
 IF a.id IS NULL OR d.admission_id IS NULL OR a.actor_id IS DISTINCT FROM p_actor OR d.customer_id IS DISTINCT FROM a.tenant_id OR d.claim_id IS DISTINCT FROM p_claim_id OR d.state<>'dispatched' OR a.state<>'consumed' OR p_outcome IS NULL OR p_outcome NOT IN('succeeded','failed','unknown') OR p_result_sha256 IS NULL OR p_result_sha256!~'^[a-f0-9]{64}$' OR(p_provider_status IS NOT NULL AND p_provider_status NOT BETWEEN 100 AND 599) THEN RETURN jsonb_build_object('ok',false,'error','invalid_composio_receipt','http_status',409);END IF;
 proof:=public.sandy_api_finish_execution(a.id,p_outcome,p_provider_status,NULL,p_result_sha256);
 IF proof->>'ok' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'composio_receipt_not_persisted';END IF;
 UPDATE public.sandy_composio_read_dispatches SET state=p_outcome,provider_http_status=p_provider_status,result_sha256=p_result_sha256,finished_at=clock_timestamp() WHERE admission_id=a.id;
 RETURN jsonb_build_object('ok',true,'admission_id',a.id,'request_id',a.request_id,'state',p_outcome,'result_sha256',p_result_sha256);
END $$;
REVOKE ALL ON FUNCTION public.sandy_composio_input_valid(jsonb,jsonb,integer),public.sandy_composio_customer(uuid),public.sandy_composio_contract_valid(text,text),public.sandy_composio_scope(uuid,uuid,text,text,text),public.sandy_composio_read_admit(text,jsonb,text,uuid,text),public.sandy_composio_read_bind(uuid,uuid,uuid,jsonb,text,text),public.sandy_composio_read_finish(uuid,uuid,uuid,text,integer,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.sandy_composio_read_admit(text,jsonb,text,uuid,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.sandy_composio_read_bind(uuid,uuid,uuid,jsonb,text,text),public.sandy_composio_read_finish(uuid,uuid,uuid,text,integer,text) TO service_role;
COMMIT;
