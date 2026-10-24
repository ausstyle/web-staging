# Sandy Accounting — Product, Platform Architecture & Engineering Delivery Scope
**Version:** 1.0 | **Date:** 24 October 2026 | **Status:** Proposed, not deployed or certified
**Requirement floor:** Xero source F001–F352 and every named report catalogue entry


---

# Document control and interpretation

| Dimension | Decision / rule |
| --- | --- |
| Owner | Sandy AI product and engineering; formal go-live sign-off by financial controls, security and Australian payroll/tax subject-matter owners |
| Scope authority | All 352 F-IDs and the reports in [U1] are mandatory at full Xero-parity GA. No F-ID silently dropped due to limited observation, an add-on, subscription tier, beta or error screen. |
| Source hierarchy | [U1] sets baseline requirements; public official vendor features [S1]–[S6] extend competitive scope; regulator materials [S7]–[S18] inform compliance gates; proposed architecture is design, not an assertion of currently running services. |
| Feature interpretation | Recreate business outcome rather than Xero-specific layout, proprietary brand/service, failure message or customer-specific integration. Example: F352 requires reliable recovery, not replication of a session-expired defect. |
| System of record | Accounting subledger and journal postings in Sandy Accounting. Sandy Intelligence must not be the balance-calculation authority. |
| Repository fit | Align with Sandy’s existing canonical API/MCP boundary, runtime missions and receipts, company permissions, universal file ownership and commercial entitlements; no duplicate orchestration or identity layer. |
| Phase terminology | GA = full Xero-parity release. Earlier pilots are explicitly incomplete and must not be marketed as full Xero replacement. |

# 1. Executive mandate

Build Sandy Accounting as a first-party, multi-tenant Australian cloud accounting platform capable of replacing a fully featured Xero organisation without sacrificing transactional integrity, statutory payroll, reconciliation, history or the ability to exit. Sandy Intelligence is native but governed: it discovers work, proposes corrections, prepares journals or reports, carries out bounded low-risk actions under delegation, and produces human-readable, evidence-linked explanations.

The customer must be able to use the product entirely through conventional screens and APIs if AI is unavailable. Every posted amount must be reproducible from deterministic accounting rules and immutable source evidence; a chatbot explanation or a background job admission cannot be construed as posted, paid, lodged or reconciled.

# 1.1 Contractual minimum

- Functional parity: F001 through F352, inclusive, all mandatory. Include the original review’s interface expectations where useful for familiarity, and implement actual end-to-end workflows rather than control-only mockups.
- Full report parity: every named financial performance, statements, receivables/payables, payroll, projects, reconciliation, tax, transaction and analytics catalogue entry in Appendix B.
- Foundation: robust general ledger, AR/AP, banking, GST/BAS preparation, Australian payroll, STP Phase 2, Payday Super, fixed assets, tracked/untracked inventory, projects, multi-currency, reporting, and accountant collaboration.
- External finance operations: real collections and payout partners, bank feeds, eInvoicing and ATO transmission only after appropriate authorisations, onboarding and separately verified provider receipts.
- Portability: import historical information from Xero, MYOB, QuickBooks, Reckon and traditional files with independent financial reconciliation, and permit complete documented exit exports.
- Product advantage: cross-channel Sandy Intelligence with explainable bookkeeping, proactive client workflows, quality controls, cash forecasting and company-wide financial context without unapproved payments or filings.

# 1.2 Definition of success

For an accepted migration cohort, opening balances, posted journal totals, trial balance, aged receivables and payables, bank statement closure, report calculations and relevant payroll YTD totals reconcile to independently signed baselines. All mandatory F-ID tests and report contracts have recorded pass evidence; restricted integrations have valid production or explicitly disclosed pre-launch blocks. The programme is not complete because menus render.

# 2. Competitive research and incremental scope

This is a public-feature comparison as at the research date, not an independently tested claim of the products’ current depth. Availability differs by plan and jurisdiction. [S1]–[S6]

| Product | Published capabilities significant for Sandy | Engineering implication |
| --- | --- | --- |
| Xero Australia [S1][S2] | Invoicing, quotes, bills, banking, reconciliation, expenses, payroll, GST/BAS, projects, inventory, multi-currency, assets, analytics, JAX, eInvoicing and integrations | Mandatory base parity, including high-tier features and AU-specific accounting workflows. |
| MYOB [S3] | BAS lodgment, local payroll/STP/super, timesheets and rosters, jobs, inventory, multi-currency, payments | Include Australian payroll compliance and stronger job allocation/roster interfaces. |
| QuickBooks AU [S4] | Automated workflows, anomaly/error detection, AI-powered finance/customer/project assistance, advanced roles, Excel data sync, backup/restore and customer lifecycle | Add precise approval workflows, configurable fields, governed automation, versioned restores and analyst-friendly interchange. |
| Reckon [S5] | Bank feeds, payment/reminder processes, stock tracking, Australian payroll/super and mobile apps | Competitiveness for lean SMEs; fast migration and comprehensive mobile functionality. |
| Zoho Books AU [S6] | Customer and vendor portals, sales orders, inventory reorder points, landed cost, scheduled reports, approval and custom workflows | Add two-sided self-service portals, sales-order lifecycle, procurement and advanced inventory as expanded GA coverage. |

Differentiating requirements beyond Xero: autonomous-but-approved close assistant; proof-linked bookkeeping; cross-company treasury; contract/subscription expense discovery; vendor intelligence; audit-aware natural-language journal explanations; user-controllable AI; error-recovery transparency; and company/people context integrated across Sandy Mail, Drive, tasks and calendar.

# 3. Mandatory functional coverage map

| Sandy functional area | User-source F IDs | Mandatory outcome |
| --- | --- | --- |
| Platform, navigation, dashboard | F001–F023 | Organisation switching, search, creation shortcuts, dashboard, banking/payables/receivables tasks. |
| Sales and customer revenue | F024–F092 | Full invoice, quote, credit, statement, payment link, recurring, reminder, template and branding lifecycle. |
| Items and money movement | F093–F113 | Products, services, inventory, online customer payments, supplier payout preparation and tracking. |
| Accounts payable and expenses | F114–F149 | Bills, data capture, approvals, purchase orders, expenses, receipts and mileage. |
| Banking and bookkeeping | F150–F197 | Bank feeds, reconciliation, cash coding, rules, journals, recoding, COA, fixed assets, documents and audit. |
| Reports and financial analysis | F198–F221 | Searchable audit register, all report options, drill-down, historical and projected analytics. |
| Australia tax and master records | F222–F280 | BAS, GST, TPAR, users/roles, contacts, currencies, conversion, financial settings, import/export. |
| Projects and payroll | F281–F342 | Projects/time plus end-to-end employee, pay-run, leave, payslip, super and STP flows. |
| Advanced analytics and assistant | F343–F352 | Custom dashboards, share/export, analytics AI and reliable session recovery. |

The complete requirement-by-requirement register, including the source-observed function and evidence quality for each F-ID, is reproduced in Appendix A. Source account screens include observed, listed, introductory and access-limited features: none is incorrectly represented here as an executed transaction.

# 4. Functional requirements — finance core

## 4.1 Organisations, companies and chart of accounts

Requirement family CORE-01 | All linked F-IDs in Appendix A mandatory.

- Unlimited logical company books subject to published plan quotas; ABN/ACN/legal identity, financial-year selection, industry, registered and postal addresses, user roles and accountant invitations. Company scoping applies to Sandy missions, memory, tasks and files.
- Configurable Australian chart of accounts with system protection, account types/subtypes, control accounts, GST mapping, hierarchy, import/export, reconciliation to opening/conversion balances, per-company lock dates and cross-company consolidation views.
- Accrual ledger as the single truth, cash-basis reporting as a deterministic view; time-zone-aware effective dates, period close and re-open under controlled role and audit.
- Journal entity: immutable postable journal header/line set, currency and base currency amount, tax classification, third-party and dimension links, attachment digests; postings must balance by currency/book and reject invalid states.
- Credit/debit reversals, auto-reversing journals, batch recode with preview, error handling, and original-to-correction lineage. Never destructively edit a posted journal.

## 4.2 Accounts receivable and sales

Requirement family AR-01 | All linked F-IDs in Appendix A mandatory.

- Quote draft–sent–accepted/declined/expired–invoiced lifecycle; quantity, discounts, tax inclusive/exclusive, project and tracking assignments, revisions, PDF branding and customer acceptance evidence.
- Invoice draft, approval, outstanding, partial-paid, paid, credited, written-off, voided and recurring templates; sequence control; item pricing, tax and mixed lines; duplicates/idempotency; deposits/prepayments/overpayments and contact credits.
- Email/SMS/link delivery with templates, branding themes, QR/payment references, Peppol eInvoice via partner, online card/bank payment links, follow-ups and per-contact suppression rules; record delivery, receipts, bounce and failures.
- Customer statements, aged receivables, debtor ranking, custom terms, credit limit controls, reminder schedules, payment matching and customer portal.
- Reversals, refunds and chargebacks with separate bank/provider settlement fees, suspense treatment and ledger reconciliation.

## 4.3 Accounts payable, procurement and expenses

Requirement family AP-01 | All linked F-IDs in Appendix A mandatory.

- Supplier bills: email-forwarding address, upload, secure document extraction, CSV/API imports, duplicate validation, PO matching, line accounting, GST, project on-charge and vendor credits.
- Purchase requisition → purchase order → receipt/commitment → bill → payment; approvals, delegation, supplier statements, recurring bills and payment terms.
- Expense claims: phone receipt, mileage by trip inputs, per-line coding, currencies, approval, reimbursement, employee expense limits, accountable persons and audit evidence.
- Supplier payment preparation: bank account verification, bank transfer/PayID/BPAY/other partner-supported rails, batch and scheduled payments subject to partner capability, maker/checker and receipt verification.
- Payment runs must not mark a bill paid solely because a partner accepted a batch; reconcile provider response, bank settlement, reversals and individual payout exceptions.

## 4.4 Banking and reconciliation

Requirement family BANK-01 | All linked F-IDs in Appendix A mandatory.

- Manual bank account/card registers and bank-feed integrations with safe consent renewal, historical backfill and source/dedup keys; support uploaded CSV, OFX, QIF and standard Australian bank statement formats where technically possible.
- Distinct immutable raw statement-line store and posted book transaction store; parallel running balance, matching and status with explicit timing differences, missing lines, partial matches, transfers and split transactions.
- Side-by-side bank reconciliation, rules for spend/receive/transfer, bulk cash coding, unreconciled exceptions, notes/discussion and manually adjusted entries with permission controls.
- Financial control: daily opening + movements = closing checks, no duplicate imports, reversible mistakes, prevent duplicate reconciliations, bank recon statements by date and period-end close.
- Confidence-based machine suggestions with rule attribution and preview; a proposed match is not automatically finalised unless tenant-delegated policy specifically permits the amount/risk and deterministic checks pass.

## 4.5 Products, inventory, projects and assets

Requirement family OPS-01 | All linked F-IDs in Appendix A mandatory.

- Searchable item and service catalogue, purchase/sale tax/account defaults, prices, identifiers and tracked/untracked items, stock adjustments, transfers, replenishment and historical movements.
- Inventory valuation method must be documented, reproducible and consistent; support backorders, landed cost allocations, reorder warnings, negative stock policy and committed-stock reporting.
- Sales orders, item receipt/fulfilment, purchase order matching, inventory–COGS journals and stocktake adjustment approval.
- Project/job budgets, estimates, time entries/timers, billable expenses, staff cost and charge-out rates, profitability, progress and project invoice flows; integrate Sandy task/mission references without making them the journal authority.
- Fixed asset registry, pools, book and tax depreciation, acquisition/capitalisation, disposals, reversals, reconciliation to control accounts, schedules and attached documentation.

## 4.6 Contact and document evidence

Requirement family CRM-01 | All linked F-IDs in Appendix A mandatory.

