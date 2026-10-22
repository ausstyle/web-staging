# Sandy engineering — shared architecture and execution contracts

Version: 1.0 · 21 October 2026  
Status: Target engineering design; not a production-readiness assertion  
Authority: [Master Scope v1.1](master-scope-v1.md), including section 22; [API scope](../sandy-api/api-scope-161.md)

## 1. Design basis and boundaries

This document refines the Master Scope into shared implementation contracts for SANDY-ENG-0001 through 0010. The Master Scope's mission, non-disruption requirement, security boundaries, truth states and acceptance gates take precedence. New component names and operation IDs below are proposed logical contracts, not claims that corresponding production tables or endpoints exist. Reuse an equivalent existing implementation and record its mapping rather than introduce an alias or duplicate service unnecessarily.

The primary deployment is Supabase project `zmqlyygzqoidkcwdysok`; version-controlled source belongs in `ausstyle/web-staging`. A metadata-only inspection on 21 October 2026 confirmed existing mission, calendar, memory, model-routing, operation-registry and guest-worker relations. Existence is not proof of correct behavior. Every implementation work package starts with deployed-source parity, schema/permission inspection and reproducible failing behavior; do not replace that investigation with this design.

### Architectural decisions

**AD-01 — Modular core, bounded workers.** Keep a coherent TypeScript application core with explicit domain modules. Edge Functions handle authentication, admission, webhooks and short work. Persistent, authenticated workers handle work that must survive a request, large artifact processing and browser/computer execution. Media runs on a separate media plane. Reuse existing scheduling/queue infrastructure before adding a second queue, Redis, Temporal or Kubernetes. A measured bottleneck and recorded architecture decision are required for additional infrastructure.

**AD-02 — One logical orchestrator, many safe workers.** One accountable orchestration policy controls each run; it need not be a singleton server. Workers scale horizontally and coordinate through leases and version checks. No channel gets a competing planner or hidden business policy.

**AD-03 — One operation boundary.** Sandy's runtime and applications use Sandy API. Sandy MCP is an external protocol adapter to the same API; it does not own provider credentials or alternate provider executors. Trusted colocated modules may call the same application-service functions in process only through the same authorization, admission, audit and result-contract boundary. Internal worker callbacks and provider webhooks have their own authenticated ingress, not a bypass around operation policy.

**AD-04 — One persistent owner per fact.** Each aggregate has one write owner. Other modules consume versioned events or authorized queries. Database events and outbox state are committed together. Do not dual-write independently from the UI, orchestrator and provider webhook.

**AD-05 — Facts and effects have different evidence.** A factual answer cites eligible sources. A completed action additionally requires a provider receipt or observed target state. A model statement, mapped operation, accepted queue job or deployment metadata alone cannot establish the requested outcome.

**AD-06 — Autonomy is delegated, not improvised.** Routine authorized work can proceed under an explicit standing grant without a prompt on every step. A grant binds actor, tenant, operation class, targets, budget, risk, expiry and revocation. Missing authority returns a specific blocker. Neither a prompt nor an edited registry flag can expand privilege.

**AD-07 — Incremental migration.** Preserve customer IDs, sessions where possible, conversations, external IDs, consent and historical evidence. Expand schema, backfill with verification, run shadow reads, canary one authorized cohort, then switch writes. Contract/delete only after a documented compatibility and rollback window.

## 2. Ownership map

| Owner | Owns | Must not duplicate |
| --- | --- | --- |
| 0001 Runtime reliability | Failure cohort, evaluation definitions, reasoning-quality acceptance and release sign-off | Another orchestrator or provider gateway |
| 0002 Autonomy program | Competitive scenario matrix, isolated browser/computer execution experience, proactive read-only policies and program integration | Mission ledger, memory store or permission engine |
| 0003 Orchestrator | Turn semantics, model routing, planning, context assembly, next-step decisions and channel response policy | Mission scheduler, provider CRUD or World Model storage |
| 0004 Missions / Truth | Durable runs/steps, leases, outbox/inbox delivery, commitments, receipts, verification and compensation | Domain conflict rules or a competing model planner |
| 0005 API / MCP | Identity/delegation boundary, contracts, registry readiness, provider adapters, engineering release path and infrastructure access | Customer-specific workflow decisions |
| 0006 Memory / World Model | Entity resolution, claims, provenance, ACL-filtered retrieval, correction and forgetting | Mission completion or provider operation authorization |
| 0007 Calendar | Calendar mappings, subscriptions, cursors, recurrence, conflict resolution and sync | Generic job engine or second task/event database |
| 0008 Video | Rooms, participants, media deployment, connectivity and consented recordings | General VM administration or calendar event ownership |
| 0009 Customer experience | Client projections, interactions, notifications, briefings and Controller workflows | Independent persistence of domain truth |
| 0010 Commercial readiness | Tenant lifecycle, entitlements, usage settlement, billing, support and operating readiness | A second runtime authorization engine |

