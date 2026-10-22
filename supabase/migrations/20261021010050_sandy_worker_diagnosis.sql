-- Dedicated internal reliability worker, never a customer or Controller session.
-- Durable one-use claims close the legacy failed-hour paid-model redispatch.
BEGIN;
CREATE TABLE public.sandy_worker_diagnosis_audit (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 operation text NOT NULL DEFAULT 'agent.reliability.diagnosis.propose' CHECK(operation='agent.reliability.diagnosis.propose'),
 contract_version text NOT NULL DEFAULT '1.0.0' CHECK(contract_version='1.0.0'),
 principal_kind text NOT NULL DEFAULT 'trusted_internal_worker' CHECK(principal_kind='trusted_internal_worker'),
 auth_user_id uuid CHECK(auth_user_id IS NULL),
 customer_id uuid CHECK(customer_id IS NULL),
 job_id uuid NOT NULL UNIQUE REFERENCES public.sandy_auto_improve_runs(id),
 source_runtime text NOT NULL DEFAULT 'sandy-auto-improve' CHECK(source_runtime='sandy-auto-improve'),
 source_sha256 text NOT NULL CHECK(source_sha256='7b66252c752cfd9fb4e74c6e44f325ec83aea29a3eecaaf04250b4d120080c74'),
 source_type text NOT NULL CHECK(source_type IN ('qa_failure','edge_error','customer_feedback','manual','system_awareness')),
 source_ref_sha256 text NOT NULL CHECK(source_ref_sha256 ~ '^[a-f0-9]{64}$'),
 problem_sha256 text NOT NULL CHECK(problem_sha256 ~ '^[a-f0-9]{64}$'),
 request_sha256 text NOT NULL CHECK(request_sha256 ~ '^[a-f0-9]{64}$'),
 state text NOT NULL CHECK(state IN ('started','succeeded','unknown')),
 provider_response_id text CHECK(provider_response_id IS NULL OR length(provider_response_id) BETWEEN 1 AND 512),
 response_sha256 text CHECK(response_sha256 IS NULL OR response_sha256 ~ '^[a-f0-9]{64}$'),
 proposal_sha256 text CHECK(proposal_sha256 IS NULL OR proposal_sha256 ~ '^[a-f0-9]{64}$'),
 error text,
 created_at timestamptz NOT NULL DEFAULT now(),
 finished_at timestamptz,
 CHECK((state='started' AND finished_at IS NULL AND provider_response_id IS NULL AND response_sha256 IS NULL AND proposal_sha256 IS NULL AND error IS NULL) OR
  (state='succeeded' AND finished_at IS NOT NULL AND provider_response_id IS NOT NULL AND response_sha256 IS NOT NULL AND proposal_sha256 IS NOT NULL AND error IS NULL) OR
  (state='unknown' AND finished_at IS NOT NULL AND proposal_sha256 IS NULL AND error='diagnosis_outcome_requires_reconciliation'))
);
ALTER TABLE public.sandy_worker_diagnosis_audit ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.sandy_worker_diagnosis_audit FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON public.sandy_worker_diagnosis_audit TO service_role;
COMMENT ON TABLE public.sandy_worker_diagnosis_audit IS
 'One receipt per actual reserved reliability job; dedicated automation identity, no Auth/customer/owner. Store hashes and model response ID only, no failure text or proposal body. Source review/model response never proves customer/provider execution. Started/unknown/succeeded never redispatch.';
