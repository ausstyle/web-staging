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
