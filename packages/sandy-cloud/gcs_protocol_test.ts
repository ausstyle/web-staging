import { deepStrictEqual, ok, rejects } from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  type ProviderRequest,
  reconcileResumable,
  startResumable,
  type UploadBinding,
  uploadChunk,
  type UploadSession,
  verifyUploaded,
} from "./gcs_protocol.ts";
import { type ReadPolicy } from "./integrity.ts";
const bytes = new TextEncoder().encode("synthetic"),
  sha = createHash("sha256").update(bytes).digest("hex");
const target: UploadBinding = {
  tenantId: "a",
  workspaceId: "w",
  bucket: "synthetic-bucket",
  key: "opaque/key",
  size: bytes.length,
  sha256: sha,
};
const policy = (): ReadPolicy => ({
  tenantId: "a",
  workspaceId: "w",
  allowedBuckets: new Set([target.bucket]),
  maxBytes: 10 * 1024 ** 3,
  signal: new AbortController().signal,
});
const url =
  "https://storage.googleapis.com/upload/storage/v1/b/synthetic-bucket/o?uploadType=resumable&upload_id=synthetic-only";
Deno.test("GCS source adapter pins create precondition and validates server session host", async () => {
  const s = await startResumable(target, policy(), async (request) => {
    ok(request.url.includes("ifGenerationMatch=0"));
    return new Response(null, { status: 200, headers: { location: url } });
  });
  deepStrictEqual(s.offset, 0);
  await rejects(
    startResumable(target, policy(), async () =>
      new Response(null, {
        headers: { location: "https://attacker.invalid/upload" },
      })),
    /INVALID_PROVIDER_SESSION/,
  );
});
Deno.test("lost GCS acknowledgement forces status reconciliation before resend", async () => {
  const s: UploadSession = {
    binding: target,
    sessionUrl: url,
    offset: 0,
    state: "UPLOADING",
  };
  let requests = 0;
  const unknown = await uploadChunk(s, bytes, policy(), async () => {
    requests++;
    throw Error("connection lost");
  });
  deepStrictEqual(unknown.state, "RECONCILE_REQUIRED");
  await rejects(
    uploadChunk(unknown, bytes, policy(), async () => {
      requests++;
      return new Response();
    }),
    /RECONCILIATION_REQUIRED/,
  );
  deepStrictEqual(requests, 1);
  const reconciled = await reconcileResumable(unknown, policy(), async (r) => {
    deepStrictEqual(r.operation, "gcs.resumable.status");
    return Response.json({
      bucket: target.bucket,
      name: target.key,
      size: String(bytes.length),
      generation: "123",
    });
  });
  deepStrictEqual(reconciled.state, "UPLOADED_UNVERIFIED");
  const verified = await verifyUploaded(
    reconciled,
    policy(),
    async (request) => {
      ok(request.url.includes("generation=123"));
      return new Response(bytes, { headers: { "x-goog-generation": "123" } });
    },
  );
  deepStrictEqual(verified.state, "BYTES_VERIFIED");
  await rejects(
    verifyUploaded(
      reconciled,
      policy(),
      async () =>
        new Response(new Uint8Array(bytes.length), {
          headers: { "x-goog-generation": "123" },
        }),
    ),
    /CHECKSUM_MISMATCH/,
  );
});
Deno.test("10 GiB offset arithmetic supports bounded aligned chunks and rejects forged readback", async () => {
  const s: UploadSession = {
      binding: { ...target, size: 10 * 1024 ** 3 },
      sessionUrl: url,
      offset: 9 * 1024 ** 3,
      state: "UPLOADING",
    },
    chunk = new Uint8Array(256 * 1024);
  let observed: ProviderRequest | null = null;
  const result = await uploadChunk(s, chunk, policy(), async (r) => {
    observed = r;
    return new Response(null, {
      status: 308,
      headers: { range: `bytes=0-${s.offset + chunk.length - 1}` },
    });
  });
  deepStrictEqual(result.offset, s.offset + chunk.length);
  ok(observed);
  await rejects(
    uploadChunk(s, new Uint8Array(1), policy(), async () => new Response()),
    /INVALID_CHUNK/,
  );
  await rejects(
    reconcileResumable(
      s,
      policy(),
      async () =>
        new Response(null, { status: 308, headers: { range: "bytes=0-3" } }),
    ),
    /PROVIDER_OFFSET_REGRESSION/,
  );
});
