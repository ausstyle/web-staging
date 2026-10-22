/** Bounded manifest contracts. No payload or arbitrary table names enter the gateway. */
import catalogue from "./contracts.json" with { type: "json" };
export type JsonObject = Record<string, unknown>;
export const tenantLifecycleHandler = "sandy-tenant-lifecycle-api";
export const tenantLifecycleScope = Object.freeze({
  provider: "supabase",
  project_ref: "zmqlyygzqoidkcwdysok",
  manifest: "application_leaf_links_v1",
  complete_tenant_coverage: false,
});
export const tenantLifecycleOperations = Object.freeze(
  Object.fromEntries(catalogue.operations.map((op) => [op.operation, op])),
);
export const tenantLifecycleOperationNames = Object.freeze(
  Object.keys(tenantLifecycleOperations),
);
export function tenantLifecycleExecutionScope(operation: string) {
  if (!tenantLifecycleOperations[operation]) {
    throw Error("operation_not_implemented");
  }
  return tenantLifecycleScope;
}
