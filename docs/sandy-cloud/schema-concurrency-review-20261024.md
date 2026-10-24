# Candidate schema and concurrency review

Source-only Cloud review, consuming Runtime PR303 `ab2cfa4`'s actual
`lockCanonicalScope` and `ArtifactJournal.verifyScanInTransaction`. This review
installs nothing in Supabase. No production trust, role, mapping or paid resource
is created. Earlier PGlite evidence is retained and is not relabelled as this test.

## Real PostgreSQL evidence

The new `postgres/verify_multisession.mts` ran against PostgreSQL 17.6 in a fresh,
disposable localhost-only container, using node-postgres 8.16.3 and three distinct
backend PIDs. The runner accepts a local port only, hardcodes the synthetic DB
name and refuses a pre-existing canonical table. It cannot accept a production
DSN. CI repeats it with an image pinned to manifest
`sha256:00bc86618629af00d2937fdc5a5d63db3ff8450acf52f0636ec813c7f4902929`.

Eight scenarios passed. Barriers pause transactions at specified points and
`pg_blocking_pids` confirms actual lock waits before release; this is not a
Promise-only serialized embedded engine or timing-based concurrency assertion:

1. Two complete upload commits race. The second waits on canonical locks, then
   reads the first receipt; version/scan reference/quota/outbox settle once.
2. The first transaction rolls back after writing a projection; a blocked duplicate
   resumes and commits once without a leftover version or consumed reservation.
3. Current-authority revocation waits behind an admitted commit, then blocks replay.
4. Revocation acquires authority locks first; the waiting commit is denied with no
   version, scan reference, usage event, outbox or receipt.
5. The Runtime file SHARE lock upgrades to UPDATE only after an independent reader
   releases its lock; projection and commit then complete correctly.
6. Terminating the test backend before COMMIT rolls back all effects and releases
   locks. A subsequent admitted commit succeeds. Only the exact test PID in the
   synthetic database/application is eligible for termination.
7. Forced RLS denies reads/inserts despite accidental default grants and denies
   reads to a non-BYPASSRLS table owner. Private function execution remains denied.
8. Scanner withdrawal waits behind Runtime's SHARE lock, then prevents the next
   Cloud commit. Cloud consumes zero repository claims throughout.

Synthetic authority rows and ephemeral scanner signatures are test inputs only.
These results establish source behavior with cooperative writers following the
Runtime protocol. They do not prove that real session/company/device revokers,
scanner workloads or current production roles participate in that protocol.

## Schema findings

- Cloud owns namespace/version/usage/outbox metadata and immutable shared receipt
  references. Runtime owns signed receipts, scanner releases and claim state.
  There is no second Cloud clean-verdict authority in the candidate schema.
- Composite workspace/file/version keys prevent cross-namespace current-version
  references. Unique intent/idempotency and version/usage/receipt keys prevent
  duplicate settlement. Immutable triggers reject historical updates/deletes.
- Candidate Cloud tables, including the projection audit extension, enable and
  force RLS with no permissive policies. No roles, policy grants, SECURITY DEFINER
  entrypoint or public schema exposure is introduced. This intentionally does not
  provide a deployable application role; production rights remain a separate diff.
- The real test deliberately supplies accidental default table grants before
  creating the candidate schema. Forced RLS still denies the non-bypass role.
  A superuser/BYPASSRLS role remains trusted administrative authority; RLS is not
  claimed to constrain it. The test's own administrator and fixture roles are not
  proposed production identities.
- No down migration is provided. Shared receipt retention and optional cross-schema
  foreign-key installation need a joint Runtime/Cloud plan before activation. The
  current source references a validated immutable shared receipt ID; it does not
  establish a provider retention guarantee or authorize scanner trust insertion.
- Lock ordering must be adopted by every real revoker: canonical scope locks before
  relation/session rechecks and Cloud workspace/intent/head, then the documented
  receipt/scanner/file locks. A writer holding a file lock and subsequently asking
  for canonical scope in the opposite order is NOT covered by these passing tests.
  Inventory/reconcile those writers before release; use finite lock/statement
  timeouts and rollback, never automatic retry after ambiguous COMMIT.

## Review disposition

The candidate is coherent for isolated source testing and its default-deny posture
is verified on actual PostgreSQL. It is **not approved for live installation**.
Remaining gates: actual canonical relation/reference loader, complete production
revocation-writer adoption, exact scoped role/RLS execution path, scanner and
provider-generation identity, retention/reference integrity, and protected rollout.
Full SC-01–14 scope and mandatory live/device acceptance remain open.
