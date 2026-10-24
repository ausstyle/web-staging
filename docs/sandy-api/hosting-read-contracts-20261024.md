# Hosting read contracts — bounded source proposal

This API-owned slice supports Hosting's existing europe-west8 scope without competing with PR238/250. It implements no DNS retry, provider provisioning, permission change, live configuration change or exposure promotion.

## Actual baseline

Read-only registry reconciliation confirms `gcp.cloud_run.services.list` and `.get` are exposed but unverified, handled by `sandy-provider-operation-api`. Their current contract hashes are respectively `ad8434eb282fa18f82550223acd62a633daad0072af1dd8a5d10a79232dbe7a2` and `29606689e560dd6bf4e6b2fb056686de44497fa61778a394074d9d25b26a5f39`. The v31 provider fixes list parent to `projects/elaborate-haven-511518-a5/locations/europe-west1` and rejects resource references in europe-west8. This is a contract/binding limitation, not evidence of provider IAM failure in europe-west8.

`gcp.storage.buckets.list` already has a typed GET adapter with fixed project query, bounded projection and pagination contract. Its registry API and MCP flags are both false, verification false, contract `19c45b9d013f0f14493c87444ade60512c3634ae4d18c03d4d6c2c40cff9795f`. No live Storage listing was attempted. A source test proves request binding with a fixture; it cannot prove live reachability or provider outcome.

## Candidate behavior

Only `gcp.cloud_run.services.list/get` gain the optional additional read region. List accepts `{"region":"europe-west8","query":{"pageSize":1}}`; get uses `{"path":{"name":"projects/elaborate-haven-511518-a5/locations/europe-west8/services/<existing-service>"}}`. Existing list requests default to europe-west1. Cloud Run writes, jobs and other regional providers keep their existing boundaries.

The extra region requires a server-side `cloud_run_read_region` entry in the existing `SANDY_GCP_SCOPE_BINDINGS_JSON` configuration in both gateway and provider executor. The entry must bind id `europe-west8`, project `elaborate-haven-511518-a5`, verified status and a valid `expires_at` no more than 24 hours ahead. Request JSON cannot supply or replace this binding. The selected region and binding expiry enter the exact execution-scope digest; ordinary policy, grant, contract and provider identity checks remain mandatory. This configuration entry is **not installed** by the candidate.

Expiry is checked before admission and again immediately before provider dispatch after credential acquisition. A removed/expired binding fails without dispatch. An expired optional regional entry is omitted without disabling other existing configured scopes. Foreign projects, wildcard regions, other regions, invalid encodings and traversal remain refused.

The guarded migration revises exactly the two existing input/contract records, refusing unexpected prior hashes or handlers. It preserves all exposure, verification, permission and historical evidence fields. Generated gateway fingerprints and provider catalogue packaging change with those exact contracts. Existing evidence for older hashes remains historical and cannot prove the new contract. No new operation is registered.

## Consolidated activation boundary for the parent

Routine source implementation, tests and PR work proceeds under existing authorization. Do not ask for broad reconfirmation. Include the following specific effects in the coordinated setup-mode decision only if existing applicable protected authority does not cover them:

1. Exact source-linked provider/gateway rollout and the two-row contract migration, with current module reconciliation, preserved JWT, rollback bytes and shared-component coordination. Prior PR222/246/251 manifests do not cover these new contracts.
2. Install only the additional expiring Cloud Run **read** binding above in both existing configurations, merging with and preserving their current entries. Scope is the fixed project and europe-west8 services list/get, not writes or all regions. Remove only this entry on expiry/withdrawal. No new provider credential or IAM is necessary for this proposal; actual provider rights remain unproven.
3. Separately, if Hosting needs Storage inventory, review exposure of only existing `gcp.storage.buckets.list` for bounded fixed-project reads, with verification left false until actual normal-path evidence. This patch deliberately includes no exposure update. An Owner session alone does not bypass closed exposure.

No broad grant, new credential, IAM/security policy change, bucket creation, Cloud Run service creation/update, paid commitment or customer traffic change is included. If a future live provider request is denied, preserve that refusal and report the exact missing entitlement instead of changing identity or scope. Before activation, supply an exact immutable artifact manifest and check that shared baselines have not advanced; configuration and deployment are not implied by a source merge.

Validation: 46 provider-handler tests, 335 gateway tests, three focused compiler tests and six isolated PostgreSQL migration checks. Tests cover scope digest agreement, default preservation, missing/expired/malformed bindings, caller-forged configuration, foreign/wildcard targets, expiry between token acquisition and dispatch, Storage project binding, migration rollback on baseline mismatch, and untouched flags/evidence. These are source validations, not live europe-west8 or Storage acceptance.

## Source-preserving artifact preparation

The deployed gateway v61 entry contains Runtime's compiled memory-certification hook and differs from the repository entry. Do not upload the repository gateway entry wholesale. `scripts/sandy/prepare_hosting_read_release.py` is a read-only preparer pinned to source `4be0ba5950d110d6cb0bbd8434f9ddbf63e7b3b3`, provider v31 and gateway v61, and their exact captured bundle hashes. It applies exactly three reversible argument-flow edits to the deployed gateway entry and preserves every other byte there. All unnamed modules remain byte-identical. Five guard tests cover changed/duplicated snippets, repeated patching, missing modules, wrong targets, changed versions, JWT and bundle mismatch.

The prepared manifest is `92f42f3c88c81f16f89698976152def247da4bab99bedbd281940c82628aea42`. Provider changes are its entry, packaged catalogue, compact manifest, scope/config helpers and one new regional helper; gateway changes are the minimal entry patch, compact manifest, scope/config helpers and that new helper. All prior modules and both full rollback bundles are captured privately. An offline import check loads both exact prepared graphs, compiles all 595 contracts and confirms regional binding behavior with zero provider/database requests.

Preparation does not deploy, install configuration, alter exposure or create an approval. It includes PR246's provider failure-reporting repair and intentionally preserves deployed blob semantics; PR251 blob settlement remains a separate candidate. Therefore no blob migration is included in this regional artifact. If either live baseline changes, reconcile and prepare a new exact artifact rather than forcing this one through. Recreate private artifacts using the pinned preparer when moving execution environments; local file paths alone are not durable deployment evidence. Persist full recovery bytes through the existing protected release process before any dispatch.