- Unified business customer/supplier contacts with ABN/ACN, multiple persons, addresses, bank remittance details, price/credit/payment defaults, activity, notes, related email threads and separate company access rights.
- Dedupe and merge with stable aliases, groups, smart lists, documents and transactional lineage; never permit a merge to collapse two distinct legal entities without clear review.
- Each financial record may attach original PDF/email, structured extraction, hash, scan/quarantine result, signed ingestion source, version and retention policy; source email remains retrievable where permitted.
- Documents inbox, archive, search, preview, extraction and linking to accounting records; integrate existing Sandy universal file owner rather than create a second uncoordinated file service.

## 4.7 Reporting, forecasts and finance analytics

Requirement family RPT-01 | All linked F-IDs in Appendix A mandatory.

- All report catalogue entries in Appendix B; filters for entity/account/tracking/currency/dates/cash-vs-accrual, prior periods, budgets and comparative trend.
- P&L, balance sheet, cash flows, movements in equity, trial balance, journals/GL, aged AR/AP, GST reconciliation, payroll, projects, inventory and assets derived from versioned ledger read models.
- From every numeric report cell, drill to exact contributing journal lines and source documents with live permission checks, calculation time and report revision.
- Custom layouts, management report packs, graph and KPI dashboard editor, favourite reports, scheduled delivery, PDF/CSV/XLSX export, formulas, variance and commentary.
- Short/long cash forecasts at 30/60/90/180-day windows, scenario inputs, payment probability controls and reconciliation of predicted vs actual; forward projections distinguished from accounting fact.

# 5. Australian payroll, tax and statutory services

## 5.1 Payroll engine and employee administration

- Employee and contractor lifecycle with start/end dates, employment classifications, TFN/residency declaration fields, income types, employee onboarding, document privacy, pay calendars and off-cycle/termination corrections.
- Earnings, allowances, overtime, penalties, bonuses, reimbursements, deductions, salary sacrifice and configurable pay items; preserve effective-dated pay classifications and applicable modern award/EA arrangements. Do not claim full award interpretation without separately validated rule packs.
- Leave accruals, balances, approvals, annual/personal/long-service/unpaid leave as applicable, public holidays by jurisdiction, employee self-service, timesheets, rosters (competitive addition), leave cash-out with statutory review.
- Pay-run draft–review–approve–post–pay–report workflow with line-by-line taxes, PAYG, net pay, super liabilities, payslip history, payroll journals and secure payroll privacy boundaries.
- Migration of YTD balances, payroll identifiers, prior STP history, leave and super commitments with side-by-side reconciliation.

## 5.2 ATO STP Phase 2 and statutory reporting

- Produce compliant STP Phase 2 PAYEVNT payloads and adjustments, finalisation and error handling, year selector, filing history, migration identifiers, key corrections and taxpayer declarations.
- Complete ATO DSP registration, relevant OSF security evidence, extended conformance testing, EVTE, production verification and required service whitelisting before any claim of live ATO reporting. A partner SSP is a supported transport path but does not remove software product responsibility. [S7][S8][S16][S18]
- Support PAYG withholding and superannuation reportable classifications; continuously maintain effective-dated calculation policy data, validation rules and ATO artefact versions rather than hard-code assumptions.
- Provide evidence of ATO acceptance/rejection and retriable pending states; a filing button, message queue or partner HTTP 200 is not proof the obligation was lodged.

## 5.3 Payday Super from 1 July 2026

Australian Payday Super is in effect as at the document date. The published ATO guidance describes 12% super guarantee on qualifying earnings and contribution receipt by the fund within seven business days of payday, subject to applicable exceptions. This is a statutory engine requirement, not an optional later enhancement. [S9][S17]

- Model qualifying earnings by pay item, effective date and super rule version; calculate contributions on each payday and expose contribution-level expected receipt deadline.
- Integrate a SuperStream-compatible gateway/payment partner; support fund/USI validation, batches, rejections, returns, retries and reconciliation of amount debited to amount received/accepted.
- Show per-employee/fund exception queues, unpaid exposures, ATO reporting alignment, receipt evidence and deadline alerts; no silent status change from authorised to complete.
- Retain payroll/super historical calculations and rule revisions for audit and recomputation.

## 5.4 GST, BAS/IAS, TPAR and other Australian tax

- GST inclusive/exclusive and mixed supply treatment, tax-code maintenance, BAS GST and PAYG labels, GST reconciliation, exceptions, draft activity statements, audit schedules and printable submission packs.
- BAS/IAS and TPAR preparation, adviser review, period close and correction handling; direct electronic lodgment only after ATO/SBR registration, service approval and real acknowledgement verification. [S11]
- Optional support for fuel-tax credits, WET, FBT instalments and other relevant BAS fields as configured; no assumption every organisation has every tax obligation.
- Business-specific rate/version catalogue and accountant override with evidence; Sandy can suggest classifications, never represent unsupported advice as a definitive tax ruling.

# 6. Sandy Intelligence — AI-native differentiator

Sandy Intelligence is a cross-channel assistant that consumes tenant-authorised facts from the ledger and related files, email, tasks and projects, then proposes or executes narrowly permitted business operations using canonical Sandy API tools. It must make clear whether it is observing, proposing, approved, posted, paid, lodged or verified. The deterministic accounting core runs independently of model availability.

| Intelligence capability | What Sandy actually does | Safeguard / evidence |
| --- | --- | --- |
| Bookkeeping autopilot | Extract source bills/receipts; propose suppliers, tax, coding and dimensions; seek batch approval for unknown items | Evidence link + confidence + duplicate detection + configured monetary and GST rules. |
| Bank reconciliation copilot | Find matches and counterparty context; suggest splits/transfers and narrate exceptions | Original bank line and book entry displayed side-by-side; reversible approval flow. |
| Expense and contract steward | Discover subscriptions, telecom, utilities, insurance, finance commitments and uncategorised repeat spend; suggest contract requests and saving actions | Opt-in collection; no automatic cancellation, sharing, vendor contact or purchase without delegated permission. |
| Financial question answering | “Why has margin fallen?” “Which invoices are overdue?” “Show cash by company.” | Report SQL/view output, visible period/basis, links to underlying lines; mark missing data. |
| Proactive financial controller | Detect duplicates, incorrect GST, late payments, unusual vendors, payroll variances and nearing deadlines | Issue severity, reproducible test, proposed remedy, ownership and closure state. |
| Smart debtor follow-up | Prepare personalised polite reminders, explain prior correspondence, suppress disputed invoices | Sent only after role-authorised approval or standing grant; actual delivery receipt. |
| Close and tax assistant | Assemble month-end/BAS checklist, produce journal previews, reconcile balances and identify unresolved items | Hard gates for locked period, review and sign-off; never auto-lodge under vague authority. |
| Multi-company intelligence | Compare companies, cross-company cash position and intercompany exposures | Strict entity boundaries, elimination entries and exportable consolidation workings. |
| Scenario modelling | Explain 13-week cash outlook, debt coverage and payroll/supplier funding under scenarios | Clearly hypothetical estimates, assumptions, stale-data flags and confidence bands. |
| Accountant collaboration | Draft client queries, request proof, explain journal proposals and prepare review packs | Accountant-only access, source links, approvals and audit. |

## 6.1 AI policy and risk classes

| Risk | Examples | Default control |
| --- | --- | --- |
| R0 read only | Reports, search, summarise, forecast, citations | Authenticated data scope + evidence/freshness; no side effect. |
| R1 reversible draft | Unposted invoice, coding draft, journal preview, internal task | Bounded standing grant if permitted; no external customer delivery. |
| R2 business external | Send reminders, approve invoice, publish reports, alter bank rules | Explicit approval or tightly scoped, expiring delegation and receipt; dual approval as configured. |
| R3 funds/payroll/ATO | Execute bank payment, refund, finalise payrun, STP filing, BAS lodgment, modify payroll bank details | Default explicit high-assurance owner/finance-authority confirmation; maker-checker for payment; independent external receipt. |
| R4 destructive or privileged | Bulk correction of posted periods, delete/restore data, user rights, data exports, key changes | Privileged operator; change plan, separation of duties, immutable logs and safe rollback. |

AI prompt-injection defence: documents, emails, PDF descriptions and bank narrations are untrusted source data. They may influence extracted facts, never grant authority. Model output must be schema-validated; ledger/posting rules, payments, approval policy, tax mapping and multi-tenant access are enforced server-side. Conversation assertions never upgrade evidence state.

# 7. Recommended reference architecture

Proposed system consistent with Sandy shared contracts (AD-01 through AD-07, SC-01 through SC-08): one canonical Sandy API/MCP surface, server-derived company authority, durable missions/jobs/receipts, one fact owner, outbox/inbox, idempotent external effects and verified results. Existing Supabase project zmqlyygzqoidkcwdysok continues as the Sandy control-plane and identity/mission reference. The selected future customer accounting data plane is Google Cloud SQL for PostgreSQL, with Cloud Run services and Cloud Storage; this is a target decision subject to tenancy/region/compliance ADRs, not an assertion that instances have been provisioned.

```text
Channel / UI / Accountant portal / Mail / Voice / WhatsApp
   ↓
Sandy API and canonical authorisation / company grants / receipts
   ↓
Accounting core (GL, AR, AP, BANK, PAY, TAX, INV, PROJ, REPORT)
   ↔ Sandy Intelligence and durable missions
   ↓
Cloud SQL PostgreSQL authoritative ledger + outbox
   ↔ Workers / CDR / payment provider / Peppol / ATO SSP / SuperStream
   ↔ Cloud Storage: sources, exports, snapshots
```

## 7.1 Deployment responsibilities

| Layer | Proposed technology | Non-negotiable boundary |
| --- | --- | --- |
| Existing Sandy control plane | Supabase project zmqlyygzqoidkcwdysok | Identity, company access mapping, mission commitments, universal file metadata and operation registry remain single-owner domains unless migration is explicitly approved. |
| Accounting domain service | Typed TypeScript modular accounting core on Cloud Run | All postings/financial mutations via versioned Sandy API operations; no client-issued SQL writes. |
| Authoritative financial DB | Cloud SQL for PostgreSQL; HA, PITR, connections/quotas sized by workload | Company/tenant scopes, atomic journal postings and reconciliations, read replica/reporting only as needed. |
| Original documents/files | Google Cloud Storage, content-addressed hashes, existing Sandy file-service interface | Store source EML/PDF/scan/receipt, immutable versions and retention; no silent deletion. |
| Events and tasks | Existing Sandy mission/outbox/inbox machinery; add bounded workers | No duplicate workflow engine; external provider timeout recorded as UNKNOWN_OUTCOME. |
| AI/context | Sandy orchestrator/memory, authorised retrieval projections | Only cite and operate on authorised, fresh sources; sensitive payroll/TFNs in protected scopes. |
| Providers | CDR aggregator / banks / payment gateway / Peppol AP / ATO SSP / super gateway | Provider-specific authority, external enrolment, receipt and reconciliation. |
| Data exports/reporting | Versioned SQL read models, document renderer, secure export object | Reports reproducible by posting cut-off; export all books without proprietary lock-in. |

## 7.2 Data integrity invariants

1. Every accepted journal posting is atomic, balanced and immutable; correction is a linked reversal/replacement, never an unnoticed edit.
1. Every business record has a canonical owner, tenant/company ID, globally unique stable ID, source, actor, lifecycle version, effective period, idempotency key and audit reference.
1. Transaction monetary amounts are stored in exact DECIMAL/NUMERIC values and currency/precision metadata, never floating-point; FX rates are dated, sourced, controlled and reproducible.
1. AR, AP, tax, bank, inventory, fixed assets and payroll subledgers must reconcile to their corresponding general ledger control accounts at every closed period.
1. Provider-facing actions are outbox-driven, idempotent when supported, and reconciled when outcomes are uncertain; payment/lodgment/super “success” requires observed external evidence.
1. Tracking/classification changes preserve the original, the correction approval, the affected entries and before/after report impact.
1. All user-visible reports display entity, period, cash/accrual basis, currency, refresh timestamp and known coverage limits.

## 7.3 Illustrative data ownership and schema

