# SANDY-ENG-0012 — Sandy Cloud Drive, device backup and intelligent files

Version: 1.0 · Created 24 October 2026  
Status: DRAFT — architecture and engineering scope only, no feature release  
Priority: P2 product expansion; P0 safety and isolation gates for any pilot  
Owner: Sandy Cloud engineering, coordinated with 0005 API, 0009 portal, 0006 memory and 0010 commercial  
Master Scope: §§1–3, 7–11, 16–19 (mission, authority, privacy, evidence, cross-service continuity; confirm references at implementation)  
API Scope: existing files/customer service contracts in the 161-family catalogue require mapping; no new operation marked implemented  
Detailed technical design: [Sandy Cloud architecture](../../sandy-cloud/architecture.md)  
Contracts: [shared architecture](../architecture-contracts.md), [task template](../templates/engineering-task-scope.md)  
Related source: [existing Files UI](../../../sandy/files/index.html), [customer-service contracts](../../../supabase/functions/sandy-operation-api/customer_service_contracts.ts), [task attachments](../../../supabase/functions/sandy-task-files/index.ts)

## 1. Objective / customer-visible outcome

Launch one integrated **Sandy Cloud** product: (1) Sandy Drive files/folders/share/sync, (2) separate automatic and recoverable computer backups, (3) permission-aware AI document search, classification and authorised follow-up, connected to Sandy Mail, Tasks, Memory, Companies and Calendar. Customers should install the desktop agent, select what to sync/protect, see verified protection status and recover their own files without relying on support. Never label an upload as backed up until protected historical recovery is independently verified.

Competition baseline: core file sync, versions, offline files, secure links, multi-device availability and document previews should meet expected Dropbox/Drive/iCloud-style workflows; **Sandy's intended advantage** is independent, verified backup plus actionable, source-linked AI. These are product targets, not competitive parity proven by tests.

## 2. Current behavior and evidence baseline (24 October 2026)

Read-only checks in the live Supabase project zmqlyygzqoidkcwdysok:
- ACTIVE sandy-files v25 exposes list, history, set_description, set_state and open; Files web UI exists in repository at sandy/files/index.html.
- ACTIVE sandy-task-files v16 supports task attachments but does not constitute a desktop sync/backup service.
- public.sandy_universal_files and related references/links/lifecycle tables exist and contain live user records. Do not destroy, overwrite or create a second universal-file truth store.
- public.sandy_storage_backends: supabase_existing = verified/default, GCS backend gcs_primary = planned/non-default, no bucket/region/verified_at.
- sandy-operation-api observed ACTIVE v60, and repository has fixed file-related customer-service contracts. Runtime contract equality and full customer E2E behavior remain to be tested.
- No proven Cloud SQL database, GCS bucket, Mac/Windows agent, backup snapshot protocol, user-visible recovery or authenticated cross-tenant negative test for Sandy Cloud was observed in this limited inspection. Absence from inspection does not prove universal absence.

Evidence for new capabilities: **none**. All acceptance IDs below start PENDING. This is not permission to flip any release/operation/verification flags.

## 3. Scope / non-goals / existing ownership

**In scope:** tenant/company-scoped folder namespace; resumable object upload; immutable versions and trash; secure sharing; signed downloads; web Files UX; desktop selective sync/offline conflict resolution; automatic protected-folder backup; restore; GCS migration pilot with verified checksums; consented document extraction/semantic retrieval; quota/metering; operational monitoring; incident, privacy and support paths.

**Later phases, not launch blockers for MVP:** complete bootable bare-metal device images, OS/system partitions, server/VM backups, full Apple Photos/iCloud Photos parity, collaborative Office/Docs editing, consumer eSIM, generalized web hosting, arbitrary third-party cloud mirroring and enterprise compliance certifications.

**Not permitted in this task:** delete or bulk-migrate existing user files by default; make GCS the default without recovery testing; introduce a second Sandy identity authority, orchestrator, mission ledger, memory world model, provider gate or billing engine; treat receipt of bytes as a verified backup; promise end-to-end encryption plus server-side AI plaintext analysis simultaneously.

Ownership:
- **0012:** file/tree/version/sync/backup/restore domain truth and technology.
- **0005:** shared Sandy API contract, identity delegation, provider adapters and controlled release.
- **0004:** reusable durable job/receipt/truth machinery.
- **0006:** memory knowledge and ACL-filtered context projections.
- **0009:** customer file, backup and restore UI.
- **0010:** entitlements, usage settlement, support and launch readiness.
- **0003:** agent orchestration of user-approved document actions.

