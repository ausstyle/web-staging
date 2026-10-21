/** Gateway metadata only: no parser/WASM, SDK, provider credential or dispatch. */
import { databaseOperations, databaseScope } from "./contracts.ts";
export {
  databaseHandler,
  databaseOperationNames,
  databaseOperations,
  databaseProject,
} from "./contracts.ts";
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
  const unavailable = op.kind === "maintenance_vacuum"
    ? "database_top_level_vacuum_deadline_unavailable"
    : ["cron_create", "cron_update"].includes(op.kind)
    ? "database_scheduled_execution_guard_unavailable"
    : null;
  return unavailable
    ? { executable: false, unavailable_reason: unavailable }
    : { executable: true };
}
