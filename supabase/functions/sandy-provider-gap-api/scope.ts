/** Lightweight fixed authority shared by Sandy API admission and the executor. */
import { machineScope } from "../_shared/sandy_machine_identity.ts";
export type ScopeBinding = {
  verified: true;
  repository: "ausstyle/web-staging";
  repository_id: number;
  owner: "ausstyle";
  package_type: string;
  package_name: string;
  exclusive_namespace: true;
  expires_at: string;
  attestation_sha256: string;
};
export function parsePackageRestoreBindings(
  value: string | undefined,
): ScopeBinding[] {
  if (!value) return [];
  try {
    const bindings = JSON.parse(value);
    if (!Array.isArray(bindings) || bindings.length > 100) return [];
    return bindings.filter((x) =>
      x !== null && typeof x === "object" && !Array.isArray(x)
    ) as ScopeBinding[];
  } catch {
    return [];
  }
}
export function gapExecutionScope(
  operation: string,
  restoreBindings?: ScopeBinding[],
): Record<string, unknown> {
  const provider = operation.split(".")[0];
  if (provider === "supabase") {
    return { provider, project_ref: "zmqlyygzqoidkcwdysok" };
  }
  if (provider === "gcp") {
    return {
      provider,
      project_id: machineScope.project_id,
      region: machineScope.region,
      zone: machineScope.zone,
      service_account: machineScope.service_account,
    };
  }
  return {
    provider: "github",
    repository: "ausstyle/web-staging",
    ...(operation.includes("restore")
      ? { restore_bindings: restoreBindings ?? [] }
      : {}),
  };
}
