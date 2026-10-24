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