CREATE FUNCTION public.sandy_worker_diagnosis_receipt_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,extensions AS $guard$
DECLARE j public.sandy_auto_improve_runs%ROWTYPE;
BEGIN
 IF TG_OP='UPDATE' THEN
  IF OLD.state<>'started' OR NEW.state NOT IN ('succeeded','unknown') THEN RAISE EXCEPTION 'diagnosis_receipt_transition_denied'; END IF;
  IF (to_jsonb(NEW)-ARRAY['state','provider_response_id','response_sha256','proposal_sha256','error','finished_at']) IS DISTINCT FROM
     (to_jsonb(OLD)-ARRAY['state','provider_response_id','response_sha256','proposal_sha256','error','finished_at']) THEN RAISE EXCEPTION 'diagnosis_receipt_scope_immutable'; END IF;
 ELSE
  IF NEW.state<>'started' THEN RAISE EXCEPTION 'diagnosis_started_claim_required'; END IF;
 END IF;
 SELECT * INTO j FROM public.sandy_auto_improve_runs WHERE id=NEW.job_id;
 IF NOT FOUND OR j.source_type IS DISTINCT FROM NEW.source_type OR
  encode(extensions.digest(j.source_ref,'sha256'),'hex') IS DISTINCT FROM NEW.source_ref_sha256 OR
  encode(extensions.digest(j.problem,'sha256'),'hex') IS DISTINCT FROM NEW.problem_sha256 OR
  (TG_OP='INSERT' AND j.status<>'queued') THEN RAISE EXCEPTION 'diagnosis_receipt_persisted_job_mismatch'; END IF;
 RETURN NEW;
END $guard$;
REVOKE ALL ON FUNCTION public.sandy_worker_diagnosis_receipt_guard() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER sandy_worker_diagnosis_receipt_binding BEFORE INSERT OR UPDATE ON public.sandy_worker_diagnosis_audit
 FOR EACH ROW EXECUTE FUNCTION public.sandy_worker_diagnosis_receipt_guard();
