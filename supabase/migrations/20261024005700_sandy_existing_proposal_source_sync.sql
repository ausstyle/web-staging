-- Resume existing persisted proposals through source evidence, not reinvestigation.
-- No issue creation, risk/Owner approval, model request or deployment is inferred.
BEGIN;
SET LOCAL lock_timeout='2s';SET LOCAL statement_timeout='15s';
CREATE FUNCTION public.sandy_autonomous_proposal_source_review(p_handoff_id uuid) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
 SELECT jsonb_build_object('contract','reviewed-existing-proposal-source-v1','handoff_id',h.id,
 'diagnosis_id',d.id,'proposal_sha256',encode(sha256(convert_to(d.proposed_fix::text,'UTF8')),'hex'),
 'proposal_only',true,'primary_target','sandy-agent-runtime-v4',
 'source_targets',jsonb_build_array('sandy-agent-runtime-v4','sandy-examiner-full-cycle'),
 'source_snapshots',coalesce((SELECT jsonb_agg(jsonb_build_object('event_id',s.id,'change_id',s.change_id,'observed_at',s.occurred_at,'snapshot',s.detail->'source_snapshot') ORDER BY targets.target)
  FROM (VALUES('sandy-agent-runtime-v4'),('sandy-examiner-full-cycle')) targets(target)
  CROSS JOIN LATERAL(SELECT e.id,e.change_id,e.occurred_at,e.detail FROM public.sandy_engineering_change_events e
   WHERE e.event_type IN('runtime_slice_source_verified','runtime_slice_snapshot_verified')
   AND e.detail->'source_snapshot'->>'contract'='reviewed-runtime-source-snapshot-v1'
   AND e.detail->'source_snapshot'->>'function'=targets.target AND e.detail->'all_module_digests_verified'='true'::jsonb
   AND e.detail->>'source_commit' ~ '^[a-f0-9]{40}$' AND e.occurred_at>=h.created_at
   AND e.detail->'source_snapshot'->>'entrypoint_sha256' ~ '^[a-f0-9]{64}$'
   AND e.detail->'source_snapshot'->>'bundle_sha256' ~ '^[a-f0-9]{64}$'
   AND jsonb_typeof(e.detail->'source_snapshot'->'metadata_version')='number'
   AND e.detail->'source_snapshot'->>'metadata_version' ~ '^[1-9][0-9]{0,6}$'
   AND jsonb_typeof(e.detail->'source_snapshot'->'verify_jwt')='boolean'
   AND jsonb_typeof(e.detail->'source_snapshot'->'module_digests')='object'
   AND e.detail->'source_snapshot'->'module_digests'->>(targets.target||'/index.ts')=e.detail->'source_snapshot'->>'entrypoint_sha256'
   AND NOT EXISTS(SELECT 1 FROM jsonb_each_text(CASE WHEN jsonb_typeof(e.detail->'source_snapshot'->'module_digests')='object' THEN e.detail->'source_snapshot'->'module_digests' ELSE '{}'::jsonb END) pair WHERE pair.value !~ '^[a-f0-9]{64}$')
   ORDER BY e.occurred_at DESC,e.id DESC LIMIT 1) s),'[]'::jsonb),
 'related_grounding',CASE WHEN d.source_ref IN('v2_dynamic_qa_clock','v2_dynamic_qa_task_count') THEN
  (SELECT jsonb_build_object('run_key',e.run_key,'case_key',e.case_key,'request_id',e.request_id,'verdict',e.verdict,
   'scope','partial_regression_subset','full_handoff_accepted',false,'existing_evidence_reused',true)
   FROM public.sandy_v2_qa_executions e JOIN public.sandy_v2_qa_runs r ON r.run_key=e.run_key
   WHERE e.run_key='production:c706fc05-5dcb-49b4-adda-1ab9cd00279c' AND r.status='complete'
   AND e.case_key=CASE d.source_ref WHEN 'v2_dynamic_qa_clock' THEN 'current_time' ELSE 'task_overview' END
   AND e.evidence->>'mode'='focused_regression_v1' ORDER BY e.request_id LIMIT 1) ELSE NULL END,
 'independent_source_review_complete',false,'current_source_reverification_required',true,
 'requires_independent_architect_review',true,'paid_investigation_replayed',false,'capability_accepted',false)
 FROM public.sandy_qa_engineering_handoffs h JOIN public.sandy_auto_improve_runs d ON d.id::text=h.evidence->>'diagnosis_id'
 WHERE h.id=p_handoff_id AND h.status='fix_proposed' AND h.evidence->'proposal_only'='true'::jsonb
 AND h.evidence->>'source_type'='qa_failure' AND d.source_type='qa_failure' AND d.source_ref=h.evidence->>'source_ref'
 AND h.issue_key='v2:auto_qa:'||d.source_ref AND jsonb_typeof(d.proposed_fix)='object'
 AND d.source_ref IN('v2_dynamic_qa_clock','v2_dynamic_qa_task_count','v2_dynamic_qa_cross_channel')
