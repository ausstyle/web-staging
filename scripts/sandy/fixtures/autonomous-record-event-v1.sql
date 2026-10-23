CREATE OR REPLACE FUNCTION public.sandy_autonomous_engineering_record_event(p_issue_key text, p_event_key text, p_event_type text, p_evidence jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare c public.sandy_autonomous_engineering_cycles%rowtype;
h public.sandy_qa_engineering_handoffs%rowtype;
v_phase text; v_status text; v_next text; v_delay integer:=0;
begin
 if coalesce(length(p_issue_key),0) not between 1 and 160
    or coalesce(length(p_event_key),0) not between 5 and 190
    or jsonb_typeof(p_evidence) is distinct from 'object'
 then raise exception 'Invalid controller event'; end if;
 select * into c from public.sandy_autonomous_engineering_cycles where issue_key=p_issue_key for update;
 if not found then raise exception 'Unknown cycle'; end if;
 if exists(select 1 from public.sandy_autonomous_engineering_events where event_key=p_event_key) then
  return jsonb_build_object('duplicate',true,'phase',c.phase);
 end if;
 v_phase:=c.phase; v_status:=c.status; v_next:=c.next_action;
 case p_event_type
 when 'source_audit_mismatch' then
   v_phase:='source_evidence';v_status:='waiting_evidence';v_next:='review_source_drift';
 when 'source_evidence_verified' then
   if c.phase not in ('source_evidence','blocked')
       or p_evidence->>'hash_status'<>'exact_snapshot_match'
       or coalesce(p_evidence->>'audit_run_id','') !~ '^[0-9]{5,20}$'
   then raise exception 'Source evidence unverified'; end if;
   v_phase:='architect';v_status:='queued';v_next:='dispatch_architect';
 when 'architect_blocked' then
   if c.phase not in ('architect','source_evidence') then raise exception 'Invalid architect state'; end if;
   v_phase:='source_evidence';v_status:='waiting_evidence';v_next:='resolve_architect_dependencies';
 when 'architect_ready' then
   if c.phase<>'architect' or p_evidence->>'decision'<>'READY'
      or coalesce(p_evidence->>'run_id','') !~ '^[0-9]{5,20}$'
   then raise exception 'Architect READY absent'; end if;
   v_phase:='engineering';v_status:='queued';v_next:='implement_tested_pr';
 when 'engineering_pr_created' then
   if c.phase<>'engineering' or coalesce(p_evidence->>'pr_number','') !~ '^[1-9][0-9]{0,6}$'
   then raise exception 'Engineering PR absent'; end if;
   v_phase:='review';v_status:='waiting_approval';v_next:='verify_ci_and_approval';
 when 'ci_passed' then
   if c.phase<>'review' or p_evidence->>'checks_passed'<>'true' then raise exception 'CI evidence absent'; end if;
   v_next:='wait_for_release_approval';v_status:='waiting_approval';
 when 'deployment_verified' then
   select * into h from public.sandy_qa_engineering_handoffs where id=c.source_handoff_id;
   if c.phase<>'review' or not found or h.approval_required is distinct from false
      or coalesce(h.verification->>'deployment_receipt','')=''
      or p_evidence->>'deployment_receipt' is distinct from h.verification->>'deployment_receipt'
   then raise exception 'Deployment lacks verified approval and receipt'; end if;
   v_phase:='verification';v_status:='waiting_evidence';v_next:='real_world_qa';
 when 'qa_verified' then
   select * into h from public.sandy_qa_engineering_handoffs where id=c.source_handoff_id;
   if c.phase<>'verification' or not found or h.status<>'verified'
      or h.verification->>'production_passed'<>'true'
      or h.verification->>'real_world_test_passed'<>'true'
   then raise exception 'Real-world production verification absent'; end if;
   v_phase:='complete';v_status:='verified';v_next:='none';
 when 'retryable_failure' then
   if c.attempt_count >= 19 then
     v_phase:='blocked';v_status:='blocked';v_next:='operator_investigation';
   else
     v_status:='waiting_evidence';v_next:='retry_after_backoff';
     v_delay:=least(1440,5 * (2 ^ least(c.attempt_count,8))::integer);
   end if;
 else raise exception 'Unsupported event type'; end case;
 insert into public.sandy_autonomous_engineering_events(cycle_id,event_key,event_type,evidence)
 values(c.id,p_event_key,p_event_type,p_evidence);
 update public.sandy_autonomous_engineering_cycles set
  phase=v_phase,status=v_status,next_action=v_next,
  attempt_count=c.attempt_count+case when p_event_type='retryable_failure' then 1 else 0 end,
  last_attempt_at=case when p_event_type='retryable_failure' then now() else c.last_attempt_at end,
  next_eligible_at=now()+make_interval(mins=>v_delay),
  evidence=c.evidence || jsonb_build_object('last_event_key',p_event_key,'last_event_type',p_event_type),
  updated_at=now()
 where id=c.id;
 return jsonb_build_object('recorded',true,'phase',v_phase,'status',v_status,'next_action',v_next);
end $function$
