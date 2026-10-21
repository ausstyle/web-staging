/** Sandy API routing metadata only; no duplicated execution logic. */
import { serviceOperations, serviceScope } from "./contracts.ts";
export {
  serviceHandler,
  serviceOperationNames,
  serviceOperations,
  serviceProject,
} from "./contracts.ts";
export function serviceExecutionScope(operation: string) {
  if (!serviceOperations[operation]) {
    throw new Error("operation_not_implemented");
  }
  return serviceScope;
}
export function serviceCapability(operation: string) {
  return serviceOperations[operation]
    ? { executable: true }
    : { executable: false, unavailable_reason: "operation_not_implemented" };
}
