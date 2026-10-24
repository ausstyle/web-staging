# Resumable export backend

Authority: Sandy Mail v1.0 / PR239 §6.1. Migration 0005 and `export_jobs.go` implement persisted mailbox snapshots, resumable original-EML/TAR partitions, explicit exclusion accounting, verified manifests and byte-offset reads. This is functioning internal backend code, not a deployed customer export endpoint. The original first-email artifact at `a135eb6` and prior 1,000-message import evidence remain unchanged.

## Snapshot and worker behavior

`CreateExport` captures mailbox name, snapshot time, every message's metadata/flags/provenance and generation-pinned raw/attachment references in a single repeatable-read SQL transaction. LEFT JOINs retain messages with missing dependent facts so they cannot disappear from the inventory. Pending ingestions get individual exception records. The snapshot is stored before any provider work; retries with the same scoped job key reuse it, while a different specification conflicts. Later message arrivals and user flag changes do not change that snapshot or get overwritten.

`ResumeExport` builds or verifies one bounded partition per invocation. The existing admitted worker owner schedules calls; no second queue or runtime exists. Archives contain original EML bytes and portable JSON metadata. A partition has up to 100 messages and a 32 MiB raw-byte target; a single 25 MiB message fits. Archive output has a hard 100 MiB bound and is written as immutable 1 MiB objects. Partial objects are retained after interruptions. A completed part descriptor, its item outcomes and the cursor commit in one SQL transaction. Retry reuses the same content-addressed chunks, without advancing twice.

Every completed part is subsequently read back and checked against its byte count and SHA-256. Final reconciliation requires snapshot count = exported + excluded, no pending item rows, matching part counts and a verified descriptor hash chain. The root manifest is small; its part count identifies consecutive numbered parts, which can be read separately. A root report states `customer_delivered=false` and `independent_acceptance=false`: generation is not delivery or independent acceptance.

`ReadExportPart` supports a byte offset and verifies private object generations/hashes plus the complete part digest. It can return a partial stream and an error on revocation, corruption or writer failure; a client must never treat such a response as completed delivery. Range reads currently verify all chunks of that bounded part, including bytes before the requested offset. Interrupted clients can resume against the same immutable part. No public URL or shared bucket permission is produced.

## Mandatory external authority contract

An `ExportAuthority` adapter is mandatory; nil or denied authority fails closed. **There is no production allow-all implementation.** The only synthetic authority is in `_test.go`, excluded from production builds.

The existing canonical API owner must implement `CheckExport` using the real authenticated actor, tenant/mailbox ownership, operation admission and policy. `lookup` must check scope ownership before any job lookup; the spec is intentionally unavailable except its key. Subsequent purposes include `create`, `create_commit`, `resume`, `build_item`, `build_chunk`, `commit_part`, `verify_part`, `commit_verification`, `write_report`, `finalize`, `read_report`, `read_part`, `read_chunk`, `read_status`, `read_exceptions` and `cancel`.

The adapter must enforce fresh reauthentication/MFA where required, consent, revocation, quotas, retention/legal hold, private delivery and policy for quarantined content. `AdmissionRef` alone is not proof of authorization. Rechecks occur before chunks and commits, and after provider reads before emitting bytes. This code does not claim an atomic distributed revocation barrier: the owner must define the lease/admission contract, and bytes already emitted cannot be recalled. Expiry blocks artifact reads/resume; an authorized status read can still report expiry. Cancellation takes effect between batches and retains objects/receipts. Mid-batch revocation is observed at these checks.

The canonical identity/reauth adapter, scanner/quarantine export decision, encrypted delivery or passphrase/key handling, expiring customer links, audit/download receipts and retention cleanup are **not supplied or bypassed**. Those are the exact remaining shared integration dependencies before calling this customer-ready. No real customer download or grant change is authorized by the local fixture adapter.

## No silent losses

The fixed output format is original EML in TAR, not PST or an inferred MBOX conversion. Existing bounded mboxrd export remains separately explicit about its dialect and unsupported originals.

