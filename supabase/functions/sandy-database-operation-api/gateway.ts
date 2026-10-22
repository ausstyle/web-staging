/** Gateway metadata only: no parser/WASM, SDK, provider credential or dispatch. */
import {
  databaseOperations as baseDatabaseOperations,
  databaseScope,
} from "./contracts.ts";
import { maintenanceOperations } from "./maintenance_contracts.ts";
export { databaseHandler, databaseProject } from "./contracts.ts";
// The existing contracts remain byte-stable. Only the three previously closed
// maintenance operations are superseded by v2 plus an owned recovery read.
export const databaseOperations = Object.freeze({
  ...baseDatabaseOperations,
  ...maintenanceOperations,
});
export const databaseOperationNames = Object.freeze(
  Object.keys(databaseOperations),
);
export function databaseExecutionScope(operation: string) {
  if (!databaseOperations[operation]) {
    throw new Error("operation_not_implemented");
  }
  return databaseScope;
}
export function databaseCapability(operation: string) {
  const op = databaseOperations[operation];
  if (!op) {
    return {
      executable: false,
      unavailable_reason: "operation_not_implemented",
    };
  }
  return { executable: true };
}
