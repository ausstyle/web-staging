import {
  type AuthenticatedCloudContext,
  cloudAdmissionHook,
  type LockedCloudAuthority,
} from "./admission.ts";
import {
  type AdmittedTransfer,
  cloudTransport,
  type TransferScope,
} from "./transport.ts";
import {
  type ProviderRequest,
  reconcileResumable,
  startResumable,
  uploadChunk,
  verifyUploaded,
} from "../../sandy-cloud/gcs_protocol.ts";
import type { UploadIntent } from "../../sandy-cloud/integrity.ts";
const assert = (v: unknown) => {
  if (!v) throw Error("assertion failed");
};
async function denied(fn: () => unknown) {
  let threw = false;
  try {
    await fn();
  } catch {
    threw = true;
  }
  assert(threw);
}
const context: AuthenticatedCloudContext = {
  actorId: "actor",
  apiTenantId: "tenant",
  sessionId: "session",
  deviceId: "device",
  companyId: "company",
  admissionId: "admission",
};
const authority = (): LockedCloudAuthority => ({
  ...context,
  customerId: "different-customer",
  workspaceId: "workspace",
  policyEpoch: 7,
  expiresAt: 1000,
  revoked: false,
  tenantCustomerLinked: true,
  portalCustomerLinked: true,
  deviceAllowed: true,
  companyAllowed: true,
  uploadAllowed: true,
});
const intent = (): UploadIntent => ({
  id: "intent",
  actorId: "actor",
  traceId: "trace",
  idempotencyKey: "nonce",
  expiresAt: 1000,
  expectedRevision: 0,
  ref: {
    tenantId: "tenant",
    workspaceId: "workspace",
    bucket: "test-bucket",
    key: "prefix/file",
    size: 3,
    sha256: "a".repeat(64),
    generation: "1",
  },
});
Deno.test("identity binding uses explicit relation, same transaction, fresh lock on every replay", async () => {
  const tx = { query: async () => ({ rows: [] }) };
  let calls = 0;
  const hook = cloudAdmissionHook(context, {
    lock: async (actual, c, w) => {
      assert(actual === tx && c !== context && w === "workspace");
      calls++;
      return authority();
    },
  }, () => 10);
  assert((await hook(tx, intent())).customerId === "different-customer");
  await hook(tx, intent());
  assert(calls === 2);
});
Deno.test("identity denies all mismatched and revoked authority fields", async () => {
  const invalid: Partial<LockedCloudAuthority>[] = [
    { actorId: "foreign" },
    { apiTenantId: "foreign" },
    { sessionId: "foreign" },
    { deviceId: null },
    { companyId: null },
    { admissionId: "foreign" },
    { workspaceId: "foreign" },
    { customerId: "" },
    { policyEpoch: 0 },
    { policyEpoch: 1.5 },
    { expiresAt: 10 },
    { revoked: true },
    { tenantCustomerLinked: false },
    { portalCustomerLinked: false },
    { deviceAllowed: false },
    { companyAllowed: false },
    { uploadAllowed: false },
  ];
  for (const patch of invalid) {
    await denied(() =>
      cloudAdmissionHook(context, {
        lock: async () => ({ ...authority(), ...patch }),
      }, () => 10)({ query: async () => ({ rows: [] }) }, intent())
    );
  }
  await denied(() =>
    cloudAdmissionHook(context, { lock: async () => null }, () => 10)({
      query: async () => ({ rows: [] }),
    }, intent())
  );
});
Deno.test("identity rejects foreign intent before owner and snapshots authenticated context", async () => {
  const c = { ...context };
  let calls = 0;
  const hook = cloudAdmissionHook(c, {
    lock: async () => {
      calls++;
      return authority();
    },
  }, () => 10);
  c.actorId = "evil";
  const i = intent();
  i.actorId = "evil";
  await denied(() => hook({ query: async () => ({ rows: [] }) }, i));
  assert(calls === 0);
  i.actorId = "actor";
  i.ref.tenantId = "different-customer";
  await denied(() => hook({ query: async () => ({ rows: [] }) }, i));
  assert(calls === 0);
  await hook({ query: async () => ({ rows: [] }) }, intent());
  assert(calls === 1);
});
const scope = (): TransferScope => ({
  tenantId: "tenant",
  workspaceId: "workspace",
  intentId: "intent",
  admissionId: "admission",
  objectPrefix: "prefix/",
  bucket: "test-bucket",
  key: "prefix/file",
  size: 3,
  sha256: "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
  offset: 0,
  expiresAt: 1000,
});
const sessionUrl =
  "https://storage.googleapis.com/upload/storage/v1/b/test-bucket/o?uploadType=resumable&upload_id=opaque";
