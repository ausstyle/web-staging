export {
  isSystemMetadataOperation,
  systemMetadataContractMatches,
  systemMetadataGatewayContracts,
  systemMetadataOperations,
} from "./contracts.ts";
import { systemMetadataOperations } from "./contracts.ts";
export const systemMetadataOwnsGrant = (_operation: string) => true;
export const systemMetadataRequiresUserSession = (_operation: string) => true;
export function systemMetadataExecutionScope(
  operation: string,
  args: Record<string, unknown>,
): Record<string, unknown> {
  if (!systemMetadataOperations[operation]) {
    throw Error("unsupported_system_metadata_operation");
  }
  const fixed = {
    sandy_project_ref: "zmqlyygzqoidkcwdysok",
    permission_scope: "system:read",
    service: "system_metadata_v1",
  };
  if (operation === "system.connections") {
    if (
      typeof args.customer_id !== "string" ||
      !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(
        args.customer_id,
      )
    ) throw Error("explicit_customer_target_required");
    return { ...fixed, customer_id: args.customer_id.toLowerCase() };
  }
  return fixed;
}
