# Sandy Mail ingestion milestone

Authority: [Sandy Mail v1.0](../../docs/sandy-mail-architecture-engineering-scope-v1.md), PR #239 at `b1d499f8dd946b6fda11e0cfcaa1f508ec435a08`, especially §§3–5, 6.2, 7 and 11. This is a bounded Go data-plane implementation, **not a deployed mail service**. Internal Sandy Supabase is untouched.

## Implementation

- PostgreSQL 17+ on a **dedicated database named `sandy_mail…`**. Migration runner takes an advisory transaction lock, stores version/checksum, rejects drift and applies all pending migrations transactionally. `core` must be unoccupied on first installation; no existing schema is overwritten. All migrations must be deployed together before enabling ingestion.
- Composite tenant/account/mailbox keys and FKs on all message facts; forced RLS and transaction-local scope. Runtime refuses superuser, BYPASSRLS or table-owner roles. Deployment must separately verify inherited privileges. Never give end users these DB credentials. A scope is trusted only after the canonical Sandy API identity/membership/operation admission. This package does **not** implement that authentication integration, and must not be exposed as a public endpoint.
- Admission ledger → immutable intake envelope and original MIME → bounded MIME parsing → immutable decoded attachments → single SQL transaction for message, addresses, envelope, bodies, object references, membership, receipt and outbox. Final receipt requires byte/hash readback of raw, recovery ledger and each attachment. SMTP edge may release its queue only after this verification; this package does not return SMTP 250 or claim second-region durability.
- Scoped delivery identity determines replay. Same identity with changed MIME/source/envelope conflicts. Message-ID is metadata, never a uniqueness key. Different delivery identities and mailbox copies remain distinct. Recipient and received timestamp are stable original acceptance attributes, not retry time.
- GCS JSON API media uploads require `ifGenerationMatch=0`; reads pin generation and verify SHA-256 and byte count. Workload-authenticated HTTP client is supplied by the protected runner. No overwrite/delete, bucket creation, IAM grant or public URL. `LocalStore` is only a synthetic test adapter.
- Each raw object has an adjacent `intake.json` recovery record containing tenant/account/mailbox, original envelope, delivery identity, source, raw key, byte count and SHA-256. It is private content, not a public audit log. SQL pending rows are replayable with `Recover`; missing originals require edge replay. Reconciliation never deletes orphan objects. Operator recovery after complete SQL loss must verify the intact ledger against the original bytes before reconstructing admission; a regional automated restore controller is still pending.
- Message remains `quarantined`, attachments `pending`. No customer attachment/download endpoint is exposed. Display HTML is escaped plain text in `<pre>`; original HTML is stored as untrusted source. Production scanning and authenticated customer serving remain required.
- Limits: 25 MiB raw and total decoded payload, 200 MIME entities, 20 nesting levels. Invalid encodings/headers or MIME remain pending with a bounded error code and retained originals; no success receipt. These are conservative canary limits, not advertised product limits.

## Local verification

Go 1.27.3 and an isolated PostgreSQL 17 server:

```sh
docker run --name sandy-mail-postgres-test \
  -e POSTGRES_PASSWORD=synthetic-local-only -e POSTGRES_DB=sandy_mail_test \
  -p 127.0.0.1:55439:5432 -d postgres:17
export MAIL_TEST_ADMIN_DSN='postgres://postgres:synthetic-local-only@127.0.0.1:55439/sandy_mail_test?sslmode=disable'
go test -race -count=1 -v ./...
go vet ./...
go build ./cmd/mail-fixture
```

Integration tests require the exact `sandy_mail_test` database on loopback and create only synthetic rows and a local test role. Without the variable, integration tests are explicitly skipped; unit success alone does not establish DB evidence. Optional `MAIL_TEST_OBJECT_DIR` retains files; `MAIL_TEST_EVIDENCE` writes the JSON receipt/readback. The test-only GitHub workflow supplies a disposable DB and uploads synthetic evidence; it does not deploy.

## Cloud SQL canary entry point

Build `cmd/mail-fixture` and invoke `migrate`, `ingest`, `recover` or `read` only through the existing protected release owner after target reconciliation. Never add a second shared deployment job. The first canary needs **no real recipient, provider mailbox or DNS route**; it inserts the embedded synthetic fixture directly into an already authorized synthetic mailbox row.

Required configuration (values via existing authorized workload mechanisms, never committed credentials):

- `MAIL_ENVIRONMENT=cloudsql-canary`, `MAIL_DATABASE_DSN`, `MAIL_EXPECTED_DATABASE`.
- Existing Cloud SQL Auth Proxy/socket or verified TLS; `MAIL_CLOUDSQL_CONNECTION_NAME` records the configured target. The runner does not start a proxy or mint credentials.
- `MAIL_GCS_BUCKET`, existing ADC workload identity with approved object-create/read only.
- `MAIL_TENANT_ID`, `MAIL_ACCOUNT_ID`, `MAIL_MAILBOX_ID` bound to the approved synthetic fixture.
- `MAIL_RELEASE_REF` set to immutable source/artifact identity.

