# Sandy Mail acceptance and remaining deliverables

Authoritative feature scope: [Sandy Mail Architecture & Engineering Scope v1.0](../sandy-mail-architecture-engineering-scope-v1.md), PR #239 head `b1d499f8dd946b6fda11e0cfcaa1f508ec435a08`. This file maps evidence and unfinished work; it does not replace that scope or redefine its P0 requirements.

## First milestone

Implemented in `services/sandy-mail`: versioned Cloud SQL-compatible PostgreSQL 17 migrations, forced tenant/account/mailbox RLS, composite relationships, immutable object adapter, MIME parsing, bounded ingestion/recovery, durable receipts, outbox, and a synthetic-only canary binary. Three versioned migrations now install the initial schema and derived keyword indexes together. The service keeps all mail quarantined pending genuine scanning.

Local tests run against actual PostgreSQL 17 and local filesystem objects. GCS behavior has HTTP adapter contract tests only. Neither local tests nor mocked GCS establish deployed Cloud SQL/GCS ingestion, regional durability, end-user authentication or service availability.

| First-milestone gate | Evidence | Result |
| --- | --- | --- |
| Versioned migrations, repeat application and checksum drift rejection | `migrate.go`, `migrations/0001_mail_core.sql`, `0002_recovery_ledger_and_recipients.sql`, integration test | Local PostgreSQL passed |
| Tenant, account and mailbox read/write isolation; no-context default deny | `tenant_account_mailbox_isolation`, `wrong_scope_write`, `missing_context_and_privileges` | Local non-owner/NOBYPASSRLS role passed |
| Raw MIME and attachment persistence/integrity | `first-email.json`, fixture byte equality, corruption/missing-object tests | Local passed; raw SHA-256 `c93407efbafd6a3193d6331b8358ff71d8ae0e0dde72f238d1717b562b921244`, 1,101 bytes; decoded attachment 33 bytes |
| Metadata, encoded subject, text/HTML, addresses, envelope | MIME parser tests and SQL readback | Local passed; HTML display is escaped; raw HTML remains untrusted |
| Twelve concurrent same-identity retries; conflicting MIME/envelope rejection | `concurrent_retries`, `same_identity_different_input` | Local passed; stable receipt and no duplicate effects |
| Same Message-ID with different delivery identity | `same_message_id_distinct_delivery` | Distinct legitimate copy preserved |
| Crash after raw, after objects, before commit and after commit | Four `recover_*` tests | Local replay passed; no partial SQL state; same receipt after unknown response |
| Durable SQL receipt and outbox consistency | `receipt_outbox_atomicity`; read from a new process | Local passed |
| Malformed MIME does not disappear or receive success | `malformed_mime_retained_pending` | Raw retained; typed pending failure |
| GCS create-only, generation pinning, corruption and HTTP errors | `objects_test.go` | Adapter contract passed, **not live GCS** |
| Actual Cloud SQL/GCS canary | [exact deployment request](deployment-request.md) | Blocked: target/resource/identity/release reconciliation unavailable |
| Independent provider/customer acceptance | Required cloud readback and later client/security tests | Not performed |

Local evidence files are synthetic. `release_ref=local-source-under-test` does not attest a released artifact; immutable commit linkage is supplied by the draft PR and source manifest. Database/object records remain in the local test environment for inspection. Public repository evidence contains no private email or credential.

## Full saved-scope traceability

