-- Sandy Legal: explicit trusted API role grants, keeping all browser client roles denied.
-- The project does not automatically expose new public tables to the Data API (2026 default).
-- No browser-accessible legal table permissions are introduced.
grant select, insert, update on table
 public.sandy_legal_matters,
 public.sandy_legal_proceedings,
 public.sandy_legal_records
to service_role;
grant select, insert on table public.sandy_legal_audit to service_role;
grant usage, select on sequence public.sandy_legal_audit_id_seq to service_role;
revoke all on table
 public.sandy_legal_matters,
 public.sandy_legal_proceedings,
 public.sandy_legal_records,
 public.sandy_legal_audit
from anon, authenticated, public;
revoke all on sequence public.sandy_legal_audit_id_seq from anon, authenticated, public;