- `ExceptionPolicy=stop`: missing/corrupt originals or attachments stop the current partition; a typed exception is durable and its cursor does not advance. After repair, the same job resumes and resolves the exception. Pending intake at snapshot creation yields NEEDS_ACTION; a later complete snapshot needs a new job key.
- `ExceptionPolicy=include-report`: only an explicitly admitted incomplete export may include permanent source exclusions. Every excluded message is in the part manifest and paginated exception records. Root state is COMPLETED_WITH_EXCEPTIONS and `complete=false`. Temporary transport failures still stop for retry and never become permanent omissions.
- Pending ingestions remain individually recorded with their original identity/hash/size, rather than being counted as exported messages. Their unresolved source state appears in the root manifest. Malformed pending MIME is not silently represented as a successful parsed message.
- `ExportExceptionPage` returns stable source-key pages of 100 entries, including resolved retry history. `ReadExportStatus` reports snapshot, completed parts, exported/excluded/remaining counts and expiry.

`mail_export_items.snapshot` and `mail_export_parts` are not runtime-updateable. Source mailbox rows are never modified by export. Job cancellation/expiry does not delete source or temporary output. Missing objects may require an authorized source restore; no restore overwrite is attempted here.

## Bounds, validation and separate grants

Snapshot guard: up to 1,000,000 messages, with a 60-second SQL statement timeout; a larger or slower snapshot rejects transactionally. This is a safety bound, **not** a successful 100k/1m test or advertised capacity. Large-corpus snapshot partitioning and production load/residency tests remain pending. Format coverage, encrypted delivery and source failure policy must be tested through the real API before customer exposure.