| Domain | Authoritative relational aggregates / entities |
| --- | --- |
| Organisation/security | accounting_tenants, legal_entities, finance_company_grants, accountants, policy_versions, approval_rules, lock_periods |
| Ledger | accounts, fiscal_periods, journal_batches, journal_entries, journal_lines, journal_reversals, dimension_values, opening_balances |
| Sales | contacts, contact_roles, quotations, sales_orders, invoices, invoice_lines, credit_notes, payment_allocations, reminders |
| Payables/payments | purchase_orders, receipts, supplier_bills, bill_lines, expense_claims, payment_intents, payout_batches, settlement_receipts |
| Banking | bank_accounts, bank_feed_consent, bank_statement_imports, bank_statement_lines, bank_rules, match_suggestions, bank_reconciliations |
| Tax/payroll | tax_codes, tax_code_versions, activity_statements, tpar_entries, employees, pay_items, pay_runs, payslips, payroll_ytd, leave_ledger, super_contributions, stp_submissions |
| Operations | products, item_movements, inventory_cost_layers, fixed_assets, asset_depreciation, projects, time_entries, project_costs |
| Evidence/BI | file_references, external_message_receipts, activity_audit, domain_outbox, workflow_receipts, report_definitions, report_snapshots, ai_suggestions |

Names above are logical candidates, not instructions to create duplicate tables. Before implementation, map existing Sandy relations/operation contracts and record an architecture decision for new Cloud SQL tenancy model (row-scoped vs schema-per-tenant vs database-per-tenant).

# 8. API and workflow contract

Each operation has a stable version, exact input/output schema, server-validated actor/company, permission/risk class, idempotency strategy, optimistic version, financial effective date, evidence expectation, immutable handler release and a durable receipt. MCP only adapts the Sandy API; it is not an alternate bank/ATO or database credential path.

| Operation group (proposed) | Representative operations / outcomes |
| --- | --- |
| accounting.organisations.* | create / configure / access-grant / chart.import / period.lock |
| accounting.ledger.* | journal.draft / journal.post / journal.reverse / trial_balance.get / recode.preview / recode.apply |
| accounting.sales.* | quote.create / invoice.approve / invoice.send / invoice.credit / customer.statement.generate |
| accounting.payables.* | bill.capture / bill.approve / payment.prepare / payment.authorise / payment.reconcile |
| accounting.banking.* | feed.connect / statements.import / matches.propose / reconcile.apply / rule.manage |
| accounting.inventory.* | item.create / adjustment.approve / stocktake.close / valuation.report |
| accounting.payroll.* | employee.manage / payrun.calculate / payrun.approve / stp.submit / super.send / contribution.reconcile |
| accounting.tax.* | bas.prepare / bas.review / bas.submit / tpar.prepare / tpar.submit |
| accounting.reporting.* | run / drilldown / compare / saved_report.manage / export |
| accounting.intelligence.* | suggestions.list / suggestion.explain / approval.request / delegated_action.execute / anomaly.dismiss |
| accounting.migration.* | source.connect / batch.import / validate / baseline.reconcile / export.create |

These are candidate operation families; engineering must expand every user-facing action into an explicitly governed canonical operation, reconcile against Sandy’s existing registry, and avoid creating wildcard execution permissions. State transitions use REJECTED, ADMITTED, RUNNING, WAITING, VERIFYING, VERIFIED_SUCCESS, FAILED or RECONCILIATION_REQUIRED as appropriate. No “completed” acknowledgement merely because a call was queued.

# 9. Screens, presentation and accessibility

- Sandy accounting home: company switcher, live bank book vs bank statement, overdue AR/AP, cash timeline, tax/payroll deadlines, suggested actions and user-configurable widgets; distinguish data refresh from posted status.
- Financial workspace navigation: Home, Banking, Sales, Purchases, Contacts, Payroll, Tax, Projects, Inventory, Fixed Assets, Reports, Documents, Intelligence, Settings and Accountant.
- List→detail parity: status tabs, counts/totals, saved filters, full-text search, sortable/resizable columns, bulk selection, pagination/virtualisation, record audit, files and source drill-through.
- Bank reconciliation retains Xero’s efficient statement-left vs match/coding-right workflow, while adding Sandy’s reasons, source links and approval controls.
- Invoice/quote/bill editors offer clear line-grid management, tax currency modes, preview, PDF and branded themes, recurring templates, accessibility and familiar keyboard shortcuts.
- All core workflows usable without generative AI. Responsive mobile-first capture, approvals and payment status; desktop-quality ledger, close and large-report experiences.
- User experience targets: WCAG 2.2 AA for customer and professional interfaces, explicit errors and keyboard/screen-reader usable controls. No misleading green “paid/lodged” state.

# 10. Bank, payment, payroll and tax external integrations

| Integration | First implementation route | Go-live requirement |
| --- | --- | --- |
| Bank data | Commercial bank-feed partner or CDR accredited recipient/representative where supported [S12] | Consent state, historical backfill, duplicate-key proofs, supported institution matrix, regulated privacy handling. |
| Customer collections | PCI-scoped PSP such as Stripe or equivalent; PayTo via eligible partner | Payment identity, refunds/fees/chargebacks, webhooks with signatures, true settlement reconciliation. |
| Supplier payouts | Authorised payment service provider/bank rails including file exchange where available | Maker-checker, destination bank verification, idempotency, reject/return and independent bank receipt. |
| Peppol eInvoicing | Integrate an Australian accredited Access Point first [S10] | Recipient capability discovery, schema acceptance, delivery/receipt state; direct accreditation optional later. |
| STP | ATO-registered/whitelisted Sandy product via SSP or direct SBR gateway [S7][S18] | ATO DSP OSF, STP Phase 2 conformance, authorised SSID/cloud credentials and accepted receipts. |
| SuperStream | Recognised super payment/gateway provider [S9][S17] | Payday Super correct QE, fund receipt tracking, rejects/retries, alerts and reconciliation. |
| BAS/TPAR | ATO SBR-enabled approved service route, depending on registered product scope [S11] | Actual tax services authorisation, positive/negative UAT and lodged/rejected receipt evidence. |
| Email, files and calendar | Existing Sandy Mail, universal files/Drive, task, calendar and provider adapters | Cross-channel ACL, source provenance, tenant/company binding and durable job receipts. |

# 11. Security, privacy, retention and resilience

- Treat accounting and payroll as sensitive financial systems: MFA, per-user authentication, separate accountant and payroll scopes, least privilege, segregation of duties, revocable guest/adviser access, full actor/login history and no shared logins, as applicable under ATO DSP OSF. [S8]
- Encrypt in transit and at rest, use managed keys with documented rotation/access, short-lived workload identity, environment isolation, validated uploads, malware scanning, secret vault and confidential payroll identifiers.
- Company records require at least seven years’ financial record retention under ASIC guidance; employee time/wage records require seven years under Fair Work. Apply longer case-specific obligations when needed; do not hardcode a shorter generic delete policy. [S13][S14]
- Privacy impact assessment and Australian Privacy Principles controls for user/employee identities, tax identifiers, cross-border disclosures, access/deletion requests and automated profiling. [S15]
- Append-only logical audit: human action, AI recommendation, policy authorization, immutable journal revisions, external provider request and independently verified outcome, with tenant-safe investigative search.
- Cloud SQL HA/PITR, backup checksums, separate immutable source-file snapshots, routine restore drills, disaster recovery runbooks, cancellation and correct financial replay/period lock semantics.
- Candidate operational targets to validate before sale: core read p95 ≤700 ms under benchmarked cohort, posting API p95 ≤1.5 s (excluding providers), monthly service availability ≥99.9%, zero unreconciled duplicate posting defects, business-class RPO ≤15 min and RTO ≤4 h where paid HA configured.
- Performance targets are proposed acceptance criteria, not current measured SLAs; actual customer limits and data residency require design choices and cost testing.

# 12. Migration, interchange and customer exit

A credible Xero replacement requires lossless migration and exit, not only CSV import of account names and contacts.

1. Source intake: API/export, CSV/XLSX, OFX/QIF and document/receipt/EML uploads from Xero, MYOB, QuickBooks, Reckon and traditional local accounting archives, with vendor-supported formats and user authorisation.
1. Scan/source retention: preserve original packages, source hashes, extracted entity mapping, provenance timestamps, itemised errors and unresolved references in an immutable migration manifest.
1. Import in dependency order: organisations/settings → COA/tax/currencies/contacts/items → opening balance and historical journal/AR/AP → bank lines/reconciliation → inventory/assets/projects → payroll YTD/leave/super → receipts/attachments and report configuration.
1. Compare baseline: period-by-period trial balance debit/credit, P&L, balance sheet, AR/AP ageing, invoices, GST/BAS reporting, bank statement closing balance, payroll YTD and super liabilities; report differences to the smallest record ID.
1. Parallel-run/cutover: users sign a baseline, lock import epoch, freeze changed source writes where possible, import deltas with idempotent cursor and avoid duplicating invoice sends or payments.
1. Exit/export: full documented JSON/CSV/SQL-neutral tabular ledger data, relationship tables, PDFs/EMLs/source files, reconciliations, custom report definitions, audit history, payroll records, IDs and checksums; create signed download manifest and test reimport in an independent system.
1. User rights: self-service request for their complete lawful data, right-to-exit timeline, retention exceptions, purpose-limited backups and explicit deletion/archival states. Do not promise full deletion where legislation requires retention.

# 13. Delivery work packages and phase gates

Relative sizing is engineering planning only. The full feature floor is mandatory for an Xero-parity GA; pilots cannot be described as equivalent to the complete Xero package.

| Package | Outcome and major F-ID groups | Dependency / release gate |
| --- | --- | --- |
| WP0 — as-built / control model | Read-only Sandy API/Supabase source comparison; PIA, accounting ADR, tax/ATO compliance plan; detailed requirement acceptance design | No implementation before live source/owner mapping and security assumptions checked. |
| WP1 — ledger foundation | CORE ledger, org/COA, journal/tax schemas, cash/accrual, role/lock audit, period closure; F001–F023, F174–F189, F234–F280 | Atomic balancing, tenancy isolation, period-lock, reversal and GL reconciliation suites pass. |
| WP2 — revenue | Customers/items/quotes/invoicing/recurring/reminders/payments links; F024–F108, F243–F257 | Reconcile AR/control account and payment partner settlements; verified delivery. |
| WP3 — purchases and banking | Bill extraction, expense/PO, bank feeds/rules/matching and payment intent; F109–F173 | Bank control and external idempotency/unknown outcome tests pass. |
| WP4 — inventory/assets/projects | Item movements, stock valuation, assets, cost/timesheet, job profitability; F093–F103, F186–F193, F281–F292 | Valuation/COGS/depreciation schedules tie to GL and all source cases. |
| WP5 — AU tax and payroll | STP, QE/payday super, BAS/TPAR, leave, holiday, payroll/employee life; F222–F233, F293–F342 | Regulatory pathway authorised; separate actual ATO/SSP and gateway acceptance. |
| WP6 — reports and BI | Every Appendix B report, configurable dashboards, drill through, forecast and export; F198–F221, F343–F352 | Historical period comparisons and statutory tax/payroll reports tie to source entries. |
| WP7 — Sandy Intelligence | Explainable workflows, annotations, task/approval/memory integration; F007, F018, F029, F195, F268, F321–F322, F351 + enhancements | AI never bypasses accounting approval or financial ACL; source provenance tested. |
| WP8 — import/export, mobile and launch | Cross-vendor migration, accountant portals, mobile, backups, privacy, payment/super/SBR certifications and support | All 352 F-IDs plus report catalogue individually accepted; production canary and exit tested. |

## 13.1 Target release classifications

| Stage | Can claim | Cannot claim |
| --- | --- | --- |
| Foundation/internal alpha | Independent balanced ledger and internal test books | Xero replacement, regulatory filing or safe live payment. |
| Bookkeeping beta | Invoicing, bills and reconciled banking only if verified in authorised pilot | Complete payroll, STP, BAS, asset or advanced analytics parity unless all actually tested. |
| Payroll and compliance limited pilot | Australian STP and super workflows only after provider acceptance | Universally certified, compliance guarantee or all-bank compatibility. |
| Full GA / Xero-parity | Only after all F001–F352 and all Appendix B report tests are signed off, plus required external approvals | No remaining mandatory gaps hidden behind “coming soon” or unsupported third party integration. |

