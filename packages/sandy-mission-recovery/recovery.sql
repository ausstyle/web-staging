-- SOURCE-ONLY candidate. Not a migration or live activation.
-- Existing one-use audit UUID is the non-reassignable attempt fence. Five-minute
-- lease derives from its immutable created_at; no caller clock/renewal/requeue.
BEGIN;
CREATE FUNCTION public.sandy_mission_receipt_lease_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
 IF NEW.state IN ('succeeded','waiting') AND clock_timestamp()>=NEW.created_at+interval '5 minutes' THEN
  RAISE EXCEPTION 'mission_attempt_lease_expired_reconcile';
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.sandy_mission_receipt_lease_guard() FROM PUBLIC,anon,authenticated,service_role;
-- Additional deferred deadline check for the fixed single-RPC transaction path.
-- PostgreSQL callers can force constraints IMMEDIATE; this is NOT a universal
-- pre-COMMIT hook. Arbitrary caller-managed transactions are outside this candidate
-- activation boundary. The durable terminal state fence remains authoritative.
-- No trigger is attached to historical reads or terminal no-op reads.
CREATE CONSTRAINT TRIGGER sandy_mission_receipt_lease_settlement
AFTER UPDATE ON public.sandy_mission_work_product_audit
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW
WHEN (NEW.state IN ('succeeded','waiting'))
EXECUTE FUNCTION public.sandy_mission_receipt_lease_guard();

CREATE FUNCTION public.sandy_reconcile_mission_attempt(p_audit_id uuid,p_run_id uuid,p_customer_id uuid,p_mission_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE a public.sandy_mission_work_product_audit%ROWTYPE;j public.sandy_mission_runs%ROWTYPE;m public.sandy_tasks%ROWTYPE;
 deadline timestamptz; base jsonb; links boolean;
BEGIN
 -- Same audit -> run -> parent order as canonical finalization. A watchdog and
 -- late finisher cannot both win. Unknown is terminal and never queued again.
 SELECT * INTO a FROM public.sandy_mission_work_product_audit WHERE id=p_audit_id FOR UPDATE;
 IF NOT FOUND OR a.run_id IS DISTINCT FROM p_run_id OR a.customer_id IS DISTINCT FROM p_customer_id OR a.mission_task_id IS DISTINCT FROM p_mission_id THEN RAISE EXCEPTION 'mission_recovery_scope_mismatch';END IF;
 SELECT * INTO j FROM public.sandy_mission_runs WHERE id=a.run_id FOR UPDATE;
 SELECT * INTO m FROM public.sandy_tasks WHERE id=a.mission_task_id AND customer_id=a.customer_id FOR UPDATE;
 IF j.id IS NULL OR m.id IS NULL OR j.customer_id IS DISTINCT FROM a.customer_id OR j.mission_task_id IS DISTINCT FROM a.mission_task_id OR j.stage IS DISTINCT FROM 'execute' OR a.source_sha256 IS DISTINCT FROM '6f6b7ce3d1bca03d9637c46a3535c4f288efef4c3a5532cc8a6ef5a6de3b0dc4' THEN RAISE EXCEPTION 'mission_recovery_canonical_binding_required';END IF;
 deadline:=a.created_at+interval '5 minutes';
 base:=jsonb_build_object('audit_id',a.id,'run_id',j.id,'mission_id',m.id,'mission_status',m.status,'attempt_fence',a.id,'lease_expires_at',deadline,'execution_allowed',false,'replayed_effects',0,'external_actions_performed',0);
 IF a.state='succeeded' THEN
  SELECT EXISTS(SELECT 1 FROM public.sandy_mission_work_products p JOIN public.sandy_tasks r ON r.id=a.review_task_id
   WHERE p.id=a.work_product_id AND p.run_id=a.run_id AND p.customer_id=a.customer_id AND p.mission_task_id=a.mission_task_id AND p.milestone_task_id=a.milestone_task_id
   AND r.customer_id=a.customer_id AND r.parent_task_id=a.mission_task_id AND r.metadata->>'work_product_id'=p.id::text AND r.metadata->>'stage'='deliverable_review' AND r.metadata->>'assigned_to'='client') INTO links;
  IF j.state='completed' AND j.result->>'work_product_id'=a.work_product_id::text AND a.provider_response_id IS NOT NULL AND a.response_sha256 IS NOT NULL AND a.draft_sha256 IS NOT NULL AND a.finished_at IS NOT NULL AND links THEN
   RETURN base||jsonb_build_object('state','draft_recorded','work_product_id',a.work_product_id,'review_task_id',a.review_task_id,'terminal_receipt_reused',true);
  END IF;
  RETURN base||jsonb_build_object('state','unresolved','reason','terminal_links_unavailable');
 ELSIF a.state='waiting' THEN
  IF j.state='completed' AND j.result->>'status'=a.waiting_reason AND a.work_product_id IS NULL AND a.review_task_id IS NULL AND a.provider_response_id IS NULL AND a.finished_at IS NOT NULL THEN
   RETURN base||jsonb_build_object('state','waiting','reason',a.waiting_reason,'terminal_receipt_reused',true);
  END IF;
  RETURN base||jsonb_build_object('state','unresolved','reason','terminal_links_unavailable');
 ELSIF a.state='unknown' THEN
  RETURN base||jsonb_build_object('state','unresolved','reason','uncertain_effect','terminal_receipt_reused',true);
 ELSIF a.state IS DISTINCT FROM 'started' OR j.state IS DISTINCT FROM 'running' THEN
  RETURN base||jsonb_build_object('state','unresolved','reason','unexpected_run_state');
 END IF;
 IF clock_timestamp()<deadline AND m.status IS DISTINCT FROM 'cancelled' AND m.archived_at IS NULL THEN
  RETURN base||jsonb_build_object('state','running','recheck_at',deadline);
 END IF;
 -- Expiry/cancellation is evidence that dispatch must stop, not evidence that a
 -- provider did nothing. Preserve uncertainty via the existing terminal RPC.
 PERFORM public.sandy_finish_mission_work_product(a.id,'unknown',NULL,NULL,NULL,'mission_work_product_outcome_requires_reconciliation');
 RETURN base||jsonb_build_object('state','unresolved','reason',CASE WHEN m.status='cancelled' OR m.archived_at IS NOT NULL THEN 'cancelled_uncertain_effect' ELSE 'expired_uncertain_effect' END,'fenced',true);
END $$;
REVOKE ALL ON FUNCTION public.sandy_reconcile_mission_attempt(uuid,uuid,uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;
-- No grants, roles, credentials, scheduler, route, or provider retry added.
COMMIT;
