/** SANDY-ENG-0012 SC-02/06/12. No credentials, routes or metadata authority.
 * Call only behind Sandy API admission. Provider readers must use the existing
 * provider boundary and exact generation; caller assertions are not evidence.
 */
import { createHash } from "node:crypto";

export class IntegrityError extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}
export interface ObjectRef {
  tenantId: string;
  workspaceId: string;
  bucket: string;
  key: string;
  generation: string;
  size: number;
  sha256: string;
}
export interface Readback {
  ref: ObjectRef;
  body: ReadableStream<Uint8Array>;
}
export interface ReadPolicy {
  tenantId: string;
  workspaceId: string;
  allowedBuckets: ReadonlySet<string>;
  maxBytes: number;
  signal: AbortSignal;
}
export interface IntegrityReceipt {
  state: "BYTES_VERIFIED";
  ref: ObjectRef;
  bytesRead: number;
  sha256: string;
}
const nonempty = (s: unknown): s is string =>
  typeof s === "string" && s.length > 0 && s.length <= 1024;
const fail = (code: string): never => {
  throw new IntegrityError(code);
};

export function validateRef(ref: ObjectRef, policy: ReadPolicy): void {
  if (
    ref.tenantId !== policy.tenantId ||
    ref.workspaceId !== policy.workspaceId ||
    !nonempty(policy.tenantId) || !nonempty(policy.workspaceId)
  ) fail("NOT_FOUND");
  if (
    !nonempty(ref.bucket) || !policy.allowedBuckets.has(ref.bucket) ||
    !nonempty(ref.key) || /[\u0000-\u001f\u007f]/u.test(ref.key) ||
    !/^[1-9][0-9]{0,39}$/u.test(ref.generation)
  ) fail("INVALID_OBJECT_REFERENCE");
  if (
    !Number.isSafeInteger(ref.size) || ref.size < 0 ||
    !Number.isSafeInteger(policy.maxBytes) || policy.maxBytes < 0 ||
    ref.size > policy.maxBytes || !/^[a-f0-9]{64}$/u.test(ref.sha256)
  ) {
    fail("INVALID_OBJECT_REFERENCE");
  }
}
const sameRef = (a: ObjectRef, b: ObjectRef) =>
  a.tenantId === b.tenantId && a.workspaceId === b.workspaceId &&
  a.bucket === b.bucket && a.key === b.key && a.generation === b.generation &&
  a.size === b.size && a.sha256 === b.sha256;

/** Reads bytes independently; never trusts GCS custom SHA metadata or an ETag.
 * Bounds resident memory to a provider chunk and cancels on oversized content.
 * The reader must honor the signal while opening the provider response too.
 */
