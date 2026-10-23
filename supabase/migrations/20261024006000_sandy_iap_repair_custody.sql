-- Protected transport custody only. No grant, IAM write, enrollment or runtime
-- activation is established by installing these functions. Reuses the shared
-- admission ledger; full policy preimages never enter public job results.
BEGIN;
CREATE FUNCTION public.sandy_iap_repair_admit(
 p_actor uuid,p_session uuid,p_epoch integer,p_mode text,p_parent uuid,
 p_source_sha256 text,p_worker_revision text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE r jsonb;reg public.sandy_operation_registry;a public.sandy_api_execution_admissions;
 parent public.sandy_api_execution_admissions;ctx jsonb;h text:=encode(extensions.digest('sandy-protected-iap-repair-v1','sha256'),'hex');
BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' OR p_mode IS NULL OR p_mode NOT IN('plan','apply','rollback')
 OR p_source_sha256 IS NULL OR p_source_sha256 !~ '^[a-f0-9]{64}$'
 OR p_worker_revision IS NULL OR p_worker_revision !~ '^sandy-engineering-mcp-[a-z0-9-]{1,90}$'
 THEN RAISE EXCEPTION 'protected_repair_source_context_required' USING ERRCODE='42501';END IF;
 PERFORM 1 FROM public.sandy_engineering_control_grants WHERE identity_user_id=p_actor FOR UPDATE;
 r:=public.sandy_engineering_resolve_iap_repair(p_actor,p_session,p_epoch);
 IF r->>'ok' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'independent_iap_repair_grant_required' USING ERRCODE='42501';END IF;
 IF p_mode='plan' AND p_parent IS NOT NULL THEN RAISE EXCEPTION 'plan_parent_not_permitted';END IF;
 IF p_mode<>'plan' THEN
  SELECT * INTO parent FROM public.sandy_api_execution_admissions WHERE id=p_parent FOR SHARE;
  IF parent.id IS NULL OR parent.actor_id IS DISTINCT FROM p_actor OR parent.state IS DISTINCT FROM 'succeeded'
  OR parent.contract_sha256 IS DISTINCT FROM h OR parent.scope_sha256 IS DISTINCT FROM r->>'scope_sha256'
  OR parent.effect_verification->>'phase' IS DISTINCT FROM 'completed'
  OR parent.effect_verification->>'mode' IS DISTINCT FROM (CASE WHEN p_mode='apply' THEN 'plan' ELSE 'apply' END)
  OR parent.effect_verification->>'source_sha256' IS DISTINCT FROM p_source_sha256
  OR parent.effect_verification->>'worker_revision' IS DISTINCT FROM p_worker_revision
  OR jsonb_typeof(parent.effect_verification->'plans') IS DISTINCT FROM 'array' OR jsonb_array_length(parent.effect_verification->'plans')<>2
  THEN RAISE EXCEPTION 'protected_verified_parent_custody_required';END IF;
  -- One continuation owns a preserved plan/effect. Unknown or failed dispatch
  -- cannot be replayed as a new admission; reconcile it independently instead.
  IF EXISTS(SELECT 1 FROM public.sandy_api_execution_admissions WHERE contract_sha256=h
   AND effect_verification->>'parent_admission_id'=p_parent::text AND effect_verification->>'mode'=p_mode)
  THEN RAISE EXCEPTION 'parent_custody_already_consumed';END IF;
 END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('sandy-iap-repair:'||p_actor::text,0));
 IF (SELECT count(*) FROM public.sandy_api_execution_admissions WHERE actor_id=p_actor AND contract_sha256=h AND created_at>clock_timestamp()-interval '1 minute')>=2
 THEN RAISE EXCEPTION 'protected_repair_rate_limited';END IF;
 SELECT * INTO reg FROM public.sandy_operation_registry WHERE operation='engineering.job.execute' FOR SHARE;
 IF reg.handler IS DISTINCT FROM 'sandy-engineering-control' OR reg.api_exposed IS DISTINCT FROM true
 OR reg.ai_exposed IS DISTINCT FROM true OR reg.is_mutation IS DISTINCT FROM true
 THEN RAISE EXCEPTION 'installed_engineering_job_contract_required';END IF;
 ctx:=jsonb_build_object('boundary','gcp_iap_repair','version',1,'mode',p_mode,'phase','admitted',
  'session_id',p_session,'epoch',p_epoch,'revision',r->'revision','change_id',r->'policy'->>'change_id',
  'source_sha256',p_source_sha256,'worker_revision',p_worker_revision,'expires_at',r->'policy'->>'expires_at',
  'parent_admission_id',p_parent,'plans',coalesce(parent.effect_verification->'plans','[]'::jsonb),
  'write_started','{}'::jsonb,'target_receipts','{}'::jsonb);
 INSERT INTO public.sandy_api_execution_admissions(actor_id,operation,request_id,is_mutation,input_sha256,
  contract_sha256,scope_sha256,registry_revision_sha256,declared_cost_units,expires_at,effect_verification)
 VALUES(p_actor,'engineering.job.execute',gen_random_uuid(),true,encode(extensions.digest(ctx::text,'sha256'),'hex'),h,
  r->>'scope_sha256',encode(extensions.digest(to_jsonb(reg)::text,'sha256'),'hex'),0,
  least(clock_timestamp()+interval '180 seconds',(r->'policy'->>'expires_at')::timestamptz),ctx) RETURNING * INTO a;
 INSERT INTO public.sandy_engineering_identity_events(identity_user_id,owner_authority_id,actor_kind,event_type,detail)
 VALUES(p_actor,(r->>'owner_authority_id')::uuid,'verified_auth_workload','execution_authorized',
  jsonb_build_object('boundary','gcp_iap_repair','admission_id',a.id,'revision',r->'revision','mode',p_mode,
   'scope_sha256',a.scope_sha256,'source_sha256',p_source_sha256,'worker_revision',p_worker_revision,'IAM_changes',0));
 RETURN jsonb_build_object('admission_id',a.id,'grant_id',a.grant_id,'request_id',a.request_id);
