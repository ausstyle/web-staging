
-- Sandy Legal v1: owner-scoped legal matter register. Private API only; no direct client table grants.
create table if not exists public.sandy_legal_matters (
 id uuid primary key default gen_random_uuid(),
 owner_customer_id uuid not null references public.email_customers(id),
 company_id uuid null references public.sandy_agenda_companies(id),
 title text not null check (char_length(btrim(title)) between 3 and 240),
 description text not null default '' check (char_length(description)<=12000),
 status text not null default 'active' check(status in ('active','on_hold','appeal','closed','archived')),
 matter_type text not null default 'litigation' check(char_length(matter_type)<=100),
 jurisdiction text not null default 'Australia' check(char_length(jurisdiction)<=180),
 created_by uuid,
 updated_by uuid,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 unique(owner_customer_id,id)
);
create index if not exists sandy_legal_matters_owner_idx on public.sandy_legal_matters(owner_customer_id,status,updated_at desc);

create table if not exists public.sandy_legal_proceedings(
 id uuid primary key default gen_random_uuid(),
 owner_customer_id uuid not null,
 matter_id uuid not null,
 court text not null check (char_length(btrim(court)) between 2 and 240),
 case_number text not null default '' check (char_length(case_number)<=160),
 proceeding_type text not null default 'originating' check (char_length(proceeding_type)<=120),
 stage text not null default '' check(char_length(stage)<=200),
 status text not null default 'active' check(status in ('active','stayed','finalised','appeal','archived')),
 notes text not null default '' check(char_length(notes)<=12000),
 created_by uuid,
 updated_by uuid,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 unique(owner_customer_id,id),
 foreign key(owner_customer_id,matter_id) references public.sandy_legal_matters(owner_customer_id,id)
);
create index if not exists sandy_legal_proceedings_owner_idx on public.sandy_legal_proceedings(owner_customer_id,matter_id,updated_at desc);

create table if not exists public.sandy_legal_records(
 id uuid primary key default gen_random_uuid(),
 owner_customer_id uuid not null,
 matter_id uuid not null,
 proceeding_id uuid null,
 kind text not null check(kind in ('document','deadline','hearing','order','contact','engagement','cost','correspondence','instruction','evidence','note')),
 title text not null check(char_length(btrim(title)) between 2 and 300),
 details text not null default '' check(char_length(details)<=18000),
 status text not null default 'recorded' check(status in ('recorded','proposed','awaiting_review','confirmed','completed','archived','disputed')),
 event_date date null,
 due_at timestamptz null,
 currency text not null default 'AUD' check(currency ~ '^[A-Z]{3}$'),
 amount numeric(16,2) null,
 contact_name text null check(char_length(contact_name)<=200),
 contact_email text null check(char_length(contact_email)<=320),
 organisation text null check(char_length(organisation)<=240),
 file_id uuid null references public.sandy_universal_files(id),
 source_note text not null default '' check(char_length(source_note)<=2000),
 reviewed_at timestamptz null,
 reviewed_by uuid null,
 created_by uuid,
 updated_by uuid,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 foreign key(owner_customer_id,matter_id) references public.sandy_legal_matters(owner_customer_id,id),
 foreign key(owner_customer_id,proceeding_id) references public.sandy_legal_proceedings(owner_customer_id,id)
);
create index if not exists sandy_legal_records_matter_idx on public.sandy_legal_records(owner_customer_id,matter_id,kind,created_at desc);
create index if not exists sandy_legal_records_due_idx on public.sandy_legal_records(owner_customer_id,due_at) where due_at is not null and status not in ('archived','completed');

create table if not exists public.sandy_legal_audit(
 id bigint generated always as identity primary key,
 owner_customer_id uuid not null,
 matter_id uuid,
 entity_type text not null,
 entity_id uuid not null,
 operation text not null,
 actor_user_id uuid,
 occurred_at timestamptz not null default now()
);
create index if not exists sandy_legal_audit_owner_idx on public.sandy_legal_audit(owner_customer_id,matter_id,occurred_at desc);

create or replace function public.sandy_legal_validate_refs() returns trigger language plpgsql set search_path = public,pg_temp as $$
begin
 if tg_table_name = 'sandy_legal_matters' and new.company_id is not null then
   if not exists(select 1 from public.sandy_agenda_companies c where c.id=new.company_id and c.customer_id=new.owner_customer_id) then raise exception 'invalid_company_scope'; end if;
 end if;
 if tg_table_name = 'sandy_legal_records' then
   if new.proceeding_id is not null and not exists(
     select 1 from public.sandy_legal_proceedings p where p.id=new.proceeding_id and p.matter_id=new.matter_id and p.owner_customer_id=new.owner_customer_id
   ) then raise exception 'invalid_proceeding_scope'; end if;
   if new.file_id is not null and not exists(
     select 1 from public.sandy_universal_files f where f.id=new.file_id and f.owner_customer_id=new.owner_customer_id and f.library_state<>'trashed'
   ) then raise exception 'invalid_file_scope'; end if;
 end if;
 new.updated_at=now();
 return new;
end;
$$;
create or replace function public.sandy_legal_log_mutation() returns trigger language plpgsql set search_path = public,pg_temp as $$
begin
 insert into public.sandy_legal_audit(owner_customer_id,matter_id,entity_type,entity_id,operation,actor_user_id)
 values(new.owner_customer_id,case when tg_table_name='sandy_legal_matters' then new.id else new.matter_id end,tg_table_name,new.id,tg_op,coalesce(new.updated_by,new.created_by));
 return new;
end;
$$;
do $$
declare t text;
begin
 foreach t in array array['sandy_legal_matters','sandy_legal_proceedings','sandy_legal_records'] loop
  execute format('drop trigger if exists sandy_legal_check_scope on public.%I',t);
  execute format('create trigger sandy_legal_check_scope before insert or update on public.%I for each row execute function public.sandy_legal_validate_refs()',t);
  execute format('drop trigger if exists sandy_legal_audit_write on public.%I',t);
  execute format('create trigger sandy_legal_audit_write after insert or update on public.%I for each row execute function public.sandy_legal_log_mutation()',t);
 end loop;
end $$;
alter table public.sandy_legal_matters enable row level security;
alter table public.sandy_legal_proceedings enable row level security;
alter table public.sandy_legal_records enable row level security;
alter table public.sandy_legal_audit enable row level security;
revoke all on public.sandy_legal_matters, public.sandy_legal_proceedings, public.sandy_legal_records, public.sandy_legal_audit from anon,authenticated,public;
revoke all on function public.sandy_legal_validate_refs() from public,anon,authenticated;
revoke all on function public.sandy_legal_log_mutation() from public,anon,authenticated;