## 4. Requirements and acceptance traceability

| ID | Requirement / phase | Acceptance gate |
| --- | --- | --- |
| SC-01 | Authenticated multi-tenant namespace, company/personal separation, folders, rename/move/trash | AC-01, AC-02 |
| SC-02 | Resumable upload/download, size/hash verification and immutable versions | AC-03, AC-04 |
| SC-03 | Revision/cursor-based multi-device sync with explicit conflicts and offline recovery | AC-05 |
| SC-04 | Secure scoped/expiring sharing and revocation | AC-02, AC-06 |
| SC-05 | Independent protected-folder backup, snapshots and historical retention | AC-07 |
| SC-06 | Self-service file/folder restore with independent checksum readback | AC-08 |
| SC-07 | Permission-filtered AI extraction, search and source-linked classification | AC-09 |
| SC-08 | Safe integration with existing universal files, Mail, Tasks, Memory and companies | AC-10 |
| SC-09 | Cost controls, metering, quotas and service health | AC-11 |
| SC-10 | GCS staged rollout and rollback without data loss or double writes | AC-12 |
| SC-11 | Desktop installers, signing, device lifecycle and OS integration | AC-05, AC-13 |
| SC-12 | Recoverable provider/worker operations with truthful receipts and audit | AC-04, AC-08, AC-12 |
| SC-13 | Mobile native photo/video backup | AC-14 (later) |
| SC-14 | Whole-computer image and bare-metal restore | AC-15 (later) |

## 5. Architecture and contracts

Implement [architecture](../../sandy-cloud/architecture.md) with one authoritative writer per aggregate. **GCS** stores immutable file data and backup manifests; **Cloud SQL PostgreSQL is a candidate** new-Drive transactional metadata store, gated by ADR/reconciliation against existing Supabase. Live Sandy's existing universal-file metadata remains authoritative until an explicitly planned cutover. No two stores independently own file-version truth.

API operation registration is proposed only: list_nodes, mutate_node, start_upload, complete_upload, get_download, changes_since, register_device, manage_share, create_backup_snapshot, start_restore, search_documents. Canonical published interface uses versioned Sandy API and fixed allowlisted handler contracts, with Sandy MCP as adapter only. Exact names and schemas must reconcile with the operation registry and active UI before code is merged.

All changes require server-derived actor/tenant/company grants, input schema, version precondition, idempotency key, stable trace ID, durable outcome record and clear errors. Direct browser access to storage is limited to exact pre-authorized temporary signed transfers; no user-supplied storage path or GCP role. New data-plane/metadata writes use outbox and reconciliation; GCS write success and SQL metadata commit are distinct states.

## 6. Work packages and dependencies

| Work package | Delivery / owner | Depends on | Relative size | Exit evidence |
| --- | --- | --- | --- | --- |
| WP-0 As-built mapping + ADRs | Full Supabase file lineage, permissions, buckets, cloud costs, Cloud SQL/GCS choice, threat model / 0012 + 0005 | Read-only inventory | M | Signed/versioned decision records, baseline |
| WP-1 Domain metadata/API | Workspace tree, ACL, version immutability, upload intent/commit, quota, outbox / 0012 + 0005 | WP-0, 0004/0005 base | L | Contract tests + isolated real-object pilot |
| WP-2 Google object data plane | Bucket topology, Workload Identity, malware quarantine, signed transfers, lifecycle and integrity reconciliation / 0012 | WP-0/1 + actual provider approval | L | GCS upload/readback/denial evidence |
| WP-3 Web Drive | Extend Sandy Files UI, manage folders/share/version/trash, clear states / 0009 + 0012 | WP-1/2 | M | Signed-in two-tenant UX acceptance |
| WP-4 Desktop synchronization | Signed Mac/Windows apps, local encrypted journal, watcher+reconciliation, cursor/conflicts/offline / 0012 | WP-1/2 | XL | Deterministic two-device E2E suite |
| WP-5 Protected-folder backup | Incremental snapshots, separate immutable retention, device health / 0012 | WP-2/4 | L | Clean-machine restore evidence |
| WP-6 Restore and resilience | Version/snapshot browser, file/folder restore, failure drills, safe rollback / 0012 | WP-5 | L | Source/restore hash and recovery receipt |
| WP-7 AI files intelligence | Opt-in extraction/classification/search, citation and ACL filtering / 0012 + 0006 + 0003 | WP-1/2, 0006 permissions | L | Exact/semantic/negative permission tests |
| WP-8 Pricing and operations | Usage ledger, entitlements, reconciliation, dashboards, abuse and support / 0010 + 0012 | WP-1/2, existing billing | M | Cost cohort + invoice/meter audit |
| WP-9 Expansion | iOS/Android/photo upload, device image/server backup, private vault / 0012 | Accepted MVP | XL | Separately versioned acceptance gates |

