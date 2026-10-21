-- Dedicated mission worker application service. Draft-only; no external tools.
-- One-use admission and atomic client-review storage prevent paid/write replay.
BEGIN;
CREATE TABLE public.sandy_mission_work_product_audit (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 operation text NOT NULL DEFAULT 'agent.missions.work_product.prepare' CHECK(operation='agent.missions.work_product.prepare'),
 contract_version text NOT NULL DEFAULT '1.0.0' CHECK(contract_version='1.0.0'),
 principal_kind text NOT NULL DEFAULT 'trusted_internal_worker' CHECK(principal_kind='trusted_internal_worker'),
 auth_user_id uuid CHECK(auth_user_id IS NULL),
 run_id uuid NOT NULL UNIQUE REFERENCES public.sandy_mission_runs(id),
 customer_id uuid NOT NULL REFERENCES public.email_customers(id),
 mission_task_id uuid NOT NULL,
 milestone_task_id uuid,
 source_runtime text NOT NULL DEFAULT 'sandy-mission-executor' CHECK(source_runtime='sandy-mission-executor'),
 source_sha256 text NOT NULL CHECK(source_sha256='6f6b7ce3d1bca03d9637c46a3535c4f288efef4c3a5532cc8a6ef5a6de3b0dc4'),
 scope_sha256 text NOT NULL CHECK(scope_sha256 ~ '^[a-f0-9]{64}$'),
 provisional_plan boolean NOT NULL,
 waiting_reason text CHECK(waiting_reason IN ('no_eligible_internal_step','blocked_by_milestone_dependencies')),
 state text NOT NULL CHECK(state IN ('started','succeeded','waiting','unknown')),
 provider_response_id text CHECK(provider_response_id IS NULL OR length(provider_response_id) BETWEEN 1 AND 512),
 response_sha256 text CHECK(response_sha256 IS NULL OR response_sha256 ~ '^[a-f0-9]{64}$'),
 draft_sha256 text CHECK(draft_sha256 IS NULL OR draft_sha256 ~ '^[a-f0-9]{64}$'),
 work_product_id uuid REFERENCES public.sandy_mission_work_products(id),
 review_task_id uuid,
 error text,
 created_at timestamptz NOT NULL DEFAULT now(),
 finished_at timestamptz,
 FOREIGN KEY(mission_task_id,customer_id) REFERENCES public.sandy_tasks(id,customer_id),
 FOREIGN KEY(milestone_task_id,customer_id) REFERENCES public.sandy_tasks(id,customer_id),
 FOREIGN KEY(review_task_id,customer_id) REFERENCES public.sandy_tasks(id,customer_id),
 CHECK((state='started' AND finished_at IS NULL AND provider_response_id IS NULL AND response_sha256 IS NULL AND draft_sha256 IS NULL AND work_product_id IS NULL AND review_task_id IS NULL AND error IS NULL) OR
  (state='succeeded' AND finished_at IS NOT NULL AND waiting_reason IS NULL AND milestone_task_id IS NOT NULL AND provider_response_id IS NOT NULL AND response_sha256 IS NOT NULL AND draft_sha256 IS NOT NULL AND work_product_id IS NOT NULL AND review_task_id IS NOT NULL AND error IS NULL) OR
  (state='waiting' AND finished_at IS NOT NULL AND waiting_reason IS NOT NULL AND milestone_task_id IS NULL AND provider_response_id IS NULL AND response_sha256 IS NULL AND draft_sha256 IS NULL AND work_product_id IS NULL AND review_task_id IS NULL AND error IS NULL) OR
  (state='unknown' AND finished_at IS NOT NULL AND draft_sha256 IS NULL AND work_product_id IS NULL AND review_task_id IS NULL AND error='mission_work_product_outcome_requires_reconciliation'))
);
CREATE UNIQUE INDEX sandy_mission_work_product_unresolved_milestone ON public.sandy_mission_work_product_audit(customer_id,mission_task_id,milestone_task_id) WHERE milestone_task_id IS NOT NULL AND state IN ('started','unknown');
ALTER TABLE public.sandy_mission_work_product_audit ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.sandy_mission_work_product_audit FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON public.sandy_mission_work_product_audit TO service_role;
COMMENT ON TABLE public.sandy_mission_work_product_audit IS
 'Dedicated renewal-key worker receipts for actual tenant mission runs. Not an Auth/customer session. One claim per run; only draft/review records, no external actions. Hashes and model ID attest internal draft storage, not research, client approval, deployment or provider execution. Unknown cannot redispatch.';
