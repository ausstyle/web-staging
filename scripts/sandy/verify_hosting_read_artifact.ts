/** Offline import validation of privately extracted candidate module graphs.
 * Run without network/environment permissions. No handler or provider executes.
 */
import assert from "node:assert/strict";
const root = new URL(Deno.args[0]);
if (root.protocol !== "file:" || !root.pathname.endsWith("/")) {
  throw Error("private_artifact_directory_file_url_required");
}
const provider = await import(
  new URL(
    "sandy-provider-operation-api-modules/sandy-provider-operation-api/index.ts",
    root,
  ).href
);
assert.equal(provider.validateAllContracts(), 595);
assert.throws(() =>
  provider.bindProviderRequest(
    provider.providerOperations["gcp.cloud_run.services.list"],
    { region: "europe-west8" },
  )
);
const verifiedBindings = {
  cloud_run_read_region: {
    id: "europe-west8",
    project_id: "elaborate-haven-511518-a5",
    verified: true,
    expires_at: new Date(Date.now() + 3600000).toISOString(),
  },
};
assert.equal(
  provider.bindProviderRequest(
    provider.providerOperations["gcp.cloud_run.services.list"],
    { region: "europe-west8" },
    { verifiedBindings },
  ).pathname,
  "/v2/projects/elaborate-haven-511518-a5/locations/europe-west8/services",
);
const gateway = await import(
  new URL("sandy-operation-api-modules/sandy-operation-api/index.ts", root).href
);
assert.equal(typeof gateway.createOperationHandler, "function");
console.log(
  JSON.stringify({
    candidate_module_graphs_loaded: 2,
    compiled_contracts: 595,
    regional_binding_checks: 2,
    provider_requests: 0,
    database_requests: 0,
  }),
);
