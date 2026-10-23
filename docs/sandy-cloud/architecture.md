# Sandy Cloud — software architecture
Version: 0.1 (design baseline) · 24 October 2026  
Status: DRAFT / proposed; not an implemented or deployed Sandy Cloud service  
Owner: Sandy Cloud product engineering  
Canonical engineering scope: [SANDY-ENG-0012](../sandy-engineering/tasks/SANDY-ENG-0012-sandy-cloud-drive-backup.md)  
Governing contracts: [Master Scope](../sandy-engineering/master-scope-v1.md), [shared architecture](../sandy-engineering/architecture-contracts.md), [API/MCP ownership](../sandy-api-first-mcp-architecture.md)

## 1. Product and decisions

**Sandy Cloud** is one product with three capabilities: (a) Sandy Drive — file storage, desktop/mobile synchronisation and sharing; (b) Sandy Backup — independent, versioned file/device recovery; and (c) Sandy Intelligence — consented extraction, indexing, retrieval and contextual actions across a user's permitted files and existing Sandy services. It must reach feature parity for mainstream file workflows before claiming to exceed Dropbox, Google Drive or iCloud. Advanced bare-metal restore, server backup and native photo-library replacement are later releases, not MVP claims.

Non-negotiable separation: a synchronized folder is **not** a backup. Sync deletion/corruption propagates only through the live drive; immutable historical backup snapshots remain independently recoverable. AI enrichments are derived, revocable projections and never overwrite originals. Google Cloud Storage (GCS) holds file bytes; relational storage holds metadata, not binary payloads.

### Current implementation observed (24 October 2026; read-only inspection)

- Canonical repository: ausstyle/web-staging, branch main. Existing interface [sandy/files/index.html](../../sandy/files/index.html) provides a signed-in file library and list/gallery/history/lifecycle interactions. It is **not** evidence of a working desktop sync or whole-computer backup product.
- Deployed Supabase project zmqlyygzqoidkcwdysok has active edge function sandy-files **v25** (actual current deployed function independently read; actions observed: list, history, set_description, set_state, open) and sandy-task-files **v16**. sandy-files verifies a user session inside its handler; verify_jwt=false is a transport setting, not permission to bypass that application authorization.
- Existing canonical universal-file records include public.sandy_universal_files, sandy_universal_file_references, sandy_universal_file_links and sandy_file_lifecycle_events; existing task attachments and document context tables are separate. These contain live customer records and must not be replaced or backfilled destructively.
- public.sandy_storage_backends records supabase_existing as **verified/default** and gcs_primary as **planned/non-default**, with no configured GCS bucket, region or verification timestamp. Therefore GCS for Sandy Cloud is a **proposal**, not a production-ready destination.
- Existing fixed Sandy API contracts refer to handler sandy-files; review contract/live parity before registering any new storage operations. Only a provider-observed result and release evidence can certify functionality.
- **Unverified:** GCS bucket/IAM/billing, Cloud SQL provisioning/availability, transfer pipeline, desktop agents, device snapshots, public sharing and reliable restores. Do not infer these exist from this document.

## 2. Architecture boundaries

### Logical flow