CREATE FUNCTION public.sandy_claim_auto_improve_operation(p_job_id uuid,p_source_type text,p_source_ref text,p_problem_sha256 text,p_request_sha256 text,p_source_sha256 text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,extensions AS $claim$
DECLARE j public.sandy_auto_improve_runs%ROWTYPE; receipt uuid;
BEGIN
 SELECT * INTO j FROM public.sandy_auto_improve_runs WHERE id=p_job_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'diagnosis_actual_job_required'; END IF;
 IF EXISTS(SELECT 1 FROM public.sandy_worker_diagnosis_audit WHERE job_id=j.id) THEN RAISE unique_violation USING MESSAGE='diagnosis_one_use_claim_already_exists'; END IF;
 IF j.status<>'queued' OR j.source_type IS DISTINCT FROM p_source_type OR j.source_ref IS DISTINCT FROM p_source_ref OR
  encode(extensions.digest(j.problem,'sha256'),'hex') IS DISTINCT FROM p_problem_sha256 OR p_source_sha256 IS DISTINCT FROM '7b66252c752cfd9fb4e74c6e44f325ec83aea29a3eecaaf04250b4d120080c74' THEN
  RAISE EXCEPTION 'diagnosis_claim_job_scope_mismatch'; END IF;
 IF j.source_type='qa_failure' AND NOT EXISTS(SELECT 1 FROM public.sandy_evidence_improvement_queue WHERE issue_key='v2:auto_qa:'||j.source_ref) THEN
  RAISE EXCEPTION 'diagnosis_existing_qa_issue_required'; END IF;
 INSERT INTO public.sandy_worker_diagnosis_audit(job_id,source_sha256,source_type,source_ref_sha256,problem_sha256,request_sha256,state)
 VALUES(j.id,p_source_sha256,j.source_type,encode(extensions.digest(j.source_ref,'sha256'),'hex'),p_problem_sha256,p_request_sha256,'started') RETURNING id INTO receipt;
 UPDATE public.sandy_auto_improve_runs SET status='analysing',updated_at=now() WHERE id=j.id AND status='queued';
 IF NOT FOUND THEN RAISE EXCEPTION 'diagnosis_claim_status_lost'; END IF;
 RETURN jsonb_build_object('id',receipt);
END $claim$;
REVOKE ALL ON FUNCTION public.sandy_claim_auto_improve_operation(uuid,text,text,text,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.sandy_claim_auto_improve_operation(uuid,text,text,text,text,text) TO service_role;
CREATE FUNCTION public.sandy_finish_auto_improve_operation(p_audit_id uuid,p_state text,p_provider_response_id text,p_response_sha256 text,p_proposal_canonical text,p_error text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,extensions AS $finish$
DECLARE a public.sandy_worker_diagnosis_audit%ROWTYPE; j public.sandy_auto_improve_runs%ROWTYPE; proposal jsonb;
BEGIN
 SELECT * INTO a FROM public.sandy_worker_diagnosis_audit WHERE id=p_audit_id FOR UPDATE;
 IF NOT FOUND OR a.state<>'started' OR p_state IS NULL OR p_state NOT IN ('succeeded','unknown') THEN RAISE EXCEPTION 'diagnosis_finish_claim_required'; END IF;
 SELECT * INTO j FROM public.sandy_auto_improve_runs WHERE id=a.job_id FOR UPDATE;
 IF NOT FOUND OR j.source_type IS DISTINCT FROM a.source_type OR encode(extensions.digest(j.source_ref,'sha256'),'hex') IS DISTINCT FROM a.source_ref_sha256 OR
  encode(extensions.digest(j.problem,'sha256'),'hex') IS DISTINCT FROM a.problem_sha256 THEN RAISE EXCEPTION 'diagnosis_finish_job_scope_mismatch'; END IF;
 IF p_state='succeeded' THEN
  proposal:=p_proposal_canonical::jsonb;
  IF p_error IS NOT NULL OR p_provider_response_id IS NULL OR length(p_provider_response_id) NOT BETWEEN 1 AND 512 OR p_response_sha256 IS NULL OR p_response_sha256 !~ '^[a-f0-9]{64}$' OR
   j.status<>'proposed' OR j.proposed_fix IS DISTINCT FROM proposal OR jsonb_typeof(proposal) IS DISTINCT FROM 'object' OR
   jsonb_typeof(proposal->'root_cause') IS DISTINCT FROM 'string' OR length(proposal->>'root_cause')<1 OR
   jsonb_typeof(proposal->'regression_tests') IS DISTINCT FROM 'array' OR jsonb_typeof(proposal->'proposed_changes') IS DISTINCT FROM 'array' OR
   j.diagnosis->>'root_cause' IS DISTINCT FROM proposal->>'root_cause' THEN RAISE EXCEPTION 'diagnosis_saved_proposal_receipt_required'; END IF;
  IF j.source_type='qa_failure' AND NOT EXISTS(SELECT 1 FROM public.sandy_qa_engineering_handoffs h WHERE h.issue_key='v2:auto_qa:'||j.source_ref AND
    h.status IN ('fix_proposed','awaiting_approval') AND h.approval_required AND h.evidence->>'diagnosis_id'=j.id::text AND h.evidence->>'source_type'=j.source_type AND
    h.evidence->>'source_ref'=j.source_ref AND h.evidence->>'proposal_only'='true' AND h.verification->>'status'='not_verified') THEN
   RAISE EXCEPTION 'diagnosis_actual_approval_handoff_required'; END IF;
 ELSE
  IF p_error IS DISTINCT FROM 'diagnosis_outcome_requires_reconciliation' OR p_proposal_canonical IS NOT NULL THEN RAISE EXCEPTION 'diagnosis_unknown_receipt_invalid'; END IF;
  -- Preserve a received/saved proposal even if its later handoff was interrupted.
  UPDATE public.sandy_auto_improve_runs SET status='failed',last_error=p_error,updated_at=now() WHERE id=j.id AND status='analysing';
 END IF;
 UPDATE public.sandy_worker_diagnosis_audit SET state=p_state,provider_response_id=p_provider_response_id,response_sha256=p_response_sha256,
  proposal_sha256=CASE WHEN p_state='succeeded' THEN encode(extensions.digest(p_proposal_canonical,'sha256'),'hex') ELSE NULL END,
  error=p_error,finished_at=now() WHERE id=a.id AND state='started';
 RETURN FOUND;
END $finish$;
REVOKE ALL ON FUNCTION public.sandy_finish_auto_improve_operation(uuid,text,text,text,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.sandy_finish_auto_improve_operation(uuid,text,text,text,text,text) TO service_role;
DO $guard$ BEGIN IF EXISTS(SELECT 1 FROM public.sandy_operation_registry WHERE operation='agent.reliability.diagnosis.propose') THEN RAISE EXCEPTION 'worker_diagnosis_operation_already_registered_reconcile_first'; END IF; END $guard$;
INSERT INTO public.sandy_operation_registry(operation,domain,description,permission_scope,is_mutation,input_schema,output_schema,handler,api_exposed,ui_exposed,ai_exposed,verified,implementation_state,source_repository,source_path,dependencies,error_contract,retry_policy,rollback_policy) VALUES(
 'agent.reliability.diagnosis.propose',
 'agent',
 'Propose a reliability diagnosis for an actual reserved internal job through the dedicated existing automation identity. No code, migration, deployment, payment or provider action is executed. A model proposal is unverified and requires separate approval. Contract v1.0.0. Process-local dedicated-worker job capability only; no public HTTP handler readiness is claimed.',
 'worker:reliability',
 true,
 '{"type":"object","properties":{},"required":[],"additionalProperties":false}'::jsonb,
 '{"type":"object","properties":{"ok":{"const":true},"operation":{"const":"agent.reliability.diagnosis.propose"},"contract_version":{"const":"1.0.0"},"principal_kind":{"const":"trusted_internal_worker"},"auth_user_id":{"type":"null"},"customer_id":{"type":"null"},"job_id":{"type":"string","format":"uuid"},"status":{"const":"proposed"},"proposal_only":{"const":true},"requires_approval":{"const":true},"provider_response_received":{"const":true},"execution_verified":{"const":false},"proposals_deployed":{"const":false}},"required":["ok","operation","contract_version","principal_kind","auth_user_id","customer_id","job_id","status","proposal_only","requires_approval","provider_response_received","execution_verified","proposals_deployed"],"additionalProperties":false}'::jsonb,
 'internal:agent.reliability.diagnosis.propose@1.0.0',
 false,
 false,
 false,
 false,
 'awaiting_deployment',
 'ausstyle/web-staging',
 'supabase/functions/_shared/sandy-agent-operations/worker_diagnosis.ts',
 '["identity:existing_dedicated_auto_improve_key","capability:process_local_actual_reserved_job","database:sandy_worker_diagnosis_audit","database:atomic_claim_and_finish_RPC","provider:fixed_OpenAI_Responses_gpt_5.2_high_65s","approval:proposal_only_existing_qa_handoff"]'::jsonb,
 '{"version":"1.0.0","requirement_ids":[155,160],"internal_only":true,"sensitive":true,"consumes_model_resources":true,"dedicated_existing_automation_identity":true,"principal_kind":"trusted_internal_worker","auth_user_id":null,"customer_id":null,"public_job_profile_or_model_selection":false,"actual_stored_job_required":true,"one_use_atomic_database_claim":true,"unknown_outcome_redispatch":false,"failed_hour_retry":false,"proposal_only":true,"requires_separate_approval":true,"proposals_are_provider_execution_proof":false,"source_review_only":true,"original_source_sha256":"7b66252c752cfd9fb4e74c6e44f325ec83aea29a3eecaaf04250b4d120080c74","contract_sha256":"29a8c46036040198c172d69aac0b0b7c81ba3e96de52fd4838af42f057da2916"}'::jsonb,
 '{"automatic":false,"same_job_redispatch":false,"reason":"Started, unknown, completed and historical failed jobs require reconciliation; never repeat the paid request."}'::jsonb,
 '{"required":false,"reason":"Model consumption cannot be undone. Preserve actual proposal and model-response hashes; no proposed change is executed."}'::jsonb
);
COMMIT;
