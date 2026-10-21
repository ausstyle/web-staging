# SANDY-ENG-0004 — Durable Missions, Commitments and Truth Engine

Version: 1.0 · 21 October 2026  
Status: DRAFT — target design, not verified production capability  
Priority: P0  
Owner: Sandy Execution Reliability Engineering / Codex  
Master: §§1.2, 4.2–4.3, 7, 10.4–10.5, 12–15, 17–19; AC-02, AC-04, AC-08, AC-10–11  
API requirements: 3–11, 153–155, 157, 160  
Dependencies: SC-01–08 in [shared architecture](../architecture-contracts.md); planner decisions from 0003; authorized effects from 0005

## 1. Outcome and ownership

An accepted objective must survive a disconnected chat, expired worker, provider timeout, approval wait and server restart. Sandy must know what happened, what remains, who owns the next action, when it should resume and which evidence supports completion. This scope owns durable state, scheduling, commitments, operation receipts and verification. It does not choose the reasoning model, implement calendar conflict semantics or reproduce provider adapters.

A mission and an operation have different state machines. A mission can be PARTIAL while several operations succeeded, one is uncertain and another awaits a reply. Avoid replacing this with a single Boolean `success` or a decorative percentage.

## 2. Reuse and initial evidence

The live schema has `sandy_mission_runs`, mission decisions/questions/reminders/work products, deployment jobs/events and `sandy_guest_jobs`. Inspect their real relationships, uniqueness, RLS, consumers, job leasing, callbacks and recovery behavior before migration. Their presence does not establish a shared durable executor. Produce one ownership map and preserve historical IDs. Map existing specialized outboxes onto the shared delivery contract; do not delete them just because they are domain-specific.

## 3. Architecture

`admitted objective → mission/run ledger → ready-step selector → leased worker → Sandy API effect → receipt → verifier → next step or durable wait`

PostgreSQL is the default durable source. Domain changes and their outbox are atomic. A bounded relay claims outbox rows, delivers at least once and records acknowledgements. Workers use short claim transactions, `SKIP LOCKED` or equivalent proven queue primitives, monotonic lease epochs and compare-and-swap completion. They do not keep a DB transaction open during model/provider calls. A stale worker cannot publish a newer state after lease reassignment.

Use existing queue machinery if it satisfies these contracts. Introduce another queue/workflow product only via a measured ADR identifying a failure the existing implementation cannot meet. The semantic state machine remains portable and versioned regardless of transport.

### Mission state

Preserve Master §7.2: `NEW → CLARIFYING/PLANNING → READY → EXECUTING → VERIFYING → COMPLETED`, with explicit `WAITING_CUSTOMER`, `WAITING_EXTERNAL`, `DELEGATED`, `BLOCKED`, `PARTIAL`, `FAILED`, `PAUSED`, `CANCELLED` branches. Persist allowed transitions with expected version and actor. COMPLETED requires every mandatory deliverable verified and unresolved effects reconciled. Reopening creates a traceable revision, not silent history edits.

### Step and operation state

Steps distinguish pending dependencies, eligible, leased, executing, waiting, verifying, completed, retryable failure, terminal failure, cancelled and uncertain. Operation truth states retain Master §12 values: `PROPOSED`, `QUEUED`, `RUNNING`, `WAITING_APPROVAL`, `WAITING_EXTERNAL`, `PARTIAL`, `VERIFIED_SUCCESS`, `VERIFIED_FAILURE`, `UNKNOWN_OUTCOME`, `CANCELLED`. Map existing enums explicitly; do not proliferate near-synonyms in each handler.

## 4. Functional requirements

| ID | Requirement |
| --- | --- |
| MTR-01 | Persist accepted objective, owner, deliverables, constraints, budget, deadlines/timezone and source evidence |
| MTR-02 | Validate dependency DAGs; reject cycles and invalid cross-tenant links |
| MTR-03 | Claim ready steps with fenced leases and recover crashed/expired workers |
| MTR-04 | Deduplicate inbound events, delivery attempts and intended effects |
| MTR-05 | Handle uncertain external outcomes by reconciliation before retry |
| MTR-06 | Maintain evidence-backed Truth Engine verdicts and final-claim guards |
| MTR-07 | Persist third-party waits, reminders, escalation, cancellation and approval expiry |
| MTR-08 | Resume after interruptions without redoing completed side effects |
| MTR-09 | Support bounded retries, compensation and honest irreversibility |
| MTR-10 | Enforce per-tenant concurrency, budget reservation and fair scheduling |
| MTR-11 | Expose progress, evidence, blockers, next action and responsibility |
| MTR-12 | Detect silent loss through watchdogs, dead-letter state and alerts |

## 5. Algorithms and failure semantics

**Admission:** validate actor and request; resolve stable mission/run identity; bind idempotency key to canonical input; insert state plus outbox and initial commitment in one transaction. Return accepted only after commit. Repeated same-key/same-input requests return the original job; changed input returns conflict.

**Dispatch:** select eligible steps whose prerequisites are satisfied and schedule is due; reserve budget; atomically assign lease owner, epoch and expiry. Resolve current authority before each effect. The worker snapshots relevant release/contracts, calls 0005, then writes the receipt and step transition with the same epoch/version. Heartbeats extend a live lease within a maximum duration. Lost leases cannot finish a step; their results enter reconciliation.

**Timeout after external effect:** retain provider resource/correlation IDs and input digest. Ask the adapter to reconcile. If one matching effect exists, verify it; if absence is conclusively established, retry under the same intended-effect identity; if ambiguous, remain UNKNOWN_OUTCOME and escalate. Never promise universal exactly-once delivery across unsupported providers.

