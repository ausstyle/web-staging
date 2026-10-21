-- Sandy-hosted video meetings. No API keys or media credentials stored in rows.
create table if not exists public.sandy_video_meetings (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  room_name text not null unique,
  title text not null check (char_length(title) between 1 and 140),
  state text not null default 'scheduled' check (state in ('scheduled','ended','cancelled')),
  starts_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists sandy_video_meetings_owner_idx on public.sandy_video_meetings(owner_id,created_at desc);
create table if not exists public.sandy_video_invites (
  id uuid primary key default gen_random_uuid(),
  meeting_id uuid not null references public.sandy_video_meetings(id) on delete cascade,
  token_sha256 text not null unique check(token_sha256 ~ '^[a-f0-9]{64}$'),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists sandy_video_invites_meeting_idx on public.sandy_video_invites(meeting_id);
alter table public.sandy_video_meetings enable row level security;
alter table public.sandy_video_invites enable row level security;
revoke all on public.sandy_video_meetings,public.sandy_video_invites from anon,authenticated;
-- Only the Sandy Edge Function service role operates on these tables.
