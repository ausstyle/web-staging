# Sandy Legal — Australian litigation workspace
Version: 1.0 | 24 October 2026 | Status: PROPOSED / NOT IMPLEMENTED
Product owner: Sandy AI | Repository: ausstyle/web-staging

## 1. Outcome and positioning

Build Sandy Legal as a **client-controlled litigation command centre**, not a replacement for qualified legal advice or a law-firm practice management/trust accounting system. A client can see every dispute, proceeding, pleading, order, appointment, engagement, invoice, evidence item, instruction and obligation in one permission-controlled workspace. Sandy handles preservation, ingestion, organisation, source-linked analysis, follow-ups and approved administrative execution.

Core promises:
- Continuity of the entire client legal record across changes of solicitor, counsel and jurisdictions.
- Every assertion and milestone linked to original source material and a verified state.
- The next deadline, owner, obligation, decision and cost is visible, with no silent failure.
- One client may act personally and for multiple companies, but those entities have separate ownership and access grants.
- A dispute may contain many proceedings and associated appeals, interlocutory applications and enforcement processes.

This is an architecture proposal; no new endpoints, schemas, court connections, document migrations, live filing integrations or releases are claimed.

## 2. Alignment with Sandy's deployed and proposed architecture

Governing architecture:
- docs/sandy-engineering/master-scope-v1.md
- docs/sandy-engineering/architecture-contracts.md
- docs/sandy-engineering/tasks/SANDY-ENG-0012-sandy-cloud-drive-backup.md
- docs/sandy-cloud/architecture.md
- docs/sandy-api/api-scope-161.md

Sandy Legal **owns domain truth** for matters, proceedings, orders, parties, counsel engagements, legal milestones, issues, procedural statuses and legal review/approval workflow. It **does not own** file bytes, email message originals, identity, general tasks, the global calendar, general memory, payment execution or the agent orchestrator. Link to those systems by stable ID and event/projection. Do not create a second global source of truth.

Existing production universal-file relations must be inspected and reused rather than destructively replaced. Supabase project zmqlyygzqoidkcwdysok remains Sandy's current main transactional and identity platform. Sandy Cloud's proposed Google Cloud Storage object plane and Cloud SQL candidate are not automatically production-ready. Do not couple launch of Legal to an unverified Cloud migration; an object-store adapter allows existing verified storage initially and future approved migration.

Use the existing Sandy API first with versioned, named operations; Sandy MCP remains a thin adapter. Every operation has verified actor/tenant/company scope, idempotency, expected revision where needed, audit, success evidence, and clear failure states. Existing worker/outbox/mission mechanisms handle durable processing. UI must not directly bypass the API authorization boundary.

## 3. Navigation and customer experience

Top-level portal entry: **Legal**. A personal/company selector applies to all views and never confers access itself.

**Portfolio page**: tiles by client/entity and matter; active/pending/appeal/enforcement/closed; next verified deadline; next hearing; assigned lawyers; changes since last visit; outstanding client approvals; current exposure and billed costs; privileged/highly restricted indicators without leaking content.

**Matter overview**: case narrative and procedural posture, linked proceedings with case numbers and courts, chronology, current orders, responsibilities, counsel/team, latest correspondence, document count, decision log, financial position, risk register and activity log. Every card drills to its source.

**Proceeding page**: originating case, court registry/division/list, filed parties and roles, judicial officer if confirmed, case number, relevant rules snapshot, directions/orders and compliance matrix, events, filings, service, appeal and enforcement links. Do not conflate a dispute with a proceeding.

**Files & evidence**: filing/evidence facets layered on Sandy Cloud; default virtual folders: 01 Engagement & Authority, 02 Pleadings, 03 Applications & Submissions, 04 Affidavits & Exhibits, 05 Court Orders & Notices, 06 Discovery & Evidence, 07 Transcripts & Hearing Materials, 08 Counsel Advice & Legal Research, 09 Correspondence, 10 Costs, 11 Settlement & Offers, 12 Judgments/Appeals/Enforcement, 13 Archive. Physical file organisation remains user-configurable; metadata categories and search work regardless of folder.

**Dates & tasks**: court calendar, verified deadlines, proposed deadlines awaiting review, directions checklist, owner, solicitor/client responsibility, reminders, escalation, timezone/court registry, holidays and date-calculation provenance.

**People & appointments**: party, role and represented-by graph; solicitor, law firm, barrister, senior counsel, expert, witness, registry contact and authorised collaborators; contact methods, practising details where supplied/verified, start/end and scope of engagement, conflict restrictions and replacement history.

