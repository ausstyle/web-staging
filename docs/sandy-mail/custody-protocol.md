# Mail quarantine commit and canonical receipt protocol

Status: SOURCE-TESTED PROPOSAL; not installed, registered or connected to Runtime.
Scope: SANDY-ENG-0015, saved Mail v1.0 §§3–6; canonical ownership remains 0003/0004/0005.
Runtime reference: PR303 `c9786bdeb96721b58e8dce6486f5663044d7ae4b` (custody package unchanged from `cd6f6cf`).
Mail source: `services/sandy-mail/custody_plan.go` and its tests.
Reconciled with main `cc433f8` (Cloud PR306 and Runtime PR312/313). The new
`sandy_prepare_mission_work_product`/`sandy_finish_mission_work_product` flow is for
internal draft work products; its fixture RPC/recovery tests do not establish the
Mail effect snapshot/fence/outbox adapter. Cloud
`packages/sandy-cloud/postgres/runtime_integration.ts` assembles canonical locks
inside its own database transaction; that does not make Mail Cloud SQL atomic
with Runtime. Both owners’ source is preserved unchanged.

## Decision and boundaries

A Cloud SQL mailbox commit and Runtime's internal canonical authority transaction
are **two commits**. No network Boolean, remote signature or advisory lock makes
them atomic. Mail first records a private, quarantined effect and its original
receipt. Runtime can subsequently acknowledge that exact effect under current
canonical authority. Neither fact grants customer access, scanner-clean state or
permission to send. The original MIME, attachments, metadata and inbound receipt
remain in the existing Mail Cloud SQL/GCS architecture. Runtime stores only the
minimum effect/receipt/generation/digest references required for its audit.

This increment supplies an executable pure reducer and a real Mail read-only proof
adapter. It does not supply a production Runtime persistence, authority, scanner
or transport adapter. Canonical events in reducer tests are explicitly modeled;
they are not signed scanner receipts or Runtime deployment acceptance. No Mail
queue, scanner trust table, mapping authority, keys, roles or SQL schema is added.

## Bound effect

The first effect is **quarantined original ingestion**, not byte release or draft
editing. `MailCommitBinding` fixes the effect ID, canonical admission/artifact/file/
scan-receipt IDs, actual Mail tenant/account/mailbox, delivery identity, existing
Mail semantic input digest, immutable provider store/key/generation/size/SHA256,
API-owned canonical context digest and Runtime-owned step fence reference. The
canonical API owner must derive/validate all identities, mappings and digests;
MIME headers and request arguments cannot supply authority. A GCS bucket and an
object generation are explicit; a local fixture store is only a test identity.

The staged original must be the **same immutable object** the existing `Ingest`
path records: its deterministic delivery object key, exact generation and digest.
A different key/generation, even with the same bytes, requires its own correct
canonical file/scan mapping. Original creation uses the existing create-only store.
Never copy an original to a new generation and reuse the prior scan identity.
Staging has its own admitted private-write authority; the reducer starts after
that fact and does not authorize an upload merely by constructing a binding.

`ReadMailCommitProof` reads existing complete ingestion metadata and receipt,
checks semantic input and exact original generation, re-reads the recovery ledger
and each attachment by integrity-checked reference, and requires quarantined
state. It never calls `Ingest` or `Recover`. Missing results do **not** prove an
in-flight writer was fenced or cannot later commit. No recipient/body content is
put in the returned canonical seal proof.

## State and durable execution rule

| State | Confirmed fact | Permitted next owner action |
| --- | --- | --- |
| STAGED_PRIVATE | Original identity retained under private staging admission | Persist CLAIM_PENDING, then acquire one canonical claim |
| CLAIM_PENDING | Claim request may have executed | Accept exact confirmed grant or reconcile; never acquire again on uncertainty |
| PREPARED_PRIVATE | Canonical claim, revision, expiry and fence observed | Fresh canonical revalidation, persist MAIL_PENDING, then one private Mail commit |
| MAIL_PENDING | Cloud SQL commit may have executed | Observe exact Mail receipt or reconcile; never infer rollback from timeout |
| MAIL_COMMITTED_PRIVATE | Complete Mail proof and original receipt observed | Persist SEAL_PENDING, then canonical Mail seal under live authority and private lease |
| SEAL_PENDING | Canonical seal may have executed | Observe matching seal or reconcile; never reseal on uncertain acknowledgement |
| SEALED_PRIVATE | Historical canonical acknowledgement matches the Mail proof digest | No byte access or sending; preserve receipt and current revocation separately |
| REFUSED_PRIVATE | Execution cannot proceed; any observed Mail commit remains private | Preserve originals, receipt and refusal; a fresh reviewed operation is distinct |
| RECONCILIATION_REQUIRED | At least one effect has uncertain outcome | Status/receipt reads only; no write replay, renewed claim or fabricated completion |

`AdvanceMailCommit` returns a proposed snapshot plus one next action. The existing
Runtime mission/step owner must atomically CAS the snapshot, event identity and
outbox/action in its own durable ledger **before** executing that action. Same
explicit event identity returns no action; changed retries and stale revisions
fail. JSON reconstruction is tested after every transition. That source test is
not proof of an installed Runtime journal adapter. The exact existing table/RPC
and lease/fence mapping must be supplied by Runtime; no matching production
adapter was identified or invented here. An uncertain journal write must itself
be read back before dispatch. Keep transactions short; never hold Cloud SQL locks
while requesting remote authority.

