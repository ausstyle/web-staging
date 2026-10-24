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
