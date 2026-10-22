/** Compact gateway catalogue. Provider transport and full schemas stay in the executor. */
import rawManifest from "./gateway_manifest.json" with { type: "json" };
import { machineScope } from "../_shared/sandy_machine_identity.ts";
import {
  type BindingKind,
  requireBinding,
  type VerifiedProviderBindings,
} from "./configured_scopes.ts";
type JsonObject = Record<string, unknown>;
export type ProviderGatewayOperation = {
  operation: string;
  provider: string;
  is_mutation: boolean;
  permission_scope: string;
  contract_sha256: string;
  requires_grant: boolean;
  requires_cost_approval: boolean;
  requirement: number;
  binding_kind?: BindingKind;
  secondary_binding_kind?: BindingKind;
  input_schema_sha256: string;
  output_schema_sha256: string;
};
const catalogue = rawManifest as unknown as {
  project_ref: string;
  repository: string;
  gcp_project_id: string;
  gcp_region: string;
  gcp_zone: string;
  operations: ProviderGatewayOperation[];
};
export const providerOperations: Readonly<
  Record<string, ProviderGatewayOperation>
> = Object.freeze(
  Object.fromEntries(catalogue.operations.map((op) => [op.operation, op])),
);
export type ProviderConfig = {
  projectRef?: string;
  repository?: string;
  gcpProjectId?: string;
  gcpRegion?: string;
  gcpZone?: string;
  verifiedBindings?: VerifiedProviderBindings;
};
export function providerExecutionScope(
  operation: string,
  config: ProviderConfig = {},
): JsonObject {
  const op = providerOperations[operation];
  if (!op) throw new Error("operation_not_implemented");
  // This release deliberately supports only the reviewed existing resources.
  if (
    config.projectRef && config.projectRef !== catalogue.project_ref ||
    config.repository && config.repository !== catalogue.repository ||
    config.gcpProjectId && config.gcpProjectId !== catalogue.gcp_project_id ||
    config.gcpRegion && config.gcpRegion !== catalogue.gcp_region ||
    config.gcpZone && config.gcpZone !== catalogue.gcp_zone
  ) throw new Error("provider_scope_configuration_mismatch");
  if (op.provider === "supabase") {
    return { provider: "supabase", project_ref: catalogue.project_ref };
  }
  if (op.provider === "github") {
    return { provider: "github", repository: catalogue.repository };
  }
  const bindings: JsonObject = {};
  for (
    const kind of [(op as any).binding_kind, (op as any).secondary_binding_kind]
      .filter(Boolean)
  ) {
    bindings[kind] = requireBinding(
      kind as BindingKind,
      config.verifiedBindings,
    );
  }
  return {
    provider: "gcp",
    project_id: catalogue.gcp_project_id,
    region: catalogue.gcp_region,
    zone: catalogue.gcp_zone,
    service_account: machineScope.service_account,
    ...(Object.keys(bindings).length ? { configured_bindings: bindings } : {}),
  };
}
