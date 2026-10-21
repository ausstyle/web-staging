-- Provisioning control plane extends canonical customers, existing commerce
-- entitlements and normal Auth. The first installed adapter creates an actual
-- isolated Postgres table in this existing project; no new project or purchase.
BEGIN;
CREATE TABLE public.sandy_provisioning_features (
 feature_key text PRIMARY KEY CHECK(feature_key~'^[a-z][a-z0-9_.-]{2,79}$'),
 adapter text NOT NULL CHECK(adapter IN('supabase.workspace')),
 enabled boolean NOT NULL DEFAULT false,version integer NOT NULL DEFAULT 1 CHECK(version>0),
 description text NOT NULL CHECK(length(description) BETWEEN 1 AND 400),
 max_storage_bytes bigint NOT NULL DEFAULT 1048576 CHECK(max_storage_bytes BETWEEN 65536 AND 1048576),
 estimated_purchase_cost_microusd bigint NOT NULL DEFAULT 0 CHECK(estimated_purchase_cost_microusd=0),
 updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE public.sandy_provisioning_templates (
 template_key text PRIMARY KEY CHECK(template_key~'^[a-z][a-z0-9_.-]{2,79}$'),
 plan_id uuid REFERENCES public.sandy_commerce_plans(id),enabled boolean NOT NULL DEFAULT false,
 version integer NOT NULL DEFAULT 1 CHECK(version>0),feature_keys text[] NOT NULL CHECK(cardinality(feature_keys) BETWEEN 1 AND 10),
 updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE public.sandy_provisioning_customer_policies (
 customer_id uuid NOT NULL REFERENCES public.email_customers(id),feature_key text NOT NULL REFERENCES public.sandy_provisioning_features(feature_key),
 enabled boolean NOT NULL DEFAULT false,version integer NOT NULL DEFAULT 1 CHECK(version>0),
 resource_limit integer NOT NULL DEFAULT 1 CHECK(resource_limit BETWEEN 0 AND 10),
 storage_bytes_limit bigint NOT NULL DEFAULT 1048576 CHECK(storage_bytes_limit BETWEEN 65536 AND 1048576),
 purchase_budget_microusd bigint NOT NULL DEFAULT 0 CHECK(purchase_budget_microusd=0),
 updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),PRIMARY KEY(customer_id,feature_key)
);
CREATE TABLE public.sandy_customer_provisioning_plans (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),customer_id uuid NOT NULL REFERENCES public.email_customers(id),
 template_key text NOT NULL REFERENCES public.sandy_provisioning_templates(template_key),template_version integer NOT NULL,
 snapshot jsonb NOT NULL,snapshot_sha256 text NOT NULL,expires_at timestamptz NOT NULL DEFAULT clock_timestamp()+interval '5 minutes',
 created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE public.sandy_customer_resources (
 id uuid PRIMARY KEY,customer_id uuid NOT NULL REFERENCES public.email_customers(id),feature_key text NOT NULL REFERENCES public.sandy_provisioning_features(feature_key),
 adapter text NOT NULL CHECK(adapter='supabase.workspace'),provider text NOT NULL DEFAULT 'supabase' CHECK(provider='supabase'),
 project_ref text NOT NULL DEFAULT 'zmqlyygzqoidkcwdysok' CHECK(project_ref='zmqlyygzqoidkcwdysok'),
 provider_resource_id text NOT NULL UNIQUE CHECK(provider_resource_id~'^public\.sandy_workspace_[a-f0-9]{32}$'),
 state text NOT NULL CHECK(state IN('ready','drifted','decommissioned')),version integer NOT NULL DEFAULT 1,
 storage_bytes_limit bigint NOT NULL,logical_storage_bytes bigint NOT NULL DEFAULT 0,provider_storage_bytes bigint,
 estimated_purchase_cost_microusd bigint NOT NULL DEFAULT 0 CHECK(estimated_purchase_cost_microusd=0),
 actual_cost_microusd bigint DEFAULT NULL,cost_source text NOT NULL DEFAULT 'not_individually_reported',
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),verified_at timestamptz,updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),decommissioned_at timestamptz
);
CREATE UNIQUE INDEX sandy_customer_resources_one_active_feature ON public.sandy_customer_resources(customer_id,feature_key) WHERE state<>'decommissioned';
CREATE TABLE public.sandy_customer_provisioning_jobs (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),customer_id uuid NOT NULL REFERENCES public.email_customers(id),
 plan_id uuid UNIQUE REFERENCES public.sandy_customer_provisioning_plans(id),kind text NOT NULL CHECK(kind IN('provision','decommission','recover')),
 state text NOT NULL CHECK(state IN('succeeded','failed','unknown')),resource_ids uuid[] NOT NULL,error_code text,
 execution_mode text NOT NULL DEFAULT 'synchronous_transaction' CHECK(execution_mode='synchronous_transaction'),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),completed_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE public.sandy_customer_provisioning_receipts (
 actor_id uuid NOT NULL,request_id uuid NOT NULL,operation text NOT NULL,input_sha256 text NOT NULL,
 result jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT clock_timestamp(),PRIMARY KEY(actor_id,request_id)
);
CREATE TABLE public.sandy_customer_provisioning_events (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,actor_id uuid,customer_id uuid,request_id uuid,operation text NOT NULL,
 resource_id uuid,input_sha256 text,detail jsonb NOT NULL DEFAULT '{}'::jsonb,occurred_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
DO $$ DECLARE name text;BEGIN
 FOREACH name IN ARRAY ARRAY['sandy_provisioning_features','sandy_provisioning_templates','sandy_provisioning_customer_policies','sandy_customer_provisioning_plans','sandy_customer_resources','sandy_customer_provisioning_jobs','sandy_customer_provisioning_receipts','sandy_customer_provisioning_events'] LOOP
  EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',name);
  EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC,anon,authenticated,service_role',name);
  EXECUTE format('GRANT SELECT ON public.%I TO service_role',name);
 END LOOP;
END $$;
INSERT INTO public.sandy_provisioning_features(feature_key,adapter,description) VALUES('database.workspace','supabase.workspace','Isolated JSON record workspace in the existing Supabase project. No new project, plan purchase, or provider credential is provisioned.');
INSERT INTO public.sandy_provisioning_templates(template_key,feature_keys) VALUES('customer.workspace',ARRAY['database.workspace']);

CREATE FUNCTION public.sandy_provisioning_configuration_version() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,pg_temp AS $$ BEGIN NEW.version:=OLD.version+1;NEW.updated_at:=clock_timestamp();RETURN NEW;END $$;
CREATE TRIGGER sandy_provisioning_feature_version BEFORE UPDATE ON public.sandy_provisioning_features FOR EACH ROW EXECUTE FUNCTION public.sandy_provisioning_configuration_version();
CREATE TRIGGER sandy_provisioning_template_version BEFORE UPDATE ON public.sandy_provisioning_templates FOR EACH ROW EXECUTE FUNCTION public.sandy_provisioning_configuration_version();
CREATE TRIGGER sandy_provisioning_customer_policy_version BEFORE UPDATE ON public.sandy_provisioning_customer_policies FOR EACH ROW EXECUTE FUNCTION public.sandy_provisioning_configuration_version();
REVOKE ALL ON FUNCTION public.sandy_provisioning_configuration_version() FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.sandy_provisioning_configuration_audit() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$ BEGIN
 INSERT INTO public.sandy_customer_provisioning_events(actor_id,customer_id,operation,detail)
 VALUES(auth.uid(),CASE WHEN TG_TABLE_NAME='sandy_provisioning_customer_policies' THEN (to_jsonb(NEW)->>'customer_id')::uuid ELSE NULL END,'configuration.'||TG_TABLE_NAME,jsonb_build_object('administrative_session_user',session_user,'before_sha256',CASE WHEN TG_OP='UPDATE' THEN encode(extensions.digest(convert_to(to_jsonb(OLD)::text,'UTF8'),'sha256'),'hex') ELSE NULL END,'after_sha256',encode(extensions.digest(convert_to(to_jsonb(NEW)::text,'UTF8'),'sha256'),'hex')));
 RETURN NEW;
END $$;
CREATE TRIGGER sandy_provisioning_feature_audit AFTER INSERT OR UPDATE ON public.sandy_provisioning_features FOR EACH ROW EXECUTE FUNCTION public.sandy_provisioning_configuration_audit();
CREATE TRIGGER sandy_provisioning_template_audit AFTER INSERT OR UPDATE ON public.sandy_provisioning_templates FOR EACH ROW EXECUTE FUNCTION public.sandy_provisioning_configuration_audit();
CREATE TRIGGER sandy_provisioning_customer_policy_audit AFTER INSERT OR UPDATE ON public.sandy_provisioning_customer_policies FOR EACH ROW EXECUTE FUNCTION public.sandy_provisioning_configuration_audit();
REVOKE ALL ON FUNCTION public.sandy_provisioning_configuration_audit() FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.sandy_provisioning_customer_id() RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
 SELECT p.customer_id FROM public.sandy_memory_portal_accounts p JOIN auth.users u ON u.id=p.auth_user_id JOIN public.email_customer_addresses a ON a.customer_id=p.customer_id AND a.is_primary
 WHERE auth.role()='authenticated' AND p.auth_user_id=auth.uid() AND p.revoked_at IS NULL AND u.email_confirmed_at IS NOT NULL AND NOT coalesce(u.is_anonymous,false) AND coalesce(u.raw_app_meta_data->>'sandy_engineering_test','false')<>'true' AND a.normalized_email=lower(btrim(u.email))
$$;
REVOKE ALL ON FUNCTION public.sandy_provisioning_customer_id() FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.sandy_provisioning_workspace_verified(p_id uuid) RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE resource public.sandy_customer_resources%ROWTYPE;relation oid;
BEGIN
 SELECT * INTO resource FROM public.sandy_customer_resources WHERE id=p_id;
 IF NOT FOUND OR resource.adapter<>'supabase.workspace' OR resource.provider_resource_id<>'public.sandy_workspace_'||replace(resource.id::text,'-','') THEN RETURN false;END IF;
 relation:=to_regclass(resource.provider_resource_id);
 IF relation IS NULL THEN RETURN false;END IF;
 RETURN EXISTS(SELECT 1 FROM pg_class WHERE oid=relation AND relkind='r' AND relrowsecurity AND relforcerowsecurity AND pg_get_userbyid(relowner)=current_user AND obj_description(oid,'pg_class')='sandy_customer_resource:'||resource.id||':'||resource.customer_id)
 AND NOT has_table_privilege('anon',relation,'SELECT,INSERT,UPDATE,DELETE') AND NOT has_table_privilege('authenticated',relation,'SELECT,INSERT,UPDATE,DELETE')
 AND (SELECT count(*) FROM pg_attribute WHERE attrelid=relation AND attnum>0 AND NOT attisdropped)=4 AND (SELECT count(*) FROM pg_attribute WHERE attrelid=relation AND ((attname='record_key' AND atttypid='text'::regtype) OR (attname='value' AND atttypid='jsonb'::regtype) OR (attname='version' AND atttypid='integer'::regtype) OR (attname='updated_at' AND atttypid='timestamptz'::regtype)))=4;
END $$;
REVOKE ALL ON FUNCTION public.sandy_provisioning_workspace_verified(uuid) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.sandy_provisioning_refusal(p_actor uuid,p_customer uuid,p_request uuid,p_operation text,p_input_hash text,p_error text,p_status integer,p_job uuid DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$ BEGIN
 IF p_actor IS NOT NULL AND p_customer IS NOT NULL AND (SELECT count(*) FROM public.sandy_customer_provisioning_events WHERE actor_id=p_actor AND occurred_at>clock_timestamp()-interval '1 minute')<61 THEN
  INSERT INTO public.sandy_customer_provisioning_events(actor_id,customer_id,request_id,operation,input_sha256,detail) VALUES(p_actor,p_customer,p_request,CASE WHEN p_operation~'^customer\.(provisioning|resources|workspace)\.[a-z_.]{1,80}$' THEN p_operation ELSE 'customer.provisioning.invalid' END,p_input_hash,jsonb_build_object('error',p_error,'http_status',p_status,'committed',false,'job_id',p_job));
 END IF;
 RETURN jsonb_build_object('ok',false,'error',p_error,'http_status',p_status,'executed',false,'automatic_retry',false,'request_id',p_request)||CASE WHEN p_job IS NULL THEN '{}'::jsonb ELSE jsonb_build_object('job_id',p_job) END;
END $$;
REVOKE ALL ON FUNCTION public.sandy_provisioning_refusal(uuid,uuid,uuid,text,text,text,integer,uuid) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.sandy_customer_provisioning_execute(p_operation text,p_arguments jsonb,p_request_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE actor uuid:=auth.uid();customer uuid;input_hash text;prior public.sandy_customer_provisioning_receipts%ROWTYPE;
 feature public.sandy_provisioning_features%ROWTYPE;policy public.sandy_provisioning_customer_policies%ROWTYPE;template public.sandy_provisioning_templates%ROWTYPE;
 plan public.sandy_customer_provisioning_plans%ROWTYPE;resource public.sandy_customer_resources%ROWTYPE;job public.sandy_customer_provisioning_jobs%ROWTYPE;
 allowed text[];key text;snapshot jsonb:='[]'::jsonb;step jsonb;data jsonb;result jsonb;ids uuid[]:=ARRAY[]::uuid[];resource_id uuid;table_name text;relation oid;
 mutation boolean;old_version integer;old_value jsonb;used_bytes bigint;rows_count bigint;record_value jsonb;record_version integer;reused boolean:=false;
BEGIN
 customer:=public.sandy_provisioning_customer_id();
 IF customer IS NULL THEN RETURN public.sandy_provisioning_refusal(actor,customer,p_request_id,p_operation,input_hash,'verified_customer_access_required',403);END IF;
 IF p_request_id IS NULL OR p_operation IS NULL OR jsonb_typeof(p_arguments) IS DISTINCT FROM 'object' OR octet_length(p_arguments::text)>70000 THEN RETURN public.sandy_provisioning_refusal(actor,customer,p_request_id,p_operation,input_hash,'invalid_provisioning_request',400);END IF;
 allowed:=CASE p_operation
 WHEN 'customer.provisioning.features.list' THEN ARRAY[]::text[] WHEN 'customer.provisioning.templates.list' THEN ARRAY[]::text[]
 WHEN 'customer.provisioning.plan' THEN ARRAY['template_key'] WHEN 'customer.provisioning.execute' THEN ARRAY['plan_id','plan_sha256']
 WHEN 'customer.provisioning.jobs.get' THEN ARRAY['job_id'] WHEN 'customer.resources.list' THEN ARRAY[]::text[]
 WHEN 'customer.resources.reconcile' THEN ARRAY['resource_id'] WHEN 'customer.resources.recover' THEN ARRAY['resource_id','expected_version']
 WHEN 'customer.resources.decommission' THEN ARRAY['resource_id','expected_version','delete_data']
 WHEN 'customer.workspace.records.get' THEN ARRAY['resource_id','key'] WHEN 'customer.workspace.records.upsert' THEN ARRAY['resource_id','key','value','expected_version']
 WHEN 'customer.workspace.records.delete' THEN ARRAY['resource_id','key','expected_version'] ELSE NULL END;
 IF allowed IS NULL OR EXISTS(SELECT 1 FROM jsonb_object_keys(p_arguments) k WHERE NOT k=ANY(allowed)) OR EXISTS(SELECT 1 FROM unnest(allowed) k WHERE NOT p_arguments?k) THEN RETURN public.sandy_provisioning_refusal(actor,customer,p_request_id,p_operation,input_hash,'invalid_provisioning_arguments',400);END IF;
 IF p_arguments?'resource_id' AND (p_arguments->>'resource_id')!~'^[a-f0-9-]{36}$' OR p_arguments?'expected_version' AND (jsonb_typeof(p_arguments->'expected_version')<>'number' OR (p_arguments->>'expected_version')!~'^[0-9]{1,9}$') OR p_arguments?'key' AND (jsonb_typeof(p_arguments->'key')<>'string' OR (p_arguments->>'key')!~'^[A-Za-z0-9][A-Za-z0-9_.-]{0,79}$') OR p_arguments?'value' AND (jsonb_typeof(p_arguments->'value')<>'object' OR octet_length((p_arguments->'value')::text)>65536) THEN RETURN public.sandy_provisioning_refusal(actor,customer,p_request_id,p_operation,input_hash,'invalid_provisioning_arguments',400);END IF;
 input_hash:=encode(extensions.digest(convert_to(p_arguments::text,'UTF8'),'sha256'),'hex');
 mutation:=p_operation NOT IN('customer.provisioning.features.list','customer.provisioning.templates.list','customer.provisioning.jobs.get','customer.resources.list','customer.workspace.records.get');
 PERFORM pg_advisory_xact_lock(hashtextextended('sandy-provisioning-customer:'||customer,0));
 IF mutation THEN
  SELECT * INTO prior FROM public.sandy_customer_provisioning_receipts WHERE actor_id=actor AND request_id=p_request_id;
  IF FOUND THEN
   IF prior.operation<>p_operation OR prior.input_sha256<>input_hash THEN RETURN public.sandy_provisioning_refusal(actor,customer,p_request_id,p_operation,input_hash,'request_id_conflict',409);END IF;
   RETURN prior.result||jsonb_build_object('reused',true);
  END IF;
 END IF;
 IF (SELECT count(*) FROM public.sandy_customer_provisioning_events WHERE actor_id=actor AND occurred_at>clock_timestamp()-interval '1 minute')>=60 THEN RETURN public.sandy_provisioning_refusal(actor,customer,p_request_id,p_operation,input_hash,'provisioning_rate_limit',429);END IF;
 IF p_operation='customer.provisioning.features.list' THEN
  SELECT jsonb_build_object('features',coalesce(jsonb_agg(jsonb_build_object('feature_key',f.feature_key,'adapter',f.adapter,'enabled',f.enabled,'version',f.version,'description',f.description,'policy',(SELECT jsonb_build_object('enabled',p.enabled,'version',p.version,'resource_limit',p.resource_limit,'storage_bytes_limit',p.storage_bytes_limit,'purchase_budget_microusd',p.purchase_budget_microusd) FROM public.sandy_provisioning_customer_policies p WHERE p.customer_id=customer AND p.feature_key=f.feature_key),'entitled',EXISTS(SELECT 1 FROM public.sandy_commerce_entitlements e WHERE e.customer_id=customer AND e.feature_key=f.feature_key AND e.revoked_at IS NULL AND (e.expires_at IS NULL OR e.expires_at>clock_timestamp())))),'[]'::jsonb)) INTO data FROM public.sandy_provisioning_features f;
 ELSIF p_operation='customer.provisioning.templates.list' THEN
  SELECT jsonb_build_object('templates',coalesce(jsonb_agg(jsonb_build_object('template_key',t.template_key,'version',t.version,'feature_keys',to_jsonb(t.feature_keys))),'[]'::jsonb)) INTO data FROM public.sandy_provisioning_templates t WHERE t.enabled;
 ELSIF p_operation='customer.resources.list' THEN
  SELECT jsonb_build_object('resources',coalesce(jsonb_agg(to_jsonb(r) ORDER BY r.created_at),'[]'::jsonb)) INTO data FROM public.sandy_customer_resources r WHERE r.customer_id=customer;
 ELSIF p_operation='customer.provisioning.jobs.get' THEN
  SELECT * INTO job FROM public.sandy_customer_provisioning_jobs WHERE id=(p_arguments->>'job_id')::uuid AND customer_id=customer;
  IF NOT FOUND THEN RETURN public.sandy_provisioning_refusal(actor,customer,p_request_id,p_operation,input_hash,'provisioning_job_not_found',404);END IF;
  data:=jsonb_build_object('job',to_jsonb(job));
 ELSIF p_operation='customer.provisioning.plan' THEN
  SELECT * INTO template FROM public.sandy_provisioning_templates WHERE template_key=p_arguments->>'template_key' AND enabled;
  IF NOT FOUND THEN RETURN public.sandy_provisioning_refusal(actor,customer,p_request_id,p_operation,input_hash,'provisioning_template_unavailable',403);END IF;
  IF (SELECT count(DISTINCT k) FROM unnest(template.feature_keys) k)<>cardinality(template.feature_keys) THEN RETURN public.sandy_provisioning_refusal(actor,customer,p_request_id,p_operation,input_hash,'invalid_provisioning_template',503);END IF;
  FOREACH key IN ARRAY template.feature_keys LOOP
   SELECT * INTO feature FROM public.sandy_provisioning_features WHERE feature_key=key AND enabled;
   SELECT * INTO policy FROM public.sandy_provisioning_customer_policies WHERE customer_id=customer AND feature_key=key AND enabled;
   IF feature.feature_key IS NULL OR policy.customer_id IS NULL OR NOT EXISTS(SELECT 1 FROM public.sandy_commerce_entitlements e WHERE e.customer_id=customer AND e.feature_key=key AND e.revoked_at IS NULL AND (e.expires_at IS NULL OR e.expires_at>clock_timestamp())) THEN RETURN public.sandy_provisioning_refusal(actor,customer,p_request_id,p_operation,input_hash,'provisioning_feature_not_entitled',403);END IF;
   IF feature.adapter<>'supabase.workspace' OR policy.storage_bytes_limit>feature.max_storage_bytes OR policy.purchase_budget_microusd<feature.estimated_purchase_cost_microusd THEN RETURN public.sandy_provisioning_refusal(actor,customer,p_request_id,p_operation,input_hash,'provisioning_policy_denied',403);END IF;
   SELECT * INTO resource FROM public.sandy_customer_resources WHERE customer_id=customer AND feature_key=key AND state<>'decommissioned';
   IF resource.id IS NOT NULL AND NOT public.sandy_provisioning_workspace_verified(resource.id) THEN RETURN public.sandy_provisioning_refusal(actor,customer,p_request_id,p_operation,input_hash,'existing_resource_reconciliation_required',409);END IF;
   IF resource.id IS NULL AND (policy.resource_limit=0 OR (SELECT count(*) FROM public.sandy_customer_resources WHERE customer_id=customer AND state<>'decommissioned')>=10) THEN RETURN public.sandy_provisioning_refusal(actor,customer,p_request_id,p_operation,input_hash,'provisioning_resource_quota_exceeded',429);END IF;
   snapshot:=snapshot||jsonb_build_array(jsonb_build_object('feature_key',key,'feature_version',feature.version,'policy_version',policy.version,'storage_bytes_limit',policy.storage_bytes_limit,'existing_resource_id',resource.id));
  END LOOP;
  IF (SELECT count(*) FROM public.sandy_customer_resources WHERE customer_id=customer AND state<>'decommissioned')+(SELECT count(*) FROM jsonb_array_elements(snapshot) item WHERE item->>'existing_resource_id' IS NULL)>10 THEN RETURN public.sandy_provisioning_refusal(actor,customer,p_request_id,p_operation,input_hash,'provisioning_resource_quota_exceeded',429);END IF;
  INSERT INTO public.sandy_customer_provisioning_plans(customer_id,template_key,template_version,snapshot,snapshot_sha256) VALUES(customer,template.template_key,template.version,snapshot,encode(extensions.digest(convert_to(snapshot::text,'UTF8'),'sha256'),'hex')) RETURNING * INTO plan;
  data:=jsonb_build_object('plan',jsonb_build_object('id',plan.id,'template_key',plan.template_key,'snapshot_sha256',plan.snapshot_sha256,'expires_at',plan.expires_at,'steps',plan.snapshot,'estimated_purchase_cost_microusd',0,'actual_provider_cost_known',false));
 ELSIF p_operation='customer.provisioning.execute' THEN
  SELECT * INTO plan FROM public.sandy_customer_provisioning_plans WHERE id=(p_arguments->>'plan_id')::uuid AND customer_id=customer FOR UPDATE;
  IF NOT FOUND OR plan.snapshot_sha256 IS DISTINCT FROM p_arguments->>'plan_sha256' THEN RETURN public.sandy_provisioning_refusal(actor,customer,p_request_id,p_operation,input_hash,'provisioning_plan_not_found',404);END IF;
  SELECT * INTO job FROM public.sandy_customer_provisioning_jobs WHERE plan_id=plan.id AND customer_id=customer;
  IF FOUND THEN
   IF job.state<>'succeeded' THEN RETURN public.sandy_provisioning_refusal(actor,customer,p_request_id,p_operation,input_hash,'provisioning_previous_attempt_failed',409,job.id);END IF;
   data:=jsonb_build_object('job',to_jsonb(job));reused:=true;
  ELSE
   SELECT * INTO template FROM public.sandy_provisioning_templates WHERE template_key=plan.template_key AND version=plan.template_version AND enabled FOR SHARE;
   IF plan.expires_at<=clock_timestamp() OR template.template_key IS NULL THEN RETURN public.sandy_provisioning_refusal(actor,customer,p_request_id,p_operation,input_hash,'provisioning_plan_stale',409);END IF;
   -- Revalidate the entire immutable plan before creating any resource.
   FOR step IN SELECT value FROM jsonb_array_elements(plan.snapshot) LOOP
    SELECT * INTO feature FROM public.sandy_provisioning_features WHERE feature_key=step->>'feature_key' AND enabled AND version=(step->>'feature_version')::integer FOR SHARE;
    SELECT * INTO policy FROM public.sandy_provisioning_customer_policies WHERE customer_id=customer AND feature_key=step->>'feature_key' AND enabled AND version=(step->>'policy_version')::integer FOR SHARE;
    PERFORM 1 FROM public.sandy_commerce_entitlements e WHERE e.customer_id=customer AND e.feature_key=step->>'feature_key' AND e.revoked_at IS NULL AND (e.expires_at IS NULL OR e.expires_at>clock_timestamp()) FOR SHARE;
    IF NOT FOUND THEN RETURN public.sandy_provisioning_refusal(actor,customer,p_request_id,p_operation,input_hash,'provisioning_policy_changed',409);END IF;
    IF feature.feature_key IS NULL OR policy.customer_id IS NULL OR policy.storage_bytes_limit<>(step->>'storage_bytes_limit')::bigint OR NOT EXISTS(SELECT 1 FROM public.sandy_commerce_entitlements e WHERE e.customer_id=customer AND e.feature_key=step->>'feature_key' AND e.revoked_at IS NULL AND (e.expires_at IS NULL OR e.expires_at>clock_timestamp())) THEN RETURN public.sandy_provisioning_refusal(actor,customer,p_request_id,p_operation,input_hash,'provisioning_policy_changed',409);END IF;
    SELECT * INTO resource FROM public.sandy_customer_resources WHERE customer_id=customer AND feature_key=feature.feature_key AND state<>'decommissioned';
    IF resource.id IS DISTINCT FROM (step->>'existing_resource_id')::uuid THEN RETURN public.sandy_provisioning_refusal(actor,customer,p_request_id,p_operation,input_hash,'provisioning_resource_changed',409);END IF;
    IF resource.id IS NULL AND (policy.resource_limit=0 OR (SELECT count(*) FROM public.sandy_customer_resources WHERE customer_id=customer AND state<>'decommissioned')+(SELECT count(*) FROM jsonb_array_elements(plan.snapshot) item WHERE item->>'existing_resource_id' IS NULL)>10) THEN RETURN public.sandy_provisioning_refusal(actor,customer,p_request_id,p_operation,input_hash,'provisioning_resource_quota_exceeded',429);END IF;
    IF resource.id IS NOT NULL AND NOT public.sandy_provisioning_workspace_verified(resource.id) THEN RETURN public.sandy_provisioning_refusal(actor,customer,p_request_id,p_operation,input_hash,'existing_resource_reconciliation_required',409);END IF;
   END LOOP;
   FOR step IN SELECT value FROM jsonb_array_elements(plan.snapshot) LOOP
    SELECT * INTO resource FROM public.sandy_customer_resources WHERE customer_id=customer AND feature_key=step->>'feature_key' AND state<>'decommissioned';
    IF resource.id IS NULL THEN
     resource_id:=gen_random_uuid();table_name:='sandy_workspace_'||replace(resource_id::text,'-','');
     INSERT INTO public.sandy_customer_resources(id,customer_id,feature_key,adapter,provider_resource_id,state,storage_bytes_limit) VALUES(resource_id,customer,step->>'feature_key','supabase.workspace','public.'||table_name,'ready',(step->>'storage_bytes_limit')::bigint) RETURNING * INTO resource;
     EXECUTE format('CREATE TABLE public.%I (record_key text PRIMARY KEY CHECK(record_key~%L),value jsonb NOT NULL CHECK(jsonb_typeof(value)=%L AND octet_length(value::text)<=65536),version integer NOT NULL DEFAULT 1,updated_at timestamptz NOT NULL DEFAULT clock_timestamp())',table_name,'^[A-Za-z0-9][A-Za-z0-9_.-]{0,79}$','object');
     EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',table_name);EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY',table_name);
     EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC,anon,authenticated,service_role',table_name);
     EXECUTE format('CREATE POLICY deny_direct_access ON public.%I FOR ALL USING(false) WITH CHECK(false)',table_name);
     EXECUTE format('COMMENT ON TABLE public.%I IS %L',table_name,'sandy_customer_resource:'||resource.id||':'||customer);
     IF NOT public.sandy_provisioning_workspace_verified(resource.id) THEN RAISE EXCEPTION 'workspace verification failed';END IF;
     UPDATE public.sandy_customer_resources SET verified_at=clock_timestamp(),provider_storage_bytes=pg_total_relation_size(to_regclass(provider_resource_id)) WHERE id=resource.id;
    END IF;
    ids:=array_append(ids,resource.id);
   END LOOP;
   INSERT INTO public.sandy_customer_provisioning_jobs(customer_id,plan_id,kind,state,resource_ids) VALUES(customer,plan.id,'provision','succeeded',ids) RETURNING * INTO job;
   data:=jsonb_build_object('job',to_jsonb(job));
  END IF;
 ELSE
  SELECT * INTO resource FROM public.sandy_customer_resources WHERE id=(p_arguments->>'resource_id')::uuid AND customer_id=customer FOR UPDATE;
  IF NOT FOUND THEN RETURN public.sandy_provisioning_refusal(actor,customer,p_request_id,p_operation,input_hash,'customer_resource_not_found',404);END IF;
  table_name:='sandy_workspace_'||replace(resource.id::text,'-','');
  IF resource.provider_resource_id<>'public.'||table_name THEN RETURN public.sandy_provisioning_refusal(actor,customer,p_request_id,p_operation,input_hash,'resource_identity_mismatch',409);END IF;
  IF p_operation='customer.resources.reconcile' THEN
   IF resource.state<>'decommissioned' THEN
    UPDATE public.sandy_customer_resources SET state=CASE WHEN public.sandy_provisioning_workspace_verified(id) THEN 'ready' ELSE 'drifted' END,verified_at=clock_timestamp(),version=version+1,updated_at=clock_timestamp(),provider_storage_bytes=CASE WHEN to_regclass(provider_resource_id) IS NULL THEN NULL ELSE pg_total_relation_size(to_regclass(provider_resource_id)) END WHERE id=resource.id RETURNING * INTO resource;
   ELSIF to_regclass(resource.provider_resource_id) IS NOT NULL THEN RETURN public.sandy_provisioning_refusal(actor,customer,p_request_id,p_operation,input_hash,'decommissioned_resource_reappeared',409);END IF;
   data:=jsonb_build_object('resource',to_jsonb(resource),'effect_confirmed',resource.state IN('ready','decommissioned'));
  ELSIF p_operation='customer.resources.decommission' THEN
   IF p_arguments->'delete_data' IS DISTINCT FROM 'true'::jsonb THEN RETURN public.sandy_provisioning_refusal(actor,customer,p_request_id,p_operation,input_hash,'explicit_data_deletion_required',403);END IF;
   IF resource.version<>(p_arguments->>'expected_version')::integer THEN RETURN public.sandy_provisioning_refusal(actor,customer,p_request_id,p_operation,input_hash,'resource_version_conflict',409);END IF;
   relation:=to_regclass(resource.provider_resource_id);
   IF relation IS NOT NULL AND obj_description(relation,'pg_class') IS DISTINCT FROM 'sandy_customer_resource:'||resource.id||':'||customer THEN RETURN public.sandy_provisioning_refusal(actor,customer,p_request_id,p_operation,input_hash,'resource_identity_mismatch',409);END IF;
   IF relation IS NOT NULL THEN EXECUTE format('DROP TABLE public.%I',table_name);END IF;
   IF to_regclass(resource.provider_resource_id) IS NOT NULL THEN RAISE EXCEPTION 'workspace decommission verification failed';END IF;
   UPDATE public.sandy_customer_resources SET state='decommissioned',version=version+1,decommissioned_at=clock_timestamp(),updated_at=clock_timestamp(),verified_at=clock_timestamp(),logical_storage_bytes=0,provider_storage_bytes=0 WHERE id=resource.id RETURNING * INTO resource;
   INSERT INTO public.sandy_customer_provisioning_jobs(customer_id,kind,state,resource_ids) VALUES(customer,'decommission','succeeded',ARRAY[resource.id]) RETURNING * INTO job;
   data:=jsonb_build_object('resource',to_jsonb(resource),'job',to_jsonb(job),'effect_confirmed',true);
  ELSIF p_operation='customer.resources.recover' THEN
   IF resource.state='decommissioned' OR resource.version<>(p_arguments->>'expected_version')::integer THEN RETURN public.sandy_provisioning_refusal(actor,customer,p_request_id,p_operation,input_hash,'resource_version_conflict',409);END IF;
   relation:=to_regclass(resource.provider_resource_id);
   IF relation IS NULL OR obj_description(relation,'pg_class') IS DISTINCT FROM 'sandy_customer_resource:'||resource.id||':'||customer THEN RETURN public.sandy_provisioning_refusal(actor,customer,p_request_id,p_operation,input_hash,'resource_recovery_requires_manual_investigation',409);END IF;
   EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',table_name);EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY',table_name);EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC,anon,authenticated,service_role',table_name);
   IF NOT public.sandy_provisioning_workspace_verified(resource.id) THEN RAISE EXCEPTION 'workspace recovery verification failed';END IF;
   UPDATE public.sandy_customer_resources SET state='ready',version=version+1,verified_at=clock_timestamp(),updated_at=clock_timestamp() WHERE id=resource.id RETURNING * INTO resource;
   INSERT INTO public.sandy_customer_provisioning_jobs(customer_id,kind,state,resource_ids) VALUES(customer,'recover','succeeded',ARRAY[resource.id]) RETURNING * INTO job;
   data:=jsonb_build_object('resource',to_jsonb(resource),'job',to_jsonb(job),'effect_confirmed',true);
  ELSE
   IF resource.state<>'ready' OR NOT public.sandy_provisioning_workspace_verified(resource.id) THEN RETURN public.sandy_provisioning_refusal(actor,customer,p_request_id,p_operation,input_hash,'resource_reconciliation_required',409);END IF;
   IF p_operation='customer.workspace.records.upsert' THEN
    SELECT * INTO feature FROM public.sandy_provisioning_features WHERE feature_key=resource.feature_key AND enabled FOR SHARE;
    SELECT * INTO policy FROM public.sandy_provisioning_customer_policies WHERE customer_id=customer AND feature_key=resource.feature_key AND enabled FOR SHARE;
    PERFORM 1 FROM public.sandy_commerce_entitlements e WHERE e.customer_id=customer AND e.feature_key=resource.feature_key AND e.revoked_at IS NULL AND (e.expires_at IS NULL OR e.expires_at>clock_timestamp()) FOR SHARE;
    IF NOT FOUND OR feature.feature_key IS NULL OR policy.customer_id IS NULL THEN RETURN public.sandy_provisioning_refusal(actor,customer,p_request_id,p_operation,input_hash,'provisioning_feature_not_entitled',403);END IF;
    resource.storage_bytes_limit:=least(resource.storage_bytes_limit,policy.storage_bytes_limit,feature.max_storage_bytes);
   END IF;
   EXECUTE format('SELECT value,version FROM public.%I WHERE record_key=$1',table_name) INTO record_value,record_version USING p_arguments->>'key';
   IF p_operation='customer.workspace.records.get' THEN
    IF record_version IS NULL THEN RETURN public.sandy_provisioning_refusal(actor,customer,p_request_id,p_operation,input_hash,'workspace_record_not_found',404);END IF;
    data:=jsonb_build_object('resource_id',resource.id,'record',jsonb_build_object('key',p_arguments->>'key','value',record_value,'version',record_version));
   ELSE
    IF coalesce(record_version,0)<>(p_arguments->>'expected_version')::integer THEN RETURN public.sandy_provisioning_refusal(actor,customer,p_request_id,p_operation,input_hash,'workspace_record_version_conflict',409);END IF;
    IF p_operation='customer.workspace.records.delete' THEN
     IF record_version IS NULL THEN RETURN public.sandy_provisioning_refusal(actor,customer,p_request_id,p_operation,input_hash,'workspace_record_not_found',404);END IF;
     EXECUTE format('DELETE FROM public.%I WHERE record_key=$1',table_name) USING p_arguments->>'key';
     data:=jsonb_build_object('resource_id',resource.id,'key',p_arguments->>'key','deleted',true);
    ELSE
     EXECUTE format('SELECT coalesce(sum(octet_length(value::text)),0),count(*) FROM public.%I',table_name) INTO used_bytes,rows_count;
     IF used_bytes-coalesce(octet_length(record_value::text),0)+octet_length((p_arguments->'value')::text)>resource.storage_bytes_limit OR (record_version IS NULL AND rows_count>=1000) THEN RETURN public.sandy_provisioning_refusal(actor,customer,p_request_id,p_operation,input_hash,'workspace_storage_quota_exceeded',429);END IF;
     record_version:=coalesce(record_version,0)+1;
     EXECUTE format('INSERT INTO public.%I(record_key,value,version) VALUES($1,$2,$3) ON CONFLICT(record_key) DO UPDATE SET value=excluded.value,version=excluded.version,updated_at=clock_timestamp()',table_name) USING p_arguments->>'key',p_arguments->'value',record_version;
     data:=jsonb_build_object('resource_id',resource.id,'key',p_arguments->>'key','version',record_version);
    END IF;
    EXECUTE format('SELECT coalesce(sum(octet_length(value::text)),0) FROM public.%I',table_name) INTO used_bytes;
    UPDATE public.sandy_customer_resources SET logical_storage_bytes=used_bytes,provider_storage_bytes=pg_total_relation_size(to_regclass(provider_resource_id)),version=version+1,updated_at=clock_timestamp() WHERE id=resource.id;
   END IF;
  END IF;
 END IF;
 result:=jsonb_build_object('ok',true,'contract_version','1.0.0','executed',true,'request_state','succeeded','request_id',p_request_id,'reused',reused,'reconciliation_required',false,'result',data);
 IF mutation THEN INSERT INTO public.sandy_customer_provisioning_receipts(actor_id,request_id,operation,input_sha256,result) VALUES(actor,p_request_id,p_operation,input_hash,result);END IF;
 INSERT INTO public.sandy_customer_provisioning_events(actor_id,customer_id,request_id,operation,resource_id,input_sha256) VALUES(actor,customer,p_request_id,p_operation,resource.id,input_hash);
 RETURN result;
EXCEPTION WHEN data_exception THEN RETURN public.sandy_provisioning_refusal(actor,customer,p_request_id,p_operation,input_hash,'invalid_provisioning_arguments',400);
WHEN OTHERS THEN
 -- Every provider effect in the installed database adapter is transactional.
 -- This exception block has rolled back its entire body before recording the
 -- failed job. No raw SQL error, arguments, record data or credentials are logged.
 IF customer IS NOT NULL THEN PERFORM pg_advisory_xact_lock(hashtextextended('sandy-provisioning-customer:'||customer,0));END IF;
 IF customer IS NOT NULL AND p_operation IN('customer.provisioning.execute','customer.resources.recover','customer.resources.decommission') THEN
  INSERT INTO public.sandy_customer_provisioning_jobs(customer_id,plan_id,kind,state,resource_ids,error_code) VALUES(customer,CASE WHEN p_operation='customer.provisioning.execute' THEN plan.id ELSE NULL END,CASE p_operation WHEN 'customer.provisioning.execute' THEN 'provision' WHEN 'customer.resources.recover' THEN 'recover' ELSE 'decommission' END,'failed',CASE WHEN p_operation='customer.provisioning.execute' OR resource.id IS NULL THEN ARRAY[]::uuid[] ELSE ARRAY[resource.id] END,'provisioning_transaction_failed') ON CONFLICT(plan_id) DO NOTHING RETURNING * INTO job;
  IF job.id IS NULL AND plan.id IS NOT NULL THEN SELECT * INTO job FROM public.sandy_customer_provisioning_jobs WHERE plan_id=plan.id AND customer_id=customer;END IF;
 END IF;
 result:=public.sandy_provisioning_refusal(actor,customer,p_request_id,p_operation,input_hash,'provisioning_transaction_failed',503,job.id);
 IF mutation AND actor IS NOT NULL AND p_request_id IS NOT NULL AND input_hash IS NOT NULL THEN INSERT INTO public.sandy_customer_provisioning_receipts(actor_id,request_id,operation,input_sha256,result) VALUES(actor,p_request_id,p_operation,input_hash,result) ON CONFLICT DO NOTHING;END IF;
 RETURN result;

END $$;
REVOKE ALL ON FUNCTION public.sandy_customer_provisioning_execute(text,jsonb,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.sandy_customer_provisioning_execute(text,jsonb,uuid) TO authenticated;
COMMIT;