END $$;

CREATE FUNCTION public.sandy_iap_repair_context(
 p_actor uuid,p_session uuid,p_epoch integer,p_admission uuid,p_grant uuid,p_request uuid,p_require_current_grant boolean
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE a public.sandy_api_execution_admissions;r jsonb;
BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'protected_transport_required' USING ERRCODE='42501';END IF;
 IF p_require_current_grant THEN PERFORM 1 FROM public.sandy_engineering_control_grants WHERE identity_user_id=p_actor FOR SHARE;END IF;
 SELECT * INTO a FROM public.sandy_api_execution_admissions WHERE id=p_admission FOR UPDATE;
 IF a.id IS NULL OR a.actor_id IS DISTINCT FROM p_actor OR a.grant_id IS DISTINCT FROM p_grant OR a.request_id IS DISTINCT FROM p_request
 OR a.operation IS DISTINCT FROM 'engineering.job.execute' OR a.is_mutation IS DISTINCT FROM true OR a.declared_cost_units<>0
 OR a.contract_sha256 IS DISTINCT FROM encode(extensions.digest('sandy-protected-iap-repair-v1','sha256'),'hex')
 OR a.credential_id IS NOT NULL OR a.tenant_id IS NOT NULL OR a.principal_kind IS DISTINCT FROM 'auth_user'
 OR a.effect_verification->>'session_id' IS DISTINCT FROM p_session::text
 OR a.effect_verification->>'epoch' IS DISTINCT FROM p_epoch::text
 OR a.effect_verification->>'boundary' IS DISTINCT FROM 'gcp_iap_repair'
 THEN RAISE EXCEPTION 'protected_repair_admission_refused' USING ERRCODE='42501';END IF;
 IF p_require_current_grant THEN
  r:=public.sandy_engineering_resolve_iap_repair(p_actor,p_session,p_epoch);
  IF r->>'ok' IS DISTINCT FROM 'true' OR r->>'scope_sha256' IS DISTINCT FROM a.scope_sha256
  OR r->>'revision' IS DISTINCT FROM a.effect_verification->>'revision' OR a.expires_at<=clock_timestamp()
  OR NOT EXISTS(SELECT 1 FROM public.sandy_operation_registry reg WHERE operation=a.operation
   AND handler='sandy-engineering-control' AND api_exposed AND ai_exposed AND is_mutation
   AND encode(extensions.digest(to_jsonb(reg)::text,'sha256'),'hex')=a.registry_revision_sha256)
  THEN RAISE EXCEPTION 'current_independent_repair_grant_required' USING ERRCODE='42501';END IF;
 END IF;
 RETURN to_jsonb(a);
END $$;

CREATE FUNCTION public.sandy_iap_repair_claim(
 p_actor uuid,p_session uuid,p_epoch integer,p_admission uuid,p_grant uuid,p_request uuid,p_source_sha256 text,p_worker_revision text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE a jsonb;c jsonb;
BEGIN
 a:=public.sandy_iap_repair_context(p_actor,p_session,p_epoch,p_admission,p_grant,p_request,true);c:=a->'effect_verification';
 IF a->>'state' IS DISTINCT FROM 'admitted' OR c->>'phase' IS DISTINCT FROM 'admitted'
 OR c->>'source_sha256' IS DISTINCT FROM p_source_sha256 OR c->>'worker_revision' IS DISTINCT FROM p_worker_revision
 THEN RAISE EXCEPTION 'protected_repair_claim_refused' USING ERRCODE='42501';END IF;
 UPDATE public.sandy_api_execution_admissions SET state='consumed',consumed_at=clock_timestamp(),
 effect_verification=jsonb_set(c,'{phase}','"claimed"') WHERE id=p_admission;
 RETURN jsonb_build_object('ok',true,'admission_id',p_admission,'mode',c->>'mode','revision',c->'revision',
  'scope_sha256',a->>'scope_sha256','expires_at',c->>'expires_at','plans',c->'plans');
END $$;

CREATE FUNCTION public.sandy_iap_repair_write_started(
 p_actor uuid,p_session uuid,p_epoch integer,p_admission uuid,p_grant uuid,p_request uuid,p_revision integer,p_scope_sha256 text,
 p_vm_name text,p_instance_id text,p_before_sha256 text,p_candidate_sha256 text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE a jsonb;c jsonb;expected text;idx integer;
BEGIN
 a:=public.sandy_iap_repair_context(p_actor,p_session,p_epoch,p_admission,p_grant,p_request,true);c:=a->'effect_verification';
 idx:=CASE p_vm_name WHEN 'sandy-video' THEN 0 WHEN 'sandy-windows' THEN 1 ELSE -1 END;
 expected:=CASE idx WHEN 0 THEN '6831598645020395570' WHEN 1 THEN '8120150462304566315' END;
 IF a->>'state' IS DISTINCT FROM 'consumed' OR c->>'phase' IS DISTINCT FROM 'claimed'
 OR c->>'mode' NOT IN('apply','rollback') OR p_instance_id IS DISTINCT FROM expected OR idx<0
 OR c->>'revision' IS DISTINCT FROM p_revision::text OR a->>'scope_sha256' IS DISTINCT FROM p_scope_sha256
 OR p_before_sha256 IS NULL OR p_before_sha256 !~ '^[a-f0-9]{64}$'
 OR p_candidate_sha256 IS NULL OR p_candidate_sha256 !~ '^[a-f0-9]{64}$'
 OR c->'write_started' ? p_vm_name OR (idx=1 AND NOT c->'target_receipts' ? 'sandy-video')
 OR jsonb_typeof(c->'plans') IS DISTINCT FROM 'array' OR jsonb_array_length(c->'plans')<>2
 OR (c->'plans'->idx->>'vm_name') IS DISTINCT FROM p_vm_name
 OR (c->'plans'->idx->>'instance_id') IS DISTINCT FROM p_instance_id
 OR (c->>'mode'='apply' AND ((c->'plans'->idx->>'before_sha256') IS DISTINCT FROM p_before_sha256
   OR (c->'plans'->idx->>'candidate_sha256') IS DISTINCT FROM p_candidate_sha256))
 THEN RAISE EXCEPTION 'one_use_fixed_target_write_refused' USING ERRCODE='42501';END IF;
 UPDATE public.sandy_api_execution_admissions SET effect_verification=jsonb_set(c,ARRAY['write_started',p_vm_name],
 jsonb_build_object('before_sha256',p_before_sha256,'candidate_sha256',p_candidate_sha256,'started_at',clock_timestamp())) WHERE id=p_admission;
 RETURN jsonb_build_object('ok',true,'admission_id',p_admission,'write_attempt_reserved',true);
END $$;

CREATE FUNCTION public.sandy_iap_repair_finish(
 p_actor uuid,p_session uuid,p_epoch integer,p_admission uuid,p_grant uuid,p_request uuid,p_payload jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE a jsonb;c jsonb;phase text:=p_payload->>'phase';name text:=p_payload->>'vm_name';idx integer;
 plans jsonb;entry jsonb;receipt jsonb;outcome text;h text;
BEGIN
 -- Completion custody remains writable after grant revocation so actual effects
 -- are never hidden. No new provider dispatch can use this terminal callback.
 a:=public.sandy_iap_repair_context(p_actor,p_session,p_epoch,p_admission,p_grant,p_request,false);c:=a->'effect_verification';
 IF p_payload IS NULL OR jsonb_typeof(p_payload)<>'object' OR octet_length(p_payload::text)>180000
 OR (a->>'state' IS DISTINCT FROM 'consumed' OR c->>'phase' IS DISTINCT FROM 'claimed') AND NOT (phase='failed_or_unknown' AND a->>'state'='admitted' AND c->>'phase'='admitted')
 OR phase IS NULL OR phase NOT IN('target_verified','plan_preserved','completed','failed_or_unknown')
 THEN RAISE EXCEPTION 'protected_repair_receipt_refused';END IF;
 IF phase='target_verified' THEN
  idx:=CASE name WHEN 'sandy-video' THEN 0 WHEN 'sandy-windows' THEN 1 ELSE -1 END;
  IF idx<0 OR p_payload->>'instance_id' IS DISTINCT FROM (CASE idx WHEN 0 THEN '6831598645020395570' ELSE '8120150462304566315' END)
  OR p_payload->>'mode' IS DISTINCT FROM c->>'mode' OR p_payload->>'revision' IS DISTINCT FROM c->>'revision'
  OR c->>'mode' NOT IN('apply','rollback') OR c->'target_receipts' ? name
  OR jsonb_typeof(p_payload->'before') IS DISTINCT FROM 'object' OR jsonb_typeof(p_payload->'observed_after') IS DISTINCT FROM 'object'
  OR jsonb_typeof(p_payload->'proof') IS DISTINCT FROM 'object'
  OR (p_payload->'proof'->>'change_required'='true' AND NOT c->'write_started' ? name)
  OR (idx=1 AND NOT c->'target_receipts' ? 'sandy-video')
  THEN RAISE EXCEPTION 'fixed_target_receipt_refused';END IF;
  IF c->>'mode'='apply' AND (p_payload->'before' IS DISTINCT FROM c->'plans'->idx->'before'
   OR ((p_payload->'observed_after')-'etag') IS DISTINCT FROM ((c->'plans'->idx->'candidate')-'etag'))
  OR c->>'mode'='rollback' AND (((p_payload->'before')-'etag') IS DISTINCT FROM ((c->'plans'->idx->'observed_after')-'etag')
   OR ((p_payload->'observed_after')-'etag') IS DISTINCT FROM ((c->'plans'->idx->'before')-'etag'))
  THEN RAISE EXCEPTION 'effect_does_not_match_protected_preimage';END IF;
  receipt:=p_payload-'worker_identity';
  UPDATE public.sandy_api_execution_admissions SET effect_verification=jsonb_set(c,ARRAY['target_receipts',name],receipt) WHERE id=p_admission;
  RETURN jsonb_build_object('ok',true,'admission_id',p_admission,'target_preserved',name);
 END IF;
 IF phase='plan_preserved' THEN
  plans:=p_payload->'plans';
  IF c->>'mode' IS DISTINCT FROM 'plan' OR jsonb_typeof(plans) IS DISTINCT FROM 'array' OR jsonb_array_length(plans)<>2
  OR plans->0->>'vm_name' IS DISTINCT FROM 'sandy-video' OR plans->1->>'vm_name' IS DISTINCT FROM 'sandy-windows'
  OR plans->0->>'instance_id' IS DISTINCT FROM '6831598645020395570' OR plans->1->>'instance_id' IS DISTINCT FROM '8120150462304566315'
  OR c->'write_started' IS DISTINCT FROM '{}'::jsonb THEN RAISE EXCEPTION 'fixed_plan_custody_required';END IF;
  c:=jsonb_set(c,'{plans}',plans);outcome:='succeeded';
 ELSIF phase='completed' THEN
  IF c->>'mode' NOT IN('apply','rollback') OR NOT c->'target_receipts' ? 'sandy-video' OR NOT c->'target_receipts' ? 'sandy-windows'
  THEN RAISE EXCEPTION 'both_independent_readbacks_required';END IF;
  plans:='[]'::jsonb;
  FOR idx IN 0..1 LOOP
   name:=CASE idx WHEN 0 THEN 'sandy-video' ELSE 'sandy-windows' END;
   receipt:=c->'target_receipts'->name;
   -- Keep the original plan preimage, observed effect and exact scope together
   -- for rollback. Never replace the original preimage with an apply readback.
   entry:=(c->'plans'->idx)||jsonb_build_object('observed_after',receipt->'observed_after');
   plans:=plans||jsonb_build_array(entry);
  END LOOP;
  c:=jsonb_set(c,'{plans}',plans);outcome:='succeeded';
 ELSE
  outcome:=CASE WHEN c->'write_started'<>'{}'::jsonb OR p_payload->>'reconciliation_required'='true' THEN 'unknown' ELSE 'failed' END;
 END IF;
 c:=c||jsonb_build_object('phase',CASE WHEN outcome='succeeded' THEN 'completed' ELSE 'failed_or_unknown' END,
  'completion',p_payload-'worker_identity','reconciliation_required',outcome='unknown');
 h:=encode(extensions.digest(c::text,'sha256'),'hex');
 UPDATE public.sandy_api_execution_admissions SET state=outcome,finished_at=clock_timestamp(),effect_verification=c,
 result_sha256=h,provider_http_status=CASE WHEN outcome='succeeded' THEN 200 ELSE NULL END WHERE id=p_admission;
 IF c->>'job_id' IS NOT NULL THEN
  UPDATE public.sandy_deployment_jobs SET status=CASE WHEN outcome='unknown' THEN 'unknown_outcome' ELSE outcome END,
   finished_at=clock_timestamp(),updated_at=clock_timestamp(),result=jsonb_build_object('admission_id',p_admission,'result_sha256',h,'reconciliation_required',outcome='unknown','OS_commands',0)
  WHERE id=(c->>'job_id')::uuid AND status='running' AND payload->>'admission_id'=p_admission::text;
  IF NOT FOUND THEN RAISE EXCEPTION 'job_receipt_custody_changed';END IF;
 END IF;
 INSERT INTO public.sandy_engineering_change_events(change_id,event_type,actor,detail)
 VALUES((c->>'change_id')::uuid,'iap_repair_'||outcome,p_actor,jsonb_build_object('admission_id',p_admission,'mode',c->>'mode',
 'result_sha256',h,'reconciliation_required',outcome='unknown','OS_commands',0,'agents_enrolled',0));
 RETURN jsonb_build_object('ok',true,'admission_id',p_admission,'state',outcome,'result_sha256',h);
END $$;

CREATE FUNCTION public.sandy_iap_repair_prepare_job(
 p_actor uuid,p_session uuid,p_epoch integer,p_change uuid,p_mode text,p_parent uuid,p_key text,p_source_sha256 text,p_worker_revision text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE r jsonb;j public.sandy_deployment_jobs;expected jsonb;key text;
BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' OR p_mode IS NULL OR p_mode NOT IN('plan','apply','rollback')
 OR p_change IS DISTINCT FROM '52d56740-59c8-4db1-b7e6-a137c7699b86'::uuid
 OR p_key IS NULL OR p_key !~ '^[A-Za-z0-9:_-]{12,100}$'
 OR p_source_sha256 IS NULL OR p_source_sha256 !~ '^[a-f0-9]{64}$'
 OR p_worker_revision IS NULL OR p_worker_revision !~ '^sandy-engineering-mcp-[a-z0-9-]{1,90}$'
 OR (p_mode='plan') IS DISTINCT FROM (p_parent IS NULL)
 THEN RAISE EXCEPTION 'fixed_iap_repair_job_contract_required';END IF;
 PERFORM 1 FROM public.sandy_engineering_control_grants WHERE identity_user_id=p_actor FOR UPDATE;
 r:=public.sandy_engineering_resolve_iap_repair(p_actor,p_session,p_epoch);
 IF r->>'ok' IS DISTINCT FROM 'true' OR r->'policy'->>'change_id' IS DISTINCT FROM p_change::text
 THEN RAISE EXCEPTION 'independent_iap_repair_grant_required' USING ERRCODE='42501';END IF;
 expected:=jsonb_build_object('boundary','gcp_iap_repair','mode',p_mode,'parent_admission_id',p_parent,
 'authorization_mode','authorized_by_policy','delegation_id',p_actor,'delegation_revision',r->'revision',
 'source_policy_sha256',encode(extensions.digest((r->'policy')::text,'sha256'),'hex'),
 'source_sha256',p_source_sha256,'worker_revision',p_worker_revision);
 key:='iap-repair:'||p_actor::text||':'||p_key;
 SELECT * INTO j FROM public.sandy_deployment_jobs WHERE idempotency_key=key FOR UPDATE;
 IF j.id IS NOT NULL THEN
  IF j.requested_by IS DISTINCT FROM p_actor::text OR j.engineering_change_id IS DISTINCT FROM p_change
  OR j.provider IS DISTINCT FROM 'google_cloud' OR j.operation IS DISTINCT FROM 'iap.repair.'||p_mode
  OR j.target IS DISTINCT FROM 'sandy-iap-repair:elaborate-haven-511518-a5:sandy-video+sandy-windows'
  OR j.payload-'admission_id' IS DISTINCT FROM expected THEN RAISE EXCEPTION 'iap_job_idempotency_conflict';END IF;
  RETURN jsonb_build_object('ok',true,'job',to_jsonb(j),'reused',true,'execution','not_started');
 END IF;
 INSERT INTO public.sandy_deployment_jobs(requested_by,provider,operation,target,payload,idempotency_key,status,engineering_change_id)
 VALUES(p_actor::text,'google_cloud','iap.repair.'||p_mode,'sandy-iap-repair:elaborate-haven-511518-a5:sandy-video+sandy-windows',expected,key,'authorized_by_policy',p_change) RETURNING * INTO j;
 INSERT INTO public.sandy_engineering_change_events(change_id,event_type,actor,detail)
 VALUES(p_change,'iap_repair_job_prepared',p_actor,jsonb_build_object('job_id',j.id,'mode',p_mode,'grant_revision',r->'revision','execution','not_started','IAM_changes',0));
 RETURN jsonb_build_object('ok',true,'job',to_jsonb(j),'reused',false,'execution','not_started');
END $$;

CREATE FUNCTION public.sandy_iap_repair_job_context(p_actor uuid,p_session uuid,p_epoch integer,p_job uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE r jsonb;j public.sandy_deployment_jobs;
BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'protected_transport_required';END IF;
 PERFORM 1 FROM public.sandy_engineering_control_grants WHERE identity_user_id=p_actor FOR SHARE;
 r:=public.sandy_engineering_resolve_iap_repair(p_actor,p_session,p_epoch);
 SELECT * INTO j FROM public.sandy_deployment_jobs WHERE id=p_job FOR SHARE;
 IF r->>'ok' IS DISTINCT FROM 'true' OR j.id IS NULL OR j.requested_by IS DISTINCT FROM p_actor::text
 OR j.engineering_change_id::text IS DISTINCT FROM r->'policy'->>'change_id'
 OR j.engineering_change_id IS DISTINCT FROM '52d56740-59c8-4db1-b7e6-a137c7699b86'::uuid
 OR j.provider IS DISTINCT FROM 'google_cloud' OR j.operation NOT IN('iap.repair.plan','iap.repair.apply','iap.repair.rollback')
 OR j.target IS DISTINCT FROM 'sandy-iap-repair:elaborate-haven-511518-a5:sandy-video+sandy-windows'
 OR j.payload->>'boundary' IS DISTINCT FROM 'gcp_iap_repair' OR j.operation IS DISTINCT FROM 'iap.repair.'||(j.payload->>'mode')
 OR j.payload->>'authorization_mode' IS DISTINCT FROM 'authorized_by_policy'
 OR j.payload->>'delegation_id' IS DISTINCT FROM p_actor::text OR j.payload->>'delegation_revision' IS DISTINCT FROM r->>'revision'
 OR j.payload->>'source_policy_sha256' IS DISTINCT FROM encode(extensions.digest((r->'policy')::text,'sha256'),'hex')
 THEN RAISE EXCEPTION 'scoped_iap_repair_job_required' USING ERRCODE='42501';END IF;
 RETURN jsonb_build_object('ok',true,'job',to_jsonb(j));
END $$;

CREATE FUNCTION public.sandy_iap_repair_job_admit(
 p_actor uuid,p_session uuid,p_epoch integer,p_job uuid,p_source_sha256 text,p_worker_revision text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE j public.sandy_deployment_jobs;r jsonb;a jsonb;
BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'protected_transport_required';END IF;
 PERFORM 1 FROM public.sandy_engineering_control_grants WHERE identity_user_id=p_actor FOR UPDATE;
 SELECT * INTO j FROM public.sandy_deployment_jobs WHERE id=p_job FOR UPDATE;
 r:=public.sandy_iap_repair_job_context(p_actor,p_session,p_epoch,p_job);
 IF j.status IS DISTINCT FROM 'authorized_by_policy' OR j.approved_by IS NOT NULL OR j.approved_at IS NOT NULL
 OR j.payload->>'source_sha256' IS DISTINCT FROM p_source_sha256 OR j.payload->>'worker_revision' IS DISTINCT FROM p_worker_revision
 THEN RAISE EXCEPTION 'one_use_source_pinned_iap_job_required';END IF;
 a:=public.sandy_iap_repair_admit(p_actor,p_session,p_epoch,j.payload->>'mode',(j.payload->>'parent_admission_id')::uuid,p_source_sha256,p_worker_revision);
 UPDATE public.sandy_api_execution_admissions SET effect_verification=effect_verification||jsonb_build_object('job_id',j.id) WHERE id=(a->>'admission_id')::uuid;
 UPDATE public.sandy_deployment_jobs SET status='running',started_at=clock_timestamp(),updated_at=clock_timestamp(),
 payload=payload||jsonb_build_object('admission_id',a->>'admission_id') WHERE id=j.id;
 RETURN a;
END $$;

CREATE FUNCTION public.sandy_iap_repair_status(p_actor uuid,p_session uuid,p_epoch integer,p_admission uuid,p_grant uuid,p_request uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE a jsonb;
BEGIN
 a:=public.sandy_iap_repair_context(p_actor,p_session,p_epoch,p_admission,p_grant,p_request,false);
 RETURN jsonb_build_object('ok',true,'admission_id',p_admission,'job_id',a->'effect_verification'->>'job_id',
 'state',a->>'state','mode',a->'effect_verification'->>'mode','result_sha256',a->>'result_sha256',
 'reconciliation_required',a->>'state'='unknown','source_sha256',a->'effect_verification'->>'source_sha256',
 'worker_revision',a->'effect_verification'->>'worker_revision');
END $$;

REVOKE ALL ON FUNCTION public.sandy_iap_repair_prepare_job(uuid,uuid,integer,uuid,text,uuid,text,text,text),
 public.sandy_iap_repair_job_context(uuid,uuid,integer,uuid),public.sandy_iap_repair_job_admit(uuid,uuid,integer,uuid,text,text),
 public.sandy_iap_repair_status(uuid,uuid,integer,uuid,uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.sandy_iap_repair_prepare_job(uuid,uuid,integer,uuid,text,uuid,text,text,text),
 public.sandy_iap_repair_job_context(uuid,uuid,integer,uuid),public.sandy_iap_repair_job_admit(uuid,uuid,integer,uuid,text,text),
 public.sandy_iap_repair_status(uuid,uuid,integer,uuid,uuid,uuid) TO service_role;

REVOKE ALL ON FUNCTION public.sandy_iap_repair_admit(uuid,uuid,integer,text,uuid,text,text),
 public.sandy_iap_repair_context(uuid,uuid,integer,uuid,uuid,uuid,boolean),
 public.sandy_iap_repair_claim(uuid,uuid,integer,uuid,uuid,uuid,text,text),
 public.sandy_iap_repair_write_started(uuid,uuid,integer,uuid,uuid,uuid,integer,text,text,text,text,text),
 public.sandy_iap_repair_finish(uuid,uuid,integer,uuid,uuid,uuid,jsonb) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.sandy_iap_repair_claim(uuid,uuid,integer,uuid,uuid,uuid,text,text),
 public.sandy_iap_repair_write_started(uuid,uuid,integer,uuid,uuid,uuid,integer,text,text,text,text,text),
 public.sandy_iap_repair_finish(uuid,uuid,integer,uuid,uuid,uuid,jsonb) TO service_role;
-- Extend the existing implementation-request contract only. No catalogue
-- insertion, exposure or verification flag changes. Generic provider execution
-- remains forbidden: these are three typed variants for the existing proposal.
DO $contract$ DECLARE old jsonb;BEGIN
 SELECT input_schema INTO old FROM public.sandy_operation_registry WHERE operation='engineering.implementation.request' AND handler='sandy-engineering-control' FOR UPDATE;
 IF old IS NULL OR old->'properties'->'provider'->'enum' IS DISTINCT FROM '["github","supabase"]'::jsonb
 THEN RAISE EXCEPTION 'reviewed_existing_implementation_request_schema_required';END IF;
 UPDATE public.sandy_operation_registry SET input_schema=jsonb_build_object('oneOf',jsonb_build_array(old)||'[{"type":"object","required":["change_id","provider","operation","target","idempotency_key","payload"],"additionalProperties":false,"properties":{"change_id":{"type":"string","const":"52d56740-59c8-4db1-b7e6-a137c7699b86"},"provider":{"type":"string","const":"google_cloud"},"operation":{"type":"string","const":"iap.repair.plan"},"target":{"type":"string","const":"sandy-iap-repair:elaborate-haven-511518-a5:sandy-video+sandy-windows"},"idempotency_key":{"type":"string","pattern":"^[A-Za-z0-9:_-]{12,100}$"},"payload":{"type":"object","properties":{},"required":[],"additionalProperties":false}}},{"type":"object","required":["change_id","provider","operation","target","idempotency_key","payload"],"additionalProperties":false,"properties":{"change_id":{"type":"string","const":"52d56740-59c8-4db1-b7e6-a137c7699b86"},"provider":{"type":"string","const":"google_cloud"},"operation":{"type":"string","const":"iap.repair.apply"},"target":{"type":"string","const":"sandy-iap-repair:elaborate-haven-511518-a5:sandy-video+sandy-windows"},"idempotency_key":{"type":"string","pattern":"^[A-Za-z0-9:_-]{12,100}$"},"payload":{"type":"object","properties":{"parent_admission_id":{"type":"string","format":"uuid"}},"required":["parent_admission_id"],"additionalProperties":false}}},{"type":"object","required":["change_id","provider","operation","target","idempotency_key","payload"],"additionalProperties":false,"properties":{"change_id":{"type":"string","const":"52d56740-59c8-4db1-b7e6-a137c7699b86"},"provider":{"type":"string","const":"google_cloud"},"operation":{"type":"string","const":"iap.repair.rollback"},"target":{"type":"string","const":"sandy-iap-repair:elaborate-haven-511518-a5:sandy-video+sandy-windows"},"idempotency_key":{"type":"string","pattern":"^[A-Za-z0-9:_-]{12,100}$"},"payload":{"type":"object","properties":{"parent_admission_id":{"type":"string","format":"uuid"}},"required":["parent_admission_id"],"additionalProperties":false}}}]'::jsonb)
 WHERE operation='engineering.implementation.request';
END $contract$;
NOTIFY pgrst,'reload schema';
COMMIT;
