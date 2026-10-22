import assert from "node:assert/strict";
import { canonicalJson } from "../_shared/sandy_api_protocol.ts";
import {
  legacyOwnerContractMatches,
  legacyOwnerExecutionScope,
  legacyOwnerOperations,
} from "./gateway.ts";
import { legacyProviderContracts } from "./provider_contracts.ts";
import { legacyWorkflowContracts } from "./workflow_contracts.ts";
Deno.test("seven compact original-ID contracts match full executors and cannot weaken grant identity", () => {
  const all = { ...legacyProviderContracts, ...legacyWorkflowContracts };
  assert.deepEqual(
    Object.keys(legacyOwnerOperations).sort(),
    Object.keys(all).sort(),
  );
  for (const [id, op] of Object.entries(legacyOwnerOperations)) {
    assert.equal(op.contract_sha256, all[id].contract_sha256);
    assert.equal(
      canonicalJson(op.input_schema),
      canonicalJson(all[id].input_schema),
    );
    assert.equal(
      canonicalJson(op.output_schema),
      canonicalJson(all[id].output_schema),
    );
    assert.ok(Object.isFrozen(op.input_schema));
    const row = {
      ...op,
      error_contract: {
        contract_sha256: op.contract_sha256,
        requires_approval: true,
        requires_grant: true,
        requires_real_user_session: true,
        api_key_delegable: false,
      },
    };
    assert.equal(legacyOwnerContractMatches(id, row), true);
    for (
      const patch of [{ requires_approval: false }, { requires_grant: false }, {
        requires_real_user_session: false,
      }, { api_key_delegable: true }]
    ) {
      assert.equal(
        legacyOwnerContractMatches(id, {
          ...row,
          error_contract: { ...row.error_contract, ...patch },
        }),
        false,
      );
    }
    assert.deepEqual(
      legacyOwnerExecutionScope(id),
      id.startsWith("github.")
        ? { provider: "github", repository: "ausstyle/web-staging" }
        : { provider: "supabase", project_ref: "zmqlyygzqoidkcwdysok" },
    );
  }
  for (
    const unsupported of [
      "cloud.vm.exec",
      "video.install",
      "composio.execute_read",
    ]
  ) assert.throws(() => legacyOwnerExecutionScope(unsupported));
});