**Third-party wait:** store awaited entity/message predicate, earliest/latest wake-up, channel and scope. A webhook or scheduled reconciliation emits a deduplicated wake-up. The orchestrator decides the next action using current context. Expired grants or changed constraints require reauthorization/replanning, not blind continuation.

**Cancellation/compensation:** stop unsent work, fence pending dispatch and request running cancellation. Reconcile in-flight effects first. Execute a documented compensating plan where authorized; an email cannot be unsent by deleting a database row. Record compensation attempted, completed, impossible or failed independently of the original receipt.

**Plan revision:** user changes apply against a versioned plan. Completed steps remain immutable evidence; not-started steps may be superseded. Determine whether dependent steps need replanning rather than resubmitting the whole mission.

## 6. Truth Engine design

Verifiers are deterministic, versioned domain adapters where possible: sent-message lookup, calendar read-after-write, artifact reopen/checksum, deployed source digest plus functional probe, or media-session statistics. A model may evaluate document quality with a rubric but cannot self-certify an external write it proposed.

Each deliverable declares its evidence rule, freshness, independent observer and permissible uncertainty. The Truth Engine normalizes receipts, checks target/account and expected properties, links source evidence, then issues a verdict. Provider acceptance, delivery, recipient response and customer-quality acceptance are separate facts. A sent-email receipt does not prove the recipient read it.

Final communication receives a structured claim ledger with allowed claims and unresolved outcomes. A contradiction between response wording and ledger blocks the false claim or rewrites it to a truthful partial result. Preserve factual citations separately from action receipts. Failed verification never erases evidence of a real side effect.

## 7. Target API contracts

Map these contracts to existing operations before adding names. All read operations filter by SC-01; all mutations require expected version/idempotency where applicable.

| Contract | Essential input | Essential result |
| --- | --- | --- |
| `missions.create` | goal, deliverables, constraints, deadline, delegated scope | durable mission/run IDs |
| `missions.get` / `missions.events` | mission ID, event cursor | state, responsibility, evidence, next action |
| `missions.plan.update` | mission ID, expected version, steps/dependencies | versioned validated DAG |
| `missions.pause` / `missions.resume` / `missions.cancel` | mission ID, expected version, reason | acknowledged state, outstanding effects |
| `missions.verify` | mission ID, evidence refs | deliverable verdicts, no inferred success |
| `jobs.get` / `jobs.retry` / `jobs.cancel` | job ID, reason/version | real retry eligibility / cancellation state |
| `jobs.compensate` | job ID, approved plan ref | compensation receipt(s) |
| `commitments.list` / `commitments.update` | scoped owner, due window or commitment revision | source-linked next action |
| `receipts.get` / `receipts.reconcile` | receipt or operation ref | redacted evidence or reconciliation job |

Worker claim/heartbeat/finalize interfaces are internal service contracts, not customer-exposed arbitrary execution tools. Use short-lived workload credentials and narrowly scoped callback admission.

## 8. Logical data model and indexes

Reuse existing records. Required aggregates: mission, immutable plan revision, step, run, attempt, receipt, commitment, outbox/inbox and dead-letter entry. Tenant/aggregate/version and provider-account/resource identity are indexed. Unique constraints protect inbound provider IDs, request idempotency and usage-event settlement. Queue indexes cover state, available-at, priority and lease expiry; retain bounded payload references rather than copying entire conversations into every row.

Separate scheduled time, occurrence time and observation time; timezone-sensitive commitments retain IANA zone and intended wall time. Retention follows 0010 policy: keep redacted integrity metadata where appropriate without preserving deleted personal content indefinitely.

## 9. Tests and proposed operating gates

MTR-T01: crash at admission, before dispatch, during provider call, after provider success and before receipt persistence. MTR-T02: two workers race and one stale worker finishes. MTR-T03: replay the same event/key 100 times. MTR-T04: timeout after a real disposable send/create with provider reconciliation. MTR-T05: revoke permissions during a wait. MTR-T06: cycle and foreign-tenant dependency rejection. MTR-T07: pause/resume/cancel under concurrent user correction. MTR-T08: duplicate wake-up/reminder suppression. MTR-T09: unavailable verifier returns unknown, not success. MTR-T10: budget exhaustion and fair scheduling. MTR-T11: failed compensation stays visible. MTR-T12: silent consumer failure triggers a watchdog alert.

Exercise at least 20 multi-step missions across these fault points, satisfying Master §22.4 and SAT-06, SAT-07, SAT-10, SAT-15, SAT-16, SAT-18 and SAT-20. Zero duplicate critical effects and false success claims are mandatory. Proposed pilot recovery gate: eligible recoverable work re-enters dispatch within two configured lease windows plus the polling interval; explain every exception. A watchdog should surface an accepted run with no progress within its declared deadline, not silently extend it. Run a 24-hour synthetic soak with worker restarts; record queue lag, abandonment, cost and unknown outcomes.

## 10. Delivery and release

MTR-M1: schema mapping, invariant tests, receipt envelope and transactional outbox. MTR-M2: worker leases/fencing, idempotency and single-step recovery. MTR-M3: multi-step DAG, waits, commitments and compensation. MTR-M4: truth/claim guard, fault injection and canary. MTR-M5: controlled migration of existing job consumers.

0003 integrates at SC-03 rather than waiting for every mission feature. 0007 and 0008 reuse this scheduler/receipt engine but retain domain-specific verification. Long-lived workers require monitored capacity and graceful draining; an Edge background task is not a durable worker.

Rollback fences/drains new workers, routes compatible jobs to the old executor only when schemas and lease epochs match, and preserves all receipts. Prefer forward repair for persisted plan/step changes. Do not rewind provider state or replay completed outbox entries. Completion evidence includes deployment digests, migration logs, real receipts, fault-injection traces, queue recovery and rollback results.