Local PostgreSQL tests cover frozen snapshots under later mail/flag changes, five interruption points, stable retries, exact EML restoration, cross-chunk range reads, corruption, temporary outages, explicit exclusions, pending intake accounting, denied/revoked/expired/cancelled access, RLS and column grants. Optional `MAIL_TEST_EXPORT_1000=1` runs a 1,000-message fixture; it uses no cloud resources. Use `MAIL_TEST_OBJECT_DIR` to retain output after the test exits. The retained run at `a515e125aaa5353b5f4390b194f6bb4499c2524f` exported ten parts and restored all 1,000 originals and flags; a separate Python/psql readback verified archive and restored attachment hashes. [Recorded local evidence](../../docs/sandy-mail/acceptance.md#resumable-export-implementation) preserves the exact source, job and results. This is not 100k/1m or provider acceptance.

For a **later separately admitted** export-worker release, the resource owner must review migration 0005 and this optional SQL diff:

- SELECT and INSERT on `mail_export_jobs`, `mail_export_items`, `mail_export_parts`, `mail_export_exceptions`.
- UPDATE jobs `(state,cursor,verified_part,verified_chain,report_object)`; items `(state,part_number)`; exceptions `(code,retryable,resolved,evidence)`.
- No UPDATE snapshot, part descriptor, job target/specification, DELETE, DDL, owner inheritance or BYPASSRLS.

Existing object create/get permissions must cover the admitted mailbox's private `/exports/<job-id>/` namespace. No object delete, IAM grant, identity creation, encryption-key creation or paid resource is included. The first-email canary needs none of these export tables/grants and stays pinned separately.

## Migration 0006 follow-on

Original-message snapshots preserve current folder/label metadata through the [local organisation contract](LOCAL_INBOX.md#portability-boundary). New exports reject mailboxes containing drafts until draft export exists; they never silently claim complete mailbox portability while omitting drafts. Old frozen jobs keep their original snapshots. No earlier canary migration or export evidence is changed.

## Portable draft extension

Migration 0007 permits draft restoration; existing immutable export snapshots now include unsent drafts alongside messages. Portable-v2 TAR parts carry canonical `.draft.json` records with hashes and typed manifest entries. Source changes after snapshot creation do not alter the archive. Source draft revision, timestamps, subject, recipients and plain text survive restoration exactly; imported destination IDs are new. Legacy `*_messages` JSON counters count all archive records when `counter_unit=archive_records_including_drafts`; reports also expose `expected_drafts` and `exported_drafts`. Message-only v1 snapshots remain compatible.

Mapped organization preserves each message's referenced flat folders/labels. Portable v3 adds frozen empty collection inventory and native parent relationships. Arbitrary provider hierarchy conversion remains unverified. The bounded MBOX path explicitly rejects drafts instead of silently turning them into received/sent mail. See [draft and mapping contracts](LOCAL_INBOX.md#portable-drafts-and-destination-collections); mandatory customer authority/scanner/delivery dependencies above remain unchanged.

[Portable-v3 inventory](LOCAL_INBOX.md#empty-collections-and-hierarchy-portable-v3) is frozen as the first archive record and reconciled by separate collection counts, including empty-only mailboxes. It does not imply provider conversion or complete customer delivery acceptance.

## Portable v4 draft MIME

Migration 0009 adds a scoped immutable object reference to drafts. New bounded and
resumable exports write `drafts/<id>.draft.eml`, identified by `draft` and
`draft_mime` in a v4 manifest. Existing v1 messages, v2/v3 JSON draft masters and
frozen historical export jobs remain readable. Version 2/3 reconciliation report
schemas and legacy record counters are unchanged; manifest format is separate.

MIME-backed drafts export the original bytes exactly, including From/Sender,
Reply-To, To/Cc/Bcc, repeated/folded headers, charset/transfer encodings, HTML,
inline parts and attachments. `original_bytes_preserved=true` and an empty
`changes` list describe this byte preservation, not a scanner verdict. Plain-text
composed drafts serialize as UTF-8 quoted-printable (explicit octets preserve mixed
line endings), folded encoded Subject, To, MIME-Version, X-Unsent and Date from
creation time. The manifest records generated headers/encoding/date and absent
source From/Message-ID; it invents no sender identity. No existing rich content is
converted to plain text. MIME size/complexity and the existing 64 KiB draft text
projection limit apply; unsupported input is rejected and its import master kept.

Import requires the typed manifest: a filename, X-Unsent header or Maildir D flag
alone does not authorize converting ordinary received mail into a mutable draft.
Original bytes, projection, accounting, hash and size are checked before import;
new destination IDs and destination-scoped object references replace source
identity. Source revision/timestamps remain provenance. The immutable import item
and edit receipt reconcile interrupted commits without duplicate drafts. Old
canonical JSON draft archives remain supported. MBOX output still explicitly
refuses drafts because its draft metadata semantics are not established.

`SaveMIMEDraft` and `ReadDraftMIME` are internal worker methods, not public download,
send or scanner-bypass routes. Full MIME replacement uses expected revision and
same-key receipts. The plain-text API rejects MIME-backed edits with HTTP 409
`mime_draft_requires_full_mime_edit`; the current editor does not expose a rich
MIME/attachment editor. Upload-before-SQL can leave an immutable unreferenced object
on failure; same-key retry reuses it, no automatic deletion is performed. The SQL
trigger also refuses legacy writers that would change the projection without
replacing MIME or discard the MIME reference.

Deployment remains pending. A future approved Mail worker needs INSERT/SELECT
on the existing draft table and, for full MIME updates, column UPDATE on
`mime_original` alongside existing edit columns. No live role/grant was changed.
Rollback: stop MIME writers and export workers, retain all SQL and originals, and
forward-repair with a compatible build. Do not run old exports against MIME-backed
drafts: older code would omit their rich content. No down migration/data deletion.

New full-MIME save receipts additionally retain current and previous immutable
object references in their private JSON result, in the same SQL transaction as
the draft revision. These references support retrieval of superseded originals;
no old receipt is amended or backdated. The local mutation response omits those
object locations. Portable MIME/archive formats and the pinned first canary are
unchanged by this audit-reference addition.
