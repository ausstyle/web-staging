/** Reviewed routing metadata. The lifecycle backend owns SQL and grant consumption. */
import {
  tenantLifecycleOperations as manifestOperations,
  tenantLifecycleScope,
} from "./contracts.ts";
import {
  protectedInventoryOperation,
  protectedInventoryOperationName,
} from "./protected_inventory.ts";
export const tenantLifecycleOperations = Object.freeze({
  ...manifestOperations,
  [protectedInventoryOperationName]: protectedInventoryOperation,
});
export function tenantLifecycleExecutionScope(operation: string) {
  if (!Object.hasOwn(tenantLifecycleOperations, operation)) {
    throw Error("operation_not_implemented");
  }
  return tenantLifecycleScope;
}
