/** Static compatibility descriptors: no request can select or change a catalogue. */
import source from "./provider_contracts.json" with { type: "json" };
import { canonicalJson } from "../_shared/sandy_api_protocol.ts";
import type { ProviderOperation } from "../sandy-provider-operation-api/index.ts";
import { descriptorExecutionScope } from "../sandy-provider-operation-api/scope_from_descriptor.ts";
function freeze<T>(value: T): T {
  if (value && typeof value === "object") {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}
export const legacyProviderContracts: Readonly<
  Record<string, ProviderOperation>
> = freeze(
  Object.fromEntries(
    (source as unknown as ProviderOperation[]).map((op) => [op.operation, op]),
  ),
);
export const legacyProviderExecutionScope = (operation: string) => {
  const op = legacyProviderContracts[operation];
  if (!op) throw Error("unsupported_legacy_provider_operation");
  return descriptorExecutionScope(op);
};
export function legacyProviderContractMatches(
  operation: string,
  row: Record<string, unknown>,
): boolean {
  const op = legacyProviderContracts[operation];
  const err = row.error_contract as Record<string, unknown> | undefined;
  try {
    return !!op && row.handler === op.handler &&
      row.is_mutation === op.is_mutation &&
      row.permission_scope === op.permission_scope && !!err &&
      err.contract_sha256 === op.contract_sha256 &&
      err.requires_approval === true &&
      err.requires_grant === true && err.api_key_delegable === false &&
      err.requires_real_user_session === true &&
      canonicalJson(row.input_schema) === canonicalJson(op.input_schema) &&
      canonicalJson(row.output_schema) === canonicalJson(op.output_schema);
  } catch {
    return false;
  }
}