# 14. Test and acceptance framework

Acceptance records must map requirement → canonical operation → source module commit → DB migrations → environment/deployed version → deterministic tests → provider evidence/real target readback → business-owner sign-off. Missing receipt is NOT PASSED. For the source-observed but untested Xero screens, Sandy needs more than menu parity; test the actual workflow.

| Gate | Mandatory verifiable test outcome |
| --- | --- |
| AC01 GL integrity | 10,000 mixed simulated transactions; all posted vouchers balance; no duplicate posting under concurrency; exact trial balance and report reconciliation. |
| AC02 Multi-tenant and payroll privacy | Cross-company and wrong-role attempts across API, files, journals, search, AI, exports, payroll, token revocation and background workers return no data/effects. |
| AC03 Reconciliation correctness | Duplicate bank-feed lines, split, partial, transfer and chargeback scenarios close to statement balances, no double matches and proven reversals. |
| AC04 Invoices/AR and supplier/AP | Draft/approve/send/partial-pay/credit/refund/void/recurring and bill/PO/mileage/claims produce correct control-account entries. |
| AC05 FX and GST | Multi-currency revaluation/unrealised-realised FX, inclusive/exclusive GST, exempt or mixed transactions and BAS columns tested against externally reviewed fixtures. |
| AC06 Payroll and leave | Award/pay-item regression fixtures, multiple states, leave accrual, PAYG, termination, year-to-date and journal totals verified by qualified payroll reviewer. |
| AC07 STP/ATO | STP Phase 2 valid, rejected, correction, finalisation and timeout paths produce real sandbox/production evidence after registration; no false filed state. |
| AC08 Payday Super | Per-payday QE/super exact calculations, valid fund acceptance and late/rejected/returned/partial contribution exception control. |
| AC09 Reports and BI | Each Appendix B report uses deterministic seeded ledger fixtures; figures drill to exact lines; PDFs/CSV/XLSX totals and period settings match. |
| AC10 Migration and exit | Three representative Xero source companies plus MYOB, QuickBooks/Reckon fixtures; complete signed movement reconciliations and reimportable export manifest. |
| AC11 AI governance | Malicious invoice prompt-injection; denied roles; unsafe payment; unsupported fact; stale or partial data; confidence threshold and approval expiry cannot cause misposting. |
| AC12 Failure and DR | Crash before/after post, outbox, PSP webhook, ATO/SSP submission, cloud outage; idempotent retry and independent restore without data drift. |
| AC13 Source traceability | Every F001–F352 mapped to test and state, and each named report in Appendix B to output/validation. No untested or unavailable features silently pass. |

## 14.1 Audit evidence states

Proposed standard: NOT_STARTED; DESIGN_ONLY; CODE_PRESENT_UNVERIFIED; MOCK_TESTED; STAGING_VERIFIED; PROVIDER_SANDBOX_VERIFIED; PRODUCTION_CANARY_VERIFIED; ACCEPTED; BLOCKED_EXTERNAL; FAILED. External ATO/payment receipts and independently observed financial states are separate evidence classes. A UI element being rendered is never equivalent to functional acceptance.

# 15. Operational cost, support and commercial assumptions

- Publish transparent per-organisation/employee/transaction tiers with costs separated for PSP, bank-feed, STP/super gateway, eInvoicing, storage and excess AI usage; do not assert margin or pricing without provider quotes.
- Enable support agents to inspect health/status with scoped consent and read-only safeguards; any break-glass access requires MFA, reason, expiry and audit.
- Health dashboards monitor journal imbalance attempts, bank feed freshness, provider timeout/uncertain outcomes, payroll/STP/super exceptions, BAS deadlines, queue depth, document ingestion and mismatch alerts.
- Pay attention to accountant partnerships: firm dashboard, client company queue, period sign-offs, year-end packs, batch client queries, multi-client reports and secure delegation.
- AI metering separates inference cost from customer-billable operations and does not silently substitute weaker models for high-risk financial controls.

# 16. Open architecture decisions, dependencies and exclusions

| Decision / dependency | Proposed treatment or blocker |
| --- | --- |
| Cloud SQL placement / region | Confirm Australian data-region demand, HA/PITR capability, per-tenant isolation and costs in an ADR. Source code, schema and credentials not yet deployed by this document. |
| ATO commercial DSP onboarding | Commercial product registration, OSF evidence, test/production environments, whitelisting and authorised product IDs are mandatory external work. |
| Banking connectivity | Select CDR/aggregator model, licences, bank coverage, supported transaction history, costs and incident responsibilities before claims of universal feeds. |
| Payment/super gateway contracts | Verify partner terms, funds flow, approved payment methods, funds segregation where relevant, webhook guarantees and identity checks. |
| Award/industrial instruments | Determine launch coverage of Australian modern awards/EAs; employ payroll tax specialists; no unsupervised legislative interpretation. |
| Financial advice boundary | Sandy can provide general business analytics but regulated personal financial advice or tax agent representation needs separate legal and licensing analysis. |
| International accounting | Initial legal/tax/payroll engine is Australian. Non-AU localisation deferred, but core data model supports foreign currencies and future legal entities. |
| Vendor parity vs clone | Deliver equivalent outcomes using original UX and code; do not copy proprietary code, screenshots, trade marks, templates or internal vendor API behaviour. |
| Existing Sandy products | Confirm currently deployed canonical APIs, universal file metadata, identity/company assignments and lease/outbox primitives before adding any new writes. |

# 17. Implementation sign-off checklist

- Product owner has approved this scope and baselined all 352 feature IDs and report catalogue requirements.
- Accounting architect and qualified Australian accountant approve postings, GST, reporting and period close model.
- Payroll expert validates pay engine, STP Phase 2, Payday Super and leave/records; ATO/SSP and super/gateway approvals are evidenced.
- Security/Privacy approve authority model, OSF/APP controls, threats, retention and recovery.
- Sandy core engineering confirms no duplicate source-of-truth, API bypass, provider credential path or mission/approval engine.
- Migration lead signs quantified source-to-target financial reconciliation and independent outbound export verification.
- Production acceptance contains real provider receipts and owner sign-off; every unverified item remains explicitly blocked.


---

# Appendix A — 352-feature Xero minimum requirements register

This is a traceability transcription of the user-supplied 24 October 2026 review [U1]. All 352 requirements are mandatory at full-parity GA. The source review’s evidence labels (Seen, Listed, Intro, Unavailable, session-limited) are preserved, not upgraded to tested functionality. Sandy’s design adapts the customer outcome rather than importing vendor-specific behaviour, private app names or failure states. Each entry inherits an acceptance obligation in AC13 and the relevant module suite.

## A. F001–F023

| ID · source feature / evidence | Source function — mandatory outcome | Sandy module |
| --- | --- | --- |
| F001 · Organisation switcher; Seen | Switch organisation; open settings, subscription and billing. | Platform & navigation |
| F002 · Organisation utilities; Listed | Open My Xero, Demo Company or add an organisation. | Platform & navigation |
| F003 · Business navigation; Seen | Home, Sales, Purchases, Reporting, Payroll, Accounting, Tax, Contacts and Projects. | Platform & navigation |
| F004 · Create new; Seen | Invoice, payment link, bill, contact, quote and purchase order. | Platform & navigation |
| F005 · Create accounting records; Seen | Document upload, manual journal, spend money, receive money and transfer money. | Platform & navigation |
| F006 · Global search; Seen | Find contacts and transactions by names, numbers, references and other text. | Platform & navigation |
| F007 · JAX; Unavailable | Just Ask Xero assistant entry point. | Platform & navigation |
| F008 · Help; Seen | Access help from the global bar; contextual guidance appears throughout. | Platform & navigation |
| F009 · Notifications and apps; Seen | Reach notifications and connected app tools. | Platform & navigation |
| F010 · User menu; Seen | Profile, Account, Support, Product ideas and Log out. | Platform & navigation |
| F011 · Do more with Xero; Listed | Hubdoc, Analytics, Expenses, Deputy rostering and Xero App Store. | Platform & navigation |
| F012 · Dashboard configuration; Seen | Edit the homepage and add available bank accounts. | Dashboard & work queues |
| F013 · Bank account cards; Seen | See statement and Xero balances, differences and outstanding reconciliation work. | Dashboard & work queues |
| F014 · Bank shortcuts; Seen | Reconcile, review reconciled items, import statements and connect available feeds. | Dashboard & work queues |
| F015 · Invoices owed; Seen | Summarise receivables awaiting payment, overdue invoices, drafts and approvals. | Dashboard & work queues |
| F016 · Bills to pay; Seen | Summarise unpaid and overdue bills, drafts and approvals. | Dashboard & work queues |
| F017 · Tasks; Seen | Add a task and access banking, sales and purchases follow-up work. | Dashboard & work queues |
| F018 · JAX task review; Seen | Review the overdue-invoice task with the assistant. | Dashboard & work queues |
| F019 · Recent invoice payments; Seen | Review recently received payments and open invoices. | Dashboard & work queues |
| F020 · Cash in and out; Seen | Compare six months of inflows, outflows and net difference. | Dashboard & work queues |
| F021 · Net profit or loss; Seen | Compare year-to-date performance with the prior year. | Dashboard & work queues |
| F022 · Expenses and account watchlist; Seen | See expenses needing review and selected ledger balances. | Dashboard & work queues |
| F023 · Activity statements and apps; Seen | Open the newer activity statement and discover integrations. | Dashboard & work queues |

## A. F024–F046

| ID · source feature / evidence | Source function — mandatory outcome | Sandy module |
| --- | --- | --- |
| F024 · Sales status summaries; Seen | Review draft, awaiting approval, unpaid and overdue invoices. | Sales, AR & collections |
| F025 · Sales dashboard tools; Seen | Import invoices, search, create documents and open settings. | Sales, AR & collections |
| F026 · Money coming in; Seen | Review amounts due this week and next week. | Sales, AR & collections |
| F027 · Largest debtors; Seen | Review customers owing the most. | Sales, AR & collections |
| F028 · Billable expenses; Seen | Find expenses ready to invoice. | Sales, AR & collections |
| F029 · Payment follow-ups; Seen | Access JAX follow-up recommendations. | Sales, AR & collections |
| F030 · Quote overview; Seen | Review draft, sent, accepted and expired quotes. | Sales, AR & collections |
| F031 · Invoice status tabs; Seen | Browse All, Draft, Awaiting Approval, Awaiting Payment, Paid and Repeating. | Sales, AR & collections |
| F032 · Invoice list fields; Seen | Review numbers, reference, customer, dates, paid, due and delivery state. | Sales, AR & collections |
| F033 · Invoice bulk tools; Seen | Access printing, emailing and deposit actions on selected invoices. | Sales, AR & collections |
| F034 · Invoice data exchange; Seen | Import or export sales invoices. | Sales, AR & collections |
| F035 · Sales shortcuts; Seen | Start invoices, recurring invoices, credits or statements. | Sales, AR & collections |
| F036 · Invoice identity; Seen | Set contact, issue/due dates, invoice number and reference. | Sales, AR & collections |
| F037 · Invoice presentation; Seen | Choose branding, online payment options, currency and tax treatment. | Sales, AR & collections |
| F038 · Invoice line items; Seen | Capture item, description, quantity, price, discount, account and tax. | Sales, AR & collections |
| F039 · Invoice line controls; Seen | Reorder/remove lines, add rows and choose visible columns. | Sales, AR & collections |
| F040 · Invoice evidence and totals; Seen | Attach files and review subtotal, tax and total. | Sales, AR & collections |
| F041 · Deposits; Seen | Request an invoice deposit. | Sales, AR & collections |
| F042 · Invoice save and approval; Seen | Save/close, approve/email or use other approval outputs. | Sales, AR & collections |
| F043 · Invoice delivery; Seen | Email, send SMS, obtain a link or print PDF. | Sales, AR & collections |
| F044 · Invoice reuse; Seen | Copy to a draft invoice/quote or create a repeating template. | Sales, AR & collections |
| F045 · Credit and void; Seen | Create/apply a credit or void an invoice. | Sales, AR & collections |
| F046 · Collections and payments; Seen | Toggle invoice reminders or record a received payment. | Sales, AR & collections |

