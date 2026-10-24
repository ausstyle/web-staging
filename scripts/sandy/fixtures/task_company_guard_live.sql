-- Exact function body read from production following run 40052204122.
CREATE OR REPLACE FUNCTION public.sandy_agenda_task_company_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
 if new.parent_task_id is not null and not exists(select 1 from public.sandy_tasks p where p.id=new.parent_task_id and p.customer_id=new.customer_id) then
  raise exception 'Parent task must belong to your Sandy account';
 end if;
 if new.company_id is not null and not exists(select 1 from public.sandy_agenda_companies c where c.id=new.company_id and c.customer_id=new.customer_id) then
  raise exception 'Company must belong to your Sandy account';
 end if;
 if new.category_id is not null and not exists(select 1 from public.sandy_agenda_categories c where c.id=new.category_id and c.customer_id=new.customer_id and c.company_id is not distinct from new.company_id) then
  raise exception 'Category does not belong to this workspace';
 end if;
 return new;
end
$function$;
CREATE CONSTRAINT TRIGGER sandy_agenda_task_company_check AFTER INSERT OR UPDATE ON public.sandy_tasks DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION sandy_agenda_task_company_guard();
