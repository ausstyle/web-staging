# Production task-event dependencies (2026-10-17)

Read-only metadata extracted from live Supabase, not executable migration SQL. No customer event data exported.

## Audit trigger

`CREATE TRIGGER sandy_task_audit AFTER INSERT OR UPDATE ON public.sandy_tasks FOR EACH ROW EXECUTE FUNCTION sandy_task_event_audit()`

## `public.sandy_task_events` columns

- id uuid NOT NULL DEFAULT gen_random_uuid()
- customer_id uuid NOT NULL
- task_id uuid NOT NULL
- event_type text NOT NULL
- actor text NOT NULL DEFAULT 'system'
- previous_status text NULL
- new_status text NULL
- snapshot jsonb NOT NULL DEFAULT '{}'
- created_at timestamptz NOT NULL DEFAULT now()

## QA routine permissions

- sandy_qualitative_authorize: SECURITY DEFINER; EXECUTE ACL postgres/service_role
- sandy_evidence_prioritize: SECURITY DEFINER; EXECUTE ACL postgres/service_role
- sandy_task_event_audit: invoker-security trigger function; proacl NULL (effective privileges require further audit)

**Important:** Task event rows are not a complete delegation acceptance/revocation history. Do not infer historical delegation state from task status events.
