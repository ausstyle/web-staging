/** Reviewed routing metadata. The lifecycle backend owns SQL and grant consumption. */
import {
  tenantLifecycleOperations as manifestOperations,
  tenantLifecycleScope,
} from "./contracts.ts";
import {
  protectedInventoryOperation,
  protectedInventoryOperationName,
} from "./protected_inventory.ts";
import {
  scalarManifestExecutionScope,
  scalarManifestOperations,
} from "./scalar_contracts.ts";
import {
  contentExportExecutionScope,
  contentExportOperations,
} from "./content_contracts.ts";
import {
  supportRecoveryExecutionScope,
  supportRecoveryOperations,
} from "./support_recovery_contracts.ts";
export const tenantLifecycleOperations = Object.freeze({
  ...manifestOperations,
  [protectedInventoryOperationName]: protectedInventoryOperation,
  ...scalarManifestOperations,
  ...contentExportOperations,
  ...supportRecoveryOperations,
});
export function tenantLifecycleExecutionScope(operation: string) {
  if (Object.hasOwn(supportRecoveryOperations, operation)) {
    return supportRecoveryExecutionScope(operation);
  }
  if (Object.hasOwn(contentExportOperations, operation)) {
    return contentExportExecutionScope(operation);
  }
  if (Object.hasOwn(scalarManifestOperations, operation)) {
    return scalarManifestExecutionScope(operation);
  }
  if (!Object.hasOwn(tenantLifecycleOperations, operation)) {
    throw Error("operation_not_implemented");
  }
  return tenantLifecycleScope;
}
