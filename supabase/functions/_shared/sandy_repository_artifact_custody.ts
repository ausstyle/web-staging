/** Candidate binary custody boundary. Not imported by a live gateway. It does
 * not bypass repositoryText, admit an operation, fetch a URL or obtain a key.
 * Existing private artifact/scanner owners must implement the interfaces before
 * a separately reviewed artifact-reference contract can be exposed.
 */
import { createHash } from "node:crypto";
import { argumentDigest } from "./sandy_api_protocol.ts";
import { repositorySourcePath } from "./sandy_repository_text.ts";
export interface ArtifactContext {
  artifactId: string;
  actorId: string;
  /** Canonical server-resolved relation; never inferred from actor or request JSON. */
  customerId: string;
  tenantId: string | null;
  admissionId: string;
  operation: "github.files.create" | "github.files.update";
  repository: "ausstyle/web-staging";
  path: string;
  ref: string;
  inputSha256: string;
  contractSha256: string;
  scopeSha256: string;
}
export interface SealedArtifact {
  artifactId: string;
  ownerActorId: string;
  ownerCustomerId: string;
  tenantId: string | null;
  /** Shared revocation/claim revision, checked atomically again by seal. */
  authorityRevision: string;
  generation: string;
  size: number;
  sha256: string;
  bindingSha256: string;
  expiresAt: number;
  scanReceiptId: string;
  state: "sealed";
}
export interface ArtifactProof {
  version: 1;
  kind: "repository_artifact_bytes_verified";
  artifactId: string;
  generation: string;
  size: number;
  sha256: string;
  bindingSha256: string;
}
export interface VerifiedScanReceipt {
  receiptId: string;
  artifactId: string;
  generation: string;
  sha256: string;
  size: number;
  bindingSha256: string;
  scannerIdentity: string;
  scannerVersion: string;
  verdict: "clean";
  expiresAt: number;
}
export interface SealFence {
  authorityRevision: string;
  scanReceiptId: string;
  customerId: string;
  tenantId: string | null;
  expiresAt: number;
}
export interface PrivateArtifactStage {
  append(bytes: Uint8Array): Promise<void>;
  /** Publish only a private, execution-bound handle; atomically record its
   * digest receipt and consume this claim. Unknown acknowledgement is not retry.
   */
  seal(
    proof: ArtifactProof,
    /** In the SAME transaction/revision lock as revocation writers, verify this
     * fence and the live canonical relation/claim/scan, then consume and seal.
     * A pre-transaction Boolean check is insufficient. Unknown commits must be
     * reconciled by the owner using admission/artifact/binding, never reissued.
     */
    fence: Readonly<SealFence>,
  ): Promise<{ privateHandle: string; proof: ArtifactProof }>;
  discard(): Promise<void>;
}
export interface ArtifactCustodyOwner {
  /** Existing private artifact row: authorize canonical context and take a
   * durable single-use claim. Duplicate/foreign/revoked/expired claims reject.
   * Hold a lease through work; don't auto-retry work on transaction failure.
   * An ambiguous seal remains reconcilable, never reset to available.
   */
  withClaim<T>(
    context: Readonly<ArtifactContext>,
    work: (record: Readonly<SealedArtifact>) => Promise<T>,
  ): Promise<T>;
  /** Resolve a trusted scanner receipt from canonical custody, not caller metadata. */
  verifyScan(
    record: Readonly<SealedArtifact>,
    bindingSha256: string,
  ): Promise<Readonly<VerifiedScanReceipt> | null>;
  openGeneration(
    record: Readonly<SealedArtifact>,
    signal: AbortSignal,
  ): Promise<
    { artifactId: string; generation: string; body: ReadableStream<Uint8Array> }
  >;
  stage(context: Readonly<ArtifactContext>): Promise<PrivateArtifactStage>;
  /** Recheck canonical authority, scan validity and claim lease immediately
   * before private publication, not a cached caller assertion. */
  revalidate(
    context: Readonly<ArtifactContext>,
    record: Readonly<SealedArtifact>,
  ): Promise<boolean>;
}
export class RepositoryArtifactError extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}
function fail(code = "REPOSITORY_ARTIFACT_REFUSED"): never {
  throw new RepositoryArtifactError(code);
}
const id = (s: unknown): s is string =>
  typeof s === "string" &&
  /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(s);
const digest = (s: unknown): s is string =>
  typeof s === "string" && /^[a-f0-9]{64}$/.test(s);
const reference = (s: unknown): s is string =>
  typeof s === "string" && s.length > 0 && s.length <= 200 &&
  /^[A-Za-z0-9_.:-]+$/.test(s);