## A. F047–F069

| ID · source feature / evidence | Source function — mandatory outcome | Sandy module |
| --- | --- | --- |
| F047 · eInvoicing and audit; Seen | Send an eInvoice when the contact is eligible; review history. | Sales, AR & collections |
| F048 · Recurring schedule; Seen | Set repeat interval, invoice date, due-date rule and optional end date. | Sales, AR & collections |
| F049 · Recurring approval mode; Seen | Generate drafts, approved invoices or invoices approved for sending. | Sales, AR & collections |
| F050 · Recurring content; Seen | Set customer, reference, branding, payments, tax, currency and lines. | Sales, AR & collections |
| F051 · Sales credit note; Seen | Create a customer credit note. | Sales, AR & collections |
| F052 · Credit note lines; Seen | Enter credit line descriptions, quantities, prices, accounts and tracking. | Sales, AR & collections |
| F053 · Statement selection; Seen | Choose statement type, date and customer filters. | Sales, AR & collections |
| F054 · Statement register; Seen | Review who owes money and select recipients. | Sales, AR & collections |
| F055 · Statement delivery; Seen | Print or email selected customer statements. | Sales, AR & collections |
| F056 · Invoice import sources; Seen | Use Xero CSV or MYOB service/item sales formats. | Sales, AR & collections |
| F057 · Import template; Seen | Download and populate the required column template. | Sales, AR & collections |
| F058 · Import behaviour; Seen | Choose whether imported addresses update contacts and how unit amounts treat tax. | Sales, AR & collections |
| F059 · Invoice export; Seen | Export invoice list data. | Sales, AR & collections |
| F060 · Quote lifecycle; Seen | Browse All, Draft, Sent, Declined, Accepted and Invoiced quotes. | Sales, AR & collections |
| F061 · Quote list and search; Seen | Find quotes by contact, amount, reference or number. | Sales, AR & collections |
| F062 · Quote header; Seen | Set contact, dates, quote number, reference, currency, brand and project. | Sales, AR & collections |
| F063 · Quote lines and terms; Seen | Enter priced/discounted lines, tax, tracking and commercial terms. | Sales, AR & collections |
| F064 · Quote record actions; Seen | Print a quote or mark it accepted. | Sales, AR & collections |
| F065 · Quote currency and history; Seen | Review base equivalent, exchange rate and changes. | Sales, AR & collections |
| F066 · Quote save and send; Seen | Save or send a quote using split-button actions. | Sales, AR & collections |
| F067 · Payment link fields; Seen | Set contact, description, amount, tax, sales account and tax category. | Sales, AR & collections |
| F068 · Payment link options; Seen | Review payment method and advanced options. | Sales, AR & collections |
| F069 · Payment link invoice behaviour; Intro | Create an associated invoice using contact defaults. | Sales, AR & collections |

## A. F070–F092

| ID · source feature / evidence | Source function — mandatory outcome | Sandy module |
| --- | --- | --- |
| F070 · Payment terms; Seen | Set default bill and sales-invoice due-date rules. | Communications & document branding |
| F071 · Automatic sequencing; Seen | Set document prefixes and next numbers. | Communications & document branding |
| F072 · Outstanding balances and expiry; Seen | Show a contact balance link on online invoices and set quote expiry. | Communications & document branding |
| F073 · Reminder schedule; Seen | Choose when overdue reminders are sent. | Communications & document branding |
| F074 · Reminder contents; Seen | Include online invoice/detail summary and PDF link. | Communications & document branding |
| F075 · Reminder exceptions; Seen | Suppress small balances and disable reminders for a customer or invoice. | Communications & document branding |
| F076 · Reminder replies and history; Seen | Choose the reply address and inspect setting changes. | Communications & document branding |
| F077 · Delivery address preference; Seen | Always display contact delivery addresses on invoices. | Communications & document branding |
| F078 · Email template families; Seen | Use templates for invoices, credits, statements, remittances and repeating invoices. | Communications & document branding |
| F079 · Template authoring; Seen | Set template name, subject and message; insert dynamic values. | Communications & document branding |
| F080 · Template management; Seen | Add or edit communication templates. | Communications & document branding |
| F081 · Branding library; Seen | Maintain multiple invoice themes with fallback support. | Communications & document branding |
| F082 · Theme naming and preview; Seen | Name a theme and preview desktop or mobile layout. | Communications & document branding |
| F083 · Business details; Seen | Choose postal/physical/no address and visible business information. | Communications & document branding |
| F084 · Customer address display; Seen | Show attention, name, address and country; preview shipping. | Communications & document branding |
| F085 · Customer contact display; Seen | Show account number, business number, email and phone. | Communications & document branding |
| F086 · Brand styling; Seen | Set logo position, brand colour and font. | Communications & document branding |
| F087 · Line column visibility; Seen | Choose item, quantity, price, discount, tax and other columns. | Communications & document branding |
| F088 · Tax presentation; Seen | Use invoice tax setting or force inclusive/exclusive display. | Communications & document branding |
| F089 · Currency display; Seen | Show currency code and conversion rate. | Communications & document branding |
| F090 · Online payment presentation; Seen | Show payment text links and a QR code. | Communications & document branding |
| F091 · Payment instructions; Seen | Set payment advice and additional notes. | Communications & document branding |
| F092 · Advanced printing; Seen | Choose document titles and customer-address placement. | Communications & document branding |

## A. F093–F115

| ID · source feature / evidence | Source function — mandatory outcome | Sandy module |
| --- | --- | --- |
| F093 · Item list; Seen | Maintain the product and service catalogue. | Items & inventory |
| F094 · Search and filters; Seen | Find items and constrain the list by status or additional filters. | Items & inventory |
| F095 · Columns and pagination; Seen | Adjust visible columns and browse the catalogue. | Items & inventory |
| F096 · Import and export; Seen | Move product data into and out of Xero. | Items & inventory |
| F097 · Bulk and row actions; Seen | Select items and access item-level actions. | Items & inventory |
| F098 · New item identity; Seen | Enter a required item code and optional name. | Items & inventory |
| F099 · Purchase defaults; Seen | Set cost price, purchase account, tax rate and description. | Items & inventory |
| F100 · Sales defaults; Seen | Set sale price, sales account, tax rate and description. | Items & inventory |
| F101 · Tracked inventory; Seen | Track stock quantities when prerequisites are met. | Items & inventory |
| F102 · Item save choices; Seen | Save an item or save and duplicate it. | Items & inventory |
| F103 · Backorders; Intro | Approve invoices even when a tracked item has zero stock. | Items & inventory |
| F104 · Collection settings tabs; Seen | Inspect payment methods, defaults, connected services or add a service. | Payments & disbursements |
| F105 · Card payments; Seen | Accept customer card payments through Stripe. | Payments & disbursements |
| F106 · PayTo collections; Seen | Offer one-time bank payments in Australia. | Payments & disbursements |
| F107 · Wallet payments; Seen | Offer Apple Pay, Google Pay and Link. | Payments & disbursements |
| F108 · Buy now pay later; Seen | Offer Zip through Stripe where available. | Payments & disbursements |
| F109 · Supplier payment setup; Intro | Enable online bill payments through Airwallex. | Payments & disbursements |
| F110 · Batch supplier payments; Intro | Pay multiple bills or combine bills for one supplier. | Payments & disbursements |
| F111 · Payment methods and approval; Intro | Pay by bank transfer, PayID or BPAY with final review. | Payments & disbursements |
| F112 · Payment fees and eligibility; Intro | Review included payments, excess fees and supported bank capabilities. | Payments & disbursements |
| F113 · Scheduled payments; Intro | Schedule supplier payments in advance when released. | Payments & disbursements |
| F114 · Purchases overview; Seen | Review bills and purchase orders by state. | Purchases, AP & expenses |
| F115 · Purchases search; Seen | Search by document type, reference, contact, amount and dates. | Purchases, AP & expenses |

## A. F116–F138

| ID · source feature / evidence | Source function — mandatory outcome | Sandy module |
| --- | --- | --- |
| F116 · Bill status tabs; Seen | Browse All, Draft, Awaiting approval, Awaiting payment, Paid and Repeating. | Purchases, AP & expenses |
| F117 · Bill list; Seen | Review supplier obligations and settlement progress. | Purchases, AP & expenses |
| F118 · Bill search and dates; Seen | Find bills by contact, amount, reference or date range. | Purchases, AP & expenses |
| F119 · List configuration; Seen | Sort fields, select columns and page through bills. | Purchases, AP & expenses |
| F120 · Duplicate bills; Seen | Review suspected duplicate records. | Purchases, AP & expenses |
| F121 · Email bill capture; Seen | Create draft bills from email attachments. | Purchases, AP & expenses |
| F122 · Upload and autofill; Seen | Create draft bills from uploaded files. | Purchases, AP & expenses |
| F123 · CSV bill import; Seen | Bulk import bills from CSV. | Purchases, AP & expenses |
| F124 · Recurring bills and credits; Seen | Start a repeating bill or supplier credit note. | Purchases, AP & expenses |
| F125 · Bill payments; Seen | Access payment setup or a bill-level payment action. | Purchases, AP & expenses |
| F126 · Bill header; Seen | Capture supplier, bill date, due date, reference and currency. | Purchases, AP & expenses |
| F127 · Tax treatment; Seen | Select how amounts treat tax. | Purchases, AP & expenses |
| F128 · Bill lines; Seen | Enter item, description, quantity, price, account, tax and tracking. | Purchases, AP & expenses |
| F129 · Line controls; Seen | Add and remove individual lines. | Purchases, AP & expenses |
| F130 · Customer or project allocation; Seen | Assign bill expenses onward to a customer or project. | Purchases, AP & expenses |
| F131 · Calculated amounts; Seen | Review subtotal, tax and total. | Purchases, AP & expenses |
| F132 · Save and approve; Seen | Save the bill or approve it into the next stage. | Purchases, AP & expenses |
| F133 · Bill view; Seen | Review an existing bill and its status. | Purchases, AP & expenses |
| F134 · Attachments and PDF; Seen | Open attached evidence or generate a printable bill view. | Purchases, AP & expenses |
| F135 · Source integration; Seen | Identify the upstream document system. | Purchases, AP & expenses |
| F136 · Payment recording; Seen | Record amount, date, funding account and payment reference. | Purchases, AP & expenses |
| F137 · Record history and notes; Seen | Review prior changes or add explanatory notes. | Purchases, AP & expenses |
| F138 · Order status tabs; Seen | Browse All, Draft, Awaiting approval, Approved and Billed orders. | Purchases, AP & expenses |

## A. F139–F161

