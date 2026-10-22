# Dedicated provider filtering and media

This additive executor implements28 pinned provider methods that need filters,
multipart, binary/no-body handling, or private response custody. Its registry
rows are all closed, unverified, owner-session-only and approval-required. It
does not alter the1738-provider catalogue or the current canonical gateway. A
later reviewed gateway integration must use compact `supplementOperations` and
`supplementExecutionScope`, and let this backend consume/finish the exact grant.

Five searches/lists filter exact fixed-project or verified organization/folder/
billing identities. Foreign resources and raw provider cursors never appear in
results. Private cursors bind actor, operation, current registry revision,
scope, normalized pagination inputs and exact provider URL; each cursor is
consumed once. Project-list requests also prove the current direct parent before
scanning.

Multipart function deploy accepts at most32 safe relative files/1MiB total and
requires SHA256 for each file, an included entrypoint/import map and JWT
verification enabled. Metadata/version readback is required. Deployment
acceptance does not prove the resulting source bundle hash or function behavior.
Storage media uploads prove bucket ownership and require generation
preconditions. Artifact uploads/export return acceptance/LRO metadata only;
provider response SHA256 is not a target payload hash. No write is automatically
retried after an uncertain effect.

Direct function body, Artifact Registry file and undocumented effective-policy
responses are captured as bounded bytes in encrypted private Vault custody.
Public results contain only opaque ID, SHA256, length/type and expiry. The
Compute method has no response schema in pinned discovery; typed
effective-policy interpretation remains missing. Five GitHub download paths can
capture direct200 responses or privately initiate documented302 downloads, but
do not follow signed URLs: an exact documented provider-storage host policy is
still required. Those five paths are partial for redirected payload transfer. No
raw content, signed URL, credential or provider error body is a result. Captured
artifacts currently have no public content retrieval API; capture is not
user-visible source/export delivery.

Vault-backed handles require a consumed exact admission, current enabled owner,
approval reference, current verified registry contract and no tenant/delegated
key. Artifacts expire after10minutes; cursors/redirects after5minutes. Runtime
storage quotas are32 active items per actor and64MiB total. Every save performs
bounded cleanup. If pg_cron is installed, a new independent minute cleanup job
deletes expired/consumed records and their Vault secrets; existing jobs are
untouched. Expiry always denies access even if scheduler cleanup is delayed.

Generate deterministic reviewed metadata (does not apply SQL):

```sh
DENO_DIR=/workspace/.cloud-setup/deno-cache /workspace/.cloud-setup/toolchain/node_modules/.bin/deno run --allow-read --allow-write scripts/sandy/build_provider_supplement.ts
```

`index_test.ts` uses synthetic transport/context fixtures only.
`custody_test.sql` uses dummy noncredential Vault payloads and administrative
synthetic rows, ending in fullROLLBACK. Neither is customer-session, real
approval or provider attestation. See
`docs/sandy-api/provider-supplement-coverage.json` for per-method limits.
