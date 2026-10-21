-- Existing opaque customer keys are their own principals, never Auth users.
-- Reuse the central one-use admissions, result receipts and append-only audit;
-- the established Auth-owner admission/credential RPCs remain unchanged.
BEGIN;
ALTER TABLE public.sandy_api_execution_admissions ALTER COLUMN actor_id DROP NOT NULL;
ALTER TABLE public.sandy_api_execution_admissions
 ADD COLUMN principal_kind text NOT NULL DEFAULT 'auth_user',
 ADD COLUMN customer_key_id uuid,
 ADD COLUMN customer_key_revision_sha256 text,
 ADD COLUMN customer_key_channel text,
 ADD CONSTRAINT sandy_api_admission_principal_kind CHECK (
  (principal_kind='auth_user' AND actor_id IS NOT NULL AND customer_key_id IS NULL
   AND customer_key_revision_sha256 IS NULL AND customer_key_channel IS NULL)
  OR (principal_kind='customer_key' AND actor_id IS NULL AND tenant_id IS NOT NULL
   AND customer_key_id IS NOT NULL AND customer_key_revision_sha256 IS NOT NULL AND customer_key_revision_sha256 ~ '^[a-f0-9]{64}$'
   AND customer_key_channel IS NOT NULL AND customer_key_channel IN ('api','mcp') AND credential_id IS NULL AND approval_id IS NULL AND NOT is_mutation AND state<>'accepted'));
-- No new foreign key is added to the pre-existing, independently managed key
-- table. Revoked/deleted keys cannot authenticate; historic evidence is retained.
CREATE UNIQUE INDEX sandy_api_customer_key_request_idx ON public.sandy_api_execution_admissions(customer_key_id,request_id)
 WHERE principal_kind='customer_key';
CREATE FUNCTION public.sandy_api_customer_key_identity_immutable() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,pg_temp AS $$
BEGIN
 IF NEW.principal_kind IS DISTINCT FROM OLD.principal_kind OR NEW.actor_id IS DISTINCT FROM OLD.actor_id
 OR NEW.tenant_id IS DISTINCT FROM OLD.tenant_id OR NEW.credential_id IS DISTINCT FROM OLD.credential_id
 OR NEW.customer_key_id IS DISTINCT FROM OLD.customer_key_id
 OR NEW.customer_key_revision_sha256 IS DISTINCT FROM OLD.customer_key_revision_sha256
 OR NEW.customer_key_channel IS DISTINCT FROM OLD.customer_key_channel THEN
  RAISE EXCEPTION 'sandy_api_admission_identity_immutable' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER sandy_api_admission_identity_immutable BEFORE UPDATE ON public.sandy_api_execution_admissions
 FOR EACH ROW EXECUTE FUNCTION public.sandy_api_customer_key_identity_immutable();
CREATE TABLE public.sandy_api_customer_key_rate_windows (
 customer_id uuid NOT NULL, bucket text NOT NULL, window_start timestamptz NOT NULL,
 requests integer NOT NULL CHECK(requests>=0), PRIMARY KEY(customer_id,bucket,window_start)
);
ALTER TABLE public.sandy_api_customer_key_rate_windows ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.sandy_api_customer_key_rate_windows FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.sandy_api_customer_key_operation_scope(p_operation text) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path=pg_catalog,pg_temp AS $$
 SELECT CASE WHEN p_operation IN ('tasks.list','tasks.get') THEN 'tasks:read'
 WHEN p_operation IN ('calendar.list','calendar.get','calendar.conflicts') THEN 'calendar:read'
 WHEN p_operation IN ('files.list','files.get','files.search') THEN 'files:read' END