| ID · source feature / evidence | Source function — mandatory outcome | Sandy module |
| --- | --- | --- |
| F139 · Order list; Seen | Review supplier orders and delivery details. | Purchases, AP & expenses |
| F140 · Order filters and columns; Seen | Find orders by text and dates; adjust list fields. | Purchases, AP & expenses |
| F141 · Order creation; Seen | Start a new purchase order. | Purchases, AP & expenses |
| F142 · Order conversion; Intro | Copy purchase-order contents into bills and sales invoices. | Purchases, AP & expenses |
| F143 · Xero Expenses; Intro | Capture, track, approve and pay employee expense claims. | Purchases, AP & expenses |
| F144 · Receipt scanning; Intro | Extract amount, date and vendor from a receipt photograph. | Purchases, AP & expenses |
| F145 · Mileage; Intro | Calculate distance from start/end addresses and claim business travel. | Purchases, AP & expenses |
| F146 · Expense dimensions; Intro | Use currencies, organisation tracking, labels, customers and projects. | Purchases, AP & expenses |
| F147 · Expense users and pricing; Intro | Use plan-included people and pay for extra submitters. | Purchases, AP & expenses |
| F148 · Classic Expenses; Seen | Open the older expense workflow. | Purchases, AP & expenses |
| F149 · Expense settings; Listed | Manage claim users, accounts, mileage and labels. | Purchases, AP & expenses |
| F150 · Account register; Seen | Review bank and card accounts. | Banking & reconciliation |
| F151 · Add account and feeds; Seen | Add a bank account and connect available automatic feeds. | Banking & reconciliation |
| F152 · Reconciliation navigation; Seen | Move between Reconcile, Cash coding, Bank statements and Account transactions. | Banking & reconciliation |
| F153 · Balances and reports; Seen | Compare statement and book balances and open a reconciliation report. | Banking & reconciliation |
| F154 · Transaction ledger; Seen | Review book transactions and their running balance. | Banking & reconciliation |
| F155 · Transaction navigation; Seen | Open underlying transaction details. | Banking & reconciliation |
| F156 · Transaction maintenance; Seen | Start a new transaction or access Remove & Redo. | Banking & reconciliation |
| F157 · Transaction search and sorting; Seen | Find and order accounting entries. | Banking & reconciliation |
| F158 · Statement line register; Seen | Review imported bank information separately from books. | Banking & reconciliation |
| F159 · Statement source and state; Seen | Distinguish imported sources and reconciliation progress. | Banking & reconciliation |
| F160 · Statement import; Seen | Load bank statements where manual import is offered. | Banking & reconciliation |
| F161 · Account context tools; Seen | Open account management and review prior reconciliation. | Banking & reconciliation |

## A. F162–F184

| ID · source feature / evidence | Source function — mandatory outcome | Sandy module |
| --- | --- | --- |
| F162 · Statement comparison; Seen | Compare a bank line with an existing or proposed accounting transaction. | Banking & reconciliation |
| F163 · Reconciliation search; Seen | Find lines by payee, amount, reference, description, cheque number or analysis code. | Banking & reconciliation |
| F164 · Match and Find and Match; Seen | Locate existing transactions corresponding to a statement line. | Banking & reconciliation |
| F165 · Create coding; Seen | Categorise new statement activity. | Banking & reconciliation |
| F166 · Transfer and Discuss; Seen | Access transfer treatment or discussion for a statement line. | Banking & reconciliation |
| F167 · Suggested and partial matches; Seen | Present a proposed match and warn when totals differ. | Banking & reconciliation |
| F168 · Auto reconciliation; Seen | Enable automatic reconciliation where available. | Banking & reconciliation |
| F169 · Cash coding; Seen | Batch-code statement lines in a grid. | Banking & reconciliation |
| F170 · Cash coding actions; Seen | Apply rules, discard edits and save reconciled coding. | Banking & reconciliation |
| F171 · Bank rule families; Seen | Maintain spend, receive and transfer money rules. | Banking & reconciliation |
| F172 · Rule conditions; Seen | Match recurring bank text using conditions. | Banking & reconciliation |
| F173 · Rule ordering and editing; Seen | Search, edit and prioritise rules. | Banking & reconciliation |
| F174 · Journal states; Seen | Browse all, draft, posted, voided, repeating and archived entries. | Ledger & corrections |
| F175 · Journal list; Seen | Review narration, date and balanced totals. | Ledger & corrections |
| F176 · Journal list tools; Seen | Search, filter dates, choose columns, import and start journals. | Ledger & corrections |
| F177 · Journal bulk actions; Seen | Void or archive selected entries. | Ledger & corrections |
| F178 · Journal metadata; Seen | Set narration, date, optional auto-reversing date and tax treatment. | Ledger & corrections |
| F179 · Journal reporting options; Seen | Include on cash-basis reports and autofill descriptions. | Ledger & corrections |
| F180 · Journal line editor; Seen | Enter descriptions, accounts, tax, tracking, debit and credit. | Ledger & corrections |
| F181 · Journal line tools; Seen | Add rows, paste lines and clear lines. | Ledger & corrections |
| F182 · Journal evidence and posting; Seen | Attach files, add notes, save a draft or post. | Ledger & corrections |
| F183 · Find and recode; Seen | Select groups of transaction lines to change account, tax or tracking treatment. | Ledger & corrections |
| F184 · Recoding audit history; Seen | Review earlier correction batches and their outcomes. | Ledger & corrections |

## A. F185–F207

| ID · source feature / evidence | Source function — mandatory outcome | Sandy module |
| --- | --- | --- |
| F185 · Partial correction failures; Seen | Distinguish batches that completed with errors. | Ledger & corrections |
| F186 · Chart of accounts; Seen | Classify transactions using ledger accounts. | Chart, fixed assets & evidence |
| F187 · Account classes; Seen | Browse assets, liabilities, equity, expenses, revenue and archived accounts. | Chart, fixed assets & evidence |
| F188 · Account maintenance; Seen | Add accounts, import/export, print and change selected tax rates. | Chart, fixed assets & evidence |
| F189 · Account safeguards; Seen | Restrict deletion or archiving of protected/in-use accounts. | Chart, fixed assets & evidence |
| F190 · Asset register; Seen | Manage draft, registered, sold/disposed and pooled assets. | Chart, fixed assets & evidence |
| F191 · Asset actions; Seen | Create/register assets, run depreciation and import/export the register. | Chart, fixed assets & evidence |
| F192 · Asset configuration; Listed | Define asset types, accounts and depreciation defaults. | Chart, fixed assets & evidence |
| F193 · Asset version transition; Intro | Access the updated asset experience. | Chart, fixed assets & evidence |
| F194 · Documents; Seen | Receive and review supporting documents. | Chart, fixed assets & evidence |
| F195 · Document extraction; Intro | Read uploaded/emailed content and prefill fields for a transaction. | Chart, fixed assets & evidence |
| F196 · Document actions; Seen | Add a document to a new record, archive or delete. | Chart, fixed assets & evidence |
| F197 · Assurance and history; Seen | Review user activity and accounting events. | Chart, fixed assets & evidence |
| F198 · History and notes; Seen | Review organisation events and open source records. | Reporting & analytics |
| F199 · Audit filtering; Seen | Filter events by dates, user and event type. | Reporting & analytics |
| F200 · Audit search and export; Seen | Search loaded results and export history. | Reporting & analytics |
| F201 · Report discovery; Seen | Find reports and browse categories. | Reporting & analytics |
| F202 · Report descriptions; Seen | Explain what each report is for. | Reporting & analytics |
| F203 · Report favourites; Seen | Pin reports for quicker access. | Reporting & analytics |
| F204 · Report variants; Seen | Open standard or commonly used layouts. | Reporting & analytics |
| F205 · Date comparisons; Seen | Choose a period and compare with other periods or tracking categories. | Reporting & analytics |
| F206 · Currency and filters; Seen | Change report currency and refine report content. | Reporting & analytics |
| F207 · Financial statement output; Seen | Read grouped accounts, subtotals and totals. | Reporting & analytics |

## A. F208–F230

| ID · source feature / evidence | Source function — mandatory outcome | Sandy module |
| --- | --- | --- |
| F208 · Financial drill-through; Seen | Open transaction detail behind individual figures. | Reporting & analytics |
| F209 · Layout and distribution; Seen | Edit layout, insert content, save or export report output. | Reporting & analytics |
| F210 · Accounting basis; Seen | Switch report calculation between cash and accrual. | Reporting & analytics |
| F211 · Report inclusion; Seen | Include accounts with zero balance or activity. | Reporting & analytics |
| F212 · Report display details; Seen | Show accounting basis, codes, decimals, totals and YTD. | Reporting & analytics |
| F213 · Ratios and currency notes; Seen | Show percentage of trading income and currency information. | Reporting & analytics |
| F214 · Business snapshot; Seen | Review profitability, efficiency, balance sheet, cash and payment timing. | Reporting & analytics |
| F215 · Snapshot customisation; Seen | Select visible metrics and included profit, expense and cash accounts. | Reporting & analytics |
| F216 · Short-term cash flow; Seen | Project inflows, outflows and ending cash. | Reporting & analytics |
| F217 · Projection editing; Seen | Set predicted activity and expected/planned payment dates. | Reporting & analytics |
| F218 · Projection investigation; Seen | Inspect transactions contributing to future cash movements. | Reporting & analytics |
| F219 · Cash flow manager; Seen | Provide Overview, Manage cash in and Manage cash out workspaces. | Reporting & analytics |
| F220 · Extended forecast; Intro | Forecast up to 180 days including draft invoices, bills and quotes. | Reporting & analytics |
| F221 · New analytics; Session limited | Dashboards, health scorecards, graphs, benchmarks, KPIs and budgets. | Reporting & analytics |
| F222 · Activity Statement; Seen | Prepare BAS/IAS information for a selected period. | Australian tax & payroll |
| F223 · GST audit; Seen | Access supporting GST audit information. | Australian tax & payroll |
| F224 · Statement output; Seen | Save a draft, print, export or publish a statement. | Australian tax & payroll |
| F225 · New BAS; Intro | Move to a version supporting Simpler BAS and Full BAS. | Australian tax & payroll |
| F226 · TPAR; Intro | Report contractor payments and track annual obligations. | Australian tax & payroll |
| F227 · Tax rates; Seen | Maintain transaction tax rates and their components. | Australian tax & payroll |
| F228 · Tax rate management; Seen | Create tax rates or access deletion/basic-rate controls. | Australian tax & payroll |
| F229 · Payroll navigation; Listed | Overview, Employees, Leave and Timesheets. | Australian tax & payroll |
| F230 · Payroll processing; Listed | Pay employees, Superannuation and Single Touch Payroll. | Australian tax & payroll |

## A. F231–F253

| ID · source feature / evidence | Source function — mandatory outcome | Sandy module |
| --- | --- | --- |
| F231 · Payroll administration; Listed | Payroll history and settings. | Australian tax & payroll |
| F232 · Payroll settings scope; Listed | Account details, pay frequencies, pay items and holidays. | Australian tax & payroll |
| F233 · Payroll reports; Listed | Employee, leave, pay, tax, super and timesheet reporting. | Australian tax & payroll |
| F234 · Organisation identity; Seen | Maintain display/legal names, industry, type and logo. | Organisation, users & contacts |
| F235 · Business contact details; Seen | Maintain business contact and postal/physical addresses. | Organisation, users & contacts |
| F236 · Online invoice details; Seen | Choose additional organisation information shown to customers. | Organisation, users & contacts |
| F237 · Users; Seen | Invite users and review role/permission summaries. | Organisation, users & contacts |
| F238 · Subscription and billing; Listed | Change subscription, billing information and plan. | Organisation, users & contacts |
| F239 · Connected apps; Seen | Review and disconnect authorised applications. | Organisation, users & contacts |
| F240 · Current integrations; Seen | Deputy, Dext, Ordermentum Pty Ltd and Sandy Composio. | Organisation, users & contacts |
| F241 · Email settings; Seen | Set sender display name, reply address and templates. | Organisation, users & contacts |
| F242 · Xero to Xero; Seen | Exchange invoices/bills directly between Xero organisations. | Organisation, users & contacts |
| F243 · Contact organisation; Seen | Separate All, Customers, Suppliers, Archived, Groups and Smart lists. | Organisation, users & contacts |
| F244 · Contact actions; Seen | Search, add to groups, merge duplicates and archive. | Organisation, users & contacts |
| F245 · Contact information; Seen | Review activity, payment history, notes and balances owed each way. | Organisation, users & contacts |
| F246 · Contact record navigation; Seen | Open Activity, Contact details, Financial details and Documents. | Organisation, users & contacts |
| F247 · Contact activity summary; Seen | Review outstanding/overdue invoices and payment timing. | Organisation, users & contacts |
| F248 · Contact transactions; Seen | Browse related invoices and receive-money activity. | Organisation, users & contacts |
| F249 · Contact identity; Seen | Store contact name, account number, primary person and other people. | Organisation, users & contacts |
| F250 · Contact business information; Seen | Store phone numbers, website, ABN, ACN and internal notes. | Organisation, users & contacts |
| F251 · Billing and delivery addresses; Seen | Capture addresses by search or manual entry. | Organisation, users & contacts |
| F252 · Banking and currency; Seen | Store payee name, BSB, bank account, reference and currency. | Organisation, users & contacts |
| F253 · Sales defaults; Seen | Set account, due date, amount/tax treatment, discount, branding and tracking. | Organisation, users & contacts |

