# Sandy Accounting — architecture, scope and archive

**Current canonical scope:** [SANDY-ENG-0013 — Sandy Accounting v1.1](../sandy-engineering/tasks/SANDY-ENG-0013-sandy-accounting.md)  
**Status:** DRAFT / proposed engineering requirements; **not** evidence of deployed accounting services, product certification, live AI agents or Australian regulatory accreditation.  
**Scope discovery:** [Sandy engineering manifest](../sandy-engineering/scopes.json), ID `SANDY-ENG-0013`.

**Implementation:** [Executable internal alpha](../../packages/sandy-accounting/README.md),
[complete delivery register](delivery-register.json), and
[as-built/test/release evidence](implementation-evidence.md). Local synthetic code/tests
do not imply a deployed service, accepted accounting controls or full parity.

## Current version: v1.1 — Sandy Intelligence extension (24 October 2026)

The canonical Markdown is the authoritative, editable source. Version 1.1 preserves the complete original Xero minimum requirement floor (352 function IDs F001–F352 and 87 named reports/analytics tools), and adds:

- **SAI-001–SAI-015:** 15 first-class intelligence capabilities, with priority on autonomous bookkeeping, evidence intelligence, cash-flow management and supplier/spending intelligence.
- **Assist, Prepare and Autopilot:** configurable autonomy with the same underlying R0–R4 risk approvals and explicit separate controls for posted accounting transactions, outbound communications, payments, payroll and tax submissions.
- **Five Sandy Financial Mission templates:** month-end close, overdue collection, supplier cost reductions, cash shortage response, and BAS readiness, integrated with the existing Sandy Missions and Tasks architecture.
- **Financial Intelligence Centre and optional briefings:** evidence-linked, permissions-aware financial status, approval queue, issues and opportunity tracking, with provider receipt verification.
- **IA01–IA18:** 18 verifiable intelligence acceptance gates, plus work-package sequencing SI-P1–SI-P3, model fallbacks and cross-company governance.

[Download the Word-readable **v1.1** repository export](Sandy_Accounting_Scope_v1.1_repository_export.docx).

The Word-readable file is a generated representation of the canonical Markdown including native Word tables. Its typography, layout and pagination are **not identical** to the original styled 31-page v1.0 Word document. For exact and current normative wording, consult the canonical Markdown. The original formatted v1.0 DOCX remains a separate conversation artifact rather than a byte-for-byte GitHub archive.

## Previous version: v1.0

- [Earlier Word-readable v1.0 repository export](Sandy_Accounting_Scope_v1.0_repository_export.docx).
- Canonical v1.0 Markdown is available from Git history before the v1.1 update.
- The user-supplied evidence baseline was *Xero Features and Functions — Account inspection and information presentation review*, version 4, dated 24 October 2026, with F001–F352 and its report catalogue.
- Original locally generated v1.0 DOCX SHA-256: `34acb5795a67fce6e15028d1185b9a35f20ccc3ad29a03f2c9f219d249d4ba02`. Neither Word repository export is byte-identical to that source.

## Implementation and verification boundary

A GitHub document merge or catalogue synchronisation is **not software deployment**. Do not mark SAI features implemented, Australian STP/BAS integrations approved, bank transfers settled or payroll compliant because of these specifications. Development requires the canonical Sandy API authorisation boundary, independent financial ledger integrity, versioned provider receipts, human approvals, legal/accountant reviews, and the explicit acceptance gates above.
