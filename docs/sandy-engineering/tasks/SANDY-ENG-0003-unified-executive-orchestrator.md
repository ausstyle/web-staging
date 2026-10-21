# SANDY-ENG-0003 — Unified Executive Orchestrator

Version: 1.0 · 21 October 2026  
Status: DRAFT — implementation-ready target; as-built mapping and acceptance evidence pending  
Priority: P0  
Accountable implementation owner: Sandy Runtime Engineering / Codex  
Master: §§1.2, 2.3, 3–5, 7, 10, 12–15, 17–19; amendment AC-01, AC-02, AC-05–08, AC-10  
API requirements: 1–11, 151–154, 160; relevant channel families 146–150  
Shared contracts: [architecture-contracts.md](../architecture-contracts.md), SC-01–08

## 1. Outcome and scope ownership

Sandy must interpret a request once, retain its objective and constraints, retrieve the right evidence, choose appropriate models and tools, and remain accountable through verified completion or an explicit waiting/blocked state. A follow-up in a different channel resumes the same permitted work. This scope owns the control loop and channel semantics; 0004 owns durable execution and receipts, 0005 owns authorization/provider adapters, and 0006 owns knowledge and retrieval. Scope 0001 owns the customer-quality regression cohort and acceptance sign-off. Do not build another runtime alongside the existing one.

Non-goals: frontier-model training, a rewrite of all channel handlers, generic provider CRUD, a second mission queue, a separate memory database or a redesign of the portal. The first release must improve current web chat with compatible paths for email, WhatsApp and voice rather than wait for every API family.

## 2. Current-state evidence required

Map each deployed channel entrypoint to its actual serving runtime, prompts, model calls, identity checks, timeouts, tool loops, context providers and error paths. Inspect both GitHub and deployed source; record mismatches before editing. Metadata inspection confirmed `sandy_runtime_identity_registry`, `sandy_runtime_conversation_audit`, `sandy_mission_runs`, model-routing and operation-registry relations exist. Their correctness, active consumers and latest versions remain unassessed by this scope publication.

Capture at least 50 consented/redacted or synthetic customer scenarios under 0001, including known false incapability claims, lost follow-up context, memory corrections, unnecessary questions, wrong timezone, missing tool calls and misleading acknowledgements. Freeze the failing baseline before prompt or model changes. Reuse established tests; do not repeat already proven tests without a relevant dependency change.

## 3. Target architecture

`channel adapter → verified event/actor → run resolver → context planner + eligible capabilities → model gateway → validated plan/next step → Sandy API → receipt verification → response/commitment/memory candidate`

The Executive Orchestrator is one logical application module with a versioned policy, deployed across bounded workers. Channel adapters normalize transport and formatting; they do not choose independent models, invent permissions or execute provider writes. Each run has one active state owner enforced by the 0004 lease/version contract. Conversation multiplexing may allow independent read-only substeps, but conflicting writes to one entity are serialized or version-checked.

### Request lifecycle

1. Verify provider webhook/session identity, account/tenant binding, attachment handles and deduplication key; persist SC-02 before accepting a message. An email From header or phone number alone cannot bind a privileged user.
2. Resolve the conversation and active mission using explicit references and permitted recent state. “Try again” resumes or reconciles an existing action; it does not create another send. Preserve timezone, company, audience, budget and requested deliverable unless explicitly changed.
3. Classify intent, freshness, risk, complexity, ambiguity and whether a durable mission is necessary. Ask a targeted question only if a consequential target is unresolved and cannot be retrieved. Answer-only turns need not create a long-lived mission but still have a traceable run.
4. Request SC-06 from 0006 and eligible operation contracts from 0005. Search exact identifiers and authorized connected records before declaring absence. Return partial-retrieval/freshness warnings, not a false statement that nothing exists.
5. Choose a model profile using tested compatibility, task complexity, risk, estimated cost, latency budget and available context. Preserve structured response and tool-call IDs. Return tool results and any required provider continuation items using the provider's supported mechanism. Do not record private chain-of-thought as an audit artifact.
6. Validate proposed tool names, schemas, targets, preconditions and authority. A model-generated plan is a proposal; 0005 admits each effect and 0004 records its state. Parallelize independent reads within budget, not dependent writes.
7. Incorporate actual receipts into the next reasoning turn. Detect identical repeated calls, no new evidence, budget exhaustion and contradictions. Bounded escalation may select a stronger eligible model or request assistance; it cannot broaden scopes.
8. Render a concise outcome based on receipts: completed, partial, waiting or blocked. Persist unresolved obligations and the next scheduled action before promising follow-up. Emit memory candidates asynchronously with sources and consent; do not promote them to confirmed facts directly.