## 3. Shared contracts

### SC-01 — Verified actor context

The server derives `{actor_id, actor_type, tenant_id, workspace_id?, company_scope?, connected_account_id?, session_or_delegation_id, scopes, policy_version, auth_checked_at, trace_id}` from authenticated identity and authoritative membership/grant records. Client-provided tenant/account selectors are requests to validate, not authority. Distinguish human, service, guest and engineering actors. Support tenant-wide and company-restricted grants without treating shared visibility as power to execute. Recheck policy at dispatch and after long waits. Session/permission revocation must invalidate cached eligibility.

### SC-02 — Channel event

`{event_id, tenant_id, channel, provider_account_id, provider_event_id, event_type, observed_at, occurred_at, conversation_id?, parent_message_id?, payload_ref, content_digest, signature_validation_ref, trace_id}`. Ingest deduplicates by provider/account/event identity, quarantines invalid payloads and persists before acknowledgement. Untrusted content is data, never authorization or system instructions. Sequence/order comes from explicit event metadata, not arrival time alone.

### SC-03 — Run, step and checkpoint

Run: `{run_id, mission_id?, conversation_id, objective, constraints, actor_context_ref, policy_snapshot_ref, status, version, budget, deadline, next_action_at?, source_manifest_ref, trace_id}`. Step: `{step_id, run_id, dependency_ids, operation_id?, input_ref, input_digest, state, attempt, lease_epoch, receipt_ref?, compensation_ref?}`. Checkpoints include completed facts, pending tool-call IDs, external resource IDs, decisions and unresolved work; not raw private model chain-of-thought. Use structured reasons and authorized provider continuation artifacts only.

### SC-04 — Operation and result

Operation definition includes stable ID/version, exact schemas, handler/release digest, owner, target/account binding, permission/risk class, input limits, idempotency/reconciliation semantics, timeouts, cost estimate, evidence rules and compatibility. The operation registry is the catalogue, not executable source. The compiled or signed handler manifest constrains what can run; a database row cannot introduce an arbitrary URL or executable.

Request: `{operation, contract_version, arguments, request_id, idempotency_key?, expected_resource_version?, deadline?, correlation_id}` plus SC-01. An idempotency key is scoped to tenant, actor/delegation, operation and intended target. Reusing it with a different canonical input digest returns a conflict.

Result: `{request_id, operation, contract_version, state, accepted, execution_started, result?, job_id?, receipt_ids, error?, retry_after?, observed_at, release_ref}`. `accepted=true` means durable admission only. `VERIFIED_SUCCESS` needs accepted evidence under SC-05. Distinguish validation, authorization, provider entitlement, rate limit, expired credentials, conflicting version, uncertain outcome and internal failure. Never convert provider errors into a successful empty response. Do not return credentials or sensitive raw upstream errors.

### SC-05 — Receipt and verification

`{receipt_id, tenant_id, actor_ref, operation_id, resource_ref, input_digest, provider_request_id?, provider_account_ref, effect_state, verification_state, evidence_refs, observed_at, verifier_version, release_ref, supersedes_receipt_id?}`. Deployment, reachability, permission, functional test and rollback evidence are separate dimensions. Receipt hashes are tamper-evidence, not a claim that a database administrator cannot alter records. Store only minimum redacted metadata in append-only audit projections; protect sensitive payloads with retention and deletion policies.

### SC-06 — Authorized context bundle

`{query_id, actor_context_ref, objective, exact_entities, retrieval_policy_version, sources:[{source_ref, revision, event_time, observed_at, validity, permission_ref, confidence, excerpt_ref}], active_constraints, commitments, capability_refs, token_budget, omissions, freshness}`. The memory service filters authorization before ranking and again before serving. Exact IDs and dates precede semantic matches. An unavailable connector or partial search is visible to the orchestrator. A summary is derived evidence, not a new authoritative fact.

### SC-07 — Events and delivery

Event envelope: `{event_id, event_type, schema_version, aggregate_type, aggregate_id, aggregate_version, tenant_id, actor_ref, correlation_id, causation_id, occurred_at, payload_ref}`. Commit domain changes plus outbox in one transaction. Delivery is at least once; consumers keep an inbox key and last applied version. Acknowledge after durable effects. Retain dead-letter diagnostics and supervised replay. Do not promise exactly-once external effects where a provider lacks idempotency or reconciliation support.

### SC-08 — Budget reservation and settlement

Reserve predicted tool/model/compute spend atomically before expensive work, apply per-tenant fairness, then settle observed usage exactly once using a unique usage-event ID. Cancel/expiry releases unused reservation; unknown provider outcomes keep a bounded pending reconciliation state. Estimates, actual costs and user prices are different fields. Do not silently downgrade consequential reasoning or purchase an external plan to pass a test.

