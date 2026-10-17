
-- Applied to production 2026-10-17 (migration 20261017193903)
create table if not exists public.sandy_v2_runtime_policy(
 policy_key text primary key,mode text not null default 'shadow'
 check(mode in ('disabled','shadow','pilot','enabled')),
 config jsonb not null default '{}'::jsonb,updated_at timestamptz not null default now());
create table if not exists public.sandy_v2_awareness_audit(
 id uuid primary key default gen_random_uuid(),customer_id uuid,channel text not null,
 request_id text,subject text not null,
 outcome text not null check(outcome in ('verified','unverified','unavailable','error','contradiction')),
 evidence jsonb not null default '{}'::jsonb,created_at timestamptz not null default now());
create index if not exists sandy_v2_awareness_by_customer_time
 on public.sandy_v2_awareness_audit(customer_id,created_at desc);
create table if not exists public.sandy_v2_model_decisions(
 id uuid primary key default gen_random_uuid(),customer_id uuid,request_id text,
 task_type text not null,selected_model text,candidate_models jsonb not null default '[]'::jsonb,
 policy_reason text not null,actual_success boolean,verified_outcome jsonb not null default '{}'::jsonb,
 created_at timestamptz not null default now(),evaluated_at timestamptz);
create index if not exists sandy_v2_models_recent on public.sandy_v2_model_decisions(task_type,created_at desc);
create table if not exists public.sandy_v2_component_inventory(
 component_key text primary key,component_type text not null,source_of_truth text not null,
 deployment_state text not null default 'unverified',verification_note text,
 last_verified_at timestamptz,updated_at timestamptz not null default now());
alter table public.sandy_v2_runtime_policy enable row level security;
alter table public.sandy_v2_awareness_audit enable row level security;
alter table public.sandy_v2_model_decisions enable row level security;
alter table public.sandy_v2_component_inventory enable row level security;
revoke all on public.sandy_v2_runtime_policy,public.sandy_v2_awareness_audit,public.sandy_v2_model_decisions,public.sandy_v2_component_inventory from anon,authenticated;
grant select,insert,update on public.sandy_v2_runtime_policy,public.sandy_v2_awareness_audit,public.sandy_v2_model_decisions,public.sandy_v2_component_inventory to service_role;
insert into public.sandy_v2_runtime_policy(policy_key,mode,config) values
 ('executive_runtime','shadow','{"require_evidence":true,"allow_external_mutations":false}'::jsonb),
 ('automatic_engineering','shadow','{"risk_review_required":true,"production_deploy_unapproved":false}'::jsonb),
 ('adaptive_model_routing','shadow','{"approved_models_only":true,"minimum_verified_samples":10}'::jsonb)
on conflict(policy_key) do nothing;
insert into public.sandy_v2_component_inventory(component_key,component_type,source_of_truth,deployment_state,verification_note) values
 ('sandy-agent-runtime','edge_function','supabase:edge_functions','verified','v33 inspected 2026-10-17; V2 integration pending'),
 ('sandy-composio-gateway','edge_function','supabase:edge_functions','verified','v21; generic execution disabled'),
 ('sandy-feature-discovery','edge_function','supabase:edge_functions','verified','Existing discovery workflow reused'),
 ('sandy-autonomous-engineering','workflow','github:ausstyle/web-staging/.github/workflows','partial','Independent production verification not established'),
 ('ai_model_registry','database_table','supabase:public.ai_model_registry','verified','Registration does not establish live provider availability'),
 ('sandy_composio_connections','database_table','supabase:public.sandy_composio_connections','verified','Customer-scoped, remote provider verification separate')
on conflict(component_key) do nothing;
