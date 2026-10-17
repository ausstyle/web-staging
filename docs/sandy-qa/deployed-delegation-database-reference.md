# Deployed delegation database — verified reference, 2026-10-17

Read-only architecture evidence for Sandy issue #1. **Not executable migration SQL.** No customer records, tokens or secret values included. This snapshot covers verified selections, not every dependent table or function.

## public.sandy_task_delegations: verified constraints
- Primary key `id`.
- Unique pair `(task_id, assignee_customer_id)`.
- Foreign keys: owner_customer_id and assignee_customer_id to email_customers(id), ON DELETE CASCADE.
- Foreign key `(task_id, owner_customer_id)` to sandy_tasks(id, customer_id), ON DELETE CASCADE.
- owner_customer_id must differ from assignee_customer_id.
- scope limited to `task` or `subtree`.
- status limited to `invited`, `accepted`, `declined`, `revoked`.

## Verified indexes
- Unique primary index on id.
- Unique index on task_id, assignee_customer_id.
- sandy_delegations_assignee on assignee_customer_id, status.
- sandy_delegations_owner on owner_customer_id, task_id.

## Verified trigger
`CREATE TRIGGER sandy_task_delegation_scope BEFORE INSERT OR UPDATE ON public.sandy_task_delegations FOR EACH ROW EXECUTE FUNCTION sandy_task_delegation_scope_guard()`

Its definition, inspected separately, checks that a subtree does not span workspaces. It does not independently authenticate the caller.

## RLS and bypass
Live `pg_class` inspection reports relrowsecurity=true and relforcerowsecurity=false for sandy_tasks, sandy_task_delegations, sandy_task_participants, sandy_external_task_invitations and sandy_qa_engineering_handoffs.

Live `pg_roles` inspection: service_role has `rolbypassrls=true`; anon and authenticated have `rolbypassrls=false`.

Live `pg_policies` for sandy_task_delegations returned **zero rows**. This does not establish other authorisation paths are safe: service-role requests bypass RLS, and function execution grants and ownership boundaries must still be checked.

## Deployed function references and limitations
- `docs/sandy-qa/deployed-delegation-verifier-reference.sql` records a prior extraction of the `sandy_verify_task_delegation` function. It filters delegation creation timestamps but reads current status, making historical interpretation potentially inaccurate.
- `docs/sandy-qa/delegation-production-inventory.md` describes invitation, ownership and QA lifecycle evidence.
- Actual Edge Function source exists in `supabase/functions/sandy-agenda`, `sandy-task-api`, `sandy-whatsapp-webhook` and `sandy-qualitative-qa`.

## Outstanding before global architecture approval
Inspect constraints, indexes and trigger/function bodies for participant, invitation, task, identity and QA handoff tables; inspect effective function EXECUTE privileges and all service-role caller checks. Do not treat missing policy rows as tenant isolation. Build a scoped regression demonstrating no cross-customer disclosure, no acceptance-status downgrade, no truncation-driven false negative and a fresh provider-observed WhatsApp response.

This file is a factual reference, not evidence that production remediation succeeded.