1. **Clients:** Sandy portal and web app, macOS and Windows sync agents, iOS/Android apps (later), and limited REST clients.
2. **Identity / access:** existing Sandy session/account/tenant mapping remains the authority for actor identity, company and collaboration grants. The Sandy API boundary validates membership, policy version, device identity and scoped grants on every operation. No broad service key or client-selected tenant is trusted.
3. **Drive control plane:** Sandy Cloud domain module/service owns folder tree, file IDs, revisions, ACLs, sharing, quotas, device cursors, upload sessions, restore admission, metering and event outbox. It exposes versioned operations via **Sandy API**. External MCP callers go through thin Sandy MCP to the same API; no parallel privileged executor.
4. **Durable workers:** leased, retryable tasks perform thumbnailing, malware scanning, indexing, retention compaction, backup verification and import/export. Reuse Sandy's existing mission/worker/receipt primitives where fit; do not spawn a second global mission ledger or unrelated queue without evidence.
5. **Data plane:** short-lived, scope-limited direct signed transfers to private **GCS** buckets where safe. Staged uploads remain uncommitted until independently checked; clients never possess persistent GCS credentials.
6. **Metadata:** Google Cloud SQL for PostgreSQL is the **candidate** primary transactional store for *new* Drive namespace/version/snapshot metadata at scale; the currently live Supabase universal-file system remains authoritative for its existing records. Cutover requires a separately accepted ADR and migrations. No file record has two authoritative writers. Cross-system links are stable IDs and permission-filtered projections, not dual writes.
7. **Intelligence:** extraction/embedding pipelines create source-versioned, ACL-restricted text and semantic indexes. Existing Sandy memory/world-model owns persistent assertions; Cloud owns document/version facts. No unrestricted model access to raw buckets.

### Component allocation

| Concern | Proposed owner and implementation | Reuse / boundary |
| --- | --- | --- |
| Sign-in and tenant/company access | Existing Sandy identity mapping and Sandy API authorization | Preserve Supabase customer identity and portal sessions |
| Drive domain | Sandy Cloud service in modular TypeScript API | New logical domain; no alternate MCP authority |
| File bytes and immutable backup objects | Google Cloud Storage private buckets | One-way staged migration from existing Supabase objects when verified |
| New namespace/version metadata | Cloud SQL PostgreSQL candidate, behind storage abstraction | Existing public.sandy_universal_files remains canonical until separately migrated |
| Event persistence and jobs | Transactional metadata outbox and Sandy's existing leased-worker pattern | Consumer inbox/idempotency; no fire-and-forget acknowledgements |
| Search and AI | Indexed approved document versions, metadata + vector search as measured | 0006 context/memory permission contract; no duplicate World Model |
| UI | Existing Sandy portal Files route extended as Cloud | Scope 0009 owns presentation |
| Billing/entitlements | Existing Sandy commercial ownership | Scope 0010 owns plans, subscriptions and settlement |

Do not use Cloud SQL as binary object storage. Do not add Redis, Kubernetes, a new graph database or a separate provider gateway by default. Document evidence for infrastructure changes under an ADR.

## 3. File, version and namespace model

Proposed identifiers are immutable UUID/ULID-style opaque IDs; IDs are not filesystem paths. Separate names from content identities:

- **workspace**: tenant-owned Personal/Family/Company namespace with effective policy and quota.
- **node**: folder or file record, parent_node_id, display_name, normalized comparison key, creator, logical current_version_id, trash state, optimistic revision, ACL root. Stable node survives moves/renames.
- **file_version**: immutable version_id, node_id, object_manifest_id, source/device, size, content digest, MIME/scan status, server sequence, created/committed_at. Updates create a new version; no in-place overwrite of committed bytes.
- **object_manifest / chunks**: immutable GCS object generation and checksums, encryption context, size, optional chunk references. Reference-counting is isolated by tenant/cryptographic domain to prevent cross-customer dedupe inference.
- **device**: explicit registration, platform, public key, revoked_at, sync scope, last_acknowledged_sequence, health and software version.
- **change_log**: ordered per-workspace change sequence with node/version/ACL event and policy epoch. Cursor invalidation demands secure full rescan, not silent gaps.
- **upload_session**: idempotency key, actor, target, expected parent revision, checksum/length, staged objects, expires_at, state and receipt. Session transitions: INITIATED → UPLOADING → VERIFYING → COMMITTED, or FAILED/EXPIRED.
- **share / grant**: recipient principal or expiring capability link; least-privilege read/write, optional password, expiry, revocation, audit trail. External shares get audience validation and rate limits.
- **backup_set / snapshot / snapshot_entry**: device/volume/source, consistency method, immutable manifest, recovery point, verified_at, retention class, completed status. Backups have a *separate lifecycle* from Drive nodes.
- **restore_job**: source snapshot, target, estimated bytes/cost, approval context, state, progress, actual checksum readback, failure reasons.
- **index_entry / provenance**: source version, extraction version, permissions epoch, text/embedding location, model/process identity, confidence and expiry.
- **outbox / inbox / audit / usage_ledger**: trace/correlation IDs, durable effects, dedupe, meter events and independently verifiable outcomes.

