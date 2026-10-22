import catalogue from "./contracts.json" with { type: "json" };
import { canonicalJson } from "../_shared/sandy_api_protocol.ts";
export type CommerceOperation = {
  operation: string;
  version: string;
  handler: string;
  authorization: "owner" | "portal" | "authenticated";
  is_mutation: boolean;
  sensitive: boolean;
  requires_approval: boolean;
  permission_scope: string;
  input_schema: Record<string, unknown>;
  output_schema: Record<string, unknown>;
  contract_sha256: string;
};
export const commerceOperations: Readonly<Record<string, CommerceOperation>> =
  Object.freeze(
    Object.fromEntries(
      (catalogue.operations as unknown as CommerceOperation[]).map(
        (o) => [o.operation, o],
      ),
    ),
  );
export const commerceGatewayContracts = Object.freeze(
  Object.fromEntries(
    Object.entries(commerceOperations).map(([k, o]) => [k, {
      handler: o.handler,
      permission_scope: o.permission_scope,
      is_mutation: o.is_mutation,
      input_schema: o.input_schema,
      output_schema: o.output_schema,
      contract_sha256: o.contract_sha256,
    }]),
  ),
);
export function commerceContractMatches(
  operation: string,
  row: Record<string, unknown>,
): boolean {
  const c = commerceOperations[operation], error = row.error_contract;
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
      (error as Record<string, unknown>).api_key_delegable === false;
  } catch {
    return false;
  }
}