**Costs**: signed engagement letters, costs disclosures, counsel briefs, fee structures, estimated stages and revisions, issued invoices with itemisation, paid/approved/disputed status, disbursements, filing fees, cost orders, security for costs, adverse costs exposure, retainer balances when supported. Do not claim legal-trust-account functionality or independently execute payments.

**Questions for Sandy**: case-specific Q&A with file/page/paragraph citations, permission-safe comparison, chronology generation, open questions and cited summaries. Never present unsupported litigation outcomes or legal advice as facts.

**Client decisions**: lawyers' advice and options, questions posed, requested approvals and instructions, agreed strategy records, risk flags, conflict checks, timestamped decisions and who authorised an action. Separate private client notes from counsel-shareable material.

## 4. Information model

Proposed logical aggregates; final table and field design requires as-built review:

- legal_matters: id, tenant, owning_person_or_company, label, type, dispute_summary, primary_contact, status, privacy_policy, retention_policy, version.
- legal_proceedings: id, matter_id, court, state_or_commonwealth, division/list, proceeding_number, proceeding_type, stage, filed_date, linked_parent_proceeding, status, registry, source_verification.
- legal_parties and legal_representations: named persons/organisations, legal role, associations, appointment dates and source.
- legal_contacts and legal_engagements: law firm, person, counsel/expert, engagement letter file ID, scope, rates, budget, authority, cost disclosure, appointment history.
- legal_documents: stable document identity, document class, proceeding references, author, date, issue, privilege class, filing/service statuses, custody, evidence label, original file ID.
- legal_document_versions: immutable file-version IDs, original digest, ingested-at, OCR derivation, page map, source, reviewer and review status; sealed/served/native versions are distinct.
- legal_procedural_events: hearings, conferences, judgments, applications, registry events and source/verification state.
- legal_orders and legal_obligations: exact order text, obligation, addressee, timing expression, interpreted deadline, court registry timezone, source citation, review/sign-off, task/calendar mappings.
- legal_filings and legal_service_records: submitted/accepted/rejected/sealed states, registry receipt/seal, lodgement and acceptance times; served parties, method, delivery receipt, affidavit of service where applicable. Filing is not service.
- legal_deadlines: sourced time calculation, legal basis, triggering event, holidays/exclusions, status unverified/verified/superseded, reviewer, escalation and history.
- legal_issues, legal_claims, legal_evidence_links: pleadings paragraphs/causes/defences, supporting and contrary evidence, document anchors, objections and unresolved factual gaps.
- legal_chronology_events: dated events, competing assertions, supporting sources, dispute/review flags.
- legal_instructions, legal_approvals, legal_decisions: sender, recipient, authority, content, delivery/acknowledgment, approval scope, revision, audit reference.
- legal_discovery_sets and legal_productions: custodian, legal holds, collected originals, stable control numbers, dedupe groups, privilege review, redactions, production manifest, sealed export and quality control.
- legal_cost_entries, budgets, invoices, payment_references and adverse_cost_scenarios: stage/engagement attribution, revisions and source.
- legal_research, authorities and citations: jurisdiction, decision identifier, official URL, proposition, source extract/version, human verification status.
- legal_case_links: link one matter/proceeding to appeals, enforcement, other cases and common evidence, without broadening access.
- legal_ai_activity and legal_access_events: model/purpose/input class/approval/reviewer/output hash and access/revocation/audit, without storing excessive prompt copies or privileged text in logs.

All records include ownership, immutable IDs, timestamps, provenance, subject ACL policy and event version. Strong foreign keys for legal-owned aggregates; cross-domain links are validated API references. Do not infer effective ACL from mere company membership.

## 5. Document capture and preservation

Accepted sources: drag/drop, bulk folder or ZIP upload, scanned paper, email with original MIME and attachments, Microsoft Graph / Gmail by explicit authorised account and label/folder/search rules, Sandy Cloud files, manually provided official registry PDF/receipts, and selected linked Drive folders. Proposed later: approved portal integration for registry imports; never assume a court supports a public API or credential sharing.

Ingestion pipeline: register source → malware/quarantine → persist original with source IDs and cryptographic digest → detect duplicate exact original → generate extracted text/OCR as derivative (never replace original) → classify and suggest matter/proceeding → extract parties, references and potential deadlines → permission/privilege classification → present uncertain links for review → index eligible content → issue durable receipt and audit.

Preserve native Word, Excel, PDF and email files and their metadata; independent versions for drafts, executed, submitted, sealed and served copies. Capture headers, recipients, timestamps, attachments and email thread IDs. Deduplicate bytes without collapsing different appearances, custodians or provenance. Support bulk imports with checkpoints, retries, reconciliation and a discrepancy report.