Foreign keys enforce tenant/workspace containment (including parent/child and revision joins). Materialized folders and path caches are derived, with cycle checks and bounded depth. Decide case handling/Unicode normalization per filesystem and preserve original spelling; prohibit reserved device names and portable-hostile path operations appropriately.

## 4. Protocol and synchronization contracts

- Desktop agents monitor filesystem events **and perform periodic full reconciliation** because watchers miss events. Use OS-integrated files-on-demand/placeholders only where verified supported; otherwise use safe selective sync.
- Client local state is an encrypted SQLite journal of selected roots, file IDs, mtime/size, content hashes, pending operations, upload offsets and server cursor. Device secret in Keychain/Windows Credential Manager, never plain user files.
- Server orders changes with monotonic workspace sequence; client sends idempotent, revision-conditioned mutations. A retry yields the original receipt. Stale revision returns CONFLICT with both revisions; retain both user versions rather than silently overwrite. Move/delete/rename storms and two offline devices require dedicated test fixtures.
- Incremental change delivery uses cursor pagination; websocket/push is only a hint. Reconnect always reconciles from durable cursor. ACL revocation invalidates outstanding download sessions and caches as technically feasible; previously downloaded data cannot be remotely undisclosed.
- Uploads: create scoped upload intent → bounded chunk/resumable transfer → server verifies size, SHA-256 and object generation, performs malware quarantine policy → metadata transaction commits new version/outbox/usage → verified receipt returned. An HTTP 200 for intent or upload alone is not completion.
- GCS writes and SQL commits are not atomic: reconcile staged-orphan uploads, unknown outcomes, and committed references whose GCS object is missing. Fail closed on read until an object-generation/hash check succeeds. Background GC operates after safe retention/lease checks, with a conservative quarantine window.
- Downloads: authorize node/version/actor and issue short-lived response or signed URL bound to exact object generation; never accept a caller-supplied bucket/path.
- Byte-range downloads, large file resumptions, local bandwidth throttling, battery-aware sync, retry jitter and bounded concurrent operations are required; compressed/encrypted/uncompressible formats do not guarantee delta savings.
- Use platform-safe snapshot APIs only where available and tested (e.g., Windows VSS for consistent data; macOS APFS snapshots with entitlement/permission limitations). Sync agent should never assume a live application database is safely backed up simply by copying open files.

### Proposed initial REST operation contracts (names illustrative, not registered)

| Operation | Method and path | Essential contract |
| --- | --- | --- |
| Get namespace | GET /cloud/v1/workspaces/{id}/nodes | Actor-scoped, cursor, ETag/revision, no implicit cross-company visibility |
| Make/move/trash node | POST /cloud/v1/nodes/mutations | idempotency_key, expected_revision, scoped authorisation |
| Start upload | POST /cloud/v1/uploads | parent/file, length, digest, MIME, expected_version, quota reservation |
| Complete upload | POST /cloud/v1/uploads/{id}/complete | server-side GCS readback + durable version commit |
| Download version | POST /cloud/v1/versions/{id}/download | ACL + scan state, short-lived object-generation scoped access |
| Changes since cursor | GET /cloud/v1/workspaces/{id}/changes | signed cursor, permission epoch, gap detection |
| Shares | POST /cloud/v1/shares | validated recipient/grant/expiry, link token stored only as hash |
| Register device | POST /cloud/v1/devices | verified user context and bound device key; revocable |
| Backup snapshot | POST /cloud/v1/backups/{set}/snapshots | manifest admission, consistency type, immutable commit receipt |
| Restore | POST /cloud/v1/restores | version/snapshot, target, approval/policy, durable progress and verified completion |
| Search | POST /cloud/v1/search | exact + semantic retrieval with source version and permission-filtered citations |

