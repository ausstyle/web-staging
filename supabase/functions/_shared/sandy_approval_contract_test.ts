import { deepStrictEqual as equal } from "node:assert/strict";
import { approvedOwnerContract } from "./sandy_approval_contract.ts";
const expected = {
  handler: "sandy-supabase-service-api",
  is_mutation: false,
  contract_sha256: "a".repeat(64),
};
const row = {
  ...expected,
  api_exposed: true,
  verified: true,
  error_contract: {
    contract_sha256: expected.contract_sha256,
    requires_approval: true,
    api_key_delegable: false,
  },
};
Deno.test("sensitive owner contract requires source approval and refuses registry flag drift", () => {
  equal(approvedOwnerContract(row, expected), true);
  for (
    const patch of [
      { requires_approval: false },
      { requires_approval: null },
      { requires_approval: undefined },
      { api_key_delegable: true },
      { api_key_delegable: undefined },
    ]
  ) {
    equal(
      approvedOwnerContract({
        ...row,
        error_contract: { ...row.error_contract, ...patch },
      }, expected),
      false,
    );
  }
  for (
    const patch of [{ handler: "other" }, { verified: false }, {
      api_exposed: false,
    }, { is_mutation: true }]
  ) equal(approvedOwnerContract({ ...row, ...patch }, expected), false);
});
