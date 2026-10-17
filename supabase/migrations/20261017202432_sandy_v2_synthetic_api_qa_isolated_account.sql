
-- Production migration applied 2026-10-17. Synthetic customer has no personal integrations.
create table if not exists public.sandy_v2_qa_account(
 id integer primary key default 1 check(id=1),
 customer_id uuid not null unique references public.email_customers(id) on delete restrict,
 enabled boolean not null default true,
 max_calls_per_day integer not null default 80 check(max_calls_per_day between 1 and 200),
 max_calls_per_run integer not null default 1 check(max_calls_per_run between 1 and 5),
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now()
);
create table if not exists public.sandy_v2_qa_executions(
 id uuid primary key default gen_random_uuid(),
 run_key text not null,case_key text not null,request_id text not null unique,
 customer_id uuid not null references public.email_customers(id) on delete restrict,
 question text not null,reply text,tool_trace jsonb not null default '[]'::jsonb,
 verdict text not null check(verdict in ('pass','fail','needs_review','blocked')),
 reason text not null,edge_status integer,duration_ms integer,
 evidence jsonb not null default '{}'::jsonb,created_at timestamptz not null default now()
);
create index if not exists sandy_v2_qa_executions_recent on public.sandy_v2_qa_executions(created_at desc);
create index if not exists sandy_v2_qa_executions_case on public.sandy_v2_qa_executions(case_key,created_at desc);
alter table public.sandy_v2_qa_account enable row level security;
alter table public.sandy_v2_qa_executions enable row level security;
revoke all on public.sandy_v2_qa_account,public.sandy_v2_qa_executions from public,anon,authenticated;
grant select,insert,update on public.sandy_v2_qa_account,public.sandy_v2_qa_executions to service_role;
with synthetic as (
 insert into public.email_customers(display_name)
 select 'Sandy V2 Synthetic QA Account'
 where not exists(select 1 from public.sandy_v2_qa_account where id=1)
 returning id
)
insert into public.sandy_v2_qa_account(id,customer_id,enabled,max_calls_per_run)
select 1,id,true,1 from synthetic on conflict(id) do nothing;
