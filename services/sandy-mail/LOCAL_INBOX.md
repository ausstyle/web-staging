# Local synthetic inbox

Scope: PR239 §§2.1, 3.1, 5 and 7. This is a working development reader over the existing Mail application service, PostgreSQL 17 and immutable local originals. It is not a customer authentication service, deployed Sandy API endpoint, SMTP server or provider integration. No production registry or verification flag is changed.

## What works

- Inbox listing with keyset pagination, subject/plain-text keyword search, refresh and retry.
- Real persisted message retrieval, header From/To/Cc separated from the transport envelope, read-only flags, attachment metadata and quarantine state.
- Original/attachment size and SHA-256 verification before returning a successful read, with the durable ingestion receipt visible.
- Plain-text-only rendering, including literal HTML source when no text alternative exists. No active HTML, links, remote images, attachment previews or attachment downloads.
- Cancelled/stale requests cannot replace a newer search or selected message. Network/backend/integrity errors remain errors; restarting the process preserves SQL/object data and invalidates the old session.

Drafts, folders/labels, flag mutations, composition, sending, semantic/AI search, scanning verdicts and customer authentication are not implemented by this reader. The separate tested import/export workers remain available as internal backend code, not browser buttons. No placeholder scanner, AI output or fake send success exists.

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

The development transport accepts only `POST /api/operations`, JSON content type, exact same Origin/Host, loopback peer and temporary bearer token. Requests are at most 8 KiB; unknown fields, methods, operations and client-supplied scope selectors fail. Four concurrent requests and a 30-second request deadline bound work. Responses are `no-store`; CSP blocks frames, active inline content, images and outside connections. Local DB and filesystem adapters are mandatory. Runtime role validation and scoped RLS still apply on every service call.

Envelope: `{operation,version:1,request_id,arguments}`. Success: `{operation,version:1,request_id,state:"LOCAL_READ_SUCCESS",environment:"local-postgresql-filesystem-synthetic",result}`. Errors return non-2xx, `state:"FAILED"` and a bounded error code; authentication/transport validation errors may be plain text. A local read success does not claim provider delivery or authorization.

| Operation | Arguments | Result / semantics |
|---|---|---|
| `mail.messages.list` v1 | `query` (0–500 bytes), `after` (null or received_at/message_id cursor), `limit` (1–100) | `items`, `next`; stable keyset reads. A full final page can have a cursor whose next read is empty. Reads have no mutation/idempotency receipt. |
| `mail.messages.get` v1 | `message_id` UUID | Safe message projection, header/envelope distinction, attachment metadata, original hash and existing ingest receipt; original and attachment verification must pass. No object location or download endpoint. |

These two names describe functioning **local handlers**, not claimed canonical registry registrations. Production wiring belongs to the API owner: bind canonical SC-01 actor/admission, audit, rate/retention/quarantine policy and existing operation contracts to these application-service methods. Do not deploy this development transport or use its temporary local token as a replacement for canonical authentication. No shared gateway, queue or release workflow is added.

## Verification

`go test -race ./...` with `MAIL_TEST_ADMIN_DSN` runs HTTP-to-PostgreSQL tests for tenant/account/mailbox isolation, search and repeated pagination, cancelled reads, wrong/expired sessions, Origin/Host/peer checks, scope injection, unsupported effects, missing/corrupt originals and recovery. Existing ingestion/import/export tests remain in the same suite.

Optional real-browser acceptance requires Python Playwright and an installed Chromium. It starts/stops its own local reader process using the existing database/objects; successful responses always come from the real backend. Only timing and network failure are injected:

```sh
export MAIL_LOCAL_BINARY=/tmp/mail-local
export MAIL_BROWSER_EVIDENCE_DIR=/tmp/sandy-mail-browser-evidence
python3 localtest/browser.py
```

The test checks desktop/mobile rendering, hostile HTML, search, aborted/stale requests, retry, no external requests, and process restart/session revocation with the same durable receipt. Screenshots and JSON results are local evidence, not independent or provider acceptance.
