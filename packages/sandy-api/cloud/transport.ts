/** Closed candidate contracts behind the existing API admission/executor. No
 * fetch, credential broker, registry mutation or fallback provider path.
 * The Cloud adapter's protocol labels are not published operation aliases.
 */
import type {
  AdmittedTransport,
  ProviderRequest,
  UploadBinding,
} from "../../sandy-cloud/gcs_protocol.ts";
export const cloudTransferContracts = Object.freeze(
  {
    "gcs.resumable.start": "gcp.storage.objects.upload.resumable.start",
    "gcs.resumable.chunk": "gcp.storage.objects.upload.resumable.chunk",
    "gcs.resumable.status": "gcp.storage.objects.upload.resumable.status",
    "gcs.object.read": "gcp.storage.objects.read.media",
  } as const,
);
export interface TransferScope extends UploadBinding {
  intentId: string;
  admissionId: string;
  objectPrefix: string;
  expiresAt: number;
  /** Durable server-owned session reference; never returned to public callers. */
  sessionUrl?: string;
  generation?: string;
  offset: number;
}
export interface AdmittedTransfer {
  contractVersion: "sandy.cloud.transfer.v1";
  operation: typeof cloudTransferContracts[keyof typeof cloudTransferContracts];
  scope: Readonly<TransferScope>;
  bodySha256: string;
  body?: Uint8Array;
  offset: number;
  length: number;
}
export interface ExistingTransferExecutor {
  /** Resolve these CLOSED candidate IDs only after reviewed registration. Run
   * ordinary current-policy/contract/expiry checks and consume a one-use grant
   * bound to the entire scope + body digest before dispatch. Persist receipts;
   * unknown writes require status reconciliation, never automatic retry.
   * Build fixed GCS URL/headers here from structured scope, redirect:error.
   * Revalidate server-owned session custody and durable offset atomically.
   */
  execute(request: AdmittedTransfer, signal: AbortSignal): Promise<Response>;
}
const invalid = (): never => {
  throw new Error("CLOUD_TRANSFER_SCOPE_DENIED");
};
function exactHeaders(
  request: Readonly<ProviderRequest>,
  expected: Record<string, string>,
) {
  const keys = Object.keys(request.headers).sort();
  if (
    JSON.stringify(keys) !== JSON.stringify(Object.keys(expected).sort()) ||
    keys.some((k) => request.headers[k] !== expected[k])
  ) invalid();
}
function url(value: string): URL {
  let u: URL;
  try {
    u = new URL(value);
  } catch {
    return invalid();
  }
  if (
    u.protocol !== "https:" || u.host !== "storage.googleapis.com" ||
    u.username || u.password || u.hash
  ) invalid();
  return u;
}
function query(u: URL, expected: Record<string, string>) {
  if (
    [...u.searchParams].length !== Object.keys(expected).length ||
    Object.entries(expected).some(([k, v]) => u.searchParams.get(k) !== v)
  ) invalid();
}
/** One immutable scope per call. Runtime loads session/offset from its durable
 * intent custody; caller JSON cannot supply scope or executor. The existing
 * executor still admits each request; constructing this adapter grants nothing.
 */
export function cloudTransport(
  scope: TransferScope,
  executor: ExistingTransferExecutor,
  now = Date.now,
): AdmittedTransport {
  const s = Object.freeze({ ...scope });
  if (
    ![s.tenantId, s.workspaceId, s.intentId, s.admissionId].every((v) =>
      typeof v === "string" && v.length > 0 && v.length <= 1024
    ) ||
    !/^[a-z0-9][a-z0-9._-]{1,220}[a-z0-9]$/.test(s.bucket) ||
    !s.objectPrefix || !s.objectPrefix.endsWith("/") ||
    !s.key.startsWith(s.objectPrefix) ||
    s.key.length > 1024 || /[\u0000-\u001f\u007f]/.test(s.key) ||
    !/^[a-f0-9]{64}$/.test(s.sha256) || !Number.isSafeInteger(s.size) ||
    s.size < 0 ||
    !Number.isSafeInteger(s.offset) || s.offset < 0 || s.offset > s.size ||
    !Number.isSafeInteger(s.expiresAt)
  ) invalid();
  return async (r, signal) => {
    signal.throwIfAborted();
    const operation = r.operation;
    if (
      now() >= s.expiresAt ||
      !Object.hasOwn(cloudTransferContracts, operation)
    ) invalid();
    const u = url(r.url);
    const upload = `/upload/storage/v1/b/${encodeURIComponent(s.bucket)}/o`;
    // Copy bytes before any await so a caller cannot change the admitted body.
    const body = r.body?.slice();
    if (body && body.length > 8 * 1024 * 1024) invalid();
    const length = body?.length ?? 0;
    if (operation === "gcs.resumable.start") {
      if (
        r.method !== "POST" || u.pathname !== upload || s.sessionUrl ||
        s.offset !== 0 || new TextDecoder().decode(body) !== "{}"
      ) invalid();
      query(u, {
        uploadType: "resumable",
        name: s.key,
        ifGenerationMatch: "0",
      });
      exactHeaders(r, {
        "content-type": "application/json",
        "x-upload-content-length": String(s.size),
        "x-upload-content-type": "application/octet-stream",
      });
    } else if (operation === "gcs.object.read") {
      if (
        r.method !== "GET" || body !== undefined || !s.generation ||
        !/^[1-9][0-9]{0,39}$/.test(s.generation) ||
        u.pathname !==
          `/download/storage/v1/b/${encodeURIComponent(s.bucket)}/o/${
            encodeURIComponent(s.key)
          }`
      ) invalid();
      query(u, { alt: "media", generation: s.generation! });
      exactHeaders(r, { "accept-encoding": "identity" });
    } else {
      if (
        r.method !== "PUT" || !s.sessionUrl ||
        u.href !== url(s.sessionUrl).href || u.pathname !== upload || !body
      ) invalid();
      query(u, {
        uploadType: "resumable",
        upload_id: u.searchParams.get("upload_id") ?? "",
      });
      if (!u.searchParams.get("upload_id")) invalid();
      if (operation === "gcs.resumable.status") {
        if (length !== 0) invalid();
        exactHeaders(r, {
          "content-length": "0",
          "content-range": `bytes */${s.size}`,
        });
      } else {
        const end = s.offset + length;
        if (
          end > s.size || (!length && s.size !== 0) ||
          (end < s.size && length % (256 * 1024) !== 0)
        ) invalid();
        exactHeaders(r, {
          "content-type": "application/octet-stream",
          "content-length": String(length),
          "content-range": length
            ? `bytes ${s.offset}-${end - 1}/${s.size}`
            : "bytes */0",
        });
      }
    }
    const digest = Array.from(
      new Uint8Array(
        await crypto.subtle.digest("SHA-256", body ?? new Uint8Array()),
      ),
      (b) => b.toString(16).padStart(2, "0"),
    ).join("");
    signal.throwIfAborted();
    if (now() >= s.expiresAt) invalid();
    return await executor.execute({
      contractVersion: "sandy.cloud.transfer.v1",
      operation: cloudTransferContracts[operation],
      scope: s,
      bodySha256: digest,
      ...(body ? { body } : {}),
      offset: s.offset,
      length,
    }, signal);
  };
}
