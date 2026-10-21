/** Catalogue integration only. Original actual-user JWT and one-use grant remain
 * owned by sandy-product-service-api; this module never executes provider logic. */
import catalogue from "./strict_contracts.json" with { type: "json" };
import { canonicalJson } from "../_shared/sandy_api_protocol.ts";
import type { ProductOperation } from "./contracts.ts";
export const productStrictOperations: Readonly<
  Record<string, ProductOperation>
> = Object.freeze(
  Object.fromEntries(
    (catalogue.operations as unknown as ProductOperation[]).map(
      (o) => [o.operation, o],
    ),
  ),
);
export function productStrictContractMatches(
  operation: string,
  row: Record<string, unknown>,
): boolean {
  const o = productStrictOperations[operation],
    error = row.error_contract as Record<string, unknown> | undefined;
  try {
    return !!o && row.handler === "sandy-product-service-api" &&
      row.permission_scope ===
        (o.authorization === "owner" ? "system:" : "product:") +
          (o.is_mutation ? "write" : "read") &&
      row.is_mutation === o.is_mutation &&
      canonicalJson(row.input_schema) === canonicalJson(o.input_schema) &&
      canonicalJson(row.output_schema) === canonicalJson(o.output_schema) &&
      !!error && error.contract_sha256 === o.contract_sha256 &&
      error.requires_approval ===
        (o.authorization === "owner" && (o.is_mutation || o.sensitive)) &&
      error.requires_real_user_session === true &&
      error.api_key_delegable === false;
  } catch {
    return false;
  }
}
export const productStrictGatewayContracts = Object.freeze(
  Object.fromEntries(
    Object.entries(productStrictOperations).map((
      [operation, op],
    ) => [operation, {
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
export const isProductStrictOperation = (operation: string): boolean =>
  Object.hasOwn(productStrictOperations, operation);
export const productStrictRequiresUserSession = (_operation: string): boolean =>
  true;
export const productStrictOwnsGrant = (_operation: string): boolean => true;
export function productStrictExecutionScope(operation: string): string {
  const op = productStrictOperations[operation];
  if (!op) throw new Error("unsupported_product_operation");
  return "product_user_jwt_admission_v1:" + operation + ":" +
    op.contract_sha256;
}
/** Exact SQL admission scope for an approval manifest. This digest grants no
 * authority: the standalone RPC independently derives and checks the same user. */
export async function productStrictScopeSha256(
  operation: string,
  actorId: string,
  tenantId: string | null,
  channel: "api" | "mcp" = "api",
): Promise<string> {
  const op = productStrictOperations[operation];
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
