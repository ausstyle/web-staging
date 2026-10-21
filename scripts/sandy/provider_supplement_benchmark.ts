/** Local synthetic provider HTTP exercise; no real Auth/approval/provider evidence. */
import { createSupplementHandler } from "../../supabase/functions/sandy-provider-supplement-api/index.ts";
import {
  GCP_NUMBER,
  supplementContracts,
} from "../../supabase/functions/sandy-provider-supplement-api/contracts.ts";
import {
  bytesDigest,
  type Dependencies,
  encode64,
  validate,
} from "../../supabase/functions/sandy-provider-supplement-api/runtime.ts";
const actor = crypto.randomUUID(),
  admission = crypto.randomUUID(),
  body = new Uint8Array(1048576);
body.fill(70);
const sha = await bytesDigest(body), base64 = encode64(body);
let received = 0, peakRss = 0, peakHeap = 0;
const sample = () => {
  const m = Deno.memoryUsage();
  peakRss = Math.max(peakRss, m.rss);
  peakHeap = Math.max(peakHeap, m.heapUsed);
};
const server = Deno.serve(
  { hostname: "127.0.0.1", port: 0, onListen() {} },
  async (req) => {
    if (
      req.headers.get("authorization") !== "Bearer synthetic-provider-token"
    ) return new Response(null, { status: 403 });
    if (req.method === "GET") {
      return new URL(req.url).pathname.includes("/o/")
        ? new Response(body)
        : Response.json({ name: "fixture-bucket", projectNumber: GCP_NUMBER });
    }
    const bytes = new Uint8Array(await req.arrayBuffer());
    if (
      bytes.length !== body.length || await bytesDigest(bytes) !== sha
    ) return new Response(null, { status: 400 });
    received++;
    return Response.json({
      bucket: "fixture-bucket",
      name: "fixture/file",
      size: String(bytes.length),
      generation: "1",
    });
  },
);
const local = `http://127.0.0.1:${server.addr.port}`;
const deps: Dependencies = {
  service: "synthetic-private-service",
  authorizeContext: async () => ({ allowed: true }),
  consumeGrant: async () => ({ allowed: true, admission_id: admission }),
  finishExecution: async () => ({ allowed: true }),
  credentialForExecution: async () => "synthetic-provider-token",
  fetch: (url, init) =>
    fetch(local + new URL(url).pathname + new URL(url).search, init),
  saveOpaque: async () => {
    throw Error("not used");
  },
  takeOpaque: async () => {
    throw Error("not used");
  },
};
try {
  for (const op of Object.values(supplementContracts)) {
    validate(op.input_schema, {});
    validate(op.output_schema, {});
    sample();
  }
  const handler = createSupplementHandler(deps);
  for (let i = 0; i < 32; i++) {
    const request = new Request("https://synthetic.invalid", {
      method: "POST",
      headers: {
        authorization: "Bearer synthetic-private-service",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        operation: "gcp.storage.objects.upload.media",
        arguments: {
          bucket: "fixture-bucket",
          object_name: "fixture/file",
          if_generation_match: "0",
          content_base64: base64,
          sha256: sha,
          media_type: "application/octet-stream",
        },
        actor_id: actor,
        tenant_id: null,
        request_id: crypto.randomUUID(),
        grant_id: crypto.randomUUID(),
      }),
    });
    const response = await handler(request), result = await response.json();
    if (response.status !== 200 || result.result.source_sha256 !== sha) {
      throw Error("local_handler_transfer_failed");
    }
    sample();
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  console.log(
    JSON.stringify({
      passed: true,
      layer: "local_synthetic_provider_http",
      contract_schemas: Object.keys(supplementContracts).length * 2,
      one_mib_actual_handler_transfers: received,
      peak_rss: peakRss,
      peak_heap_used: peakHeap,
      final_memory: Deno.memoryUsage(),
      external_provider_called: false,
      auth_session_tested: false,
      explicit_gc: false,
    }),
  );
} finally {
  await server.shutdown();
}
