# Sandy Engineering Constitution (v1)
Last reviewed: 2026-10-19

## Mandatory invariants
- SANDY-TASK-001: Check live, owner-scoped task state before reporting a task exists or has moved. Historical chats are not proof.
- SANDY-FILE-001: Do not acknowledge an attachment as saved until verified storage plus task-file association are durable. Include a receipt reference.
- SANDY-TASK-002: Deleting a parent requires an explicit child-handling selection. Preserve audit evidence and provide recoverable deletion for important records.
- SANDY-EMAIL-001: A successful email acknowledgement must reflect actual operation results; failures must be explicit, without false claims.
- SANDY-SEC-001: Never trust a customer_id or file ID supplied by an LLM without server-side ownership verification.
- SANDY-DEPLOY-001: A production hotfix must be reconciled into private canonical backend source before the next deployment. Never overwrite a newer production function with older code.
- SANDY-DEPLOY-002: Record release commit, Edge Function versions, migrations, and regression evidence. A source-only build is not sufficient verification.

## Deployment gate
The CI check in `.github/workflows/sandy-governance.yml` verifies policy shape and regression-case coverage on changes to governance files. It DOES NOT verify live Supabase behaviour or prevent direct dashboard deployments. Production promotion must additionally run the private backend integration tests and compare Edge Function source hashes before deploying.

## Incident: 2026-10-19, Teeth
Two task rows were deleted on 2026-10-17. On 2026-10-19, an email reply falsely asserted that dental attachments had been filed. Production email-ai-generate-draft v92 added a final database-backed safeguard, which must be reconciled into the private canonical source. The filing operation and task recovery remain unverified. Do not mark this case fixed end-to-end until simulated and real delivery tests pass.

## Change process
Every confirmed incident gets a stable rule ID, a reproducible regression fixture, and a release record. A future model, engineering agent or human developer must read this file first, make the smallest change, run applicable tests, and keep existing rules intact.
