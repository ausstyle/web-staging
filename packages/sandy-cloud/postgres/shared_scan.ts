/** Cloud reuse of the Runtime-owned scan authority. No keys, verdict store,
 * signature verifier, claim, seal, worker or fallback scanner is created here.
 */
import { createHash } from "node:crypto";
import {
  type CanonicalAdmission,
  intentDigest,
  type SqlTransaction,
} from "./commit.ts";
import type { IntegrityReceipt, UploadIntent } from "../integrity.ts";
export interface ScanBinding {
  artifactId: string;
  admissionId: string;
  actorId: string;
  operation: string;
  inputSha256: string;
  contractSha256: string;
  scopeSha256: string;
  bindingSha256: string;
}
export interface VerifiedRuntimeScan {
  customerId: string;
  tenantId: string | null;
  authorityRevision: string;
  record: {
    version: 1;
    receiptId: string;
    artifactId: string;
    fileId: string;
    admissionId: string;
    actorId: string;
    customerId: string;
    generation: string;
    size: number;
    sha256: string;
    bindingSha256: string;
    issuer: string;
    release: string;
    trustRevision: number;
    verdict: "CLEAN" | "REJECTED";
    issuedAt: number;
    expiresAt: number;
  };
}
export interface RuntimeScanVerifier {
  /** Proposed narrow PR303 seam: use exactly tx, no nested db.transaction.
   * Resolve/lock current authority, admission, receipt, scanner release and file;
   * verify the signature/trust/expiry. Hold revocation locks to caller COMMIT.
   * This validates a scan; it MUST NOT acquire/consume a repository seal claim.
   */
  verifyScanInTransaction(
    tx: SqlTransaction,
    binding: Readonly<ScanBinding>,
    receiptId: string,
  ): Promise<VerifiedRuntimeScan>;
}
export interface CloudScanReferenceOwner {
  /** Load and lock the server-owned reference for this intent from existing
   * admission/transfer custody. No caller JSON; no clean flag or scanner key.
   */
  lock(
    tx: SqlTransaction,
    intent: Readonly<UploadIntent>,
    fileId: string,
  ): Promise<{ receiptId: string; binding: ScanBinding } | null>;
}
export interface SharedScanEvidence {
  receiptId: string;
  bindingSha256: string;
  scannerIdentity: string;
  scannerVersion: string;
  trustRevision: number;
  authorityRevision: string;
  expiresAt: number;
}
export interface ScanCommitInput {
  intent: Readonly<UploadIntent>;
  fileId: string;
  admission: CanonicalAdmission;
  proof: IntegrityReceipt;
}
export interface ScanCommitOwner {
  verifyInTransaction(
    tx: SqlTransaction,
    input: ScanCommitInput,
  ): Promise<SharedScanEvidence>;
}
const sha = (s: unknown): s is string =>
  typeof s === "string" && /^[a-f0-9]{64}$/.test(s);
const uuid = (s: unknown): s is string =>
  typeof s === "string" &&
  /^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(s);
const opaque = (s: unknown): s is string =>
  typeof s === "string" && /^[A-Za-z0-9_.:-]{1,200}$/.test(s);
const deny = (): never => {
  throw Error("SHARED_SCAN_BINDING_REFUSED");
};
/** Domain-separated binding covers bucket/key/workspace and all intent inputs,
 * which the generic signed attestation does not contain as separate fields.
 * Scanner ingress and Cloud reference owner must use this exact source contract.
 */
export function cloudScanBindingDigest(
  input: {
    intent: Readonly<UploadIntent>;
    fileId: string;
    admission: Pick<CanonicalAdmission, "customerId" | "policyEpoch">;
  },
  b: Omit<ScanBinding, "bindingSha256">,
): string {
  return createHash("sha256").update(
    JSON.stringify([
      "sandy.cloud.scan.v1",
      intentDigest(input.intent),
      input.fileId,
      input.admission.customerId,
      input.admission.policyEpoch,
      b.artifactId,
      b.admissionId,
      b.actorId,
      b.operation,
      b.inputSha256,
      b.contractSha256,
      b.scopeSha256,
    ]),
  ).digest("hex");
}
export function sharedScanOwner(
  journal: RuntimeScanVerifier,
  references: CloudScanReferenceOwner,
  contract: { operation: string; sha256: string },
  now = Date.now,
): ScanCommitOwner {
  const expected = Object.freeze({ ...contract });
  if (!opaque(expected.operation) || !sha(expected.sha256)) deny();
  return {
    async verifyInTransaction(tx, input) {
      const startTime = now();
      if (!Number.isSafeInteger(startTime) || startTime < 0) deny();
      const p = input.proof;
      if (
        p.state !== "BYTES_VERIFIED" || p.bytesRead !== input.intent.ref.size ||
        p.sha256 !== input.intent.ref.sha256 ||
        intentDigest({ ...input.intent, ref: p.ref }) !==
          intentDigest(input.intent)
      ) deny();
      const i = Object.freeze({
        ...input.intent,
        ref: Object.freeze({ ...input.intent.ref }),
      });
      const frozen = {
        ...input,
        intent: i,
        admission: Object.freeze({ ...input.admission }),
      };
      const source = await references.lock(tx, i, frozen.fileId);
      if (!source) return deny();
      const { receiptId, binding: b } = structuredClone(source);
      if (
        !uuid(receiptId) || !uuid(b.artifactId) || !uuid(b.admissionId) ||
        b.actorId !== i.actorId ||
        b.operation !== expected.operation ||
        b.contractSha256 !== expected.sha256 ||
        ![b.inputSha256, b.contractSha256, b.scopeSha256, b.bindingSha256]
          .every(sha) ||
        b.bindingSha256 !== cloudScanBindingDigest(frozen, b)
      ) deny();
      const v = await journal.verifyScanInTransaction(
        tx,
        Object.freeze(b),
        receiptId,
      );
      const a = v?.record, time = now();
      if (
        !Number.isSafeInteger(time) || time < 0 || !a ||
        !Number.isSafeInteger(frozen.admission.expiresAt) ||
        frozen.admission.expiresAt <= time ||
        v.customerId !== frozen.admission.customerId ||
        v.tenantId !== i.ref.tenantId || !opaque(v.authorityRevision) ||
        a.version !== 1 ||
        a.receiptId !== receiptId || a.artifactId !== b.artifactId ||
        a.admissionId !== b.admissionId ||
        a.fileId !== frozen.fileId || a.actorId !== i.actorId ||
        a.customerId !== frozen.admission.customerId ||
        a.bindingSha256 !== b.bindingSha256 || a.verdict !== "CLEAN" ||
        a.generation !== i.ref.generation ||
        a.sha256 !== i.ref.sha256 || a.size !== i.ref.size ||
        !opaque(a.issuer) || !opaque(a.release) ||
        !Number.isSafeInteger(a.trustRevision) || a.trustRevision < 1 ||
        !Number.isSafeInteger(a.issuedAt) || a.issuedAt < 0 ||
        a.issuedAt > time ||
        !Number.isSafeInteger(a.expiresAt) || a.expiresAt <= time ||
        i.expiresAt <= time ||
        a.expiresAt - a.issuedAt > 900000
      ) deny();
      return {
        receiptId,
        bindingSha256: b.bindingSha256,
        scannerIdentity: a.issuer,
        scannerVersion: a.release,
        trustRevision: a.trustRevision,
        authorityRevision: v.authorityRevision,
        expiresAt: Math.min(
          a.expiresAt,
          i.expiresAt,
          frozen.admission.expiresAt,
        ),
      };
    },
  };
}
