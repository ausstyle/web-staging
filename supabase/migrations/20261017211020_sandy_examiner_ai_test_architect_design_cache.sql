-- Sandy Examiner adaptive test-design shadow cache (applied to production 2026-10-17).
create table if not exists public.sandy_examiner_design_runs (
  run_key text primary key,
  snapshot_hash text,
  model text not null default 'gpt-6-astra',
  mode text not null default 'shadow',
  status text not null default 'running' check (status in ('running','generated','rejected','failed','skipped')),
  proposals jsonb not null default '[]'::jsonb,
  source_summary jsonb not null default '{}'::jsonb,
  rejection_reason text,
  prompt_version text not null default 'examiner-architect-v1',
  created_at timestamptz not null default now(),
  completed_at timestamptz
);
create index if not exists sandy_examiner_design_recent on public.sandy_examiner_design_runs(created_at desc);
alter table public.sandy_examiner_design_runs enable row level security;
revoke all on public.sandy_examiner_design_runs from public,anon,authenticated;
grant select,insert,update on public.sandy_examiner_design_runs to service_role;
insert into public.sandy_v2_runtime_policy(policy_key,mode,config)
values ('examiner_test_design','shadow',jsonb_build_object('model','gpt-6-astra','reasoning_effort','high','generation_frequency','daily','mission_statement','Sandy is an accountable autonomous executive assistant. Successfully perform delegated customer missions end-to-end using authorized tools, apps, other AI, and humans, and independently verify outcomes with minimum unnecessary customer intervention. Distinguish stated ambition, deployed functionality and proven execution.'))
on conflict(policy_key) do nothing;
