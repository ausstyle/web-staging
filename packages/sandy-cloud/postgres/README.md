# PostgreSQL integration source

This is an uninstalled additive transaction adapter for SC-02/08/09/12. It is
not an API, complete production metadata service, new identity authority or
deployable Supabase migration. The existing local SQLite fixture remains
independent.

`PostgresCommitBoundary` implements the streaming coordinator's commit boundary.
Every lookup and mutation rechecks canonical admission. Commit locks authority
rows through the owner hook, then workspace, intent and file. It compares the
server-stored input digest, exact object reference, policy epoch, expiry, clean
scan receipt, revision and reservation. One transaction creates the immutable
version, canonical file projection/lifecycle audit, current head, usage, outbox
and receipt and consumes the reservation. Lost acknowledgement is reconciled by
the existing coordinator, never automatically retried by this adapter.

`schema.sql` is a candidate source artifact outside the automatic migration
path. It only adds the private `sandy_cloud` schema and references existing
canonical universal-file IDs. It does not create canonical files or infer
company grants. No PUBLIC access, API exposure, roles or policies are installed.
Every table has forced RLS with no permissive policy. A production role and
exact RLS/owner plan must be reviewed before this can execute. Do not solve that
gate by granting a new BYPASSRLS role. There is intentionally no destructive
down migration.

Required integration contracts:

- `SqlDatabase.transaction` pins one actual PostgreSQL connection through
  commit, propagates ambiguous commit errors, and rolls back callback failures.
  Sequential REST calls cannot implement this interface. Use bounded
  statement/lock timeouts.
- `lockAdmission` resolves the existing authenticated principal, portal
  customer, distinct API tenant binding, device/session/company grant and
  current policy. It locks current grant/revocation rows through transaction
  end. All revocation writers must honor this protocol; a prior JWT check is
  insufficient.
- `projectVersion` updates only a canonical file explicitly assigned to Cloud's
  writer, by revision CAS, and appends canonical lifecycle audit on the supplied
  transaction. It must throw on a missing/foreign file or conflicting writer.
  Current live `sandy-files` source must be preserved by its owner.
- Transfer owner creates intents and reserves quota atomically; scanner owner
  writes exact-generation receipts. Neither is exposed to clients by this
  package. Expiry releases reservations once under the same workspace lock.
  Quota counts all retained versions, not only the current head. Retention/purge
  is unimplemented.
- Existing Mission and commercial owners consume the transactional outbox and
  unique usage IDs; this package creates no independent worker queue or billing.

Run the isolated PostgreSQL suite with Node 24 and pinned PGlite 0.3.14:

```sh
npm install --prefix /tmp/sandy-cloud-pg --ignore-scripts @electric-sql/pglite@0.3.14
node --experimental-transform-types packages/sandy-cloud/postgres/verify.mts /tmp/sandy-cloud-pg/node_modules/@electric-sql/pglite/dist/index.js
```

Thirteen scenarios exercise real embedded PostgreSQL SQL/transactions, RLS deny,
immutable records, tenant/actor/workspace denial, input mismatch, quota,
rollback, policy/scan/expiry changes and acknowledgement recovery. Synthetic
owner hooks exist only in the test file. PGlite uses one connection: queued
Promise calls do not prove multi-session locking, deadlocks, concurrent
revocation or production load. Those require a separately authorized real test
database and owner hooks.

Production tree/share/device/backup schema, admission installation, gateway
registration, rich-document scanner, provider execution, native signed clients
and mandatory acceptance remain unfinished. Do not interpret these tests or the
source bundle as a production-ready storage/backup release.

## Shared scanner dependency (supersedes the earlier scan-row seam)

`PostgresCommitBoundary` requires a third argument implementing
`ScanCommitOwner`. Use `sharedScanOwner` with Runtime PR303 `ab2cfa4`'s
supplied-transaction verifier and a canonical server-owned reference loader. No
clean-verdict table or fallback scanner is part of the production candidate
schema. `version_scans` stores only immutable shared receipt references; Runtime
remains the receipt/trust authority. `fixture_scan.mts` is test-only, excluded
from the release package. Final database settlement checks scan/intent expiry
again and rolls back late completion.

`verify_runtime_scan.mts` runs the actual pinned Runtime journal with an
ephemeral PostgreSQL database and ephemeral synthetic signing material. CI
fetches only pinned source; it does not merge or deploy Runtime. See the Cloud
alignment review for exact reference-loader, global lock-order, scanner trust
and release gates.

## Complete-plan assembly (PR303 cd6f6cf)

Use `integrateRuntimeCustody` with Runtime's actual `lockCustodyPlan`,
`canonicalCloudReferences` and journal, the authenticated API context, and the
canonical writer assignment discovery callback. `prepareTransaction` is required
and runs before admission or domain row locks on every boundary path. Discovery
is not authorization; any identity/assignment change after gates aborts.
Production assembly must never use the no-op preparation in the isolated legacy
fixtures. Both combined Runtime suites exercise the real preparation and loader.

Runtime's reference schema follows both base schemas. All live revokers must
participate in the complete gate protocol, including devices through actor
gates. See `docs/sandy-cloud/runtime-combined-acceptance-20261024.md` for
evidence and `docs/sandy-cloud/minimal-activation-proposal-20261024.md` for the
single finite activation dependency list. The packaged bundle remains
non-installable source.

The admission result must include the immutable canonical `admissionId` and
minimum authority `expiresAt`. The boundary independently locks/caps against the
actual API admission's database expiry. Projection must return the locked
writer's `expiresAt`; missing deadlines fail closed. Final settlement uses
database time to enforce intent, scan, authority and writer deadlines, and rolls
back all effects on expiry. Installation callbacks returning the old void
projection result must be updated before any activation.
