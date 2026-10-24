# Sandy Cloud production integration handoff

Status: source implementation only; no live deployment or acceptance. PR245's
merged local-source evidence is preserved separately. This handoff does not
approve the USD10 resource proposal or any security/role changes.

## Existing owners: exact dependencies for the parent

1. **API/identity owner (0005/161):** supply a server-owned binding from the admitted
   API principal/tenant to the existing portal customer, session/device and
   company authorization. Live `sandy_api_tenants.id` is not proven equal to
   customer ID. Repository `customer_services.ts` already distinguishes portal
   and agenda customers. Do not infer collaborative access from company ownership.
   Need an in-transaction revocation/policy locking contract, not another gateway.
2. **Universal-file owner:** preserve deployed `sandy-files` v25 source and define
   canonical file writer assignment plus revision-CAS/lifecycle projection on the
   same PostgreSQL connection. The new extension references existing file IDs and
   never independently rewrites the file catalogue. Read-only schema inspection
   confirmed canonical `id`, `owner_customer_id`, `sha256`, `byte_size`,
   `storage_bucket`, `storage_path`, `provider`, `provider_file_id`, `metadata`.
3. **Database/release owner:** review the candidate private schema, exact role and
   RLS plan; provide a transaction-capable connection through existing authorized
   execution. No role/grant/BYPASSRLS request is bundled. Need a release lease and
   source-pinned protected migration procedure; no schema has been applied.
4. **Provider owner:** supply authorized inventory and admitted transport for the
   proposed project/buckets, current workload identity and server-owned scanner.
   Parent consolidates region, USD10 ceiling and IAM proposal. No retry of denied
   inventory or branch-protection access; no new direct provider credential path.
5. **Mission/commercial owners:** bind the local transactional outbox to the
   existing leased workers and consume each version usage ID once. Transfer
   creation/reservation/expiry and full backup/restore workers remain source work
   after those interface contracts are fixed. No second global queue is proposed.

## Release package and acceptance

`packages/sandy-cloud/build_release.py` packages committed allowlisted integration
source with SHA-256 per file, scope and commit identity, explicit unresolved owner
bindings and non-destructive rollback. It excludes the synthetic fixture issuer,
local SQLite domain/server, UI credentials and test hooks. It performs no install,
provider call, migration, grant or deployment. The archive is review material,
not an executable production release.

PostgreSQL tests execute synthetic transactions in PGlite 0.3.14. They establish
atomicity and deny behavior for this adapter only. Real PostgreSQL multi-session
revocation/locking, real scanner attestations, source-preserved canonical API
integration and GCS generation readback must still pass before any deployment
can be described as accepted. No AC-01 through AC-13 is newly passed.

Rollback design: freeze new Cloud writes through existing owner routing, preserve
all new versions/receipts/outbox and provider bytes, restore prior source and
per-tenant routing, then reconcile unknown outcomes. Never drop extension tables
or delete objects as an automated rollback. Forward repair must retain stable
universal file IDs and historical generations.

## PR270 contract consumption — Cloud-owned source continuation

Dependency: API PR270 head `cbfe1653798e25e2b88f93196b34947406a946f1`.
Its ready transition was reported denied; this work neither retries that action
nor releases the dependent API code. Cloud's branch is stacked on that exact head
and its draft PR targets the API branch solely to show the Cloud-only diff. Do
not merge this draft into the API-owned branch. After the parent resolves PR270's
release gate, rebase/retarget the Cloud changes onto accepted main before release.

Implemented source:

- `postgres/authority.ts` implements `CloudAuthorityOwner`. Runtime supplies
  explicit locked admission, session, tenant/customer, device and company facts.
  Cloud validates every binding/status/expiry and locks the known canonical
  `sandy_memory_portal_accounts` row with `FOR SHARE` on the supplied transaction.
  It never equates tenant and customer IDs or infers a missing company grant.
- `postgres/transfer_custody.ts` validates Runtime-owned private custody against
  the exact server intent and current API session/device. Unknown outcomes allow
  status reconciliation only; chunk retry is denied. Foreign session URLs and
  incomplete generation readbacks are refused. No worker, provider fetch, grant,
  session persistence or offset update is created; those stay with Runtime.
- `postgres/projection.ts` requires a locked explicit file-writer assignment,
  scoped current head and canonical customer ownership. It projects generation,
  bucket/key, size/digest and version metadata atomically, preserving unrelated
  metadata, display name, description and library state. It creates an immutable
  version-projection audit event on the same transaction as the commit boundary.
  Missing/foreign/revoked assignments fail closed; this code creates none.

Metadata-only live inspection confirmed the portal columns and that
`sandy_file_lifecycle_events` contains only id/customer/file/from_state/to_state/at.
A version update is not a library-state transition. Therefore `projection.sql`
adds a **candidate private** `projection_events` table, rather than inventing a
state transition in that live table. It is uninstalled and grants no access.

### Runtime/file-owner decisions required before activation

1. Identify the actual canonical tenant/customer relation and the rows/owners
   for session, admission, company/device revocation. Supply `RuntimeAuthorityRows`
   on the existing pinned DB connection. Proposed conflict order is admission,
   session, tenant/customer, device, company, portal, Cloud workspace, intent,
   file head, writer assignment, universal file. All revokers must be reconciled
   against this order; no real multi-session locking claim has been established.
2. Supply `RuntimeTransferCustody` with existing durable intent/session ownership,
   dispatch claim and offset CAS, unknown-outcome persistence and reconciliation.
   The returned scope is internal only. API admission remains required immediately
   before each provider dispatch; loading a scope is not an execution grant.
3. Identify the existing canonical file-writer assignment source. Return only
   explicit Cloud ownership and the current locked revision; do not auto-assign
   legacy files. The candidate projection represents GCS generation in
   `provider_file_id` and the full immutable reference in
   `metadata.sandy_cloud_version`. File/API owners must review this mapping and
   upgrade or route compatible readers before enabling it. Deployed `sandy-files`
   v25 is untouched; it must not be assumed to support this GCS mapping.
4. Review `projection.sql` together with the uninstalled private schema and exact
   role/RLS plan. Production activation still requires approved resources and
   protected source-preserving rollout. No credentials or permissions requested
   by this source package.

Eight embedded PostgreSQL scenarios compose the actual PR270 admission hook and
Cloud commit boundary with synthetic Runtime/writer facts and real fixture portal
rows. They cover explicit distinct tenant/customer mapping, negative grants,
portal revoke/rebind, revoke between admission/commit, writer denial, audit rollback,
canonical metadata preservation and revoked receipt replay. Three further Deno
scenarios validate custody substitutions, unknown-outcome status through the real
API transport/protocol and foreign sessions/incomplete generation denial. These
are source tests, not actual customer mapping, multi-session or provider acceptance.
