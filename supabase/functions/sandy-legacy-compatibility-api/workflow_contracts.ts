import source from "./workflow_contracts.json" with { type: "json" };
import type { Contract } from "../sandy-provider-supplement-api/contracts.ts";
function freeze<T>(value: T): T {
  if (value && typeof value === "object") {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}
export const legacyWorkflowContracts: Readonly<Record<string, Contract>> =
  freeze(
    Object.fromEntries(
      (source as unknown as Contract[]).map((o) => [o.operation, o]),
    ),
  );
