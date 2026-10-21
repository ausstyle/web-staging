# SANDY-ENG-0001 — Chat reasoning and agent runtime reliability

Status: DRAFT  
Priority: P0  
Owner: Sandy Engineering / Codex  
Master Scope: sections 4–7, 10, 12–13, 17–19  
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

## Status and evidence
This is an initial scope document, not proof of implementation. Codex should expand the as-built inventory and acceptance fixtures before changing live runtime paths.
