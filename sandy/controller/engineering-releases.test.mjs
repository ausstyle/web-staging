import assert from "node:assert/strict";
import { test } from "node:test";
import { processRoutineProposals } from "./engineering-releases.mjs";
const enabled = { enabled: true, standing_authorized_by: "owner", standing_expires_at: new Date(Date.now() + 86400000).toISOString() };
function fixture(policy, deny = false) {
  const calls = [];
  return { calls, transport: { session: async () => ({ user: { id: "owner" } }), engineering: async body => {
    calls.push(body);
    if (body.action === "delegation_policy") return { policy };
    if (body.action === "list") return { changes: [
      { id: "routine", status: "proposed", risk: "normal" }, { id: "high", status: "proposed", risk: "high" },
      { id: "critical", status: "proposed", risk: "critical" }, { id: "approved", status: "approved", risk: "low" },
    ] };
    if (deny) throw Error("independent_review_required");
    return { ok: true };
  } } };
}
for (const patch of [{ enabled: false }, { standing_revoked_at: "revoked" }, { standing_expires_at: "invalid" },
  { standing_expires_at: "2020-01-01T00:00:00Z" }, { standing_authorized_by: "another-owner" }]) {
  test(`inactive or foreign browser policy cannot dispatch: ${JSON.stringify(patch)}`, async () => {
    const f = fixture({ ...enabled, ...patch }); await processRoutineProposals(f.transport);
    assert.deepEqual(f.calls, [{ action: "delegation_policy" }]);
  });
}
test("automatic proposals use the separate server decision and exclude higher risk", async () => {
  const f = fixture(enabled); await processRoutineProposals(f.transport);
  assert.deepEqual(f.calls.filter(c => c.action === "auto_approve"), [{ action: "auto_approve", change_id: "routine" }]);
  assert.equal(f.calls.some(c => c.action === "status" || c.action === "execute_job"), false);
});
test("a rejected independent policy decision cannot fall back to direct owner approval", async () => {
  const f = fixture(enabled, true); await processRoutineProposals(f.transport);
  assert.equal(f.calls.filter(c => c.action === "auto_approve").length, 1);
  assert.equal(f.calls.some(c => c.action === "status"), false);
});
