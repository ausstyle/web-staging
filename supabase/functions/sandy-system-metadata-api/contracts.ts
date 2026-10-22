import catalogue from "./contracts.json" with { type: "json" };
import { canonicalJson } from "../_shared/sandy_api_protocol.ts";
export type SystemMetadataOperation = {
  operation: string;
  handler: string;
  version: string;
  permission_scope: string;
  is_mutation: false;
  requires_approval: boolean;
  requires_real_user_session: true;
  input_schema: Record<string, unknown>;
  output_schema: Record<string, unknown>;
  contract_sha256: string;
};
export const systemMetadataOperations: Readonly<
  Record<string, SystemMetadataOperation>
> = Object.freeze(
  Object.fromEntries(
    (catalogue.operations as SystemMetadataOperation[]).map(
      (o) => [o.operation, o],
    ),
  ),
);
export const systemMetadataGatewayContracts = systemMetadataOperations;
export const isSystemMetadataOperation = (operation: string) =>
  Object.hasOwn(systemMetadataOperations, operation);
export function systemMetadataContractMatches(
  operation: string,
  row: Record<string, unknown>,
): boolean {
  const c = systemMetadataOperations[operation], error = row.error_contract;
  try {
    return !!c && row.handler === c.handler &&
      row.permission_scope === c.permission_scope &&
      row.is_mutation === false &&
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
