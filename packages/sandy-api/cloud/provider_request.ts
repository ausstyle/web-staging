/** Fixed GCS request construction for the EXISTING admitted provider executor.
 * Call after its policy/grant consumption and durable session/offset check.
 * This module supplies no credentials, fetch implementation or exposure route.
 */
import type { ProviderRequest } from "../../sandy-cloud/gcs_protocol.ts";
import {
  type AdmittedTransfer,
  cloudTransferContracts,
  cloudTransport,
} from "./transport.ts";
export async function buildAdmittedGcsRequest(
  input: AdmittedTransfer,
  signal: AbortSignal,
  now = Date.now,
): Promise<{ url: string; init: RequestInit }> {
  const deny = (): never => {
    throw Error("CLOUD_TRANSFER_CONTRACT_INVALID");
  };
  if (input.contractVersion !== "sandy.cloud.transfer.v1") deny();
  const operation =
    (Object.keys(cloudTransferContracts) as ProviderRequest["operation"][])
      .find((k) => cloudTransferContracts[k] === input.operation);
  if (!operation) deny();
  const s = Object.freeze({ ...input.scope }), body = input.body?.slice();
  if (input.offset !== s.offset || input.length !== (body?.length ?? 0)) deny();
  const upload = `https://storage.googleapis.com/upload/storage/v1/b/${
    encodeURIComponent(s.bucket)
  }/o`;
  let request: ProviderRequest;
  if (operation === "gcs.resumable.start") {
    const u = new URL(upload);
    u.searchParams.set("uploadType", "resumable");
    u.searchParams.set("name", s.key);
    u.searchParams.set("ifGenerationMatch", "0");
    request = {
      operation,
      method: "POST",
      url: u.href,
      headers: {
        "content-type": "application/json",
        "x-upload-content-length": String(s.size),
        "x-upload-content-type": "application/octet-stream",
      },
      body,
    };
  } else if (operation === "gcs.object.read") {
    const u = new URL(
      `https://storage.googleapis.com/download/storage/v1/b/${
        encodeURIComponent(s.bucket)
      }/o/${encodeURIComponent(s.key)}`,
    );
    u.searchParams.set("alt", "media");
    u.searchParams.set("generation", s.generation ?? "");
    request = {
      operation,
      method: "GET",
      url: u.href,
      headers: { "accept-encoding": "identity" },
      body,
    };
  } else {
    const length = body?.length ?? 0;
    request = {
      operation: operation!,
      method: "PUT",
      url: s.sessionUrl ?? "",
      body,
      headers: operation === "gcs.resumable.status"
        ? { "content-length": "0", "content-range": `bytes */${s.size}` }
        : {
          "content-type": "application/octet-stream",
          "content-length": String(length),
          "content-range": length
            ? `bytes ${s.offset}-${s.offset + length - 1}/${s.size}`
            : "bytes */0",
        },
    };
  }
  // Revalidate all structured fields at the provider boundary as well as at the
  // Cloud bridge. This callback is a local validator, never a provider dispatch.
  let validated = false;
  const expectedDigest = input.bodySha256;
  await cloudTransport(s, {
    execute: async (checked) => {
      if (checked.bodySha256 !== expectedDigest) deny();
      validated = true;
      return new Response(null, { status: 204 });
    },
  }, now)(request, signal);
  if (!validated) deny();
  return {
    url: request.url,
    init: {
      method: request.method,
      headers: { ...request.headers },
      ...(body ? { body } : {}),
      redirect: "error",
      signal,
    },
  };
}
