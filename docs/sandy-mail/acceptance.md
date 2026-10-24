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
| §2.1 — everyday mail, inbox/folders/labels/flags/threads, composing/replies/schedules/undo/offline/accessibility | Core schema plus scoped listing/search, keyset pagination, local inbox/message reader, revisioned drafts and custom flat folders/labels | Canonical authenticated API and native clients, rich drafts/attachments, threading, rules, aliases, folder/label lifecycle, scheduling and offline conflict tests; no frontend or feature-completion claim |
| §§2.2, 6 — business mail and interoperability | Address/envelope metadata and MIME retained | Domain/user lifecycle, delegation/send-as, ICS semantics, authenticated IMAP/SMTP gateway; classic/new Outlook, mobile, Apple Mail and Thunderbird conformance journeys |
| §§3.1, 4.1, 9 — globally redundant SMTP and pre-250 durability | Ingest never acknowledges SMTP; preserves queue-release receipt boundary | Postfix in 3 regions/2 zones, independent-region durable acceptance, scanner/defer policies; region-loss/queue replay test before any MX change |
| §4.2 — outbound and ambiguous outcomes | No send operation exists in this slice | Persist send intent, sender rights, policy/scan/signing, dual relays, bounces and reconciliation; external send only with exact recipient/account authority; no blind resend |
| §§5, 2.3 — exact/keyword/BM25/vector search and AI | Scoped keyword FTS, deterministic keyset list and derived indexes (local tests) | Measured model-independent mailbox search, consented indexing/outbox consumer, ACL filtering before retrieval/synthesis, grounded citations; benchmark 1M/10M/100M separately |
| §6.1 — P0 self-service export and exit | Persisted snapshots, resumable original-EML/TAR partitions, byte-offset reads, explicit exceptions, verified root manifests; 1,000-message local export/restore; separate bounded explicit mboxrd helper | Canonical admission/reauth/MFA/revocation integration, scanner policy, encrypted private customer delivery/expiring links/download audit, CSV/MBOX job formats and direct IMAP exit; 100K/1M export/restore and provider tests. Not customer-ready |
| §6.2 — P0 universal bulk imports | Resumable mboxrd/EML TAR/ZIP/Maildir worker with immutable chunked sources, all six import record families, typed exceptions and receipt/hash/count reconciliation | Canonical consent/revocation/scanner integration, public wizard, destination hierarchy mapping, large partitioned archives, other MBOX dialects/Gmail/Graph/IMAP/PST adapters and signed desktop agent; licensed PST parser; million-item corruption/429/UIDVALIDITY/credential/failover tests. No real imports authorized |
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

Source `a135eb69bdcf16d66b9e7e3edf27f9e85c868a33`: **35 Go test/subtest cases passed with race checking**, `go vet` passed, **five Python release contract tests passed**. [Package evidence](evidence/canary-package-local.json) pins the clean-source static binary and source archive hashes. That binary reopened the preserved original receipt `54f8b468-6662-4466-a534-dd921d72ec99` in a fresh process. New main `36a50fa` was inspected: no overlapping Mail path changes; shared Cloud/hosting proposals still do not establish live resource/access approval. PR239 head remains `b1d499f8dd946b6fda11e0cfcaa1f508ec435a08`.

## Resumable offline import implementation

Migration 0004 adds all six Mail-domain import record families with forced RLS and composite foreign keys. The bounded worker stages immutable master chunks, discovers explicitly selected mboxrd/EML TAR/ZIP/Maildir sources, resumes byte/item checkpoints, links durable ingestion receipts and initial flags transactionally, and writes immutable reconciliation reports only after source/message hash and count verification. Unknown source files/malformed messages remain explicit exceptions with original master bytes; ambiguous MBOX parsing or changed metadata cannot yield COMPLETE.

