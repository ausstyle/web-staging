/** Source-specific financial text policies; no financial/account/auth restoration. */
import catalogue from "./financial_redaction_contracts.json" with {
  type: "json",
};
export const financialRedactionScope = Object.freeze(catalogue.scope);
export const financialRedactionRpcName =
  "sandy_tenant_financial_redaction_execute";
export const financialRedactionOperations = Object.freeze(
  Object.fromEntries(catalogue.operations.map((op) => [op.operation, op])),
);
export const financialRedactionOperationNames = Object.freeze(
  Object.keys(financialRedactionOperations),
);
export function financialRedactionExecutionScope(operation: string) {
  if (!Object.hasOwn(financialRedactionOperations, operation)) {
    throw Error("operation_not_implemented");
  }
  return financialRedactionScope;
}
export function financialRedactionResultMatches(
  operation: string,
  args: Record<string, unknown>,
  result: Record<string, unknown>,
) {
  const op = financialRedactionOperations[operation];
  return !!op && result.tenant_id === args.tenant_id &&
    result.manifest === op.manifest &&
    result.manifest_sha256 === op.manifest_sha256 &&
    result.schema_sha256 === op.schema_sha256 &&
    (!Object.hasOwn(args, "policy_id") ||
      result.policy_id === args.policy_id) &&
    (!Object.hasOwn(args, "resource") || result.resource === args.resource) &&
    (!Array.isArray(args.record_ids) ||
      result.record_count === args.record_ids.length) &&
    (!Object.hasOwn(args, "policy_reference") ||
      result.policy_reference === args.policy_reference) &&
    (!Object.hasOwn(args, "basis") || result.basis === args.basis) &&
    (!Object.hasOwn(args, "expected_current_sha256") ||
      result.before_sha256 === args.expected_current_sha256) &&
    (!operation.endsWith(".apply") || result.state === "applied") &&
    (!operation.endsWith(".policies.revoke") || result.state === "revoked");
}