Evidence controls: original-byte checksum, chain-of-custody events, custodian and original location, collection time, preservation hold, legal privilege and suppression flags, redacted copies as separate artefacts, controlled export manifests, Bates/control number and exhibit references, indexed page and paragraph anchors. Search and previews honour all effective restrictions. Privilege suggestions are never treated as definitive legal determinations.

## 6. Australian proceedings and court adapters

Launch jurisdiction profiles: Federal Court of Australia; NSW Supreme, District and Local Courts; Victorian Supreme Court. Expand by verified rules for other states/territories, tribunals, Fair Work Commission, and specialist jurisdictions.

Each court profile is a versioned registry of court, registry, e-filing portal, applicable rules/practice notes, permitted document types, filing constraints, public case lookup paths, AI preparation restrictions, relevant timezone, ordinary registry calendar, receipt semantics, and citation to authoritative material. Profile and rule-version updates require editorial/legal review and effective date.

Federal Court: eLodgment, Commonwealth Courts Portal, Federal Law Search; account for filing acceptance versus transmission, sealed copies, the three-month eLodgment access window, technology/electronic discovery expectations, and eBooks Practice Note (11 June 2026). For filed material, preserve accepted/sealed receipts. Use GPN-AI (16 April 2026) for court-specific AI policy.

NSW: NSW Online Registry and online court list; capture file numbers, documents, and court events where authorised; treat listings as potentially changeable. Enforce NSW SC Gen 23 and relevant jurisdiction practice directions, especially limitations on generative AI for affidavit/witness evidence.

Victoria: RedCrest eFiling and its exceptions, sensitivity and confidential filing procedures, and SC GEN 25 (14 May 2026) on AI.

**Release v1 uses assisted filing**: generate a readiness checklist and court-ready bundle for lawyer/user submission, accept portal receipts and sealed PDFs; mark as FILED only after proof of court acceptance. Do not automate registry submissions unless an authorised and approved integration can produce a verifiable court-side result. Service separately requires evidence.

Deadlines are NOT inferred from an unreviewed LLM reading alone. The parser proposes an obligation with quote, clause/page, triggering event and possible calculation. A named lawyer/authorised reviewer verifies the computed due date using applicable rules, orders and holidays. Store all revisions; cancellations and appeal orders supersede earlier deadlines without erasing them. High-risk unverified dates are conspicuous and routed for urgent review; independently known hearing dates must be checked against latest lists.

## 7. AI assistance and legal safeguards

Permitted administrative capabilities (subject to matter policy):
- Citation-linked case briefings; document/entity search; comparisons of pleadings versions and orders.
- Chronology and issue matrix; factual contradiction checks; document gap analysis and evidence map.
- Draft neutral emails to lawyers, follow-up questions, agendas, hearing preparation checklists, document indexes and budgets.
- Extract fee estimate changes, invoicing discrepancies and unresolved lawyer requests.
- Search for publicly available judgments and legislation, then record source/effective date.
- Summarise legal advice **as a summary of identified advice**, not fresh definitive advice.

Restricted or prohibited operations depend on jurisdiction:
- Do not autonomously invent, write or rephrase witness factual evidence where court rules prohibit it; NSW evidence-generation restrictions should be explicitly gated rather than handled by a generic disclaimer.
- Never fabricate citations, quote unverified authorities, certify the authenticity/admissibility of evidence, diagnose legal merits conclusively or state a filing/service has occurred based only on Sandy's attempt.
- Require human verification of any court-facing submission, affidavit, pleading or cited legal proposition. Track AI involvement/disclosure/review as required by applicable practice note and court order.
- Sensitive/compelled-disclosure documents are excluded from model calls and retrieval unless matter-specific legal/use authority and suitable approved processing configuration exist.
- External model usage must preserve confidentiality/privilege by design, with client/lawyer approval, data-use controls, provider terms and processing locations reviewed before enabling.

Each generated insight has a provenance manifest: original file ID and version, page or paragraph, extraction method, model/policy version, who checked it, and whether it is a fact, suggestion, disputed assertion or unverified interpretation. An AI-generated chronology must not silently change an evidence record.

## 8. Security, client autonomy and compliance

Model sharing roles: Client Matter Owner; Client Admin/Executive; Client Collaborator; External Solicitor; Barrister; Expert/Witness limited upload; Accountant invoice-only; Read-only Adviser; Sandy delegated service actor. Permissions are per matter **and** per document category; protect privileged legal advice, confidential settlement, counsel instructions, compulsory process materials and personal/other-company data. Explicit scoping for opposing party materials and common-case evidence. A lawyer removed from a matter immediately loses access, subject to separate lawful retention outside Sandy's client-held system.

