-- Exact read-only PostgreSQL routine definitions; NOT a migration.\n\n-- sandy_agenda_claim_invite
CREATE OR REPLACE FUNCTION public.sandy_agenda_claim_invite(p_owner uuid, p_assignee uuid, p_task uuid, p_email text)
 RETURNS uuid
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare v_id uuid;
begin
 insert into public.sandy_agenda_invite_deliveries(owner_customer_id,assignee_customer_id,task_id,email)
 values (p_owner,p_assignee,p_task,p_email)
 on conflict(task_id,assignee_customer_id) do update
 set status='sending',
     attempts=sandy_agenda_invite_deliveries.attempts+1,
     email=excluded.email,
     last_attempt_at=now(),
     updated_at=now(),
     last_error_code=null
 where (sandy_agenda_invite_deliveries.status='failed'
     or (sandy_agenda_invite_deliveries.status='sending' and sandy_agenda_invite_deliveries.last_attempt_at<now()-interval '10 minutes')
     or (sandy_agenda_invite_deliveries.status='submitted' and sandy_agenda_invite_deliveries.last_attempt_at<now()-interval '24 hours'))
 returning id into v_id;
 return v_id;
end;$function$


-- sandy_claim_external_task_invitation
CREATE OR REPLACE FUNCTION public.sandy_claim_external_task_invitation(p_owner uuid, p_task uuid, p_email text, p_scope text, p_hash text)
 RETURNS uuid
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare v_id uuid;
begin
 insert into public.sandy_external_task_invitations(owner_customer_id,task_id,email,scope,token_hash)
 values(p_owner,p_task,p_email,p_scope,p_hash)
 on conflict(task_id,email) do update
 set status='sending',token_hash=excluded.token_hash,scope=excluded.scope,
 expires_at=now()+interval '7 days',attempts=sandy_external_task_invitations.attempts+1,updated_at=now()
 where (sandy_external_task_invitations.status='failed'
 or (sandy_external_task_invitations.status='sending' and sandy_external_task_invitations.created_at<now()-interval '10 minutes')
 or (sandy_external_task_invitations.status='sent' and sandy_external_task_invitations.last_sent_at<now()-interval '24 hours'))
 returning id into v_id;
 return v_id;
end;$function$


-- sandy_task_delegation_scope_guard
CREATE OR REPLACE FUNCTION public.sandy_task_delegation_scope_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
 if new.scope='subtree' then
  if exists (
   with recursive descendants(id) as (
    select new.task_id union all select c.id from public.sandy_tasks c join descendants d on c.parent_task_id=d.id where c.customer_id=new.owner_customer_id
   )
   select 1 from public.sandy_tasks t join descendants d on d.id=t.id where t.company_id is distinct from (select company_id from public.sandy_tasks where id=new.task_id)
  ) then raise exception 'Subtree contains another workspace';end if;
 end if;
 return new;
end $function$


-- sandy_qa_handoff_guard
CREATE OR REPLACE FUNCTION public.sandy_qa_handoff_guard()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
begin
 if new.status='verified' and (new.verification->>'production_passed') is distinct from 'true' then
  raise exception 'verified requires production_passed=true evidence';
 end if;
 if new.status='deployed' and (new.verification->>'deployment_receipt') is null then
  raise exception 'deployed requires deployment receipt';
 end if;
 new.updated_at=now();
 return new;
end $function$


-- sandy_qa_sync_engineering_handoffs
CREATE OR REPLACE FUNCTION public.sandy_qa_sync_engineering_handoffs()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare n integer;
begin
 insert into public.sandy_qa_engineering_handoffs(issue_key,status,evidence,root_cause,recommended_fix,regression_plan)
 select q.issue_key,'investigation_ready',
 jsonb_build_object('occurrences',q.occurrences,'score',q.priority_score,'channels',q.affected_channels,'claim_type',q.claim_type,'evidence_available',true),
 null,
 'Investigate source implementation and underlying evidence, propose a minimal correction and explicit regression tests. No unapproved automatic deployment.',
 jsonb_build_array('Reproduce real counterexample','Verify authoritative data at the original answer time','Test fix without changing unrelated behaviour','Recheck live response and database records')
 from public.sandy_evidence_improvement_queue q
 where q.priority_score>=70
 on conflict(issue_key) do nothing;
 get diagnostics n=row_count;
 return n;
end $function$

