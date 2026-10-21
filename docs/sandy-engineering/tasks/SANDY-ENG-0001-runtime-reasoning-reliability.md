# SANDY-ENG-0001 — Chat reasoning and agent runtime reliability

Version: 1.1 — scope ownership and delivery coordination, 21 October 2026  
Status: DRAFT  
Priority: P0  
Owner: Sandy Engineering / Codex  
Master Scope: sections 4–7, 10, 12–13, 17–19 and v1.1 amendment AC-01, AC-02, AC-05, AC-10  
API Scope: #1–11 and #160, plus relevant customer-operation families

## Objective
Make Sandy's chat, reasoning, model routing, context retrieval, tool selection, execution verification and follow-through trustworthy across web, email, WhatsApp and voice. Preserve working V1 services.

## Baseline investigation
Map every live channel entrypoint to the actual deployed runtime and model gateway. Collect real examples of mistaken reasoning, incomplete answers, capability hallucinations, memory failures, missed tool calls, dropped follow-ups and false success acknowledgements. Record IDs and redacted traces, not private customer content.

## Required architecture
One accountable Executive Orchestrator; World Model; ACL-scoped Context/Memory; model routing profiles; unified Sandy API Tool Broker and truthful execution receipts; durable Mission/commitment state; Examiner regression loop. Avoid creating a competing runtime.

## Scope
1. Trace ingest → identity → objective → relevant context → model choice → API tool → receipt → response → memory/commitment.
2. Verify canonical capabilities are discovered dynamically through Sandy API, not fabricated from registry counts.
3. Verify exact-search-first retrieval of IDs, dates and factual records; cross-channel continuity with consent.
4. Eliminate duplicated/inconsistent runtime paths through staged compatibility migrations.
5. Measure context quality, reasoning adequacy, tool selection, execution truth and recovery.

## Security and dependencies
Use existing Supabase project `zmqlyygzqoidkcwdysok`; protect tenant isolation, customer authorization, sensitive data, provider rate limits and secrets. Depend on functioning authenticated E2E test identity.

## Acceptance
- SAT-03, SAT-06–09, SAT-17, SAT-19 and SAT-20 from Master Scope pass with real evidence.
- Explicit pilot thresholds from §17.3 measured against a documented reproducible test cohort, with zero false success claims in controlled critical workflows.
- Production version and rollback path recorded; Examiner results show before/after comparison.
- Source and deployment state recorded truthfully; no assertion of completion without actual customer-facing tests.

## Implementation/deployment
Use incremental PRs, migrations and staged releases. Record change register, commit, CI, production function versions and cross-channel provider tests. Do not execute unapproved critical mutations.

## Scope ownership and implementation handoff

This is the P0 quality/acceptance program, not a second implementation of the runtime. Read the [implementation program](../implementation-program.md) and [shared architecture](../architecture-contracts.md). Route defects to these owners while retaining one outcome baseline:

- [0003 Orchestrator](SANDY-ENG-0003-unified-executive-orchestrator.md): request semantics, reasoning/model routing, context assembly and channel/tool loop.
- [0004 Missions/Truth](SANDY-ENG-0004-durable-missions-truth-engine.md): persistence, leases, recovery, commitments and verification receipts.
- [0005 API/MCP](SANDY-ENG-0005-api-mcp-engineering-delivery.md): identity, eligibility, provider execution and release pathway.
- [0006 Memory](SANDY-ENG-0006-memory-world-model.md): source-grounded retrieval, corrections, temporal facts and isolation.
- [0009 Customer experience](SANDY-ENG-0009-customer-experience-portal.md): user-visible failures, lost drafts, progress and session continuity.

Do not defer bounded fixes in the currently serving runtime until a new architecture is entirely built. Deliver the minimum shared-contract slices needed for each failing customer scenario, canary and measure the improvement.

## Reproducible evaluation program

Freeze at least 50 representative cases, stratified across factual retrieval, ambiguous follow-up, connected-app awareness, multi-step action, memory correction, cross-channel continuation and failure recovery. Include a hidden/holdout subset and adversarial permission/injection cases. Each case records authorized fixture, expected result/receipt, scoring rubric, risk, provider assumptions and baseline trace. Reuse prior valid case results when dependencies have not changed; do not count repeated executions as new case coverage.

Evaluate answer adequacy, evidence grounding, appropriate tool/model choice, unnecessary clarification, completion, user interventions, latency and cost. Human-reviewed labels or independent deterministic verifiers decide critical correctness; the same model must not grade its own side effect as successful. Publish denominators, case changes and confidence/variability rather than one unexplained score.

Release gates remain the Master pilot targets plus 100% critical tenant/permission/idempotency tests and zero false critical completion claims. A regression in a critical invariant blocks release even if average answer quality improves. A provider outage is classified separately but cannot be counted as a completed customer outcome.

## Status and evidence
This is a design/acceptance specification, not proof of implementation. Codex must expand the as-built inventory and fixture evidence before changing live runtime paths. Use the [acceptance evidence template](../templates/acceptance-evidence.md) for baseline, source revision, deployment, actual outcomes and rollback. DRAFT is not a request to repeat planning indefinitely: begin authorized inspection and bounded corrective work, while recording review and release gates truthfully.
