import { canonicalJson } from "../_shared/sandy_api_protocol.ts";
import catalogue from "./contracts.json" with { type: "json" };
export type ProductOperation = {
  operation: string;
  contract_version: string;
  executor: "db" | "graph" | "whatsapp" | "legacy_invoice" | "receipt";
  authorization: "portal" | "owner" | "authenticated";
  is_mutation: boolean;
  sensitive: boolean;
  consumes_provider_units: boolean;
  binding: string;
  requirement_ids: number[];
  input_schema: Record<string, unknown>;
  output_schema: Record<string, unknown>;
  contract_sha256: string;
  description: string;
};
export const productOperations: Readonly<Record<string, ProductOperation>> =
  Object.freeze(
    Object.fromEntries(
      (catalogue.operations as unknown as ProductOperation[]).map(
        (op) => [op.operation, op],
      ),
    ),
  );
export function productContractMatches(
  operation: string,
  row: Record<string, unknown>,
): boolean {
  const op = productOperations[operation], error = row.error_contract;
  try {
    return !!op && row.handler === "sandy-product-service-api" &&
      row.is_mutation === op.is_mutation &&
      canonicalJson(row.input_schema) === canonicalJson(op.input_schema) &&
      canonicalJson(row.output_schema) === canonicalJson(op.output_schema) &&
      row.permission_scope ===
        (op.authorization === "owner"
          ? op.is_mutation ? "system:write" : "system:read"
          : op.is_mutation
          ? "product:write"
          : "product:read") &&
      !!error && typeof error === "object" && !Array.isArray(error) &&
      (error as Record<string, unknown>).contract_sha256 ===
        op.contract_sha256 &&
      (error as Record<string, unknown>).requires_approval ===
        (op.authorization === "owner" && (op.is_mutation || op.sensitive)) &&
      (error as Record<string, unknown>).api_key_delegable === false;
  } catch {
    return false;
  }
}
