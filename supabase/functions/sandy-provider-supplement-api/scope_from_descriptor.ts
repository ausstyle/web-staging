/** No complete provider schemas or transport dependency in the canonical gateway. */
import { machineScope } from "../_shared/sandy_machine_identity.ts";
import {
  requireBinding,
  type VerifiedProviderBindings,
} from "../sandy-provider-operation-api/configured_scopes.ts";
type Descriptor = { provider: string; kind: string };
export function descriptorExecutionScope(
  op: Descriptor,
  bindings?: VerifiedProviderBindings,
): Record<string, unknown> {
  if (op.provider === "supabase") {
    return { provider: "supabase", project_ref: "zmqlyygzqoidkcwdysok" };
  }
  if (op.provider === "github") {
    return { provider: "github", repository: "ausstyle/web-staging" };
  }
  const configured: Record<string, unknown> = {};
  if (op.kind === "organization_search") {
    configured.organization = requireBinding("organization", bindings);
  }
  if (op.kind === "folder_search") {
    configured.folder = requireBinding("folder", bindings);
  }
  if (op.kind === "billing_list") {
    configured.billing_account = requireBinding("billing_account", bindings);
  }
  if (op.kind === "project_list") {
    configured.parent = requireBinding(
      bindings?.folder ? "folder" : "organization",
      bindings,
    );
  }
  return {
    provider: "gcp",
    project_id: "elaborate-haven-511518-a5",
    region: "europe-west1",
    service_account: machineScope.service_account,
    ...(Object.keys(configured).length
      ? { configured_bindings: configured }
      : {}),
  };
}
