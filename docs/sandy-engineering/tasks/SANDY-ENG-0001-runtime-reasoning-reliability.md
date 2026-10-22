# SANDY-ENG-0001 — Chat reasoning and agent runtime reliability

Version: 1.2 — explicit autonomous infrastructure acceptance, 22 October 2026
Status: DRAFT  
Priority: P0  
Owner: Sandy Engineering / Codex  
Master Scope: sections 4–7, 10, 12–13, 17–19 and v1.1 amendment AC-01, AC-02, AC-03, AC-05, AC-08, AC-10; v1.2 Amendment B
API Scope: #1–11, #17, #22, #26–43, #47–52, #67–68, #74 and #160, plus relevant customer-operation families

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


## Existing obligation — autonomous infrastructure and server administration

Autonomous Google Cloud infrastructure and Linux/Windows server administration is explicitly included in this existing workstream. Sandy must provision, configure, install approved software, deploy, monitor, diagnose, repair and roll back infrastructure within preauthorised resource, operation-class, risk and cost boundaries. This clarifies the existing API families and Master Scope AC-03/AC-08 and Amendment B; it does not create a new project or confer new provider permissions.

Routine actions inside a current standing delegation proceed without individual owner approval. Independently enforced controls must validate authenticated identity, tenant, target project/VM, permitted command or artifact, risk, budget/quota, expiry and revocation at dispatch and after waits. The acting workload cannot establish or enlarge its own authority. IAM/security-policy expansion, destructive production changes and unbounded costs require a separately established restricted policy or fail closed. Provider IAM and branch/environment protections remain effective. Record policy authorization rather than inventing owner sign-off.

0001 owns the end-to-end reasoning and truthful-outcome acceptance below. [0005](SANDY-ENG-0005-api-mcp-engineering-delivery.md) owns reusable provider adapters, API/MCP contracts, scoped authorization, authenticated computer access and release/recovery. 0003 owns orchestration, 0004 durable execution/receipts and 0002 the isolated computer experience; 0011 consumes that computer layer for browser skills. Reuse their implementations and evidence, without another executor, queue, registry expansion or software-specific MCP operation.

### Infrastructure acceptance cohort (extends the existing evaluation program)

| ID | Required real outcome and independent evidence |
| --- | --- |
| INF-01 | On an explicitly authorised test resource and within existing budget policy, provision or reconcile GCP VM/disk/network configuration; read back provider IDs and intended state; repeat the same idempotent request without creating duplicates. Verify ownership and pre-existing customer resources are preserved. |
| INF-02 | Through authenticated MCP → Sandy API → supported SSH/OS Login/IAP, execute Linux `whoami`, return actual guest identity, stdout/stderr and exit code, then disconnect. Sandy runtime uses the same API boundary directly. Prefer permitted private connectivity; verify host identity and target-bound tunnel authority. |
| INF-03 | Repeat harmless identity execution on Windows through supported authenticated PowerShell/WinRM or a properly enrolled agent; verify output/exit code, host identity, current agent generation/heartbeat where used and session termination. A registered handler or stale heartbeat is not a pass. |
| INF-04 | On approved Linux and Windows canaries, transfer a checksummed fixture, install/configure approved software, deploy and manage a test service, inspect logs/health, induce a bounded reversible fault, repair it and independently verify service recovery. Preserve configuration/package provenance and capture a compatible rollback artifact before mutation. |
| INF-05 | Roll back the canary deployment/configuration and verify the expected prior health and file/service state. Exercise interruption/resume, cancellation, timeout and uncertain provider outcomes through existing durable jobs; reconcile before retry and prove no duplicate mutation. |
| INF-06 | Exercise an isolated graphical/browser session with a harmless permitted interaction and observable screenshot/artifact; verify resume/termination and tenant separation. This uses the generic computer layer, with no video deployment dependency. |
| INF-07 | Demonstrate routine delegated lifecycle steps without approval clicks, plus wrong-target/tenant, expired/revoked grant, forbidden command/artifact, source mismatch, over-budget and unauthorised privilege expansion denials. An independent deterministic policy/verifier gates dispatch and completion; model judgement alone cannot authorize or certify an effect. |

For each case, retain source revision, deployed handler version, caller/grant version, target, input digest, job/admission/receipt IDs, provider observation, redacted output, exit code where relevant and recovery result. Track implemented contracts, deployment, MCP execution, authorised dispatch and functional verification separately. Reuse still-valid receipts and existing API-T09 tests rather than rerunning completed work; new lifecycle assertions require their own real evidence. Accepted jobs and API exposure flags do not satisfy these cases.

### Known gaps and dependency handling (22 October 2026)

The current evidence remains [implementation status](../../sandy-api/implementation-status.md) and the [161-family matrix](../../sandy-api/requirement-coverage-current.json). Generic Linux/Windows/graphical access acceptance remains **0/3**; INF-01–07 are requirements, not completed tests. The currently deployed engineering GCP delegation permits metadata reads, not unrestricted infrastructure mutation or server administration. A legitimate administrator must establish any additional bounded operation-class/resource/risk/cost grant; this clarification cannot self-expand it.

Candidate SSH/IAP/WinRM code is not a verified administration platform. Remaining software includes production transport activation, file/package/service lifecycle, guest enrollment and isolated graphical session lifecycle. IAP error **4033 NOT_AUTHORIZED**, target policy reads HTTP 403 and stale Windows heartbeat are distinct access dependencies; see the existing [IAP blocker](../../sandy-api/iap-access-blocker-20261021.md). Apply only legitimately authorised minimal target/port policy repairs; do not add public IPs, disable host controls or repeatedly probe unchanged denials. Provider entitlement, authority, implementation and functional failures remain separate. Continue independent API/provider work while these dependencies are unresolved.
