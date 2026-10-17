-- Applied to project zmqlyygzqoidkcwdysok on 2026-10-17.
-- Company-owned nested task categories. Existing task associations remain unchanged.

create table if not exists public.sandy_agenda_categories (
 id uuid primary key default gen_random_uuid(),
 customer_id uuid not null references public.email_customers(id) on delete cascade,
 company_id uuid not null,
 parent_category_id uuid,
 name text not null check (char_length(btrim(name)) between 1 and 160),
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 constraint sandy_agenda_categories_company_tenant_fk foreign key (company_id,customer_id)
  references public.sandy_agenda_companies(id,customer_id) on delete cascade,
 constraint sandy_agenda_categories_tenant_key unique(id,customer_id,company_id),
 constraint sandy_agenda_categories_parent_tenant_fk foreign key (parent_category_id,customer_id,company_id)
  references public.sandy_agenda_categories(id,customer_id,company_id) on delete restrict,
 constraint sandy_agenda_categories_not_self check(parent_category_id is null or parent_category_id<>id)
);
create unique index if not exists sandy_agenda_categories_sibling_name_idx
 on public.sandy_agenda_categories(customer_id,company_id,coalesce(parent_category_id,'00000000-0000-0000-0000-000000000000'::uuid),lower(btrim(name)));
create index if not exists sandy_agenda_categories_company_idx on public.sandy_agenda_categories(customer_id,company_id);
alter table public.sandy_agenda_categories enable row level security;
revoke all on public.sandy_agenda_categories from public,anon,authenticated;
grant select,insert,update,delete on public.sandy_agenda_categories to service_role;
alter table public.sandy_tasks add column if not exists category_id uuid;
alter table public.sandy_tasks add constraint sandy_tasks_category_requires_company
 check (category_id is null or company_id is not null);
alter table public.sandy_tasks add constraint sandy_tasks_category_tenant_company_fk
 foreign key (category_id,customer_id,company_id)
 references public.sandy_agenda_categories(id,customer_id,company_id) on delete restrict;
create index if not exists sandy_tasks_category_idx on public.sandy_tasks(customer_id,company_id,category_id);
create or replace function public.sandy_agenda_category_prevent_cycle()
returns trigger language plpgsql set search_path = public, pg_temp as $$
declare cursor_id uuid; visited uuid[]:=array[new.id];
begin
 cursor_id:=new.parent_category_id;
 while cursor_id is not null loop
  if cursor_id=any(visited) then raise exception 'Category hierarchy cannot contain a cycle' using errcode='23514'; end if;
  visited:=array_append(visited,cursor_id);
  select parent_category_id into cursor_id from public.sandy_agenda_categories
   where id=cursor_id and customer_id=new.customer_id and company_id=new.company_id;
 end loop;
 return new;
end $$;
drop trigger if exists sandy_agenda_category_cycle_guard on public.sandy_agenda_categories;
create trigger sandy_agenda_category_cycle_guard before insert or update of parent_category_id,company_id,customer_id
 on public.sandy_agenda_categories for each row execute function public.sandy_agenda_category_prevent_cycle();
create or replace function public.sandy_task_create_categorized_bundle(
 p_customer_id uuid,p_company_id uuid,p_category_id uuid,p_title text,p_details text,p_priority text,
 p_due_at timestamptz,p_subtasks jsonb,p_actor text default 'user')
returns uuid language plpgsql set search_path = public, pg_temp as $$
declare created uuid;
begin
 if p_category_id is not null and not exists (
  select 1 from public.sandy_agenda_categories
  where id=p_category_id and customer_id=p_customer_id and company_id=p_company_id
 ) then raise exception 'Category does not belong to this company' using errcode='23503'; end if;
 created:=public.sandy_task_create_company_bundle(p_customer_id,p_company_id,p_title,p_details,p_priority,p_due_at,p_subtasks,p_actor);
 if p_category_id is not null then
  update public.sandy_tasks set category_id=p_category_id
   where customer_id=p_customer_id and (id=created or parent_task_id=created);
 end if;
 return created;
end $$;
revoke all on function public.sandy_task_create_categorized_bundle(uuid,uuid,uuid,text,text,text,timestamptz,jsonb,text) from public,anon,authenticated;
grant execute on function public.sandy_task_create_categorized_bundle(uuid,uuid,uuid,text,text,text,timestamptz,jsonb,text) to service_role;

