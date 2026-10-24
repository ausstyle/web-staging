# Proposed shared Runtime artifact custody

Source-only proposal for SANDY-ENG-0003/0004/0005 and Cloud0012 compatibility. No file here is an installed migration; no gateway imports it. No role, policy, key, trust record, credential, bucket, worker or route is provisioned. Synthetic test keys are not trusted production receipts. PR297's release source is untouched.

## One canonical path

API admission → canonical authority resolver/locks → existing universal file + immutable provider generation → trusted scanner signature → shared scan receipt → one durable claim → private byte staging → revalidate and atomic seal → private handle → separately admitted provider consumer.

`schema.sql` proposes ONE shared journal, `sandy_artifact_custody`, referencing existing `sandy_universal_files.id` and `sandy_api_execution_admissions.id`. It is an extension for receipts and single-use execution custody, not a file catalogue, queue or alternate provider-download vault. API and Cloud should consume this journal rather than install two scanner authorities. Cloud's currently source-only `sandy_cloud.scan_receipts` should become a reference to the shared receipt in a coordinated follow-up; this branch does not mutate Cloud-owned source.

| Contract | Implemented source | Production adapter still required |
| --- | --- | --- |
| Trusted scan receipt | Ed25519 signature over a domain-separated fixed-field encoding; exact file/artifact/admission/actor/customer/generation/size/hash/context binding;15-minute maximum validity; immutable signed receipt | Existing scanner workload must sign this encoding after scanning the exact provider generation. Public-key trust entry requires explicit security approval; none exists here. |
| Canonical authority | Admission row locks and actor/tenant/operation/input/contract/scope/expiry checks; file-owner check; `AuthorityOwner.lockAndResolve(tx, context)` | API supplies the canonical principal→customer relation and current policy revision on the SAME connection. It must lock/recheck actual membership and revocation rows; it cannot return a cached Boolean. |
| Revocation protocol | `lockCanonicalScope` gives deterministic sorted transaction advisory locks for actor/admission/tenant/customer keys; seal holds authority locks, scanner release row SHARE lock and claim UPDATE lock through commit | Every relevant revocation writer must adopt the same authority keys/row locks. Read tentative canonical relation, lock scope, then re-read/verify relation. No identity mapping may be inferred from equal UUIDs. |
| Claim | `ArtifactJournal.acquire` INSERTs one immutable claim per artifact, with a random30-second lease bounded by scan expiry; unique primary key denies concurrent/duplicate claims | Existing owner calls it once before streaming and holds returned lease token privately. No worker retry may reset CLAIMED/ABANDONED to available. |
| Seal/reconcile | Current authority/revision, signature/trust, file owner, lease and byte proof checked again in one transaction; only private opaque handle/receipt recorded; expiry rechecked at final UPDATE | Private staging adapter must supply its own immutable owned handle, not a caller string; bind API byte verifier's proof and context digest. Commit-unknown invokes `reconcile`, never restreams/reseals. |

The `SqlDatabase`/`SqlTransaction` interfaces are reused directly from Cloud's candidate adapter. The actual implementation MUST pin one connection for BEGIN/callback/COMMIT, roll back on thrown errors and never automatically retry an uncertain commit. No direct connection credentials are supplied by this proposal.

API PR287 compatibility: `withClaim` delegates to `acquire`; `verifyScan` checks the saved signature/trust record; `openGeneration` and private staging remain provider-owner I/O; `revalidate` is advisory while `seal` repeats authoritative checks atomically. The API's8MiB/1MiB chunk/30-second limits remain authoritative; this shared journal does not change them. Its generic size validator also accommodates separately approved Cloud limits. Context `bindingSha256` MUST be computed using API's canonical `argumentDigest(ArtifactContext)`, not trusted from an HTTP argument. No API artifact-reference contract is exposed here.

Cloud compatibility: call the same authority resolver and scanner trust check inside its existing `PostgresCommitBoundary` transaction, before workspace→intent→file projection; map the universal file and immutable generation to the same shared receipt. Cloud commit and API seal have different effects and must not consume the same claim twice. A Cloud upload is not automatically authority for a repository publication: the latter needs its own admission-bound scan receipt/artifact identity referencing the same generation. No new bytes/store are required by that distinct execution claim.

## Explicit security decisions for API/Cloud review

Recommended scanner model: an existing isolated scanner workload signs with its existing private key; a protected release installs only its public verification key, release identifier and trust revision. Revocation is terminal; key rotation creates a new release, never edits an old key under the same identity. Scanner revocation locks its release row; seal's SHARE lock linearizes before or after revocation. This does not assume that a qualifying scanner already exists.

Alternative: a dedicated database scanner writer role can insert attestations without signatures. That expands database write authority and would require new grants/RLS and exact action-time approval. It is NOT implemented or the default. If no existing signing workload is available, choose/approve that identity and trust lifecycle before deployment; do not treat a local test signer as it.

Recommended ownership model: keep canonical principal/customer/membership authority in the existing API identity owner, expose one transaction-scoped resolver used by both Runtime and Cloud, and bind its revision into the claim. Alternative: add a durable identity mapping table. That duplicates authority unless the API owner explicitly makes it canonical; it is NOT implemented. Tenant and customer UUID equality is never assumed.

The proposed journal schema and public-key trust configuration require joint API/Cloud review and a source-pinned protected deployment plan. No live migration should be inferred from routine source/test authorization. Installing production trust entries, adding scanner access or connection roles requires the existing explicit security gate.

## Evidence and limits

Isolated PGlite tests use real signature verification and SQL transactions: changed generation/signature rejected, foreign actor/customer and binding substitution rejected, duplicate claim refused, scanner revocation/authority revision changes block seal, lost commit acknowledgement reconciles one receipt, terminal claims cannot reset, crash-before-seal stays unresolved, expired scan blocks access. PGlite's one pinned connection serializes the duplicate-claim test; this is NOT proof of real PostgreSQL multi-session races. Real concurrent revocation/claim tests, cancellation during streaming, immutable provider generation reads, scanner execution and actual consumer effects remain required before activation.

There are no issued production receipts and no byte publication. The protocol currently reconciles only while its canonical admission remains consumed and valid; API/Cloud must agree an explicit authorized post-completion reconciliation policy before wiring provider completion. This deliberate restriction does not silently broaden expired authority.
