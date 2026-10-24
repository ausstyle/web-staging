-- Link previously imported ZIP invoices into the parent Keybridge matter without duplicating invoices.
create table if not exists public.sandy_legal_financial_matter_links(
 owner_customer_id uuid not null,
 view_matter_id uuid not null,
 financial_item_id uuid not null,
 relation_type text not null check(relation_type in ('litigation_related','other_indemnity_evidence')),
 origin_description text not null default '',
 created_at timestamptz not null default now(),
 primary key(owner_customer_id,view_matter_id,financial_item_id),
 foreign key(owner_customer_id,view_matter_id) references public.sandy_legal_matters(owner_customer_id,id) on delete cascade,
 foreign key(owner_customer_id,financial_item_id) references public.sandy_legal_financial_items(owner_customer_id,id) on delete cascade
);
create index if not exists sandy_legal_fml_item_idx on public.sandy_legal_financial_matter_links(owner_customer_id,financial_item_id);
alter table public.sandy_legal_financial_matter_links enable row level security;
revoke all on public.sandy_legal_financial_matter_links from public,anon,authenticated;
grant select,insert on public.sandy_legal_financial_matter_links to service_role;
create or replace function public.sandy_legal_finance_link_audit()
returns trigger language plpgsql set search_path=public,pg_temp as $$
begin
 insert into public.sandy_legal_audit(owner_customer_id,matter_id,entity_type,entity_id,operation)
 values(new.owner_customer_id,new.view_matter_id,'sandy_legal_financial_matter_links',new.financial_item_id,'LINKED');
 return new;
end $$;
revoke all on function public.sandy_legal_finance_link_audit() from public,anon,authenticated;
drop trigger if exists sandy_legal_finance_link_record on public.sandy_legal_financial_matter_links;
create trigger sandy_legal_finance_link_record after insert on public.sandy_legal_financial_matter_links
for each row execute function public.sandy_legal_finance_link_audit();
insert into public.sandy_legal_financial_matter_links
(owner_customer_id,view_matter_id,financial_item_id,relation_type,origin_description)
select fm.owner_customer_id,m.id,fm.id,
case when src.title in ('Indemnity evidence — Administration proceedings','Indemnity evidence — WAM and derivative proceedings')
then 'litigation_related' else 'other_indemnity_evidence' end,
src.title
from public.sandy_legal_financial_items fm
join public.sandy_legal_matters src on src.id=fm.matter_id and src.owner_customer_id=fm.owner_customer_id
join public.sandy_legal_matters m on m.owner_customer_id=fm.owner_customer_id
where m.title='Keybridge Capital — 2025 board meeting, administration and appeals'
and fm.entry_type='invoice'
and fm.source_message_id='d4cd37823c7c6b4788a2dd37685ee189ec2a3378c9ce09e831103f7e3dfbee09'
and src.title like 'Indemnity evidence — %'
on conflict (owner_customer_id,view_matter_id,financial_item_id) do nothing;