import { machineScope } from "../_shared/sandy_machine_identity.ts";
export function privateProviderExecutionScope(): Record<string, unknown> {
  return {
    provider: "gcp",
    project_id: "elaborate-haven-511518-a5",
    region: "europe-west1",
    zone: "europe-west1-b",
    service_account: machineScope.service_account,
    response_boundary: "private_operation_custody",
  };
}
