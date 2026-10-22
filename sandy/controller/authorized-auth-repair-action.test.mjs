import assert from "node:assert/strict";
import { test } from "node:test";
import { registerAuthorizedAuthRepair } from "./authorized-auth-repair-action.mjs";
const source = "a".repeat(40), manifest = "b".repeat(64);
const request = { action: "register", risk: "high", expected_behavior: `Release ${source}; manifest ${manifest}. Fix the authorized owner authentication path.`, scope: ["sandy-engineering-control", "security:standing-owner-delegation"] };
function fixture(audit = true) {
  const calls = [], change = { id: "repair-fixture", status: "proposed", risk: "high", expected_behavior: request.expected_behavior };
  return { calls, transport: { session: async () => ({ user: { id: "real-owner" } }), engineering: async body => {
    calls.push(body); if (body.action === "status") change.status = "approved";
    return { change, events: audit ? [{ actor: "real-owner", event_type: "status_changed", detail: { to: "approved", reason: `Release ${source}; manifest ${manifest}` } }] : [] };
  } } };
}
test("security repair is registered at high risk through the actual owner transport", async () => {
  const f = fixture(), result = await registerAuthorizedAuthRepair(f.transport, request);
  assert.equal(result.matching_owner_audit_verified, true); assert.equal(result.tokens_exported, false);
  assert.equal(result.deadline_change_attested, false); assert.equal(f.calls[0].risk, "high");
  assert.equal(f.calls.filter(c => c.action === "status").length, 1);
});
test("risk cannot be downgraded to fit the engineering workload", async () => {
  const f = fixture(); await assert.rejects(registerAuthorizedAuthRepair(f.transport, { ...request, risk: "normal" })); assert.equal(f.calls.length, 0);
});
test("unrelated or changed repair scope is refused before dispatch", async () => {
  const f = fixture(); await assert.rejects(registerAuthorizedAuthRepair(f.transport, { ...request, scope: ["sandy-agent-runtime-v4"] })); assert.equal(f.calls.length, 0);
});
test("status without actual owner audit is never called a recorded owner approval", async () => {
  const f = fixture(false); await assert.rejects(registerAuthorizedAuthRepair(f.transport, request)); assert.equal(f.calls.filter(c => c.action === "status").length, 1);
});
