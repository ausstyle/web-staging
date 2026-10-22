import assert from "node:assert/strict";
import { normalizePrivateFinishReceipt } from "./sandy_finish_receipt.ts";

const admission = "338e4d40-f9c0-4b3c-8a7e-eb4ebc4b17f0";
Deno.test("private receipt binds exact admission, terminal state and replay flag", () => {
  for (const outcome of ["succeeded", "failed", "unknown", "accepted"]) {
    for (const reused of [true, false]) {
      assert.deepEqual(normalizePrivateFinishReceipt({ admission_id: admission, outcome }, {
        ok: true, admission_id: admission, state: outcome, reused,
      }), { allowed: true, admission_id: admission, reused });
    }
  }
});
Deno.test("private receipt fails closed on a lost, contradictory or foreign acknowledgement", () => {
  const request = { admission_id: admission, outcome: "unknown" };
  const valid = { ok: true, admission_id: admission, state: "unknown", reused: false };
  for (const value of [null, [], "ok", { ...valid, ok: false },
    { ...valid, admission_id: "another-admission" }, { ...valid, state: "succeeded" },
    { ...valid, reused: undefined }, { ...valid, reused: "false" }]) {
    assert.deepEqual(normalizePrivateFinishReceipt(request, value), {
      allowed: false, error: "execution_receipt_state_unknown", http_status: 503,
    });
  }
});
