/** Compact reviewed legacy owner catalogue. No complete provider runtime import. */
import source from "./gateway_manifest.json" with { type: "json" };
import { canonicalJson } from "../_shared/sandy_api_protocol.ts";
import { descriptorExecutionScope } from "../sandy-provider-operation-api/scope_from_descriptor.ts";
function freeze<T>(value: T): T {
  if (value && typeof value === "object") {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}
export const legacyOwnerOperations = freeze(
  Object.fromEntries(source.operations.map((o) => [o.operation, o])),
);
export function legacyOwnerExecutionScope(operation: string) {
  const op = legacyOwnerOperations[operation];
  if (!op) throw Error("unsupported_legacy_owner_operation");
  return descriptorExecutionScope(op);
}
export function legacyOwnerContractMatches(
  operation: string,
  row: Record<string, unknown>,
): boolean {
  const op = legacyOwnerOperations[operation], err = row.error_contract;
  try {
    return !!op && row.handler === op.handler &&
      row.permission_scope === op.permission_scope &&
      row.is_mutation === op.is_mutation && !!err && typeof err === "object" &&
      !Array.isArray(err) &&
      (err as Record<string, unknown>).contract_sha256 === op.contract_sha256 &&
      (err as Record<string, unknown>).requires_approval === true &&
      (err as Record<string, unknown>).requires_grant === true &&
      (err as Record<string, unknown>).requires_real_user_session === true &&
      (err as Record<string, unknown>).api_key_delegable === false &&
      canonicalJson(row.input_schema) === canonicalJson(op.input_schema) &&
      canonicalJson(row.output_schema) === canonicalJson(op.output_schema);
  } catch {
    return false;
  }
}
