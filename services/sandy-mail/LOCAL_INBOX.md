# Local synthetic inbox

Scope: PR239 §§2.1, 3.1, 5 and 7. This is a working development reader over the existing Mail application service, PostgreSQL 17 and immutable local originals. It is not a customer authentication service, deployed Sandy API endpoint, SMTP server or provider integration. No production registry or verification flag is changed.

## What works

- Inbox listing with keyset pagination, subject/plain-text keyword search, refresh and retry.
- Real persisted message retrieval, header From/To/Cc separated from the transport envelope, read-only flags, attachment metadata and quarantine state.
- Plain-text drafts with explicit Save, reopen, revision checks and durable edit receipts. An interrupted save retains its immutable request/key for retry; stale edits retain the editor text and require an explicit reload.
- Custom flat folders and labels, folder/label filtering, and atomic message moves/label replacement. Inbox means no assigned custom folder. Removing a label association retains its inactive history row; original MIME and ingestion receipts remain unchanged.
- Original/attachment size and SHA-256 verification before returning a successful read, with the durable ingestion receipt visible.
- Plain-text-only rendering, including literal HTML source when no text alternative exists. No active HTML, links, remote images, attachment previews or attachment downloads.
- Cancelled/stale requests cannot replace a newer search or selected message. Network/backend/integrity errors remain errors; restarting the process preserves SQL/object data and invalidates the old session.

Rich composition, draft attachments/deletion/export, nested folders, folder/label rename/deletion, flag mutations, sending, semantic/AI search, scanning verdicts and customer authentication remain unfinished. The separate tested import/export workers remain available as internal backend code, not browser buttons. No placeholder scanner, AI output or fake send success exists.

## Run on the local development machine

Use an existing **local disposable PostgreSQL 17 database named `sandy_mail_test`** on `127.0.0.1`. The integration test installs migrations and its local-only `mail_test_worker` role. The role and password in this example are public synthetic test fixtures, never cloud credentials. Do not point this setup at Cloud SQL or a production tunnel.

From `services/sandy-mail` with the version in `go.mod`:

```sh
export MAIL_TEST_ADMIN_DSN='postgres://postgres:synthetic-local-only@127.0.0.1:55440/sandy_mail_test?sslmode=disable'
go test -race -count=1 ./...
export MAIL_LOCAL_DSN='postgres://mail_test_worker:synthetic-local-only@127.0.0.1:55440/sandy_mail_test?sslmode=disable'
export MAIL_LOCAL_OBJECT_DIR=/tmp/sandy-mail-local-objects
go build -o /tmp/mail-local ./cmd/mail-local
/tmp/mail-local -seed
/tmp/mail-local -port 8789
```

Adjust the local port/password to the existing disposable server. `-seed` creates four reviewed synthetic messages in the separate `...0101/...0102/...0103` fixture scope. Repeating it reuses identical delivery identities and receipts. It does not change the first-email canary scope `...0001/...0002/...0003`, import/export evidence or migrations. Keep the same object directory across restarts; a missing source fails integrity verification rather than silently succeeding. `-seed` never grants access or provisions a database.

Open the printed `http://127.0.0.1:8789/#session=...` URL **on that same machine**. The random session lasts one hour, stays in memory and is removed from the URL immediately. Reloading without a session URL requires the token again; a new printed URL can reconnect the same tab. No browser local/session storage or cookies hold mail or credentials. Stop with Ctrl-C; SQL and objects remain intact. There is no public preview URL, public listener, reverse proxy or cloud route.

## Local operation contracts and safety boundary

The development transport accepts only `POST /api/operations`, JSON content type, exact same Origin/Host, loopback peer and temporary bearer token. Requests are at most 512 KiB (draft text itself is limited to 64 KiB); unknown fields, methods, operations and client-supplied scope selectors fail. Four concurrent requests and a 30-second request deadline bound work. Responses are `no-store`; CSP blocks frames, active inline content, images and outside connections. Local DB and filesystem adapters are mandatory. Runtime role validation and scoped RLS still apply on every service call.

