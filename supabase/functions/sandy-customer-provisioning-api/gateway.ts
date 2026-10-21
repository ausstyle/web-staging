import catalogue from "./contracts.json" with { type: "json" };
import { canonicalJson } from "../_shared/sandy_api_protocol.ts";
export const onboardingOperations = Object.freeze(catalogue);
export function onboardingContractMatches(
  operation: string,
  row: Record<string, unknown>,
): boolean {
  const contract =
    onboardingOperations[operation as keyof typeof onboardingOperations];
  const error = row.error_contract as Record<string, unknown> | undefined;
  try {
    return !!contract && row.handler === contract.handler &&
      row.permission_scope === contract.permission_scope &&
      row.is_mutation === contract.is_mutation &&
      canonicalJson(row.input_schema) ===
        canonicalJson(contract.input_schema) &&
      canonicalJson(row.output_schema) ===
        canonicalJson(contract.output_schema) &&
      error?.contract_sha256 === contract.contract_sha256 &&
      error?.requires_real_user_session === true &&
      error?.api_key_delegable === false && error?.requires_approval === false;
  } catch {
    return false;
  }
}
