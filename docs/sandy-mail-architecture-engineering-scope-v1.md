# Sandy Mail — Architecture & Engineering Scope v1.0

**Status:** Proposed engineering specification; **not deployed or production accepted**  
**Date:** 24 October 2026  
**Repository:** `ausstyle/web-staging`  
**Source:** `Sandy_Mail_Final_Architecture_and_Feature_Plan_2026_v3.docx` (full text converted to version-controlled Markdown)  
**Related:** `docs/sandy-cloud-hosting-architecture-engineering-scope-v1.md`; `docs/sandy-engineering/architecture-contracts.md`

> This document is a product and engineering scope, not evidence of implemented mail servers, databases, endpoints, service levels, DNS records, or customer mailboxes. Any deployment must follow Sandy's existing approval, audit and protected-release controls.

---

## Final Feature & Infrastructure Design Plan

An AI-native, SQL-first email service designed to compete with Outlook and Exchange Online in core mail functionality, and to differentiate through proactive intelligence and permissioned automation.

| **DOCUMENT STATUS**                                             | **SCOPE**                                                                                | **DATE**        |
|-----------------------------------------------------------------|------------------------------------------------------------------------------------------|-----------------|
| Agreed design direction — proposed specification (not deployed) | Native mail, connected mail, security, intelligence, client compatibility and operations | 24 October 2026 |

## The central decision

| Thin, globally redundant SMTP edge + custom Sandy mailbox backend + Google Cloud SQL PostgreSQL + original MIME objects in Cloud Storage + Sandy Intelligence. Outlook and other mail clients connect through standards-based protocol gateways. |
|--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|

## What success means

Sandy Mail must first be a dependable email service: messages arrive, send, synchronise, remain recoverable and are protected. AI then adds measurable value—better answers, fewer missed obligations, less wasted spending and work completed with the right approval.

“Superior to Outlook 365” is a product ambition, not a current claim. Microsoft already offers sophisticated mail AI, security and compliance; superiority must be demonstrated by measurable, user-facing outcomes rather than a feature checklist.

# 1. Product positioning and competitive boundary

Primary comparison: Outlook as a client, Exchange Online as the hosted mail service, and Outlook Copilot as the AI experience. Broader Microsoft 365 products—Word, Excel, Teams, SharePoint and the full Purview portfolio—are not part of the initial replacement scope.

| **Area**              | **Parity requirement**                                                                                          | **Sandy differentiation / win condition**                                                                        |
|-----------------------|-----------------------------------------------------------------------------------------------------------------|------------------------------------------------------------------------------------------------------------------|
| Core email            | Fast inbox, composition, folders, labels, threading, attachments, rules, aliases, scheduling, shared mailboxes. | One consistent mailbox across Sandy native, connected Outlook and Gmail accounts.                                |
| Outlook compatibility | IMAP/SMTP connectivity, authentication, autodiscovery where supported.                                          | Users retain Outlook for email while receiving Sandy AI in native Sandy services.                                |
| AI                    | Summaries, priority, drafting, triage, natural-language search.                                                 | Cross-provider, cross-document answers; evidence trail; proactive savings and obligations; controlled execution. |
| Protection            | Spam, malware, phishing, impersonation, quarantine, outbound abuse controls.                                    | Contextual detection of unusual invoices, changed bank details and supplier impersonation.                       |
| Business controls     | Domains, aliases, shared mailboxes, delegation, audit, retention, export.                                       | Transparent API-first operations, customer-controlled automation and source-backed audit.                        |
| Scale                 | Resilient transport, reliable databases, recoverable originals.                                                 | Sharded SQL-native data model; scale transport independently of search and AI.                                   |

The baseline is challenging: Outlook Copilot already supports inbox priority, summarisation, drafting, triage and broader inbox/calendar reasoning (see sources \[1\]–\[2\]).

# 2. Product feature requirements

## 2.1 Everyday email — P0 parity

- Inbox, Sent, Drafts, Archive, Spam, Trash; custom folders and labels; conversation view and split conversation controls.

- Compose, reply/reply-all, forward, formatting, inline media, signatures, templates, attachment previews, scheduled send, undo-send with clearly defined pre-dispatch delay.

- Conversation search with sender, recipient, subject, date, attachment type, size, folder, account and exact-message filters.

- Read/unread, star/flag, pin, snooze, rules, VIPs, multi-select, bulk actions, keyboard shortcuts, accessibility and offline-capable caching.

- Multiple identities, aliases, plus-addressing, custom domains, vacation replies, forwarding, distribution lists and shared mailboxes.

- Attachment upload/download with malware safety, practical message-size policies, secure shared-file links for oversized files and export of original .eml.

- Self-service, no-exit-fee mailbox export is P0: original EML message bundles, standards-based MBOX, mailbox metadata manifest, complete attachments, integrity verification and supported direct IMAP migration to another provider.

- Universal, lossless-by-verification bulk import is P0: authorised Gmail/Microsoft/IMAP sync; uploaded PST, MBOX, Maildir and EML archives; staged transfer with checkpoint/resume, no destructive source operations, itemised exception reports, and reconciliation before cutover.

