/** Local synthetic KMS HTTP protocol/custody exercise; no provider/Auth evidence. */
import { createSensitiveHandler } from "../../supabase/functions/sandy-provider-sensitive-api/index.ts";
import { sensitiveContracts } from "../../supabase/functions/sandy-provider-sensitive-api/contracts.ts";
import { crc32c } from "../../supabase/functions/sandy-provider-sensitive-api/providers.ts";
import {
  bytesDigest,
  type Dependencies,
  encode64,
  validate,
} from "../../supabase/functions/sandy-provider-supplement-api/runtime.ts";
const material = new Uint8Array(65536);
material.fill(70);
const encoded = encode64(material),
  checksum = String(crc32c(material)),
  actor = crypto.randomUUID(),
  admission = crypto.randomUUID();
const resource =
  "projects/elaborate-haven-511518-a5/locations/europe-west1/keyRings/fixture/cryptoKeys/fixture";
let requests = 0, captures = 0, peakRss = 0, peakHeap = 0;
const sample = () => {
  const m = Deno.memoryUsage();
  peakRss = Math.max(peakRss, m.rss);
  peakHeap = Math.max(peakHeap, m.heapUsed);
};
const server = Deno.serve(
  { hostname: "127.0.0.1", port: 0, onListen() {} },
  async (req) => {
    if (
      req.headers.get("authorization") !== "Bearer synthetic-fixture-token"
    ) return new Response(null, { status: 403 });
    const body = await req.json();
    if (
      body.plaintext !== encoded || body.plaintextCrc32c !== checksum
    ) return new Response(null, { status: 400 });
    requests++;
    return Response.json({
      name: resource + "/cryptoKeyVersions/1",
      ciphertext: encoded,
      ciphertextCrc32c: checksum,
      verifiedPlaintextCrc32c: true,
    });
  },
);
const local = `http://127.0.0.1:${server.addr.port}`;
const deps: Dependencies = {
  service: "synthetic-fixture-service",
  authorizeContext: async () => ({ allowed: true }),
  consumeGrant: async () => ({ allowed: true, admission_id: admission }),
  finishExecution: async () => ({ allowed: true }),
  credentialForExecution: async () => "synthetic-fixture-token",
  fetch: (url, init) => fetch(local + new URL(url).pathname, init),
  saveOpaque: async (payload) => {
    if (
      payload.payload_sha256 !==
        await bytesDigest(
          Uint8Array.from(atob(payload.payload_base64), (c) => c.charCodeAt(0)),
        )
    ) throw Error("private_digest_mismatch");
    captures++;
    return {
      custody_id: crypto.randomUUID(),
      byte_length: payload.byte_length,
      sha256: payload.payload_sha256,
      media_type: payload.media_type,
      expires_at: new Date(Date.now() + 60000).toISOString(),
    };
  },
  takeOpaque: async () => {
    throw Error("not used");
  },
};
try {
  for (const op of Object.values(sensitiveContracts)) {
    validate(op.input_schema, {});
    validate(op.provider_response_schema, {});
    validate(op.output_schema, {});
    sample();
  }
  const handler = createSensitiveHandler(deps);
  for (let i = 0; i < 32; i++) {
    const response = await handler(
      new Request("https://synthetic.invalid", {
        method: "POST",
        headers: {
          authorization: "Bearer synthetic-fixture-service",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          operation: "gcp.kms.crypto_keys.encrypt.capture",
          arguments: { resource, body: { plaintext: encoded } },
          actor_id: actor,
          tenant_id: null,
          request_id: crypto.randomUUID(),
          grant_id: crypto.randomUUID(),
        }),
      }),
    );
    const result = await response.json();
    if (
      response.status !== 200 || result.result.content_returned !== false ||
      JSON.stringify(result).includes(encoded)
    ) throw Error("private_handler_protocol_failed");
    sample();
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  console.log(JSON.stringify({
    passed: true,
    layer: "local_synthetic_provider_http",
    schemas: 54,
    actual_handler_protocols: requests,
    private_captures: captures,
    crypto_input_bytes: material.length,
    peak_rss: peakRss,
    peak_heap_used: peakHeap,
    final_memory: Deno.memoryUsage(),
    external_provider_called: false,
    auth_session_tested: false,
    credential_activated: false,
    explicit_gc: false,
  }));
} finally {
  await server.shutdown();
}
