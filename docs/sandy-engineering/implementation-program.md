# Sandy engineering implementation program

Version: 1.1 · 21 October 2026 (addition of 0011; P0 priority unchanged)  
Governing design: [Master Scope v1.1](master-scope-v1.md), including amendment section 22  
Shared implementation contracts: [architecture-contracts.md](architecture-contracts.md)  
Source catalogue: [scopes.json](scopes.json)

## 1. Immediate product priority

Fix Sandy's current chat reasoning, context use, tool selection, truthful completion and continuity before expanding feature or operation counts. SANDY-ENG-0001 is the P0 acceptance program. The supporting implementations have distinct owners so Codex does not create duplicate orchestrators, mission queues or knowledge stores.

These are engineering specifications, not evidence that the software is complete. DRAFT means the target design is published for as-built reconciliation and engineering review. Writing, committing or synchronizing a scope must not mark its implementation VERIFIED. The Master Scope remains v1.1; the filename `master-scope-v1.md` is retained for stable links.

## 2. Complete scope index

| ID | Scope | Priority | Owns |
| --- | --- | --- | --- |
| [0001](tasks/SANDY-ENG-0001-runtime-reasoning-reliability.md) | Chat Reasoning and Runtime Reliability | P0 | Failure baseline, quality cohort, evaluation and customer-facing acceptance |
| [0002](tasks/SANDY-ENG-0002-always-on-autonomy-dots-parity.md) | Always-On Autonomy and Competitive Parity | P1 | Integrated autonomy benchmark, isolated computer execution and proactive policies |
| [0003](tasks/SANDY-ENG-0003-unified-executive-orchestrator.md) | Unified Executive Orchestrator | P0 | Turn lifecycle, planning, model routing, context assembly and channel semantics |
| [0004](tasks/SANDY-ENG-0004-durable-missions-truth-engine.md) | Durable Missions and Truth Engine | P0 | Durable jobs/steps, leases, commitments, receipts, recovery and compensation |
| [0005](tasks/SANDY-ENG-0005-api-mcp-engineering-delivery.md) | Sandy API, MCP and Engineering Delivery | P1; P0 foundation slice | Shared authorization/contracts, provider execution and safe source-to-release path |
| [0006](tasks/SANDY-ENG-0006-memory-world-model.md) | Memory and World Model | P1; P0 context slice | Entity knowledge, provenance, ACL-filtered retrieval and corrections |
| [0007](tasks/SANDY-ENG-0007-calendar-two-way-sync.md) | Two-Way Calendar Synchronization | P2 | Deterministic Google/Outlook sync, subscriptions, conflict and recurrence handling |
| [0008](tasks/SANDY-ENG-0008-video-conferencing-livekit.md) | Video Conferencing and LiveKit | P2 | Media-plane delivery, rooms/invites, consent and real meeting acceptance |
| [0009](tasks/SANDY-ENG-0009-customer-experience-portal.md) | Customer Experience and Portal | P2; P0 defect fixes | Stable UI, evidence-backed views, scope management and customer interactions |
| [0010](tasks/SANDY-ENG-0010-commercial-infrastructure-readiness.md) | Commercial Infrastructure and Readiness | P3; immediate safety baseline | Tenant lifecycle, entitlements, usage, support and production readiness |
| [0011](tasks/SANDY-ENG-0011-browser-workflow-learning.md) | Passive & Active Browser Learning and Verified Skill Execution | P1; P0 foundations | Chrome opt-in observation, discovery, Skill IR and versioning, active teaching and learning from verified browser execution |
| [0012](tasks/SANDY-ENG-0012-sandy-cloud-drive-backup.md) | Sandy Cloud — Drive, Computer Backup and Intelligent Files | P2; safety gates from day one | File storage/sync, independent snapshots, restore and ACL-filtered AI; design in [Sandy Cloud architecture](../sandy-cloud/architecture.md) |

Scope 0011 depends on 0002 for isolated computer execution, 0004 for durable Missions/receipts, 0005 for authorization/provider paths and 0009 for the user experience. It does not create independent versions of these services. Observation/compilation fixtures may progress independently without delaying P0 runtime fixes. No learned candidate is automatically an approved, verified action.

Scope 0012 is a new, separate product workstream. Its file/backup data-plane owner is 0012, while it reuses 0005 API identity and release boundaries, 0004 receipts, 0006 knowledge, 0009 customer UI and 0010 billing. It does **not** displace the P0 runtime program or claim Cloud SQL/GCS production availability; its current Supabase Files service and stored references remain authoritative until a tested, approved cutover.

The API scope remains a separate parent-level technical specification, not an eleventh independent product task. Its 161 requirement families may map to many concrete operations. Scope 0005 owns their execution reconciliation; scope 0001 owns whether Sandy can actually use relevant operations intelligently.

## 3. Dependency design — no artificial all-or-nothing gate

Task priorities are not a strict waterfall. Release gates depend on concrete interfaces and tested slices, not on an entire neighboring program being finished.

**Foundation F0:** authoritative actor/membership context, operation/result schemas, evidence envelope, release provenance and shared contract tests. Owned by 0005 with 0010 identity policy and 0004 receipts. Establish contracts first without inventing new production identities.

**Foundation F1:** durable admission, single-step leases/idempotency, unknown-outcome reconciliation and watchdogs. Owned by 0004. It can be tested with a deterministic fixture and the existing API before the new orchestrator exists.

**Foundation F2:** permission-filtered exact retrieval, context manifest and immediate corrections over existing memory. Owned by 0006. It does not require the complete World Model.

