/** Compact additive descriptors, integrated only after independent release review. */
import raw from "./gateway_manifest.json" with { type: "json" };
import { descriptorExecutionScope } from "./scope_from_descriptor.ts";
import type { VerifiedProviderBindings } from "../sandy-provider-operation-api/configured_scopes.ts";
export const supplementOperations = Object.freeze(
  Object.fromEntries(
    raw.operations.map((op) => [op.operation, Object.freeze(op)]),
  ),
);
export function supplementExecutionScope(
  operation: string,
  bindings?: VerifiedProviderBindings,
) {
  const op = supplementOperations[operation];
  if (!op) throw Error("operation_not_implemented");
  return descriptorExecutionScope(op, bindings);
}
