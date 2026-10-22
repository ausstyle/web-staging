import assert from "node:assert/strict";
import { test } from "node:test";
import { authorizedDeadline as p, recordAuthorizedDeadline } from "./authorized-deadline-action.mjs";
function fixture(status = "proposed", patch = {}, audit = true) {
  const calls = [], change = { id: p.change, status, risk: "normal", scope: ["sandy-agent-runtime-v4", "github:ausstyle/web-staging:engineering/sandy-unified-intelligence-20261021"], expected_behavior: `Release ${p.source}; manifest ${p.manifest}`, ...patch };
  return { calls, transport: { session: async () => ({ user: { id: "real-owner" } }), engineering: async body => {
    calls.push(body); if (body.action === "status") change.status = "approved";
    return { change, events: audit ? [{ actor: "real-owner", event_type: "status_changed", detail: { to: "approved", reason: `Release ${p.source}; manifest ${p.manifest}` } }] : [] };
  } } };
}
test("browser action records only the existing fixed pins and verifies the actual owner event", async () => {
  const f = fixture(); const result = await recordAuthorizedDeadline(f.transport);
  assert.equal(result.matching_owner_audit_verified, true); assert.equal(result.tokens_exported, false);
  assert.equal(f.calls.filter(c => c.action === "status").length, 1);
  assert.ok(f.calls.find(c => c.action === "status").reason.includes(p.manifest));
});
test("already recorded action is read without another approval mutation", async () => {
  const f = fixture("approved"); await recordAuthorizedDeadline(f.transport); assert.equal(f.calls.some(c => c.action === "status"), false);
});
for (const patch of [{ id: "another-change" }, { expected_behavior: "different source" }, { risk: "high" }, { scope: ["sandy-engineering-control"] }]) {
  test(`changed authorization cannot be recorded: ${JSON.stringify(patch)}`, async () => {
    const f = fixture("proposed", patch); await assert.rejects(recordAuthorizedDeadline(f.transport)); assert.equal(f.calls.some(c => c.action === "status"), false);
  });
}
test("approved status without the genuine matching audit event is not reported verified", async () => {
  const f = fixture("approved", {}, false); await assert.rejects(recordAuthorizedDeadline(f.transport)); assert.equal(f.calls.filter(c => c.action === "status").length, 1);
});
test("an administrative approval is preserved while a genuine owner attests the pinned release", async () => {
  const f = fixture("approved"); let attested = false;
  const old = f.transport.engineering;
  f.transport.engineering = async body => {
    const result = await old(body);
    if (body.action === "status") attested = true;
    result.events = [{ actor: null, event_type: "owner_directive_manual_db_approval", detail: { owner_session_verified: false } },
      ...(attested ? [{ actor: "real-owner", event_type: "owner_release_attested", detail: { to: "approved", owner_session_authenticated: true, reason: `Release ${p.source}; manifest ${p.manifest}` } }] : [])];
    return result;
  };
  assert.equal((await recordAuthorizedDeadline(f.transport)).matching_owner_audit_verified, true);
  assert.equal(f.calls.filter(c => c.action === "status").length, 1);
});