$$;
CREATE FUNCTION public.sandy_api_customer_key_revision(p_key public.sandy_operations_keys) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path=pg_catalog,pg_temp AS $$
 SELECT encode(extensions.digest(jsonb_build_object('id',(p_key).id,'customer_id',(p_key).customer_id,
  'scopes',(p_key).scopes,'expires_at',to_char((p_key).expires_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
  'revoked_at',to_char((p_key).revoked_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'))::text,'sha256'),'hex')
$$;
CREATE FUNCTION public.sandy_api_customer_key_scope_sha256(p_key_id uuid,p_customer_id uuid,p_scope text,p_revision text) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path=pg_catalog,pg_temp AS $$
 SELECT encode(extensions.digest('sandy_customer_key_v1:'||p_key_id::text||':'||p_customer_id::text||':'||p_scope||':'||p_revision,'sha256'),'hex')
$$;
CREATE FUNCTION public.sandy_api_customer_key_policy(p_key public.sandy_operations_keys,p_operation text,p_channel text,p_revision text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
 SELECT coalesce((p_key).id IS NOT NULL AND (p_key).customer_id IS NOT NULL AND (p_key).revoked_at IS NULL
 AND ((p_key).expires_at IS NULL OR (p_key).expires_at>clock_timestamp())
 AND cardinality((p_key).scopes) BETWEEN 1 AND 6 AND NOT EXISTS(SELECT 1 FROM unnest((p_key).scopes) s
 WHERE s IS NULL OR s NOT IN ('tasks:read','tasks:write','calendar:read','calendar:write','files:read','files:write'))
 AND public.sandy_api_customer_key_operation_scope(p_operation)=ANY((p_key).scopes)
 AND public.sandy_api_customer_key_revision(p_key)=p_revision AND p_channel IN ('api','mcp')
 AND EXISTS(SELECT 1 FROM public.sandy_operation_registry r WHERE r.operation=p_operation AND r.api_exposed
  AND (p_channel='api' OR r.ai_exposed) AND r.handler='sandy-operations-api' AND r.is_mutation=false
  AND r.permission_scope=public.sandy_api_customer_key_operation_scope(p_operation)
  AND r.error_contract->>'requires_approval' IS DISTINCT FROM 'true'),false)
$$;
CREATE FUNCTION public.sandy_api_authenticate_customer_key(p_secret_sha256 text) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE key_row public.sandy_operations_keys; allowed text[]; normalized_scopes text[];
BEGIN
 IF p_secret_sha256 IS NULL OR p_secret_sha256 !~ '^[a-f0-9]{64}$' THEN
  RETURN jsonb_build_object('ok',false,'error','invalid_customer_key','http_status',401); END IF;
 SELECT * INTO key_row FROM public.sandy_operations_keys WHERE key_hash=p_secret_sha256;
 IF key_row.id IS NULL OR key_row.customer_id IS NULL OR key_row.revoked_at IS NOT NULL
 OR (key_row.expires_at IS NOT NULL AND key_row.expires_at<=clock_timestamp())
 OR cardinality(key_row.scopes) NOT BETWEEN 1 AND 6 OR EXISTS(SELECT 1 FROM unnest(key_row.scopes) s
 WHERE s IS NULL OR s NOT IN ('tasks:read','tasks:write','calendar:read','calendar:write','files:read','files:write')) THEN
  RETURN jsonb_build_object('ok',false,'error','invalid_customer_key','http_status',401); END IF;
 SELECT array_agg(DISTINCT s ORDER BY s) INTO normalized_scopes FROM unnest(key_row.scopes) s;
 SELECT coalesce(array_agg(o ORDER BY o),'{}'::text[]) INTO allowed FROM unnest(ARRAY['tasks.list','tasks.get','calendar.list','calendar.get','calendar.conflicts','files.list','files.get','files.search']) o
 WHERE public.sandy_api_customer_key_operation_scope(o)=ANY(normalized_scopes);
 RETURN jsonb_build_object('ok',true,'kind','customer_key','key_id',key_row.id,'customer_id',key_row.customer_id,
 'scopes',normalized_scopes,'allowed_operations',allowed,'key_revision_sha256',public.sandy_api_customer_key_revision(key_row),'expires_at',key_row.expires_at);
END $$;

CREATE FUNCTION public.sandy_api_admit_customer_key_execution(p_key_id uuid,p_customer_id uuid,p_secret_sha256 text,p_key_revision_sha256 text,
 p_operation text,p_channel text,p_input_sha256 text,p_request_id uuid,p_contract_sha256 text,p_scope_sha256 text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE key_row public.sandy_operations_keys; entry public.sandy_operation_registry; prior public.sandy_api_execution_admissions;
 admission public.sandy_api_execution_admissions; active_window timestamptz:=date_trunc('minute',clock_timestamp()); counter integer;
BEGIN
 IF p_key_id IS NULL OR p_customer_id IS NULL OR p_request_id IS NULL OR p_secret_sha256 IS NULL OR p_secret_sha256 !~ '^[a-f0-9]{64}$'
 OR p_key_revision_sha256 IS NULL OR p_key_revision_sha256 !~ '^[a-f0-9]{64}$' OR p_input_sha256 IS NULL OR p_input_sha256 !~ '^[a-f0-9]{64}$'
 OR p_contract_sha256 IS NULL OR p_contract_sha256 !~ '^[a-f0-9]{64}$' OR p_scope_sha256 IS NULL OR p_scope_sha256 !~ '^[a-f0-9]{64}$' THEN
  RETURN jsonb_build_object('ok',false,'error','invalid_customer_key_admission','http_status',400); END IF;
 SELECT * INTO key_row FROM public.sandy_operations_keys WHERE id=p_key_id FOR SHARE;
 SELECT * INTO entry FROM public.sandy_operation_registry WHERE operation=p_operation FOR SHARE;
 IF key_row.id IS NULL OR key_row.customer_id IS DISTINCT FROM p_customer_id OR key_row.key_hash IS DISTINCT FROM p_secret_sha256
 OR NOT public.sandy_api_customer_key_policy(key_row,p_operation,p_channel,p_key_revision_sha256) THEN
  RETURN jsonb_build_object('ok',false,'error','customer_key_scope_denied','http_status',403); END IF;
 IF p_scope_sha256 IS DISTINCT FROM public.sandy_api_customer_key_scope_sha256(p_key_id,p_customer_id,entry.permission_scope,p_key_revision_sha256)
 OR (entry.error_contract ? 'contract_sha256' AND entry.error_contract->>'contract_sha256' IS DISTINCT FROM p_contract_sha256) THEN
  RETURN jsonb_build_object('ok',false,'error','customer_key_contract_changed','http_status',409); END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('customer_key:'||p_key_id::text||':'||p_request_id::text,0));
 SELECT * INTO prior FROM public.sandy_api_execution_admissions WHERE principal_kind='customer_key' AND customer_key_id=p_key_id AND request_id=p_request_id;
 IF prior.id IS NOT NULL THEN
  IF prior.tenant_id IS DISTINCT FROM p_customer_id OR prior.operation IS DISTINCT FROM p_operation OR prior.input_sha256 IS DISTINCT FROM p_input_sha256
  OR prior.contract_sha256 IS DISTINCT FROM p_contract_sha256 OR prior.scope_sha256 IS DISTINCT FROM p_scope_sha256
  OR prior.customer_key_revision_sha256 IS DISTINCT FROM p_key_revision_sha256 OR prior.customer_key_channel IS DISTINCT FROM p_channel THEN
   RETURN jsonb_build_object('ok',false,'error','request_id_conflict','http_status',409); END IF;
  RETURN jsonb_build_object('ok',false,'error','admission_already_recorded','http_status',409); END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('customer_key_tenant:'||p_customer_id::text,0));
 INSERT INTO public.sandy_api_customer_key_rate_windows(customer_id,bucket,window_start,requests)
 VALUES(p_customer_id,'tenant',active_window,0),(p_customer_id,p_key_id::text,active_window,0) ON CONFLICT DO NOTHING;
 SELECT max(requests) INTO counter FROM public.sandy_api_customer_key_rate_windows WHERE customer_id=p_customer_id AND window_start=active_window AND bucket IN ('tenant',p_key_id::text);
 IF counter>=60 THEN RETURN jsonb_build_object('ok',false,'error','customer_key_rate_exceeded','http_status',429); END IF;
 INSERT INTO public.sandy_api_execution_admissions(actor_id,tenant_id,principal_kind,customer_key_id,customer_key_revision_sha256,customer_key_channel,
 operation,request_id,is_mutation,input_sha256,contract_sha256,scope_sha256,registry_revision_sha256,declared_cost_units,expires_at)
 VALUES(NULL,p_customer_id,'customer_key',p_key_id,p_key_revision_sha256,p_channel,p_operation,p_request_id,false,p_input_sha256,p_contract_sha256,p_scope_sha256,
 public.sandy_api_registry_revision(p_operation),0,least(clock_timestamp()+interval '60 seconds',coalesce(key_row.expires_at,'infinity'::timestamptz))) RETURNING * INTO admission;
 UPDATE public.sandy_api_customer_key_rate_windows SET requests=requests+1 WHERE customer_id=p_customer_id AND window_start=active_window AND bucket IN ('tenant',p_key_id::text);
 PERFORM public.sandy_api_append_audit(NULL,p_operation,p_request_id,p_key_id,admission.id,'customer_key_admission','admitted',p_input_sha256,p_scope_sha256);
 RETURN jsonb_build_object('ok',true,'allowed',true,'reused',false,'principal_kind','customer_key','customer_key_id',p_key_id,'tenant_id',p_customer_id,
 'admission_id',admission.id,'grant_id',admission.grant_id,'state','admitted','executed',false,'expires_at',admission.expires_at);
END $$;
CREATE FUNCTION public.sandy_api_consume_customer_key_grant(p_grant_id uuid,p_key_id uuid,p_customer_id uuid,p_secret_sha256 text,p_key_revision_sha256 text,
 p_operation text,p_channel text,p_input_sha256 text,p_request_id uuid,p_contract_sha256 text,p_scope_sha256 text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE admission public.sandy_api_execution_admissions; key_row public.sandy_operations_keys; entry public.sandy_operation_registry;
BEGIN
 SELECT * INTO admission FROM public.sandy_api_execution_admissions WHERE grant_id=p_grant_id FOR UPDATE;
 IF admission.id IS NULL OR admission.principal_kind IS DISTINCT FROM 'customer_key' OR admission.actor_id IS NOT NULL
 OR admission.customer_key_id IS DISTINCT FROM p_key_id OR admission.tenant_id IS DISTINCT FROM p_customer_id
 OR admission.customer_key_revision_sha256 IS DISTINCT FROM p_key_revision_sha256 OR admission.customer_key_channel IS DISTINCT FROM p_channel
 OR admission.operation IS DISTINCT FROM p_operation OR admission.input_sha256 IS DISTINCT FROM p_input_sha256 OR admission.request_id IS DISTINCT FROM p_request_id
 OR admission.contract_sha256 IS DISTINCT FROM p_contract_sha256 OR admission.scope_sha256 IS DISTINCT FROM p_scope_sha256 THEN
  RETURN jsonb_build_object('ok',false,'error','customer_key_grant_scope_denied','http_status',403); END IF;
 IF admission.state<>'admitted' OR admission.expires_at<=clock_timestamp() THEN
  RETURN jsonb_build_object('ok',false,'error','customer_key_grant_used_or_expired','http_status',409); END IF;
 SELECT * INTO key_row FROM public.sandy_operations_keys WHERE id=p_key_id FOR SHARE;
 SELECT * INTO entry FROM public.sandy_operation_registry WHERE operation=p_operation FOR SHARE;
 IF key_row.id IS NULL OR key_row.customer_id IS DISTINCT FROM p_customer_id OR key_row.key_hash IS DISTINCT FROM p_secret_sha256
 OR NOT public.sandy_api_customer_key_policy(key_row,p_operation,p_channel,p_key_revision_sha256) THEN
  RETURN jsonb_build_object('ok',false,'error','customer_key_scope_denied','http_status',403); END IF;
 IF admission.registry_revision_sha256 IS DISTINCT FROM public.sandy_api_registry_revision(p_operation) THEN
  RETURN jsonb_build_object('ok',false,'error','customer_key_contract_changed','http_status',409); END IF;
 UPDATE public.sandy_api_execution_admissions SET state='consumed',consumed_at=clock_timestamp() WHERE id=admission.id;
 PERFORM public.sandy_api_append_audit(NULL,p_operation,p_request_id,p_key_id,admission.id,'customer_key_grant','consumed',p_input_sha256,p_scope_sha256);
 RETURN jsonb_build_object('ok',true,'allowed',true,'reused',false,'admission_id',admission.id);
END $$;
CREATE FUNCTION public.sandy_api_get_customer_key_receipt(p_key_id uuid,p_customer_id uuid,p_secret_sha256 text,p_request_id uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE key_row public.sandy_operations_keys; admission public.sandy_api_execution_admissions;
BEGIN
 SELECT * INTO key_row FROM public.sandy_operations_keys WHERE id=p_key_id;
 IF key_row.id IS NULL OR key_row.customer_id IS DISTINCT FROM p_customer_id OR p_secret_sha256 IS NULL OR key_row.key_hash IS DISTINCT FROM p_secret_sha256
 OR key_row.revoked_at IS NOT NULL OR (key_row.expires_at IS NOT NULL AND key_row.expires_at<=clock_timestamp()) THEN
  RETURN jsonb_build_object('ok',false,'error','invalid_customer_key','http_status',401); END IF;
 SELECT * INTO admission FROM public.sandy_api_execution_admissions WHERE principal_kind='customer_key' AND customer_key_id=p_key_id AND tenant_id=p_customer_id AND request_id=p_request_id;
 IF admission.id IS NULL OR NOT coalesce(public.sandy_api_customer_key_operation_scope(admission.operation)=ANY(key_row.scopes),false) THEN
  RETURN jsonb_build_object('ok',false,'error','admission_not_found','http_status',404); END IF;
 RETURN jsonb_build_object('ok',true,'admission_id',admission.id,'request_id',admission.request_id,'operation',admission.operation,
 'request_state',admission.state,'accepted',false,'executed',CASE WHEN admission.state IN ('succeeded','failed') THEN 'true'::jsonb WHEN admission.state IN ('consumed','unknown') THEN 'null'::jsonb ELSE 'false'::jsonb END,
 'completed',admission.state='succeeded','outcome',CASE WHEN admission.state IN ('admitted','consumed') THEN 'pending' ELSE admission.state END,
 'provider_http_status',admission.provider_http_status,'provider_request_id_sha256',admission.provider_request_id_sha256,'result_sha256',admission.result_sha256,
 'reconciliation_required',admission.state IN ('consumed','unknown'),'redispatch_permitted',false,'created_at',admission.created_at,'finished_at',admission.finished_at);
END $$;
REVOKE ALL ON FUNCTION public.sandy_api_customer_key_identity_immutable(),public.sandy_api_customer_key_operation_scope(text),
 public.sandy_api_customer_key_revision(public.sandy_operations_keys),public.sandy_api_customer_key_scope_sha256(uuid,uuid,text,text),
 public.sandy_api_customer_key_policy(public.sandy_operations_keys,text,text,text),public.sandy_api_authenticate_customer_key(text),
 public.sandy_api_admit_customer_key_execution(uuid,uuid,text,text,text,text,text,uuid,text,text),
 public.sandy_api_consume_customer_key_grant(uuid,uuid,uuid,text,text,text,text,text,uuid,text,text),
 public.sandy_api_get_customer_key_receipt(uuid,uuid,text,uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.sandy_api_authenticate_customer_key(text),
 public.sandy_api_admit_customer_key_execution(uuid,uuid,text,text,text,text,text,uuid,text,text),
 public.sandy_api_consume_customer_key_grant(uuid,uuid,uuid,text,text,text,text,text,uuid,text,text),
 public.sandy_api_get_customer_key_receipt(uuid,uuid,text,uuid) TO service_role;
COMMIT;
