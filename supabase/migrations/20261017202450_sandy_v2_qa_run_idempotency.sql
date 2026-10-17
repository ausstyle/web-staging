
create table if not exists public.sandy_v2_qa_runs(
 run_key text primary key,
 status text not null default 'running' check(status in ('running','complete','partial','failed')),
 started_at timestamptz not null default now(),
 completed_at timestamptz,attempted integer not null default 0,
 passed integer not null default 0,failed integer not null default 0,reviews integer not null default 0
);
alter table public.sandy_v2_qa_runs enable row level security;
revoke all on public.sandy_v2_qa_runs from public,anon,authenticated;
grant select,insert,update on public.sandy_v2_qa_runs to service_role;