## 2.2 Business mail — P0/P1

- Organisation/domain administration; user lifecycle; SSO and MFA; delegated access and send-as/send-on-behalf permissions with audit.

- Group mailboxes, role-based access, retention options, domain-level policy, security reports and delivery tracing.

- Calendar invitations and iCalendar/ICS interop from launch; native calendars, shared calendars, room/resource booking and address-book sync in the next business phase.

- DLP rules, legal holds, eDiscovery export and retention enforcement as a separate enterprise release gated by compliance tests.

## 2.3 Sandy AI — P0/P1 differentiation

| **Feature**               | **Specific requirement**                                                                                                   | **Release** |
|---------------------------|----------------------------------------------------------------------------------------------------------------------------|-------------|
| Understand every message  | Low-cost indexing and classification of each message; AI deep analysis only when relevant; store model/version/confidence. | P0          |
| Hybrid search             | Exact, keyword/BM25, semantic and relational searches; account and permission filters; citations to original evidence.     | P0          |
| Priority cockpit          | Needs response, waiting on reply, due soon, money at stake, unresolved fraud risk; explain every prioritisation.           | P0          |
| Smart compose             | Thread-aware drafts, tone rewrite, translation, cited context, meeting suggestions, recipient and attachment checks.       | P0          |
| Spending centre           | Bills, suppliers, tariffs, subscriptions, insurance, terms, recurring spend, price history and verified comparisons.       | P1          |
| Relationship graph        | People, companies, projects and historical commitments linked across email, documents, WhatsApp and voice.                 | P1          |
| Autonomous missions       | Prepare negotiations, bookings, follow-ups and document requests; explicit permissions, budget limits and human approval.  | P1          |
| Trust intelligence        | Flag new banking instructions, lookalike domains, unusual urgency and invoice anomalies with source evidence.              | P1          |
| Organisation intelligence | Shared business knowledge, delegated workflows and policy-approved automations.                                            | P2          |

Proactive opportunities must never be invented: tariff comparisons need actual eligibility, up-to-date prices and relevant contract terms. Every conclusion links to evidence and records the comparison date.

# 3. Deployment architecture and boundaries

## 3.1 Logical system tiers

| **Tier**                   | **Deployment model**                                                                      | **Responsibilities**                                                                                            |
|----------------------------|-------------------------------------------------------------------------------------------|-----------------------------------------------------------------------------------------------------------------|
| Global transport plane     | Three active SMTP regions: Europe, Americas, Asia-Pacific; at least two zones per region. | Inbound SMTP MX, outbound submission/relay, transport policy, durable queues, anti-abuse and delivery receipts. |
| Mailbox access plane       | Horizontally scaled HTTP APIs and IMAP gateways; separate SMTP submission.                | Authorise users, list/open/change mail, sync flags/folders, create drafts and send jobs.                        |
| Mailbox data plane         | Google Cloud SQL PostgreSQL HA per tenant shard + Google Cloud Storage.                   | Structured mailbox truth and indexes; immutable raw MIME, attachments and recovery ledger.                      |
| Event & intelligence plane | Pub/Sub, outbox relays, Cloud Run workers and regulated AI model access.                  | Async parsing, OCR, indexing, extraction, entity linking, fraud analysis and workflows.                         |
| Control plane              | Sandy Controller, domain service, identity, quotas, billing, policy and monitoring.       | Self-service provisioning, configuration, lifecycle, permissions, rollout and incident response.                |

## 3.2 Clear ownership rules

- Cloud SQL is the operational source of truth for Sandy-hosted mailbox state (message text, membership, flags, drafts, delivery state, ACLs).

- Cloud Storage keeps the byte-exact original RFC 5322/MIME message, extracted binary attachments, checksums and recoverable ingestion records. This archive is authoritative for original source bytes, not for folder/read state.

- The edge stores only durable in-flight transport queues. It does not own a second, independent permanent mailbox database.

- Connected Microsoft/Gmail mailboxes remain authoritative at their provider; Sandy maintains a labelled, permissioned synchronised copy and intelligence graph.

- Sandy's existing Supabase project remains responsible for existing platform functions; new Sandy Mail hosting data is held in Google Cloud, integrated through authenticated APIs and events.

## 3.3 Recommended technologies

| **Function**           | **Decision**                                                                                                       |
|------------------------|--------------------------------------------------------------------------------------------------------------------|
| SMTP edge              | Postfix with declarative, reproducible configurations                                                              |
| Security checks        | Rspamd + ClamAV + commercial threat intelligence + isolated sandbox                                                |
| API & workers          | Go or Rust services for high-performance mailbox/protocol code; Cloud Run for stateless APIs/AI workers            |
| Protocol gateway       | IMAP4rev1/IMAP4rev2-compatible service with proven protocol library and custom SQL storage adapter                 |
| Primary operational DB | Google Cloud SQL PostgreSQL 17+ where extension compatibility permits                                              |
| Search                 | SQL exact/FTS or pg_textsearch BM25 plus pgvector; migrate demanding search loads when benchmarks justify          |
| Object storage         | Private Google Cloud Storage buckets with checksums, versioning/retention controls and lifecycle policies          |
| Background transport   | Pub/Sub + transactionally committed SQL outbox; durable regional intake ledger                                     |
| Operations             | Cloud Monitoring, OpenTelemetry, structured logs, SIEM, alerting, dashboards and synthetic SMTP probes             |
| Identity               | Sandy OAuth/OIDC, passkeys for native clients, scoped service identity; client-specific credentials where required |