`ExportImportSource` returns exact master bytes, `ExportMailboxMBOXRD` provides reversible MBOX plus portable metadata, and original EML export now preserves import origin/folder/flags/properties. Local real-PostgreSQL tests exercise six crash points, source outages, multi-chunk sources, duplicate Message-IDs, malformed records, scoped grants/RLS, competing claims and MBOX/EML restore roundtrips. [Implementation and limits](../../services/sandy-mail/IMPORTS.md) distinguish this internal worker slice from the still-pending public wizard, canonical consent/revocation integration, production scanning, PST/provider adapters, arbitrary MBOX dialects, encrypted resumable customer export and 100k/1m acceptance. No live Cloud SQL migration or import has run.

Source `10ae99536f1742783d503a52900fb77229ea25c7` passed **55 Go test/subtest cases with race checking**, including the opt-in 1,000-message fixture, plus `go vet`. [Fresh-database CI](https://github.com/ausstyle/web-staging/actions/runs/40048087395) passed migration creation, the standard suite, release-runner contracts, container build and vulnerability checking. The full local run processed 1,000 messages / 1,155,000 source bytes in 32.498 seconds (30.77 messages/second); a retained-object run took 39.336 seconds (25.42/second). These are two local race-instrumented observations, not a cloud benchmark or production SLO.

After the retained test process exited, a separate Python/psql path re-read **all 1,000 originals, distinct receipts and outbox rows**, verified raw byte equality, parsed subjects and decoded attachment hashes, reconstructed the two-chunk source master and verified its SHA-256. [Post-process evidence](evidence/import-bulk-after-exit.json) and [test logs](evidence/import-jobs-tests.txt) are committed. This check was executed by the same agent; independent/provider acceptance remains false. Initial first-email objects/receipt and the `a135eb6` release artifact remain preserved.

## Resumable export implementation

Migration 0005 and `export_jobs.go` persist mailbox snapshots, item outcomes, immutable part descriptors and exception history. Frozen metadata/flags survive retries and later mailbox changes. Workers build verified original-EML/TAR partitions, checkpoint atomically and reconcile all snapshot items before a root manifest. Byte-offset reads verify the same immutable parts. Incomplete exports explicitly report exclusions/pending intake; transport errors stop for retry. No PST or implicit MBOX conversion is advertised.

[Export implementation and authority contract](../../services/sandy-mail/EXPORTS.md) specify the mandatory fail-closed canonical admission adapter, tested expiry/revocation/cancellation checks and optional SQL grants. The adapter has no production implementation here. Canonical reauth/MFA, quarantine/scanner decisions, encrypted customer delivery, expiring links and audit receipts are external integration dependencies, not passing placeholders. No customer-facing delivery or independent/provider acceptance is claimed.

Source `a515e125aaa5353b5f4390b194f6bb4499c2524f` passed **67 Go test/subtest cases with race checking** and `go vet`; five Python release contract tests passed. [Mail CI](https://github.com/ausstyle/web-staging/actions/runs/40050136141) and [engineering regression CI](https://github.com/ausstyle/web-staging/actions/runs/40050136113) both passed on that source. The [retained local test log](evidence/export-jobs-tests.txt) includes the opt-in 1,000-message export/restore fixture, which is separate from the earlier retained 1,000-message import fixture.

The export generated and read back **10 parts / 3,584,000 archive bytes / 1,000 originals** in 3.814 seconds, excluding fixture creation. Restoring all ten parts into a fresh synthetic mailbox verified **1,000 restored messages and 1,000 seen flags** in 46.958 seconds. [Persisted job reconciliation](evidence/export-job-reconciliation.json) records job `f98ddd6d-cd39-4495-9d12-77525213c5a3`, its frozen scope and the descriptor hash chain. These timings are local race-instrumented observations, not provider throughput or 100k/1m acceptance.

After the Go process exited, a separate Python tar/email parser plus psql reconstructed every immutable part, recomputed the complete descriptor hash chain, verified all 1,000 archived originals and flags, and read all 1,000 restored originals, distinct receipts and attachment hashes. [Post-process evidence](evidence/export-after-exit.json) explicitly records `cloud_deployed=false`, `customer_delivered=false` and `independent_acceptance=false`; the implementing agent ran both verification paths. Fixture expiry remains recorded rather than extended to imply a live customer download.

The first-email canary remains pinned at `a135eb69bdcf16d66b9e7e3edf27f9e85c868a33`, binary SHA-256 `a796e5406ab16a26f9226b43fad6f4a4784aa6a284a0b28ad854cb37bea57700`. No import/export grant is needed for that canary. Live execution is pending the existing API/hosting owner's Cloud SQL/GCS target, workload identity and protected release mapping; no cloud write was attempted in this follow-on. Customer-facing portability next needs the actual shared authority/scanner/delivery contracts described above; no substitute identity, scanner or release path was invented.

Main assigned `SANDY-ENG-0013` to Accounting while this Mail PR was still a draft. The branch merges main and preserves Accounting; Mail's unmerged task/catalogue entry at that milestone was `SANDY-ENG-0014` (source version 1.1). This bookkeeping change does not alter PR239's feature scope or historical evidence.

## Local inbox against the real backend

[Local reader implementation and run instructions](../../services/sandy-mail/LOCAL_INBOX.md) cover a loopback HTTP transport over existing application-service methods, real scoped PostgreSQL queries and original/attachment integrity verification. Four separate synthetic fixtures exercise plain text, MIME/attachment content and hostile HTML. The browser renders text only, exposes no attachment download, and distinguishes message-header addresses from the transport envelope. Session tokens are temporary/in-memory; no canonical customer identity or production API registration is claimed.

The original canary scope/artifact and all prior 1,000-message evidence remain unchanged. Live canary execution is reserved for the forthcoming bounded Google trial; [self-contained handoff](google-trial-handoff.md) provides immutable pins, runnable tests, exact pending targets/permissions, success criteria and non-destructive rollback. No Google access, cloud task or deployment is inferred from the trial agreement.

Source `f0174f9f405a34a5c0c8b00fbb71d38a7dd82fbc` passed **78 Go test/subtest cases with race checking**, `go vet`, and **five release-runner tests**. [Test log](evidence/local-inbox-tests.txt) includes real HTTP-to-PostgreSQL tenant/account/mailbox isolation, repeated keyset/search reads, cancellation, session/Origin/Host checks, header/envelope distinction and missing/corrupt original recovery. The first canary binary hash, all five migrations and prior 1,000-message import/export evidence are unchanged.

**Eight real-Chromium checks passed** against the retained local database/objects: four real messages, search/read, literal hostile HTML with no remote request or execution, stale-request suppression, network error/retry, responsive desktop/mobile view, session revocation on process restart and unchanged persisted receipt. The only browser request interception injected delay or network failure; no successful backend response was fabricated. [Browser results](evidence/local-inbox-browser.json), [desktop screenshot](evidence/local-inbox-desktop.png), [mobile screenshot](evidence/local-inbox-mobile.png) and [source/binary/seed manifest](evidence/local-inbox-manifest.json) are retained. The implementing agent ran these tests; cloud deployment and independent acceptance remain false.

Latest-base reconciliation: main `a08f969d7b65a329c743428f557a514a14479bcb` introduced My Voices as `SANDY-ENG-0014`, producing a real catalogue conflict. Mail now uses `SANDY-ENG-0015`, version 1.2; the branch retains the latest main catalogue including My Voices/Accounting and appends only Mail. No scope requirement, canary pin or historical evidence was overwritten.

## Local drafts, folders and labels

Migration 0006 adds scoped draft/collection/organization records and immutable edit receipts. Real local operations save/list/reopen drafts, create folders/labels, move messages and replace active labels. Revisions, canonical input digests and same-key replay prevent stale overwrite and duplicate effects; state/receipt commit atomically. The browser preserves text on version conflict and keeps an unresolved save's key/payload for retry. No send route or outbound queue effect exists.

[Implementation and exact limits/grants](../../services/sandy-mail/LOCAL_INBOX.md#draft-and-organisation-persistence) distinguish this local slice from canonical customer authentication, provider execution and rich client parity. At that milestone, source folder/label metadata was preserved by bounded/resumable exports, destination mapping remained an explicit exception, and draft-containing exports failed explicitly. The subsequent portability milestone below closes these local gaps. Original migrations 0001–0005, canary artifact and previous 1,000-message evidence are unchanged. The Google trial still owns the pending live canary.

Source `a0f7a37e62c96baf6301ad18feedaf34db9ace6a` passed **84 Go test/subtest cases with race checking**, `go vet`, **five release-runner tests**, and **12 real-Chromium checks**. [Mail CI](https://github.com/ausstyle/web-staging/actions/runs/40054741453) and [engineering regression CI](https://github.com/ausstyle/web-staging/actions/runs/40054741436) passed through their normal pull-request triggers after the catalogue conflict repair. [SQL/HTTP test log](evidence/drafts-organization-tests.txt) verifies concurrent idempotent saves, stale revisions, both commit fault boundaries, cross-scope edits, immutable receipt grants, real HTTP mutations and portability exceptions.

[Browser evidence](evidence/local-edit-browser.json) verifies a deliberately lost response **after the real database commit**, identical-key replay, unchanged receipt, two real editors with a stale-save conflict that retains text, folder move/filter, label application/removal, Inbox restoration and process restart. [Draft editor](evidence/local-drafts-desktop.png), [mobile draft editor](evidence/local-drafts-mobile.png) and [folder/label controls](evidence/local-organization-desktop.png) are actual local screenshots. No successful response was mocked.

After the browser exited, a separate Python/psql process verified saved draft revision 3 and exactly three distinct save receipts (no fourth effect from replay), all four original inbox hashes/receipts unchanged, no remaining test labels/moves and the original first-canary receipt preserved. [Post-process evidence](evidence/local-edit-after-exit.json) and [source/build manifest](evidence/local-edit-manifest.json) retain those facts. These checks were run by the implementing agent; provider deployment and independent acceptance remain false.

## Draft export and explicit destination mapping

Migration 0007 extends the existing forced-RLS import ledger with separate draft/edit-receipt bindings. Portable v2 archives and frozen resumable exports preserve unsent draft content, recipients, revision and timestamps. Restores use new destination IDs and durable same-key receipts, never inbound messages or sends. Explicit admitted collection maps restore flat folders/labels atomically with import checkpoints; absent maps remain accounted exceptions, and foreign IDs fail closed. [Format, permissions and remaining boundaries](../../services/sandy-mail/LOCAL_INBOX.md#portable-drafts-and-destination-collections) document version compatibility, typed record counts and the explicit MBOX draft-conversion rejection.

Local PostgreSQL 17 tests cover draft-only and mixed archives, immutable snapshots after source edits, interruption before/after draft commit and before import checkpoint, exact readback, completed replay after later edits, malformed/missing manifests, mapping rollback, cross-mailbox destination rejection and changed-map idempotency conflicts. This is local acceptance by the implementing agent. Cloud SQL/GCS execution remains reserved to the Google trial pending entitlement and approved target/identity mapping; no cloud job or provider mutation was submitted. The first-email source `a135eb69bdcf16d66b9e7e3edf27f9e85c868a33` and prior 1,000-message evidence remain unchanged.

Source `50335e624b19ad46074e1ce5f3d8bfa146d23e71` passed **94 race-checked Go test/subtest cases**, `go vet`, the local-client build and five release-runner tests. [Full test output](evidence/portability-final-tests.txt) and [retained-fixture test output](evidence/portable-persisted-tests.txt) distinguish regression coverage from the separately retained synthetic fixture. [Round-trip manifest](evidence/portable-roundtrip.json) records import job `078b5db1-c1de-4b50-876c-9d078cf8a462`: two verified records, zero exceptions, one original message and one unsent draft.

A separate Python/psql process, after the test exited, checked the durable SQL rows, exact draft content/revision/timestamps, original MIME and attachment files, source-item objects and immutable reconciliation hash. [Post-process evidence](evidence/portable-after-exit.json) confirms exactly one draft restore receipt (`50644af5-6239-4f82-a55d-58998d750b57`), one folder assignment and one active label. Objects remain at `/workspace/sandy-mail-evidence/portable-roundtrip-objects` with the separate local PostgreSQL test instance on port 55441. The original canary binary checksum was independently rechecked as unchanged. Empty collection inventory and arbitrary provider hierarchy conversion remain explicit portability limits.

## Empty collections and folder hierarchy

Migration 0008 and portable v3 preserve complete native collection inventories independently of message membership. The real local UI/API creates nested folders and opens empty folders. The export snapshot retains parent edges, unused labels and duplicate basenames under different parents; a mailbox containing no messages still exports a verifiable inventory part. Explicit admitted creation or mapping restores the graph, with transactional receipt/checkpoint recovery and separate verified/unverified collection totals. Provider hierarchy conversion remains distinct.

Tests cover five interruption boundaries, partial-graph rollback, receipt replay, sibling conflicts, foreign parents, wrong destination parents, cyclic/malformed source inventories, missing-map loss accounting, a frozen empty-only snapshot and split-part restore. [Runtime review](scanner-custody-review.md) and [PST investigation](pst-conversion-investigation.md) record precise remaining integration/fixture dependencies without adding trust, keys, converters or deployment paths. The pinned Google canary remains unchanged; this increment is local/source work, not provider deployment or independent acceptance.

Source `733bb820ff95fcb8bfefa2543f06c18fc4c88462` passed **112 race-checked Go test/subtest cases**, vet, five release-runner tests and **13 real-Chromium checks**. [Full SQL/recovery test log](evidence/hierarchy-final-tests.txt), [browser evidence](evidence/hierarchy-browser.json) and [actual nested-folder screenshot](evidence/hierarchy-desktop.png) record local acceptance. A separate [populated upgrade clone](evidence/hierarchy-upgrade.json) preserved 51 drafts, 31 collections, 187 import items and 307 inbound receipts while applying migration 0008; existing draft/collection content and receipt checksums were unchanged, and the source database was only read.

[Retained round-trip](evidence/hierarchy-roundtrip.json) and [post-process readback](evidence/hierarchy-after-exit.json) identify import job `bb90b982-df27-40e3-9af5-d4c6a4c02e3c`: seven verified collections, three parent edges, two verified archive records and zero exceptions. Exactly one collection restore receipt `84233c1e-d540-458e-941a-b54434d44cf8` survived interrupted acknowledgement. The independent process re-read every source item, original MIME, attachment and reconciliation object by hash; it was still run by the implementing agent, so independent acceptance remains false. Retained objects are at `/workspace/sandy-mail-evidence/hierarchy-roundtrip-objects`, with local database port 55442; none are Cloud SQL/GCS acceptance.

Scope reconciliation: native draft JSON round-trip is verified, but §6.1 also requires an interoperable RFC822/MIME representation for locally composed drafts. The subsequent v4 increment below implements that adapter; native-v2/v3 success alone was not full provider-exit or Outlook/PST acceptance.


## Interoperable unsent draft MIME

Portable v4 and migration 0009 retain byte-exact rich MIME and generate an explicit
MIME representation for composed text. Per-record accounting identifies preserved
originals versus generated headers/encoding/date and absent sender/Message-ID.
Original MIME recipients, folded/repeated headers, ISO-8859-1 quoted-printable,
UTF-8 HTML and binary attachment bytes are exercised with authored `.invalid`
fixtures. Draft restoration remains separate from received mail and sending.
The [format/rollback contract](../../services/sandy-mail/EXPORTS.md#portable-v4-draft-mime)
records exact limits and legacy compatibility. Source/local acceptance remains
separate from Cloud SQL/GCS execution and independent acceptance.
