# Statement CSV contract, version 1

This importer records statement evidence. It does not create a financial journal,
record a payment, connect a bank feed or automatically reconcile anything.
The local workspace accepts only the fixed files in `synthetic_csv.ts`, including
copies selected through its file picker. Arbitrary customer files are rejected.
The application service requires a source accepted by the canonical Files
boundary; its production owner bindings remain uninstalled.

## Format

UTF-8, optionally with a BOM, with the exact four-column header:

```csv
source_key,date,amount,reference
SYNTHETIC-001,2026-10-03,100.00,"Synthetic receipt, invoice 1"
SYNTHETIC-002,2026-10-04,-2.50,Synthetic unresolved fee
```

- Source keys must be stable bank/provider line IDs within the selected account.
  The importer never generates an ID from a date/amount fingerprint.
- Dates are valid `YYYY-MM-DD` calendar dates. Locale/date order is not inferred.
- Amounts are signed decimal strings in the selected book's base currency and
  precision. Receipts are positive; withdrawals are negative. Zero, exponent
  notation, grouping separators and excess precision are rejected.
- Commas, quotes and newlines in a field use CSV double quoting; embedded quotes
  are doubled. References remain literal text, including formula-like strings.
- Limits: 200,000 UTF-8 bytes and 2,000 data records. A record number counts the
  header as record 1; it is not a physical line number for multiline fields.
- Vendor-specific column mapping, foreign-currency statements, OFX/QIF, balance
  columns and opening/movement/closing statement checks remain unfinished.

## Preview and import

`accounting.banking.statements.csv.preview` takes `bank_account`, `csv`, `source`
and `decisions`. `source` is the existing file/revision/SHA-256/locator reference.
Its hash must match the actual supplied UTF-8 CSV bytes, and access is checked.

| Preview state | Meaning and required action |
| --- | --- |
| NEW | No existing source key or unresolved exact-content collision. |
| DUPLICATE | Same source key, date, exact amount and reference; reuse the original statement ID. This also catches repeated records within a file. |
| SOURCE_CONFLICT | An existing key has different content. Existing content is shown; import is blocked and history is never overwritten. |
| POSSIBLE_DUPLICATE | Different IDs have equal date, amount and reference. No automatic deletion or import. Review the original source and choose KEEP_DISTINCT or SKIP with a reason. |
| SKIPPED | A reviewer explicitly skipped a possible duplicate; decision and reason are retained. |
| INVALID | Invalid fields, amounts or dates; the whole import is blocked. |

Possible-duplicate summaries show the full candidate count and up to 20 IDs.
They are exact-content comparisons, not fuzzy merchant matching. A review
decision includes the record number, decision and nonempty reason. Decisions
against unrelated records are rejected. Re-preview after a decision.

`accounting.banking.statements.csv.import` takes the same input plus the returned
`preview_digest`, `expected_revision`, and the command's idempotency key. The
company book lock, current source check, preview digest and book revision bind
the import to the reviewed state. A stale review must be refreshed. Any unresolved
row blocks all inserts; valid rows are not silently imported from a failed file.

New statement rows, the immutable import receipt, command result and audit event
commit together. Same-key retry returns one receipt, with source access rechecked.
A deliberate import of an overlapping file may create a new receipt but does not
duplicate statement rows. Each receipt maps CSV records to original statement
IDs and retains the source hash, actor, timestamp, preview classification and
review decisions. `accounting.banking.statements.imports.get` rechecks source
access before returning that history.

## Reconciliation review

The deterministic review queue compares account, date and remaining signed amount
against posted bank entries. It distinguishes exact candidates, partially matched
amounts, ambiguous candidates, missing exact matches and locked periods. A bank
entry offered to multiple statement lines is ambiguous even when each statement
has only one candidate. Suggestions never write journals or matches.

A reviewer selects a specific journal/line and amount using the existing guarded
reconciliation command. Concurrent approvals cannot exceed either remaining
balance. Undo appends a match reversal with a reason; statement lines and ledger
journals remain unchanged. The reconciliation report's difference is **statement
minus book**. An unexplained fee remains an exception until separately resolved
through authorized accounting work; no balancing entry is invented.
