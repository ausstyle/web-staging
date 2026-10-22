/** Compact descriptors only; integration occurs after reviewed source release. */
import raw from "./gateway_manifest.json" with { type: "json" };
import { boundDescriptorScope } from "./scope_from_descriptor.ts";
import type { VerifiedProviderBindings } from "../sandy-provider-operation-api/configured_scopes.ts";
export const boundOperations = Object.freeze(
  Object.fromEntries(
    raw.operations.map((op) => [op.operation, Object.freeze(op)]),
  ),
);
export function boundExecutionScope(
  operation: string,
  bindings?: VerifiedProviderBindings,
) {
  const op = boundOperations[operation];
  if (!op) throw Error("operation_not_implemented");
  return boundDescriptorScope(op, bindings);
}
