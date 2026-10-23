# Sandy Cloud integrity and recovery module

Scope: SANDY-ENG-0012, partial SC-02/SC-06/SC-12. This is executable source,
**not a deployed Drive service, sync client or backup product**.

`integrity.ts` streams independent object readback through SHA-256, enforces
exact generation/length and tenant/workspace/bucket binding, and coordinates
upload completion with a durable transaction boundary. It reauthorizes after
long reads, requires a generation-bound scanner result, reads the durable
receipt after commit and returns UNKNOWN_OUTCOME when commit success cannot be
established. It never automatically replays an uncertain write. `restore.ts`
rejects portable path conflicts/traversal and compares the independent target
tree and byte hashes with an admitted snapshot manifest. No original customer
data is read or modified.

## Integration prerequisites

- The caller is an allowlisted Sandy API handler, with server-derived identity,
  canonical contract validation, trace and idempotency admission. These
  functions are not an alternative authentication boundary or public endpoint.
- Object references come from canonical upload/version records, never directly
  from browser input. `open` uses the existing provider adapter, checks the
  actual response generation, returns raw untransformed bytes, bounds chunks,
  supports cancellation and uses a caller deadline. Provider metadata hashes
  alone do not count as independent readback. Do not put provider tokens in
  manifests.
- Implement `CommitBoundary` against the store selected by SC-ADR-01. All
  tenant, actor, device, policy epoch, expiry, revision, quota and scanner
  checks must be enforced again atomically in its commit transaction. Version,
  receipt, outbox and usage event commit together. Enforce idempotency input
  equality, unique versions and lease fencing in that store. An in-memory test
  boundary is not a persistence implementation. Resolve UNKNOWN_OUTCOME by
  canonical intent ID.
- Production restore requires a verified immutable snapshot manifest and a
  native no-follow/directory-relative target reader. The target must be
  quiescent while verified. Path validation is deliberately conservative; it
  does not establish native filesystem security, OS snapshot consistency or
  signed-client support. Permission revocation and clean-target ownership stay
  enforced by the native caller. Never use source bytes as restored-target
  evidence.
- Neither byte verification nor a committed version proves backup retention,
  independent recoverability, malware safety or overall product acceptance.

No runtime dependencies are downloaded; the module uses Deno's Node crypto
compatibility. CI pins Deno 2.9.6, matching the existing repository toolchain.

```
deno fmt --check packages/sandy-cloud
deno check packages/sandy-cloud/integrity.ts packages/sandy-cloud/restore.ts
deno test packages/sandy-cloud/integrity_test.ts
deno test --allow-read=/tmp --allow-write=/tmp packages/sandy-cloud/restore_disk_test.ts
```

The disk test creates and removes only its own synthetic 32 MiB temporary tree.
It independently reopens bytes and detects corruption and unexpected files. It
is Linux filesystem integration evidence, not AC-08 provider acceptance.