Native apps use a first-party HTTP/JMAP-inspired API. A standards-compliant JMAP endpoint is an eventual interoperability goal, not something automatically achieved by naming an API “JMAP”. See RFC 8621 \[9\].

# 4. Inbound and outbound message state machines

## 4.1 Inbound email acceptance

> **1.** MX edge receives SMTP on TCP/25; evaluates recipient policy and connection reputation, then scans or defers per security rules.
>
> **2.** Before returning SMTP 250, edge commits the accepted envelope and byte-exact message to durable acceptance storage under an internal delivery ID. For region-loss zero-loss service, a second independent region must confirm durability before the 250 response.
>
> **3.** If durability cannot be established, edge returns a temporary SMTP failure (for example 451) so the sending mail server retries; never acknowledge into volatile memory only.
>
> **4.** An authenticated ingestion worker writes the original .eml and hash into Cloud Storage, then commits parsed mailbox and delivery records transactionally to Cloud SQL.
>
> **5.** Only after the original object and database state are verified does Sandy return an ingestion receipt and release the edge queue copy.
>
> **6.** Mail appears in the inbox immediately after mailbox commit; AI and advanced intelligence are queued separately and may complete later.
>
> **7.** A reconciliation process finds orphan objects, missing SQL records, stuck queue entries and duplicate delivery attempts; it replays safely and alerts on exceptions.

Cloud Storage and Cloud SQL do not participate in one atomic transaction. Idempotency keys, stateful ingestion and reconciliation are mandatory. A sender-provided Message-ID is not a sufficiently reliable deduplication key by itself.

## 4.2 Outbound sending

> **1.** Client submits draft with authenticated identity, sender rights, recipients and desired sending schedule.
>
> **2.** Sandy persists original content, send intent and idempotency key in Cloud SQL before queueing delivery.
>
> **3.** Outbound policy checks authentication, domain signing, malware, recipient rules, rate limits, account reputation and optional user approval.
>
> **4.** Dispatch workers route to one of at least two independent SMTP relay providers and record attempt IDs, responses, bounces and deferrals.
>
> **5.** On uncertain remote acceptance, preserve an ambiguous state and do not blindly resend; remote SMTP cannot offer a universal exactly-once guarantee.
>
> **6.** Sent view distinguishes queued, submitted, recipient-MTA accepted, deferred, rejected/bounced and unknown; no false “delivered/read” claims.

# 5. Data model, indexing and search

| **Schema / entities**                             | **Purpose**                                                                         |
|---------------------------------------------------|-------------------------------------------------------------------------------------|
| core.tenants / identities / mail_accounts         | Isolation, domains, hosted vs connected providers, region and shard routing         |
| core.messages / envelopes / recipients            | Canonical internal IDs, timestamps, headers and sender/recipient identities         |
| core.bodies / attachments / mime_objects          | Text/HTML, stripped/sanitised display copies and GCS object references              |
| core.mailboxes / memberships / flags / threads    | Inbox state, folders, read/unread, thread association, delegation                   |
| core.outbound_jobs / attempts / inbound_receipts  | Auditable delivery states, retries and durable acceptance ledger                    |
| search.documents / embeddings / indexes           | Tenant-scoped retrieval, embeddings, OCR text and provenance                        |
| intelligence.entities / facts / commitments       | Evidence-backed people, businesses, actions, confidence and validity                |
| intelligence.expenses / contracts / opportunities | Recurring charges, bill extraction, comparison evidence and savings recommendations |
| control.permissions / audit / policy_versions     | Role scope, decisions, model policy, execution and review history                   |

## Scale rules

- Never perform cross-tenant searches to answer a user query. Authorise before retrieval and before AI synthesis; enforce row-level isolation and service account least privilege.

- Index routine inbox views on (tenant, account/mailbox, received_at, id). Keyset pagination, not large-offset scans.

- Partition only where tested query plans justify it. Shard by tenant or group of tenants; a routing catalogue tracks each tenant shard and its residency requirements.

- Use replicas for eligible read workloads, but route read-after-write traffic to the primary when needed and measure replica lag.

- Move search indexes to dedicated search infrastructure only after measurable Cloud SQL latency, concurrency or indexing bottlenecks are demonstrated.

- Store embeddings only for useful chunks/documents; re-embed selectively, and keep model and embedding version metadata.

# 6. Outlook, mobile and calendar compatibility

