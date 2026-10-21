/** Exact typed read-only financial export descriptors. No financial mutation. */
import catalogue from "./financial_contracts.json" with { type: "json" };
export const financialExportRpcName = "sandy_tenant_content_execute";
export const financialExportScope = Object.freeze(catalogue.scope);
export const financialExportOperations = Object.freeze(
  Object.fromEntries(catalogue.operations.map((op) => [op.operation, op])),
);
export const financialExportOperationNames = Object.freeze(
  Object.keys(financialExportOperations),
);
export function financialExportExecutionScope(operation: string) {
  if (!financialExportOperations[operation]) {
    throw Error("operation_not_implemented");
  }
  return financialExportScope;
}