## A. F254–F276

| ID · source feature / evidence | Source function — mandatory outcome | Sandy module |
| --- | --- | --- |
| F254 · Credit control; Seen | Set a customer credit limit and block new invoices at the limit. | Organisation, users & contacts |
| F255 · Purchase defaults and network; Seen | Set purchase account, due date, amount/GST treatment, tracking and network key. | Organisation, users & contacts |
| F256 · Groups and smart lists; Seen | Group contacts or find contacts by commercial activity. | Organisation, users & contacts |
| F257 · Contact import and export; Seen | Import/export contact data and send statements. | Organisation, users & contacts |
| F258 · Current users; Seen | Review people with organisation access. | Identity, permissions & AI |
| F259 · Subscriber identity; Seen | Distinguish the subscription holder. | Identity, permissions & AI |
| F260 · User actions; Seen | Open a user or additional management choices. | Identity, permissions & AI |
| F261 · New user; Seen | Enter first/last name and email, then choose a role. | Identity, permissions & AI |
| F262 · Administrative roles; Seen | Offer Administrator and Standard access. | Identity, permissions & AI |
| F263 · Transaction roles; Seen | Offer Sales and purchases, Sales, Draft sales and purchases, or Purchases. | Identity, permissions & AI |
| F264 · Other roles; Seen | Offer Payroll admin, Employee or Viewer. | Identity, permissions & AI |
| F265 · Permission dimensions; Seen | Expose bank-detail admin, user management, BAS, apps, banking and report scopes. | Identity, permissions & AI |
| F266 · Support access; Seen | Access the Xero Support access control. | Identity, permissions & AI |
| F267 · Login history; Seen | Review who logged in and when. | Identity, permissions & AI |
| F268 · JAX availability; Unavailable | Open the assistant within the trusted session. | Identity, permissions & AI |
| F269 · Financial year and tax setup; Seen | Set financial year end, GST method/frequency and PAYG treatment. | Financial configuration & migration |
| F270 · Additional tax areas; Seen | Flag FBT, fuel tax credits and wine equalisation tax. | Financial configuration & migration |
| F271 · Transaction tax defaults; Seen | Choose default tax behaviour for sales and purchases. | Financial configuration & migration |
| F272 · Lock dates; Seen | Restrict edits for non-advisers or all users through specified dates. | Financial configuration & migration |
| F273 · Time zone; Seen | Set the organisation time zone. | Financial configuration & migration |
| F274 · Currencies; Seen | Add currencies and inspect rates for a date. | Financial configuration & migration |
| F275 · Tracking categories; Seen | Tag transactions for reporting by business area. | Financial configuration & migration |
| F276 · Conversion balances; Seen | Enter opening debit/credit balances and comparative periods. | Financial configuration & migration |

## A. F277–F299

| ID · source feature / evidence | Source function — mandatory outcome | Sandy module |
| --- | --- | --- |
| F277 · Conversion controls; Seen | Add lines/comparatives, remove zero balances and lock opening data. | Financial configuration & migration |
| F278 · Accounting export; Seen | Export data for use in another accounting system. | Financial configuration & migration |
| F279 · Reporting preferences; Seen | Set organisation-wide cash/accrual and display defaults. | Financial configuration & migration |
| F280 · Custom contact links; Seen | Link Xero contact records to CRM or other systems. | Financial configuration & migration |
| F281 · Project lifecycle; Seen | Browse draft, in-progress and closed projects. | Projects & time |
| F282 · Project list filters; Seen | Search projects and filter by scope or contact. | Projects & time |
| F283 · New project and timer; Seen | Start a project or access time tracking. | Projects & time |
| F284 · Project task and cost scope; Intro | Add tasks, enter time and track spending. | Projects & time |
| F285 · Project reporting; Seen | Open project report choices. | Projects & time |
| F286 · Time entries; Seen | Review time by week and selected day. | Projects & time |
| F287 · Time entry actions; Seen | Add an entry, use a timer or change the time view. | Projects & time |
| F288 · Trello time integration; Intro | Enter project time from Trello. | Projects & time |
| F289 · Staff time overview; Seen | Review total, chargeable and non-chargeable time. | Projects & time |
| F290 · Staff drill-down; Seen | Open time entries for an individual or detailed report. | Projects & time |
| F291 · Staff cost rates; Listed | Manage hourly project cost rates. | Projects & time |
| F292 · Staff permissions; Listed | Invite people to Projects and manage access. | Projects & time |
| F293 · Payroll overview totals; Seen | Review recent payroll, year-to-date payroll and the next pay date. | Payroll, STP, leave & super |
| F294 · Payroll task and help; Seen | Access a new task and payroll guidance. | Payroll, STP, leave & super |
| F295 · Pay-run overview queue; Seen | Review outstanding pay runs or start pay-run work. | Payroll, STP, leave & super |
| F296 · Leave approval queue; Seen | Review leave awaiting approval. | Payroll, STP, leave & super |
| F297 · Timesheet approval queue; Seen | Review timesheets awaiting approval. | Payroll, STP, leave & super |
| F298 · Payroll calendar; Seen | Orient payroll work by date. | Payroll, STP, leave & super |
| F299 · Pay-run register; Seen | Browse historical payroll runs and totals. | Payroll, STP, leave & super |

## A. F300–F322

| ID · source feature / evidence | Source function — mandatory outcome | Sandy module |
| --- | --- | --- |
| F300 · Pay-run filtering and paging; Seen | Find runs by processing or filing state. | Payroll, STP, leave & super |
| F301 · Pay-run creation choices; Seen | Choose regular recurring payroll or a one-off/correction run. | Payroll, STP, leave & super |
| F302 · Payroll guidance and options; Seen | Access STP settings and qualifying-earnings review. | Payroll, STP, leave & super |
| F303 · Payroll account mapping; Seen | Map bank, PAYG, wages and super liabilities/expenses to ledger accounts. | Payroll, STP, leave & super |
| F304 · Payroll tracking; Seen | Associate employee groups and timesheet categories with tracking. | Payroll, STP, leave & super |
| F305 · Payslip display and branding; Seen | Choose salary/employment-basis display and a company logo. | Payroll, STP, leave & super |
| F306 · Pay-frequency catalogue; Seen | Manage recurring payroll calendars. | Payroll, STP, leave & super |
| F307 · Holiday management; Seen | Maintain holiday dates and regional groups used in leave calculation. | Payroll, STP, leave & super |
| F308 · Pay-item categories; Seen | Manage earnings, deductions, reimbursements and leave definitions. | Payroll, STP, leave & super |
| F309 · Earnings definitions; Seen | Review earnings classification, calculation basis and reporting. | Payroll, STP, leave & super |
| F310 · Deduction definitions; Seen | Review deduction classification and PAYG/super/reporting effects. | Payroll, STP, leave & super |
| F311 · Reimbursement definitions; Seen | Map reimbursable cost categories to accounts. | Payroll, STP, leave & super |
| F312 · Leave definitions; Seen | Maintain leave types and entitlement/display properties. | Payroll, STP, leave & super |
| F313 · Qualifying-earnings review; Seen | Access individual/bulk review of pay-item reporting settings. | Payroll, STP, leave & super |
| F314 · Super-fund catalogue; Seen | Manage organisation superannuation funds. | Payroll, STP, leave & super |
| F315 · Automatic-super registration; Seen | Review registered organisation, payment authoriser and funding account. | Payroll, STP, leave & super |
| F316 · Settings history; Seen | Access changes associated with Payroll settings. | Payroll, STP, leave & super |
| F317 · STP navigation and year; Seen | Switch between filing overview, finalisation and tools. | Payroll, STP, leave & super |
| F318 · STP attention and history; Seen | Review unfiled payroll and prior filing outcomes. | Payroll, STP, leave & super |
| F319 · STP migration filing; Seen | Access reporting of previous payroll identifiers. | Payroll, STP, leave & super |
| F320 · STP correction tools; Seen | Access reset/finalisation and key-identifier corrections. | Payroll, STP, leave & super |
| F321 · JAX chat controls; Seen briefly | Access chat history, new chat, expanded chat and file input. | Payroll, STP, leave & super |
| F322 · JAX task categories; Seen briefly | Choose Analyse, Chase, Create, Find, Get help or Research. | Payroll, STP, leave & super |

## A. F323–F345

| ID · source feature / evidence | Source function — mandatory outcome | Sandy module |
| --- | --- | --- |
| F323 · Employee lifecycle register; Seen | Browse current, onboarding and past employees. | Payroll, STP, leave & super |
| F324 · Employee register fields; Seen | Review identity, group, pay schedule and required follow-up. | Payroll, STP, leave & super |
| F325 · Employee onboarding and import; Seen | Choose self-service onboarding, manual entry or multi-employee import. | Payroll, STP, leave & super |
| F326 · Employee bulk and annual tools; Seen | Access Xero Me invitations, pay-rate updates and year-end reports. | Payroll, STP, leave & super |
| F327 · Employee profile navigation; Seen | Move among ten profile workspaces. | Payroll, STP, leave & super |
| F328 · Personal and emergency details; Seen | Maintain identity, contact and emergency-contact information. | Payroll, STP, leave & super |
| F329 · Employment classification; Seen | Set employment and income type, basis, origin and start date. | Payroll, STP, leave & super |
| F330 · Employment payroll defaults; Seen | Set calendar, earnings, tracking, holiday and approval defaults. | Payroll, STP, leave & super |
| F331 · Employee tax configuration; Seen | Maintain tax identifier, scale, residency and withholding options. | Payroll, STP, leave & super |
| F332 · Employee bank and pay template; Seen | Maintain payroll bank allocation and recurring pay components. | Payroll, STP, leave & super |
| F333 · Payslip history; Seen | Browse payslips for an employee and select downloads. | Payroll, STP, leave & super |
| F334 · Opening payroll balances; Seen | Enter migration balances by category and date. | Payroll, STP, leave & super |
| F335 · Employee files and notes; Seen | Store payroll documents and notes. | Payroll, STP, leave & super |
| F336 · Employee leave and balances; Seen | Assign leave types and review individual requests. | Payroll, STP, leave & super |
| F337 · Organisation leave register; Seen | Review current/history requests and start leave or cash-out requests. | Payroll, STP, leave & super |
| F338 · Timesheet register and lifecycle; Seen | Review timesheets by date and processing state. | Payroll, STP, leave & super |
| F339 · Timesheet cards and entry; Seen | Open an employee period or start a timesheet. | Payroll, STP, leave & super |
| F340 · Timesheet detail; Seen | Review daily hours by earnings rate and tracking location. | Payroll, STP, leave & super |
| F341 · Automatic-super payment register; Seen | Review unpaid contributions, required attention and payment batches. | Payroll, STP, leave & super |
| F342 · Payroll audit register; Seen | Search and export changes by period, user, employee and type. | Payroll, STP, leave & super |
| F343 · Analytics navigation; Seen; session limited | Access analytics areas and assistance. | Analytics & Sandy Intelligence |
| F344 · Dashboard workspaces; Seen; session limited | Switch among configured dashboard views. | Analytics & Sandy Intelligence |
| F345 · Dashboard management; Seen; session limited | Access dashboard configuration and management. | Analytics & Sandy Intelligence |

## A. F346–F352

| ID · source feature / evidence | Source function — mandatory outcome | Sandy module |
| --- | --- | --- |
| F346 · Dashboard synchronisation; Seen; session limited | Review freshness and request a data refresh. | Analytics & Sandy Intelligence |
| F347 · Dashboard layout and filters; Seen; session limited | Set period, layout and scope. | Analytics & Sandy Intelligence |
| F348 · Dashboard distribution; Seen; session limited | Access sharing and export. | Analytics & Sandy Intelligence |
| F349 · Financial trend widgets; Seen; session limited | Compare profit, income, expenses and margins over time. | Analytics & Sandy Intelligence |
| F350 · Account and timing widgets; Seen; session limited | Summarise operating expenses, bank accounts and payment timing. | Analytics & Sandy Intelligence |
| F351 · Widget interaction and context; Seen; session limited | Access widget arrangement, formulas, AI insights and example data. | Analytics & Sandy Intelligence |
| F352 · Syft session recovery; Unavailable | Restore the interactive analytics session. | Analytics & Sandy Intelligence |


