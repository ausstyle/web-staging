# Family closure assessment — current scope, not operation counters

SANDY-ENG-0005 continuation. The current registry and contract-matched operation classes were read without mutation, together with standing delegation v6 (unrevoked, expires 21 November 2026). No accepted positive was rerun. PR270 and PR271 transition denials remain paused. No new exposure, grant, identity or provider execution was introduced.

**No family is currently demonstrated ready for whole-family acceptance under the verified evidence and current delegation.** This is not a claim that every remaining provider call is blocked or that all 161 families need new permission. Most remaining work is canonical scope review, software or lifecycle evidence. Do not ask for blanket exposure or permission expansion.

## Exhaustive primary dependency groups

[The machine-readable matrix](family-closure-blockers-20261024.json) contains every family exactly once in a primary group, with its exact current operation dispositions and secondary gaps retained. The groups below are disjoint and total 161. Counts describe work, not accepted operations.

| Primary dependency | Families | Next responsible action |
| --- | ---: | --- |
| API constituent/alias review | 97 | API resolves canonical scope and implementation before any permission proposal. Closed candidate aliases are not proof of required new exposure. |
| Reviewed constituents needing implementation/activation and full evidence | 29 | API and resource owner establish exact target, software readiness and all lifecycle cases; includes missing project list/create and general function-invoke contracts (76/83). Not a blanket approval request. |
| Runtime-owned guest/native execution | 6: 35–40 | Existing Runtime supplies fixture and execution evidence; do not duplicate its workers or infrastructure mutations. |
| Tenant fixture and product contract review | 19: 143–161 | Product owner identifies real synthetic/consented tenant fixtures and canonical identity mapping. No fabricated identities or consent. |
| Regional compute reads closed | 1: 34 | Two exact regional constituents still need reviewed exposure and a verified existing DONE operation target. |
| Existing provider refusal | 1: 72 | Existing security/resource owner diagnoses SCC entitlement; retain HTTP403. No retry, identity substitution or IAM change. |
| Explicit workload scope denial | 2: 75/86 | Existing Controller Owner decision for the exact reads below; retain denials and do not rerun them under this delegation. |
| Narrow legacy fixture only | 2: 85/110 | Shared log-query implementation needs a bounded general query/privacy contract and broader lifecycle evidence. Reuse existing fixture evidence. |
| Existing App authentication unavailable | 1: 113 | Existing App administrator diagnoses binding for repository installation lookup; no new key, installation or access. |
| Ref deletion outside standing classes | 1: 115 | Identify owned disposable ref and expected SHA before any exact delete proposal; no protected/default/shared ref deletion. |
| Binary/large-artifact custody software | 1: 117 | API implements custody without weakening the current repository material guard; text lifecycle evidence remains preserved. |
| Immutable settlement plus closed blob read | 1: 118 | API finishes tree settlement, reconciles undeployed blob source, then separately reviews exact blob-read exposure/classification. |

## Canonical review completed for 117 and 118

Family117's required four operations are `github.files.content.get`, `.create`, `.update`, `.delete`. `metadata.get` is supporting metadata; `upsert`, `push_files`, `read` and `update_file` are compatibility/batch candidates, not four extra mandatory lifecycle actions. The shared content endpoint supports the requested file lifecycle; this review does not waive binary, large-object, concurrent-edit, isolation, idempotency or recovery requirements. [GitHub Contents API](https://docs.github.com/en/rest/repos/contents).

The actual remaining source gap is explicit: `engineering_identity.ts` passes standing content through `repositoryText` in `_shared/sandy_repository_text.ts`, which requires bounded valid UTF-8 and refuses binary/control bytes or recognizable credential material. A successful small text fixture cannot prove arbitrary binary custody. Removing that guard would weaken protection and is not this proposal. Existing accepted file operations were not rerun.

Family118 requires six canonical operations: blob create/get, tree create/get and commit create/get. Existing IDs are `github.git.blobs.create`, `github.git.get_blob`, `github.git.trees.create`, `github.git.trees.get`, `github.git.commits.create`, `github.git.commits.get`. `github.commit` is a compatibility alias for commit creation. This matches the provider's [blob](https://docs.github.com/en/rest/git/blobs), [tree](https://docs.github.com/en/rest/git/trees) and [commit](https://docs.github.com/en/rest/git/commits) surfaces. No alias was created or removed.

`github.git.get_blob` is still closed **and classified restricted** in the current contract-matched index. A normal Owner login or simply making the API flag true does not automatically authorize workload execution. PR251's blob settlement source is not deployed; its old v31/v61 artifact is stale. Tree creation still lacks complete exact immutable-effect settlement. New source implementation and reviewed release/classification decisions remain necessary; existing commit/tree read evidence is retained.

## Smallest bounded next decisions

These are proposals, not grants. No new decision is needed for the 97-family mapping review or unblocked source/test work. Do not combine the following into a blanket API authorization.

| Decision | Exact operation / target | Bound and approval path | Status / recovery |
| --- | --- | --- | --- |
| Pending source publication | PR270 and PR271 ready/merge only | Parent has already asked the user; wait for explicit response. Source transition approval does not activate runtime mappings or releases. | Denied transitions paused; no retry. |
| Already prepared regional Cloud Run release | PR271 exact Owner package; provider v32/gateway v64 preimages and two Cloud Run contract rows | Existing normal Owner route and protected executor, exact source/manifest/executor digest, 24h. No binding, exposure or permission changes. Parent already holds the package. | Pending source transition and Owner audit; exact source/contract rollback. This is **not** compute family34 activation. |
| Closest read-only compute closure candidate | `gcp.region_operations.get`, `.wait`; project `elaborate-haven-511518-a5`, one existing DONE regional operation | First have Runtime/resource owner supply exact region/name and inspect existing contracts; then review only those two exposure/target bindings, at most one positive each plus own receipts/boundaries, 24h. Do not add regional inventory without naming it separately. | Closed exposure, target not yet verified; not dispatch-ready. Provider reads need no rollback; any approved exposure change restores only its prior flags. |
| Existing Owner reads | `supabase.project.health` on `zmqlyygzqoidkcwdysok`; `supabase.orgs.list` under that Owner's normal organization visibility | Existing normally authenticated Owner may authorize these exact reads; at most one positive each plus receipt/boundary evidence within 24h. Org listing may reveal all that Owner's memberships; no cross-org workload grant. | Prior workload denials preserved; no retry by this continuation. Reads have no resource rollback. |
| Existing integration diagnosis | GitHub App GET `/repos/ausstyle/web-staging/installation`; SCC findings parent `projects/elaborate-haven-511518-a5/sources/-` | Existing credential/security owners provide binding/entitlement evidence. No new credential, App installation, IAM or changed execution identity. | Prior424/no-dispatch and403 preserved. Any repair must be a separately exact proposal. |

Ref deletion and blob-read activation are **not yet approval-ready**: the former needs verified owned-ref/expected-SHA evidence; the latter needs source/classification/release reconciliation. Broad log queries need exact privacy-bounded targets and contracts first. Paid infrastructure or product writes remain outside these read decisions.

## Evidence and validation

The JSON matrix records hashes of the exact registry, policy, requirement and disposition inputs. `build_family_closure_matrix.py` makes primary groups exhaustive without inferring authority or acceptance; per-family flags preserve the secondary gaps. Tests reject missing/duplicate families, keep unreviewed aliases as internal review, retain denied cases and distinguish implementation gaps from inactive delegation. This is programme reconciliation, not live provider acceptance. Existing durable receipts and all family certificates remain untouched.