CREATE FUNCTION public.sandy_mission_work_product_scope(p_run_id uuid,p_milestone_id uuid)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,public,extensions AS $scope$
DECLARE j public.sandy_mission_runs%ROWTYPE; m public.sandy_tasks%ROWTYPE; t public.sandy_tasks%ROWTYPE;
 prior public.sandy_mission_work_products%ROWTYPE; ctx jsonb; snapshot jsonb; dependencies jsonb;
BEGIN
 SELECT * INTO j FROM public.sandy_mission_runs WHERE id=p_run_id;
 IF NOT FOUND OR j.stage<>'execute' THEN RAISE EXCEPTION 'mission_actual_execute_run_required'; END IF;
 SELECT * INTO m FROM public.sandy_tasks WHERE id=j.mission_task_id AND customer_id=j.customer_id;
 IF NOT FOUND OR m.metadata->'sandy_mission' IS DISTINCT FROM 'true'::jsonb OR m.status IN ('completed','cancelled') OR m.archived_at IS NOT NULL THEN RAISE EXCEPTION 'mission_unavailable'; END IF;
 IF coalesce(m.metadata->>'execution_state','') NOT IN ('awaiting_client_plan_review','plan_approved_external_actions_still_gated','awaiting_client_deliverable_review') THEN RAISE EXCEPTION 'mission_plan_not_approved'; END IF;
 snapshot:=jsonb_build_object('mission_id',m.id,'customer_id',m.customer_id,'title',m.title,'details',m.details,'status',m.status,'metadata',m.metadata,'company_id',m.company_id,'archived_at',m.archived_at);
 IF p_milestone_id IS NULL THEN
  SELECT coalesce(jsonb_agg(jsonb_build_object('id',c.id,'status',c.status,'metadata',c.metadata) ORDER BY c.created_at,c.id),'[]'::jsonb) INTO dependencies FROM
   (SELECT * FROM public.sandy_tasks WHERE parent_task_id=m.id AND customer_id=j.customer_id AND archived_at IS NULL ORDER BY created_at LIMIT 100)c;
  RETURN jsonb_build_object('snapshot',snapshot,'children',dependencies,'context',NULL,'provisional_plan',m.metadata->>'execution_state'='awaiting_client_plan_review');
 END IF;
 SELECT * INTO t FROM public.sandy_tasks WHERE id=p_milestone_id AND parent_task_id=m.id AND customer_id=j.customer_id AND archived_at IS NULL;
 IF NOT FOUND OR t.status<>'todo' OR t.metadata->>'assigned_to' IS DISTINCT FROM 'sandy' OR t.metadata->>'stage' IS DISTINCT FROM 'planned' OR
  t.metadata->'approval_required'='true'::jsonb OR coalesce(t.metadata->>'mission_run_id','')='' THEN RAISE EXCEPTION 'mission_internal_ready_milestone_required'; END IF;
 -- A metadata UUID alone is not an independent tenant/plan binding.
 IF NOT EXISTS(SELECT 1 FROM public.sandy_mission_runs plan WHERE plan.id::text=t.metadata->>'mission_run_id' AND plan.mission_task_id=m.id AND plan.customer_id=j.customer_id AND plan.stage='plan' AND plan.state='completed') THEN RAISE EXCEPTION 'mission_actual_plan_run_scope_required'; END IF;
 WITH children AS(SELECT * FROM public.sandy_tasks WHERE parent_task_id=m.id AND customer_id=j.customer_id AND archived_at IS NULL ORDER BY created_at LIMIT 100)
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',c.id,'status',c.status,'plan_index',c.metadata->'plan_index') ORDER BY c.id),'[]'::jsonb) INTO dependencies
 FROM children c WHERE c.metadata->>'mission_run_id'=t.metadata->>'mission_run_id' AND c.metadata->'plan_index' IN (SELECT value FROM jsonb_array_elements(CASE WHEN jsonb_typeof(t.metadata->'depends_on')='array' THEN t.metadata->'depends_on' ELSE '[]'::jsonb END));
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(CASE WHEN jsonb_typeof(t.metadata->'depends_on')='array' THEN t.metadata->'depends_on' ELSE '[]'::jsonb END) d WHERE NOT EXISTS(
  SELECT 1 FROM jsonb_array_elements(dependencies)c WHERE c->'plan_index'=d.value AND c->>'status'='completed')) THEN RAISE EXCEPTION 'mission_dependency_not_completed'; END IF;
 SELECT * INTO prior FROM public.sandy_mission_work_products WHERE customer_id=j.customer_id AND milestone_task_id=t.id ORDER BY created_at DESC LIMIT 1;
 ctx:=jsonb_build_object('project',m.title,'objective',m.details,'milestone',t.title,'milestone_details',t.details,'revision_feedback',t.metadata->'revision_feedback','previous_draft',CASE WHEN prior.id IS NULL THEN NULL ELSE left(prior.content,8000) END);
 IF m.metadata ? 'plan_summary' THEN ctx:=ctx||jsonb_build_object('approved_plan_summary',m.metadata->'plan_summary'); END IF;
 RETURN jsonb_build_object('snapshot',snapshot,'milestone',jsonb_build_object('id',t.id,'title',t.title,'details',t.details,'status',t.status,'metadata',t.metadata,'company_id',t.company_id),
  'dependencies',dependencies,'prior_id',prior.id,'prior_state',prior.state,'context',ctx,'provisional_plan',m.metadata->>'execution_state'='awaiting_client_plan_review');
