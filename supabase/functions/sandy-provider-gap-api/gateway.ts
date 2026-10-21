/** Lightweight Sandy API registration. The executor owns transport and grant consumption. */
import manifest from "./gateway_manifest.json" with { type: "json" };
export {
  gapExecutionScope,
  parsePackageRestoreBindings,
  type ScopeBinding,
} from "./scope.ts";
export const gapGatewayOperations = Object.freeze(
  Object.fromEntries(manifest.operations.map((op) => [op.operation, op])),
);
export const isGapOperation = (operation: unknown): boolean =>
  typeof operation === "string" &&
  Object.hasOwn(gapGatewayOperations, operation);
