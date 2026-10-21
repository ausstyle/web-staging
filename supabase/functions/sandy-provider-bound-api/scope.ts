import { boundContracts } from "./contracts.ts";
import { boundDescriptorScope } from "./scope_from_descriptor.ts";
import type { VerifiedProviderBindings } from "../sandy-provider-operation-api/configured_scopes.ts";
export function boundExecutionScope(
  operation: string,
  bindings?: VerifiedProviderBindings,
) {
  const op = boundContracts[operation];
  if (!op) throw Error("operation_not_implemented");
  return boundDescriptorScope(op, bindings);
}
