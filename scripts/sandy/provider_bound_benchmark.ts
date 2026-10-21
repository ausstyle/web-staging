/** Synthetic loopback provider exercise; no real provider/Auth/approval claim. */
import { createBoundHandler } from "../../supabase/functions/sandy-provider-bound-api/index.ts";
import {
  boundContracts,
  type Contract,
  type Obj,
} from "../../supabase/functions/sandy-provider-bound-api/contracts.ts";
import {
  argsFor,
  finalValue,
} from "../../supabase/functions/sandy-provider-bound-api/test_fixtures.ts";
import {
  type Dependencies,
  validate,
} from "../../supabase/functions/sandy-provider-supplement-api/runtime.ts";
const PROJECT = "elaborate-haven-511518-a5",
  SB = "zmqlyygzqoidkcwdysok",
  prefix = `projects/${PROJECT}/locations/europe-west1/`,
  actor = crypto.randomUUID(),
  admission = crypto.randomUUID();
let current: Contract,
  args: Obj,
  requests = 0,
  executions = 0,
  peakRss = 0,
  peakHeap = 0;
const sample = () => {
  const m = Deno.memoryUsage();
  peakRss = Math.max(peakRss, m.rss);
  peakHeap = Math.max(peakHeap, m.heapUsed);
};
const server = Deno.serve(
  { hostname: "127.0.0.1", port: 0, onListen() {} },
  async (req) => {
    requests++;
    if (
      req.headers.get("authorization") !== "Bearer synthetic-fixture-token"
    ) return new Response(null, { status: 403 });
    const url = new URL(req.url);
    await req.arrayBuffer();
    if (url.pathname === `/v1/projects/${SB}/branches`) {
      return Response.json([{
        id: "11111111-1111-4111-8111-111111111111",
        project_ref: "aaaaaaaaaaaaaaaaaaaa",
        parent_project_ref: SB,
        is_default: false,
      }]);
    }
    const bucket = url.pathname.match(/^\/storage\/v1\/b\/([^/]+)$/);
    if (bucket && req.method === "GET") {
      return Response.json({
        name: decodeURIComponent(bucket[1]),
        projectNumber: "1030223524306",
        generation: "1",
      });
    }
    if (
      url.pathname.match(/firewallPolicies\/(123|456)$/) && req.method === "GET"
    ) {
      return Response.json({
        id: url.pathname.endsWith("456") ? "456" : "123",
        parent: "folders/200",
        name: "fixture",
      });
    }
    if (
      current.service === "artifactregistry" && req.method === "GET"
    ) return Response.json({ name: prefix + "repositories/fixture" });
    if (current.service === "backupdr" && req.method === "GET") {
      return Response.json({
        name: prefix + "backupVaults/fixture/dataSources/fixture",
      });
    }
    if (current.private_diff_capture) {
      return new Response("CREATE TABLE synthetic_private(id bigint);", {
        headers: { "content-type": "text/plain" },
      });
    }
    const status = current.provider === "supabase" &&
        ["push", "merge", "reset", "restore"].some((name) =>
          current.operation.includes(`.${name}.`)
        )
      ? 201
      : 200;
    return Response.json(finalValue(current, args), { status });
  },
);
const local = `http://127.0.0.1:${server.addr.port}`,
  deps: Dependencies = {
    service: "synthetic-fixture-service",
    now: () => Date.parse("2026-10-21T01:00:00Z"),
    bindings: {
      organization: { id: "100", verified: true, project_id: PROJECT },
      folder: { id: "200", verified: true, project_id: PROJECT },
      destination_folder: { id: "300", verified: true, project_id: PROJECT },
    },
    authorizeContext: async () => ({ allowed: true }),
    consumeGrant: async () => ({ allowed: true, admission_id: admission }),
    finishExecution: async () => ({ allowed: true }),
    credentialForExecution: async () => "synthetic-fixture-token",
    fetch: (url, init) =>
      fetch(local + new URL(url).pathname + new URL(url).search, init),
    saveOpaque: async (p) => ({
      custody_id: crypto.randomUUID(),
      byte_length: p.byte_length,
      sha256: p.payload_sha256,
      media_type: p.media_type,
      expires_at: new Date(Date.parse("2026-10-21T01:00:00Z") + 60000)
        .toISOString(),
    }),
    takeOpaque: async () => {
      throw Error("not used");
    },
  };
try {
  for (const op of Object.values(boundContracts)) {
    validate(op.input_schema, {});
    validate(op.output_schema, {});
    for (const schema of Object.values(op.response_schemas)) {
      validate({ ...schema, $defs: op.$defs }, {});
    }
    sample();
  }
  const handler = createBoundHandler(deps);
  for (let cycle = 0; cycle < 2; cycle++) {
    for (const op of Object.values(boundContracts)) {
      current = op;
      args = argsFor(op);
      const response = await handler(
        new Request("https://synthetic.invalid", {
          method: "POST",
          headers: {
            authorization: "Bearer synthetic-fixture-service",
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
      const value = await response.json();
      if (response.status !== 200 || value.executed !== true) {
        throw Error(
          "local_bound_handler_failed " + op.operation + " " +
            JSON.stringify(value),
        );
      }
      executions++;
      sample();
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  }
  console.log(JSON.stringify({
    passed: true,
    layer: "local_synthetic_provider_http",
    methods: 48,
    actual_handler_executions: executions,
    actual_provider_http_requests: requests,
    peak_rss: peakRss,
    peak_heap_used: peakHeap,
    final_memory: Deno.memoryUsage(),
    provider_called: false,
    auth_session_tested: false,
    explicit_gc: false,
  }));
} finally {
  await server.shutdown();
}