| **Surface**               | **Implementation / limitation**                                                                                                                               |
|---------------------------|---------------------------------------------------------------------------------------------------------------------------------------------------------------|
| Sandy web / native mobile | Native authenticated API, modern UI, push notifications, offline cache and AI cockpit; full-featured default client.                                          |
| Outlook Windows / Mac     | IMAP over TLS for email and SMTP submission for sending. Test classic/new Outlook separately; Exchange-specific features are not guaranteed.                  |
| Outlook iOS / Android     | IMAP/SMTP support where offered. Some Outlook versions sync third-party mailbox content into Microsoft Cloud; disclose this to customers.                     |
| Apple Mail / Thunderbird  | Standards-based IMAP/SMTP and protocol test suites; common autodiscovery documents and client guides.                                                         |
| Calendar / contacts       | ICS interoperability P0; hosted CalDAV/CardDAV P1 for supporting clients; Outlook full Exchange-like calendars/delegation need separate integration strategy. |
| Connected Outlook / Gmail | Microsoft Graph and Gmail APIs with delta/change tracking; provider remains mailbox authority and delete/sync policy must be explicit.                        |
| Migration                 | IMAP/importers, Microsoft 365 and Google migrations, staged dual-delivery option, checksum/count reconciliation, per-user progress and rollback plan.         |

Outlook IMAP support is documented \[3\]. IMAP alone does not provide Exchange-style shared calendars, contacts, meeting delegation or MAPI features; we must not advertise those as working in Outlook without actual client-level verification. Microsoft also documents that certain connected IMAP account data may be copied to Microsoft Cloud \[4\].

## 6.1 Customer data portability, complete export and provider exit

Design rule: customer email belongs to the customer. A customer or properly authorised organisation administrator must be able to export a complete, portable copy while their account is active and before closure, without contacting support, purchasing a special plan or paying an exit fee. Export must never silently modify or delete the source mailbox.

### P0 export formats and scope

- Original EML: one byte-preserved RFC 5322/MIME message per object, packed as ZIP or TAR for download; includes original headers and MIME attachments. For locally composed drafts, export an interoperable MIME representation and identify drafts in the manifest.

- MBOX: one portable file per selected folder/mailbox (or segmented files for large accounts), with message headers and attachments. Include a separate metadata manifest because not every MBOX importer supports the same labels, flags or folder conventions \[14\].

- Scope control: export all mail by default, with optional account, folder, date range, label and shared-mailbox selection. Explicitly include Sent, Drafts, Archive, Spam and Trash subject to current retention, access and legal-hold policies.

- Companion portable metadata: JSON and CSV for folder hierarchy, mailbox memberships, read/unread, flags, labels, message-to-thread links, original Message-ID, sender/recipient/date fields, aliases, forwarding rules and signatures, wherever supported. Include contact VCF and calendar ICS exports when Sandy owns those datasets.

### Direct migration and Outlook interoperability

- P0 direct transfer: a permissioned migration wizard copies mail over IMAP to Microsoft 365, Gmail or another IMAP provider. The wizard maps destination folders, tracks progress, respects provider rate limits, de-duplicates transfers and performs source/destination reconciliation before declaring completion.

- P1 Outlook PST: provide a verified PST export route where licensing, format reliability and version compatibility can be demonstrated. Until then, do not imply MBOX opens natively in Outlook: guide customers through direct IMAP transfer or another validated migration method. Outlook PST import is documented by Microsoft \[15\].

- Optional staged cutover: initial bulk copy, subsequent incremental sync, final discrepancy review, and a customer-controlled DNS/MX switch for domains they own. Preserve old account access through a clearly disclosed transition period.

### Export generation, safety and integrity

- Exports run as queued jobs on isolated workers, not synchronous API requests. Stream from Cloud Storage and Cloud SQL using resumable checkpoints and partitioned archives; generate a manifest listing message count, attachment count, included folders, date range, size, SHA-256 hashes, exclusions, warnings and snapshot/cutoff time.

- Re-authenticate for full-account export and require appropriate MFA; support passphrase-protected export archives or encrypted destinations. Issue short-lived, private download links, audit every request and access, and automatically expire temporary export copies.

- Display job progress, success/failure status, estimated remaining data, retriable errors and final verification. Integrity must be tested against a representative restored/imported mailbox; never report success for a partial export or silently skip oversized, malformed or encrypted items.

- For cancellations and account closure, give an accessible export period and clear deletion schedule. Apply retention and legal-hold constraints transparently; prove normal customer data is deleted after the applicable policy, while preserving only legally necessary records.

- Release gate: automated export/import/restore tests must pass for 1, 100,000 and 1,000,000+ message accounts, mixed encodings, large attachments, duplicates, folders, drafts, labels, corrupted source objects, interrupted transfers and multi-tenant access controls; byte-exact source EML hashes and reconciled message counts must be checked.

## 6.2 Universal bulk import, offline archives and zero-unexplained-loss migration

Design rule: A customer can bring all accessible historical mail into Sandy, even from a legacy provider, local computer, disconnected mailbox or exported archive. Migration is a first-class import service, distinct from SMTP receipt and daily account sync. Never overwrite, modify or delete the source mailbox or uploaded master archive. Completion requires proof of what was discovered, imported, preserved and excluded.

### P0 import-source matrix

