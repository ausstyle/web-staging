# SANDY-ENG-0013 — implementation evidence and remaining delivery

## Source reconciliation, 24 October 2026

- GitHub PR **286**, merged, exact head `2cf5f04650d9623a78daf0894dc6b670936aa9ed`, merge `08303f559a94306c70bf175aa1a42d8a4fddad49`. Read the entire canonical v1.1 scope including Appendices A–D. Its bytes match the isolated worktree baseline from current main `6040a35`.
- Canonical path: `docs/sandy-engineering/tasks/SANDY-ENG-0013-sandy-accounting.md`; no guessed replacement scope. The manifest confirms Accounting **0013**. The full Xero v4 inventory is transcribed in Appendices A/B. The original private 42-page U1 DOCX is not present in this workspace; no claim of re-inspecting that private account is made.
- Read AGENTS, engineering README, Master including v1.2 Amendment B, implementation program, shared architecture contracts and the entire 161-family API scope. `/workspace/.agents` and `.codex` are empty; no local skills/AGENTS override exists inside this new package.
- Mail PR239 is open at `b1d499f8dd946b6fda11e0cfcaa1f508ec435a08`. Its implementation branch `feat/sandy-mail-first-ingest` at `a72e87d717387510c860febf53cc5e316b75a9f9` confirms Mail **0014**, but contains Accounting manifest version 1.0. Do not cherry-pick that manifest over Accounting 1.1. Current main has not yet incorporated Mail0014. This change edits neither shared manifest nor Mail source.
- Version gap: the engineering program index still says twelve scopes and its start instruction mentions Master 1.1, despite Master 1.2 and the Accounting 0013 manifest entry. Preserve Accounting's exact scope authority; reconcile shared documentation with the owning integration branch rather than silently rewriting concurrent scope work.

## As-built observations (read-only, not acceptance)

Queried `information_schema` and the live operation registry in Supabase project `zmqlyygzqoidkcwdysok`. No first-party accounting/journal/GL tables or `accounting.*` / `xero.*` operation rows were found. This does not imply all Xero transport functions are absent: `sandy_xero_grants` exists as a provider OAuth grant owner and must not be repurposed as a first-party ledger.

Existing owners observed:

| Domain | Existing owner / evidence | Accounting treatment |
| --- | --- | --- |
| Tenant identity | `sandy_api_tenants` | Reference verified tenant, never create a competing account identity. |
| Company | `sandy_agenda_companies(id,customer_id,name)` | Explicit mapping required. `customer_id` is not assumed equal to `tenant_id`. |
| Admission | `sandy_api_execution_admissions` with actor/tenant, input/contract/scope hashes, expiry, policy state, receipt | Mandatory production adapter; no registry exposure here. |
| Files | `sandy_universal_files`, references, links and aliases, owner/hash/provider metadata | Source reference interface only; no new storage service or file migration. |
| Missions | `sandy_mission_runs`, decisions, work products; `sandy_orch_outbox` leases | Retain canonical task/mission engine; no new scheduler. |
| Billing commerce | `sandy_commerce_accounts`, commerce ledger API | Existing commercial billing is not a general ledger; leave unchanged. |

Fetched the actual deployed `sandy-operation-api` source: ACTIVE version **65**, bundle SHA-256 `8d32afc087586241e3b070f9c217ec1c304e6dc617871239e97eb085e3a94f4c`, 129 source files. It has existing admission/certification/governed execution adapters. No production gateway edit or live source-parity claim for the new package is made. The MCP accounting catalogue returned no authorized executable entries; the independent database registry query also returned none.

## Bounded accounting ADR

Implement a modular TypeScript accounting core with an isolated relational PostgreSQL candidate, faithful to scope section 7. Keep tenant/company IDs externally supplied by a trusted canonical boundary. For local tests only, use PGlite with a NOLOGIN test role, RLS, exact NUMERIC columns, book locks and immutable postings. The selected future Cloud SQL data plane remains a target; this does not select a paid instance, region, credentials or production tenancy policy. The schema is deliberately outside `supabase/migrations` and cannot be picked up by shared migration automation.

Postings, document updates, allocation, idempotency and audit commit in one transaction. Every accounting correction is an additional dated journal; reports retain the original effect in earlier periods. No automatic balancing plug, invented FX, tax rate or assumed external settlement is permitted. Tax amounts in synthetic documents are explicit reviewed-input fields, not an Australian tax rules implementation.

## Test coverage and evidence classes

The source files in `packages/sandy-accounting` implement a local foundation, manual workflow, corrections and deterministic scenario module. Tests use independent expected integer totals and actual PostgreSQL behavior via PGlite, not a mock SQL result. They remain **local synthetic evidence**.

