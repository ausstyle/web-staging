-- Exact read-only reference from deployed database. Not a migration.
CREATE OR REPLACE FUNCTION public.sandy_evidence_prioritize()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare v_count integer;
begin
 insert into public.sandy_evidence_improvement_queue(issue_key,claim_type,severity,occurrences,affected_channels,priority_score,status,rationale,next_action,first_seen_at,last_seen_at)
 select 'contradiction:'||claim_type,claim_type,'high',count(*)::integer,array_agg(distinct source_channel),
 least(100,65+10*count(*))::integer,'investigate',
 'Independent evidence contradicts Sandy replies. Recurring errors grouped by claim type.',
 'Investigate relevant read tool, inspect actual receipts, implement pre-send gate and verify live regression.',
 min(checked_at),max(checked_at)
 from public.sandy_evidence_checks
 where verdict='contradicted'
 group by claim_type
 on conflict(issue_key) do update set occurrences=excluded.occurrences,affected_channels=excluded.affected_channels,priority_score=excluded.priority_score,last_seen_at=excluded.last_seen_at,
 rationale=excluded.rationale,next_action=excluded.next_action;
 get diagnostics v_count=row_count;
 return v_count;
end $function$