| **Source / input**           | **Access method**                  | **Required handling**                                                            |
|------------------------------|------------------------------------|----------------------------------------------------------------------------------|
| Gmail / Workspace            | OAuth, Gmail API                   | All accessible labels, message originals where retrievable, incremental catch-up |
| Microsoft 365 / Outlook.com  | OAuth, Microsoft Graph             | Full and per-folder delta sync; throttling-safe retries \[16-17\]                |
| Any provider with IMAP       | TLS IMAP, OAuth or credentials     | Folder discovery, UIDs and UIDVALIDITY, flags and dates \[18\]                   |
| Outlook .pst                 | Local file upload or desktop agent | Validated PST parser; preserve hierarchy, items and source archive \[19\]        |
| MBOX / Thunderbird / Takeout | Archive upload or desktop agent    | Streaming MBOX parser, separator and encoding validation                         |
| EML / ZIP / TAR              | Files, folders, archive            | Preserve original byte stream and source directory structure                     |
| Maildir                      | Read-only folder/ZIP/TAR           | Reconstruct folder/flags where represented; preserve raw messages                |

- P1: Apple Mail EMLX and exported mailboxes; Outlook MSG; POP3 server retrieval plus a local archive to recover locally downloaded/removed messages; OST or damaged PST only where a validated recovery path exists. P2: enterprise vault/backup imports and bespoke legacy provider connectors. An OST cache is not automatically a complete authoritative export; show the recovery limitations prominently.

### Customer migration wizard

- Step 1 — Select source: Connect a provider, connect a standards-based IMAP server, upload an archive, or run a signed Sandy Migration Desktop Agent for locally stored mail. The agent reads folders in place and uploads encrypted chunks; it never requires unrestricted access to the customer computer.

- Step 2 — Discover and preview: Inventory accounts, folders, labels, item counts, sizes, date ranges, known duplicates, inaccessible folders, unsupported items and estimated transfer volume. Show an explicit pre-import snapshot and configurable mappings.

- Step 3 — Stage safely: Use Cloud Storage resumable uploads for large archives \[20\]. Run malware and archive-bomb checks in isolation, impose safe extraction limits and retain the uploaded original. Never render untrusted HTML or execute imported content in the import workers.

- Step 4 — Transfer in parallel: Partition work by mailbox, folder and bounded ranges. Read message streams rather than loading archives into memory; apply tenant and provider-specific concurrency budgets, backpressure, rate limiting and exponential retry with Retry-After support \[17\].

- Step 5 — Verify each message: Persist a source item ID, origin, path, size and raw SHA-256 where available; write original content/converted EML to Cloud Storage, commit SQL metadata and attach durable ingestion receipts. Resume from persisted checkpoints without copying items a second time.

- Step 6 — Reconcile and catch up: Compare source inventories with destination records by folder, flags, bytes, attachments and hashes when available. For live mailboxes, use incremental API deltas or IMAP checkpoints, repeating until the agreed cutover window is drained \[16\].

- Step 7 — Cut over and report: Only after verified reconciliation should Sandy propose MX/DNS change and final account routing. Present a signed/immutable completion report with any unresolved exceptions. The source remains accessible through a customer-controlled grace period.

### What must be preserved

- Original MIME and attachment bytes where the source exposes them; for PST/MSG/EMLX conversions, keep the untouched source package plus a reproducible conversion record and identify differences. Preserve sender, recipients, Message-ID, subject, sent/received and internal dates, drafts, folder hierarchy, Sent/Spam/Trash, flags, keywords and labels to the degree represented by the source. Store any unmapped properties in an exportable supplemental manifest.

- Duplicate handling: SMTP Message-ID is not a unique database key. Distinguish an interrupted-job replay of the same source object from two genuine copies stored in different folders or accounts. Deduplicate only repeated ingestion of the same source identity, while preserving all legitimate mailbox memberships and source history.

- Do not mistake server-reported counts for proof of completeness. Inventory may change during a live migration; records can be corrupted or inaccessible. The true requirement is zero silent omissions and a complete, independently checkable manifest of imported, retried, failed, skipped, out-of-scope and inaccessible items.

### Backend components and SQL records

- Run the Universal Migration Service as a separate scalable worker fleet alongside the Sandy Mail API, not on the SMTP edge or interactive inbox path. Stage encrypted source packages in customer-region Cloud Storage and apply the same residency, access, malware and retention policies as hosted mail.

- Persist mail_import_jobs (tenant, source type, permissions, mode, cutoff, state), mail_import_sources (account and folder mapping), mail_import_items (source key, folder, size, hash, destination receipt), mail_import_checkpoints (cursor/UID/date/range), mail_import_exceptions (typed, retryable, evidence), and mail_import_reconciliation (expected vs received vs verified, operator signoff). Implement a job-level state machine: DISCOVERING → READY → STAGING → IMPORTING → VERIFYING → CATCHING_UP → COMPLETE; alternate states PAUSED, NEEDS_ACTION, FAILED and COMPLETED_WITH_EXCEPTIONS.

- API surface: POST /mail/import-jobs; GET /mail/import-jobs/{id}; POST /mail/import-jobs/{id}/resume; POST /mail/import-jobs/{id}/cancel; GET /mail/import-jobs/{id}/manifest; GET /mail/import-jobs/{id}/exceptions; POST /mail/import-jobs/{id}/cutover. Provider secrets stay in short-lived, encrypted credential storage; never appear in logs or exported reports.

