# SANDY-ENG-0012 delivery checklist

Authority: [scope v1.0](../sandy-engineering/tasks/SANDY-ENG-0012-sandy-cloud-drive-backup.md)
and [architecture v0.1](architecture.md). Full scope retained; no MVP exception
or acceptance waiver has been approved. Baseline read on 23 October 2026 UTC.

## Source and live reconciliation

- PR [236](https://github.com/ausstyle/web-staging/pull/236) latest head:
  `b1b4d5227493145a87184495b7bca1fc1fa04602`; merged at
  `3c84274c61127f93052c1287c24abafc4d313aee`. Both refs fetched.
- Isolated worktree `/workspace/sandy-cloud-0012`, branch
  `sandy-cloud/deploy-scope-0012`. Other worktrees were not changed.
- Supabase catalogue readback: scope v1.0, DRAFT, source commit
  `7e0e225e64a80eb163575ae66edae9d830a66b81`, synced at
  `2026-10-23T23:51:59.881Z`. Its SHA-256
  `93adf0f017540fe21dc9fc7ae2a83b1dca6c2c42e9e752ef11a2ec4de2f6403b`
  matches the locally hashed complete scope. Synchronization is verified;
  implementation is not.
- Independently fetched deployed `sandy-files` v25, ACTIVE, bundle SHA-256
  `878e3fdd1184bfbe287d37e9e4eec92f54126f63d9d1494871fe2de1db6bb9bb`.
  Its source is absent from the main repository function directory. It validates
  Supabase user, portal account and primary email, then filters files by owner.
  It implements list/history/set_description/set_state/open only. Its state
  update and lifecycle audit are separate operations, not the required atomic
  Drive revision/outbox transaction. Do not overwrite it from an invented stub.
- Independently fetched `sandy-task-files` v16, ACTIVE, bundle SHA-256
  `23072d6f10f38e39b14d9c34ad29f854adccc489d05403afebe8c9f505dddc46`.
  Repository attachment completion checks listed object size; it does not prove
  Sandy Cloud digest, generation, immutable version or protected snapshot behavior.
- `files.library.list` and `.download` are API-exposed but live registry state is
  `deployed_unverified`, `verified=false`. Existing fixed contracts also include
  history, description.set and state.set. Keep these statuses unchanged.
- `sandy_universal_files`, references, links and lifecycle events have RLS enabled;
  no policies or anon/authenticated table grants were returned for these reads.
  The privileged handler remains responsible for tenant authorization. Existing
  lineage includes calendar attachments (24), task attachments (4), knowledge
  documents (64), email attachments (107) and WhatsApp media (13). These are
  aggregate reference counts, not imported private documents or acceptance tests.
- Existing storage registry: `supabase_existing`, verified/default, eu-west-1;
  `gcs_primary`, planned/non-default, no bucket/region/verified timestamp. Private
  Supabase buckets observed: email-ai-attachments, sandy-windows-private,
  sandy-whatsapp-media, sandy-task-artifacts, sandy-knowledge-originals,
  sandy-calendar-private, sandy-generated-images, sandy-task-attachments,
  sandy-spending-private. No bucket/default/data mutations performed.
- Registered GCP target project is `elaborate-haven-511518-a5`, zone
  europe-west1-b. This identifies existing infrastructure, not Cloud storage
  authorization, billing approval or residency approval.
- Existing draft [PR177](https://github.com/ausstyle/web-staging/pull/177), head
  `07bd4655cc74cea751dfa527f1ba9696238eecca`, owns proposed GCS Terraform:
  four private buckets and two service accounts. Read both complete files.
  It is not applied/verified evidence; no CI checks reported. It has no separate
  immutable backup vault; quarantine age deletion is configured, not backup
  retention. Do not apply it wholesale or duplicate its identities under 0012.
- Hosting PR238/203 and provider PR196 are distinct active work. Main advanced
  through runtime PR240 (`15863f9`) during inventory. No runtime, provider,
  gateway, hosting, DNS or shared release changes made. Database leases observed
  for engineering-runtime and legacy compatibility were expired; absence of a
  lease is not permission to take over a shared owner.

## Requirement-to-delivery traceability

“Partial source” is not deployed or independently accepted. All mandatory
acceptance scenarios remain pending. No product feature is newly deployed.

| Requirement | Delivery and canonical integration | Source status | Deployed | Independent acceptance |
|---|---|---|---|---|
| SC-01 namespace/company/tree | WP-1; existing identity + new admitted namespace mutations | Local durable namespace, company membership, tree mutations and revision/idempotency contracts implemented; production mapping pending | No | AC-01/02 pending |
| SC-02 transfers/versions | WP-1/2; complete-upload via Sandy API | Local durable chunk resumption, immutable versions and atomic receipts/quota/outbox plus streaming verifier implemented; GCS/PostgreSQL adapter pending | No | AC-03/04 pending |
| SC-03 device sync | WP-4; durable revisions/cursors/conflicts | Local folder-tree sync, encrypted journal, offline conflicts, rename/move and retained deletes tested; signed native agents pending | No | AC-05 pending |
| SC-04 secure sharing | WP-1/3; scoped version download/share operations | Local recipient-bound exact-version shares, expiry/epoch/revoke/audit implemented; production sharing/UI refinement pending | No | AC-02/06 pending |
| SC-05 independent backup | WP-5; retained manifests/vault | Independent local protected-folder capture and immutable manifests implemented; native consistency, scheduler integration and provider vault pending | No | AC-07 pending |
| SC-06 restore | WP-6; restore admission/receipts | Clean-directory local restore and independent disk/tree/hash readback implemented; durable production restore worker pending | No | AC-08 pending |
| SC-07 AI | WP-7; existing memory ACL/provenance boundary | Opt-in plain-text lexical index, live ACL/current-version filtering and citations implemented locally; sandboxed rich parsing and semantic AI pending | No | AC-09 pending |
| SC-08 integrations | WP-1/3/7; stable universal-file references | Existing lineage inventoried; compatible projections/migration still pending | No new release | AC-10 pending |
| SC-09 usage/health | WP-8; existing billing/entitlements | Local quota reservations, unique usage settlement and sequence audit implemented; provider cost/invoice reconciliation and dashboards pending | No | AC-11 pending |
| SC-10 GCS rollout | WP-0/2/6; existing backend registry | Planned only; default preserved, PR177 reconciled | No | AC-12 pending |
| SC-11 desktop | WP-4; verified device identity | Pending signed macOS/Windows installer, encrypted journal, revocation, OS tests | No | AC-05/13 pending |
| SC-12 truthful recovery | WP-1/6; shared durable receipts/outbox | Local atomic metadata/outbox and fault/restart recovery tested; provider failure/rollback drills pending | No | AC-04/08/12 pending |
| SC-13 mobile | WP-9, explicitly later in authoritative scope | Pending | No | AC-14 later |
| SC-14 bare-metal images | WP-9, explicitly later in authoritative scope | Pending | No | AC-15 later |

## Dependency order and release gates

1. **WP-0, partial:** complete provider inventory and SC-ADR-01/02/05 decisions.
   Preserve Supabase universal-file authority. Recommendation for owner review:
   keep metadata colocated with current Supabase identity/receipts for the first
   isolated pilot; do not create Cloud SQL without measured need and a separately
   accepted ADR. This recommendation is not a schema deployment approval.
2. **WP-1, partial source:** integrate the integrity module with a real atomic
   domain transaction after the metadata decision. Add namespace/tree/company
   grants, version history, quotas and transaction/outbox tests. Reuse the existing
   gateway owner for allowlist/contract integration; no parallel executor.
3. **WP-2, blocked externally:** resolve actual bucket inventory/ownership, exact
   region and approved spend, then review a source-pinned GCS plan and workload
   bindings. Quarantine/scanning, independent generation readback, resumable 10 GB
   upload, protected vault and provider failure drills must precede activation.
4. **WP-3:** implement Files UI through admitted Sandy API operations; signed-in
   two-tenant UX and 100 real negative cases. Local synthetic cases are insufficient.
5. **WP-4/5/6:** native signed clients, encrypted journal, two-device conflict and
   reconnect tests; independent backup retention; clean-device restore; fault and
   rollback drills. No computer-backup claim before these pass.
6. **WP-7/8:** opt-in ACL-filtered intelligence, malicious-document tests, usage
   and invoice reconciliation, privacy/support/operations and monitored cohort.
7. **WP-9:** mobile and whole-system recovery under their later acceptance gates.

## Verified checks and limitations

- 13 deterministic TypeScript tests passed: streaming size/hash/generation,
  100 synthetic tenant/workspace substitutions, cancellation, disconnected read,
  idempotent replay, lost commit acknowledgement, unknown outcome, malware gate,
  expiry/revocation, receipt mismatch and restore path/tree/corruption checks.
- One local Linux disk integration passed: create a synthetic 32 MiB file,
  independently reopen/hash it, reject one-byte corruption and an extra target
  file. This is not a native restore client, GCS result or AC-08 pass.
- Dedicated CI runs formatting, typecheck and both suites without provider
  credentials. CI receipts are linked from the implementation PR.
- No migrations, user file reads/copies, imports, sharing changes, grants,
  paid resources, deployment or default switch performed. No operation verification
  flags changed. Existing customer data and working routes are preserved.

## Precise external blockers / decisions

| Action / target | Observed result | Required resolution |
|---|---|---|
| Read GCS bucket inventory via `gcp.storage.buckets.list` for registered project | `canonical_operation_unavailable`, `executed=false`; registry is unverified, API-exposed false, permission `infrastructure:write` | 0005 owner supplies an authorized read-only provider inventory path or current provider receipt; do not relabel the operation to bypass policy |
| Read main branch protection on ausstyle/web-staging | GitHub HTTP 403 `Resource not accessible by integration` | Release owner verifies protected branch/rules and permitted merge path; no protection changes requested |
| Select transactional metadata owner | Cloud SQL is only a candidate; no decision recorded | Accept SC-ADR-01 before creating schema or cross-store ownership |
| GCS paid/security provisioning | No approved amount, exact runtime identity, bucket ownership or region evidence | Review exact plan with project, bucket names, region, retention, monthly currency ceiling, expiry, egress/operation limits and identity-to-role bindings; request approval only for that plan |
| Mac/Windows signed release and real two-tenant E2E | No verified signing/notarization identity, OS test agents or consenting pilot pair established | Supply scoped release identity/test devices and synthetic pilot tenants through existing connections; no standing owner tokens |

No action has an uncertain provider-write outcome: no provider writes were issued.
The next milestone is a metadata/provider ownership decision and a real isolated
upload/readback transaction, then MVP-1 Drive acceptance. Scope completion is not
claimed; remaining software requirements above still require implementation.


## Continuation delivery — 24 October 2026

Original commit `ea9560e30f379b87423c1660a223ea99f2c9e015` and its successful
CI runs remain valid evidence for the first slice. The continuation implements a
usable local vertical slice instead of treating provider inventory as a blocker
to all software work. [Metadata decision](metadata-decision.md) selects preserved
Supabase authority for future production mapping and an isolated SQLite reference
adapter for current fixture verification. No live schema/grant changes occurred.

New implementation: fixed operation contracts and identity boundary; durable
namespace/tree/revisions; resumable immutable chunks; atomic version/receipt/quota/
outbox commit; exact-version shares; consented lexical indexing; browser Drive;
encrypted selective-sync journals and conflict-preserving folder-tree reconciliation;
independent protected-folder backup objects and immutable manifests; clean-directory
restore with independent actual-disk verification. Existing local snapshots are
separate from the new independent backup path, which creates no Drive nodes.

**Observed local acceptance:** 37 Deno tests pass, including database rollback on
injected outbox failure, restart/resume, quota accounting, recipient/expiry/epoch
share denial, two-client offline conflicts/rename/move/deletion, protected-folder
recovery after source deletion/mass modification and clean-directory readback.
Real Chromium passes synthetic upload/download, snapshot/trash/restore, exact
restored byte comparison, second-tenant isolation and reader denial. Browser
screenshot/report are retained as fixture evidence. No local result upgrades a
mandatory provider/device acceptance criterion to passed.

**Remaining software:** production PostgreSQL and canonical gateway adapters,
GCS resumable/streaming assembly and real quarantine scanner; metadata pagination
and signed policy-epoch cursors at 100,000-node scale; durable production backup/
restore scheduling; signed native Mac/Windows clients and safe directory-relative
OS integration; native snapshot consistency; rich-document sandboxing, semantic
retrieval, existing Mail/Task/Memory linking and commercial invoice/SLO support.
Local code explicitly caps files/cohorts at 64 MiB and is not a large-file product.
The fixture server is loopback-only, issues synthetic identities, and must never
be installed as production identity/service code.

**Proposed next provider decision:** [exact pilot approval request](pilot-approval-request.md)
with three isolated bucket names, seven-day unlocked pilot vault retention,
30-day USD 10 storage-only ceiling, byte/operation/egress limits and exact
service-account/bucket roles. No impersonation/binding permission is bundled.
Authorized inventory and the actual release workload principal remain required
before the final source-pinned plan and separate binding request. Branch-protection
inspection was not retried; no protected path or provider denial was bypassed.


### Latest hardening and provider protocol source

The local adapter now upgrades the earlier fixture schema additively, preserving
file bytes and receipts. Share capability plaintext is never stored in receipts;
replay returns no token. A journal lock blocks concurrent sync instances, incoming
replacements retain prior local bytes, and a racing local edit is refused instead
of overwritten. The GCS protocol adapter is source-only behind an injected
admitted transport: generation-preconditioned creation, exact session origin,
chunk/range validation, lost-ack status reconciliation and exact-generation
streaming readback. Its 10 GiB offset test is arithmetic against a synthetic
transport, not a 10 GiB provider transfer or AC-03 acceptance.

For the parent's consolidated setup proposal, the exact unresolved targets are:
(1) authorized read-only storage inventory for `elaborate-haven-511518-a5`;
(2) the account/bucket matrix and USD 10 ceiling in the pilot proposal;
(3) the actual existing provider workload principal and its separately reviewed
binding; (4) a shared API identity/contract release slot preserving current owners;
(5) signed macOS/Windows delivery identities and real two-device test hosts.
No standing approval removal, IAM expansion, new cloud credentials or additional
provider call was attempted. GitHub branch-protection inspection was not retried.

## Production integration continuation — 24 October 2026

PR245 was merged at `9f8ec7f8307ffd4906a10540c8eff77749b7bcdb`; its 37 local
Deno tests and Chromium evidence remain the accepted source baseline. Further
work is isolated on `sandy-cloud/production-integration-0012` from updated main.

SC-02/08/09/12 now have an additional PostgreSQL commit adapter and candidate
private additive schema: exact persisted intent/scan checks; canonical-owner
admission/projection hooks on one transaction; immutable versions; quota/usage,
outbox and receipt atomicity; authorized acknowledgement reconciliation. Thirteen
new embedded PostgreSQL scenarios passed, including outbox/projection rollback,
non-empty reservation settlement and forced-RLS denial after accidental grants.
The production schema is NOT installed; owner hooks in the tests are synthetic.
No company membership mapping, canonical gateway route or workload role is guessed.

A committed-source release packager emits a hash manifest and review archive,
excluding the local fixture issuer/server. The package is explicitly not yet
installable. [Owner handoff](production-integration-handoff.md) lists the precise
canonical identity, file writer, database role/release, provider and Mission
bindings required for live integration. Inventory, USD10 provisioning/region/IAM
and native signing gates remain pending through the parent. No gates were removed,
no denied operation was retried and no existing files were copied or changed.

This closes part of the production transaction source gap, not all WP-1 or any
provider acceptance. Remaining independent source work includes production tree,
share and device operations, pagination, transfer admission/expiry, rich parsing,
backup/restore worker integration and native clients. Their implementation must
use the owner contracts above; local tests alone do not establish those contracts.
All deployment and AC-01–13 acceptance cells remain unchanged (pending).

## Stable folder pagination continuation — 24 October 2026

SC-01/03 and the architecture's 100,000-node pagination requirement now have a
working local domain/API/UI path. `nodes.page` returns at most 500 rows (the Drive
UI requests 100) with HMAC-authenticated cursors bound to current actor, tenant,
workspace, parent, trash filter, page size and policy epoch. Every page rechecks
membership. Five-minute immutable metadata listing projections prevent concurrent
rename/insert/trash operations from causing duplicates or missing rows. They are
not backup snapshots or authorization grants. Token keys are process-local;
restart requires a fresh listing. Snapshot creation is bounded to 100,000 entries,
four active projections per actor and sixteen globally. Existing unpaged methods
remain for compatibility; the browser now uses the bounded path.

Five new tests passed: cursor tamper/expiry/key rotation, mutation-stable traversal,
current admission/query binding, cache bounds/expiry/restart and a 100,000-node
indexed enumeration. The local 100k traversal took about 0.5 seconds in one test
run; this is not a production latency SLO. All 42 Deno tests passed. Real Chromium
also passed a 101-entry folder across a 100-row first page and one-row final page,
alongside existing upload/download/restore/isolation checks. PR245 evidence files
were preserved; these are new source checks, not a replacement acceptance record.

This is meaningful independent product behavior implemented while the parent
coordinates canonical identity/file-writer bindings. Production PostgreSQL tree
mapping, provider execution, native clients and full mandatory acceptance remain
pending. No shared gateway, live schema, IAM/resource or artifact-download action
was attempted. Full scope stays open.

## Canonical binding source continuation

Cloud consumes API PR270 `cbfe165` without editing API-owned source. Added explicit
Runtime fact validation plus canonical portal row locking, exact private-custody
binding/unknown-outcome reconciliation rules, and writer-assigned universal-file
projection with atomic immutable audit. The candidate projection audit schema is
not installed. Eight new PostgreSQL integration scenarios and three custody tests
cover the real API/Cloud interfaces using synthetic authority fixtures. Existing
PR245/266/267 evidence remains preserved. See the updated production handoff for
exact Runtime relation/lock/custody and file-reader compatibility dependencies.

PR270's reported ready-transition denial is respected. Dependent Cloud source is
prepared on a stacked draft only; no merge into the API branch, live schema,
credentials, grants, customer relation, provider routing or deployment is enabled.
All mandatory production acceptance remains pending; full scope stays open.

## Runtime shared scan continuation

Runtime PR303 `ab2cfa4` now composes with Cloud's existing transaction. The production
candidate no longer accepts a separate Cloud clean-verdict table: a required shared
verifier binds signed Runtime evidence to the exact upload and stores an immutable
receipt reference atomically. Final expiry and unknown-acknowledgement recovery
remain fail closed. Six actual pinned Runtime/Cloud PostgreSQL composition scenarios
and four new binding scenarios pass; no production trust or provider is exercised.
[Detailed review and remaining owner work](runtime-scan-alignment-20261024.md).
SC-02/08/12 source integration advanced; no mandatory live acceptance changed.

## Real PostgreSQL concurrency and candidate RLS

Eight real multi-session PostgreSQL 17.6 scenarios now supplement the embedded
engine checks: complete duplicate commit, rollback/waiter race, both revocation
orders, file SHARE-to-UPDATE, backend death rollback, default-deny/forced RLS and
scanner withdrawal. Three distinct backend PIDs and actual blocking relations were
observed. Runtime's actual scope-lock and scan journal source is consumed; no
parallel authority is introduced. See `schema-concurrency-review-20261024.md`.

The inactive `minimal-activation-proposal-20261024.md` separates known existing
Supabase reuse from unknown exact access bindings and the still-unapproved USD10
new-resource proposal. No activation is attempted. Source/RLS coherence does not
mark any mandatory live or native-device acceptance passed.

## Historical version recovery

Independent SC-02/06 product work now implements `versions.restore` through the
local domain/API and Drive history UI. It reopens and hashes the source bytes,
requires the current node revision, creates a new immutable version and atomic
usage/audit/receipt, and preserves all earlier versions. Retry is idempotent;
reader/tenant/trash/stale/quota/corrupt-source cases fail closed. Injected audit
failure rolls back the new version and usage. Logical retained-version quota is
charged once; physical bytes are reused without modifying the immutable object.
Three new domain scenarios and real Chromium historical restore/readback pass;
52 Cloud Deno tests pass in total. Production scanner/provider/canonical route
integration and mandatory acceptance remain pending.

PR270's original ready-transition denial is historical: its source subsequently
merged through its owner. PR272 was retargeted to accepted main, reconciled with
ordinary merge commits preserving API-owned versions, passed five checks and
merged at `7179f62c06d9594b8659326a371eaa64e0867b2c`. PR306 now targets main and
contains only Cloud-scoped differences. No force push or shared scope edits were
used. Source merge is not live schema or product deployment.

### Runtime complete-plan integration follow-up (2026-10-24)

- [x] Adopt PR303 `cd6f6cf` canonical reference loader and complete gates before
  Cloud authority/domain row locks; no parallel custody authority.
- [x] Record/read actual Runtime references in combined acceptance; 8 embedded
  cases and 9 real PostgreSQL multi-session cases, including writer reassignment,
  actor/session/scanner revocation, rollback and backend loss. See
  `runtime-combined-acceptance-20261024.md` for limits and source evidence.
- [x] Consolidate the finite live activation dependencies in
  `minimal-activation-proposal-20261024.md`; no unresolved interface design handoff.
- [ ] Bind and independently accept actual live identity/writer/revoker/provider
  installations through the existing protected release path. No live activation,
  trust, paid resource, production-readiness or full-scope acceptance is implied.

### PR306 review follow-up (2026-10-24)

- [x] Reproduce and fix mutable intent/proof inputs across asynchronous commit
  boundaries; 15 transaction cases and all affected integration suites pass.
- [x] Read existing Supabase project/schema/column/grant metadata without customer
  data or mutations; observations recorded in `source-review-20261024.md`.
- [ ] Independent source verdict: review runner failed before initialization on
  read-only filesystem. Author inspection and passing CI are not a substitute.
- [ ] Exact live installation identities, revoker participation and protected
  activation approval remain pending; USD10 option remains unapproved.

### Independent P1 deadline repair (2026-10-24)

- [x] Preserve immutable authority and writer deadlines, including the actual API
  execution-admission expiry; enforce all at final database-clock settlement.
- [x] Replace simplified callbacks in the real PostgreSQL suite with canonical
  admission/authority/projection hooks and Runtime custody; 22 cases pass,
  including delayed settlement, real writer row-lock waits and receipt replay.
- [ ] Parent's independent re-review of repaired head; live activation stays
  unattempted and all exact installation/approval dependencies remain applicable.
