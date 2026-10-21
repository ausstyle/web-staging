/** Real loopback HTTP, synthetic policy/provider/custody; no external call. */
import { createSupplementHandler } from "../../supabase/functions/sandy-provider-supplement-api/index.ts";
import { supplementContracts } from "../../supabase/functions/sandy-provider-supplement-api/contracts.ts";
import {
  bytesDigest,
  type Dependencies,
} from "../../supabase/functions/sandy-provider-supplement-api/runtime.ts";
const actor = crypto.randomUUID(),
  admission = crypto.randomUUID(),
  bytes = new Uint8Array(1048576),
  digest = await bytesDigest(bytes);
let requests = 0, captures = 0, executions = 0, peakRss = 0, peakHeap = 0;
const sample = () => {
  const m = Deno.memoryUsage();
  peakRss = Math.max(peakRss, m.rss);
  peakHeap = Math.max(peakHeap, m.heapUsed);
};
const server = Deno.serve(
  { hostname: "127.0.0.1", port: 0, onListen() {} },
  (request) => {
    requests++;
    if (new URL(request.url).pathname.startsWith("/repos/")) {
      if (
        request.headers.get("authorization") !== "Bearer synthetic-fixture"
      ) return new Response(null, { status: 403 });
      return new Response(null, {
        status: 302,
        headers: {
          location:
            "https://syntheticaccount.blob.core.windows.net/private/artifact?sig=SYNTHETIC_PRIVATE_URL",
        },
      });
    }
    if (
      request.headers.has("authorization") || request.headers.has("cookie")
    ) return new Response(null, { status: 403 });
    return new Response(new Uint8Array(bytes), {
      headers: {
        "content-type": "application/zip",
        "content-length": String(bytes.length),
      },
    });
  },
);
const local = `http://127.0.0.1:${server.addr.port}`;
const deps: Dependencies = {
  service: "synthetic-service",
  authorizeContext: async () => ({ allowed: true }),
  consumeGrant: async () => ({ allowed: true, admission_id: admission }),
  credentialForExecution: async () => "synthetic-fixture",
  finishExecution: async () => ({ allowed: true }),
  fetch: (input, init) => {
    const u = new URL(String(input));
    return fetch(local + u.pathname + u.search, init);
  },
  saveOpaque: async (value) => {
    if (
      value.kind !== "artifact" || value.payload_sha256 !== digest ||
      value.byte_length !== 1048576 ||
      !value.target.startsWith(
        "https://api.github.com/repos/ausstyle/web-staging/",
      )
    ) throw Error("synthetic_private_capture_invariant");
    captures++;
    return {
      custody_id: crypto.randomUUID(),
      byte_length: value.byte_length,
      sha256: value.payload_sha256,
      media_type: value.media_type,
      expires_at: new Date(Date.now() + 60000).toISOString(),
    };
  },
  takeOpaque: async () => {
    throw Error("unused");
  },
};
try {
  const handler = createSupplementHandler(deps),
    ops = Object.values(supplementContracts).filter((op) =>
      op.kind.startsWith("download_")
    );
  for (let cycle = 0; cycle < 4; cycle++) {
    for (const op of ops) {
      const args = {
        ...(op.kind.includes("job") || op.kind === "download_step"
          ? { job_id: 1 }
          : {}),
        ...(op.kind === "download_step" ? { step_number: 1 } : {}),
        ...(op.kind.includes("run") || op.kind === "download_attempt"
          ? { run_id: 1 }
          : {}),
        ...(op.kind === "download_attempt" ? { attempt_number: 1 } : {}),
        ...(op.kind === "download_artifact" ? { artifact_id: 1 } : {}),
      };
      const r = await handler(
        new Request("https://synthetic.invalid", {
          method: "POST",
          headers: {
            authorization: "Bearer synthetic-service",
            "content-type": "application/json",
          },
          body: JSON.stringify({
            operation: op.operation,
            arguments: args,
            actor_id: actor,
            tenant_id: null,
            request_id: crypto.randomUUID(),
            grant_id: crypto.randomUUID(),
          }),
        }),
      );
      const v = await r.json();
      if (
        r.status !== 200 || v.executed !== true || v.result.sha256 !== digest
      ) throw Error("local_composed_download_failed");
      executions++;
      sample();
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  }
  console.log(JSON.stringify({
    passed: true,
    layer: "local_synthetic_provider_http",
    methods: 5,
    actual_handler_executions: executions,
    actual_http_requests: requests,
    private_captures: captures,
    payload_bytes: bytes.length,
    peak_rss: peakRss,
    peak_heap_used: peakHeap,
    provider_called: false,
    controller_session_tested: false,
    real_approval_tested: false,
    explicit_gc: false,
  }));
} finally {
  await server.shutdown();
}
