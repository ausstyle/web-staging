-- Sandy Legal financial domain v1 (deployed 2026-10-24).
-- Private service_role API only; legal data is never granted directly to signed-in browser roles.
create table if not exists public.sandy_legal_financial_items (
 id uuid primary key default gen_random_uuid(),
 owner_customer_id uuid not null,
 matter_id uuid not null,
 proceeding_id uuid null,
 entry_type text not null check (entry_type in ('invoice','costs_order','recovery_action','engagement','trust_statement')),
 title text not null check (length(trim(title)) between 2 and 300),
 counterparty text not null default '' check(length(counterparty)<=260),
 invoice_number text not null default '' check(length(invoice_number)<=120),
 reference_number text not null default '' check(length(reference_number)<=160),
 issue_date date, due_date date,
 currency text not null default 'AUD' check(currency ~ '^[A-Z]{3}$'),
 gross_amount numeric(16,2) check(gross_amount>=0),
 outstanding_amount numeric(16,2) check(outstanding_amount>=0),
 verified_paid_amount numeric(16,2) check(verified_paid_amount>=0),
 gst_amount numeric(16,2) check(gst_amount>=0),
 status text not null default 'awaiting_review' check(status in
  ('awaiting_review','received','disputed','partially_paid','paid','assessed','enforcement','recovery_pending','recovered','withdrawn','closed')),
 amount_basis text not null default 'source_document' check(amount_basis in ('source_document','correspondence_report','estimate','court_order','reconciliation')),
 source_provider text not null default 'manual' check(source_provider in ('manual','outlook','court','drive')),
 source_message_id text check(length(source_message_id)<=1000),
 source_attachment_name text check(length(source_attachment_name)<=500),
 source_attachment_id text check(length(source_attachment_id)<=1100),
 source_document_url text check(length(source_document_url)<=1800),
 source_message_url text check(length(source_message_url)<=1800),
 notes text not null default '' check(length(notes)<=10000),
 privileged boolean not null default true,
 verified_by uuid, verified_at timestamptz,
 created_by uuid, updated_by uuid,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 unique(owner_customer_id,id),
 foreign key(owner_customer_id,matter_id) references public.sandy_legal_matters(owner_customer_id,id),
 foreign key(owner_customer_id,proceeding_id) references public.sandy_legal_proceedings(owner_customer_id,id)
);
create index if not exists sandy_legal_financial_owner_matter_idx
 on public.sandy_legal_financial_items(owner_customer_id,matter_id,entry_type,issue_date desc);
create unique index if not exists sandy_legal_financial_source_unique
 on public.sandy_legal_financial_items(owner_customer_id,source_provider,source_message_id,source_attachment_name,entry_type)
 where source_message_id is not null and source_attachment_name is not null;
create or replace function public.sandy_legal_finance_validate() returns trigger language plpgsql set search_path=public,pg_temp as $$
begin
 if new.proceeding_id is not null and not exists(
  select 1 from public.sandy_legal_proceedings p
  where p.id=new.proceeding_id and p.matter_id=new.matter_id and p.owner_customer_id=new.owner_customer_id
 ) then raise exception 'invalid_proceeding_scope'; end if;
 if new.verified_at is not null and new.verified_by is null then raise exception 'missing_reviewer'; end if;
 new.updated_at=now();
 return new;
end;$$;
drop trigger if exists sandy_legal_finance_scope on public.sandy_legal_financial_items;
create trigger sandy_legal_finance_scope before insert or update on public.sandy_legal_financial_items
 for each row execute function public.sandy_legal_finance_validate();
drop trigger if exists sandy_legal_finance_audit on public.sandy_legal_financial_items;
create trigger sandy_legal_finance_audit after insert or update on public.sandy_legal_financial_items
 for each row execute function public.sandy_legal_log_mutation();
alter table public.sandy_legal_financial_items enable row level security;
revoke all on public.sandy_legal_financial_items from public, anon, authenticated;
grant select, insert, update on public.sandy_legal_financial_items to service_role;
revoke all on function public.sandy_legal_finance_validate() from public,anon,authenticated;
