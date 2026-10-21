/** Local synthetic-provider regression and constrained-heap measurement.
 * No network/production requests, customer sessions or provider attestations.
 */
import assert from "node:assert/strict";
import {
  createProviderOperationHandler,
  type ProviderOperation,
  providerValidatorStats,
  validateProviderContract,
} from "../../supabase/functions/sandy-provider-operation-api/index.ts";
import {
  expandedProviderCatalogueStats,
  expansionOperationIndex,
  loadExpandedProviderOperation,
} from "../../supabase/functions/sandy-provider-operation-api/expansion.ts";
const ids = {
  actor: "10000000-0000-4000-8000-000000000001",
  request: "10000000-0000-4000-8000-000000000002",
  grant: "10000000-0000-4000-8000-000000000003",
  admission: "10000000-0000-4000-8000-000000000004",
};
let calls = 0, receipts = 0;
const handler = createProviderOperationHandler({
  service: "synthetic_internal_fixture",
  management: "synthetic_provider_fixture",
  github: "synthetic_provider_fixture",
  getGcpAccessToken: () => Promise.resolve("synthetic_provider_fixture"),
  authorizeContext: () => Promise.resolve({ allowed: true }),
  consumeGrant: () =>
    Promise.resolve({ allowed: true, admission_id: ids.admission }),
  finishExecution: () => {
    receipts++;
    return Promise.resolve({ allowed: true });
  },
  fetch: (() => {
    calls++;
    return Promise.resolve(Response.json({ name: "fixture", id: "123" }));
  }) as typeof fetch,
});
const server = Deno.args.includes("--http")
  ? Deno.serve({ hostname: "127.0.0.1", port: 0, onListen: () => {} }, handler)
  : null;
const endpoint = server
  ? `http://127.0.0.1:${server.addr.port}`
  : "https://local.invalid";
const invoke = server ? (request: Request) => fetch(request) : handler;
const cases: [string, Record<string, unknown>][] = [
  ["gcp.instance_group_managers.get", {
    path: { instanceGroupManager: "fixture" },
  }],
  ["gcp.cloud_run.services.revisions.list", {
    path: {
      parent:
        "projects/elaborate-haven-511518-a5/locations/europe-west1/services/fixture",
    },
  }],
  ["gcp.pubsub.subscriptions.iam_policy.get", {
    path: {
      resource: "projects/elaborate-haven-511518-a5/subscriptions/fixture",
    },
  }],
  ["github.repos.get_branch_protection", { path: { branch: "fixture" } }],
  ["gcp.instance_group_managers.create", { body: { name: "fixture" } }],
];
async function executeCases() {
  for (const [operation, args] of cases) {
    const response = await invoke(
      new Request(endpoint, {
        method: "POST",
        headers: { authorization: "Bearer synthetic_internal_fixture" },
        body: JSON.stringify({
          operation,
          arguments: args,
          actor_id: ids.actor,
          tenant_id: null,
          request_id: ids.request,
          grant_id: ids.grant,
        }),
      }),
    );
    const result = await response.json();
    assert.equal(
      response.status,
      200,
      operation + ":" + JSON.stringify(result),
    );
    assert.equal(
      result.request_state,
      operation.endsWith(".create") ? "accepted" : "observed",
    );
    assert.equal(
      JSON.stringify(result).includes("synthetic_provider_fixture"),
      false,
    );
  }
}
await executeCases();
let count = 0, peakRss = 0, peakHeap = 0;
if (Deno.args.includes("--all")) {
  for (const operation of Object.keys(expansionOperationIndex)) {
    const op = await loadExpandedProviderOperation(
      operation,
    ) as unknown as ProviderOperation;
    validateProviderContract(op);
    count++;
    const memory = Deno.memoryUsage();
    peakRss = Math.max(peakRss, memory.rss);
    peakHeap = Math.max(peakHeap, memory.heapUsed);
    if (count % 200 === 0) {
      console.log(
        JSON.stringify({
          phase: "bounded_schema_sweep",
          contracts: count,
          rss_bytes: memory.rss,
          heap_bytes: memory.heapUsed,
        }),
      );
    }
  }
}
await executeCases();
const memory = Deno.memoryUsage();
console.log(JSON.stringify({
  passed: true,
  layer: "local_synthetic_provider",
  real_provider_called: false,
  auth_session_tested: false,
  contracts_validated: count,
  handler_cases: cases.length * 2,
  provider_fixture_calls: calls,
  finish_receipts: receipts,
  peak_rss_bytes: Math.max(peakRss, memory.rss),
  peak_heap_used_bytes: Math.max(peakHeap, memory.heapUsed),
  final_memory: memory,
  decoded_cache: expandedProviderCatalogueStats(),
  validator_cache: providerValidatorStats(),
}));

if (server) await server.shutdown();