Implement fine-grained RBAC/ABAC, enforced server side with RLS where accessible, re-evaluation after sharing changes, least privilege, strong authentication/MFA/passkeys, time-limited shares, tenant-specific key management strategy, encryption in transit and at rest, malware scanning, logs, immutable audit, retention/holds and tested backups/restores. Default to Australian data-location options for high-sensitivity clients **only when verified for storage, backups, logs, embeddings and AI processing**; label actual location transparently. Never call a service fully Australia-resident merely because its file bucket is there.

Assess Privacy Act 1988/APP 8 overseas disclosures, APP 11 security/retention, Notifiable Data Breaches, legal professional privilege, confidentiality, suppression/non-publication orders and litigation preservation. Enforce legal hold before disposal. Matter export must include originals, versions, source provenance, email (.eml/.msg where available), metadata, manifest and checksums, ACL-free readable archive and client-accessible import mapping. Client data portability without dependence on continuing subscription is important.

Do not log sensitive full content into telemetry, shared support dashboards or an unrestricted global memory. Sandy's World Model may store only authorised matter-level facts/projections with matching matter ACL, subject to revocation and provenance.

## 9. Example cross-service workflows

A. Solicitor emails new court orders: Graph/Gmail watch captures authorised message → original archived → order attached and matched by verified case number → suggested obligations extracted with quotes → lawyer/client confirms deadlines → tasks/calendar updated atomically by mapped operations → reminders escalate when owner fails to acknowledge. Delivery, filing and compliance remain distinct statuses.

B. Client asks whether an affidavit was filed: Sandy looks for filed status, sealed PDF and portal/provider receipt, not just draft/unsent email. If proof absent, answer is UNKNOWN / awaiting verification and assign follow-up; never claim filed.

C. Change of lawyers: close old engagement and revoke access → preserve instructions, signed retainer and documents → produce reviewed handover bundle with docket chronology and pending deadlines → share exact authorised bundle to new lawyer → verify delivery/receipt.

D. Preparation for hearing: generate court-specific checklist, issue and exhibit index, compliant eBook or court book draft, references linked to native source and stable discovery IDs; legal professional signs off.

E. Invoice arrives: match person/engagement/rates and stage → compare with current estimates and approvals → surface variation or anomaly → draft query for authorised client review → never pay without permission.

F. Preservation/discovery: issue legal hold → preserve originals, custodians and metadata → counsel confirms collection/privilege/relevance → produce protocol-compliant review or disclosure set with audit and checksums.

## 10. Logical technical flow

Web/mobile/email/chat/voice → Sandy API & identity/delegation → Legal Domain module (single write owner) → legal metadata in existing Sandy transactional platform → domain outbox → durable Sandy worker → Cloud files/original messages + extraction/search + task/calendar/memory projections → confirmed receipts and client notifications.

Sandy Cloud is authoritative for file object/version and restore; Sandy Mail/connected Gmail/Graph for upstream message access and provider message identities; Sandy Tasks/Missions for execution; Sandy Calendar for subscribed events; Sandy Memory for permission-filtered assertions; Sandy Legal for case-specific facts, deadlines, court orders and procedural provenance.

Search: filtered keyword/full text + optional embeddings over approved extracted version content. Per-result ACL check before retrieval and again before AI context construction. Derived indexes purge or invalidate promptly after revoke/redaction/delete. Avoid a second search index that loses scope. Queue expensive OCR/import/export with resumability, per-tenant quotas and failure surfaces.

## 11. Proposed API operations (names subject to registry reconciliation)

Matter: create, list, get, update, close, link_proceedings, grant_access, revoke_access, export.
Proceeding: register, update, court_profile_get, court_activity_record, verify_registry_event.
Document: attach, classify, set_privilege, list_versions, link_evidence, search, prepare_bundle, verify_original.
Order/deadline: extract_proposals, approve_obligation, supersede_order, calculate_deadline_proposal, verify_deadline, sync_task_calendar.
Team/finance: contact_link, engagement_record, engagement_end, costs_register, estimate_update, invoice_compare, approval_request.
Intelligence: matter_briefing, chronology_build, issues_matrix, source_answer, correspondence_followup.
Filing: readiness_check, record_submission_attempt, record_court_acceptance, record_service_evidence.

