# Shared agent operations

This handler and the candidate `sandy-agent-runtime-v4` call the same application
service in `../_shared/sandy-agent-operations/service.ts`. The handler does not call
the runtime, and the runtime does not call this handler. This prevents recursive
`workspace.ask → runtime → API → runtime` execution.

The concrete contracts are `gmail.messages.search`, `gmail.messages.recent`,
`gmail.drafts.prepare`, `gmail.drafts.confirm_send`, `agent.web.research`,
`agent.documents.search`, `agent.evaluations.list` and
`agent.execution_plan.draft`. Their schemas are exported from the shared
`contracts.ts`; the registry is authoritative for availability. Paid model calls
are classified as mutations even when their returned plan/search is informational.
The new registration leaves every operation unverified and every mutation
unexposed. Registration alone must not be used to enable sending or model costs.

## Identity and execution

The HTTP handler accepts `POST {operation, arguments, channel?: "api" | "mcp"}`.
It independently validates the actual Supabase user session, confirmed email,
non-revoked portal account and matching primary customer address, matching the
existing `sandy-workspace` policy. Tenant IDs, connected account ownership and
file-store IDs are never taken from the request. Project-global evaluation reads
additionally require an enabled Controller owner. Service credentials, QA tokens
and opaque API keys cannot be substituted for a user session here.

The runtime has a distinct, explicit `trusted_runtime` principal. Its existing
service credential or hashed, unexpired QA credential must authenticate first.
A process-local proof then binds the reserved task's persisted ID, customer,
channel and request ID. These branded objects cannot be reconstructed from JSON.
An automation principal has no auth-user ID and is never described as a customer
JWT. The runtime retains its existing standing worker authorization for these
existing actions, including its internal evaluation tool; the new public route
has the stricter owner-only project evaluation policy.

All calls claim a private `sandy_agent_operation_audit` record before execution.
It distinguishes auth-user and automation identities, records no provider
credentials and is inaccessible to public/anonymous/authenticated table clients.
Draft preparation and paid model calls claim a tenant/operation/idempotency key;
a completed identical call returns its stored result. A different scope or an
interrupted result refuses automatic re-execution. Runtime keys derive from its
persisted task and provider tool-call ID. Cancellation after a provider request
does not undo its effects; interrupted paid operations require reconciliation.

The connected-Gmail service was extracted byte-for-byte from the active runtime.
It saves an immutable draft, requires a separate exact `Confirm send <draft ID>`
request, checks tenant/workspace/account ownership, atomically claims a send, and
never retries a send attempt. Success requires a provider message ID and an
independent Sent Mail readback matching ID, subject and recipient. An uncertain
result remains uncertain; subsequent confirmation only reconciles a known
receipt. Provider tests in this change use in-memory fixtures; no email was sent.

Web, document and plan operations preserve the active runtime's feature flags,
fixed model broker, bounded query/model output, private verified vector store,
citations and planning-only instructions. Broker integration and provider
credentials remain backend credentials, separate from the HTTP user identity.
The existing broker's budget/context policy still needs its own source/readback
evidence before these new public paid contracts can be verified and enabled.

## Runtime source and rollout guard

The candidate in `../sandy-agent-runtime-v4/` is based on Management API source
readback of **runtime v4 version 11**, not the stale checked-in
`sandy-agent-runtime/index.ts`. The source hash was
`9c67dc1376ca14e948ce31dd02e5c172408461453d818324f0c1a58743dc5304`.
The extracted Gmail module hash was
`a3372903acd1e89f09e199778cd72d107174d36b81c55e06b6478f8032408a8c`;
the extracted `version-awareness.js` hash was
`f7c344fb99f2760e2bac13b09f173549f240ba917912cc0f9f4cb6320c6834a2`.
Both modules were preserved from that exact bundle, including the JS module
without a source map. The full baseline archive/diff remains outside the checkout
under `/workspace/sandy-api-deliverables/agent-operation-extraction-before/`.

The actual `sandy-agent-runtime` **v55** is a separate release router, not this
business implementation. Its observed flags select v4, retain v2/v1 fallbacks,
and forward its existing service/QA context. This change does not modify the
router or release-control flags. Do not deploy the candidate to the router slug.

Before deploying the v4 candidate, re-read its current version and source hash;
refuse drift from version 11 unless the new source is explicitly reconciled.
Apply `20261021002000_sandy_agent_operation_contracts.sql` first, bundle the shared
modules and preserved JS import, and preserve existing `verify_jwt:false` for the
already service/QA-authenticated runtime. The new customer HTTP handler should
use platform JWT verification plus its independent user authorization. No
deployment, migration, test credential issuance or release retargeting was
performed by this source implementation.

## Validation and limits

The new handler's 19 executable fixture tests cover forged/foreign task grants,
temporary QA expiry, principal separation, tenant/workspace binding, send claim
and receipt behavior, lost responses, idempotency, fixed provider calls, verified
private stores, paid generation, registry/schema drift, exposure gates and
bounded streamed request bodies with strict UTF8 decoding.
Shared/API sources pass `deno check`. The runtime candidate also passes a local
strict check with a type-only shim for the pre-existing JSR EdgeRuntime declaration
because the execution machine cannot fetch that JSR declaration; its production
import is preserved. These tests do not establish real provider outcomes.

The main conversation-model call, task/context/history/database tools,
image-approval task creation and older v1/v2 fallback runtimes are outside this
eight-operation extraction. They remain separate work for universal routing and
must not be described as migrated by this change. Existing shared provider
execution behind a governed handler remains legitimate; a new MCP bypass does not.
