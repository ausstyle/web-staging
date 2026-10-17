# Sandy delegation subsystem — production inventory (2026-10-17)

## Purpose and evidence boundaries
Architecture input for issue #1. This is a read-only inventory, not a migration or verification that the defect is fixed. Do not copy customer records or invite tokens into source control. Existing tracked production-source snapshots: `supabase/functions/sandy-whatsapp-webhook/`, `supabase/functions/sandy-task-api/`, `supabase/functions/sandy-qa-engineering-investigator/`.

## Live schema confirmed by information_schema
- `sandy_tasks`: id, customer_id, parent_task_id, title, details, status, priority, due_at, company_id, responsible_customer_id, contact_name, metadata, archived_at, version and timestamps (see task API for full fields).
- `sandy_task_delegations`: id, owner_customer_id, task_id, assignee_customer_id, status, scope, created_at, updated_at, accepted_at.
- `sandy_task_participants`: task_id, customer_id, role, scope, status, created_at, updated_at.
- `sandy_external_task_invitations`: id, owner_customer_id, task_id, email, scope, token_hash, status, attempts, expires_at, last_sent_at, accepted_at, customer_id, last_error, created_at, updated_at, reply_message_id, reply_accepted_at.
- `sandy_shared_task_requests`: customer_id, source_channel, source_session_id, source_event_key, instruction, status, approval_required, approved_at, dispatched_task_id, result, error_code and timestamps.
- `sandy_task_api_receipts`: customer_id, source_channel, source_id, request_key, action, payload_sha256, status, result, error, created_at, finished_at.
- `sandy_qa_engineering_handoffs`: unique issue_key; status, evidence, root_cause, recommended_fix, regression_plan, target_function, deployed_version, approval_required, verification, timestamps.

## Data access — checked, not assumed
A live query of `pg_policies` for sandy_tasks, sandy_task_delegations, sandy_task_participants, sandy_external_task_invitations and sandy_qa_engineering_handoffs returned zero policy rows. This **does not** prove tables lack RLS or are exposed: inspect `pg_class.relrowsecurity`, effective grants and SECURITY DEFINER functions before changing any query. A follow-up grant inspection was blocked in this session. Customer isolation is especially important because Edge Functions use service-role access.

## Existing known RPC / QA behavior
- `public.sandy_verify_task_delegation(uuid,uuid,timestamptz)` returns task/delegation evidence scoped to customer and task. A versioned reference is at `docs/sandy-qa/deployed-delegation-verifier-reference.sql`. Historical revocation may not be reconstructable.
- `sandy_qa_sync_engineering_handoffs()` enqueues high-priority issues idempotently; `sandy_qa_handoff_guard()` prevents verified without production_passed=true and deployed without deployment_receipt.
- `sandy-qa-engineering-investigator` analyzes saved evidence and emits proposals; it does not inspect the full codebase or deploy.
- The actual task invitation, acceptance, revocation and participants lifecycle implementations may live in other Edge Functions, RPCs, and frontend sources. **Those precise definitions have not yet been verified here.**

## Architect required follow-up
1. Identify the authoritative lifecycle paths for invitation, acceptance, revocation, participant synchronization and delegated task-list reads.
2. Inspect their complete implementation and effective RLS/grants/SECURITY DEFINER boundaries before allowing change proposals that cross tenant boundaries.
3. Define one shared evidence contract for positive/negative assignment assertions, including pagination, ambiguous titles, lifecycle timestamps and identity resolution.
4. Design regression tests for accepted, pending, revoked, missing, cross-tenant, >120 tasks, >300 delegations, and provider error states.
5. Do not approve production change or mark the issue verified without a fresh WhatsApp reply and delivery receipts.

## First incident
The historical Villa task exists and had an accepted delegation by the later WhatsApp replies. Independent evidence-backed QA recorded contradictions for outbound message IDs 1272 and 1278. These records support the historical defect, not successful remediation.

## Supplemental production inspection (2026-10-17)
- PostgreSQL `pg_class` reports `relrowsecurity=true` and `relforcerowsecurity=false` for all five inspected tables: `sandy_tasks`, `sandy_task_delegations`, `sandy_task_participants`, `sandy_external_task_invitations`, `sandy_qa_engineering_handoffs`. RLS is enabled, but role bypass and effective grants still need independent review.
- The deployed `sandy_task_delegation_scope_guard()` trigger prevents subtree delegations spanning different task workspaces by recursively walking descendants and comparing `company_id` to the task root. This is a workspace-consistency check, **not proof of sender authorisation**.
- Attempts to retrieve full bodies for `sandy_agenda_claim_invite` and `sandy_claim_external_task_invitation`, and to enumerate role grants, were blocked. These remain missing evidence; no inference of secure permissions should be made.
