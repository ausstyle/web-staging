# SANDY-ENG-0002 — Always-On Autonomy and Dots Competitive Parity

Version: 1.1 — bounded ownership and worker architecture, 21 October 2026  
Status: DRAFT  
Priority: P1, with P0 dependencies  
Owner: Sandy Engineering / Codex  
Master Scope: §22 Amendment A and §§4–7, 10, 12–13, 17–19  
API Scope: selected existing requirements, not a competing API registry

## Objective
Implement Sandy's user-visible always-on agent capabilities against the Master Scope's competitive benchmark where possible, and differentiate in multi-company executive administration. Preserve all working Sandy services. Claims about another product must be sourced from current official public documentation; this scope is not evidence of its undisclosed architecture or of Sandy's parity.

## Current production baseline
Codex must inspect deployed Supabase handlers, routing, agent runtimes, missions, connected applications, browser/computer workers and authentic production verification artifacts. Do not equate registered API mappings, benchmark aspirations or mock tests with working features.

## Work packages and delegated owners
- AC-01 Unified model orchestration and reasoning: 0001 acceptance and 0003 implementation.
- AC-02 Durable, unattended, recoverable Missions: 0004.
- AC-03 Per-customer isolated cloud browser/computer: this scope, using 0005 infrastructure access and 0004 job durability.
- AC-04 Opt-in read-only proactive intelligence: this scope, using 0004 commitments and 0006 retrieval.
- AC-05 Evidence-linked World Model and customer correction: 0006.
- AC-06 Customer connection discovery and Sandy API execution; MCP via API: 0005.
- AC-07 Omnichannel continuity: 0003 with 0006 identity/context.
- AC-08 Autopilot permissions, custom rules, budgets, revocation and audit: 0005 policy, 0004 execution and 0009 controls.
- AC-09 Sandy Daily, Companies and My World: 0009 on shared domain records.
- AC-10 Verified side effects and Proof of Completion: 0004.
- AC-11 Examiner/Evolution outcome evaluation: 0001 quality program, 0005 controlled delivery; no independent production self-modification.
- AC-12 Tenant, privacy, reliability and cost readiness: 0010.

Read the [implementation program](../implementation-program.md) and [shared contracts](../architecture-contracts.md). This is the autonomy integration/benchmark owner, not a reason to implement another orchestrator, mission store or memory graph.

## Comparative benchmark
Maintain a dated matrix citing public provider documentation, not prior unsourced conversation claims. For unavailable direct competitor tests, use supported published functionality as a target and mark the comparison untested. Test 20–30 common authorized tasks for accuracy, completion, interventions, latency, cost and failed/duplicate effects. Record the actual model/service versions and environment conditions. Do not claim parity from matching feature names.

## Isolated computer-worker architecture

The worker lifecycle is provisioned → ready → leased → running → waiting-for-user/provider → reconciling → completed/failed → cleaned or securely suspended. The job/lease state is owned by 0004; this module owns sandbox provisioning policy, browser/application session handling, command/action translation, visual/DOM observation and artifact capture.

Prefer an authorized API before graphical automation. A fallback computer is per-tenant isolated with explicit session/account binding, bounded CPU/memory/time/storage, denied production-secret access and restricted egress. Use immutable worker images, ephemeral credentials, encrypted retained browser state where consent permits, signed workload identity and a one-job lease. No shared browser profile between customers or uncontrolled access to the engineering host.

Expose computer-session create/status/pause/revoke and task execute/result/artifact contracts through Sandy API. A task declares the objective, permitted applications/origins, expected side effects, account, budget, artifact rules and consent. Browser observations are untrusted data. Page content cannot expand the allowed destination, retrieve another tenant's file, authorize a purchase or rewrite policy. Downloads are quarantined and checked before entering shared storage or model context.

A required login, MFA challenge or consequential ambiguous action yields an explicit WAITING_CUSTOMER handoff through a secure interface. Do not request passwords or session secrets in chat, disable MFA or bypass provider access controls. Resume the same task after verified handoff. Preserve intent/correlation markers and reconcile uncertain clicks/submissions before repeating them, just as with API timeouts.

Capture only privacy-permitted redacted screenshots/action metadata and real resulting artifacts. A successful click is not proof of a submitted form or completed transaction. Reopen/read back output and record a receipt. Stop promptly on revocation; close access and clean temporary data according to retention policy.

## Proactive intelligence architecture

Deterministic watchers identify changes to authorized inbox/calendar/commitment/provider state, store deduplicated signals and schedule bounded analysis. Reuse existing subscriptions and cursors; do not poll every account with an LLM. A relevance/risk policy selects useful items and a model may synthesize a source-backed briefing. Proactive research is read-only by default; any outgoing message or other side effect requires a separate specific standing delegation or approval through 0005.

Represent signal source/time, affected entity/commitment, urgency, expiry, suppression, notification policy and evidence. Deduplicate by source/change and customer intent; respect quiet hours, snooze, opt-out and channel preference. A briefing links what changed, why it matters, what is already verified and which decision remains. Distinguish an inferred opportunity from a recorded obligation. Follow-through is a 0004 commitment/mission, not another autonomous loop.

## Security, non-goals and constraints
Do not self-host a frontier model as a prerequisite. No unrestricted host access, cross-tenant memory, consumer-token bypass, unapproved financial transfer or uncontrolled engineering change. Preserve versioned API contracts, consent, Engineering Control and rollback. New paid computer capacity requires budget authorization. Optional local computer access requires explicit installation/consent and the same job/permission controls; it is not a prerequisite for cloud-worker acceptance.

## Acceptance
All applicable Master §22.4 gates require real evidence. Specifically: at least 10 authorized browser/desktop workflows with interruption, credential handoff, artifact readback, isolation and revocation; at least 10 proactive triggers with relevance, deduplication, opt-out and no unauthorized writes; at least 20 durable multi-step mission scenarios from 0004; at least 10 cross-channel handoffs from 0003/0006. Critical permission, duplicate-effect and false-completion cases all pass.

AUT-T01 sandbox/tenant separation; AUT-T02 crash/resume and uncertain submission; AUT-T03 MFA handoff; AUT-T04 page prompt-injection and exfiltration refusal; AUT-T05 download quarantine and real artifact readback; AUT-T06 revocation and cleanup; AUT-T07 proactive signal relevance/deduplication; AUT-T08 read-only enforcement; AUT-T09 quiet-hours/snooze/opt-out; AUT-T10 integrated evidence-backed briefing and follow-up. Use explicitly authorized fixtures and retain test conditions; do not create customer messages or purchases for an unapproved benchmark.

## Delivery and recovery

AUT-M1: benchmark/source verification and actual worker/proactivity baseline. AUT-M2: one isolated read-only browser task with real artifact and cleanup. AUT-M3: secure login handoff, bounded authorized writes and fault recovery. AUT-M4: deterministic source watchers plus useful read-only briefing. AUT-M5: end-to-end autonomy cohort using the shared runtime/mission/memory/API modules.

Rollback disables new watcher/worker admission, fences leases, reconciles in-flight effects, revokes sandbox sessions and preserves receipts. It does not delete the mission ledger or assume external actions can be undone. New worker image or proactive policy releases require canaries and a kill switch independent of the model.

## Completion tracking
Current state DRAFT; no feature is complete merely because this document exists. Add source paths, production versions, test IDs, actual provider/computer receipts and limitations using the [acceptance evidence template](../templates/acceptance-evidence.md). Do not introduce duplicate orchestrators, tools, queues or customer stores.