export async function stageRepositoryArtifact(
  context: ArtifactContext,
  owner: ArtifactCustodyOwner,
  signal: AbortSignal,
  now = Date.now,
): Promise<{ privateHandle: string; proof: ArtifactProof }> {
  signal = AbortSignal.any([signal, AbortSignal.timeout(30000)]);
  const c = Object.freeze({ ...context });
  if (
    ![c.artifactId, c.actorId, c.admissionId, c.customerId].every(id) ||
    (c.tenantId !== null && !id(c.tenantId)) ||
    c.repository !== "ausstyle/web-staging" ||
    !["github.files.create", "github.files.update"].includes(c.operation) ||
    !repositorySourcePath(c.path) ||
    ![c.inputSha256, c.contractSha256, c.scopeSha256].every(digest) ||
    !/^refs\/heads\/engineering\/[A-Za-z0-9_./-]+$/.test(c.ref) ||
    c.ref.split("/").some((p) => !p || p === "." || p === "..") ||
    c.ref.length > 250
  ) fail();
  // This is an additional binding, not authorization for protected source or
  // a repository branch. The canonical owner must apply those existing checks.
  signal.throwIfAborted();
  const binding = await argumentDigest(c);
  signal.throwIfAborted();
  return await owner.withClaim(c, async (loaded) => {
    const a = Object.freeze({ ...loaded });
    if (
      a.state !== "sealed" || a.artifactId !== c.artifactId ||
      a.ownerActorId !== c.actorId || a.ownerCustomerId !== c.customerId ||
      a.tenantId !== c.tenantId || !reference(a.authorityRevision) ||
      !reference(a.generation) || !reference(a.scanReceiptId) ||
      !digest(a.sha256) || a.bindingSha256 !== binding ||
      !Number.isSafeInteger(a.size) || a.size < 0 || a.size > 8 * 1024 * 1024 ||
      !Number.isSafeInteger(a.expiresAt) || a.expiresAt <= now()
    ) fail();
    const scan = await owner.verifyScan(a, binding);
    if (
      !scan || scan.receiptId !== a.scanReceiptId ||
      scan.artifactId !== a.artifactId || scan.generation !== a.generation ||
      scan.sha256 !== a.sha256 || scan.size !== a.size ||
      scan.bindingSha256 !== binding || scan.verdict !== "clean" ||
      !reference(scan.scannerIdentity) || !reference(scan.scannerVersion) ||
      !Number.isSafeInteger(scan.expiresAt) || scan.expiresAt <= now()
    ) {
      fail("REPOSITORY_ARTIFACT_SCAN_REQUIRED");
    }
    const fence = Object.freeze({
      authorityRevision: a.authorityRevision,
      scanReceiptId: a.scanReceiptId,
      customerId: c.customerId,
      tenantId: c.tenantId,
      expiresAt: Math.min(a.expiresAt, scan.expiresAt),
    });
    signal.throwIfAborted();
    const opened = await owner.openGeneration(a, signal);
    if (
      opened.artifactId !== a.artifactId || opened.generation !== a.generation
    ) {
      await opened.body.cancel();
      fail();
    }
    let staging: PrivateArtifactStage | undefined,
      reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    let sealing = false;
    try {
      staging = await owner.stage(c);
      reader = opened.body.getReader();
      const abort = () => {
        void reader?.cancel().catch(() => {});
      };
      signal.addEventListener("abort", abort, { once: true });
      const hash = createHash("sha256");
      let size = 0;
      try {
        for (;;) {
          signal.throwIfAborted();
          if (fence.expiresAt <= now()) fail();
          const item = await reader.read();
          signal.throwIfAborted();
          if (item.done) break;
          if (
            !(item.value instanceof Uint8Array) ||
            item.value.length > 1024 * 1024 || item.value.length > a.size - size
          ) fail();
          const bytes = item.value.slice();
          size += bytes.length;
          hash.update(bytes);
          await staging.append(bytes);
        }
      } finally {
        signal.removeEventListener("abort", abort);
      }
      if (size !== a.size || hash.digest("hex") !== a.sha256) {
        fail("REPOSITORY_ARTIFACT_BYTES_MISMATCH");
      }
      const proof: ArtifactProof = {
        version: 1,
        kind: "repository_artifact_bytes_verified",
        artifactId: a.artifactId,
        generation: a.generation,
        size,
        sha256: a.sha256,
        bindingSha256: binding,
      };
      // Capture expected proof before handing it to an asynchronous owner.
      const expected = await argumentDigest(proof);
      if (fence.expiresAt <= now() || await owner.revalidate(c, a) !== true) {
        fail();
      }
      signal.throwIfAborted();
      if (fence.expiresAt <= now()) fail();
      sealing = true;
      const result = await staging.seal(Object.freeze(proof), fence);
      if (
        !reference(result.privateHandle) ||
        await argumentDigest(result.proof) !== expected
      ) fail("REPOSITORY_ARTIFACT_COMMIT_UNKNOWN");
      return result;
    } catch (error) {
      if (sealing) fail("REPOSITORY_ARTIFACT_COMMIT_UNKNOWN");
      await staging?.discard().catch(() => {});
      throw error instanceof RepositoryArtifactError
        ? error
        : new RepositoryArtifactError("REPOSITORY_ARTIFACT_STREAM_FAILED");
    } finally {
      if (reader) {
        await reader.cancel().catch(() => {});
        reader.releaseLock();
      } else await opened.body.cancel().catch(() => {});
    }
  });
}