`migrate` requires a separate migrator role. `ingest` accepts only the embedded RFC822 fixture; there is no file/URL/private-mail input option. `read` opens a new DB session and independently checks the persisted bytes. Provider resource identity, bucket IAM/versioning, database backup settings and Cloud SQL instance ID must also be independently inspected; printing a configured connection name is not proof of provider identity.

The production SQL runtime privileges should be reviewed and granted by the authorized resource owner: schema USAGE; SELECT on core tables; INSERT on ingestions/messages/envelopes/recipients/bodies/mime_objects/attachments/memberships/intake_objects/inbound_receipts/outbox; column UPDATE on ingestions `(attempts,last_error,updated_at,state)`. No provisioning, schema DDL, receipt update/delete, TRUNCATE or role membership grants. No identity or grants are created by application migrations.

## Recovery and rollback

Disable the new canary invocation/consumer and retain all SQL/object data. Existing mail routes are unaffected. Re-run the identical delivery after failed/unknown outcomes; never generate a fresh ID for a retry. Pending rows retain attempt/error diagnostics. Inspect objects and hashes before repair. Roll forward with versioned additive migrations; do not DROP tables or delete originals as rollback. SQL and object storage are not one distributed transaction: orphan objects are expected after certain failures and are retained for reconciliation. Back up/restore both SQL metadata and immutable originals, preserving their references.

See [acceptance and remaining scope](../../docs/sandy-mail/acceptance.md) and [deployment request](../../docs/sandy-mail/deployment-request.md).

## Follow-on mailbox prototype

`List` provides tenant/account/mailbox-scoped keyword FTS and deterministic keyset pagination (maximum 100 items). Migration 0003 adds derived subject/body GIN indexes. No production latency/corpus benchmark is claimed.

`ExportMailbox` writes a bounded (1–1,000 messages) frozen SQL snapshot as TAR containing byte-exact original EMLs and a final JSON manifest with dates, flags, headers, envelope, source hashes and attachments. Attachment bytes remain inside each original EML. It reports pending ingestion count separately, refuses over-limit snapshots before writing output, and never reports completion on missing/corrupt objects or output errors. This is an internal operator prototype, not the complete self-service export product: queued/resumable export, MFA, encrypted delivery, full-account/folder selection, CSV/MBOX and million-message validation remain outstanding. No source deletion occurs.

## Release package and offline archive validation

The [release payload](release/README.md) validates fresh canonical provider observations, exact synthetic scope, binary hash and readback receipts. It separates migrator/runtime child credentials, never creates authority, and stops on uncertain writes for reconciliation. The pinned Go build produces a static, nonroot scratch container. No image is published or cloud job created by this change. `seed-synthetic` is a transactionally checked, repeatable fixed-row seed under the existing migrator.

`InspectTAR` and `InspectZIP` stream bounded entry payloads without filesystem extraction. EML and Maildir cur/new source paths, dates, known flags and unknown flag characters are retained in the inventory; portable export metadata is retained intact. Original Message-ID never deduplicates distinct source paths. Unsupported PST/MBOX/other inputs, malformed MIME, Maildir tmp files and links produce visible exceptions; traversal, duplicate paths, oversize/zip bombs, corrupt CRC and trailing TAR data fail closed. Bounds: 1,000 entries, 100 MiB total, 25 MiB per entry. `READY` means an inventory is ready for subsequent admission, never a completed import. A callback may have run before a later error: the caller must persist inventory, checkpoint and reconcile before reporting completion.

Real PostgreSQL tests export six synthetic EMLs, ingest into a fresh synthetic mailbox, replay each same source identity, retrieve exact bytes and export again with reconciled counts. This proves raw MIME restore/replay only at fixture scale. Maildir flags remain preview metadata; persisting mapped flags/folders and supplemental properties, immutable staged source upload, durable import-job/source/item/checkpoint/exception/reconciliation tables, MBOX/PST/provider adapters, encrypted delivery and 100k/1m scale are still outstanding. No public import endpoint or real mailbox import was added.

## Resumable offline imports

Migration 0004 and [offline import workers](IMPORTS.md) now implement chunked immutable master staging, bounded MBOXrd/EML archive/Maildir discovery, durable item and phase checkpoints, receipt-linked ingestion, initial flags, source provenance and hash/count reconciliation. MBOX export preserves supported originals with required portable metadata; exact master-archive export retains unsupported/corrupt source items. The earlier paragraph's pending import records/flags/MBOX statements describe the prior prototype; this follow-on implements the bounded worker slice, while public APIs, arbitrary MBOX dialects/PST, large-scale acceptance and resumable customer export remain pending. The original first-email release artifact remains separately pinned and requires no import grant expansion.

## Resumable export backend

Migration 0005 and [resumable exports](EXPORTS.md) add frozen SQL snapshots, checkpointed EML/TAR partitions, generation/hash readback, explicit exclusions and byte-offset reads. A canonical `ExportAuthority` adapter is mandatory; no production authority implementation or public download endpoint is supplied. The earlier bounded-export limitations describe that older helper. This follow-on implements durable generation/resume, while actual customer reauth/MFA/scanner policy, encrypted delivery, expiring links, audit and production scale still require shared integration and acceptance.
