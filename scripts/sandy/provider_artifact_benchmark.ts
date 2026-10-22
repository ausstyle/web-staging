/** Synthetic loopback custody HTTP through the actual artifact API handler. */
import {
  type ArtifactDependencies,
  createArtifactHandler,
} from "../../supabase/functions/sandy-provider-artifact-api/index.ts";
import {
  ARTIFACT_OPERATION,
  type Obj,
  SOURCE_OPERATIONS,
} from "../../supabase/functions/sandy-provider-artifact-api/contracts.ts";
import {
  bytesDigest,
  encode64,
} from "../../supabase/functions/sandy-provider-supplement-api/runtime.ts";
const actor = crypto.randomUUID(),
  admission = crypto.randomUUID(),
  id = crypto.randomUUID(),
  bytes = new Uint8Array(1048576),
  sha = await bytesDigest(bytes),
  base64 = encode64(bytes);
let executions = 0, requests = 0, peakRss = 0, peakHeap = 0;
const server = Deno.serve(
  { hostname: "127.0.0.1", port: 0, onListen() {} },
  async (request) => {
    requests++;
    const args = await request.json();
    return Response.json({
      custody_id: id,
      sha256: sha,
      byte_length: bytes.length,
      media_type: "application/octet-stream",
      content_base64: base64,
      source_operation: args.source_operation,
      source_input_sha256: args.source_input_sha256,
      source_scope_sha256: args.source_scope_sha256,
      artifact_class: "provider_download",
      consumed: true,
      content_returned: true,
    });
  },
);
const deps: ArtifactDependencies = {
  service: "synthetic-service",
  authorizeContext: async () => ({ allowed: true }),
  consumeGrant: async () => ({ allowed: true, admission_id: admission }),
  finishExecution: async () => ({ allowed: true }),
  deliver: async (_actor, _admission, args) => {
    const r = await fetch(
      `http://127.0.0.1:${server.addr.port}/synthetic-custody`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: args,
      },
    );
    return await r.json();
  },
};
try {
  const handler = createArtifactHandler(deps);
  for (let cycle = 0; cycle < 4; cycle++) {
    for (const source of SOURCE_OPERATIONS) {
      const args: Obj = {
        custody_id: id,
        expected_sha256: sha,
        source_operation: source,
        source_input_sha256: "a".repeat(64),
        source_scope_sha256: "b".repeat(64),
      };
      const response = await handler(
        new Request("https://synthetic.invalid", {
          method: "POST",
          headers: {
            authorization: "Bearer synthetic-service",
            "content-type": "application/json",
          },
          body: JSON.stringify({
            operation: ARTIFACT_OPERATION,
            arguments: args,
            actor_id: actor,
            tenant_id: null,
            grant_id: crypto.randomUUID(),
            request_id: crypto.randomUUID(),
          }),
        }),
      );
      const output = await response.json();
      if (
        response.status !== 200 || output.result.sha256 !== sha ||
        output.result.byte_length !== bytes.length
      ) {
        throw Error("synthetic_artifact_delivery_failed");
      }
      executions++;
      const m = Deno.memoryUsage();
      peakRss = Math.max(peakRss, m.rss);
      peakHeap = Math.max(peakHeap, m.heapUsed);
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  }
  console.log(JSON.stringify({
    passed: true,
    layer: "local_synthetic_custody_http",
    source_classes: 6,
    actual_handler_executions: executions,
    actual_http_requests: requests,
    payload_bytes: bytes.length,
    peak_rss: peakRss,
    peak_heap_used: peakHeap,
    provider_called: false,
    auth_session_tested: false,
    real_approval_tested: false,
    explicit_gc: false,
  }));
} finally {
  await server.shutdown();
}
