-- Read-only architecture reference extracted from deployed Supabase project zmqlyygzqoidkcwdysok.
-- DO NOT run as a migration without code review. Deployed DB schema may evolve.
-- public.sandy_verify_task_delegation(uuid,uuid,timestamptz)
CREATE OR REPLACE FUNCTION public.sandy_verify_task_delegation(p_customer_id uuid, p_task_id uuid, p_as_of timestamp with time zone DEFAULT now())
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare t record; ds jsonb; n integer;
begin
 select id,title,status,customer_id into t from public.sandy_tasks where id=p_task_id and customer_id=p_customer_id and created_at<=p_as_of;
 if not found then return jsonb_build_object('verdict','unverified','reason','task_not_found_in_scope');end if;
 select coalesce(jsonb_agg(jsonb_build_object('id',d.id,'assignee_customer_id',d.assignee_customer_id,'status',d.status,'created_at',d.created_at,'updated_at',d.updated_at)), '[]'::jsonb),count(*) into ds,n
 from public.sandy_task_delegations d where d.owner_customer_id=p_customer_id and d.task_id=p_task_id and d.created_at<=p_as_of and d.status in ('accepted','pending','invited');
 return jsonb_build_object('verdict','supported','task_id',t.id,'task_status',t.status,'has_active_delegation',n>0,'delegations',ds,'checked_as_of',p_as_of,'limitation','historical status changes may not be reconstructable');
end $function$;