$$;
REVOKE ALL ON FUNCTION public.sandy_autonomous_proposal_source_review(uuid) FROM PUBLIC,anon,authenticated,service_role;
DO $scan_guard$
DECLARE definition text;old text;replacement text;
BEGIN
 IF (SELECT encode(sha256(convert_to(prosrc,'UTF8')),'hex') FROM pg_proc WHERE oid='public.sandy_autonomous_engineering_scan()'::regprocedure)
 IS DISTINCT FROM '729cb1d0acd9ef439a41b6feb8bdf7ffda0307a21036b4e19ec242b6227f8e61' THEN RAISE EXCEPTION 'existing_engineering_scan_preimage_changed';END IF;
 SELECT pg_get_functiondef('public.sandy_autonomous_engineering_scan()'::regprocedure) INTO definition;
 old:=$declare$declare n integer := 0; v_count integer := 0;$declare$;
 IF (length(definition)-length(replace(definition,old,'')))/length(old)<>1 THEN RAISE EXCEPTION 'scan_declaration_anchor_changed';END IF;
 definition:=replace(definition,old,'declare n integer := 0; v_count integer := 0; v_proposals integer := 0; r record; review jsonb;');
 old:=$old$  return jsonb_build_object('new_cycles',n,'advanced_to_source_evidence',v_count,'scanned_at',now());$old$;
 replacement:=$replacement$  for r in
   select c.id,c.source_handoff_id,c.evidence
   from public.sandy_autonomous_engineering_cycles c join public.sandy_qa_engineering_handoffs h on h.id=c.source_handoff_id
   where h.status='fix_proposed' and ((c.phase='investigate' and c.status='queued') or
    (c.phase='source_evidence' and c.status='waiting_evidence' and c.next_action in('refresh_reviewed_source_snapshots','review_existing_proposal_against_bound_source','reconcile_production_source_and_require_architect_review')))
   order by c.updated_at,c.id for update of c skip locked limit 25
  loop
   review:=public.sandy_autonomous_proposal_source_review(r.source_handoff_id);
   if review is null or r.evidence->'proposal_source_review'=review then continue;end if;
   update public.sandy_autonomous_engineering_cycles set phase='source_evidence',status='waiting_evidence',
    next_action=case when jsonb_array_length(review->'source_snapshots')=2 then 'review_existing_proposal_against_bound_source' else 'refresh_reviewed_source_snapshots' end,
    evidence=coalesce(evidence,'{}'::jsonb)||jsonb_build_object('proposal_source_review',review),updated_at=now() where id=r.id;
   insert into public.sandy_autonomous_engineering_events(cycle_id,event_key,event_type,evidence)
    values(r.id,'proposal-source-review:'||r.id::text||':'||md5(review::text),'proposal_source_review_resumed',review)
    on conflict(event_key) do nothing;
   v_proposals:=v_proposals+1;
  end loop;
  return jsonb_build_object('new_cycles',n,'advanced_to_source_evidence',v_count,'proposal_source_reviews_resumed',v_proposals,'scanned_at',now());$replacement$;
 IF (length(definition)-length(replace(definition,old,'')))/length(old)<>1 THEN RAISE EXCEPTION 'scan_return_anchor_changed';END IF;
 EXECUTE replace(definition,old,replacement);
END $scan_guard$;
NOTIFY pgrst,'reload schema';
COMMIT;