Standard errors: UNAUTHENTICATED, FORBIDDEN, NOT_FOUND (non-disclosing), INVALID_ARGUMENT, STALE_REVISION, QUOTA_EXCEEDED, MALWARE_QUARANTINED, TRANSFER_INCOMPLETE, RETENTION_LOCKED, UNAVAILABLE, UNKNOWN_OUTCOME. Responses include request_id, trace_id, capability_version, durable status and retry_safe where meaningful.

## 5. Backup architecture and retention

**MVP file protection:** opt-in local folder protection; continuous incremental upload; daily consistent recovery points; independently retained versions; restore a single file/folder into original or alternative location. Local file deletions do not immediately delete protected backup history.

**Later whole-device protection:** platform-specific consistent volume images, boot/system partitions, app settings, recovery media and driver/OS compatibility matrix. A successful file restore is not proof of bare-metal restore. macOS system-volume/security constraints and Windows imaging/VSS licensing, signed agents and privileged helper boundaries require separate validation.

**Recovery vault:** use distinct backup service account, bucket/project where justified, IAM separation, encryption keys, GCS retention policies/object version safeguards, lifecycle audit, no unconditional destructive administrator path from ordinary Drive operations. Test restoration from retained data in a clean environment. For irreversible legal deletion requests, explicitly reconcile regulatory requirements, immutable-retention commitments and customer-facing terms before promises.

**Retention (proposed defaults, subject to product/legal approval):** Drive trash 30 days; file history 180 days for paid plans; backup daily recovery points 30 days and monthly 12 months for qualifying tiers. These are proposals, not configured policies. Cost/region/legal hold tiers must be modeled before activation. Enforce GC only after snapshot references, legal hold and retention lock are checked.

## 6. Security, privacy and compliance

Threats: cross-tenant IDOR, stolen device/session, malicious shared links, ransomware/delete propagation, object overwrite, replay of upload completion, poisoned extracted documents, prompt injection, malware uploads, signed-URL leakage, excessive privilege and billing/egress abuse.

Controls:
- Server derives tenant, actor, company and grant; rechecks on every mutation and content retrieval. Client-provided paths, permissions and company IDs are never authority.
- GCS encrypted at rest and TLS in transit; separate data encryption domains per tenant where feasible. KMS rotation and restore exercises. Optional **Private Vault** client-held-key mode cannot promise server-side plaintext AI search; document capabilities and key-loss implications.
- Malware scanning/quarantine before share/preview/index; do not parse risky documents in privileged workers. Sandboxed extraction, MIME sniffing, limits against decompression bombs, image/PDF parser failures, timeouts and worker resource caps.
- ACL filter **before retrieval and after rank**, with permission revision on every semantic result and source link. Removing access invalidates derived index visibility; embeddings and cache have bounded deletion/expiry.
- Logs never contain customer file bytes, plaintext secrets, download tokens, private text, or sensitive names where avoidable. Audit shares, downloads, access denials, policy changes, restorations, GCS mutations and privileged diagnostics.
- Device enrollment/revocation, rate limits, share link entropy, anomaly alerts, malware and ransomware heuristics, emergency freeze, MFA/step-up for high-risk deletes and bulk exports.
- Regional placement, DPA, deletion/export, subprocessor inventory and applicable privacy law are go-live requirements, not blanket assertions of compliance.
- Supplier/license review for any open-source backup engine, filesystem driver or SDK. No customer contents used for model training without explicit authority and contract coverage.

## 7. Availability, performance and cost envelope