**P0 vertical slice:** 0003 uses F0–F2 for a real web-chat request from verified identity to evidence-backed answer/action, interruption and resume. 0001 measures the frozen failure cohort. Fix proven defects as soon as bounded regressions pass; do not wait for the entire refactor. Migrate email, WhatsApp and voice incrementally after the first path works.

**P1 expansion:** complete mission DAG/waits/commitments, context/World Model enrichment, renewable engineering identity, broader API/MCP certification, then 0002 computer/proactive autonomy. Scope 0011 adds site-consented passive/active skill discovery and a verified skill executor, gated on these existing computer/Mission/API foundations. The existing API program continues only where it supports these dependencies or uses genuinely independent component ownership.

**P2 features:** calendar sync depends on source account authorization, provider adapters and reliable outbox/worker slices, not completion of all reasoning work. Video depends on verified guest access/release/identity and media topology; native room tests do not wait for calendar UI. Portal sections can progress against stable contracts but remain hidden or labelled unavailable until real backend acceptance.

**P3 launch:** commercial launch requires proven critical identity/isolation, spending, operational and recovery gates. These security foundations apply from day one, not only when billing ships.

## 4. Milestone dependency matrix

| Milestone | Needs | Does not need |
| --- | --- | --- |
| Runtime baseline and safe fixes | Existing source/state access, 0001 fixtures | Every provider operation, video, billing |
| Orchestrator canary | F0–F2, one tested channel/tool path | Full World Model or every channel migrated |
| Unattended Missions | F0/F1, bounded planner integration | Browser UI automation |
| Calendar bidirectional canary | Calendar OAuth fixtures, F0/F1, provider event contracts | Full 161-family certification |
| Video media proof | Verified VM command path, approved networking, room auth | Full calendar synchronization or third-party embedding |
| My World UI | 0006 source/correction APIs | New graph database |
| Scope Manager | Existing scope catalogue/API, safe Git change and sync path | Full customer billing |
| Paid pilot | Critical safety suite, approved pricing, meter/entitlement/recovery proof | Unsupported vendor features or unbounded capacity |

No task may satisfy a dependency by weakening authorization, faking a provider receipt, creating a parallel data owner or changing exposure flags without a real handler.

## 5. Architecture and migration discipline

Use a modular TypeScript core and shared domain contracts, preserving Supabase and existing customer state. Edge ingress remains bounded; long-running work lives in leased workers; media lives on a separate plane. A logical module does not require its own Edge Function or microservice. Avoid proliferation of generated handlers, queues and databases without a measured reason.

Every physical schema/path choice is mapped against production before coding. The 21 October metadata inspection confirmed existing calendar connections/events/links/outbox/sync jobs, mission runs/decisions/questions/work products, memory/settings/audit/voice facts, runtime/model metadata, operation/admission records and guest enrollment/jobs. It did not certify those implementations. Reuse and repair them where suitable.

One owner releases each shared component at a time. Parallel Codex tasks use isolated branches, pinned interface versions and an integration/release owner. A task changing a shared contract must update its compatibility tests and notify dependent scopes through the shared documentation/issue workflow; it cannot silently deploy over another branch's code. Release locks and optimistic base-SHA checks prevent overwrite.

## 6. Work package format and definition of done

For each implementation slice, record scope/requirement IDs, current failing evidence, proposed bounded change, source paths and live versions, migration/contract impact, credentials/fixtures by name only, risks, test plan, staging/canary plan and rollback. Use the task template and [acceptance evidence template](templates/acceptance-evidence.md).

A slice can be merged while still unverified, but must say so. A VERIFIED feature requires relevant deterministic and real provider/customer tests, current deployed source parity, permission/tenant/duplicate-effect tests, operational monitoring and recovery proof. A blocked provider entitlement or unavailable test identity is a named dependency, not a pass or a reason to stop unrelated work.

Reconcile requirements, implementations and operational evidence separately. Never report `161 minus registry-count` as remaining work. Record both broad-scope completion and the concrete tested slice so substantial progress is visible without overstating full certification.

## 7. Shared sources and Supabase synchronization

Canonical files are in GitHub; `scopes.json` contains the Master, API and ten engineering scope records. A source change merged to main triggers the existing OIDC-authenticated scope sync. The catalogue stores immutable source commit, content checksum and sync time. The latest successful sync is checked after this publication; it is not a deployment of the systems described here.

Supporting architecture/program/template files are linked from each numbered scope. To reproduce a design, read those relative paths at the scope's same pinned Git commit, not arbitrary current main. No customer data or secrets belong in the documentation repository. Additional tasks use a new scope ID and manifest entry; do not clone a competing Master Scope.

## 8. Codex start instruction

Read AGENTS.md, the Master Scope v1.1, this program and the shared contracts. Start SANDY-ENG-0001's reproducible runtime failures. Implement the minimum 0003/0004/0005/0006 slices needed to fix those failures, preserving current working routes. Run real customer-facing canaries and record evidence before expanding. Continue approved independent work, but do not substitute more API mappings, another architecture rewrite or cosmetic UI work for measured reasoning and execution reliability.

## 9. Design confidence and unresolved decisions

This design optimizes for existing Supabase investment, minimal competing state, safe concurrency, repairable migrations and visible evidence. It is not a mathematical proof of global architectural optimality. Codex must still measure current topology/load, provider entitlements, credential capabilities, actual source parity, retention rules and recovery capacity. Record justified deviations as ADRs linked to the applicable Master requirement; do not silently revise the product architecture.
