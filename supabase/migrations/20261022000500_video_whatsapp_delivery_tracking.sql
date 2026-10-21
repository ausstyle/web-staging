-- WhatsApp delivery state for Sandy Meetings user invitations.
alter table public.sandy_video_user_invites
 add column if not exists whatsapp_status text default 'not_requested',
 add column if not exists whatsapp_attempted_at timestamptz,
 add column if not exists whatsapp_error_code text;
-- Recording a submitted send is not evidence of actual device delivery.
