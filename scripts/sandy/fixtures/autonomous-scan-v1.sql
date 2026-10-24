CREATE OR REPLACE FUNCTION public.sandy_autonomous_engineering_scan()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare n integer := 0; v_count integer := 0;
begin
  insert into public.sandy_autonomous_engineering_cycles(issue_key,source_handoff_id,phase,status,next_action,evidence)
  select h.issue_key,h.id,'investigate','queued','gather_technical_evidence',
         jsonb_build_object('original_status',h.status,'target_function',h.target_function)
  from public.sandy_qa_engineering_handoffs h
  where h.issue_key is not null and h.status not in ('verified','completed','complete','closed','dismissed')
  on conflict(issue_key) do nothing;
  get diagnostics n = row_count;
  update public.sandy_autonomous_engineering_cycles c
     set phase = 'source_evidence',
         status = 'waiting_evidence',
         next_action = 'reconcile_production_source_and_require_architect_review',
         updated_at = now()
    from public.sandy_qa_engineering_handoffs h
   where c.source_handoff_id=h.id and c.phase='investigate' and c.status='queued'
     and h.target_function is not null and length(h.target_function)>0;
  get diagnostics v_count = row_count;
  return jsonb_build_object('new_cycles',n,'advanced_to_source_evidence',v_count,'scanned_at',now());
end $function$
;
