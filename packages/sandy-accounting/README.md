# Sandy Accounting — internal alpha

Scope: **SANDY-ENG-0013 v1.1**, PR #286. This is executable original accounting
software with synthetic fixtures, not full Xero parity. The
[complete delivery register](../../docs/sandy-accounting/delivery-register.json)
keeps all 352 functions, 87 reports, 15 intelligence capabilities and 31 gates
open until individually accepted.

## Run locally

Requires Node 24. Install the pinned development dependencies with `npm ci` in
this directory. Then:

```sh
npm run check
npm test
npm run demo
```

Open `http://127.0.0.1:4313`. Only synthetic books are available; the fixture
has no production authentication, provider credentials, network clients, mail
send or money movement. Data persists in
`/tmp/sandy-accounting-synthetic-books`; use `ACCOUNTING_FIXTURE_DIR` to choose
a different isolated test directory. Do not point this at real customer data.
The local server binds only loopback, verifies Host/Origin and an ephemeral page
nonce, limits bodies and has no CORS allowance. Source material is a fixed,
explicitly synthetic worksheet.

Browser verification: `python3 browser_test.py` (Playwright and Chromium
required). It creates temporary books and checks actual UI actions, balances and
source drilldown. Evidence goes to `/tmp/sandy-accounting-browser-evidence/`.
The 10,000-voucher test takes several minutes; it uses an independent integer
balance oracle and does not claim regulatory coverage.

## Implemented foundation

- TypeScript application service with exact decimal strings / BigInt
  calculations and NUMERIC PostgreSQL storage. Input precision is rejected
  rather than silently rounded; FX is a sourced rational with explicit
  half-away-from-zero rounding. A rounded imbalance is rejected, never silently
  plugged.
- Atomic posting, per-company transaction lock, immutable posted journals/lines,
  linked reversal/correction, monotonic period lock, draft invoice/bill approval
  and partial payment recording. AR/AP controls cannot be changed via manual
  journals. Payment corrections and document voids preserve effective-date
  history. The workspace exposes dated payment reversals and document voids
  with a required reason, payment history and journal drilldown. A matched
  payment must be unreconciled before correction; its statement evidence stays
  visible and unmatched until separately resolved.
- Separate immutable bank statement lines, source-key deduplication,
  partial/multiple matching, duplicate-match protection and append-only undo.
  Match suggestions do not post or reconcile anything.
- Seven basic accrual report selectors: trial balance, P&L, balance sheet, GL
  detail, aged AR, aged AP and bank reconciliation. Exact contributing journal
  lines and source references are available. Balance-sheet profit is a separate
  current-earnings figure; display balances use debit-positive signs.
- Explicit 13-week/12-month scenarios from supplied cash inputs. The service
  combines recorded bank/AR/AP only; probability and missing obligation
  assumptions are visible. This is deterministic modelling, not a trained
  predictive model or statutory engine.
- Transactional idempotency receipts and digest-linked audit events. Source
  access is rechecked during posting and drilldown; identity/authority is
  rechecked after obtaining the book lock. The real trusted boundary must supply
  current authorization; request fields never grant it.

## Storage and production boundary

`schema.sql` is a **local isolated PostgreSQL data-plane candidate**, not a
Supabase migration. PGlite runs actual PostgreSQL constraints/triggers/RLS
locally. It serializes transactions on its single embedded database; the retry
test alone does **not** prove multi-process PostgreSQL concurrency. The separate
`postgres.test.ts` suite runs the same service against PostgreSQL 17.6 with a
12-connection pool and a restricted application login. It covers duplicate and
distinct concurrent postings, approval/payment races, lock-wait revocation and a
genuinely committed transaction whose acknowledgement is deliberately lost. Its
connection URL must target loopback and `sandy_accounting_test`; the fixture
requires a fresh database and never resets an existing schema. CI supplies a
disposable PostgreSQL service. Production Cloud SQL placement, HA/PITR,
production role separation and target-specific acceptance remain required.

`Accounting.execute` is a proposed colocated application-service boundary under
SC-01/SC-04, not an installed Sandy API endpoint. `Boundary.authorize` must be
wired to canonical Sandy API identity/admissions and exact
operation/input-digest approval. `Boundary.evidence` must resolve existing
Universal Files version/hash/ACL state. There is no default production
implementation. `fixture.ts` is solely synthetic and must never become the
customer identity adapter. The `accounting_fixture` role is NOLOGIN and local
only; custom GUCs are trusted server context, not customer-supplied
authorization.

No live registry, gateway, provider, runtime, shared identity, Mail, Cloud,
Hosting or customer database is changed. Domain events are local accounting
audit records; they do not create a second mission scheduler. A later reviewed
adapter must atomically bridge domain effects to the existing receipt/outbox
contracts without dual-write loss.

## Known limits

No customer-ready onboarding, COA editing, cash-basis reporting, tax calculation
rule packs, payroll, STP/BAS/SuperStream submission, real bank feed, payment
rail, invoice sending, full credit/refund/recurring lifecycle, tracked
inventory, assets, projects, lossless migration/export or full report catalogue.
Foreign-currency document settlement/revaluation is not implemented. No general
AI model or unattended Autopilot grant exists. Source references are metadata;
originals remain owned by Universal Files. Report layouts and exports,
accessibility audit, scale/DR, accountant review and independent acceptance
remain open.

Revert/remove this isolated package to roll back a source release. Preserve any
local synthetic database for investigation; deployed accounting data would
require a separately reviewed forward repair, not deletion of posted journals.