Envelope: `{operation,version:1,request_id,arguments,idempotency_key?}`; writes require a UUID idempotency key. Success: `{operation,version:1,request_id,state:"LOCAL_READ_SUCCESS",environment:"local-postgresql-filesystem-synthetic",result}`. Errors return non-2xx with `state:"FAILED"`, or `state:"UNKNOWN_OUTCOME"` for an uncertain commit, and a bounded error code; authentication/transport validation errors may be plain text. Writes instead return `state:"LOCAL_MUTATION_COMMITTED"` with an actual SQL edit receipt. A local read or edit success does not claim provider delivery or customer authorization.

| Operation | Arguments | Result / semantics |
|---|---|---|
| `mail.messages.list` v1 | `query` (0–500 bytes), `after` (null or received_at/message_id cursor), `limit` (1–100), optional `folder` (`all`, `inbox` or scoped UUID) and `label` UUID | `items`, `next`; stable keyset reads. A full final page can have a cursor whose next read is empty. Reads have no mutation/idempotency receipt. |
| `mail.messages.get` v1 | `message_id` UUID | Safe message projection, header/envelope distinction, attachment metadata, original hash and existing ingest receipt; original and attachment verification must pass. No object location or download endpoint. |

| `mail.drafts.list` v1 | `after` (updated_at/draft_id), `limit` 1–100 | Persisted draft summaries and keyset cursor. |
| `mail.drafts.get` v1 | `draft_id` UUID | Draft text, recipients, subject, revision and updated time. |
| `mail.drafts.save` v1 | `draft_id`, `expected_version` (0 for new), `subject`, `to` array, `text`; envelope idempotency key | Atomic draft/receipt commit, no send or queue effect. |
| `mail.collections.list` v1 | `{}` | Scoped custom folders and labels (up to 200). |
| `mail.collections.create` v1 | `collection_id`, `kind` folder/label, `name`; idempotency key | New scoped collection and receipt. Names are trimmed and lowercase-normalized for uniqueness within kind; Inbox is reserved. |
| `mail.messages.organize` v1 | `message_id`, `expected_version`, `folder_id` UUID/null, `label_ids` array; idempotency key | Atomic folder/label replacement and receipt. Foreign IDs and wrong collection kinds fail. |

These names describe functioning **local handlers**, not claimed canonical registry registrations. Production wiring belongs to the API owner: bind canonical SC-01 actor/admission, audit, rate/retention/quarantine policy and existing operation contracts to these application-service methods. Do not deploy this development transport or use its temporary local token as a replacement for canonical authentication. No shared gateway, queue or release workflow is added.

## Verification

`go test -race ./...` with `MAIL_TEST_ADMIN_DSN` runs HTTP-to-PostgreSQL tests for tenant/account/mailbox isolation, search and repeated pagination, cancelled reads, wrong/expired sessions, Origin/Host/peer checks, scope injection, unsupported effects, missing/corrupt originals and recovery. Existing ingestion/import/export tests remain in the same suite.

Optional real-browser acceptance requires Python Playwright and an installed Chromium. It starts/stops its own local reader process using the existing database/objects; successful responses always come from the real backend. Only timing and network failure are injected:

```sh
export MAIL_LOCAL_BINARY=/tmp/mail-local
export MAIL_BROWSER_EVIDENCE_DIR=/tmp/sandy-mail-browser-evidence
python3 localtest/browser.py
```

The test checks desktop/mobile rendering, hostile HTML, search, aborted/stale requests, retry, no external requests, and process restart/session revocation with the same durable receipt. Screenshots and JSON results are local evidence, not independent or provider acceptance.

## Draft and organisation persistence

Migration 0006 adds `mail_drafts`, `mail_collections`, `mail_message_organization`, `mail_message_labels` and append-only `mail_edit_receipts`, all forced-RLS scoped with composite foreign keys. These are Mail-domain facts/receipts, not another generic operation ledger or queue. The mailbox remains the authorization/storage container; a folder never changes a message's original mailbox identity or object path.

