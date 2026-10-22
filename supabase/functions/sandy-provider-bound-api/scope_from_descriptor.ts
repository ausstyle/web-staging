import { machineScope } from "../_shared/sandy_machine_identity.ts";
import {
  requireBinding,
  type VerifiedProviderBindings,
} from "../sandy-provider-operation-api/configured_scopes.ts";
type Descriptor = { provider: string; service: string; method_name: string };
export function boundDescriptorScope(
  op: Descriptor,
  bindings?: VerifiedProviderBindings,
): Record<string, unknown> {
  if (op.provider === "supabase") {
    return {
      provider: "supabase",
      project_ref: "zmqlyygzqoidkcwdysok",
      relationship: "fresh_branch_parent_membership",
    };
  }
  const configured: Record<string, unknown> = {};
  if (op.service === "compute") {
    configured.parent = requireBinding(
      bindings?.folder ? "folder" : "organization",
      bindings,
    );
    for (
      const kind of ["organization", "folder", "destination_folder"] as const
    ) if (bindings?.[kind]) configured[kind] = requireBinding(kind, bindings);
    if (op.method_name === "move") {
      configured.destination_folder = requireBinding(
        "destination_folder",
        bindings,
      );
    }
  }
  return {
    provider: "gcp",
    project_id: "elaborate-haven-511518-a5",
    region: "europe-west1",
    zone: "europe-west1-b",
    service_account: machineScope.service_account,
    relationship_guard: "fresh_provider_resource_proof",
    ...(Object.keys(configured).length
      ? { configured_bindings: configured }
      : {}),
  };
}
