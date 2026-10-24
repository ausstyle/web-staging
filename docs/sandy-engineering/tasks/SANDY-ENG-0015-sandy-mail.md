# SANDY-ENG-0015 — Sandy Mail implementation and acceptance

Status: IMPLEMENTING (local first-ingest foundation; deployed acceptance blocked)  
Version: 1.4
Priority: P2 product; user-directed first milestone is database structure and synthetic first email  
Owner: Sandy Mail workstream; API/infrastructure retain shared release ownership  
Created: 2026-10-24  
Master: §§3, 10, 12, 17–19; amendments A/B  
Authority: [complete Sandy Mail scope v1.0](../../sandy-mail-architecture-engineering-scope-v1.md), PR #239 at `b1d499f8dd946b6fda11e0cfcaa1f508ec435a08`

This task implements the saved scope; it does not invent a replacement architecture. Cloud SQL is hosted mailbox truth, GCS stores immutable originals/attachments/intake records, and existing internal Supabase remains untouched.

The first concrete slice is [`services/sandy-mail`](../../../services/sandy-mail): three transactional/checksummed first-canary migrations, Go ingest/retrieve/recover, synthetic-only canary runner, and real local PostgreSQL isolation/idempotency/fault tests. Follow-on migration 0004 implements resumable offline import records; MBOXrd/EML/Maildir workers preserve master archives, checkpoint receipts and reconcile counts/hashes. These optional import grants are separate from the preserved first-email artifact. Live Cloud SQL/GCS provisioning and identity are unverified; connector discovery exposed no relevant resource inventory action. Existing connected Microsoft/Gmail providers remain authoritative and unaffected.

Shared boundaries: 0005 owns canonical authenticated API/release integration, 0004 generic receipts/events, 0006 AI/memory, 0012 its separate Cloud storage product. Hosting/DNS and Runtime concurrent workstreams retain their resources. Mail outbox is transactional domain-event state, not a second mission engine. No shared handlers, internal Supabase migrations or deployment jobs are added.

[Acceptance matrix](../../sandy-mail/acceptance.md) maps every saved scope section to delivered tests and remaining work. [Deployment request](../../sandy-mail/deployment-request.md) records exact target discovery, scoped resource diff, conditional costs/permissions and non-destructive rollback. Local results cannot mark production verified. No Mail registry capability is promoted.

Safety/rollback: no live SMTP/MX, real mailbox imports, external mail, shared-resource replacement, irreversible deletion, paid commitment or persistent IAM/credential expansion. Stop the canary consumer and retain SQL/originals; replay the same delivery identity or forward-repair migrations. Existing mail service remains active. A future public API must bind scope to canonical identity before invoking the internal package; customer SQL access is prohibited.

Completion requires the scope’s full portability, security, recovery, client, operational and independent acceptance gates, not just this first local milestone. Source branch: `feat/sandy-mail-first-ingest`; new PR begins in draft.

Catalogue reconciliation: main assigned SANDY-ENG-0013 to Accounting at `f3198b1`. Mail's previously unmerged entry moves to SANDY-ENG-0014; Accounting is preserved. Historical Mail evidence/source pins are unchanged. Follow-on migration 0005 adds resumable snapshot exports with mandatory canonical authority checks and explicit exclusions; customer-facing identity/scanner/encrypted-delivery integration remains pending.

At main `a08f969d7b65a329c743428f557a514a14479bcb`, My Voices owns SANDY-ENG-0014. This still-unmerged Mail task now uses SANDY-ENG-0015; both My Voices and Accounting are preserved. The saved Mail architecture and first-email pins are unchanged.

Local follow-on: migration 0006 implements draft and organization facts with forced RLS, expected revisions and transactional idempotency receipts. The local UI saves/reopens drafts, creates flat folders/labels, moves messages and filters by those collections. It has no send operation. Migration 0007 adds lossless typed draft archives and resumable receipt-bound restoration. Explicit source-to-destination flat folder/label mapping restores organization transactionally; missing mapping remains an accounted exception. Arbitrary provider hierarchy conversion and customer-facing authority/scanner/delivery integration remain unfinished.

Migration 0008 preserves complete native collection inventories, empty folders/labels and parent relationships through bounded/resumable export/import. Folder creation and the local UI support nested parents (200 total collections, depth 32); sibling names are unique. Explicit restore creation or a complete destination map is part of the admitted import specification, with atomic graph/receipt creation, immutable source inventory, restart reconciliation and per-collection loss counts. Provider-specific hierarchy/PST conversion remains unverified. [Runtime custody compatibility review](../../sandy-mail/scanner-custody-review.md) identifies exact API/scanner/transaction dependencies at PR303 ab2cfa4; no trust or schema from that proposal is activated. [PST investigation](../../sandy-mail/pst-conversion-investigation.md) records established upstream candidates and the missing synthetic conversion acceptance evidence.