Relative sizes are planning classifications, not delivery-time commitments. WP-0/1/2 security foundations can progress while P0 Sandy runtime fixes retain program priority. Do not create paid resources without authorized budget and an approved engineering change/release envelope.

### MVP definition and sequencing

**MVP-1 (Drive):** WP-0 through WP-3, version history, basic search by name/metadata, secure sharing, safe upload/download and independently verified GCS canary. Do not call this a full Dropbox replacement until desktop sync works.

**MVP-2 (Sync + Backup):** WP-4 through WP-6, continuous protected-folder backup and user-initiated restore. This is the first version eligible for a **computer backup** claim, not yet bootable system recovery.

**MVP-3 (Intelligence):** WP-7 + WP-8, source-linked AI and spending/contract workflows behind user consent, with permission/provenance verification. Further platforms and enterprise capabilities are post-MVP.

## 7. Security, privacy, performance, accessibility

- Tenant/company isolation enforced at Sandy API and relational storage; caller-supplied tenant IDs validated against authority; test file IDs, shares, cursors, index results, download URLs and background workers under hostile cross-tenant cases.
- Key management and backup deletion powers separated; malware scanning and sandboxed parsers precede previews/index. Only scanned content can be shared if policy requires. Private vault keys stay customer-held and disable server plaintext intelligence by design.
- File extraction can include hostile prompts; treat it as untrusted data, never agent instructions. Search retrieves ACL-authorised excerpts and live-checked source version/permission epoch.
- Implement retention/immutability, delete/export, regional residency, incident response, encrypted device database, device revocation, accessible restore experience and deterministic error messages.
- Candidate quality targets: metadata p95 <=750 ms in a declared 1,000-node/list cohort, 100% digest-matching committed uploads in the acceptance cohort, no cross-tenant disclosure, 10 GB interrupted transfer resumes without duplicate version, restore from a clean target verifies content hash. These are **proposed**, not current measurements.
- Instrument SLI for upload intent→verified commit, sync lag, backup age, failed snapshots, restore duration, orphan bytes, permissions denials, index lag, egress dollars and unknown outcomes. Alert on missed backups, repeated checksum failures, prolonged pending transfers and data-plane/metadata drift.
- Ship keyboard accessible file picker, drag-and-drop alternative, descriptive errors, status-by-device and audited export workflows. Avoid false green 'Protected' labels when a device has not actually completed a recoverable snapshot.

## 8. Acceptance tests (mandatory, evidence-linked)

| ID | Reproducible scenario / expected result | Class |
| --- | --- | --- |
| AC-01 | Authenticated account sees only correct Personal/Company tree; new node creates one durable revision; unauthorized user denied | Integration + live tenant |
| AC-02 | 100 cross-tenant/share-token negative cases return no file bytes, metadata leakage, previews, semantic excerpts or capability escalation | Security |
| AC-03 | Corrupt/short/replayed upload is rejected; exact object checksum/generation and metadata version independently read back; retries do not duplicate | Provider + recovery |
| AC-04 | Kill connection before/after GCS upload and before/after metadata commit; reconcile known/unknown outcomes; no orphan visible file or false completion | Fault injection |
| AC-05 | Two Mac/Windows agents (as supported) simultaneously edit, rename, move, delete and reconnect after offline intervals; no silent data loss, conflicts accessible, cursor gaps detected | Device E2E |
| AC-06 | Authorized expiring link downloads exact version; expiry, revoke, role downgrade, wrong user and stale link fail; audit receipt present | Provider + authorization |
| AC-07 | Scheduled protected-folder snapshots preserve historical file after sync deletion/ransomware-style mass modification; immutable retention blocks premature deletion by ordinary actor | Backup E2E |
| AC-08 | File and folder restored to clean target match fixture SHA-256, tree structure and revision; incomplete restore reports FAILED/UNKNOWN, never success | Recovery drill |
| AC-09 | AI answer supplies source file and version; wrong-company user, deleted permission, private-vault ciphertext and malicious prompt-injection document never leak content or grant actions | AI security |
| AC-10 | Existing files/task/email references still resolve; migration shadows and matches checksums; no duplicate truth rows or broken deep links | Regression |
| AC-11 | Storage/transfer/retention ledger reconciles with provider bytes and entitlements; adversarial egress/quota tests enforce limits | Metering |
| AC-12 | Fail GCS quota/IAM/corrupt bucket or Cloud SQL outage in pilot; routing freezes safely and old Supabase files continue; no loss or unverified default switch | Disaster/rollout |
| AC-13 | Device enrollment uses short-lived verified identity; signed updates; revoked device cannot obtain new access; OS permissions handled without bypass | Desktop |
| AC-14 | Mobile permissioned photo/video backup, restoration, network/battery policy and location/privacy behavior verified | Later mobile |
| AC-15 | Whole-system image restores boot and applications on each explicitly supported OS/hardware matrix; driver and OS limits declared | Later imaging |

