/** Compact descriptors only. No sensitive request/response schemas in the gateway. */
import raw from "./gateway_manifest.json" with { type: "json" };
import { privateProviderExecutionScope } from "./scope_from_descriptor.ts";
export const sensitiveOperations = Object.freeze(
  Object.fromEntries(
    raw.operations.map((op) => [op.operation, Object.freeze(op)]),
  ),
);
export function sensitiveExecutionScope(operation: string) {
  if (!sensitiveOperations[operation]) throw Error("operation_not_implemented");
  return privateProviderExecutionScope();
}
