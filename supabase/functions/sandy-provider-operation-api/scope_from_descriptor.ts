/** Fixed scope for a reviewed descriptor. No discovery or provider execution. */
import { machineScope } from "../_shared/sandy_machine_identity.ts";
import { type BindingKind, requireBinding } from "./configured_scopes.ts";
import type { ProviderConfig } from "./gateway.ts";
type Descriptor = {
  provider: string;
  binding_kind?: BindingKind;
  secondary_binding_kind?: BindingKind;
};
export function descriptorExecutionScope(
  op: Descriptor,
  config: ProviderConfig = {},
): Record<string, unknown> {
  if (
    config.projectRef && config.projectRef !== "zmqlyygzqoidkcwdysok" ||
    config.repository && config.repository !== "ausstyle/web-staging" ||
    config.gcpProjectId &&
      config.gcpProjectId !== "elaborate-haven-511518-a5" ||
    config.gcpRegion && config.gcpRegion !== "europe-west1" ||
    config.gcpZone && config.gcpZone !== "europe-west1-b"
  ) throw Error("provider_scope_configuration_mismatch");
  if (op.provider === "supabase") {
    return { provider: "supabase", project_ref: "zmqlyygzqoidkcwdysok" };
  }
  if (op.provider === "github") {
    return { provider: "github", repository: "ausstyle/web-staging" };
  }
  if (op.provider !== "gcp") {
    throw Error("provider_scope_configuration_mismatch");
  }
  const bindings: Record<string, string> = {};
  for (const kind of [op.binding_kind, op.secondary_binding_kind]) {
    if (kind) bindings[kind] = requireBinding(kind, config.verifiedBindings);
  }
  return {
    provider: "gcp",
    project_id: "elaborate-haven-511518-a5",
    region: "europe-west1",
    zone: "europe-west1-b",
    service_account: machineScope.service_account,
    ...(Object.keys(bindings).length ? { configured_bindings: bindings } : {}),
  };
}
