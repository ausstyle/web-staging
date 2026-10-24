-- Sandy My Voices v1: service-only, tenant-scoped voice records. No raw audio is retained.
create table if not exists public.sandy_voice_profiles (
 id uuid primary key default gen_random_uuid(),
 customer_id uuid not null references public.email_customers(id) on delete cascade,
 owner_auth_user_id uuid not null references auth.users(id),
 request_id uuid not null,
 name text not null check (char_length(name) between 1 and 80),
 provider text not null default 'openai' check (provider = 'openai'),
 provider_voice_id text,
 provider_consent_id text,
 status text not null default 'creating' check (status in ('creating','ready','error','revoked','delete_pending','deleted')),
 selected boolean not null default false,
 consent_language text not null default 'en',
 consent_version text not null default 'v1-2026-10',
 consent_attested_at timestamptz not null default now(),
 provider_verified_at timestamptz,
 revoked_at timestamptz,
 provider_deleted_at timestamptz,
 error_code text,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 unique (customer_id, request_id),
 unique (provider, provider_voice_id),
 check (not selected or (status = 'ready' and revoked_at is null))
);
create index if not exists sandy_voice_profiles_customer_idx on public.sandy_voice_profiles(customer_id, created_at desc);
create unique index if not exists sandy_voice_profiles_single_selected_idx on public.sandy_voice_profiles(customer_id) where selected = true;
create unique index if not exists sandy_voice_profiles_one_create_idx on public.sandy_voice_profiles(customer_id) where status='creating';
create table if not exists public.sandy_voice_profile_events (
 id bigint generated always as identity primary key,
 profile_id uuid references public.sandy_voice_profiles(id) on delete set null,
 customer_id uuid not null references public.email_customers(id) on delete cascade,
 actor_auth_user_id uuid references auth.users(id),
 event_type text not null check (event_type in ('requested','ready','provider_error','selected','deselected','revoked','delete_verified','delete_failed')),
 outcome text not null,
 created_at timestamptz not null default now()
);
create index if not exists sandy_voice_profile_events_customer_idx on public.sandy_voice_profile_events(customer_id,created_at desc);
alter table public.sandy_voice_profiles enable row level security;
alter table public.sandy_voice_profile_events enable row level security;
revoke all on public.sandy_voice_profiles from public, anon, authenticated;
revoke all on public.sandy_voice_profile_events from public, anon, authenticated;
revoke all on sequence public.sandy_voice_profile_events_id_seq from public, anon, authenticated;
grant select,insert,update,delete on public.sandy_voice_profiles to service_role;
grant select,insert,update,delete on public.sandy_voice_profile_events to service_role;
grant usage,select on sequence public.sandy_voice_profile_events_id_seq to service_role;
comment on table public.sandy_voice_profiles is 'Only service-role Sandy voice domain API may access; user identity resolved from Supabase Auth and portal membership, not request body.';
