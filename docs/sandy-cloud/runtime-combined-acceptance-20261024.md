# Cloud and Runtime complete-plan composition

Source acceptance only; no live schema, trust entry, revoker or provider changed.
This supersedes the missing-reference-loader and incomplete-lock-plan findings
in `runtime-scan-alignment-20261024.md`. Runtime source is pinned to PR303 commit
`cd6f6cf659e924bd0c9090445a7794ae122746ab`; its source remains separately owned.

## Delivered integration

`postgres/runtime_integration.ts` composes Runtime's `lockCustodyPlan`,
`canonicalCloudReferences` and journal with Cloud's admission/projection hooks.
`ProductionOwners.prepareTransaction` now runs before authority and domain row
locks, including receipt lookup. Non-authorizing discovery obtains the exact
customer, reference, scanner and writer assignment; the complete Runtime plan is
acquired, then discovery is repeated. Any change aborts, without extending locks
or retrying an uncertain transaction. The authenticated admission must match the
canonical reference. A missing writer assignment fails before authorization.
No tenant/customer equivalence, fixture identity, new lock algorithm or duplicate
custody authority is introduced.

The plan includes actor, session, optional company, tenant, customer, admission,
workspace, intent, file, artifact, receipt, scanner release and writer assignment.
Device revocation must use the existing actor gate; reassignment must hold both
old and new actor gates. This is a live participation requirement, not a claim
that current revokers already implement it. Writer reassignment holds file and
both assignment gates before its row changes. Runtime rejects late plan expansion.

The tests now persist references through Runtime's actual `recordCloudReference`
and read them through its actual loader; the former in-memory reference callback
is removed from both combined integration suites. Runtime imports Cloud's digest
from the tested Cloud source. CI extracts only pinned Runtime source, never
installs it or activates its schema.

## Local evidence

- 52 Deno product/integrity tests passed.
- 13 isolated transaction tests and 8 API hook/canonical projection tests passed.
  Their synthetic scan/authority fixtures are deliberately not production bindings.
- 8 combined Runtime/Cloud embedded PostgreSQL cases passed: full commit and
  shared reference, rollback, missing writer, wrong admission, missing scanner,
  final expiry rollback, lost acknowledgement reconciliation, scanner withdrawal.
- 9 PostgreSQL 17.6 multi-session cases passed using three distinct backend PIDs:
  duplicate commit, rollback/waiter, session revocation after commit, actor/device
  revocation before commit, file reader/writer contention, backend termination,
  FORCE RLS under accidental grants/non-bypass ownership, writer reassignment
  during discovery, and scanner withdrawal using the common scanner gate.
  Blocking cases assert actual `pg_blocking_pids`; writer reassignment asserts
  refusal before projection and zero version/usage/outbox/receipt effects.
- Only a fresh localhost `sandy_cloud_fixture` database was used. The temporary
  PostgreSQL container was removed after testing; no persistent volume or user
  data was involved. Signing keys were ephemeral test fixtures.

These checks do not independently accept live canonical relations, deployed
revoker participation, storage throughput, native client signing, recovery SLOs
or the full SANDY-ENG-0012 acceptance criteria. No Runtime acquire/seal milestone
was repeated. Cloud stores a shared scan reference; it does not acquire a second
repository claim or manufacture a seal.

The single remaining activation dependency list is
`minimal-activation-proposal-20261024.md`. Prior handoff documents describe source
history, not additional undefined interfaces to be invented.