All targets below are **candidate acceptance thresholds** to benchmark in a controlled pilot, not achieved SLOs:
- Application API >=99.9% monthly uptime target for paid launch; excludes documented maintenance under approved terms. RPO <=15 minutes for metadata under approved HA/DR design and <=24 hours for earliest MVP protected-folder snapshot until continuous-protection proofs succeed. Set RTO by service tier only after an actual disaster-restore exercise.
- p95 metadata folder list/search-under-index (1,000 nodes) <=750 ms at defined load, excluding network/media transfer; no search latency guarantee before indexed corpus and load cohort are specified.
- 10 GB interrupted upload resumes without content corruption or duplicate committed versions; failed checksum never becomes visible; 100,000-node tree pagination maintains stable cursor under changes.
- No cross-tenant data disclosure in negative tests (hard fail); 100% sampled committed objects have verified size+digest; backup restore results hash-match source fixture.

Costs modeled separately: GCS stored GB-month (including versions and immutable backup history), class/region, PUT/GET, cross-region replication, egress/restore, Cloud SQL compute/storage/HA, workers/scans/index embeddings, support, billing, and data-erasure obligations. Avoid unconditional 'unlimited' plans, unbounded dedup reference growth and predictable loss-making restore fees. Meter logical user bytes and physical provider bytes separately; settle once per unique metering event.

## 8. Rollout, migration and recovery

0. Inventory existing live file users/tables/buckets/functions and authorization paths. Record data lineage, current storage backend registry and conflicts between repository source and deployed functions. No production writes in the inventory step.
1. Design approval + ADR for Cloud SQL versus an extended Supabase metadata layer, GCS topology/region and retention model. Provider entitlement, data residency, supported workloads and forecast spending must be verified.
2. Build isolated tenant-limited metadata schema and private buckets; use workload federation/service identity; canary enabled only for synthetic/consenting pilot users. GCS remains non-default until signed transfer/download, checksums, ACL, backup recovery and isolation pass.
3. Shadow index/reference existing Supabase files by stable ID without rewriting originals. Dual-read verification with immutable checksum manifests; use an explicit per-file cutover marker and one canonical write owner, not indefinite dual-write.
4. Release files-only UX, then safe desktop sync, protected-folder backup, reliable restoration, AI indexing, collaboration and device/full-system recovery in evidence-gated slices.
5. During rollout failures, freeze new writes, preserve retention/old buckets and ledger, reconcile unknown outcomes, restore last known-good API and per-tenant routing. Never rollback a migration by deleting newly created customer versions. Keep compatibility and source IDs.
6. Post-cutover reconcile byte counts, object manifests, metadata revisions, permissions, search ACL and billing; sample full restores. Decommission older objects only after documented retention/legal/recovery windows.

## 9. Open architecture decisions (must be resolved, not assumed)

| ID | Decision | Recommended default / gate |
| --- | --- | --- |
| SC-ADR-01 | Metadata authority and transactional store | Cloud SQL for *new* namespace only after proof versus extending Supabase; no dual writer |
| SC-ADR-02 | GCS bucket and key topology | Region/dual-region from legal residency + cost + recovery tests |
| SC-ADR-03 | Sync delta/chunk algorithm | Start safe full-object resumable protocol; adopt block delta after benchmarks and cryptographic review |
| SC-ADR-04 | Device backup technology | Evaluate native snapshot methods + candidate open-source engines under license/security review |
| SC-ADR-05 | Retention, legal hold, purge | Align terms, privacy deletion, e-discovery and immutable locks |
| SC-ADR-06 | AI extraction/embedding location | Permission-filtered, opt-in, cost-bounded, source-version provenance |
| SC-ADR-07 | Client delivery and update signing | Signed native apps, phased auto-updates and rollback channels |
| SC-ADR-08 | Multi-tenant object deduplication | No cross-tenant dedup by default (privacy boundary) |

## 10. Relation to engineering scope

Implementation order, ownership, acceptance identifiers, evidence and launch gates are defined in [SANDY-ENG-0012](../sandy-engineering/tasks/SANDY-ENG-0012-sandy-cloud-drive-backup.md). This document approves **no resource creation, migration, provider grant, production release or customer data movement**. Published documentation must not be described as a deployed product.