- Migration can be a one-off ownership transfer or an ongoing connected-account synchronisation. In the connected mode the external provider remains authoritative; in hosted mode, Sandy becomes authoritative only after explicit cutover. Build separate status and deletion semantics for the two modes.

### Go/no-go integrity gates — P0

- Test with fresh sources and interrupted resumptions for 1, 100,000 and 1,000,000+ messages; nested folders, duplicate Message-IDs, identical messages in distinct folders, mixed encodings, internationalised headers, encrypted/oversized attachments, partial PST damage, zip bombs, expired OAuth, IMAP UIDVALIDITY changes, provider 429s, region failover and SQL/object-store outages.

- For each test, account for 100% of inventoried source items as verified imports or explicit, user-visible exceptions; verify exact raw-byte SHA-256 wherever the source supplies raw messages, and independently verify converter outputs where byte equality is impossible. Test random message opens, full archive export, attachment downloads, labels, folder membership and retention of dates. Never show COMPLETE if items remain unreconciled; expose COMPLETED_WITH_EXCEPTIONS or NEEDS_ACTION instead.

- Performance benchmarks must be measured rather than invented: report messages/hour, bytes/hour, p95 per-message ingest latency, provider throttling, queue age, rejected items and estimated cost per GB. Migration workloads must not compromise live SMTP delivery or interactive inbox SLOs.

# 7. Spam, malware, fraud and outbound protection

## 7.1 Baseline security pipeline

- Pre-accept: connection rate limiting, abuse IP controls, recipient verification, SMTP TLS and anti-enumeration; SPF, DKIM, DMARC/ARC and DNS reputation.

- Content: Rspamd checks with reputation feeds; ClamAV signature scanning; safe MIME parsing, attachment type/content validation, URL reputation and redirect inspection.

- Advanced: isolated detonation for high-risk files, click-time URL checks in Sandy-controlled clients and attachment-access gating until verdict.

- Contextual: Sandy detects supplier impersonation, bank-account changes, anomalous invoices and unusual requests based on historical verified records.

- Outcomes: deliver / promotions / spam / quarantine / temporary defer / SMTP reject. Avoid irreversible deletion of uncertain accepted mail.

- User controls: Security Centre, releases, reporting, allow/block lists and granular tenant policies, all auditable.

## 7.2 Outbound reputation

- Use separate sending pools for transactional mail, normal person-to-person mail and opted-in bulk mail; prevent marketing traffic contaminating user reputation.

- Enforce signed domains, DKIM rotation, SPF/DMARC monitoring, reverse DNS, bounce feedback, complaint handling, sending limits and abuse detection.

- Protect against account takeover and exfiltration; suspend suspicious outgoing jobs and provide human review.

- Keep at least two relay partners. Direct port-25 SMTP egress cannot be assumed on Google Cloud \[5\].

## 7.3 AI-specific protection

Treat email content, HTML, PDFs and links as untrusted input. A message that tells Sandy to ignore instructions, transfer money or change permissions is data, not authorisation. All tool actions pass a server-side policy and identity/approval gate, separate from language-model reasoning.

# 8. Privacy, identity and enterprise governance

- Customer consent for indexing and AI; default no use of private mail for public model training; clear disclosure of AI processors, retention and subprocessor locations.

- Strong data isolation, encryption in transit/at rest, IAM least privilege, key rotation and optional customer-managed keys as an enterprise capability.

- Sensitive-content zones or user exclusions; deterministic redaction of selected fields before model access when feasible; reduce AI processing on protected folders.

- Separate controls for corporate administrator access and private user content; break-glass access requires narrow purpose, short duration, dual approval and audit.

- Tenant-selectable data regions for compliant plans; region boundaries extend to raw objects, backups, search indexes, support tooling and model processing.

- Policy-based retention, right-to-delete workflows, lawful hold overrides, export to .eml/MBOX and machine-readable structured extracts; audit deletions.

- Business-grade SSO, SCIM, conditional access and DLP at P1/P2; eDiscovery, legal hold and compliance certification only after independent validation.

True zero-knowledge end-to-end encryption is incompatible with unrestricted server-side AI indexing unless users explicitly permit client-side or trusted-enclave decryption. Present privacy options accurately rather than making contradictory guarantees.

# 9. Resilience, scaling and measurable quality

## 9.1 Failure domains

| **Failure**                            | **Expected behavior**                                                                                                                                 |
|----------------------------------------|-------------------------------------------------------------------------------------------------------------------------------------------------------|
| Single edge instance/zone              | Regional peers continue; autoscaler replaces capacity; queues remain durable.                                                                         |
| Entire SMTP region                     | Other MX regions accept mail. Lost region’s accepted messages survive only if second-region durability was confirmed prior to SMTP 250.               |
| Cloud SQL zonal failure                | Cloud SQL regional HA failover; temporary mailbox/API interruption is possible.                                                                       |
| Cloud SQL regional failure             | Inbound edge keeps accepting to durable queues; promote tested secondary DB / restore and replay ledgers. Cross-region SQL replicas are asynchronous. |
| AI provider / search worker failure    | Mail remains available; intelligent analysis is delayed and visible as pending or degraded.                                                           |
| Outbound relay failure                 | Route unsent jobs to healthy relay with explicit delivery-state and ambiguity checks.                                                                 |
| Archive corruption / mistaken deletion | Checksums, backups, retention policies and tested restore/replay procedures.                                                                          |

