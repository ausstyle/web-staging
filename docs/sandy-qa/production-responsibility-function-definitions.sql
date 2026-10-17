-- READ-ONLY production function source reference retrieved 2026-10-17.
-- NOT A MIGRATION: do not execute.

CREATE OR REPLACE FUNCTION public.sandy_default_task_responsibility()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
begin
 if new.responsible_customer_id is null then new.responsible_customer_id:=new.customer_id; end if;
 return new;
end $function$


CREATE OR REPLACE FUNCTION public.sandy_task_stamp_and_validate()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare d int; parent_state text;
begin
 new.title := btrim(new.title);
 new.updated_at := now();
 if TG_OP = 'UPDATE' then
   if new.customer_id <> old.customer_id then raise exception 'Task ownership is immutable'; end if;
   new.version := old.version + 1;
 end if;
 if new.parent_task_id is not null then
   with recursive ancestors as (
     select id,parent_task_id,1 as depth from public.sandy_tasks where id=new.parent_task_id and customer_id=new.customer_id
     union all
     select t.id,t.parent_task_id,a.depth+1 from public.sandy_tasks t join ancestors a on t.id=a.parent_task_id
     where a.depth<20
   )
   select max(depth) into d from ancestors;
   if d is null or d>=5 then raise exception 'Invalid parent or task nesting exceeds five levels'; end if;
   if exists (
      with recursive ancestors as (
        select id,parent_task_id,1 as depth from public.sandy_tasks where id=new.parent_task_id and customer_id=new.customer_id
        union all select t.id,t.parent_task_id,a.depth+1 from public.sandy_tasks t join ancestors a on t.id=a.parent_task_id where a.depth<20
      ) select 1 from ancestors where id=new.id
   ) then raise exception 'Cannot create a task cycle'; end if;
   select status into parent_state from public.sandy_tasks where id=new.parent_task_id and customer_id=new.customer_id;
   if parent_state in ('completed','cancelled') and new.status not in ('completed','cancelled') then
     raise exception 'Reopen the parent before reopening a subtask';
   end if;
 end if;
 if new.status='completed' then
   if exists(select 1 from public.sandy_tasks where parent_task_id=new.id and status not in ('completed','cancelled')) then
      raise exception 'Complete or cancel subtasks before completing parent';
   end if;
   new.completed_at := coalesce(case when TG_OP='UPDATE' then old.completed_at else null end,now());
 else
   new.completed_at := null;
 end if;
 return new;
end $function$


CREATE OR REPLACE FUNCTION public.sandy_agenda_task_company_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
  -- A parent and its descendants may have different personal/company workspaces.
  -- Company ownership must remain within the same customer's account.
  if new.parent_task_id is not null and not exists (
    select 1 from public.sandy_tasks p
    where p.id = new.parent_task_id and p.customer_id = new.customer_id
  ) then
    raise exception 'Parent task must belong to your Sandy account';
  end if;
  if new.company_id is not null and not exists (
    select 1 from public.sandy_agenda_companies c
    where c.id = new.company_id and c.customer_id = new.customer_id
  ) then
    raise exception 'Company must belong to your Sandy account';
  end if;
  return new;
end
$function$
