# Cloud / Runtime shared scan alignment

Reviewed Runtime PR303 `ab2cfa4fb29fc5ba72a72fb77c0665fd1181ae55`, superseding the
initial review of `996e510`. Also read API review
`595cf77ca6ca4e25739898c49f63a409acb37a88`. Source integration only: no trust key,
role, customer relation, resource, credential or production route is activated.
Runtime's mutation milestone and event250 cleanup were not repeated.

## Compatibility and implemented Cloud changes

The updated Runtime method `verifyScanInTransaction(tx, binding, receiptId)` returns
exactly the structured record/customer/tenant/authorityRevision needed by Cloud.
It checks canonical admission, signature, scanner-release trust and file ownership
on the supplied transaction. Cloud's adapter consumes that method directly and
never calls Runtime acquire/seal or starts a second transaction inside validation.
The repository artifact claim and Cloud version commit remain different effects.

`PostgresCommitBoundary` now REQUIRES a `ScanCommitOwner`. The candidate production
schema no longer defines Cloud's former clean-verdict table; old clean rows cannot
authorize a commit. Only immutable `version_scans` references/evidence are written
alongside the version, projection, quota, outbox and durable receipt. Runtime owns
signed receipts, scanner trust and revocation. The existing old-schema fixture is
isolated in `fixture_scan.mts`, excluded from the release package, solely to retain
prior transaction tests; it is not a production fallback.

`sharedScanOwner` validates receipt/artifact/file/admission/actor/customer, explicit
API tenant, generation, size/digest, issuer/release/trust revision, canonical
revision and expiry. Its domain-separated `sandy.cloud.scan.v1` binding also covers
the complete immutable upload intent (including bucket/key/workspace), canonical
file/customer/policy epoch and exact admission/contract/input/scope digests. A
server-owned reference loader must supply this binding; no caller JSON or inferred
UUID equality is accepted. The operation/contract digest is supplied by the
canonical installation owner; the synthetic test operation is not registered.

The final intent settlement condition rechecks database time against both scan and
intent expiry. A late expiration rolls back projection, version, usage, scan
reference, outbox and receipt. Lost commit acknowledgement follows the existing
authorized durable-receipt readback without re-verifying a historical scan or
publishing again. New commits still require current shared validation. Runtime's
status-only post-expiry reconciliation is not used to obtain handles or authorize
Cloud writes.

## Actual pinned-source composition evidence

Six embedded PostgreSQL scenarios execute Runtime's unmodified `ab2cfa4` journal,
attestation verifier and candidate schema with Cloud's real adapter and boundary:

- Signed scan verification uses exactly the caller's transaction (no nesting).
- One committed version stores the shared receipt reference; Runtime claims remain
  zero and its receipt count remains one. Cloud has no scan-verdict table.
- Projection failure rolls back Cloud effects while preserving Runtime's receipt.
- Missing shared owner fails closed.
- Expiry during projection rolls back all effects at final settlement.
- Lost acknowledgement reconciles once, and scanner withdrawal after preflight
  blocks the subsequent commit.

The first two bullets share one scenario. An ephemeral Ed25519 pair and scanner
row exist only inside that isolated process/database and are discarded on close;
no production key or trust catalogue is touched. Four additional Deno contract
scenarios cover binding substitutions, clock/expiry and scanner/identity denial.
Existing 13 transaction and eight canonical-binding scenarios remain regression
evidence. These are PGlite single-connection checks, NOT real multi-session lock,
scanner service, provider generation, tenant deployment or production acceptance.

## Precise remaining work / ownership

1. **Runtime:** all five previously identified source gaps are fixed at `ab2cfa4`:
   canonical authority returned with claim, floored integer lease expiry, supplied
   transaction validation, invalid-clock denial, and independently authorized
   status-only recovery. No duplicate implementation is requested from Cloud.
2. **Cloud + canonical admission owner:** implement the actual reference-loader
   binding in existing server-side transfer/admission custody using the documented
   Cloud digest. The same binding must be signed at scanner ingress. No existing
   live row/relation is claimed to implement this yet. Review the exact canonical
   upload operation and contract hash; do not register the fixture label.
3. **Runtime + identity/file owners:** adopt one complete lock order across
   canonical admission/relation/session revokers, Cloud workspace/intent/head,
   scan receipt/scanner release, writer assignment and universal file. Runtime
   takes `FOR SHARE` on the file during scan; projection later takes `FOR UPDATE`.
   Real multi-connection tests must cover this upgrade, concurrent duplicate
   uploads, scanner withdrawal, company/session revocation and deadlock rollback.
   Same-connection assertions do not establish participation by live revokers.
4. **Runtime + scanner owner:** identify the real scanner catalogue/release,
   authenticated signed receipt ingress and exact-generation reader. New trust
   activation needs exact reviewed authority; fixture keys are not reusable.
5. **Database/release owners:** jointly review schema order, shared receipt
   retention/reference integrity, exact RLS/role and pinned transaction adapter.
   The old Cloud candidate schema was never installed, so this is source
   replacement, not permission to drop any live table. If any downstream install
   occurred elsewhere, inventory it and prepare an additive migration instead.
6. **Release path:** dependent PR272 and PR303 remain source dependencies. Do not
   merge into their owner branches or bypass a denied ready transition. Rebase onto
   accepted main and use the protected release path after dependencies resolve.
   Provider resources and credentials remain unapproved; full scope is open.