| Scope obligation | Current evidence | Remaining gate |
| --- | --- | --- |
| AC01 | 10,000 vouchers; exact integer oracle; balanced SQL query; same-key concurrent retries | Multiple PostgreSQL connections/processes, crash injection under production engine, independent accounting review |
| AC02 / IA09 | 100 wrong-company reads/writes denied; wrong-tenant RLS read empty; authority revocation | Real token/session/company mapping; all channels/files/search/payroll; security review |
| AC03 | Immutable statement lines, duplicate-source conflict, partial matches, overmatch denial and undo | Real formats/feeds, transfer/chargeback cohort, accepted bank baseline |
| AC04 | Draft/approve invoice/bill, partial payment, payment-record reversal, void with historical ageing | Credit/refund/recurring/PO/expense lifecycle and delivery/provider receipts |
| AC05 | Exact decimals, rational FX provenance and rounding rejection | Effective-dated AU tax engine, FX settlement/revaluation and externally reviewed fixtures |
| AC09 | Seven partial report selectors, source drilldown, independent bank/P&L/AR totals | All 87 full contracts, cash basis, layouts/exports and accountant acceptance |
| AC12 | Commit survives database restart and SIGKILL after commit; failed transaction rolls back | Abrupt process kill at remaining boundaries, multi-node failover, PITR/restore, provider unknown outcomes |
| IA01/02/16/18 | Suggestions have no effect; missing/revoked source denied; manual workflow has no AI dependency | 1,000-line mixed financial cohort, genuine approvals/missions and full AI/rollback acceptance |
| IA03 | Exact 13-week/12-month scenario totals, probability inputs and month-end boundaries | Historical back-tests, forecast calibration, complete obligations, independent review |
| AC13 | Generated register validates exactly 352 F-IDs, 87 reports, 15 SAI IDs and 31 acceptance gates | Per-feature end-to-end acceptance; generated inventory is not a pass |

Chromium browser test exercises draft → approve → payment record → statement import → reviewed reconciliation → report → source → audit. It expects bank 1,100.00 and profit 100.00; no page errors. Screenshot/result artifacts are produced locally and by the scoped CI job. Installing a separate Playwright browser download returned HTTP 403; the already-installed system Chromium successfully ran the same test, so browser verification is not blocked.

Source status, local test status, deployment and independent acceptance are separate. **Deployed: no. Independently accepted: no. Overall v1.1 scope: open.** Nothing here is ATO accreditation, bank authorization or a production release.

## Official-source revalidation

Checked official primary sources on 24 October 2026:

- [ATO Payday Super](https://softwaredevelopers.ato.gov.au/PaydaySuper) confirms the 1 July 2026 change, 12% qualifying-earnings calculation and receipt deadline subject to exceptions. This source is not a complete payroll rule pack; none is invented here.
- [ATO STP product registration](https://softwaredevelopers.ato.gov.au/STP_ProductRegistration) requires product/service registration, applicable security framework and conformance obligations. No product enrollment or transmission has occurred.
- [PostgreSQL numeric types](https://www.postgresql.org/docs/current/datatype-numeric.html) supports exact NUMERIC for monetary amounts; unconstrained numeric plus integer/bound checks prevents scale coercion. Currency precision remains explicit.

The Supabase changelog Markdown endpoint was unavailable (web content-type rejection, then direct HTTP 403). No Supabase feature or schema change was implemented; read-only metadata inspection succeeded. Relevant Supabase/Postgres skills were read; their guidance does not authorize shared production migrations.

## Dependency-ordered remaining work

The [delivery register](delivery-register.json) is an exhaustive inventory, not a smaller product definition. Continue WP1 with normalized production SQL roles/tenancy ADR, real multi-connection and kill/recovery fixtures, canonical admission/evidence adapters and a scoped staging release. WP2/WP3 then complete AR/AP/credits/recurring, real import formats, bank reconciliation and governed communications/provider adapters. WP4 adds assets, valuation and projects. WP5 requires accountant/payroll-owned rule packs and externally authorized tax/payroll providers. WP6 completes every named report. WP7 adds genuine Sandy Missions/Memory/Mail/Files integration, mode/revocation controls and all SAI/IA gates. WP8 closes migration/exit, mobile, recovery, operational and launch acceptance. These remain mandatory; no full-parity claim is authorized by this alpha.

## Exact unresolved release and external decisions

| Target / action | Reason and current state | Impact / cost / rollback |
| --- | --- | --- |
| Existing staging Accounting host and PostgreSQL database | No Accounting target, mapping, role or scoped release grant was verified. **Not attempted**; no denial or uncertain live mutation. | Blocks shared deployment, not local implementation. Use existing resources only after target/owner confirmation; cost unknown until selected. Roll back service artifact/flag; preserve posted data. |
| `sandy-operation-api` and canonical registry | Shared concurrent API161/runtime component; this change has no release lock or reviewed adapter installation. **Not attempted.** | Requires owner-coordinated exact contract/admission integration and digest compatibility tests. No IAM expansion assumed; rollback removes new dispatch/exposure only. |
| Cloud SQL / Cloud Run / storage | Region, HA, tenancy/cost ADR and billable provisioning authority missing. **Not provisioned.** | Cost cannot be quoted without sizing; retain local implementation. Proposed resources require exact cost/cap/cleanup plan before approval. |
| Real customer imports, bank feeds, payments, invitations, ATO/payroll/super transmission | Explicitly outside current authorization; provider onboarding and accepted fixtures also absent. **Not attempted.** | Remain blocked external. Financial effects/lodgments have no generic rollback; cancellation/correction requires provider-specific authority. |
| Independent acceptance | No accountant, payroll, security or product-owner sign-off supplied. **Pending.** | Local tests are useful evidence only; cannot claim GA, compliance or independent acceptance. |

No automatic approval-review denial occurred during this work. No customer data, credentials, IAM, live gateway/provider/runtime or concurrent product files were changed.
