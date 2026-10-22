import { type VerifiedProviderBindings } from "../sandy-provider-operation-api/configured_scopes.ts";
import { type Obj, supplementContracts } from "./contracts.ts";
import { descriptorExecutionScope } from "./scope_from_descriptor.ts";
export { type VerifiedProviderBindings } from "../sandy-provider-operation-api/configured_scopes.ts";
export function supplementExecutionScope(
  operation: string,
  bindings?: VerifiedProviderBindings,
): Obj {
  const op = supplementContracts[operation];
  if (!op) throw Error("operation_not_implemented");
  return descriptorExecutionScope(op, bindings);
}
