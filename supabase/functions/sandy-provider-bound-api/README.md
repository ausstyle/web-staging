# Fixed-resource relationship adapters

This backend implements48 remaining pinned REST methods whose nonstandard
resource names or relationship proofs did not fit the original generic executor.
It preserves the applied provider/08400/08500 source and registers only closed,
unverified, normal-owner-session and approval-required contracts.

The methods cover16 Storage,15 hierarchical firewall-policy,8 Supabase branch,
3 Artifact Registry prewarm,4 BackupDR,1 log sink update and1 snapshot list action.
The other16 original binding-inventory methods are org/user package variants of
8 existing fixed-repository package handlers; those are mapped without duplicated
execution. See `docs/sandy-api/provider-binding-coverage.json` for every method.

Storage actions prove all distinct path/body buckets belong to the fixed project
before writing; copies/rewrites/moves require source and destination generation
preconditions. Soft-deleted bucket restore proves exact generation with the
documented metadata read. Bucket/object updates require preconditions. Bucket
names, object paths, references and body fields are bounded; read-only provider
fields and arbitrary callback URLs cannot be supplied through request DTOs.

Hierarchical firewall actions require verified server organization/folder bindings,
fresh parent proof for existing policies, a separate proof for clone sources and
bound association targets. Moves require a verified destination-folder binding.
List requests force their parent/target and validate returned parents. These are
fresh observations, not atomic provider compare-and-swap guarantees. Provider IAM
and resource fixtures must still establish the intended production boundary.

Branches first prove ID/ref membership under the fixed parent project and refuse
the primary project as a branch. Config metadata explicitly omits `db_pass`,
`db_user` and `jwt_secret`; textual SQL diff bytes remain private in short-lived
encrypted custody. There is no public diff payload retrieval. Notification targets
need a separate reviewed server binding and are not accepted as caller URLs.

Artifact and backup paths use fixed project/region plus fresh repository/data-source
reads; secondary artifact references stay inside the exact repository. Log sinks
prove their project and destination ownership (GCS, Pub/Sub, BigQuery or Logging),
require explicit update masks and refuse cross-project writer identities. Reads
return only published bounded metadata; writes return provider acceptance without
claiming the eventual effect. Arrays are limited to100 with explicit truncation
signals. The two pageable lists use operation/actor/scope/normalized-input-bound,
one-use opaque cursors rather than returning raw provider tokens.

08600 extends only the reviewed private context/consumer handler allowlists and
the three exact custody URL paths. It retains Vault ACLs, TTL/quotas, registry
revision and actor/input/scope bindings. It also makes NULL handler refusal explicit;
the production registry already enforces NOT NULL. Existing registry rows, grants,
customer sessions and credential activation are untouched. Unknown provider effects
or missing final receipts require reconciliation and are never automatically retried.

The source supports these bounded typed transports and relationship guards.
This does not imply full lifecycle completion, unrestricted provider payloads,
provider IAM, verified configuration, real Controller sessions or live Edge egress.
No source fixture is provider or Auth evidence. Irreversible retention locks and
other writes remain disabled/unverified and require their own exact authorization.

Generate source metadata without applying SQL:

```sh
PYTHONDONTWRITEBYTECODE=1 python scripts/sandy/build_provider_bound.py --schemas /workspace/sandy-api-deliverables/provider-schemas
DENO_DIR=/workspace/.cloud-setup/deno-cache /workspace/.cloud-setup/toolchain/node_modules/.bin/deno run --allow-read --allow-write scripts/sandy/build_provider_bound_metadata.ts
```

The48-method dispatch/security tests and localhost HTTP memory sweep use synthetic
providers, owner/grant callbacks and dummy material only. Real PostgreSQL/Vault
invariant tests end in fullROLLBACK, create no Auth session/real approval and do not
resolve, activate or rotate an actual credential. The canonical gateway integration
is separate and must use compact `boundOperations`/`boundExecutionScope` descriptors.

`scripts/sandy/provider_bound_readonly_check.ts` separately performs only the fixed
parent project's real branch-list preflight with the Management credential and
synthetic policy callbacks. The current project returned HTTP200 with zero branches;
the handler refused the missing branch before any branch operation. This confirms
the read-only component and refusal, without verifying Controller authentication,
real approval, a branch lifecycle, or Edge runtime egress.
