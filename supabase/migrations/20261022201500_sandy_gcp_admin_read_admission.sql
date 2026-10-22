-- Reuse the shared admission/receipt ledger. No new operation or IAM grant.
BEGIN;
CREATE FUNCTION public.sandy_gcp_admin_read_admit(p_actor uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE r public.sandy_operation_registry; a public.sandy_api_execution_admissions;
 h text:=encode(extensions.digest('sandy-gcp-admin-readonly-v1','sha256'),'hex');
BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' OR NOT public.sandy_api_current_owner(p_actor)
 OR NOT EXISTS(SELECT 1 FROM auth.users WHERE id=p_actor AND email_confirmed_at IS NOT NULL AND NOT coalesce(is_anonymous,false))
 THEN RAISE EXCEPTION 'confirmed_current_owner_required'; END IF;
 -- Serialize rate admission for this actor; use the same ledger, not a queue.
 PERFORM pg_advisory_xact_lock(hashtextextended('sandy-gcp-admin:'||p_actor::text,0));
 IF (SELECT count(*) FROM public.sandy_api_execution_admissions WHERE actor_id=p_actor
 AND operation='engineering.preflight' AND contract_sha256=h AND created_at>clock_timestamp()-interval '1 minute')>=2
 THEN RAISE EXCEPTION 'administrator_read_rate_limited'; END IF;
 SELECT * INTO r FROM public.sandy_operation_registry WHERE operation='engineering.preflight' FOR SHARE;
 IF r.handler IS DISTINCT FROM 'sandy-engineering-control' OR r.api_exposed IS DISTINCT FROM true OR r.is_mutation IS DISTINCT FROM false
 THEN RAISE EXCEPTION 'installed_preflight_contract_required'; END IF;
 INSERT INTO public.sandy_api_execution_admissions(actor_id,operation,request_id,is_mutation,input_sha256,contract_sha256,
 scope_sha256,registry_revision_sha256,declared_cost_units,expires_at)
 VALUES(p_actor,'engineering.preflight',gen_random_uuid(),false,h,h,h,
 encode(extensions.digest(to_jsonb(r)::text,'sha256'),'hex'),0,clock_timestamp()+interval '60 seconds') RETURNING * INTO a;
 RETURN jsonb_build_object('admission_id',a.id,'grant_id',a.grant_id,'request_id',a.request_id);
END $$;
REVOKE ALL ON FUNCTION public.sandy_gcp_admin_read_admit(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.sandy_gcp_admin_read_admit(uuid) TO service_role;

CREATE FUNCTION public.sandy_gcp_admin_read_claim(p_actor uuid,p_admission uuid,p_grant uuid,p_request uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE a public.sandy_api_execution_admissions;
 h text:=encode(extensions.digest('sandy-gcp-admin-readonly-v1','sha256'),'hex');
BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' OR NOT public.sandy_api_current_owner(p_actor)
 THEN RAISE EXCEPTION 'current_owner_required'; END IF;
 SELECT * INTO a FROM public.sandy_api_execution_admissions WHERE id=p_admission FOR UPDATE;
 IF a.id IS NULL OR a.actor_id IS DISTINCT FROM p_actor OR a.grant_id IS DISTINCT FROM p_grant OR a.request_id IS DISTINCT FROM p_request
 OR a.operation IS DISTINCT FROM 'engineering.preflight' OR a.is_mutation IS DISTINCT FROM false
 OR a.contract_sha256 IS DISTINCT FROM h OR a.input_sha256 IS DISTINCT FROM h OR a.scope_sha256 IS DISTINCT FROM h
 OR a.tenant_id IS NOT NULL OR a.credential_id IS NOT NULL OR a.declared_cost_units<>0
 OR a.state IS DISTINCT FROM 'admitted' OR a.expires_at<=clock_timestamp()
 OR NOT EXISTS(SELECT 1 FROM public.sandy_operation_registry r WHERE operation=a.operation AND handler='sandy-engineering-control' AND api_exposed=true AND is_mutation=false
 AND encode(extensions.digest(to_jsonb(r)::text,'sha256'),'hex')=a.registry_revision_sha256)
 THEN RAISE EXCEPTION 'administrator_read_admission_refused'; END IF;
 UPDATE public.sandy_api_execution_admissions SET state='consumed',consumed_at=clock_timestamp() WHERE id=a.id;
 RETURN jsonb_build_object('ok',true,'admission_id',a.id);
END $$;
REVOKE ALL ON FUNCTION public.sandy_gcp_admin_read_claim(uuid,uuid,uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.sandy_gcp_admin_read_claim(uuid,uuid,uuid,uuid) TO service_role;

CREATE FUNCTION public.sandy_gcp_admin_read_finish(p_actor uuid,p_admission uuid,p_succeeded boolean,p_status integer,p_result_sha256 text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE a public.sandy_api_execution_admissions;
 h text:=encode(extensions.digest('sandy-gcp-admin-readonly-v1','sha256'),'hex');
BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' OR p_result_sha256 IS NULL OR p_result_sha256 !~ '^[a-f0-9]{64}$'
 OR p_succeeded IS NULL OR p_status IS NULL OR p_status NOT BETWEEN 100 AND 599 THEN RAISE EXCEPTION 'internal_receipt_context_required'; END IF;
 SELECT * INTO a FROM public.sandy_api_execution_admissions WHERE id=p_admission FOR UPDATE;
 IF a.id IS NULL OR a.actor_id IS DISTINCT FROM p_actor OR a.operation IS DISTINCT FROM 'engineering.preflight'
 OR a.contract_sha256 IS DISTINCT FROM h OR a.is_mutation IS DISTINCT FROM false THEN RAISE EXCEPTION 'administrator_read_receipt_refused'; END IF;
 IF a.state='admitted' AND NOT p_succeeded THEN
  UPDATE public.sandy_api_execution_admissions SET state='failed',finished_at=clock_timestamp(),provider_http_status=p_status,result_sha256=p_result_sha256 WHERE id=a.id;
  RETURN jsonb_build_object('ok',true,'admission_id',a.id,'state','failed','reused',false);
 END IF;
 RETURN public.sandy_api_finish_execution(a.id,CASE WHEN p_succeeded THEN 'succeeded' ELSE 'unknown' END,p_status,NULL,p_result_sha256);
END $$;
REVOKE ALL ON FUNCTION public.sandy_gcp_admin_read_finish(uuid,uuid,boolean,integer,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.sandy_gcp_admin_read_finish(uuid,uuid,boolean,integer,text) TO service_role;
COMMIT;
