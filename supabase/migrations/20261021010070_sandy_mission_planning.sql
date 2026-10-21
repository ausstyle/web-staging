-- Private renewal-worker planning and question review. No public API exposure.
BEGIN;
CREATE TABLE public.sandy_mission_planning_audit(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 run_id uuid NOT NULL UNIQUE REFERENCES public.sandy_mission_runs(id),
 customer_id uuid NOT NULL REFERENCES public.email_customers(id),
 mission_task_id uuid NOT NULL,
 operation text NOT NULL DEFAULT 'agent.missions.plan.prepare' CHECK(operation='agent.missions.plan.prepare'),
 contract_version text NOT NULL DEFAULT '1.0.0' CHECK(contract_version='1.0.0'),
 principal_kind text NOT NULL DEFAULT 'trusted_internal_worker' CHECK(principal_kind='trusted_internal_worker'),
 auth_user_id uuid CHECK(auth_user_id IS NULL),
 source_sha256 text NOT NULL CHECK(source_sha256='f4a852845706e11bec633808c3374501b17989923b48c7662bb0e1df789a46d1'),
 scope_sha256 text NOT NULL CHECK(scope_sha256 ~ '^[a-f0-9]{64}$'),
 context jsonb NOT NULL,
 state text NOT NULL CHECK(state IN ('started','proposal_received','succeeded','unknown')),
 provider_response_id text CHECK(provider_response_id IS NULL OR length(provider_response_id) BETWEEN 1 AND 512),
 response_sha256 text CHECK(response_sha256 IS NULL OR response_sha256 ~ '^[a-f0-9]{64}$'),
 plan jsonb, milestones jsonb, candidates jsonb,
 review_state text NOT NULL DEFAULT 'not_needed' CHECK(review_state IN ('not_needed','started','reviewed','unavailable')),
 review_reason text NOT NULL DEFAULT 'not_needed' CHECK(length(review_reason) BETWEEN 1 AND 80),
 review_keep_indexes jsonb,
 review_provider_response_id text CHECK(review_provider_response_id IS NULL OR length(review_provider_response_id) BETWEEN 1 AND 512),
 review_response_sha256 text CHECK(review_response_sha256 IS NULL OR review_response_sha256 ~ '^[a-f0-9]{64}$'),
 error text,
 created_at timestamptz NOT NULL DEFAULT now(), finished_at timestamptz,
 FOREIGN KEY(mission_task_id,customer_id) REFERENCES public.sandy_tasks(id,customer_id),
 CHECK((state IN ('started','proposal_received') AND finished_at IS NULL AND error IS NULL) OR
       (state='succeeded' AND finished_at IS NOT NULL AND error IS NULL AND review_state<>'started') OR
       (state='unknown' AND finished_at IS NOT NULL AND error='mission_plan_outcome_requires_reconciliation')),
 CHECK((state='started' AND plan IS NULL AND milestones IS NULL AND candidates IS NULL AND provider_response_id IS NULL AND response_sha256 IS NULL AND review_state='not_needed') OR
       state='unknown' OR (state IN ('proposal_received','succeeded') AND jsonb_typeof(plan)='object' AND jsonb_typeof(milestones)='array' AND jsonb_typeof(candidates)='array' AND provider_response_id IS NOT NULL AND response_sha256 IS NOT NULL)),
 CHECK(review_state<>'reviewed' OR (review_provider_response_id IS NOT NULL AND review_response_sha256 IS NOT NULL AND jsonb_typeof(review_keep_indexes)='array' AND review_reason='reviewed'))
);
CREATE UNIQUE INDEX sandy_mission_planning_unresolved ON public.sandy_mission_planning_audit(customer_id,mission_task_id) WHERE state IN ('started','proposal_received','unknown');
ALTER TABLE public.sandy_mission_planning_audit ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.sandy_mission_planning_audit FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON public.sandy_mission_planning_audit TO service_role;
COMMENT ON TABLE public.sandy_mission_planning_audit IS 'One-use actual renewal-worker plan/reviewer receipts. No Auth user or external actions. Started/unknown logical missions cannot redispatch under another run ID. Model receipt is proposal provenance, not provider execution or client approval.';
CREATE FUNCTION public.sandy_lock_mission_planning_scope(p_customer uuid,p_mission uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $lock$
BEGIN
 -- Preserve the original first2000 customer window: freezing only descendants
 -- would let unrelated task edits change that bounded selection after the check.
 -- Immediate customer/mission FKs block insert phantoms for these short DB txns.
 PERFORM 1 FROM public.email_customers WHERE id=p_customer FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'mission_plan_actual_customer_required'; END IF;
 PERFORM 1 FROM public.sandy_tasks WHERE customer_id=p_customer ORDER BY id FOR UPDATE;
 PERFORM 1 FROM public.sandy_mission_questions WHERE mission_task_id=p_mission ORDER BY id FOR UPDATE;
 PERFORM 1 FROM public.sandy_mission_question_files WHERE mission_task_id=p_mission ORDER BY id FOR UPDATE;
 -- Lock the view's real base rows: readiness/name/policy inputs must remain
 -- stable through the final context comparison. Missing rows refuse admission
 -- instead of leaving an absent-row insertion phantom or inventing readiness.
 PERFORM 1 FROM public.sandy_ai_integrations WHERE integration_key IN ('openai_web_search','openai_file_search','openai_agents','openai_image','openai_evals') ORDER BY integration_key FOR SHARE;
 IF (SELECT count(DISTINCT integration_key) FROM public.sandy_ai_integrations WHERE integration_key IN ('openai_web_search','openai_file_search','openai_agents','openai_image','openai_evals'))<>5 THEN RAISE EXCEPTION 'mission_plan_actual_tool_catalogue_incomplete'; END IF;
 IF EXISTS(SELECT 1 FROM public.sandy_mission_questions WHERE mission_task_id=p_mission AND customer_id IS DISTINCT FROM p_customer) OR
    EXISTS(SELECT 1 FROM public.sandy_mission_question_files f WHERE f.mission_task_id=p_mission AND (f.customer_id IS DISTINCT FROM p_customer OR NOT EXISTS(SELECT 1 FROM public.sandy_mission_questions q WHERE q.id=f.question_id AND q.customer_id=p_customer AND q.mission_task_id=p_mission))) THEN RAISE EXCEPTION 'mission_plan_question_file_tenant_mismatch'; END IF;
END $lock$;
REVOKE ALL ON FUNCTION public.sandy_lock_mission_planning_scope(uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION public.sandy_mission_planning_scope(p_run uuid) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,public AS $scope$
DECLARE j public.sandy_mission_runs%ROWTYPE; m public.sandy_tasks%ROWTYPE; all_tasks jsonb; descendants jsonb:='[]'; batch jsonb; steps jsonb; questions jsonb; documents jsonb; tools jsonb; frontier uuid[]; seen uuid[];
BEGIN
 SELECT * INTO j FROM public.sandy_mission_runs WHERE id=p_run;
 IF NOT FOUND OR j.stage<>'plan' THEN RAISE EXCEPTION 'mission_actual_plan_run_required'; END IF;
 SELECT * INTO m FROM public.sandy_tasks WHERE id=j.mission_task_id AND customer_id=j.customer_id;
 IF NOT FOUND OR m.metadata->'sandy_mission' IS DISTINCT FROM 'true'::jsonb OR m.status IN ('completed','cancelled') OR m.archived_at IS NOT NULL THEN RAISE EXCEPTION 'mission_plan_mission_unavailable'; END IF;
 SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY t.created_at,t.id),'[]') INTO all_tasks FROM (SELECT id,parent_task_id,title,details,status,metadata,completed_at,created_at FROM public.sandy_tasks WHERE customer_id=j.customer_id AND archived_at IS NULL ORDER BY created_at,id LIMIT 2000)t;
 frontier:=ARRAY[m.id]; seen:=frontier;
 WHILE cardinality(frontier)>0 AND jsonb_array_length(descendants)<1000 LOOP
  SELECT coalesce(jsonb_agg(t),'[]') INTO batch FROM jsonb_array_elements(all_tasks)t WHERE (t->>'parent_task_id')::uuid=ANY(frontier) AND NOT((t->>'id')::uuid=ANY(seen));
  SELECT coalesce(array_agg((t->>'id')::uuid),ARRAY[]::uuid[]) INTO frontier FROM jsonb_array_elements(batch)t;
  seen:=seen||frontier; descendants:=descendants||batch;
 END LOOP;
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',t->'id','parent_task_id',t->'parent_task_id','title',t->'title','description',left(coalesce(t->>'details',''),350),'status',t->'status','owner',coalesce(t->'metadata'->>'assigned_to','unknown'),'stage',t->'metadata'->'stage','completed_at',t->'completed_at')),'[]') INTO steps FROM jsonb_array_elements(descendants)t;
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',id,'question_key',question_key,'status',status,'question',question,'answer',answer) ORDER BY id),'[]') INTO questions FROM public.sandy_mission_questions WHERE customer_id=j.customer_id AND mission_task_id=m.id;
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',id,'filename',filename,'mime_type',mime_type,'question_id',question_id) ORDER BY id),'[]') INTO documents FROM public.sandy_mission_question_files WHERE mission_task_id=m.id AND customer_id=j.customer_id AND status='ready';
 SELECT coalesce(jsonb_agg(jsonb_build_object('tool_key',tool_key,'name',name,'readiness',readiness,'policy',policy) ORDER BY tool_key),'[]') INTO tools FROM public.sandy_operational_tool_registry WHERE tool_key IN ('openai_web_search','openai_file_search','openai_agents','openai_image','openai_evals');
 RETURN jsonb_build_object('mission',jsonb_build_object('id',m.id,'customer_id',m.customer_id,'title',m.title,'details',m.details,'metadata',m.metadata,'status',m.status,'archived_at',m.archived_at),'steps',steps,'availableTools',tools,'documents',documents,'answered',(SELECT coalesce(jsonb_agg(jsonb_build_object('question',q->'question','answer',q->'answer')),'[]') FROM jsonb_array_elements(questions)q WHERE q->>'status'='answered'),'previous_questions',questions);