### Interruptions and concurrency

A new user correction increments the run/plan version. Work that has not started is invalidated; a running effect is reconciled before reversal. Cancellation revokes future dispatch and requests worker cancellation. Out-of-order channel events may append history but cannot silently resurrect a cancelled plan. A stream disconnect detaches the subscriber; it does not terminate a durable job or trigger a duplicate mission.

## 4. Functional requirements

| ID | Requirement | Observable result |
| --- | --- | --- |
| ORCH-01 | Normalize and deduplicate all supported channel events through SC-01/02 | Replayed webhook creates one run/action |
| ORCH-02 | Resolve follow-up entities and preserve constraints | “Move it an hour” changes the intended event only |
| ORCH-03 | Build authorized, source-linked, token-budgeted context | Retrieved facts and omissions are explainable |
| ORCH-04 | Select and escalate model profiles using measured policy | Simple tasks stay economical; difficult tasks escalate appropriately |
| ORCH-05 | Discover eligible tools dynamically | Connected accounts are recognized; unavailable tools have a precise reason |
| ORCH-06 | Plan, dispatch and continue from real results | Multi-step requests reach actual deliverables |
| ORCH-07 | Reject malformed, unauthorized and injection-induced calls | No provider side effect occurs |
| ORCH-08 | Detect loops and preserve partial progress | No repeated useless calls or invented completion |
| ORCH-09 | Resume and cancel with durable state | Reconnect/crash does not lose accepted work |
| ORCH-10 | Share semantics across channels | Context and permissions remain consistent |
| ORCH-11 | Produce truthful, evidence-grounded responses | “Sent” requires send evidence; “saved” requires persistence |
| ORCH-12 | Record privacy-safe decisions and quality telemetry | Operator can diagnose routing/retrieval/tool failures |

## 5. Contracts and API surface

Operation names are target contracts; map to existing canonical IDs first. All mutations carry SC-04 idempotency/version semantics and SC-01 context.

| Candidate operation | Minimum input | Output / constraints |
| --- | --- | --- |
| `runtime.turn.submit` | channel event ref, conversation ref, requested context | run ID and durable acceptance; never a fabricated completion |
| `runtime.runs.get` | run ID | authorized state, next action, blockers, receipt refs |
| `runtime.runs.events` | run ID, cursor | resumable redacted progress stream with bounded pagination |
| `runtime.runs.cancel` | run ID, expected version, reason | cancellation requested / settled, pending effects retained |
| `runtime.runs.resume` | run ID, trigger ref, expected version | existing run continuation, reconciled before retries |
| `runtime.context.explain` | run ID | source IDs, retrieval omissions and routing summary, no hidden reasoning |
| `runtime.routes.evaluate` | approved fixture ID, candidate route version | engineering-only evaluation; no arbitrary customer impersonation |

Model Gateway interface: `selectProfile(requestContext)`, `invoke(input, compatibleTools, deadline)`, `continue(providerState, receipts)`, `cancel(requestRef)`, `reportUsage(usageRef)`. Profiles are fast, balanced, deep, highest-assurance and modality-specific; exact provider model IDs are resolved and exercised from the current authorized catalogue. Preserve the owner's preference for stronger architecture/complex-reasoning models and efficient routine execution, without assuming a consumer label is a valid API model ID.

