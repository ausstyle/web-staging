export {
  commerceContractMatches,
  commerceGatewayContracts,
  commerceOperations,
} from "./contracts.ts";
import { commerceOperations } from "./contracts.ts";
export const commerceOwnsGrant = (_operation: string) => true;
export const commerceRequiresUserSession = (_operation: string) => true;
export async function commerceScopeSha256(
  operation: string,
  actorId: string,
  tenantId: string | null,
  channel: "api" | "mcp" = "api",
): Promise<string> {
  const op = commerceOperations[operation];
  if (!op) throw Error("unsupported_commerce_operation");
  if (
    op.authorization === "owner" && tenantId !== null ||
    op.authorization === "portal" && !tenantId
  ) throw Error("invalid_commerce_principal_scope");
  const raw = "sandy_commerce_v1:" + actorId.toLowerCase() + ":" +
    (tenantId?.toLowerCase() || "owner") + ":" + operation + ":" + channel +
    ":" + op.contract_sha256;
  return [
    ...new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(raw)),
    ),
  ].map((v) => v.toString(16).padStart(2, "0")).join("");
}
export const isCommerceOperation = (operation: string): boolean =>
  Object.hasOwn(commerceOperations, operation);
