-- Recipient-scoped Sandy user meeting invitations.
create table if not exists public.sandy_video_user_invites (
 id uuid primary key default gen_random_uuid(),
 meeting_id uuid not null references public.sandy_video_meetings(id) on delete cascade,
 inviter_id uuid not null references auth.users(id) on delete cascade,
 recipient_id uuid not null references auth.users(id) on delete cascade,
 status text not null default 'pending' check (status in ('pending','accepted','declined','revoked')),
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 unique(meeting_id,recipient_id),
 check(inviter_id <> recipient_id)
);
create index if not exists sandy_video_user_invites_recipient_idx on public.sandy_video_user_invites(recipient_id,created_at desc);
alter table public.sandy_video_user_invites enable row level security;
revoke all on public.sandy_video_user_invites from anon,authenticated;
grant select,insert,update,delete on public.sandy_video_user_invites to service_role;
