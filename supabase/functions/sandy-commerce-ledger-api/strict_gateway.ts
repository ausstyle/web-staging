import catalogue from "./strict_contracts.json" with { type: "json" };
import { canonicalJson } from "../_shared/sandy_api_protocol.ts";
import type { CommerceOperation } from "./contracts.ts";
export const commerceStrictOperations: Readonly<
  Record<string, CommerceOperation>
> = Object.freeze(
  Object.fromEntries(
    (catalogue.operations as CommerceOperation[]).map((o) => [o.operation, o]),
  ),
);
export const commerceStrictGatewayContracts = Object.freeze(
  Object.fromEntries(
    Object.entries(commerceStrictOperations).map(([id, o]) => [id, {
      handler: o.handler,
      permission_scope: o.permission_scope,
      is_mutation: o.is_mutation,
      input_schema: o.input_schema,
      output_schema: o.output_schema,
      contract_sha256: o.contract_sha256,
    }]),
  ),
);
export const isCommerceStrictOperation = (operation: string) =>
  Object.hasOwn(commerceStrictOperations, operation);
export const commerceStrictOwnsGrant = (_operation: string) => true;
export const commerceStrictRequiresUserSession = (_operation: string) => true;
export function commerceStrictContractMatches(
  operation: string,
  row: Record<string, unknown>,
): boolean {
  const c = commerceStrictOperations[operation], error = row.error_contract;
  try {
    return !!c && row.handler === c.handler &&
      row.permission_scope === c.permission_scope &&
      row.is_mutation === c.is_mutation &&
      canonicalJson(row.input_schema) === canonicalJson(c.input_schema) &&
      canonicalJson(row.output_schema) === canonicalJson(c.output_schema) &&
      !!error && typeof error === "object" && !Array.isArray(error) &&
      (error as Record<string, unknown>).contract_sha256 ===
        c.contract_sha256 &&
      (error as Record<string, unknown>).requires_approval ===
        c.requires_approval &&
      (error as Record<string, unknown>).requires_real_user_session === true &&
      (error as Record<string, unknown>).api_key_delegable === false;
  } catch {
    return false;
  }
}
export async function commerceStrictScopeSha256(
  operation: string,
  actorId: string,
  tenantId: string | null,
  channel: "api" | "mcp" = "api",
): Promise<string> {
  const c = commerceStrictOperations[operation];
  if (!c) throw Error("unsupported_commerce_operation");
  if (
    c.authorization === "owner" && tenantId !== null ||
    c.authorization === "portal" && !tenantId
  ) throw Error("invalid_commerce_principal_scope");
  const raw = "sandy_commerce_v1:" + actorId.toLowerCase() + ":" +
    (tenantId?.toLowerCase() || "owner") + ":" + operation + ":" + channel +
    ":" + c.contract_sha256;
  return [
    ...new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(raw)),
    ),
  ].map((v) => v.toString(16).padStart(2, "0")).join("");
}