END $scope$;
REVOKE ALL ON FUNCTION public.sandy_mission_planning_scope(uuid) FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION public.sandy_mission_planning_audit_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $guard$
DECLARE j public.sandy_mission_runs%ROWTYPE;
BEGIN
 SELECT * INTO j FROM public.sandy_mission_runs WHERE id=NEW.run_id;
 IF NOT FOUND OR j.stage<>'plan' OR j.customer_id IS DISTINCT FROM NEW.customer_id OR j.mission_task_id IS DISTINCT FROM NEW.mission_task_id THEN RAISE EXCEPTION 'mission_plan_actual_run_scope_required'; END IF;
 IF TG_OP='INSERT' THEN IF NEW.state<>'started' OR j.state<>'queued' THEN RAISE EXCEPTION 'mission_plan_started_claim_required'; END IF;
 ELSE
  IF OLD.state NOT IN ('started','proposal_received') OR NEW.state NOT IN ('proposal_received','succeeded','unknown') THEN RAISE EXCEPTION 'mission_plan_receipt_transition_denied'; END IF;
  IF (to_jsonb(NEW)-ARRAY['state','provider_response_id','response_sha256','plan','milestones','candidates','review_state','review_reason','review_keep_indexes','review_provider_response_id','review_response_sha256','error','finished_at']) IS DISTINCT FROM
     (to_jsonb(OLD)-ARRAY['state','provider_response_id','response_sha256','plan','milestones','candidates','review_state','review_reason','review_keep_indexes','review_provider_response_id','review_response_sha256','error','finished_at']) THEN RAISE EXCEPTION 'mission_plan_receipt_scope_immutable'; END IF;
  IF OLD.state='proposal_received' AND (NEW.plan IS DISTINCT FROM OLD.plan OR NEW.milestones IS DISTINCT FROM OLD.milestones OR NEW.candidates IS DISTINCT FROM OLD.candidates OR NEW.provider_response_id IS DISTINCT FROM OLD.provider_response_id OR NEW.response_sha256 IS DISTINCT FROM OLD.response_sha256) THEN RAISE EXCEPTION 'mission_recorded_proposal_immutable'; END IF;
  IF OLD.review_state IN ('reviewed','unavailable') AND (NEW.review_state IS DISTINCT FROM OLD.review_state OR NEW.review_keep_indexes IS DISTINCT FROM OLD.review_keep_indexes OR NEW.review_reason IS DISTINCT FROM OLD.review_reason OR NEW.review_provider_response_id IS DISTINCT FROM OLD.review_provider_response_id OR NEW.review_response_sha256 IS DISTINCT FROM OLD.review_response_sha256) THEN RAISE EXCEPTION 'mission_review_receipt_immutable'; END IF;
 END IF;
 RETURN NEW;
