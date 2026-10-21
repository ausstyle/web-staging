/** Catalogue integration only. Original actual-user JWT and one-use grant remain
 * owned by sandy-product-service-api; this module never executes provider logic. */
import { productOperations } from "./contracts.ts";
export { productContractMatches, productOperations } from "./contracts.ts";
export const productGatewayContracts = Object.freeze(
  Object.fromEntries(
    Object.entries(productOperations).map(([operation, op]) => [operation, {
      handler: "sandy-product-service-api",
      permission_scope:
        (op.authorization === "owner" ? "system:" : "product:") +
        (op.is_mutation ? "write" : "read"),
      is_mutation: op.is_mutation,
      input_schema: op.input_schema,
      output_schema: op.output_schema,
      contract_sha256: op.contract_sha256,
    }]),
  ),
);
export const isProductOperation = (operation: string): boolean =>
  Object.hasOwn(productOperations, operation);
export const productRequiresUserSession = (_operation: string): boolean => true;
export const productOwnsGrant = (_operation: string): boolean => true;
export function productExecutionScope(operation: string): string {
  const op = productOperations[operation];
  if (!op) throw new Error("unsupported_product_operation");
  return "product_user_jwt_admission_v1:" + operation + ":" +
    op.contract_sha256;
}
/** Exact SQL admission scope for an approval manifest. This digest grants no
 * authority: the standalone RPC independently derives and checks the same user. */
export async function productScopeSha256(
  operation: string,
  actorId: string,
  tenantId: string | null,
  channel: "api" | "mcp" = "api",
): Promise<string> {
  const op = productOperations[operation];
  if (!op) throw new Error("unsupported_product_operation");
  if (op.authorization === "owner" && tenantId !== null) {
    throw new Error("owner_product_scope_has_no_tenant");
  }
  if (op.authorization === "portal" && !tenantId) {
    throw new Error("product_portal_tenant_required");
  }
  const bytes = new TextEncoder().encode(
    "sandy_product_v1:" + actorId.toLowerCase() + ":" +
      (tenantId?.toLowerCase() || "owner") + ":" + operation + ":" + channel +
      ":" + op.contract_sha256,
  );
  return [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))].map(
    (v) => v.toString(16).padStart(2, "0"),
  ).join("");
}