## 9.2 Target SLOs and performance budgets

| **Metric**                        | **Initial production target**              | **How verified**                                                      |
|-----------------------------------|--------------------------------------------|-----------------------------------------------------------------------|
| Inbound SMTP edge availability    | 99.99% target                              | Global synthetic SMTP probes across 3 regions.                        |
| Core mailbox API availability     | 99.95% target                              | SLO burn-rate and multi-region synthetic transactions.                |
| Acknowledged inbound message loss | 0 in controlled fault tests                | SMTP receipt-to-archive-to-SQL ledger reconciliation.                 |
| Normal inbox list p95             | \<250 ms server-side                       | Measured excluding client/network rendering at benchmark load.        |
| Indexed keyword search p95        | \<500 ms for tenant-scoped typical queries | Corpus benchmarks at 1M / 10M / 100M messages.                        |
| Semantic retrieval p95            | \<2 s under specified test corpus          | Separate retrieval from AI reasoning and measure both.                |
| AI grounded answer                | \<10 s p95 for standard queries target     | Representative corpus and model load; complex queries allowed longer. |
| Accepted-mail-to-inbox            | \<10 s p95 when healthy                    | End-to-end receipt timestamp and mailbox visibility.                  |
| Regional DB recovery              | ≤60 minutes design goal                    | Quarterly full regional failover drills; reconcile all mail ledgers.  |

These are targets, not current capabilities or achieved SLAs. Test at realistic bursts, tenant concurrency, large attachments and degraded-region operation. Cloud SQL HA is synchronous between zones, not regions \[6\].

# 10. Commercial operations and administration

- Self-service sign-up: choose Sandy address or verify customer domain; publish guided MX, SPF, DKIM, DMARC, MTA-STS/TLS-RPT and autodiscovery settings as appropriate.

- One API provisions tenant, region, mailbox shard, quotas, identity, DKIM keys, mailbox aliases, routing policies and plan entitlements; all changes idempotent and auditable.

- Controller dashboard: domain health, queue depth, incoming/outgoing latency, per-tenant limits, spam/false positive feedback, bounce rates, relay reputation and incident history.

- Automated tenant suspension/reinstatement controls with review to avoid wrongful lockout; independent appeals for false abuse flags.

- Billing by mailbox/storage/AI usage; transparent price and quotas; no undisclosed monetisation of private mail. Referral commissions on accepted savings offers disclosed and never decide rankings.

- Universal migration and export: provider and local-archive imports; source-to-destination message/object counts, IDs, hashes and attachments; progress checkpoints; incremental catch-up; reconciliation; and customer-accessible exception reports.

# 11. Implementation roadmap and release gates

| **Stage**                        | **Deliverable**                                                                                               | **Exit criteria**                                                                                              |
|----------------------------------|---------------------------------------------------------------------------------------------------------------|----------------------------------------------------------------------------------------------------------------|
| 0 — Architecture / threat model  | Schema, security/privacy design, choices of open-source protocols, unit economics and 3-region failure model. | Design review, threat model, DPA/licence review, cost envelope approved.                                       |
| 1 — SQL-native mailbox prototype | Ingestion, original archive, mailbox API, drafts/sent, basic UI, model-independent search and backfills.      | 100% accepted-test messages accounted for; search and backups restorable.                                      |
| 2 — Edge production foundation   | Regional Postfix, Rspamd, AV, replicated acceptance queue, outbound relays, DNS onboarding.                   | Fault injection across instance/zone/region, no acknowledged message lost under defined tests.                 |
| 3 — Client compatibility / beta  | Reliable IMAP/SMTP, Outlook/Apple Mail/Thunderbird tests, forwarding, aliases, migration and security centre. | Real clients pass read, reply, move, delete, flags, offline sync, attachments and send/receive tests.          |
| 4 — Intelligence launch          | AI indexing, hybrid search, grounded answers, spending insights, commitments, approvals.                      | Extraction precision and answer citation targets proven on audited datasets; zero unapproved external actions. |
| 5 — Business / enterprise        | Shared mailboxes, delegation, enterprise controls, stronger calendars, retention/DLP/eDiscovery.              | Independent security/privacy audit and enterprise compliance validation.                                       |

## 11.1 Launch go/no-go checklist

- No accepted email disappears across scanner, region, SQL, object-store and replay failure drills.

- End-to-end security covers SPF/DKIM/DMARC, malware, quarantine, false-positive release, account compromise and outbound abuse.

- Outlook and at least two independent standard mail clients pass the published compatibility matrix.

- Portability gate proven both directions: self-service EML/MBOX export and direct IMAP exit; P0 Gmail/Graph/IMAP/PST/MBOX/EML/Maildir bulk imports; resumable/local desktop upload; no silent loss or unaccounted exclusions; verified message, folder, attachment and SHA-256 receipts; million-message, corrupted-input and failover drills; explicit live-domain cutover and retention/deletion checks.

