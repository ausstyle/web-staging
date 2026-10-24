/** GCS protocol adapter source only. The release owner must provide an admitted
 * existing provider transport; this module never obtains credentials or fetches
 * an arbitrary URL. No provider invocation occurs in the local fixture app.
 */
import { type ObjectRef, type ReadPolicy, verifyObject } from "./integrity.ts";
export interface ProviderRequest {
  operation:
    | "gcs.resumable.start"
    | "gcs.resumable.chunk"
    | "gcs.resumable.status"
    | "gcs.object.read";
  method: "POST" | "PUT" | "GET";
  url: string;
  headers: Record<string, string>;
  body?: Uint8Array;
}
export type AdmittedTransport = (
  request: Readonly<ProviderRequest>,
  signal: AbortSignal,
) => Promise<Response>;
export interface UploadBinding {
  tenantId: string;
  workspaceId: string;
  bucket: string;
  key: string;
  size: number;
  sha256: string;
}
export interface UploadSession {
  binding: UploadBinding;
  sessionUrl: string;
  offset: number;
  state: "UPLOADING" | "RECONCILE_REQUIRED" | "UPLOADED_UNVERIFIED";
  generation?: string;
}
export class TransferError extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}
const bad = (code: string): never => {
  throw new TransferError(code);
};
function binding(value: UploadBinding, policy: ReadPolicy) {
  if (
    value.tenantId !== policy.tenantId ||
    value.workspaceId !== policy.workspaceId ||
    !policy.allowedBuckets.has(value.bucket)
  ) bad("NOT_FOUND");
  if (
    !Number.isSafeInteger(value.size) || value.size < 0 ||
    value.size > policy.maxBytes || !/^[a-f0-9]{64}$/.test(value.sha256) ||
    !value.key || value.key.length > 1024
  ) bad("INVALID_TRANSFER");
  if (
    !/^[a-z0-9][a-z0-9._-]{1,220}[a-z0-9]$/.test(value.bucket) ||
    /[\u0000-\u001f\u007f]/.test(value.key)
  ) bad("INVALID_TRANSFER");
}
function sessionUrl(value: string, bucket: string): string {
  const url = new URL(value);
  if (
    url.protocol !== "https:" || url.username || url.password || url.hash ||
    url.port || url.hostname !== "storage.googleapis.com" ||
    url.pathname !== `/upload/storage/v1/b/${encodeURIComponent(bucket)}/o` ||
    url.searchParams.get("uploadType") !== "resumable" ||
    !url.searchParams.get("upload_id")
  ) bad("INVALID_PROVIDER_SESSION");
  return url.href;
}
function acknowledged(response: Response, size: number): number {
  const range = response.headers.get("range");
  if (!range) return 0;
  const match = /^bytes=0-([0-9]+)$/.exec(range);
  if (!match) bad("INVALID_PROVIDER_RANGE");
  const end = Number(match![1]);
  if (!Number.isSafeInteger(end) || end < 0 || end >= size) {
    bad("INVALID_PROVIDER_RANGE");
  }
  return end + 1;
}
async function outcome(
  session: UploadSession,
  response: Response,
): Promise<UploadSession> {
  if (response.status === 308) {
    const offset = acknowledged(response, session.binding.size);
    if (offset < session.offset) bad("PROVIDER_OFFSET_REGRESSION");
    return { ...session, offset, state: "UPLOADING" };
  }
  if (response.status === 200 || response.status === 201) {
    let value: any;
    try {
      value = await response.json();
    } catch {
      return bad("INVALID_PROVIDER_RESULT");
    }
    if (
      value.bucket !== session.binding.bucket ||
      value.name !== session.binding.key ||
      String(value.size) !== String(session.binding.size) ||
      typeof value.generation !== "string" ||
      !/^[1-9][0-9]*$/.test(value.generation)
    ) bad("PROVIDER_OBJECT_MISMATCH");
    return {
      ...session,
      offset: session.binding.size,
      state: "UPLOADED_UNVERIFIED",
      generation: value.generation,
    };
  }
  if (response.status === 404 || response.status === 410) {
    bad("SESSION_EXPIRED");
  }
  // Includes throttling/server errors: bytes may have reached the provider. Do
  // not resend until status reconciliation returns an authoritative offset.
  return { ...session, state: "RECONCILE_REQUIRED" };
}
export async function startResumable(
  input: UploadBinding,
  policy: ReadPolicy,
  transport: AdmittedTransport,
): Promise<UploadSession> {
  const target = Object.freeze({ ...input });
  binding(target, policy);
  policy.signal.throwIfAborted();
  const url = new URL(
    `https://storage.googleapis.com/upload/storage/v1/b/${
      encodeURIComponent(target.bucket)
    }/o`,
  );
  url.searchParams.set("uploadType", "resumable");
  url.searchParams.set("name", target.key);
  url.searchParams.set("ifGenerationMatch", "0");
  const response = await transport({
    operation: "gcs.resumable.start",
    method: "POST",
    url: url.href,
    headers: {
      "content-type": "application/json",
      "x-upload-content-length": String(target.size),
      "x-upload-content-type": "application/octet-stream",
    },
    body: new TextEncoder().encode("{}"),
  }, policy.signal);
  if (response.status !== 200 && response.status !== 201) {
    bad("SESSION_START_UNCONFIRMED");
  }
  const location = response.headers.get("location");
  if (!location) bad("MISSING_PROVIDER_SESSION");
  return {
    binding: { ...target },
    sessionUrl: sessionUrl(location!, target.bucket),
    offset: 0,
    state: "UPLOADING",
  };
}
export async function reconcileResumable(
  session: UploadSession,
  policy: ReadPolicy,
  transport: AdmittedTransport,
): Promise<UploadSession> {
  binding(session.binding, policy);
  policy.signal.throwIfAborted();
  const url = sessionUrl(session.sessionUrl, session.binding.bucket);
  try {
    return await outcome(
      session,
      await transport({
        operation: "gcs.resumable.status",
        method: "PUT",
        url,
        headers: {
          "content-length": "0",
          "content-range": `bytes */${session.binding.size}`,
        },
        body: new Uint8Array(),
      }, policy.signal),
    );
  } catch (e) {
    if (e instanceof TransferError) throw e;
    return { ...session, state: "RECONCILE_REQUIRED" };
  }
}
export async function uploadChunk(
  session: UploadSession,
  bytes: Uint8Array,
  policy: ReadPolicy,
  transport: AdmittedTransport,
): Promise<UploadSession> {
  binding(session.binding, policy);
  policy.signal.throwIfAborted();
  const url = sessionUrl(session.sessionUrl, session.binding.bucket);
  if (
    session.state !== "UPLOADING" || !Number.isSafeInteger(session.offset) ||
    session.offset < 0 || session.offset > session.binding.size
  ) bad("RECONCILIATION_REQUIRED");
  const end = session.offset + bytes.length;
  if (
    end > session.binding.size || bytes.length > 8 * 1024 * 1024 ||
    (bytes.length === 0 && session.binding.size !== 0) ||
    (end < session.binding.size && bytes.length % (256 * 1024) !== 0)
  ) bad("INVALID_CHUNK");
  const range = bytes.length
    ? `bytes ${session.offset}-${end - 1}/${session.binding.size}`
    : "bytes */0";
  try {
    const result = await outcome(
      session,
      await transport({
        operation: "gcs.resumable.chunk",
        method: "PUT",
        url,
        headers: {
          "content-type": "application/octet-stream",
          "content-length": String(bytes.length),
          "content-range": range,
        },
        body: bytes,
      }, policy.signal),
    );
    if (result.offset > end) bad("PROVIDER_OFFSET_AHEAD");
    return result;
  } catch (e) {
    if (e instanceof TransferError) throw e;
    return { ...session, state: "RECONCILE_REQUIRED" };
  }
}
export async function verifyUploaded(
  session: UploadSession,
  policy: ReadPolicy,
  transport: AdmittedTransport,
) {
  binding(session.binding, policy);
  if (session.state !== "UPLOADED_UNVERIFIED" || !session.generation) {
    bad("TRANSFER_INCOMPLETE");
  }
  const ref: ObjectRef = {
    ...session.binding,
    generation: session.generation!,
  };
  return await verifyObject(ref, policy, async (target, signal) => {
    const url = new URL(
      `https://storage.googleapis.com/download/storage/v1/b/${
        encodeURIComponent(target.bucket)
      }/o/${encodeURIComponent(target.key)}`,
    );
    url.searchParams.set("alt", "media");
    url.searchParams.set("generation", target.generation);
    const response = await transport({
      operation: "gcs.object.read",
      method: "GET",
      url: url.href,
      headers: { "accept-encoding": "identity" },
    }, signal);
    if (
      response.status !== 200 || !response.body ||
      response.headers.get("x-goog-generation") !== target.generation ||
      response.headers.get("content-encoding")
    ) {
      await response.body?.cancel();
      bad("UNVERIFIED_PROVIDER_READ");
    }
    return { ref: { ...target }, body: response.body! };
  });
}