No unit-only or mocked test meets a 'live provider verified' criterion. Each evidence record captures environment, commit/source SHA, deployed revision, test identities (nonsecret IDs), trace/job/receipt, provider readback, permission snapshots, timestamps and hashes.

## 9. Deployment, migration and rollback

1. Create isolated branch/PR with architecture ADR, feature flags, schema migrations and test plan. Do not rewrite current universal-file or task attachment source during initial discovery.
2. CI: schema/API contract validation, RLS/authorization tests, static dependency checks, reproducible fixtures and failure-mode matrix. No human data in fixtures.
3. Isolated staging: provision authorized GCS/Cloud SQL (if chosen); use workload identity, secret manager, budget and data boundary. Test provider readbacks, checksum and restore before a customer can upload.
4. Pilot: canary one or more consenting test accounts, namespace/region-bounded. Default Sandy storage backend remains supabase_existing while GCS is verified and no migration has been approved.
5. Expand/read-compare/migrate/cut over by immutable source ID and owner-approved mapping; gated deployment with source/manifest SHA, protected release lock, real signed-in smoke and rollback plan.
6. Monitor 24h or a proportionate defined pilot interval with upload, restore, sync lag, deletion, ACL, egress and drift measurements. Go/no-go must name evidence.
7. Rollback: halt new sync writes, preserve both object stores and prior metadata, reconcile pending transfers, restore prior routing and compatible schema; do not delete recently uploaded customer versions or claim irreversible rollback. Record unknown outcomes and forward-repair when provider effects cannot be undone.

Production releases, IAM grants, database/schema changes, connector scopes, customer migrations and resource spend require separate applicable authority. This document-only commit authorizes **none** of them.

## 10. Completion and evidence register

| Criterion | Result | Evidence | Verified at |
| --- | --- | --- | --- |
| Architecture specification committed | Pending until GitHub readback | Link commit/PR when merged | — |
| Engineering scope / manifest synchronized | Pending GitHub-main merge + Supabase catalogue readback | — | — |
| Existing as-built/source baseline reconciled | Partial read-only inspection only | Supabase function versions and table inventory in §2 | 2026-10-24 |
| Metadata/object store provider pilot | NOT IMPLEMENTED | — | — |
| Authenticated file upload/download + sharing | NOT VERIFIED for Sandy Cloud | — | — |
| Desktop sync canary | NOT IMPLEMENTED | — | — |
| Independent backup + restore | NOT IMPLEMENTED | — | — |
| AI permission/security suite | NOT IMPLEMENTED | — | — |
| Commercial/ops acceptance | NOT IMPLEMENTED | — | — |
| Production deployment | NOT DEPLOYED | — | — |

## 11. Decisions, risks and blockers

- **Data ownership:** resolve Cloud SQL vs existing Supabase metadata before schema creation. Google Cloud preference does not override single-authority/anti-dual-write constraint.
- **Cost:** approved cloud project, billing, region, storage class, retention and egress model must be specified. No unbounded restoration or free-usage assumptions.
- **Identity:** actual cross-service federation between Sandy customer identity and Google resources requires tested scoped service identity; no customer browser GCP administrator access.
- **Existing live function:** sandy-files deployed source and repository ownership differ; reconcile actual handler source before refactoring. Do not assume a new repository file is the live handler.
- **OS-level backup:** full-system recovery requires research into native volume snapshots, privileged agents, notarisation/signing and boot compatibility. Do not market as available at MVP-2.
- **Privacy and model processing:** choose data residency, extraction consent, deletion policy and Private Vault mode before turning on AI indexing.
- **Product positioning:** exact competitor feature matrix, pilot metrics and support model must be independently measured before claiming equal/better parity.

**Next bounded engineering action:** WP-0 read-only source/data-lineage and storage identity inventory, then ADR decisions and synthetic MVP contract fixtures. Keep existing Sandy runtime P0 work undisturbed. 
