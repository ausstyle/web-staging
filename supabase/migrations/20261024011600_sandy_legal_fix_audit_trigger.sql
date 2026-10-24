create or replace function public.sandy_legal_log_mutation() returns trigger language plpgsql set search_path = public,pg_temp as $$
declare target_matter uuid;
begin
 if tg_table_name='sandy_legal_matters' then
   target_matter:=new.id;
 else
   target_matter:=new.matter_id;
 end if;
 insert into public.sandy_legal_audit(owner_customer_id,matter_id,entity_type,entity_id,operation,actor_user_id)
 values(new.owner_customer_id,target_matter,tg_table_name,new.id,tg_op,coalesce(new.updated_by,new.created_by));
 return new;
end;
$$;
revoke all on function public.sandy_legal_log_mutation() from public,anon,authenticated;