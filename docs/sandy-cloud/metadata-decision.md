# SC-ADR-01 — Preserve existing authority; add a domain adapter

Decision for implementation: keep existing Supabase universal-file IDs and
identity/membership authority. A future production Drive extension should be
colocated with those transactions until measured load or operational isolation
justifies Cloud SQL. Do not create a second independently writable universal-file
catalogue or introduce a cross-database dual write. Production schema and gateway
installation remain subject to the existing component owner and source-preserving
release procedure; this ADR does not create grants or claim deployment.

The new `packages/sandy-cloud/schema.sql` is an executable **local SQLite reference
schema**, not a migration for Supabase or Cloud SQL. It proves durable domain
transactions and test semantics independently of provider access. Existing live
records are never copied into it. Production mapping must preserve canonical
customer/workspace/company membership, link immutable Drive versions to existing
universal file IDs through stable references, use server-owned admission, and
commit version, receipt, quota and outbox in one PostgreSQL transaction.

Contract boundary: `api.ts` defines named fixture operations; `domain.ts` implements
revision-conditioned mutations, durable idempotency, immutable versions and local
snapshots. `integrity.ts` remains the provider-independent streaming verifier.
The fixture uses SQLite and separate local object files, caps a file at 64 MiB,
and is deliberately not registered in the live Sandy operation registry. Its
identity issuer is restricted to synthetic loopback testing. Nothing in it is a
production authentication system, scanner, provider worker or deployed database.

Production adapter exit gates: exact live membership/tenant mapping, equivalent
Postgres composite foreign keys and transaction isolation, source-attested
canonical API admission, row-level security, scoped object provider reader,
server-owned scan evidence, version/usage/outbox atomicity, protected release,
two-tenant provider tests and recovery. Full scope 0012 remains governing.