This bounded source model accepts at most 128 distinct events per snapshot; at
that bound it refuses further transitions and preserves the existing snapshot.
Production adoption must use the existing Runtime event ledger/checkpoint policy,
not an unbounded Mail polling map or deletion of prior audit. Uncertain reads do
not justify a new write.

Lease tokens stay private to Runtime's existing executor; snapshots contain no
lease token. Reconstructing a snapshot cannot restore a lost capability. Current
`ArtifactJournal.acquire` is INSERT-only and bounds the lease to 30 seconds and
scan expiry. This does not raise the existing API 8 MiB artifact/1 MiB chunk
limits to Mail's 25 MiB MIME bound; oversized canonical effects remain refused
until the owner approves a compatible bounded contract. A lost acquire response or expired/lost fence cannot be reset or
silently renewed. The current holder may only use canonical reconciliation;
otherwise preserve uncertainty/terminal refusal and request a separate admitted
recovery operation. `CANONICAL_MAIL_SEAL_ONCE` is a proposed owner action, **not an
existing registered operation**.

## Revocation and uncertainty

| Cut point | Required result |
| --- | --- |
| Before claim or before fresh pre-commit authority check | Refuse execution; retain staged originals |
| After pre-commit check but before/during Cloud SQL commit | A private commit can still land. Preserve its receipt; canonical seal revalidates and must refuse revoked authority. This race is not described as distributed rollback. |
| Mail commit acknowledgement lost | Read exact Mail receipt plus canonical status. Receipt absence alone stays uncertain, because an old worker might still commit. No automatic `Recover` or repeated write. |
| After Mail commit, before seal starts | Refuse further execution; retain quarantined metadata, originals and receipt |
| During/after canonical seal, before acknowledgement | Reconcile under current status authority. A historical SEALED fact may precede revocation; a denied status read is not proof of failure or cancellation. Preserve uncertainty. |
| After confirmed canonical seal | Keep historical SEALED receipt. Revocation, expiry or fence loss never erases audit and never authorizes a subsequent consumer. |

Canonical seal and all revokers use PR303's complete globally ordered lock plan,
then re-read canonical authority and scanner/file/admission rows in one pinned
transaction. That linearizes the **canonical seal only**, not Cloud SQL. An
ABANDONED canonical claim plus an absent Mail receipt remains uncertain if a Mail
writer was in flight. An observed late Mail receipt can then be retained with a
private refusal. Expiry and fence loss are recorded distinctly from revocation.

Every future customer read, attachment download, archive delivery or provider send
needs its own currently authorized, appropriately scanned consumer operation and
its actual bounded transfer/revocation contract. This proposal has no customer
access state; `PermitsCustomerAccess()` is always false. The loopback synthetic UI
is explicitly a development transport and does not satisfy these deployment gates.

## Exact owner changes requested through parent

1. **Runtime/API — Mail seal proof discriminator.** Add a separately reviewed
   `mail_quarantined_ingest_committed` v1 branch alongside the existing fixed
   `repository_artifact_bytes_verified` branch. Do not weaken or relabel the latter.
   `RuntimeMailSealProof` has exactly ten fields: `version`, `kind`, `artifactId`,
   `generation`, `size`, `sha256`, `bindingSha256`, `effectId`, `mailReceiptId`,
   `mailProofSha256`. Validate artifact/generation/digest against the existing
   trusted scan; bind effect/receipt/proof to the API-owned Mail context and actual
   read-only Mail receipt lookup. Fetch immutable Mail proof outside canonical row
   locks, then recheck canonical authority/lease/trust and commit the minimal
   references in the existing journal. `mailProofSha256` currently hashes the exact
   Go `encoding/json.Marshal(MailCommitProof)` bytes, not an arbitrary JSON
   re-serialization. The authenticated read transport must preserve those bytes
   or the owners must agree and test a versioned canonical encoding before
   adoption; a TypeScript object stringify is not assumed equivalent.
   The full Mail proof is not a second mailbox
   catalogue. No new signer/trust authority is requested.
2. **Runtime/API — non-capability reconciliation.** Current `reconcileStatus`
   returns only state. For this effect, return the exact artifact/binding and
   `mailProofSha256` under current `StatusAuthorityOwner` authorization, with no
   private handle, bytes, lease or renewal. State-only SEALED is insufficient to
   verify a matching Mail effect after unknown acknowledgement; tests reject it.
   Retain terminal claim rules and identify the existing owner-controlled abandon/
   reconciliation path. Do not fabricate ABANDONED or infer it from access denial.
3. **Runtime — durable adapter.** Identify the actual mission/step table or RPC,
   revision CAS, current lease/fence checks and action outbox transaction that will
   persist this reducer. Reuse 0004's owner, not a Mail scheduler or another queue.
   Demonstrate crash-before/after-journal-commit, stale-worker and lost-ack cases
   against that real adapter before registration. A negative Mail result needs an
   explicit owner fence if it is ever to justify retry; this proposal never uses
   absence alone for that decision.
4. **API/Cloud — canonical mapping/transport.** Bind authenticated principal and
   customer to actual Mail tenant/account/mailbox, the exact approved GCS bucket/
   generation and existing universal-file identity, plus the canonical operation/
   input/contract/scope/context digest. Identify the existing authenticated Mail
   receipt-read transport. UUID equality, a fixture fence or caller-supplied proof
   is not authority. No new credentials, grants, resource or trust installation is
   requested or performed by this source increment.

Adoption requires owner source review, real canonical adapter/lock tests and a
source-pinned protected release. The Google trial's first-email canary remains
unchanged and does not depend on this proposal. Rollback stops new dispatch and
retains originals, snapshots and receipts; it never deletes mail to undo a seal.