## 4. Shared safety and reliability invariants

Validate input and returned schemas on the server; bind file references to tenant, size, type and checksum. No unrestricted URL-fetch proxy, SQL-through-customer-tool, client-provided role or unvalidated shell command. Database RLS and grants are defense in depth, not a substitute for service authorization; privileged server keys require explicit scoped checks. Runtime/provider secrets are not placed in prompts, source, docs or browser storage.

When an external write times out, record `UNKNOWN_OUTCOME`, query its provider identity/correlation marker, then decide whether retry is safe. Cancellation stops unsent work and requests termination of running work; it does not claim to unsend email, remove past disclosures or roll back a payment. A revoked mission must not dispatch its next step. Queue retries have bounded attempts, exponential backoff with jitter and independent watchdogs.

## 5. Evidence and acceptance standard

Every scope must ship a traceability matrix: requirement ID → existing/new canonical operation → source path/revision → migration → deployed version → tests → actual receipt → limitation. Tests have classes: deterministic/unit, adapter contract, isolated database, staging provider, production canary, human UX. A mocked provider test never counts as a live provider result.

Use reproducible synthetic fixtures and consenting test accounts. No production delete, financial transfer, unsolicited message, security-policy change or paid resource creation merely to complete a test. Where realistic verification needs unavailable entitlement or approval, retain `BLOCKED_EXTERNAL` evidence and state exactly what remains uncertified. Overall scope completion requires all mandatory criteria or an explicitly approved, versioned exception; the exception is not a pass.

Quantitative latency/capacity targets in sub-scopes are proposed engineering gates, not current benchmarks or contractual promises. Record cohort size, environment, provider delays, confidence/variability and failure distribution. All critical tenant, permission, duplicate-side-effect and false-completion tests must pass.

## 6. Source and sync discipline

GitHub main contains versioned specifications; `scopes.json` is the discovery manifest. Supabase stores immutable commit references, hashes, status metadata and evidence. Scope updates must not reset operational evidence or mark runtime capabilities verified. A code deployment and a documentation synchronization are different events.

Before deployment, match source to live code and capture recovery artifacts. Use a per-component release lock, migration ordering and optimistic version checks so concurrent Codex tasks cannot overwrite each other. Background sync should be monotonic by accepted Git ancestry; any stale/out-of-order revision must not replace newer catalogue state. Do not broaden the existing sync service in a documentation-only change; record a reproducible sync defect as a separate bounded fix.

## 7. Technical references and provenance

Master-derived requirements are the governing source. AD/SC details are new engineering refinements, not statements about existing software or another vendor's private architecture. Primary documentation checked on 21 October 2026 informs the following bounded constraints; revalidate compatibility at implementation:

- [Supabase Edge limits](https://supabase.com/docs/guides/functions/limits) and [background tasks](https://supabase.com/docs/guides/functions/background-tasks): request/background execution is bounded; durable Missions cannot rely on a permanently live Edge request.
- [PostgreSQL SELECT locking](https://www.postgresql.org/docs/current/sql-select.html): `SKIP LOCKED` is suitable for queue-like consumers, not a consistent general-purpose data view.
- [Supabase RLS](https://supabase.com/docs/guides/database/postgres/row-level-security): protect exposed tables and account explicitly for privileged server roles that bypass RLS.
- [OpenAI function calling](https://developers.openai.com/api/docs/guides/function-calling): preserve tool-call identifiers and supported reasoning continuation items when feeding results back to a model; never invent a consumer model name as an API contract.
- [MCP tools](https://modelcontextprotocol.io/specification/2025-11-25/server/tools) and [authorization](https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization): negotiate a supported protocol version and implement discovery, pagination, error semantics and audience-bound authorization, with adapter behavior tested against the chosen client.
- [GitHub Actions OIDC](https://docs.github.com/en/actions/concepts/security/openid-connect): use supported short-lived federation with narrowly bound workflow identity rather than copying personal owner sessions for long-running automation.


## AD-08 — No manual approval stage for delegated engineering (Master amendment B)

Engineering work within a pre-established, revocable policy envelope is automatically admitted after deterministic identity, target, scope, risk, budget, source, tests and rollback checks. There is **no human approval step per commit, job or release**. Engineering Control records policy authorization and execution receipts, not forged owner-signoff. A workload cannot create or expand its own delegation, and a policy-blocked action stays blocked; authentic administrative policy changes are separate from executing work. Existing audit/history and external GitHub/GCP/provider protection rules remain effective until intentionally and legitimately reconfigured. Do not defeat protected branches/environments or IAM restrictions merely to remove Sandy's own approval UI.
