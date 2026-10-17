# Sandy V2 — Autonomous Intelligence Architecture

Status: **incremental live upgrade**, shadow-mode control plane; **not** full V2 completion.

## Invariants

1. Sandy owns identity, memory, goals, execution state, verification and learning.
2. External models (OpenAI/Google/Anthropic) are **replaceable reasoning resources**, not sources of truth about Sandy's database, customer permissions or deployed abilities.
3. Every request must be scoped to a *server-authenticated* customer; company workspaces are checked against that identity.
4. Connection states: recorded active, provider-confirmed active, not confirmed, unknown. **A connection is not an executable tool.**
5. Provider claims, source files, configured flags and deployment/actual execution receipts are different evidence classes.
6. Never publish customer content or connection identifiers to public GitHub engineering issues.
7. V2 initially shadows V1 routing. Promotion requires benchmarks and regression tests, and authoritative outcomes—not model confidence.
8. Autonomous engineering uses existing GitHub/Supabase workflow and risk gates, not unrestricted production mutation.

## Existing components reused

- `sandy-agent-runtime`: v34 adds deterministic scoped connection preflight and audit (V2 shadow).
- `sandy-composio-gateway`: v23 adds authenticated `v2_awareness` action and provider discrepancy supervisor records.
- `sandy_feature_roadmap`, `sandy_supervisor_findings`, `sandy_capability_catalog`, `sandy_ai_integrations`, `sandy_composio_connections`, `sandy_autonomous_engineering_cycles`.
- `ai_model_registry`, `ai_task_routes`, model evaluation and execution logs.
- Existing QA, GitHub Codex/Architect dispatcher, feature discovery and production verifier.

## New database control plane

- `sandy_v2_runtime_policy`: `executive_runtime`, `adaptive_model_routing`, `automatic_engineering` all start in **shadow**.
- `sandy_v2_awareness_audit`: tenant-scoped assertion outcome and provenance without messages or credentials.
- `sandy_v2_model_decisions`: chosen/default models and reason for future evaluation.
- `sandy_v2_component_inventory`: source-of-truth labelled software/database metadata.
- `sandy_v2_refresh_database_inventory()`: restricted service-role RPC to refresh actual database tables.

## Executive decision sequence

Authenticate -> resolve tenant/workspace -> query live capabilities and connections -> recognise request -> choose verified safe tool/model -> execute -> verify real receipt -> audit -> improve.

For status requests the runtime directly reads Sandy's DB and optionally Composio; it does not ask the language model to guess. For other requests, V2 currently injects scoped factual context and logs model selection. Cross-channel adoption remains a separate work item.

## Integration gateway API

`POST /functions/v1/sandy-composio-gateway` with the customer's Supabase JWT:
```json
{"operation":"v2_awareness","verify_provider":true}
```
For administrator architecture inventory refresh:
```json
{"operation":"v2_awareness","refresh_architecture":true}
```
Returned connection IDs and internal service-role credentials are never exposed. `provider_check=unavailable` does **not** mean disconnected.

## Completion gates before enabling adaptive routing

- Independently test live authenticated user and customer isolation; verify Composio statuses under active, expired, pending and unreachable conditions.
- Verify model routing uses **provider-confirmed available** models, measured task-specific quality and rate limits, not merely registry eligibility.
- Exercise cross-channel status questions in chat, WhatsApp, email and voice.
- Close the full automatic defect -> protected code PR -> tests -> deployment -> independent production verification loop with audit/rollback.
- Test source/deployment drift and prevent silent failures.

Do not call this full V2 production-ready until these gates pass.
