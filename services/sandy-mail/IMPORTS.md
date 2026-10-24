# Offline mailbox workers

Authority: PR239 / Sandy Mail v1.0 §§6.1–6.2. This is an internal Mail-domain worker library with local synthetic PostgreSQL evidence. It is not a public import API, an approved customer import, or deployed Cloud SQL functionality. The existing API/worker owner must authenticate tenant/mailbox ownership, perform migration consent/admission, enforce revocation, residency/scanning/quota and schedule each batch. `AdmissionRef` is a reference to that external decision, never self-authorization. No new queue, scheduler, credentials or provider routes are created.

## Source and resumable state

Migration 0004 adds `mail_import_jobs`, `mail_import_sources`, `mail_import_items`, `mail_import_checkpoints`, `mail_import_exceptions` and `mail_import_reconciliation`. All use composite tenant/account/mailbox keys, FKs, forced RLS and revoked public privileges. Import receipts are constrained to the same scope/message. Source object bytes are immutable; imported-item raw object identities and reconciliation records are not runtime-updateable.

`StageImport` accepts an already authorized stream, declared SHA-256/size, stable scoped job key, source format/folder, cutoff and admission reference. It writes the untouched source as immutable 1 MiB chunks, checks the aggregate digest/length, stores an immutable source manifest, then permits discovery. Partial upload objects remain retained; the active staging manifest records the latest prefix, and superseded incomplete chunks remain available for owner reconciliation; retry reads the same input from its beginning and reuses content-addressed chunks. Upload-byte-range continuation and GCS resumable-upload sessions are still pending. A changed spec under the same job key conflicts. A completed source is reused by declared identity rather than consuming a second input stream.

`ResumeImport` advances one bounded phase batch:

1. DISCOVERING: extract originals and persist source paths, offsets, folder/flags/properties, per-item hashes and typed exceptions. No message ingestion starts until the entire inventory is accounted for. MBOX resumes directly from the byte cursor; TAR/ZIP rescan their bounded inventory and skip already checkpointed items.
2. IMPORTING: invoke the existing ingestor with stable job+source-item identity, then transactionally link the receipt, initial flags and checkpoint. A crash between message commit and item linkage replays the same delivery. Different source offsets/paths remain legitimate separate copies even with identical MIME/Message-ID.
3. VERIFYING: retrieve raw MIME and parsed subject/body, verify source originals and receipt identity, compare stored flags/received date, re-read all master chunks and aggregate hash, then freeze count/byte reconciliation with a hash chain and immutable JSON report.

Only fully reconciled inventory yields COMPLETE. Unsupported/malformed source items yield COMPLETED_WITH_EXCEPTIONS, with preserved master bytes and visible exception records. Ambiguous parsing/metadata changes yield NEEDS_ACTION. Transient worker failures retain a typed retry record and the previous checkpoint. The same scoped job key resumes; no fresh ID is generated for retries. A nonblocking database advisory claim prevents competing workers processing the same job. The existing owner must bound total worker concurrency and context deadlines. Pause/cancel/resume policy endpoints, live incremental CATCHING_UP and operator resolution are not exposed yet.

`ImportReport` reads the immutable reconciliation snapshot; it is not a fresh health check or independent acceptance. `ExportImportSource` streams the exact retained master and only succeeds after full hash verification. Ordinary EML export also carries import origin, source folder, flags, conversion record and supplemental metadata. Mailbox mapping is one admitted destination per job; original nested folders remain explicit provenance. Automatic destination hierarchy creation is not implemented.

## Supported adapters and losslessness

- EML TAR/ZIP and Maildir cur/new: exact EML bytes, paths and source modification timestamps; known Maildir flags are mapped and unknown flag characters retained. Existing portable export manifests restore flags/received dates and retain prior origin records. Unsupported files and Maildir tmp entries are explicit exceptions. Traversal, duplicate paths, CRC failure, archive bombs and invalid manifests cannot produce success.
- **Explicit `mboxrd` dialect only:** strict ctime `From sender date` separators, caller-specified IANA timezone, reversible one-level quoting of body lines beginning with zero or more `>` then `From `, and one extra LF framing separator. Original message CRLF/LF bytes are preserved. Unknown variants, unescaped ambiguous separators, Content-Length (mboxcl/cl2) and missing framing stop discovery; the master remains intact. This is not a claim of universal Thunderbird/Takeout/Dovecot compatibility. RFC4155 documents incompatible MBOX variants; the caller must select a known format, not rely on autodetection.
- Status / X-Status map seen/answered/flagged/draft/deleted. Original Status, X-Keywords, UID and other source headers remain in MIME and supplemental metadata. Missing recipients need explicit mapping and become exceptions; no SMTP envelope/recipient is invented. Missing archive timestamps use the explicit cutoff with provenance. SQL received timestamps are represented at PostgreSQL microsecond precision; original timestamps remain source metadata.

`ExportMailboxMBOXRD` streams the existing frozen mailbox snapshot, emits reversible MBOX plus a mandatory metadata result containing original hashes, offsets, flags and origin records. It rejects originals that cannot roundtrip through the supported dialect rather than normalizing them. Original EML export remains available for those items. Writer failure or partial source inventory cannot return a complete export manifest.

Current bounds: 100 MiB master archive, 25 MiB per message, 1–1,000 items per worker invocation; TAR/ZIP at most 1,000 entries; MBOX explicit maximum 100,000 discovered items. These are rejection limits, not demonstrated 100k/1m performance. Export remains bounded at 1,000 messages. Large partitioned archives, encrypted customer delivery, resumable export, PST/other MBOX dialects/provider adapters and production scanner attestations remain outstanding.

## Separate optional SQL grant diff

The first-email artifact at `a135eb69bdcf16d66b9e7e3edf27f9e85c868a33` remains preserved and uses only migrations 0001–0003. It does **not** need these import grants. Do not delay or silently expand that first canary while target mapping is pending.

For a later separately admitted import-worker release, the resource owner must review migration 0004 and existing role privileges. This source change grants nothing live. In addition to the ingestion role's privileges:

- SELECT and INSERT on the six import tables.
- UPDATE jobs `(state,inventory_complete,updated_at)`; sources `(manifest,complete)`; items `(state,message_id,receipt_id,flags,envelope,properties)`; checkpoints `(cursor,item_count,chain_sha256)`; exceptions `(code,retryable,evidence,resolved)`.
- UPDATE only `memberships(flags)` to apply the initial imported flags.
- No UPDATE reconciliation, original object/digest/source identity columns, DELETE, TRUNCATE, DDL, owner inheritance or BYPASSRLS.

These grants exist only on the disposable local/CI test role. No live grant or persistent access change has been requested or applied.

Format references: [RFC4155](https://www.rfc-editor.org/rfc/rfc4155.html), [Dovecot source-header conventions](https://doc.dovecot.org/2.3/admin_manual/mailbox_formats/mbox/).

Local optional scale fixture: `MAIL_TEST_BULK_1000=1 go test -race -v ./...` stages and reconciles 1,000 synthetic MBOX messages in batches of 100. This measurement is loopback PostgreSQL/filesystem work with race instrumentation, not Cloud SQL throughput or the required 100k/1m acceptance. Set `MAIL_TEST_OBJECT_DIR` to retain fixture objects beyond the test process.
