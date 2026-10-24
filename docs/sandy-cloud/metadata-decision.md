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

## Production identity readback — 24 October 2026

A further authorized metadata-only read confirmed
`sandy_memory_portal_accounts(auth_user_id, customer_id, revoked_at)`,
`email_customer_addresses(customer_id, normalized_email, is_primary, verified_at)`,
`sandy_agenda_access(email, customer_id, enabled)` and
`sandy_agenda_companies(id, customer_id, name)`. The company ownership relation is
customer-scoped; no separate company-member table was returned by the inspected
public table inventory. Do not infer collaborative company grants from task
participation or manufacture new membership authority.

`sandy_api_tenants(id, name, status, daily_request_limit)` exists, but its identifier
must not be equated to a customer ID without the existing API owner's binding.
The production adapter must receive server-verified API actor/tenant/session
context, resolve current portal/customer binding and company ownership through
these existing services, and fail closed for an unestablished company share.
This finding narrows the shared integration dependency; it does not prevent local
implementation or authorize changes to shared identity and gateway resources.
