import source from "./contracts.json" with { type: "json" };
import { canonicalJson } from "../_shared/sandy_api_protocol.ts";
function freeze<T>(v: T): T {
  if (v && typeof v === "object") {
    for (const x of Object.values(v)) freeze(x);
    Object.freeze(v);
  }
  return v;
}
export const composioReadOperations = freeze(
  Object.fromEntries(source.map((o) => [o.operation, o])),
);
export function composioReadContractMatches(
  operation: string,
  row: Record<string, unknown>,
): boolean {
  const op = composioReadOperations[operation], e = row.error_contract;
  try {
    return !!op && row.handler === op.handler &&
      row.permission_scope === op.permission_scope &&
      row.is_mutation === false && !!e && typeof e === "object" &&
      !Array.isArray(e) && (e as any).contract_sha256 === op.contract_sha256 &&
      (e as any).requires_approval === false &&
      (e as any).requires_grant === true &&
      (e as any).requires_real_user_session === true &&
      (e as any).api_key_delegable === false &&
      canonicalJson(row.input_schema) === canonicalJson(op.input_schema) &&
      canonicalJson(row.output_schema) === canonicalJson(op.output_schema);
  } catch {
    return false;
  }
}
