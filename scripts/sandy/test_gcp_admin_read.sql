-- Run after the candidate DDL inside a transaction and ROLLBACK. Synthetic DB
-- admission tests only; no token issuance, provider effect or verification flag.
DO $$
DECLARE owner_id uuid; t jsonb; r jsonb; denied boolean; h text:=repeat('a',64);
BEGIN
 SELECT auth_user_id INTO STRICT owner_id FROM public.sandy_controller_admins
 WHERE enabled AND role='owner' ORDER BY auth_user_id LIMIT 1;
 PERFORM set_config('request.jwt.claim.role','service_role',true);
 PERFORM set_config('request.jwt.claims','{"role":"service_role"}',true);
 IF has_function_privilege('authenticated','public.sandy_gcp_admin_read_admit(uuid)','EXECUTE')
 OR has_function_privilege('anon','public.sandy_gcp_admin_read_claim(uuid,uuid,uuid,uuid)','EXECUTE') THEN RAISE EXCEPTION 'public admission authority'; END IF;
 denied:=false;
 BEGIN PERFORM public.sandy_gcp_admin_read_admit(gen_random_uuid());
 EXCEPTION WHEN OTHERS THEN denied:=true; END;
 IF NOT denied THEN RAISE EXCEPTION 'nonowner admitted'; END IF;
 t:=public.sandy_gcp_admin_read_admit(owner_id);
 denied:=false;
 BEGIN PERFORM public.sandy_gcp_admin_read_claim(owner_id,(t->>'admission_id')::uuid,(t->>'grant_id')::uuid,gen_random_uuid());
 EXCEPTION WHEN OTHERS THEN denied:=true; END;
 IF NOT denied THEN RAISE EXCEPTION 'wrong request claimed'; END IF;
 r:=public.sandy_gcp_admin_read_claim(owner_id,(t->>'admission_id')::uuid,(t->>'grant_id')::uuid,(t->>'request_id')::uuid);
 IF r->>'ok'<>'true' THEN RAISE EXCEPTION 'valid claim failed'; END IF;
 denied:=false;
 BEGIN PERFORM public.sandy_gcp_admin_read_claim(owner_id,(t->>'admission_id')::uuid,(t->>'grant_id')::uuid,(t->>'request_id')::uuid);
 EXCEPTION WHEN OTHERS THEN denied:=true; END;
 IF NOT denied THEN RAISE EXCEPTION 'replay claimed'; END IF;
 r:=public.sandy_gcp_admin_read_finish(owner_id,(t->>'admission_id')::uuid,true,200,h);
 IF r->>'state'<>'succeeded' THEN RAISE EXCEPTION 'shared receipt not settled'; END IF;
 t:=public.sandy_gcp_admin_read_admit(owner_id);
 UPDATE public.sandy_api_execution_admissions SET expires_at=clock_timestamp()-interval '1 second' WHERE id=(t->>'admission_id')::uuid;
 denied:=false;
 BEGIN PERFORM public.sandy_gcp_admin_read_claim(owner_id,(t->>'admission_id')::uuid,(t->>'grant_id')::uuid,(t->>'request_id')::uuid);
 EXCEPTION WHEN OTHERS THEN denied:=true; END;
 IF NOT denied THEN RAISE EXCEPTION 'expired ticket claimed'; END IF;
 r:=public.sandy_gcp_admin_read_finish(owner_id,(t->>'admission_id')::uuid,false,424,h);
 IF r->>'state'<>'failed' THEN RAISE EXCEPTION 'predispatch failure not settled'; END IF;
 denied:=false;
 BEGIN PERFORM public.sandy_gcp_admin_read_admit(owner_id);
 EXCEPTION WHEN OTHERS THEN denied:=true; END;
 IF NOT denied THEN RAISE EXCEPTION 'rate cap bypassed'; END IF;
END $$;
SELECT 'passed' AS database_admission_checks, false AS provider_execution_verified;
