create or replace function public.sandy_legal_validate_refs() returns trigger language plpgsql set search_path=public,pg_temp as $$
begin
 if tg_table_name='sandy_legal_matters' then
   if new.company_id is not null then
     if not exists(select 1 from public.sandy_agenda_companies c where c.id=new.company_id and c.customer_id=new.owner_customer_id) then raise exception 'invalid_company_scope'; end if;
   end if;
 elsif tg_table_name='sandy_legal_records' then
   if new.proceeding_id is not null then
     if not exists(select 1 from public.sandy_legal_proceedings p where p.id=new.proceeding_id and p.matter_id=new.matter_id and p.owner_customer_id=new.owner_customer_id) then raise exception 'invalid_proceeding_scope'; end if;
   end if;
   if new.file_id is not null then
     if not exists(select 1 from public.sandy_universal_files f where f.id=new.file_id and f.owner_customer_id=new.owner_customer_id and f.library_state<>'trashed') then raise exception 'invalid_file_scope'; end if;
   end if;
 end if;
 new.updated_at=now();
 return new;
end;
$$;
revoke all on function public.sandy_legal_validate_refs() from public,anon,authenticated;