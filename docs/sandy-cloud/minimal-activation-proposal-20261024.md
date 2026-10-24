# Consolidated minimal activation dependencies — inactive

Cloud source now composes Runtime PR303 at
`cd6f6cf659e924bd0c9090445a7794ae122746ab`, including its canonical reference
loader and complete lock plan. Combined acceptance is recorded in
`runtime-combined-acceptance-20261024.md`. There is no remaining undefined
reference/lock interface. This list supersedes prior reciprocal source handoffs.
No live action is requested until its actual targets and diff below are known.

Read-only inventory on 2026-10-24 confirmed the existing project is healthy in
`eu-west-1` on PostgreSQL 17.11 and that candidate Cloud/custody tables are not
installed. Portal/admission columns match the source assumptions. The limited
public-table grant inventory does not select an authorized Cloud transaction
principal. See `source-review-20261024.md` for exact observations and limits;
independent source review is still pending because its runner could not start.

## Exact existing target and source changes

Reuse existing Supabase project `zmqlyygzqoidkcwdysok`; preserve universal-file
IDs, portal mapping, existing API/Runtime workers, default backend and deployed
`sandy-files` v25. No DNS, new database/VM/queue, private-file import or default
storage change is included. New paid resources in this reuse stage: **none**;
existing metered service usage is not represented as free.

Candidate additive schema order: Cloud `postgres/schema.sql` and Runtime
`schema.sql`, followed by Runtime `cloud_reference_schema.sql` and Cloud
`postgres/projection.sql`. All are source proposals; none is in an automatic
migration path. Generate the Cloud release manifest from the accepted commit and
include the pinned Runtime schema hashes in the protected release diff. Review
must account for FORCE RLS/default-deny, immutable history and existing references.
Schema presence alone is neither product activation nor acceptance.

## Finite binding and approval checklist

| Dependency | Concrete value/evidence required before activation | Owning release surface |
| --- | --- | --- |
| Source and lease | Accepted Cloud PR306 and Runtime PR303 commits, current API release commit, protected release lease and rollback source/config hashes | Existing shared release owners; no competing deployment |
| Transaction execution | Existing transaction endpoint and exact DB principal, current grants/RLS/backup/capacity receipts; before/after SQL confined to these private schemas if any access change is necessary | Existing Supabase/Runtime installation |
| Canonical authority | Actual session/device/company and explicit tenant/customer relation lookup bound to `RuntimeAuthorityRows.lock` and Runtime journal authority; current portal mapping stays authoritative; no equal-UUID inference | API identity/Runtime resolver installation |
| Writer custody | Actual canonical assignment lookup bound to `WriterDiscovery.discover` and `canonicalFileProjection`; exact assignment IDs and current allowed file set; no implicit assignment of legacy files | Canonical file writer installation |
| Revocation participation | Release receipts for actor/portal/tenant/customer/admission/session/company/device/writer/scanner mutators taking the complete shared gates before row locks; device uses actor, reassignment uses old/new actors, writer reassignment uses file plus old/new assignments | Existing mutator routes, not a replacement authority |
| Scanner and provider | Exact existing scanner workload, issuer/release/public-key fingerprint/trust revision and generation-read transport; private transfer-session custody binding; exact bucket/key namespace and provider generation readback | Existing Runtime/scanner/provider installation |
| Upload lifecycle and delivery | Existing server-owned intent/session creation, quota reservation/expiry and outbox/usage-consumer installation bound to the metadata contract; transport unknown outcomes remain status-only; no browser-supplied scan/session authority | Cloud adapter through existing Runtime/API execution |
| Canary routing | Exact existing operation ID and contract hash, admitted scope, two synthetic actor/session/customer/tenant/workspace sets, file/writer IDs and selected routing diff; preserve v25 reader and current default routes | Existing API dispatch installation |

Interfaces in this table are implemented source seams, not requests for another
interface design. The remaining missing values are live installation identities,
current grant/ownership inventories and protected approval receipts. Test fixture
IDs, operation labels and ephemeral keys are not eligible production values.
No new principal, credential, trust entry, grant, role, RLS bypass or revoker change
is authorized. If existing access is insufficient, prepare the exact before/after
SQL/IAM diff for the named principal; do not create BYPASSRLS or broad standing
credentials. No exact access change can honestly be approved before that inventory.

## Separate new-resource option, still unapproved

Only if authorized inventory establishes that existing resources cannot provide
private staging/Drive/vault boundaries, the earlier proposal is:

- Project `elaborate-haven-511518-a5`, assumed region `europe-west1`.
- Buckets `elaborate-haven-511518-a5-sc0012-stage`,
  `elaborate-haven-511518-a5-sc0012-drive`, and
  `elaborate-haven-511518-a5-sc0012-vault`.
- 30-day pilot, USD10 ceiling, 10 GiB retained, 20 GiB egress, 10,000 Class A and
  100,000 Class B operations; proposed service-account/bucket role matrix is in
  `pilot-approval-request.md`. These are limits/assumptions, not a verified bill.
- Region, accounts, IAM bindings and spend are all pending approval. No new Cloud
  SQL, scanner/model spend, immutable retention lock or key creation is bundled.

Acceptance of existing-resource reuse does not authorize this option. No bucket
provisioning, credential request or live operation is attempted by this proposal.

## Bounded validation and rollback

Once the exact values and protected approvals above are provided, install only
the reviewed additive private schema under the release lease. Route explicitly
selected synthetic canaries through the existing API; verify two-tenant upload,
exact-generation hash readback, download, restore, current revocation, rollback
and lost-acknowledgement reconciliation. Independently record deployed acceptance
separately from the local evidence. Do not enable retail/default routing from unit
or fixture tests.

On failure, freeze new Cloud canary writes and restore the prior routing/source;
preserve versions, shared references, receipts, provider bytes and outbox. No
schema down-migration, user-data deletion, trust activation or repeat of Runtime
event250 is authorized here.

**Status: activation pending exact live bindings/inventory and protected
release/access approvals; not attempted. No denied or uncertain live write occurred
in this source-integration milestone. Full SANDY-ENG-0012 scope remains open.**
