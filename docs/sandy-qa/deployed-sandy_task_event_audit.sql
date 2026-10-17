-- Exact read-only reference from deployed database. Not a migration.
CREATE OR REPLACE FUNCTION public.sandy_task_event_audit()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
 insert into public.sandy_task_events(customer_id,task_id,event_type,actor,previous_status,new_status,snapshot)
 values(new.customer_id,new.id,
  case when TG_OP='INSERT' then 'created' when old.status is distinct from new.status then 'status_changed' else 'updated' end,
  new.updated_by,
  case when TG_OP='UPDATE' then old.status else null end,new.status,
  jsonb_build_object('title',new.title,'parent_task_id',new.parent_task_id,'version',new.version));
 return null;
end $function$

