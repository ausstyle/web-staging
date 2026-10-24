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

## Usable local Drive and recovery fixture

The continuation adds a durable SQLite reference adapter (`domain.ts`,
`schema.sql`), fixed operation schemas (`contracts.ts`), an authenticated
fixture HTTP boundary (`api.ts`) and a browser Drive (`drive.html`). It is a
local test application, not a deployable customer endpoint or production schema
migration. All synthetic accounts are deliberately available on the loopback
demo. Do not proxy it, bind it to a public interface, load real customer records
or replace production Sandy identity with its fixture issuer.

Run with the repository Deno version:

```
deno run --allow-read=packages/sandy-cloud,/tmp --allow-write=/tmp --allow-net=127.0.0.1:8787 packages/sandy-cloud/fixture_server.ts --fixture-mode --data=/tmp/sandy-cloud-demo --port=8787
```

Open `http://127.0.0.1:8787`. Upload the supplied synthetic text, create
folders, edit versions, download, rename/move/trash, record a recovery point and
restore into a new folder. Switch to Bob to inspect the separate tenant, or
Reader to verify writes fail. Index plain text only after explicit workspace
consent; lexical results cite the exact current version. This is not semantic AI
search. Share tokens are one-time returned, hash-only stored and
recipient/expiry/epoch bound; a lost share response requires revoke/recreate,
never plaintext recovery.

`sync.ts` performs selective folder-tree reconciliation with an AES-GCM journal,
revision conflicts, conditional deletions and retained local deletion copies. It
handles file rename/move across folders. Empty directory lifecycle, native
watchers, placeholders, native Keychain/Credential Manager storage, filesystem
ACLs and signed Mac/Windows packages are not implemented or certified. It is
currently a Linux fixture engine, not a supported desktop release. Its transport
must recheck the device on every call. The native client must also acquire a
single-instance journal lock and use OS directory-relative safe handles before
production use; these synthetic tests run each client sequentially.

`backup.ts` captures a separately selected protected folder into immutable local
backup objects and manifests, without creating Drive nodes. Repeating a run key
is idempotent; changing source bytes fails the recovery point. Local SQLite
triggers prevent ordinary deletion/update of backup records, but local disk
administrators can modify files: this is **not provider-enforced retention**.
`restore_local.ts` writes to a new clean directory and then independently
reopens and hashes its actual files. It refuses existing targets and does not
label a failed restore complete. Native consistent snapshots and the cloud
recovery vault remain external integration/acceptance work.

The fixture bounds each file and each backup/restore cohort to 64 MiB. Large GCS
resumable transfer, streaming object assembly, real malware scanning, 10 GB
tests, production PostgreSQL mapping, invoice reconciliation, semantic models
and OS support remain pending; do not lift the cap to claim those are
implemented.

Run all local suites and real Chromium acceptance:

```
deno test --allow-read=packages/sandy-cloud,/tmp --allow-write=/tmp packages/sandy-cloud/
python3 packages/sandy-cloud/run_browser_test.py
```

Browser tests require Playwright 1.62.0 and Chromium. The runner starts its own
synthetic server, stops it afterward, and removes only its newly created
temporary data directory. Results/screenshot are written to
`/tmp/sandy-cloud-evidence`.