Names are illustrative proposed contracts, not deployed APIs. All effects go through verified existing Sandy API operations, not unbounded browser automation or direct model tools.

## 12. Delivery plan

P0 – Discovery and legal/security design: deployed-state readback, schema and workflow map, threat model, jurisdiction matrix, privilege policy, tenancy model and Australian data flow/procurement review. Audit current universal files, tasks/calendar and identity rules. No migrations before this gate.

P1 – Core client workspace (MVP): create matter/proceedings; manual + email/ZIP import; immutable originals; classified docs; counsel/retainer contacts; source-linked case timeline; orders and human-verified deadline/task reminders; client/solicitor roles; comprehensive export and audit. Support Federal and NSW first.

P2 – Advanced document intelligence: secure OCR/index/search, document comparison, case briefings, evidence/issue maps, verified chronology, email follow-up, invoices/budgets and document-gap analysis. User-controlled, permission-aware AI.

P3 – Court and counsel workflows: Victorian profile, advanced eBooks, bundles, discovery exports, professional review/approval queues, controlled law-firm and registry connectors where available, and proactive court list checks.

P4 – Broader Australia and scale: jurisdiction packs for other states, tribunal coverage, tailored litigation reports, assisted eDiscovery at volume, corporate matter portfolio, insurer/funder views, enterprise retention and audited integrations.

## 13. Acceptance criteria

AC-01: Cross-tenant, cross-company, revoked-lawyer and restricted-document access tests fail closed in UI, download, search, embeddings and model retrieval.
AC-02: A 1000-file mixed PDF/Word/email/ZIP import reconciles counts, hashes, attachments, originals, source timestamps and rejects/quarantines with a transparent error report.
AC-03: A new order never silently becomes a verified deadline; human review, source and calculation are mandatory; revision cancellation propagates safely to task/calendar without erasing audit.
AC-04: Filed, served, accepted, rejected and draft document states cannot be confused; no court-side receipt means no filing-success claim.
AC-05: At least two opposing, related and appeal proceedings coexist within one dispute without mistaken sharing.
AC-06: Privileged documents never reach unrelated client or public model contexts; prompt injection inside evidence cannot cause an unauthorised send/share.
AC-07: Court-specific AI rules block prohibited drafting and record reviewer verification/required disclosure before a court-facing bundle.
AC-08: Engagement changes revoke access and produce checksum-verified handover with pending obligations and source material.
AC-09: Matter export and disaster restore are independently exercised and checksum validated.
AC-10: Email duplicate/webhook replay, OCR retries and legal event race conditions do not create duplicate deadlines, sends or charges.
AC-11: Lawyer invoice and estimate tracking never silently labels an unpaid bill paid; all values are attributable to approved source documents.
AC-12: Staff/support cannot open privileged records by default; access escalation is scoped, time-limited and audited.
AC-13: End-to-end client query about a proceeding includes source citations and clearly distinguishes verified, disputed, inferred and unavailable facts.
AC-14: No new service is labelled production-ready without release receipts, negative tests and a monitored rollback plan.

## 14. Regulatory and court references (review at implementation)

- Federal eLodgment: https://www.fedcourt.gov.au/online-services/elodgment
- Federal Technology Practice Note: https://www.fedcourt.gov.au/law-and-practice/practice-documents/practice-notes/gpn-tech
- Federal eBooks Practice Note (11 June 2026): https://www.fedcourt.gov.au/law-and-practice/practice-documents/practice-notes/gpn-ebooks
- Federal GenAI Practice Note (16 April 2026): https://www.fedcourt.gov.au/law-and-practice/practice-documents/practice-notes/gpn-ai
- NSW online registry: https://courts.nsw.gov.au/going-to-court/online-services.html
- NSW generative AI practice: https://supremecourt.nsw.gov.au/practice-procedure/generative-artificial-intelligence.html
- Victoria RedCrest: https://www.supremecourt.vic.gov.au/forms-fees-and-services/filing-documents-with-the-court
- Victorian court AI practice: https://www.supremecourt.vic.gov.au/areas/legal-resources/practice-notes/sc-gen-25-the-use-of-artificial-intelligence-by-court-users
- OAIC APP guidelines: https://www.oaic.gov.au/privacy/australian-privacy-principles/australian-privacy-principles-guidelines
- Law Council ASCR: https://lawcouncil.au/policy-agenda/regulation-of-the-profession-and-ethics/australian-solicitors-conduct-rules

Regulatory requirements vary by date, court, matter type, court order and customer/legal-practice status. This product architecture is not legal advice. All rules and AI-use permissions must be validated by appropriately qualified professionals before production release.