| Scope requirement | Current deliverable | Remaining implementation and acceptance |
| --- | --- | --- |
| §§3.2, 4.1, 5 — Cloud SQL mailbox, GCS originals, receipts/reconciliation | First-milestone schema and Go ingestor; private raw/intake/attachment objects; scoped pending replay | Deploy on verified Cloud SQL/GCS; canonical actor binding; supervised periodic reconciliation; restore from object ledgers; prove no accepted loss during real provider faults |
| §2.1 — everyday mail, inbox/folders/labels/flags/threads, composing/replies/schedules/undo/offline/accessibility | Core schema plus scoped listing/search and keyset pagination | Authorized API and native clients, drafts, threading, rules, aliases, labels, scheduling and offline conflict tests; no frontend or feature-completion claim |
| §§2.2, 6 — business mail and interoperability | Address/envelope metadata and MIME retained | Domain/user lifecycle, delegation/send-as, ICS semantics, authenticated IMAP/SMTP gateway; classic/new Outlook, mobile, Apple Mail and Thunderbird conformance journeys |
| §§3.1, 4.1, 9 — globally redundant SMTP and pre-250 durability | Ingest never acknowledges SMTP; preserves queue-release receipt boundary | Postfix in 3 regions/2 zones, independent-region durable acceptance, scanner/defer policies; region-loss/queue replay test before any MX change |
| §4.2 — outbound and ambiguous outcomes | No send operation exists in this slice | Persist send intent, sender rights, policy/scan/signing, dual relays, bounces and reconciliation; external send only with exact recipient/account authority; no blind resend |
| §§5, 2.3 — exact/keyword/BM25/vector search and AI | Scoped keyword FTS, deterministic keyset list and derived indexes (local tests) | Measured model-independent mailbox search, consented indexing/outbox consumer, ACL filtering before retrieval/synthesis, grounded citations; benchmark 1M/10M/100M separately |
| §6.1 — P0 self-service export and exit | Bounded frozen-mailbox EML/TAR + JSON manifest export, byte/attachment verification and pending-ingestion visibility (local tests) | Queued EML/TAR/MBOX + JSON/CSV manifests, snapshot/checkpoint/resume, reauth/MFA, private expiring output, direct IMAP exit; 1/100K/1M export/restore tests. Not complete |
| §6.2 — P0 universal bulk imports | Reusable bounded per-message ingest, delivery/source identity and replay receipt; bounded EML/TAR/ZIP/Maildir preview and synthetic restore/replay fixtures | Production Gmail/Graph/IMAP/PST/MBOX/EML/Maildir job adapters, staged archives, job/source/item/checkpoint/exception/reconciliation records, wizard and signed desktop agent; licensed PST parser; million-item corruption/429/UIDVALIDITY/credential/failover tests. No real imports authorized |
| §7 — spam/malware/fraud/abuse | Quarantine and pending attachment verdict; escaped display; no active-content rendering or customer download | Rspamd, ClamAV, reputation/sandbox and signed verdict boundary; SMTP DNS/auth checks, quarantine release audit and outbound abuse tests |
| §8 — privacy/identity/residency/enterprise | Dedicated data-plane boundary, composite RLS, internal scoped service, no Supabase mutation | Canonical OAuth/OIDC integration, revocation, per-tenant quotas and consent, regional backups/model paths, retention/deletion/hold policies; enterprise DLP/eDiscovery only after independent audits |
| §9 — resilience and SLOs | Local crash/duplicate/corruption tests and SQL/object separation | Actual HA/region failover, PITR/full restores and monitored synthetic probes; measured latency/load/cost and on-call drills. No SLO is certified |
| §10 — commercial/controller provisioning | Reviewable resource/cost/diff/rollback request | Reuse hosting owner’s provisioning, quotas/billing/domain health/usage, verified price margins; no duplicate shared deployment or paid commitments |
| §§2.3, 7.3, 11 stage 4 — intelligence and controlled autonomy | Mail is treated only as untrusted data; outbox does not dispatch AI/actions | Existing Runtime/API/Memory owners integrate indexing, model metadata, priorities, drafting, spending/trust intelligence and mission permissions; adversarial email tests and evidence accuracy before launch |
| §11 stages 0–5 / §12 decisions | Saved architecture preserved; new code is stage-1 foundation only | Threat/licence/DPA review, recovery/region/cost decisions, then edge, client, intelligence and enterprise acceptance. No stage is marked complete from this PR |

## Dependency handoff

The immediate next executable step is authenticated read-only inventory and target binding by the existing infrastructure/API release owner, followed by the exact synthetic Cloud SQL/GCS canary. No live recipient is needed for that step. Creating a provider test mailbox, exposing an ingress, granting access or changing DNS requires its own exact review/authority. Full scope remains in progress; implementation, deployment and independent acceptance are distinct.

## Recorded local evidence

- [Pinned-source synthetic canary](evidence/pinned-source-canary.json): source `31065a116cfc8862e80904370d600d3d174e9b71`, receipt `54f8b468-6662-4466-a534-dd921d72ec99`, message `747b62ee-d7c3-43fd-9af7-11a4859ffa7d`. Fresh-process retrieval and duplicate retry returned the same receipt.
- [Fresh PostgreSQL test log](evidence/fresh-database-tests.txt): 23 test/subtest cases passed under the race detector, with both migrations applied to an initially empty database. `go vet` and module checksum verification passed.
- [Direct SQL and byte readback](evidence/independent-readback.json), [fresh-process read](evidence/fresh-process-readback.json), and [local SQL dump/restore](evidence/local-restore.json) use the test-run fixture. These are distinct verification methods by the implementing agent; they are not independent reviewer or cloud-provider acceptance.
- [Source/build manifest](evidence/source-manifest.json) and [build metadata](evidence/build-info.txt) pin tested source and binary.
- [Vulnerability scan limitation](evidence/vulnerability-check.txt): `vuln.go.dev` returned HTTP 403; no clean vulnerability assertion is made. Repeat this check in an authorized network before release.

## Work continued after the first-ingest milestone

Added migration 0003 and `mailbox.go`: scoped keyword search, equal-timestamp keyset paging, and a bounded original-EML/TAR export with snapshot metadata. New real-PostgreSQL tests verify cross-scope results, no duplicated/skipped page items, byte-exact portable originals including attachments, explicit pending-ingestion count, over-limit rejection and unauthorized export rejection. This is not a full self-service/resumable export or bulk import implementation. The initial Mail CI run [40044465553](https://github.com/ausstyle/web-staging/actions/runs/40044465553) passed; later commits require their own CI.

[Follow-on test log](evidence/mailbox-export-tests.txt) and [source file hashes](evidence/mailbox-export-evidence.json): 25 cases passed locally with the race detector; `go vet` passed.

## Canary packaging and portable fixture follow-on

Added the protected-owner release payload, pinned nonroot container, fixed synthetic seed and negative release checks (wrong target/source/artifact, missing security properties, altered receipt, timeout/unknown write, credential separation). The release payload is not an approval mechanism and does not independently attest provider identity.

Added bounded EML/TAR/ZIP/Maildir inventory with explicit unsupported/corrupt/incomplete exceptions, path/link/size/CRC guards and hash reconciliation against portable manifests. PostgreSQL export → fresh synthetic mailbox ingestion → same-source replay → retrieve → export reconciles six original messages byte-for-byte. Distinct source paths remain distinct even with identical Message-ID/content. Flags/folders are retained as archive metadata; full persistent mapping and durable import jobs remain pending. These fixtures do not establish 100k/1m scale, MBOX/PST support or real mailbox migration.
