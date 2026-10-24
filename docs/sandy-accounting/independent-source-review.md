# Accounting core independent source review — 24 October 2026

## Authority and review boundary

Two separate AI reviewer agents, `financial_review` and `integrity_review`, reviewed frozen source **995283e63594fa65af391dca9bab67816b81c3c5** in draft PR299. They received the review task without the author's conversation history, inspected actual source, and ran their own probes. This is independent source review relative to the implementation author, **not professional accountant, security, regulatory or product acceptance**.

Authority remains SANDY-ENG-0013 v1.1, PR286 head `2cf5f04650d9623a78daf0894dc6b670936aa9ed`; canonical scope SHA-256 `94b54e08d51bd7fb82394ae8972a9f84c7e6a85c4afaf87d97c96ae8341dbde6`. The repository transcription includes all 352 function IDs, 87 reports, 15 intelligence capabilities and 31 acceptance gates. The private original inventory attachment was not available for independent comparison. Accounting 0013, My Voices 0014 and Mail 0015 remain unchanged.

## Confirmed findings and corrections

| Finding | Reproduction and impact | Correction and regression |
| --- | --- | --- |
| P2: SQL FX validation rounded the division before rounding the result | USD +0.03/-0.03, precision 2, supplied rational rate 499999999999999999/999999999999999999 should produce AUD +0.01/-0.01. SQL NUMERIC intermediate rounding produced +0.02/-0.02 and rejected the correct service posting. The rejected commands rolled back; no corrupted API posting was observed. | Integer quotient arithmetic now computes nearest rounding with ties away from zero without an intermediate fractional division. `review_regressions.test.ts` covers below/at/above half, large amounts, cross-precision, signed lines and exact dated reversals. Real PostgreSQL repeats the reported boundary and reversal. Ratios must be decimal strings in both service and SQL. |
| P2: browser omitted same-key recovery for some ambiguous responses | After a real commit, truncated JSON or `commit_outcome_unknown_retry_same_key` hid Retry. A second Save used a new key and encountered a uniqueness error; same-key replay recovered the original receipt. No duplicate financial effect was demonstrated. | Fetch/body parsing, ambiguous errors, 5xx/408 and missing result preserve an immutable copy of the request/key. Other commands are blocked until recovery; denied recovery retains the pending request. Recovery shows the receipt, refreshes the workspace, clears stale draft editing and CSV preview state. `recovery_browser_test.py` injects four response failures after real commits, a denied retry, draft-edit loss and CSV-import loss. |
| Trusted database-role hardening: manual AR/AP postings bypassed the service restriction | Direct fixture-role SQL posted manual AR 25 / sales -25 without a document, leaving trial balance and aged AR inconsistent. This was not reachable through the checked API operation. | SQL posting guard now rejects manual AR/AP control-account lines and unknown journal-source labels. Direct-role tests assert rejection and rollback, including on PostgreSQL. This bounded guard does not establish full production role separation or validate every possible trusted-role source spoof. |

## Review probes and coverage

Financial reviewer independently verified seven historical cutoff account maps, aged AR and cash profit across partial payments, applied credits and out-of-order reversal dates; 16 existing core/cash/credit/correction/temporal tests; 5,376 component-allocation cases; and 120,600 integer ratio checks. The independent seven-cutoff expected values are retained as executable fixtures.

Integrity reviewer ran the real PostgreSQL multi-connection suite and independent negative-statement tests: competing -60 matches against -100 allowed only one, retained -40 residual, completed correctly, and undo restored -60. A failure injected after CSV line insertion but before its receipt rolled back statement rows, command and book revision; retry succeeded and source revocation blocked replay. Twelve focused boundary/CSV/core/crash tests passed; the timezone test was skipped in that particular invocation because no PG URL was supplied. The author's subsequent PostgreSQL invocation includes that timezone test.

Before committing the corrections, the author ran all three new regression tests (3 passed), TypeScript/scope checks, actual PostgreSQL 17.6 concurrency/timezone tests (2 passed, 0 skipped), and the response-recovery Chromium workflow (passed, six audit events, zero journals or duplicate financial effects). Full suite and existing browser reruns, and separate-agent re-review of the corrected source, are recorded in a follow-up checkpoint once completed; they are not implied by these initial results.

## Limits and unchanged gates

- PR299 stays **draft**. Its earlier ready transition was denied by automatic approval review and remains stopped at the parent's explicit instruction. No retry, bypass, merge or live deployment is part of this review.
- No repeat of failed VM discovery. Existing staging host/database and canonical identity/company/Files/admission bindings remain unverified or unbound as recorded in implementation evidence. No infrastructure, credentials, IAM or shared data migration changed.
- Browser pending-request recovery is in-memory for the current page, not a durable queue across reloads. Database idempotency receipts remain durable; complete cross-session recovery is still open.
- Fixture SQL is not the production role/tenancy release design. Trusted-role writes and all source relationships need broader production hardening and owner-reviewed release configuration.
- Synthetic fixtures cover selected invariants, not all financial permutations, AU tax/payroll rules, real feeds, production failover or all scope functions/reports. No external financial action or regulatory certification occurred.
- Scope remains open: 37 functions partially delivered, 315 not started, seven report selectors partial, **zero independently accepted gates**. Source review must not change these counts into accepted functionality.