Every edit binds the server-supplied actor, scope, UUID key, operation and canonical input digest. SQL advisory locks serialize scoped receipt/resource conflicts. The domain state and receipt commit in one transaction. Same-key/same-input replay returns the original receipt even if a newer revision exists, without rewriting that newer state; changed input or operation conflicts. Expected revision prevents last-writer-wins data loss. Before-commit interruption rolls back both state/receipt; uncertain commit returns no success and requires same-key replay. The UI does not discard an unresolved request to generate a new key.

Draft limits: 1,000 drafts/mailbox, 64 KiB plain-text body, 998-byte subject without header newlines, 50 syntactically valid recipient addresses, no network address verification. Collection limits: 200/mailbox, 80-character names, 20 active labels/message. All are local implementation bounds, not measured provider scale. No SQL DELETE, outgoing send state, scheduler or provider call exists in this slice. Fresh authentication/authorization, generic event/audit publishing, retention and customer policy integration remain the API owner's responsibility before production use.

For the disposable local test role only, tests grant SELECT/INSERT on the five new tables; UPDATE drafts `(subject,recipients,body_text,revision,updated_at)`, organization `(folder_id,revision)`, and label associations `(active)`. No receipt update/delete, collection update/delete, table ownership or BYPASSRLS is granted. Production migration/grant admission is separate and is not required by the pinned first-email canary. Historical migrations 0001–0005 are unchanged.

## Portable drafts and destination collections

Migration 0007 adds explicit draft and edit-receipt bindings to the existing import ledger, with composite scope foreign keys. Original inbound message/receipt requirements remain enforced for message records. The worker needs the two additional column UPDATE permissions `draft_id,draft_receipt_id` on `core.mail_import_items`; no new role, credential, IAM permission or production grant is created here. First-email migrations and grants remain pinned to 0001–0003.

Portable TAR/ZIP format version 2 stores each unsent draft as canonical `drafts/<source-id>.draft.json`, alongside its hash/size and typed manifest entry. Text, subject, recipients, source revision and created/updated timestamps survive exactly. The destination receives a new job/path-derived ID; source IDs remain in the immutable master. Frozen export snapshots include drafts even when the source changes later. Parts use the existing object hashes, admission checks, durable cursors and reconciliation. Legacy JSON counters named `*_messages` count archive records for version 2; `counter_unit=archive_records_including_drafts` and explicit draft counters distinguish them. Version 1 message-only archives remain supported.

Draft restores create only unsent draft state and immutable `mail.drafts.restore` receipts. Interrupted receipt-to-import checkpoint linkage retries the same restore identity. They never create inbound messages or outbound sends. Completed job replay does not overwrite later user edits. Changes detected during verification require action. Bounded exports allow at most 1,000 total records and 8 MiB of draft JSON; larger draft sets require the resumable exporter (up to 100 records/part). The existing 1,000-draft mailbox limit remains. Plain MBOX draft conversion is explicitly rejected; use the portable archive. No PST or other dialect conversion is implied.

`ImportSpec.collection_map` explicitly maps source collection UUIDs to already existing destination collection UUIDs. The canonical admission must bind this map with the source hash, destination scope and job key. Destination kind and mailbox ownership are checked under forced RLS. Mapping creates no collections, grants or identities. Initial folder/label assignment, flags, inbound receipt linkage and the import checkpoint commit together. Wrong-scope/kind IDs fail without partial organization writes. Mapping changes under an existing job key conflict. Explicit destination renames are permitted; original names/revision remain in portable metadata. The caller creates/chooses destination collections through the existing authorized collection interface before staging.

Without a complete map, source bytes and folder/label metadata are retained and `organization_mapping_pending` produces `COMPLETED_WITH_EXCEPTIONS`. No implicit name matching, hierarchy flattening or restored-semantics claim occurs. Flat collection mapping is implemented; arbitrary provider hierarchy conversion remains pending. These primitives are exercised locally with synthetic fixtures; canonical customer admission/scanner/export delivery and cloud acceptance remain separate.