## 6. State and storage

Reuse mapped run, conversation and model-decision records. Required fields include run/mission/conversation IDs, channel event dedupe identity, actor/policy reference, run version, selected profile/model/reason, context manifest hash, prompt/handler release, tool-call IDs, receipt refs, budget reservation, continuation reference and terminal state. Secret-bearing provider state belongs in encrypted, access-controlled storage with TTL, not logs or transcripts.

Persist state transitions through 0004; the orchestrator does not directly mark a provider operation successful. Conversation summaries are versioned derived projections, retaining unresolved work and source references. On retrieval/summary failure, degrade with explicit missing context rather than silently treating a truncated summary as complete.

## 7. Runtime deployment and observability

Edge ingress returns promptly after durable admission. Short pure-answer turns may finish inline within a bounded deadline; remaining work moves to the same leased worker path without creating a second run. Do not hold an Edge Function open for an hours-long mission. Use a dedicated worker pool for code/browser/media workloads; general reasoning orchestration does not share unrestricted production secrets with those sandboxes.

Record per-stage p50/p95 latency, time to first useful response, model costs, tool eligibility misses, invalid-call rate, unsupported claims, abandoned runs, repetition rate and user interventions. Proposed pilot admission gate: p95 durable acceptance within 2 seconds, excluding provider ingress delay; streaming should show useful progress within a configured 5-second budget or disclose the waiting state. Measure answer quality separately from speed.

## 8. Verification

Tests ORCH-T01 through T12 correspond to ORCH-01 through 12. Include at least: replayed message; mixed-tenant context; ambiguous recipient; model timeout after external write; repeated tool call; unavailable connection despite stored OAuth association; revoked grant mid-run; interrupted stream; explicit user correction; voice-to-web continuation; token/context truncation; and erroneous handler success envelope. Use production-like receipts and authorized provider canaries where effects are involved.

The frozen 0001 cohort must meet Master §17.3 pilot thresholds: at least 95% adequate answers, 98% correct routine tool selection and 95% supported retrieval citations, with denominators and scoring rubric recorded. All critical authorization/tenant/false-completion/duplicate-side-effect cases pass. A smaller focused regression set cannot replace the full acceptance cohort. SAT-03, SAT-06–09, SAT-17, SAT-19 and SAT-20 must be traced to tests.

## 9. Implementation sequence and dependencies

ORCH-M1: map serving paths and reproduce failures; add tracing without changing answers. ORCH-M2: establish SC-01–06 interfaces using existing API, run and memory implementations; add the single context/model/tool loop behind a tenant flag. ORCH-M3: shadow read-only web turns, then authorized web canary; compare quality, cost and latency. ORCH-M4: migrate email, WhatsApp and voice adapters incrementally, proving continuity. ORCH-M5: retire old write paths only after no consumers and tested rollback.

0004/0005/0006 provide narrow foundation interfaces; their entire scopes need not finish before ORCH-M2. 0001 failure remediation proceeds immediately. Interface incompatibility is a shared-contract defect, not a reason to create another runtime.

## 10. Release, rollback and completion evidence

Capture prior serving revision and route map, forward-compatible migrations, flags, tenant cohort, evaluation version and signed/restricted artifact references. Roll back routing to the previous compatible module while preserving queued state and new receipts; drain or fence workers first. Disable automatic writes on a detected permission, duplicate-effect or false-completion regression. Never replay all accepted events as rollback.

Deliver deployed-source inventory, control-loop tests, route decisions, baseline/after scorecards, per-channel canary traces, failure-injection evidence, rollback exercise and registry mappings. Status remains DRAFT until requirements review; VERIFIED requires actual customer-facing acceptance, not this document's publication.