---

# Appendix B — Mandatory financial and operations report catalogue

All entries below were named in the source review’s report catalogue [U1], generally as Listed evidence, and constitute the GA acceptance report inventory. Report labels may be rebranded, but the described functional report, filters, cash/accrual treatment, account reconciliation and export must exist; every report should drill down or provide its underlying record ledger as appropriate.

## B. Financial performance

| Required report / tool | Source catalogue description / target outcome |
| --- | --- |
| Budget Manager | Create budgets to monitor business performance. |
| Budget Summary | View budgets created in Budget Manager. |
| Budget Variance | Compare actual results with budget. |
| Cash Summary | Summarise money received and used. |
| Executive Summary | Review cash, profitability, balance-sheet and performance indicators. |
| Tracking Summary | Summarise activity by tracking options. |

## B. Financial statements

| Required report / tool | Source catalogue description / target outcome |
| --- | --- |
| Balance Sheet | Financial position and amounts owned and owed at a date. |
| Blank Report | Empty template for a custom report. |
| Depreciation Schedule | Asset additions, disposals and depreciation. |
| Disposal Schedule | Fixed assets sold or disposed of. |
| Fixed Asset Reconciliation | Compare balance-sheet and asset-register balances. |
| Management Report | Package of six management reports. |
| Movements in Equity | Changes in organisational net worth. |
| Pool Detail | Asset-pool changes and tax depreciation detail. |
| Pool Summary | Summary of pooled-asset tax values and depreciation. |
| Profit and Loss | Income, expenses and profit for a period. |
| Statement of Cash Flows Direct Method | Cash receipts and cash use over a period. |
| Tax Depreciation Schedule | Asset additions, disposals and tax depreciation. |
| Tax Disposal Schedule | Tax details of asset disposals. |

## B. Payables and receivables

| Required report / tool | Source catalogue description / target outcome |
| --- | --- |
| Aged Payables Detail | Bills, credits and overpayments owed, aged individually. |
| Aged Payables Summary | Amount owed to each contact by age. |
| Aged Receivables Detail | Invoices, credits and overpayments owing, aged individually. |
| Aged Receivables Summary | Amount owed by each contact by age. |
| Billable Expenses Outstanding | Billable items not yet allocated to customers. |
| Contact Transactions Summary | Receivable, payable and cash transactions for a contact. |
| Customer Invoice Activity | Customer invoice activity; no description exposed in catalogue. |
| Expense Claim Detail | Outstanding expense claims aged by transaction. |
| Income and Expenses by Contact | Summarise contacts by incoming/outgoing transactions. |
| Payable Invoice Detail | Supplier invoice-line details, credits and overpayments; optional prepayments. |
| Payable Invoice Summary | Supplier bills, credits and overpayments; optional prepayments. |
| Receivable Invoice Detail | Customer invoice-line details, credits and overpayments; optional prepayments. |
| Receivable Invoice Summary | Customer invoices, credits and overpayments; optional prepayments. |
| Supplier Bill Activity | Supplier bill activity; no description exposed in catalogue. |

## B. Payroll

| Required report / tool | Source catalogue description / target outcome |
| --- | --- |
| Employee Contact Details | Employee address and email information. |
| Employee Remuneration | Employee pay rates and start/termination dates. |
| Leave Balances | Balances from posted pay runs as at a date. |
| Leave Requests | Requested, approved and taken leave. |
| Leave Transactions | Leave accruals and leave taken. |
| Payment Summary Details | Payment-summary amounts including lump-sum and RFB checks. |
| Payroll Activity Details | Detailed payroll activity within a date range. |
| Payroll Activity Summary | Summary of payroll activity within a date range. |
| Payroll Employee Summary | Employee earnings, deductions, taxes and super. |
| Superannuation Accruals | Super accruals by pay period. |
| Superannuation Payments | Super payments by fund and expected payment date. |
| Timesheet Details | Earnings-rate transactions, period and tracking detail. |
| Timesheet Summary | Employee timesheet entry summary for a period. |
| Transaction Listing Details | Detailed payroll transactions by employee. |
| Transaction Listing Summary | Pay-item summary by pay-item type. |

## B. Projects

| Required report / tool | Source catalogue description / target outcome |
| --- | --- |
| Detailed Time | Staff time entries across projects. |
| Project Details | Estimates, expenses and invoiced amounts. |
| Project Financials | Task and expense progress against budget. |
| Project Summary | Costs, estimates and profitability summary. |

## B. Reconciliations

| Required report / tool | Source catalogue description / target outcome |
| --- | --- |
| Account Summary | Monthly summary for a chosen account. |
| Bank Reconciliation | Compare book/bank balances and investigate missing or duplicate activity. |
| Bank Summary | Opening/closing balances and movement for a period. |
| Cash Validation Customer Report | Accounting data related to linked bank statement lines. |
| Inventory Item List | Details of tracked and untracked items. |
| Inventory Items Summary | Legacy favourite marked Old version; separate from Inventory Item Summary. |
| Open Backorders | Invoice lines with an outstanding backordered quantity. |
| Reconciliation Reports | Multi-report package for period-end reconciliation. |
| Uncoded Statement Lines | Unreconciled statement lines for client comments and coding assistance. |

## B. Taxes and balances

| Required report / tool | Source catalogue description / target outcome |
| --- | --- |
| Activity Statement | BAS or IAS for a period and ATO reporting. |
| Foreign Currency Gains and Losses | Revalued currency account balances and currency gains/losses. |
| General Ledger Detail | Detailed activity and balances across accounts. |
| General Ledger Exceptions | Transactions identified as unusual relative to the account. |
| General Ledger Summary | Summary of activity and balances across accounts. |
| GST Reconciliation | Compare GST recorded with GST reported to the ATO. |
| Journal Report | Journal entries made in the ledger. |
| Realised Gains and Losses | Detailed realised currency gains/losses. |
| Taxable Payments Annual Report | Payments made to contractors for ATO reporting. |
| Trial Balance | Account balances at a point in time. |
| Trial Balance by Date Range | Account balances for a chosen date range; marked New. |

## B. Transactions

| Required report / tool | Source catalogue description / target outcome |
| --- | --- |
| Account Transactions | Detailed transactions in selected accounts. |
| Backorder History | Fulfilment of backordered invoice lines over time. |
| Duplicate Statement Lines | Potential duplicate bank statement lines. |
| Inventory Item Details | Line-by-line inventory purchases and sales. |
| Inventory Item Summary | Purchase and sales totals by item. |
| Sales By Item | Sales summary for untracked inventory items. |

## B. Analytics

| Required report / tool | Source catalogue description / target outcome |
| --- | --- |
| Accounts graphs | Visualise and compare P&L and balance-sheet accounts. |
| Budgets | Customisable formula-based long-term budgets; marked Early access. |
| Business health scorecard | Pre-built/custom KPIs versus targets and earlier periods. |
| Cash flow manager | Projected cash position and planning. |
| Cash graphs | Cash in/out and bank balance changes. |
| Industry benchmarks | Compare financial performance with similar businesses. |
| KPI graphs | Visualise scorecard KPIs. |
| Performance dashboards | Combine KPIs, benchmarks and financial data. |
| Profitability graphs | Visual breakdown of business profitability. |

Total catalogue entries transcribed: 87. Source list evidence is not proof every historical report layout or formula has been independently exercised.

# Appendix C — Source and research register

The [U1] user attachment is the contractual feature floor. [S1]–[S18] were publicly accessible official vendor, regulator or standards sources consulted for competitive and Australian statutory requirements on 24 October 2026. All technical and commercial proposals in this document are design recommendations rather than third-party claims.

| Ref | Source / evidence | URL or provenance |
| --- | --- | --- |
| U1 | User-supplied Xero Features and Functions: Account inspection and information presentation review, v4, 24 October 2026 — Attached 42-page Xero review, feature IDs F001–F352 and report catalogue; private account observations; inventory not transactional audit | User-supplied 42-page DOCX; v4 |
| S1 | Xero Australia — All Features — Xero published category and subscription scope | https://www.xero.com/au/accounting-software/all-features/ |
| S2 | Xero Australia — Compare Pricing & Features — Plan-dependent coverage, analytics, payroll, expenses, foreign currency | https://www.xero.com/au/pricing-plans/ |
| S3 | MYOB — All Features — Australian BAS, payroll, stock, jobs, multi-currency and bank feeds | https://www.myob.com/au/features |
| S4 | QuickBooks Australia — Accounting Features — AI agents, automation, advanced role permissions, inventory, budgets and project tools | https://quickbooks.intuit.com/au/accounting-software/features/ |
| S5 | Reckon Australia — Accounting Software — Accounting, payments, feeds, inventory, payroll and mobile | https://www.reckon.com/au/accounting-software/ |
| S6 | Zoho Books Australia — Accounting Features — Customer/vendor portals, sales orders, landed cost, workflows and reports | https://www.zoho.com/au/books/accounting-software-features/ |
| S7 | ATO Software Developers — STP Product Registration — ATO whitelisting, OSF and conformance testing | https://softwaredevelopers.ato.gov.au/STP_ProductRegistration |
| S8 | ATO Software Developers — DSP Operational Security Requirements — MFA, authentication, logging, security certification and related controls | https://softwaredevelopers.ato.gov.au/RequirementsforDSPs |
| S9 | ATO Software Developers — Payday Super — Qualifying earnings; super on payday from 1 July 2026; payment receipt timelines | https://softwaredevelopers.ato.gov.au/PaydaySuper |
| S10 | ATO Software Developers — Peppol eInvoicing — Accredited partner/access-point option | https://softwaredevelopers.ato.gov.au/eInvoicing |
| S11 | ATO Software Developers — Standard Business Reporting — SBR technical and reporting gateway | https://softwaredevelopers.ato.gov.au/sbr |
| S12 | ACCC — Consumer Data Right — Consent-based bank data sharing through accredited recipients / representatives | https://www.accc.gov.au/by-industry/banking-and-finance/the-consumer-data-right |
| S13 | ASIC — Company Record Keeping — Australian company financial records generally retained at least seven years | https://www.asic.gov.au/for-business-and-companies/companies/company-building-blocks/company-record-keeping |
| S14 | Fair Work Ombudsman — Record-keeping — Employee wages/time records must be retained seven years | https://www.fairwork.gov.au/pay-and-wages/paying-wages/record-keeping |
| S15 | OAIC — Australian Privacy Principles — APP obligations incl. personal information security and access | https://www.oaic.gov.au/privacy/australian-privacy-principles/australian-privacy-principles-guidelines |
| S16 | ATO Software Developers — Getting Started — EVTE testing, verification and whitelisting before production | https://softwaredevelopers.ato.gov.au/getting_started |
| S17 | ATO Software Developers — Super Product Register — SuperStream/Payday Super software ecosystem | https://softwaredevelopers.ato.gov.au/Superproductregister |
| S18 | ATO Software Developers — Sending Service Providers — SSP pathway for STP transmission; DSP remains responsible for compliant data | https://softwaredevelopers.ato.gov.au/STPSSPs |

# Appendix D — Definition of full Xero parity and change control

Any addition or functional change to this scope requires a new version and an acceptance-register delta: never mark a baseline requirement complete because a related API exists or a UI control appears. A fully accepted Sandy Accounting GA means all 352 F-ID functions, all 87 named report/tool entries, all statutory integrations required by the marketed service, all negative permission tests, and all migration/exit tests have signed, inspectable evidence. Any narrower product should be named and marketed explicitly as a limited edition, without claiming full replacement.

Release readiness is based on real accounting output and verified external effects, not speculative competitor equivalence. This is a scope, not a representation that Sandy Accounting already exists, has passed independent security testing, has been authorised as an ATO software provider or has completed integration agreements.