END $scope$;
REVOKE ALL ON FUNCTION public.sandy_mission_work_product_scope(uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION public.sandy_mission_work_product_receipt_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $guard$
DECLARE j public.sandy_mission_runs%ROWTYPE;
BEGIN
 IF TG_OP='UPDATE' THEN
  IF OLD.state<>'started' OR NEW.state NOT IN ('succeeded','waiting','unknown') THEN RAISE EXCEPTION 'mission_work_product_receipt_transition_denied'; END IF;
  IF (to_jsonb(NEW)-ARRAY['state','provider_response_id','response_sha256','draft_sha256','work_product_id','review_task_id','error','finished_at']) IS DISTINCT FROM
     (to_jsonb(OLD)-ARRAY['state','provider_response_id','response_sha256','draft_sha256','work_product_id','review_task_id','error','finished_at']) THEN RAISE EXCEPTION 'mission_work_product_receipt_scope_immutable'; END IF;
 ELSE
  IF NEW.state<>'started' THEN RAISE EXCEPTION 'mission_work_product_started_claim_required'; END IF;
 END IF;
 SELECT * INTO j FROM public.sandy_mission_runs WHERE id=NEW.run_id;
 IF NOT FOUND OR j.stage<>'execute' OR j.customer_id IS DISTINCT FROM NEW.customer_id OR j.mission_task_id IS DISTINCT FROM NEW.mission_task_id OR
  (TG_OP='INSERT' AND j.state<>'queued') THEN RAISE EXCEPTION 'mission_work_product_actual_run_scope_required'; END IF;
 RETURN NEW;
END $guard$;
REVOKE ALL ON FUNCTION public.sandy_mission_work_product_receipt_guard() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER sandy_mission_work_product_receipt_binding BEFORE INSERT OR UPDATE ON public.sandy_mission_work_product_audit FOR EACH ROW EXECUTE FUNCTION public.sandy_mission_work_product_receipt_guard();
CREATE FUNCTION public.sandy_prepare_mission_work_product(p_run_id uuid,p_customer_id uuid,p_mission_id uuid,p_source_sha256 text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,extensions AS $prepare$
DECLARE j public.sandy_mission_runs%ROWTYPE; selected uuid; eligible integer; reason text; scope jsonb; receipt uuid;
BEGIN
 SELECT * INTO j FROM public.sandy_mission_runs WHERE id=p_run_id FOR UPDATE;
 IF NOT FOUND OR j.customer_id IS DISTINCT FROM p_customer_id OR j.mission_task_id IS DISTINCT FROM p_mission_id OR j.stage<>'execute' THEN RAISE EXCEPTION 'mission_actual_execute_run_scope_required'; END IF;
 IF EXISTS(SELECT 1 FROM public.sandy_mission_work_product_audit WHERE run_id=j.id) THEN RAISE unique_violation USING MESSAGE='mission_work_product_one_use_claim_exists'; END IF;
 IF j.state<>'queued' OR p_source_sha256 IS DISTINCT FROM '6f6b7ce3d1bca03d9637c46a3535c4f288efef4c3a5532cc8a6ef5a6de3b0dc4' THEN RAISE EXCEPTION 'mission_work_product_admission_scope_mismatch'; END IF;
 -- Preserve the archived 100-child view, eligibility, first ready milestone and
 -- same-plan completed prerequisite rule. All tenant links are server derived.
 WITH children AS(SELECT * FROM public.sandy_tasks WHERE parent_task_id=j.mission_task_id AND customer_id=j.customer_id AND archived_at IS NULL ORDER BY created_at LIMIT 100),
 candidates AS(SELECT * FROM children WHERE status='todo' AND coalesce(metadata->>'mission_run_id','')<>'' AND metadata->>'assigned_to'='sandy' AND metadata->>'stage'='planned' AND metadata->'approval_required' IS DISTINCT FROM 'true'::jsonb)
 SELECT count(*) INTO eligible FROM candidates;
 IF eligible=0 THEN reason:='no_eligible_internal_step'; ELSE
  WITH children AS(SELECT * FROM public.sandy_tasks WHERE parent_task_id=j.mission_task_id AND customer_id=j.customer_id AND archived_at IS NULL ORDER BY created_at LIMIT 100)
  SELECT c.id INTO selected FROM children c WHERE c.status='todo' AND coalesce(c.metadata->>'mission_run_id','')<>'' AND c.metadata->>'assigned_to'='sandy' AND c.metadata->>'stage'='planned' AND c.metadata->'approval_required' IS DISTINCT FROM 'true'::jsonb AND NOT EXISTS(
   SELECT 1 FROM jsonb_array_elements(CASE WHEN jsonb_typeof(c.metadata->'depends_on')='array' THEN c.metadata->'depends_on' ELSE '[]'::jsonb END)d WHERE NOT EXISTS(SELECT 1 FROM children p WHERE p.metadata->>'mission_run_id'=c.metadata->>'mission_run_id' AND p.metadata->'plan_index'=d.value AND p.status='completed')) ORDER BY c.created_at LIMIT 1;
  IF selected IS NULL THEN reason:='blocked_by_milestone_dependencies'; END IF;
 END IF;
 IF selected IS NOT NULL AND EXISTS(SELECT 1 FROM public.sandy_mission_work_product_audit WHERE customer_id=j.customer_id AND mission_task_id=j.mission_task_id AND milestone_task_id=selected AND state IN ('started','unknown')) THEN RAISE EXCEPTION 'mission_milestone_outcome_requires_reconciliation'; END IF;
 scope:=public.sandy_mission_work_product_scope(j.id,selected);
 INSERT INTO public.sandy_mission_work_product_audit(run_id,customer_id,mission_task_id,milestone_task_id,source_sha256,scope_sha256,provisional_plan,waiting_reason,state)
 VALUES(j.id,j.customer_id,j.mission_task_id,selected,p_source_sha256,encode(extensions.digest(scope::text,'sha256'),'hex'),(scope->>'provisional_plan')::boolean,reason,'started') RETURNING id INTO receipt;
 UPDATE public.sandy_mission_runs SET state='running',updated_at=now() WHERE id=j.id AND state='queued';
 IF NOT FOUND THEN RAISE EXCEPTION 'mission_work_product_claim_status_lost'; END IF;
 RETURN jsonb_build_object('id',receipt,'milestone_task_id',selected,'context',scope->'context','waiting_reason',reason,'provisional_plan',(scope->>'provisional_plan')::boolean);
END $prepare$;
REVOKE ALL ON FUNCTION public.sandy_prepare_mission_work_product(uuid,uuid,uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.sandy_prepare_mission_work_product(uuid,uuid,uuid,text) TO service_role;
CREATE FUNCTION public.sandy_finish_mission_work_product(p_audit_id uuid,p_state text,p_provider_response_id text,p_response_sha256 text,p_draft_canonical text,p_error text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,extensions AS $finish$
DECLARE a public.sandy_mission_work_product_audit%ROWTYPE; j public.sandy_mission_runs%ROWTYPE;
 m public.sandy_tasks%ROWTYPE; t public.sandy_tasks%ROWTYPE; scope jsonb; draft jsonb; product uuid; review uuid;
BEGIN
 SELECT * INTO a FROM public.sandy_mission_work_product_audit WHERE id=p_audit_id FOR UPDATE;
 IF NOT FOUND OR a.state<>'started' OR p_state IS NULL OR p_state NOT IN ('succeeded','waiting','unknown') THEN RAISE EXCEPTION 'mission_work_product_finish_claim_required'; END IF;
 SELECT * INTO j FROM public.sandy_mission_runs WHERE id=a.run_id FOR UPDATE;
 IF NOT FOUND OR j.customer_id IS DISTINCT FROM a.customer_id OR j.mission_task_id IS DISTINCT FROM a.mission_task_id OR j.stage<>'execute' THEN RAISE EXCEPTION 'mission_work_product_finish_scope_mismatch'; END IF;
 IF p_state='unknown' THEN
  IF p_error IS DISTINCT FROM 'mission_work_product_outcome_requires_reconciliation' OR p_draft_canonical IS NOT NULL THEN RAISE EXCEPTION 'mission_work_product_unknown_receipt_invalid'; END IF;
  UPDATE public.sandy_mission_runs SET state='failed',error=p_error,updated_at=now() WHERE id=j.id AND state='running';
  UPDATE public.sandy_mission_work_product_audit SET state='unknown',provider_response_id=p_provider_response_id,response_sha256=p_response_sha256,error=p_error,finished_at=now() WHERE id=a.id;
  RETURN jsonb_build_object('ok',true,'reconciliation_required',true);
 END IF;
 IF j.state<>'running' OR p_error IS NOT NULL THEN RAISE EXCEPTION 'mission_work_product_running_claim_required'; END IF;
 SELECT * INTO m FROM public.sandy_tasks WHERE id=a.mission_task_id AND customer_id=a.customer_id FOR UPDATE;
 -- Parent FOR UPDATE plus immediate parent/product FKs prevents committed
 -- child/product insert phantoms. Lock the whole same-parent child set,
 -- including archived/beyond100 rows, so edits cannot enter the original
 -- first100/prerequisite view after its final hash check. Selection stays100.
 PERFORM 1 FROM public.sandy_tasks c WHERE c.customer_id=a.customer_id AND c.parent_task_id=a.mission_task_id ORDER BY c.id FOR SHARE;
 IF a.milestone_task_id IS NOT NULL THEN
  SELECT * INTO t FROM public.sandy_tasks WHERE id=a.milestone_task_id AND customer_id=a.customer_id FOR UPDATE;
  PERFORM 1 FROM public.sandy_mission_runs plan WHERE plan.id::text=t.metadata->>'mission_run_id' AND plan.customer_id=a.customer_id AND plan.mission_task_id=a.mission_task_id AND plan.stage='plan' ORDER BY plan.id FOR SHARE;
  -- All prior rows are locked, not only the latest: changing an older row's
  -- timestamp must not introduce a different latest draft during completion.
  PERFORM 1 FROM public.sandy_mission_work_products prior WHERE prior.customer_id=a.customer_id AND prior.milestone_task_id=a.milestone_task_id ORDER BY prior.id FOR SHARE;
 END IF;
 scope:=public.sandy_mission_work_product_scope(j.id,a.milestone_task_id);
 IF encode(extensions.digest(scope::text,'sha256'),'hex') IS DISTINCT FROM a.scope_sha256 THEN RAISE EXCEPTION 'mission_work_product_context_changed_reconcile'; END IF;
 IF p_state='waiting' THEN
  IF a.waiting_reason IS NULL OR a.milestone_task_id IS NOT NULL OR p_provider_response_id IS NOT NULL OR p_response_sha256 IS NOT NULL OR p_draft_canonical IS NOT NULL THEN RAISE EXCEPTION 'mission_work_product_waiting_receipt_invalid'; END IF;
  UPDATE public.sandy_mission_runs SET state='completed',result=jsonb_build_object('status',a.waiting_reason,'external_actions_performed',0),updated_at=now() WHERE id=j.id;
  UPDATE public.sandy_mission_work_product_audit SET state='waiting',finished_at=now() WHERE id=a.id;
  RETURN jsonb_build_object('ok',true,'work_product_id',NULL);
 END IF;
 IF a.waiting_reason IS NOT NULL OR a.milestone_task_id IS NULL OR p_provider_response_id IS NULL OR length(p_provider_response_id) NOT BETWEEN 1 AND 512 OR p_response_sha256 IS NULL OR p_response_sha256 !~ '^[a-f0-9]{64}$' OR p_draft_canonical IS NULL THEN RAISE EXCEPTION 'mission_work_product_actual_model_receipt_required'; END IF;
 draft:=p_draft_canonical::jsonb;
 IF jsonb_typeof(draft) IS DISTINCT FROM 'object' OR jsonb_typeof(draft->'title') IS DISTINCT FROM 'string' OR length(draft->>'title') NOT BETWEEN 1 AND 240 OR
  jsonb_typeof(draft->'content') IS DISTINCT FROM 'string' OR length(trim(draft->>'content'))<150 OR length(draft->>'content')>14000 OR
  coalesce(draft->>'content_type','') NOT IN ('checklist','draft','decision_brief') OR (SELECT count(*) FROM jsonb_object_keys(draft))<>3 THEN RAISE EXCEPTION 'mission_work_product_normalized_draft_required'; END IF;
 INSERT INTO public.sandy_mission_work_products(mission_task_id,milestone_task_id,customer_id,run_id,title,content,content_type,state,sources)
 VALUES(m.id,t.id,a.customer_id,j.id,draft->>'title',draft->>'content',draft->>'content_type','pending_review','[]'::jsonb) RETURNING id INTO product;
 UPDATE public.sandy_tasks SET status='waiting',metadata=metadata||jsonb_build_object('execution_state','draft_pending_review','work_product_id',product) WHERE id=t.id AND customer_id=a.customer_id;
 INSERT INTO public.sandy_tasks(customer_id,parent_task_id,title,details,status,priority,metadata)
 VALUES(a.customer_id,m.id,'Review Sandy''s draft: '||left(t.title,195),'Review this prepared draft in Sandy Missions and either approve it or request revisions. No external action has been taken.','todo','normal',
  jsonb_build_object('sandy_mission_step',true,'assigned_to','client','requested_by','sandy','stage','deliverable_review','work_product_id',product)) RETURNING id INTO review;
 UPDATE public.sandy_tasks SET status='waiting',metadata=metadata||jsonb_build_object('execution_state',CASE WHEN a.provisional_plan THEN 'awaiting_client_plan_review' ELSE 'awaiting_client_deliverable_review' END) WHERE id=m.id AND customer_id=a.customer_id;
 UPDATE public.sandy_mission_runs SET state='completed',result=jsonb_build_object('work_product_id',product,'milestone_task_id',t.id,'provisional_plan',a.provisional_plan,'external_actions_performed',0),updated_at=now() WHERE id=j.id;
 INSERT INTO public.sandy_task_events(customer_id,task_id,event_type,actor,snapshot) VALUES(a.customer_id,m.id,'mission_internal_draft_prepared','sandy',jsonb_build_object('run_id',j.id,'milestone_task_id',t.id,'work_product_id',product,'external_actions_performed',0));
 UPDATE public.sandy_mission_work_product_audit SET state='succeeded',provider_response_id=p_provider_response_id,response_sha256=p_response_sha256,draft_sha256=encode(extensions.digest(p_draft_canonical,'sha256'),'hex'),work_product_id=product,review_task_id=review,finished_at=now() WHERE id=a.id;
 RETURN jsonb_build_object('ok',true,'work_product_id',product,'review_task_id',review);
END $finish$;
REVOKE ALL ON FUNCTION public.sandy_finish_mission_work_product(uuid,text,text,text,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.sandy_finish_mission_work_product(uuid,text,text,text,text,text) TO service_role;
DO $guard$ BEGIN IF EXISTS(SELECT 1 FROM public.sandy_operation_registry WHERE operation='agent.missions.work_product.prepare') THEN RAISE EXCEPTION 'mission_work_product_operation_already_registered_reconcile_first'; END IF; END $guard$;
INSERT INTO public.sandy_operation_registry(operation,domain,description,permission_scope,is_mutation,input_schema,output_schema,handler,api_exposed,ui_exposed,ai_exposed,verified,implementation_state,source_repository,source_path,dependencies,error_contract,retry_policy,rollback_policy) VALUES(
 'agent.missions.work_product.prepare',
 'agent',
 'Prepare one internal draft for the actual dependency-ready Sandy-owned mission milestone, then create a client review record. Preserve provisional/approved plan gates. No research, file inspection, communication, payment or external action is performed. Contract v1.0.0. Dedicated internal worker capability only; no public JSON handler readiness is asserted.',
 'worker:missions',
 true,
 '{"type":"object","properties":{},"required":[],"additionalProperties":false}'::jsonb,
 '{"type":"object","properties":{"ok":{"const":true},"operation":{"const":"agent.missions.work_product.prepare"},"contract_version":{"const":"1.0.0"},"principal_kind":{"const":"trusted_internal_worker"},"auth_user_id":{"type":"null"},"customer_id":{"type":"string","format":"uuid"},"run_id":{"type":"string","format":"uuid"},"mission_id":{"type":"string","format":"uuid"},"outcome":{"enum":["draft_pending_review","waiting"]},"work_product_id":{"type":["string","null"],"format":"uuid"},"waiting_reason":{"enum":[null,"no_eligible_internal_step","blocked_by_milestone_dependencies"]},"requires_client_review":{"const":true},"external_actions_performed":{"const":0},"execution_verified":{"const":false}},"required":["ok","operation","contract_version","principal_kind","auth_user_id","customer_id","run_id","mission_id","outcome","work_product_id","waiting_reason","requires_client_review","external_actions_performed","execution_verified"],"additionalProperties":false}'::jsonb,
 'internal:agent.missions.work_product.prepare@1.0.0',
 false,
 false,
 false,
 false,
 'awaiting_deployment',
 'ausstyle/web-staging',
 'supabase/functions/_shared/sandy-agent-operations/worker_mission.ts',
 '["identity:existing_EMAIL_AI_RENEWAL_KEY","capability:process_local_actual_queued_execute_run","database:sandy_mission_work_product_audit","database:atomic_scope_claim_and_draft_review_receipt","provider:fixed_gpt_4.1_mini_80s_Responses","approval:pending_client_plan_or_deliverable_review"]'::jsonb,
 '{"version":"1.0.0","requirement_ids":[154,155,160],"internal_only":true,"sensitive":true,"consumes_model_resources":true,"principal_kind":"trusted_internal_worker","auth_user_id":null,"dedicated_existing_renewal_key":true,"actual_stored_run_customer_mission_required":true,"public_job_milestone_or_model_selection":false,"atomic_one_use_claim_before_model":true,"actual_completed_same_tenant_plan_required":true,"provisional_internal_draft_preserved":true,"completed_same_plan_dependencies_required":true,"atomic_draft_review_task_event_completion":true,"changed_context_refuses_completion":true,"unknown_paid_or_write_redispatch":false,"unknown_milestone_cross_run_redispatch":false,"external_actions_performed":0,"model_output_is_provider_execution_proof":false,"requires_client_review":true,"source_review_only":true,"original_source_sha256":"6f6b7ce3d1bca03d9637c46a3535c4f288efef4c3a5532cc8a6ef5a6de3b0dc4","contract_sha256":"b7f767fc2369b27a450e219656aae437bce3df94d05a068252e4751428a35cc3"}'::jsonb,
 '{"automatic":false,"same_run_redispatch":false,"reason":"Started, waiting, completed and unknown runs cannot repeat model consumption or create another draft/review record."}'::jsonb,
 '{"required":false,"reason":"Model consumption is not reversible. Atomic draft storage remains pending client review; no external action is performed."}'::jsonb
);
COMMIT;
