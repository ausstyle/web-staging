# Runtime continuation: API artifact custody bindings

To Runtime continuation `01a16b96-025f-7138-95d5-9b667aa0703e`, via parent coordination. Scope SANDY-ENG-0005/0003. Candidate interface is pinned at PR287 commit `3b6671c652ea1703901c4a2a0ce0f789f5a6436d`, `supabase/functions/_shared/sandy_repository_artifact_custody.ts`. It is not imported by a live gateway. This handoff does not authorize activation, new storage/credentials, IAM, exposure changes or competing worker deployment.

## Exact interface and ownership

API supplies `stageRepositoryArtifact(context, owner, signal)` and byte verification. Runtime/private-artifact owner supplies `ArtifactCustodyOwner` against its existing canonical infrastructure:

| Method | Required binding/effect |
| --- | --- |
| `withClaim(context, work)` | Derive trusted actor/admission/target from canonical records; verify existing contract/scope/input digests and repository/protected-source policy. Load the existing private artifact; acquire a durable single-use claim/lease. Run work once. Duplicate/foreign/revoked/expired claims reject. Never reset an uncertain seal to available. |
| `verifyScan(record, bindingSha256)` | Resolve a trusted scanner receipt for exactly artifact ID, immutable generation, byte length and SHA256, with the same context binding. Validate scanner identity/version and revocation/expiry policy. Caller-provided flags are not evidence. |
| `openGeneration(record, signal)` | Open exactly the stored immutable generation from existing private custody, bound to artifact ID. Return a cancellable byte stream. No caller URL, credential substitution or latest-version fallback. |
| `stage(context)` | Allocate private staging under the held claim. `append(bytes)` remains private; `discard()` disposes only that owned staging. No GitHub publication. |
| `revalidate(context, record)` | Check current authority, scanner receipt and claim lease immediately before seal. Coordinate the revision/lock with seal; a cached true result cannot protect against intervening revocation. |
| `stage.seal(proof)` | Atomically check the same authority/lease revision, consume the claim, and persist the proof plus opaque private handle. Unknown acknowledgement must be reconciled by existing claim/idempotency identity, never replayed. |

`ArtifactContext` binds artifactId, actorId, admissionId, existing files.create/update operation, fixed repository, path, engineering ref and input/contract/scope SHA256. `SealedArtifact` additionally binds ownerActorId, immutable generation, exact size/hash, expiry, scanReceiptId and state=sealed. The proof contains version/kind/artifactId/generation/size/sha256/bindingSha256. Private handles must satisfy the interface's bounded opaque-reference syntax; no content, signed URL or secret appears in the public result.

The current SPI deliberately does not invent a customer-to-actor mapping. If tenant/customer scope is required by the existing custody system, derive and lock that canonical relation from the admission under Runtime's actual schema. Do not assert that tenant IDs and customer IDs are equal. A future admitted artifact contract must carry only a reference; callers cannot supply these trusted records or the owner implementation.

## Required integration evidence before activation

Use the existing transaction/lease mechanism and provide tests for two concurrent claims, revocation between revalidation and seal, lease loss during streaming, scanner invalidation, cross-actor/admission/tenant substitution, generation replacement, crash before seal, seal committed but response lost, and repeated reconciliation. Prove exactly one private handle/receipt and no duplicate publication. API tests currently use an in-memory owner and do not establish these production properties.

Runtime should return the exact existing table/service interface names and revision-lock mechanism, with source commit and test receipts. If any required binding is unavailable, report the missing interface; do not create a parallel custody store or worker. API then implements the separately reviewed artifact-reference contract/provider consumer against that stable owner binding.

API bounds are 8 MiB total, 1 MiB per chunk and a 30-second abort signal. Owner I/O must honor cancellation and leases; the signal is not a substitute for durable reconciliation. An uncertain seal preserves evidence and returns `REPOSITORY_ARTIFACT_COMMIT_UNKNOWN`.

## Shared release coordination

PR287 contains a separate tree-verifier change and SQL migration, not executable live release approval. PR271's regional-release pins must not be reused for this different source. Any future shared gateway/provider release must re-read current versions, exact module/preimage hashes and existing component leases, preserve Runtime/IAP changes, capture rollback bytes and fail on drift. API has not deployed this candidate or retried the denied PR270/271 transitions.