- API access uses explicit tenant authorization; every AI answer can display evidence and every autonomous action has an enforceable permission trail.

- Production cost per mailbox, message and GB is measured against pricing; incident on-call, backups, paging, disaster drills and provider SLAs are operational.

# 12. Key open design decisions before coding

> **1.** Durable acceptance policy: synchronous second-region receipt for all tenants or a separately disclosed premium zero-region-loss tier. Make the design target explicit.
>
> **2.** Cloud SQL shard placement and EU/US/APAC data residency; partitioning policy and criteria for introducing independent search infrastructure.
>
> **3.** IMAP implementation strategy: proven server/library plus custom storage adapter versus in-house gateway; licence and upgrade compatibility.
>
> **4.** Calendar/contacts ambition: Sandy-native product parity versus true Exchange-like Outlook delegation (a distinct and more difficult capability).
>
> **5.** Outbound deliverability strategy: dual providers, dedicated IP roadmap, complaint management and Google Cloud port-25 permission status.
>
> **6.** Tenant packaging: storage/AI included, regional options, recoverability/compliance tiers, migration support and margins.
>
> **7.** AI governance: user consent by data category, model routing, prompt-injection controls, approval levels and human escalation policy.

8\. Customer export: final P0 portable archive schema and IMAP migration target matrix; P1 PST feasibility/licensing; large-mailbox chunk size, snapshot semantics, cancellation grace period and domain cutover playbook.

9\. Import implementation: choose production-validated PST parsing/conversion (including licensing and recovery limitations); define source adapter coverage, local desktop agent security, large-archive transfer quotas, archive retention, progress/status schema and live-mail cutover handling.

# 13. Sources and technical references

**[1] Microsoft Support — Copilot in Outlook (last updated Aug 2026)**  
https://support.microsoft.com/en-gb/outlook/frequently-asked-questions-about-copilot-in-outlook

**[2] Microsoft Learn — Microsoft 365 Copilot release notes**  
https://learn.microsoft.com/en-us/microsoft-365/copilot/release-notes

**[3] Microsoft Learn — Supported account types in new Outlook**  
https://learn.microsoft.com/en-us/microsoft-365-apps/outlook/get-started/supported-account-types

**[4] Microsoft Support — Sync non-Microsoft mail accounts to Microsoft Cloud**  
https://support.microsoft.com/en-gb/outlook/getstarted/sync-your-account-in-outlook-to-the-microsoft-cloud

**[5] Google Cloud — Sending email from Compute Engine**  
https://docs.cloud.google.com/compute/docs/tutorials/sending-mail

**[6] Google Cloud — Cloud SQL PostgreSQL high availability**  
https://docs.cloud.google.com/sql/docs/postgres/high-availability

**[7] Google Cloud — Cloud SQL quotas and limits**  
https://docs.cloud.google.com/sql/docs/quotas

**[8] Google Cloud — PostgreSQL pg_textsearch**  
https://docs.cloud.google.com/sql/docs/postgres/pg-textsearch

**[9] IETF RFC 8621 — JMAP for Mail**  
https://www.rfc-editor.org/info/rfc8621/

**[10] IETF RFC 9051 — IMAP4rev2**  
https://www.rfc-editor.org/info/rfc9051/

**[11] Rspamd documentation — Mail filtering architecture**  
https://docs.rspamd.com/

**[12] Microsoft Learn — Exchange Online limits**  
https://learn.microsoft.com/en-us/office365/servicedescriptions/exchange-online-service-description/exchange-online-limits

**[13] Microsoft Learn — Purview retention**  
https://learn.microsoft.com/en-us/purview/retention

\[14\] IETF RFC 4155 — The application/mbox Media Type  
https://www.rfc-editor.org/info/rfc4155/

\[15\] Microsoft Support — Import email, contacts and calendar from a PST file  
https://support.microsoft.com/en-us/outlook/import-email-contacts-and-calendar-from-an-outlook-pst-file

\[16\] Microsoft Graph — Delta query for Outlook messages  
https://learn.microsoft.com/en-us/graph/delta-query-messages

\[17\] Microsoft Graph — Throttling guidance and Retry-After  
https://learn.microsoft.com/en-us/graph/throttling

\[18\] IETF RFC 9051 — IMAP4rev2, UID/flags/internaldate semantics  
https://www.rfc-editor.org/info/rfc9051/

\[19\] libpff — PST/OST access project (alpha maturity; evaluate before use)  
https://github.com/libyal/libpff

\[20\] Google Cloud Storage — Resumable uploads  
https://docs.cloud.google.com/storage/docs/resumable-uploads

\[21\] Mozilla Support — Thunderbird MBOX and experimental Maildir storage  
https://support.mozilla.org/en-US/kb/maildir-thunderbird

| STATUS: Final proposed feature/architecture blueprint for engineering planning. No Google Cloud resources, databases, mail servers, domains or customer mailboxes have been provisioned by producing this document. All SLOs and competitive differentiators require validation before public claims. |
|-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