export async function verifyObject(
  reference: ObjectRef,
  policy: ReadPolicy,
  open: (ref: Readonly<ObjectRef>, signal: AbortSignal) => Promise<Readback>,
): Promise<IntegrityReceipt> {
  const ref = Object.freeze({ ...reference });
  validateRef(ref, policy);
  policy.signal.throwIfAborted();
  const readback = await open(ref, policy.signal);
  if (!sameRef(ref, readback.ref)) {
    await readback.body.cancel().catch(() => {});
    fail("OBJECT_GENERATION_MISMATCH");
  }
  const reader = readback.body.getReader();
  const abort = () => {
    void reader.cancel().catch(() => {});
  };
  policy.signal.addEventListener("abort", abort, { once: true });
  const hash = createHash("sha256");
  let bytesRead = 0;
  try {
    for (;;) {
      policy.signal.throwIfAborted();
      const { done, value } = await reader.read();
      policy.signal.throwIfAborted();
      if (done) break;
      if (!(value instanceof Uint8Array)) fail("INVALID_STREAM");
      if (value.byteLength > ref.size - bytesRead) fail("SIZE_MISMATCH");
      bytesRead += value.byteLength;
      hash.update(value);
    }
    if (bytesRead !== ref.size) fail("SIZE_MISMATCH");
    const sha256 = hash.digest("hex");
    if (sha256 !== ref.sha256) fail("CHECKSUM_MISMATCH");
    return { state: "BYTES_VERIFIED", ref: { ...ref }, bytesRead, sha256 };
  } finally {
    policy.signal.removeEventListener("abort", abort);
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

export interface UploadIntent {
  id: string;
  actorId: string;
  traceId: string;
  expectedRevision: number;
  idempotencyKey: string;
  expiresAt: number;
  ref: ObjectRef;
}
export interface VersionReceipt {
  state: "COMMITTED";
  intentId: string;
  versionId: string;
  revision: number;
  ref: ObjectRef;
  traceId: string;
}
export interface CommitBoundary {
  /** Must recheck current actor/session/device, company and policy eligibility. */
  authorize(intent: Readonly<UploadIntent>): Promise<void>;
  /** Tenant+actor+intent-scoped lookup; mismatched idempotency input must fail. */
  lookup(intent: Readonly<UploadIntent>): Promise<VersionReceipt | null>;
  /** Scan receipt must be server-owned and bound to this generation+digest. */
  assertScanClean(
    intent: Readonly<UploadIntent>,
    proof: IntegrityReceipt,
  ): Promise<void>;
  /** Single SQL transaction: recheck admission/expiry/revision/scan/quota;
   * insert immutable version + outbox + unique usage event + receipt; consume
   * reservation and intent. Retry returns original result. No dual writes.
   */
  commit(
    intent: Readonly<UploadIntent>,
    proof: IntegrityReceipt,
  ): Promise<void>;
}
export type Completion = VersionReceipt | {
  state: "UNKNOWN_OUTCOME";
  intentId: string;
  traceId: string;
  retrySafe: false;
};
function assertReceipt(intent: UploadIntent, receipt: VersionReceipt): void {
  if (
    receipt.state !== "COMMITTED" || receipt.intentId !== intent.id ||
    receipt.traceId !== intent.traceId || !nonempty(receipt.versionId) ||
    !Number.isSafeInteger(receipt.revision) ||
    receipt.revision !== intent.expectedRevision + 1 ||
    !sameRef(receipt.ref, intent.ref)
  ) fail("COMMIT_RECEIPT_MISMATCH");
}

/** This coordinator cannot expose a version just because bytes arrived.
 * postgres/commit.ts supplies a transaction adapter with mandatory canonical-owner
 * hooks; installation remains gated on ownership. Unknown commit outcomes never
 * trigger a blind second write.
 */
export async function completeUpload(
  input: UploadIntent,
  policy: ReadPolicy,
  boundary: CommitBoundary,
  open: (ref: Readonly<ObjectRef>, signal: AbortSignal) => Promise<Readback>,
  now: () => number = Date.now,
): Promise<Completion> {
  const intent = Object.freeze({
    ...input,
    ref: Object.freeze({ ...input.ref }),
  });
  validateRef(intent.ref, policy);
  if (
    ![intent.id, intent.actorId, intent.traceId, intent.idempotencyKey].every(
      nonempty,
    ) ||
    !Number.isSafeInteger(intent.expectedRevision) ||
    intent.expectedRevision < 0 ||
    intent.expectedRevision >= Number.MAX_SAFE_INTEGER ||
    !Number.isSafeInteger(intent.expiresAt)
  ) fail("INVALID_INTENT");
  await boundary.authorize(intent);
  const existing = await boundary.lookup(intent);
  if (existing) {
    assertReceipt(intent, existing);
    return existing;
  }
  if (now() >= intent.expiresAt) fail("INTENT_EXPIRED");
  const proof = await verifyObject(intent.ref, policy, open);
  await boundary.assertScanClean(intent, proof);
  await boundary.authorize(intent);
  policy.signal.throwIfAborted();
  if (now() >= intent.expiresAt) fail("INTENT_EXPIRED");
  // Once dispatched, a lost acknowledgement cannot prove failure.
  try {
    await boundary.commit(intent, proof);
  } catch { /* read durable receipt */ }
  try {
    await boundary.authorize(intent);
    const recorded = await boundary.lookup(intent);
    if (recorded) {
      assertReceipt(intent, recorded);
      return recorded;
    }
  } catch {
    /* do not leak stale metadata after revocation, or invent success */
  }
  return {
    state: "UNKNOWN_OUTCOME",
    intentId: intent.id,
    traceId: intent.traceId,
    retrySafe: false,
  };
}
