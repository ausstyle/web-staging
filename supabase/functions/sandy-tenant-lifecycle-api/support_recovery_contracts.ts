/** Per-case private recovery metadata. The shared lifecycle backend executes it. */
import catalogue from "./support_recovery_contracts.json" with { type: "json" };
export const supportRecoveryScope = Object.freeze(catalogue.scope);
export const supportRecoveryOperations = Object.freeze(
  Object.fromEntries(
    catalogue.operations.map((operation) => [operation.operation, operation]),
  ),
);
export const supportRecoveryOperationNames = Object.freeze(
  Object.keys(supportRecoveryOperations),
);
export function supportRecoveryExecutionScope(operation: string) {
  if (!supportRecoveryOperations[operation]) {
    throw Error("operation_not_implemented");
  }
  return supportRecoveryScope;
}