END $guard$;
REVOKE ALL ON FUNCTION public.sandy_mission_planning_audit_guard() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER sandy_mission_planning_audit_binding BEFORE INSERT OR UPDATE ON public.sandy_mission_planning_audit FOR EACH ROW EXECUTE FUNCTION public.sandy_mission_planning_audit_guard();
CREATE FUNCTION public.sandy_prepare_mission_plan(p_run_id uuid,p_customer_id uuid,p_mission_id uuid,p_source_sha256 text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,extensions AS $prepare$
DECLARE j public.sandy_mission_runs%ROWTYPE; scope jsonb; receipt uuid;
BEGIN
 SELECT * INTO j FROM public.sandy_mission_runs WHERE id=p_run_id FOR UPDATE;
 IF NOT FOUND OR j.customer_id IS DISTINCT FROM p_customer_id OR j.mission_task_id IS DISTINCT FROM p_mission_id OR j.stage<>'plan' THEN RAISE EXCEPTION 'mission_actual_plan_run_scope_required'; END IF;
 IF EXISTS(SELECT 1 FROM public.sandy_mission_planning_audit WHERE run_id=j.id) THEN RAISE unique_violation USING MESSAGE='mission_plan_one_use_claim_exists'; END IF;
 IF j.state<>'queued' OR p_source_sha256 IS DISTINCT FROM 'f4a852845706e11bec633808c3374501b17989923b48c7662bb0e1df789a46d1' THEN RAISE EXCEPTION 'mission_plan_admission_scope_mismatch'; END IF;
 PERFORM public.sandy_lock_mission_planning_scope(j.customer_id,j.mission_task_id);
 IF EXISTS(SELECT 1 FROM public.sandy_mission_planning_audit WHERE customer_id=j.customer_id AND mission_task_id=j.mission_task_id AND state IN ('started','proposal_received','unknown')) THEN RAISE EXCEPTION 'mission_plan_outcome_requires_reconciliation'; END IF;
 scope:=public.sandy_mission_planning_scope(j.id);
 INSERT INTO public.sandy_mission_planning_audit(run_id,customer_id,mission_task_id,source_sha256,scope_sha256,context,state) VALUES(j.id,j.customer_id,j.mission_task_id,p_source_sha256,encode(extensions.digest(scope::text,'sha256'),'hex'),scope,'started') RETURNING id INTO receipt;
 UPDATE public.sandy_mission_runs SET state='running',updated_at=now() WHERE id=j.id AND state='queued';
 IF NOT FOUND THEN RAISE EXCEPTION 'mission_plan_claim_status_lost'; END IF;
 RETURN jsonb_build_object('id',receipt,'context',scope-'previous_questions','previous_questions',scope->'previous_questions');
END $prepare$;
REVOKE ALL ON FUNCTION public.sandy_prepare_mission_plan(uuid,uuid,uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.sandy_prepare_mission_plan(uuid,uuid,uuid,text) TO service_role;
CREATE FUNCTION public.sandy_record_mission_plan_proposal(p_audit_id uuid,p_plan_canonical text,p_milestones_canonical text,p_candidates_canonical text,p_provider_response_id text,p_response_sha256 text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,extensions AS $proposal$
DECLARE a public.sandy_mission_planning_audit%ROWTYPE; proposal jsonb; normalized_milestones jsonb; normalized_candidates jsonb; item jsonb; i integer:=0; need_review boolean; answered jsonb;
BEGIN
 SELECT * INTO a FROM public.sandy_mission_planning_audit WHERE id=p_audit_id FOR UPDATE;
 IF NOT FOUND OR a.state<>'started' OR p_provider_response_id IS NULL OR length(p_provider_response_id) NOT BETWEEN 1 AND 512 OR p_response_sha256 IS NULL OR p_response_sha256 !~ '^[a-f0-9]{64}$' OR p_plan_canonical IS NULL OR length(p_plan_canonical)>131072 THEN RAISE EXCEPTION 'mission_actual_plan_proposal_receipt_required'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.sandy_mission_runs WHERE id=a.run_id AND customer_id=a.customer_id AND mission_task_id=a.mission_task_id AND state='running' AND stage='plan') THEN RAISE EXCEPTION 'mission_plan_running_claim_required'; END IF;
 proposal:=p_plan_canonical::jsonb; normalized_milestones:=p_milestones_canonical::jsonb; normalized_candidates:=p_candidates_canonical::jsonb;
 IF jsonb_typeof(proposal) IS DISTINCT FROM 'object' OR jsonb_typeof(normalized_milestones) IS DISTINCT FROM 'array' OR jsonb_array_length(normalized_milestones) NOT BETWEEN 3 AND 7 OR jsonb_typeof(normalized_candidates) IS DISTINCT FROM 'array' OR jsonb_array_length(normalized_candidates)>8 THEN RAISE EXCEPTION 'mission_normalized_plan_required'; END IF;
 FOR item IN SELECT value FROM jsonb_array_elements(normalized_milestones) LOOP
  i:=i+1;
  IF jsonb_typeof(item) IS DISTINCT FROM 'object' OR item->>'customer_id' IS DISTINCT FROM a.customer_id::text OR item->>'parent_task_id' IS DISTINCT FROM a.mission_task_id::text OR length(trim(coalesce(item->>'title',''))) NOT BETWEEN 1 AND 240 OR length(coalesce(item->>'details',''))>2500 OR coalesce(item->>'status','') NOT IN ('todo','waiting') OR item->>'priority' IS DISTINCT FROM 'normal' OR item->'metadata'->'sandy_mission_step' IS DISTINCT FROM 'true'::jsonb OR item->'metadata'->>'stage' IS DISTINCT FROM 'planned' OR item->'metadata'->>'mission_run_id' IS DISTINCT FROM a.run_id::text OR item->'metadata'->>'plan_index' IS DISTINCT FROM i::text OR item->'metadata'->>'tool_execution_state' IS DISTINCT FROM 'not_executed' OR coalesce(item->'metadata'->>'assigned_to','') NOT IN ('sandy','client','external') OR jsonb_typeof(item->'metadata'->'approval_required') IS DISTINCT FROM 'boolean' OR coalesce(item->'metadata'->>'suggested_tool','') NOT IN ('research_web','search_customer_documents','draft_execution_plan','request_image_approval','none') OR jsonb_typeof(item->'metadata'->'depends_on') IS DISTINCT FROM 'array' OR jsonb_array_length(item->'metadata'->'depends_on')>6 OR ((item->'metadata'->>'assigned_to' IN ('client','external') OR item->'metadata'->'approval_required'='true'::jsonb) AND item->>'status'<>'waiting') OR (SELECT count(*) FROM jsonb_object_keys(item))<>7 OR (SELECT count(*) FROM jsonb_object_keys(item->'metadata'))<>9 THEN RAISE EXCEPTION 'mission_normalized_milestone_required'; END IF;
  IF EXISTS(SELECT 1 FROM jsonb_array_elements(item->'metadata'->'depends_on')d WHERE jsonb_typeof(d.value)<>'number' OR d.value::text !~ '^[1-7]$' OR (d.value::text)::integer>jsonb_array_length(normalized_milestones) OR (d.value::text)::integer=i) THEN RAISE EXCEPTION 'mission_normalized_dependencies_required'; END IF;
 END LOOP;
 FOR item IN SELECT value FROM jsonb_array_elements(normalized_candidates) LOOP
  IF jsonb_typeof(item) IS DISTINCT FROM 'object' OR (SELECT count(*) FROM jsonb_object_keys(item))<>2 OR jsonb_typeof(item->'question') IS DISTINCT FROM 'string' OR length(item->>'question') NOT BETWEEN 9 AND 1000 OR jsonb_typeof(item->'question_key') IS DISTINCT FROM 'string' OR length(item->>'question_key') NOT BETWEEN 1 AND 500 OR EXISTS(SELECT 1 FROM jsonb_array_elements(a.context->'previous_questions')q WHERE q->>'question_key'=item->>'question_key') THEN RAISE EXCEPTION 'mission_new_normalized_question_required'; END IF;
 END LOOP;
 IF (SELECT count(DISTINCT q->>'question_key') FROM jsonb_array_elements(normalized_candidates)q)<>jsonb_array_length(normalized_candidates) THEN RAISE EXCEPTION 'mission_duplicate_question_key_refused'; END IF;
 SELECT coalesce(jsonb_agg(q),'[]') INTO answered FROM jsonb_array_elements(a.context->'previous_questions')q WHERE q->>'status'='answered' AND jsonb_typeof(q->'answer')='string' AND length(trim(q->>'answer'))>0;
 need_review:=jsonb_array_length(normalized_candidates)>0 AND jsonb_array_length(answered)>0;
 UPDATE public.sandy_mission_planning_audit SET state='proposal_received',provider_response_id=p_provider_response_id,response_sha256=p_response_sha256,plan=proposal,milestones=normalized_milestones,candidates=normalized_candidates,review_state=CASE WHEN need_review THEN 'started' ELSE 'not_needed' END,review_reason=CASE WHEN need_review THEN 'review_pending' ELSE 'not_needed' END WHERE id=a.id;
 RETURN jsonb_build_object('ok',true,'review_required',need_review,'review_context',CASE WHEN need_review THEN jsonb_build_object('answered',answered,'candidates',normalized_candidates) ELSE NULL END);
END $proposal$;
REVOKE ALL ON FUNCTION public.sandy_record_mission_plan_proposal(uuid,text,text,text,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.sandy_record_mission_plan_proposal(uuid,text,text,text,text,text) TO service_role;
CREATE FUNCTION public.sandy_record_mission_question_review(p_audit_id uuid,p_reason text,p_keep_indexes jsonb,p_provider_response_id text,p_response_sha256 text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $review$
DECLARE a public.sandy_mission_planning_audit%ROWTYPE;
BEGIN
 SELECT * INTO a FROM public.sandy_mission_planning_audit WHERE id=p_audit_id FOR UPDATE;
 IF NOT FOUND OR a.state<>'proposal_received' OR a.review_state<>'started' OR p_reason IS NULL OR (p_reason NOT IN ('reviewed','review_exception','model_outcome_unverified','invalid_model_result','empty_model_output') AND p_reason !~ '^provider_http_[1-5][0-9][0-9]$') THEN RAISE EXCEPTION 'mission_recorded_question_review_claim_required'; END IF;
 IF p_reason='reviewed' THEN
  IF p_provider_response_id IS NULL OR length(p_provider_response_id) NOT BETWEEN 1 AND 512 OR p_response_sha256 IS NULL OR p_response_sha256 !~ '^[a-f0-9]{64}$' OR jsonb_typeof(p_keep_indexes) IS DISTINCT FROM 'array' OR jsonb_array_length(p_keep_indexes)>8 THEN RAISE EXCEPTION 'mission_actual_question_review_receipt_required'; END IF;
  IF EXISTS(SELECT 1 FROM jsonb_array_elements(p_keep_indexes)n WHERE jsonb_typeof(n.value)<>'number' OR n.value::text !~ '^[0-7]$' OR (n.value::text)::integer>=jsonb_array_length(a.candidates)) OR (SELECT count(DISTINCT n.value) FROM jsonb_array_elements(p_keep_indexes)n)<>jsonb_array_length(p_keep_indexes) THEN RAISE EXCEPTION 'mission_review_keep_indexes_invalid'; END IF;
 ELSIF p_keep_indexes IS NOT NULL THEN RAISE EXCEPTION 'mission_unavailable_review_cannot_filter_questions'; END IF;
 UPDATE public.sandy_mission_planning_audit SET review_state=CASE WHEN p_reason='reviewed' THEN 'reviewed' ELSE 'unavailable' END,review_reason=p_reason,review_keep_indexes=p_keep_indexes,review_provider_response_id=p_provider_response_id,review_response_sha256=p_response_sha256 WHERE id=a.id;
 RETURN jsonb_build_object('ok',true);
END $review$;
REVOKE ALL ON FUNCTION public.sandy_record_mission_question_review(uuid,text,jsonb,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.sandy_record_mission_question_review(uuid,text,jsonb,text,text) TO service_role;
CREATE FUNCTION public.sandy_finish_mission_plan(p_audit_id uuid,p_unknown boolean) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,extensions AS $finish$
DECLARE a public.sandy_mission_planning_audit%ROWTYPE; j public.sandy_mission_runs%ROWTYPE; m public.sandy_tasks%ROWTYPE; scope jsonb; item jsonb; old_ids uuid[]; new_questions integer:=0; idx integer:=0; node jsonb; seq integer:=0;
BEGIN
 SELECT * INTO a FROM public.sandy_mission_planning_audit WHERE id=p_audit_id FOR UPDATE;
 IF NOT FOUND OR a.state NOT IN ('started','proposal_received') OR p_unknown IS NULL THEN RAISE EXCEPTION 'mission_plan_finish_claim_required'; END IF;
 SELECT * INTO j FROM public.sandy_mission_runs WHERE id=a.run_id FOR UPDATE;
 IF NOT FOUND OR j.customer_id IS DISTINCT FROM a.customer_id OR j.mission_task_id IS DISTINCT FROM a.mission_task_id OR j.stage<>'plan' THEN RAISE EXCEPTION 'mission_plan_finish_scope_mismatch'; END IF;
 IF p_unknown THEN
  UPDATE public.sandy_mission_runs SET state='failed',error='mission_plan_outcome_requires_reconciliation',updated_at=now() WHERE id=j.id AND state='running';
  UPDATE public.sandy_mission_planning_audit SET state='unknown',error='mission_plan_outcome_requires_reconciliation',finished_at=now() WHERE id=a.id;
  RETURN jsonb_build_object('ok',true,'reconciliation_required',true);
 END IF;
 IF j.state<>'running' OR a.state<>'proposal_received' OR a.review_state='started' THEN RAISE EXCEPTION 'mission_complete_plan_proposal_review_required'; END IF;
 PERFORM public.sandy_lock_mission_planning_scope(a.customer_id,a.mission_task_id);
 scope:=public.sandy_mission_planning_scope(j.id);
 IF encode(extensions.digest(scope::text,'sha256'),'hex') IS DISTINCT FROM a.scope_sha256 THEN RAISE EXCEPTION 'mission_plan_context_changed_reconcile'; END IF;
 SELECT * INTO m FROM public.sandy_tasks WHERE id=a.mission_task_id AND customer_id=a.customer_id;
 IF EXISTS(SELECT 1 FROM public.sandy_tasks WHERE customer_id=a.customer_id AND parent_task_id=m.id AND metadata->>'mission_run_id'=j.id::text) THEN RAISE EXCEPTION 'mission_existing_plan_steps_require_reconciliation'; END IF;
 FOR item IN SELECT value FROM jsonb_array_elements(a.milestones) LOOP
  INSERT INTO public.sandy_tasks(customer_id,parent_task_id,title,details,status,priority,metadata) VALUES(a.customer_id,m.id,item->>'title',item->>'details',item->>'status','normal',item->'metadata');
 END LOOP;
 SELECT array_agg(id ORDER BY id) INTO old_ids FROM public.sandy_tasks WHERE customer_id=a.customer_id AND parent_task_id=m.id AND archived_at IS NULL AND metadata->>'stage'='planned' AND metadata->>'mission_run_id' IS DISTINCT FROM j.id::text AND status='todo' AND metadata->>'assigned_to'='sandy' AND metadata->'approval_required' IS DISTINCT FROM 'true'::jsonb;
 IF cardinality(old_ids)>0 THEN
  UPDATE public.sandy_tasks SET status='cancelled',metadata=jsonb_build_object('sandy_mission_step',true,'stage','planned','assigned_to','sandy','superseded_by_run_id',j.id) WHERE customer_id=a.customer_id AND id=ANY(old_ids) AND status='todo';
  INSERT INTO public.sandy_task_events(customer_id,task_id,event_type,actor,snapshot) VALUES(a.customer_id,m.id,'mission_tasks_superseded','sandy',jsonb_build_object('task_ids',old_ids,'run_id',j.id,'reason','Revised plan superseded unstarted Sandy-owned milestones; client and active work preserved'));
 END IF;
 FOR item IN SELECT value FROM jsonb_array_elements(a.candidates) LOOP
  IF a.review_state<>'reviewed' OR a.review_keep_indexes @> jsonb_build_array(idx) THEN
   INSERT INTO public.sandy_mission_questions(customer_id,mission_task_id,question,question_key) VALUES(a.customer_id,m.id,item->>'question',item->>'question_key'); new_questions:=new_questions+1;
  END IF; idx:=idx+1;
 END LOOP;
 FOR node IN SELECT value FROM jsonb_array_elements(CASE WHEN jsonb_typeof(a.plan->'decision_tree')='array' THEN a.plan->'decision_tree' ELSE '[]'::jsonb END) LIMIT 12 LOOP
  seq:=seq+1;
  IF coalesce(node->>'condition','')<>'' AND coalesce(node->>'on_yes','')<>'' AND coalesce(node->>'on_no','')<>'' THEN INSERT INTO public.sandy_mission_decisions(mission_task_id,customer_id,run_id,sequence,condition,on_yes,on_no) VALUES(m.id,a.customer_id,j.id,seq,left(node->>'condition',800),left(node->>'on_yes',800),left(node->>'on_no',800)); END IF;
 END LOOP;
 UPDATE public.sandy_tasks SET status='waiting',metadata=metadata||jsonb_build_object('execution_state',CASE WHEN new_questions>0 THEN 'awaiting_client_information' ELSE 'awaiting_client_plan_review' END,'plan_summary',left(coalesce(a.plan->>'summary',''),3000),'success_criteria',(SELECT coalesce(jsonb_agg(value),'[]') FROM(SELECT value FROM jsonb_array_elements(CASE WHEN jsonb_typeof(a.plan->'success_criteria')='array' THEN a.plan->'success_criteria' ELSE '[]'::jsonb END)LIMIT 10)s),'last_plan_run_id',j.id,'plan_changes',(SELECT coalesce(jsonb_agg(left(value #>> '{}',600)),'[]') FROM(SELECT value FROM jsonb_array_elements(CASE WHEN jsonb_typeof(a.plan->'plan_changes')='array' THEN a.plan->'plan_changes' ELSE '[]'::jsonb END)LIMIT 12)c),'planning_version',2) WHERE id=m.id AND customer_id=a.customer_id;
 UPDATE public.sandy_mission_runs SET state='completed',plan=a.plan,result=jsonb_build_object('created_milestones',jsonb_array_length(a.milestones),'external_actions_performed',0,'clarification_review',a.review_reason,'new_questions',new_questions),updated_at=now() WHERE id=j.id;
 INSERT INTO public.sandy_task_events(customer_id,task_id,event_type,actor,snapshot) VALUES(a.customer_id,m.id,'mission_plan_prepared','sandy',jsonb_build_object('run_id',j.id,'summary',a.plan->'summary','milestones',jsonb_array_length(a.milestones),'plan_changes',(SELECT coalesce(jsonb_agg(value),'[]') FROM(SELECT value FROM jsonb_array_elements(CASE WHEN jsonb_typeof(a.plan->'plan_changes')='array' THEN a.plan->'plan_changes' ELSE '[]'::jsonb END)LIMIT 12)c),'existing_steps_considered',jsonb_array_length(a.context->'steps'),'external_actions_performed',0));
 UPDATE public.sandy_mission_planning_audit SET state='succeeded',finished_at=now() WHERE id=a.id;
 RETURN jsonb_build_object('ok',true,'created_milestones',jsonb_array_length(a.milestones),'new_questions',new_questions,'clarification_review',a.review_reason);
END $finish$;
REVOKE ALL ON FUNCTION public.sandy_finish_mission_plan(uuid,boolean) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.sandy_finish_mission_plan(uuid,boolean) TO service_role;
DO $guard$ BEGIN IF EXISTS(SELECT 1 FROM public.sandy_operation_registry WHERE operation='agent.missions.plan.prepare') THEN RAISE EXCEPTION 'mission_planning_operation_already_registered_reconcile_first'; END IF; END $guard$;
INSERT INTO public.sandy_operation_registry(operation,domain,description,permission_scope,is_mutation,input_schema,output_schema,handler,api_exposed,ui_exposed,ai_exposed,verified,implementation_state,source_repository,source_path,dependencies,error_contract,retry_policy,rollback_policy) VALUES('agent.missions.plan.prepare',
'agent',
'Prepare a reversible mission plan for the actual stored planning job, preserving client tasks, completed work, answered questions and approval gates. No external tools execute; client plan review is required. Contract v1.0.0. Process-local actual worker capability cannot be supplied by JSON; no public handler readiness is asserted.',
'worker:missions',
true,
'{"type":"object","properties":{},"required":[],"additionalProperties":false}'::jsonb,
'{"type":"object","properties":{"ok":{"const":true},"contract_version":{"const":"1.0.0"},"principal_kind":{"const":"trusted_internal_worker"},"auth_user_id":{"type":"null"},"customer_id":{"type":"string","format":"uuid"},"mission_id":{"type":"string","format":"uuid"},"run_id":{"type":"string","format":"uuid"},"external_actions_performed":{"const":0},"execution_verified":{"const":false},"operation":{"const":"agent.missions.plan.prepare"},"outcome":{"enum":["awaiting_client_information","awaiting_client_plan_review"]},"created_milestones":{"type":"integer","minimum":3,"maximum":7},"new_questions":{"type":"integer","minimum":0,"maximum":8},"clarification_review":{"type":"string","minLength":1,"maxLength":80},"requires_client_plan_review":{"const":true}},"required":["ok","contract_version","principal_kind","auth_user_id","customer_id","mission_id","run_id","external_actions_performed","execution_verified","operation","outcome","created_milestones","new_questions","clarification_review","requires_client_plan_review"],"additionalProperties":false}'::jsonb,
'internal:agent.missions.plan.prepare@1.0.0',
false,
false,
false,
false,
'awaiting_deployment',
'ausstyle/web-staging',
'supabase/functions/_shared/sandy-agent-operations/worker_mission_planning.ts',
'["identity:existing_EMAIL_AI_RENEWAL_KEY","capability:process_local_actual_queued_plan_run","database:sandy_mission_planning_audit","database:atomic_plan_scope_claim_and_storage","provider:fixed_legacy_Responses_profile","approval:client_plan_review_before_external_actions"]'::jsonb,
'{"version":"1.0.0","requirement_ids":[154,155,160],"internal_only":true,"sensitive":true,"consumes_model_resources":true,"principal_kind":"trusted_internal_worker","auth_user_id":null,"dedicated_existing_renewal_key":true,"actual_stored_run_customer_mission_required":true,"public_job_model_prompt_or_tool_selection":false,"atomic_one_use_claim_before_model":true,"unknown_paid_redispatch":false,"unknown_mission_cross_run_redispatch":false,"preserves_answered_questions_and_client_tasks":true,"atomic_plan_questions_decisions_event_completion":true,"client_plan_review_required":true,"model_output_is_provider_execution_proof":false,"external_actions_performed":0,"source_review_only":true,"original_source_sha256":"f4a852845706e11bec633808c3374501b17989923b48c7662bb0e1df789a46d1","contract_sha256":"b9e318b7a2a40a42da15994ef251229bbc1524d63c8b3d6cd812202b533d0979"}'::jsonb,
'{"automatic":false,"same_run_redispatch":false,"unknown_logical_mission_redispatch":false,"reason":"One-use planner/reviewer receipts precede model requests; unknown outcomes require reconciliation."}'::jsonb,
'{"required":false,"reason":"Paid model consumption cannot be reversed. Atomic internal plan storage remains pending client review; no external tool executes."}'::jsonb);
DO $guard$ BEGIN IF EXISTS(SELECT 1 FROM public.sandy_operation_registry WHERE operation='agent.missions.questions.review') THEN RAISE EXCEPTION 'mission_planning_operation_already_registered_reconcile_first'; END IF; END $guard$;
INSERT INTO public.sandy_operation_registry(operation,domain,description,permission_scope,is_mutation,input_schema,output_schema,handler,api_exposed,ui_exposed,ai_exposed,verified,implementation_state,source_repository,source_path,dependencies,error_contract,retry_policy,rollback_policy) VALUES('agent.missions.questions.review',
'agent',
'Review the actual recorded planning proposal''s candidate questions against authoritative answered questions. Task-bound process-local capability only; unavailable/unknown review is explicit and never repeated automatically. Contract v1.0.0. Process-local actual worker capability cannot be supplied by JSON; no public handler readiness is asserted.',
'worker:missions',
true,
'{"type":"object","properties":{},"required":[],"additionalProperties":false}'::jsonb,
'{"type":"object","properties":{"ok":{"const":true},"contract_version":{"const":"1.0.0"},"principal_kind":{"const":"trusted_internal_worker"},"auth_user_id":{"type":"null"},"customer_id":{"type":"string","format":"uuid"},"mission_id":{"type":"string","format":"uuid"},"run_id":{"type":"string","format":"uuid"},"external_actions_performed":{"const":0},"execution_verified":{"const":false},"operation":{"const":"agent.missions.questions.review"},"review_status":{"enum":["reviewed","unavailable"]},"keep_indexes":{"type":"array","maxItems":8,"uniqueItems":true,"items":{"type":"integer","minimum":0,"maximum":7}},"model_review_verified":{"type":"boolean"},"reconciliation_required":{"type":"boolean"}},"required":["ok","contract_version","principal_kind","auth_user_id","customer_id","mission_id","run_id","external_actions_performed","execution_verified","operation","review_status","keep_indexes","model_review_verified","reconciliation_required"],"allOf":[{"if":{"properties":{"review_status":{"const":"reviewed"}}},"then":{"properties":{"model_review_verified":{"const":true},"reconciliation_required":{"const":false}}},"else":{"properties":{"model_review_verified":{"const":false}}}}],"additionalProperties":false}'::jsonb,
'internal:agent.missions.questions.review@1.0.0',
false,
false,
false,
false,
'awaiting_deployment',
'ausstyle/web-staging',
'supabase/functions/_shared/sandy-agent-operations/worker_mission_planning.ts',
'["identity:existing_EMAIL_AI_RENEWAL_KEY","capability:process_local_actual_queued_plan_run","database:sandy_mission_planning_audit","database:atomic_plan_scope_claim_and_storage","provider:fixed_legacy_Responses_profile","approval:client_plan_review_before_external_actions"]'::jsonb,
'{"version":"1.0.0","requirement_ids":[154,155,160],"internal_only":true,"sensitive":true,"consumes_model_resources":true,"principal_kind":"trusted_internal_worker","auth_user_id":null,"dedicated_existing_renewal_key":true,"actual_stored_run_customer_mission_required":true,"public_job_model_prompt_or_tool_selection":false,"atomic_one_use_claim_before_model":true,"unknown_paid_redispatch":false,"unknown_mission_cross_run_redispatch":false,"preserves_answered_questions_and_client_tasks":true,"atomic_plan_questions_decisions_event_completion":true,"client_plan_review_required":true,"model_output_is_provider_execution_proof":false,"external_actions_performed":0,"source_review_only":true,"original_source_sha256":"f4a852845706e11bec633808c3374501b17989923b48c7662bb0e1df789a46d1","contract_sha256":"66461cb57a3324cb946558dde36f55a420673440507feac9749d926a72368954"}'::jsonb,
'{"automatic":false,"same_run_redispatch":false,"unknown_logical_mission_redispatch":false,"reason":"One-use planner/reviewer receipts precede model requests; unknown outcomes require reconciliation."}'::jsonb,
'{"required":false,"reason":"Paid model consumption cannot be reversed. Atomic internal plan storage remains pending client review; no external tool executes."}'::jsonb);
COMMIT;
