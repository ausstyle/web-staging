# SANDY-ENG-0013 — Sandy Mail implementation and acceptance

Status: IMPLEMENTING (local first-ingest foundation; deployed acceptance blocked)  
Version: 1.0  
Priority: P2 product; user-directed first milestone is database structure and synthetic first email  
Owner: Sandy Mail workstream; API/infrastructure retain shared release ownership  
Created: 2026-10-24  
Master: §§3, 10, 12, 17–19; amendments A/B  
Authority: [complete Sandy Mail scope v1.0](../../sandy-mail-architecture-engineering-scope-v1.md), PR #239 at `b1d499f8dd946b6fda11e0cfcaa1f508ec435a08`

This task implements the saved scope; it does not invent a replacement architecture. Cloud SQL is hosted mailbox truth, GCS stores immutable originals/attachments/intake records, and existing internal Supabase remains untouched.

The first concrete slice is [`services/sandy-mail`](../../../services/sandy-mail): two transactional/checksummed initial migrations, Go ingest/retrieve/recover, synthetic-only canary runner, and real local PostgreSQL isolation/idempotency/fault tests. Live Cloud SQL/GCS provisioning and identity are unverified; connector discovery exposed no relevant resource inventory action. Existing connected Microsoft/Gmail providers remain authoritative and unaffected.

Shared boundaries: 0005 owns canonical authenticated API/release integration, 0004 generic receipts/events, 0006 AI/memory, 0012 its separate Cloud storage product. Hosting/DNS and Runtime concurrent workstreams retain their resources. Mail outbox is transactional domain-event state, not a second mission engine. No shared handlers, internal Supabase migrations or deployment jobs are added.

[Acceptance matrix](../../sandy-mail/acceptance.md) maps every saved scope section to delivered tests and remaining work. [Deployment request](../../sandy-mail/deployment-request.md) records exact target discovery, scoped resource diff, conditional costs/permissions and non-destructive rollback. Local results cannot mark production verified. No Mail registry capability is promoted.

Safety/rollback: no live SMTP/MX, real mailbox imports, external mail, shared-resource replacement, irreversible deletion, paid commitment or persistent IAM/credential expansion. Stop the canary consumer and retain SQL/originals; replay the same delivery identity or forward-repair migrations. Existing mail service remains active. A future public API must bind scope to canonical identity before invoking the internal package; customer SQL access is prohibited.

Completion requires the scope’s full portability, security, recovery, client, operational and independent acceptance gates, not just this first local milestone. Source branch: `feat/sandy-mail-first-ingest`; new PR begins in draft.
