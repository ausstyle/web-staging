# API family 117/118 implementation batch

Scope: SANDY-ENG-0005, existing 161-family programme. Source and isolated tests only; this batch neither deploys functions/migrations nor changes exposure, credentials, grants, Owner gates or family acceptance. PR282 owns the canonical 117/118 mapping review; this batch does not overwrite it.

## Immutable tree settlement (118)

The existing provider mutation executor now recognizes `github.git.trees.create` for immutable readback. It makes the existing authorized POST once, then reads the resulting SHA and optional base SHA through the existing bounded GitHub reader. Every recursive directory and root hash is independently recomputed using Git object framing and byte ordering. The resulting leaf map must equal the verified base plus exactly the requested patches. Proof binds the admitted input digest, repository, base and resulting SHA. Failed readback or settlement retains the accepted/unverified outcome; it never retries the POST.

Bounds: 128 patches, 100000-byte body, 65536 inline UTF-8 bytes, 1024 recursive entries and 2 MiB per read. Nested leaf additions, replacements/deletions, executable files, symlinks and submodule leaves are supported. Truncated trees, explicit subtree replacements, empty subtrees, conflicting parent/child patches and malformed paths remain unverified. This is deliberately incomplete family coverage, not a widened request contract.

Migration `20261024013000_sandy_github_tree_settlement.sql` requires the exact post-blob verifier definition SHA256 `fd417b32d9ae916cd5b6d7bc2aaa0f38e819a95ed46087e4589ac8d3a5bcc2f7`. The predecessor is the source-only PR251 blob migration. Existing ACLs, current Owner/policy checks, actor/tenant/credential binding, job authority, input digest, duplicate reuse and transactional audit remain enforced. Drift aborts installation. No live migration was attempted. A future reviewed release must capture the actual function preimage and rollback bytes; this source batch is not an executable production release approval.

## Binary custody candidate (117)

`sandy_repository_artifact_custody.ts` is not imported by a gateway. `repositoryText` remains unchanged and rejects binary content. The module streams at most 8 MiB in chunks at most 1 MiB into private staging, checks exact generation/length/SHA256 and scanner binding, and rechecks current authority immediately before sealing. Context binds actor, admission, operation, repository, engineering branch, path and input/contract/scope hashes. It returns only a private execution-bound handle and digest proof. An ambiguous seal preserves evidence and returns `REPOSITORY_ARTIFACT_COMMIT_UNKNOWN`; it cannot automatically discard or replay the seal.

Runtime/private-artifact owner must implement `ArtifactCustodyOwner` against existing infrastructure:

- `withClaim`: load canonical admission/identity/target, apply current repository/protected-source policy, and hold a durable single-use claim/lease. Caller assertions cannot authorize this interface. Duplicates/revocation/expiry reject; uncertain seals remain reconcilable.
- `verifyScan` / `openGeneration`: validate a trusted current scanner receipt bound to immutable bytes, then open exactly the stored artifact generation. No caller URL or new credential channel.
- `stage`: private append-only staging; `seal` atomically consumes the claim and records the proof/private handle. No publication to GitHub in this interface.
- `revalidate`: current authority, scanner validity and lease at sealing. Integrator must coordinate revocation and sealing transactionally; a cached boolean is insufficient.

API still needs a separately reviewed artifact-reference input contract and canonical provider consumption path after these real owner bindings exist. No new queue, storage system, production worker or gateway is introduced. Activation, any new permissions and provider lifecycle acceptance remain separate exact decisions.

## Verification evidence

Six tree tests compare hashes against an independent local Git CLI oracle (`hash-object`, `mktree`, `ls-tree`), including Unicode ordering, base preservation, deletion and corruption. Eight binary tests cover a 2 MiB+3 artifact, text-guard preservation, duplicate/foreign context, scan rejection, corrupt/short/oversized streams, cancellation, revocation/expiry, generation swaps and uncertain seals. Forty-seven provider tests include the one-POST tree execution/failed-settlement case. Twenty-six isolated PostgreSQL checks cover actual predecessor installation, ACL preservation, scope/input/state rejection, duplicate proof reuse, audit-failure rollback and drift rejection. PGlite lacks pgcrypto; the fixture uses PostgreSQL SHA256 and fixed Node SHA1 vectors, not a claim of live pgcrypto or concurrent production testing.

No new live provider receipt, family acceptance or deployed revision is claimed. PR270/271 ready/merge requests remain pending after the recorded denials; this batch does not retry them.