const policy = () => ({
  tenantId: "tenant",
  workspaceId: "workspace",
  allowedBuckets: new Set(["test-bucket"]),
  maxBytes: 100,
  signal: new AbortController().signal,
});
Deno.test("Cloud protocol composes with structured admission start/chunk/status/generation read", async () => {
  const requests: AdmittedTransfer[] = [];
  const executor = {
    execute: async (r: AdmittedTransfer) => {
      requests.push(r);
      if (r.operation.endsWith("start")) {
        return new Response(null, {
          headers: { location: sessionUrl },
        });
      }
      if (r.operation.endsWith("status")) {
        return new Response(null, {
          status: 308,
        });
      }
      if (r.operation.endsWith("chunk")) {
        return Response.json({
          bucket: r.scope.bucket,
          name: r.scope.key,
          size: "3",
          generation: "42",
        });
      }
      return new Response("abc", { headers: { "x-goog-generation": "42" } });
    },
  };
  const p = policy(), s = scope();
  const started = await startResumable(
    s,
    p,
    cloudTransport(s, executor, () => 10),
  );
  const active = { ...s, sessionUrl: started.sessionUrl };
  const reconciled = await reconcileResumable(
    { ...started, state: "RECONCILE_REQUIRED" },
    p,
    cloudTransport(active, executor, () => 10),
  );
  const uploaded = await uploadChunk(
    reconciled,
    new TextEncoder().encode("abc"),
    p,
    cloudTransport(active, executor, () => 10),
  );
  const proof = await verifyUploaded(
    uploaded,
    p,
    cloudTransport(
      { ...active, generation: uploaded.generation },
      executor,
      () => 10,
    ),
  );
  assert(
    proof.state === "BYTES_VERIFIED" && proof.bytesRead === 3 &&
      requests.length === 4,
  );
  assert(requests[2].bodySha256 === s.sha256);
  assert(
    requests.every((r) =>
      r.scope.tenantId === "tenant" &&
      r.contractVersion === "sandy.cloud.transfer.v1"
    ),
  );
});
const startRequest = (): ProviderRequest => ({
  operation: "gcs.resumable.start",
  method: "POST",
  url:
    "https://storage.googleapis.com/upload/storage/v1/b/test-bucket/o?uploadType=resumable&name=prefix%2Ffile&ifGenerationMatch=0",
  headers: {
    "content-type": "application/json",
    "x-upload-content-length": "3",
    "x-upload-content-type": "application/octet-stream",
  },
  body: new TextEncoder().encode("{}"),
});
Deno.test("transfer rejects altered URL, query duplicates, headers, bytes before executor", async () => {
  let calls = 0;
  const t = cloudTransport(scope(), {
    execute: async () => {
      calls++;
      return new Response();
    },
  }, () => 10);
  const changes: ((r: ProviderRequest) => void)[] = [
    (r) => r.url = r.url.replace("storage.googleapis.com", "evil.invalid"),
    (r) => r.url += "&name=other",
    (r) => r.url = r.url.replace("Match=0", "Match=1"),
    (r) => r.url = r.url.replace("prefix%2Ffile", "elsewhere"),
    (r) => r.headers.authorization = "secret",
    (r) => r.body = new TextEncoder().encode('{"name":"other"}'),
    (r) => r.method = "GET",
    (r) => r.url += "#fragment",
  ];
  for (const change of changes) {
    const r = startRequest();
    change(r);
    await denied(() => t(r, policy().signal));
  }
  assert(calls === 0);
});
Deno.test("transfer rejects expired, aborted and cross-prefix scope", async () => {
  let calls = 0;
  const e = {
    execute: async () => {
      calls++;
      return new Response();
    },
  };
  await denied(() => cloudTransport({ ...scope(), key: "foreign/file" }, e));
  await denied(() =>
    cloudTransport(scope(), e, () => 1000)(startRequest(), policy().signal)
  );
  await denied(() =>
    cloudTransport(scope(), e, () => 10)(startRequest(), AbortSignal.abort())
  );
  assert(calls === 0);
});
Deno.test("transfer unknown outcome is propagated once; no automatic retry", async () => {
  let calls = 0;
  const t = cloudTransport(scope(), {
    execute: async () => {
      calls++;
      throw Error("unknown acknowledgement");
    },
  }, () => 10);
  await denied(() => t(startRequest(), policy().signal));
  assert(calls === 1);
});
Deno.test("transfer refuses caller-swapped session, offset, generation and extra query", async () => {
  let calls = 0;
  const e = {
    execute: async () => {
      calls++;
      return new Response();
    },
  };
  const t = cloudTransport({ ...scope(), sessionUrl }, e, () => 10);
  const chunk: ProviderRequest = {
    operation: "gcs.resumable.chunk",
    method: "PUT",
    url: sessionUrl,
    headers: {
      "content-type": "application/octet-stream",
      "content-length": "3",
      "content-range": "bytes 0-2/3",
    },
    body: new TextEncoder().encode("abc"),
  };
  await denied(() =>
    t(
      { ...chunk, url: sessionUrl.replace("opaque", "another") },
      policy().signal,
    )
  );
  await denied(() =>
    t({
      ...chunk,
      headers: { ...chunk.headers, "content-range": "bytes 1-3/3" },
    }, policy().signal)
  );
  const read: ProviderRequest = {
    operation: "gcs.object.read",
    method: "GET",
    url:
      "https://storage.googleapis.com/download/storage/v1/b/test-bucket/o/prefix%2Ffile?alt=media&generation=42",
    headers: { "accept-encoding": "identity" },
  };
  await denied(() =>
    cloudTransport({ ...scope(), generation: "41" }, e, () => 10)(
      read,
      policy().signal,
    )
  );
  await denied(() =>
    cloudTransport({ ...scope(), generation: "42" }, e, () => 10)({
      ...read,
      url: read.url += "&userProject=other",
    }, policy().signal)
  );
  assert(calls === 0);
});
Deno.test("transfer snapshots bytes and operation before async hashing and rechecks expiry", async () => {
  let captured: AdmittedTransfer | undefined;
  const s = scope(), r = startRequest();
  const pending = cloudTransport(s, {
    execute: async (input) => {
      captured = input;
      return new Response();
    },
  }, () => 10)(r, policy().signal);
  r.operation = "gcs.object.read";
  r.body!.fill(0);
  s.key = "foreign/file";
  await pending;
  assert(captured?.operation === "gcp.storage.objects.upload.resumable.start");
  assert(new TextDecoder().decode(captured?.body) === "{}");
  assert(captured?.scope.key === "prefix/file");
  let clock = 0, calls = 0;
  const t = cloudTransport(scope(), {
    execute: async () => {
      calls++;
      return new Response();
    },
  }, () => ++clock === 1 ? 10 : 1000);
  await denied(() => t(startRequest(), policy().signal));
  assert(calls === 0);
});
