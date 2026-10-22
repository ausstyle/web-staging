-- Extend the fixed read through the existing, administratively established
-- resource-bound delegation. No policy/grant, owner approval or IAM change.
BEGIN;
CREATE FUNCTION public.sandy_gcp_admin_read_authority(p_actor uuid,p_session uuid,p_epoch integer) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE resolved jsonb; policy jsonb; h text;
BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'internal_administrator_read_required'; END IF;
 resolved:=public.sandy_engineering_resolve_standing(p_actor,p_session,p_epoch);
 policy:=resolved->'policy';
 IF resolved->>'ok' IS DISTINCT FROM 'true' OR resolved->>'identity_user_id' IS DISTINCT FROM p_actor::text
 OR resolved->>'session_id' IS DISTINCT FROM p_session::text
 OR (policy->'classes'->'gcp' ? 'metadata_read') IS DISTINCT FROM true
 OR (policy->'resources'->'gcp' ? 'elaborate-haven-511518-a5') IS DISTINCT FROM true
 OR (policy->'environments' ? 'production') IS DISTINCT FROM true
 OR policy->>'declared_unit_budget' IS DISTINCT FROM '0'
 THEN RAISE EXCEPTION 'standing_administrator_metadata_read_denied'; END IF;
 h:=encode(extensions.digest(jsonb_build_object('connection','sandy-gcp-admin','delegation',resolved->>'delegation_id',
 'version',resolved->>'version','session',p_session,'identity',p_actor)::text,'sha256'),'hex');
 RETURN jsonb_build_object('ok',true,'scope_sha256',h,'delegation_id',resolved->>'delegation_id','version',resolved->'version');
END $$;
REVOKE ALL ON FUNCTION public.sandy_gcp_admin_read_authority(uuid,uuid,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.sandy_gcp_admin_read_authority(uuid,uuid,integer) TO service_role;

CREATE FUNCTION public.sandy_gcp_admin_read_admit(p_actor uuid,p_session uuid,p_epoch integer) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE r public.sandy_operation_registry; a public.sandy_api_execution_admissions;
 authority jsonb;
 h text:=encode(extensions.digest('sandy-gcp-admin-readonly-v1','sha256'),'hex');
BEGIN
 authority:=public.sandy_gcp_admin_read_authority(p_actor,p_session,p_epoch);
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
 VALUES(p_actor,'engineering.preflight',gen_random_uuid(),false,h,h,authority->>'scope_sha256',
 encode(extensions.digest(to_jsonb(r)::text,'sha256'),'hex'),0,clock_timestamp()+interval '60 seconds') RETURNING * INTO a;
 RETURN jsonb_build_object('admission_id',a.id,'grant_id',a.grant_id,'request_id',a.request_id);
END $$;

CREATE FUNCTION public.sandy_gcp_admin_read_claim(p_actor uuid,p_admission uuid,p_grant uuid,p_request uuid,p_session uuid,p_epoch integer) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE a public.sandy_api_execution_admissions;
 authority jsonb;
 h text:=encode(extensions.digest('sandy-gcp-admin-readonly-v1','sha256'),'hex');
BEGIN
 authority:=public.sandy_gcp_admin_read_authority(p_actor,p_session,p_epoch);
 SELECT * INTO a FROM public.sandy_api_execution_admissions WHERE id=p_admission FOR UPDATE;
 IF a.id IS NULL OR a.actor_id IS DISTINCT FROM p_actor OR a.grant_id IS DISTINCT FROM p_grant OR a.request_id IS DISTINCT FROM p_request
 OR a.operation IS DISTINCT FROM 'engineering.preflight' OR a.is_mutation IS DISTINCT FROM false
 OR a.contract_sha256 IS DISTINCT FROM h OR a.input_sha256 IS DISTINCT FROM h OR a.scope_sha256 IS DISTINCT FROM authority->>'scope_sha256'
 OR a.tenant_id IS NOT NULL OR a.credential_id IS NOT NULL OR a.declared_cost_units<>0
 OR a.state IS DISTINCT FROM 'admitted' OR a.expires_at<=clock_timestamp()
 OR NOT EXISTS(SELECT 1 FROM public.sandy_operation_registry r WHERE operation=a.operation AND handler='sandy-engineering-control' AND api_exposed=true AND is_mutation=false
 AND encode(extensions.digest(to_jsonb(r)::text,'sha256'),'hex')=a.registry_revision_sha256)
 THEN RAISE EXCEPTION 'administrator_read_admission_refused'; END IF;
 UPDATE public.sandy_api_execution_admissions SET state='consumed',consumed_at=clock_timestamp() WHERE id=a.id;
 RETURN jsonb_build_object('ok',true,'admission_id',a.id);
END $$;

REVOKE ALL ON FUNCTION public.sandy_gcp_admin_read_admit(uuid,uuid,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.sandy_gcp_admin_read_admit(uuid,uuid,integer) TO service_role;
REVOKE ALL ON FUNCTION public.sandy_gcp_admin_read_claim(uuid,uuid,uuid,uuid,uuid,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.sandy_gcp_admin_read_claim(uuid,uuid,uuid,uuid,uuid,integer) TO service_role;
COMMIT;
