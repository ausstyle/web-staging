import { sensitiveContracts } from "./contracts.ts";
import { privateProviderExecutionScope } from "./scope_from_descriptor.ts";
export function sensitiveExecutionScope(
  operation: string,
  _bindings?: unknown,
): Record<string, unknown> {
  if (!sensitiveContracts[operation]) throw Error("operation_not_implemented");
  return privateProviderExecutionScope();
}
