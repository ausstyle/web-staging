/** Bounded hosting read candidate. No request can install a server binding. */
import {
  requireBinding,
  type VerifiedProviderBindings,
} from "./configured_scopes.ts";
const operations = new Set([
  "gcp.cloud_run.services.list",
  "gcp.cloud_run.services.get",
]);
export function cloudRunReadRegion(
  operation: string,
  args: Record<string, unknown> = {},
  bindings?: VerifiedProviderBindings,
): string {
  if (!operations.has(operation)) return "europe-west1";
  const path = args.path;
  const name = path && typeof path === "object" && !Array.isArray(path)
    ? (path as Record<string, unknown>).name
    : undefined;
  if (
    name !== undefined && (typeof name !== "string" ||
      !/^projects\/elaborate-haven-511518-a5\/locations\/[^/]+\/services\/[^/]+$/
        .test(name) ||
      /[\\%?#\u0000-\u001f\u007f]/.test(name))
  ) throw Error("provider_region_scope_mismatch");
  const namedRegion = typeof name === "string"
    ? name.match(
      /^projects\/elaborate-haven-511518-a5\/locations\/([^/]+)\/services\//,
    )?.[1]
    : undefined;
  const region = operation.endsWith(".list")
    ? args.region ?? "europe-west1"
    : namedRegion ?? "europe-west1";
  if (region === "europe-west1") return region;
  if (region !== "europe-west8") throw Error("provider_region_scope_mismatch");
  if (
    requireBinding("cloud_run_read_region", bindings) !== "locations/" + region
  ) throw Error("provider_region_scope_mismatch");
  return region;
}
export function cloudRunReadScope(
  operation: string,
  args: Record<string, unknown> = {},
  bindings?: VerifiedProviderBindings,
): Record<string, unknown> {
  const region = cloudRunReadRegion(operation, args, bindings);
  return region === "europe-west1" ? {} : {
    region,
    configured_bindings: { cloud_run_read_region: "locations/" + region },
    region_binding_expires_at: bindings?.cloud_run_read_region?.expires_at,
  };
}
