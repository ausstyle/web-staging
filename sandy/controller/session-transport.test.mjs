import assert from "node:assert/strict";
import { test } from "node:test";
import { createControllerTransport } from "./session-transport.mjs";
const current = { access_token: "synthetic-current", expires_at: 4000, user: { id: "owner-fixture" } };
function fixture(saved = current, responses = [new Response('{"ok":true}')], refreshed = current) {
  let refreshes = 0; const sent = [];
  const transport = createControllerTransport({ getSession: async () => ({ data: { session: saved } }),
    refreshSession: async () => { refreshes++; return { data: { session: refreshed } }; } },
  { now: () => 1000000, request: async (url, options) => { sent.push({ url, options }); const r = responses.shift(); if (r instanceof Error) throw r; return r; } });
  return { transport, sent, refreshes: () => refreshes };
}
test("expired saved session refreshes before dispatch using the existing identity", async () => {
  const f = fixture({ ...current, expires_at: 999 });
  await f.transport.engineering({ action: "get", change_id: "fixture" });
  assert.equal(f.refreshes(), 1); assert.equal(f.sent.length, 1);
  assert.equal(f.sent[0].options.headers.authorization, "Bearer synthetic-current");
});
test("known pre-dispatch authentication denial refreshes exactly once", async () => {
  const f = fixture(current, [new Response('{"error":"Unauthorized"}', { status: 401 }), new Response('{"change":{"status":"approved"}}')]);
  assert.equal((await f.transport.engineering({ action: "status", status: "approved" })).change.status, "approved");
  assert.equal(f.refreshes(), 1); assert.equal(f.sent.length, 2);
  assert.equal(f.sent[0].options.body, f.sent[1].options.body);
});
for (const [name, response] of [
  ["scope denial", new Response('{"error":"Owner approval required"}', { status: 403 })],
  ["unknown 401", new Response('{"error":"provider_failed"}', { status: 401 })],
  ["concurrent status", new Response('{"error":"Concurrent change; reload"}', { status: 409 })],
  ["server error", new Response('{"error":"unavailable"}', { status: 500 })],
  ["malformed response", new Response("not JSON")], ["transport uncertainty", Error("timeout")],
]) test(`${name} cannot replay a mutation`, async () => {
  const f = fixture(current, [response]); await assert.rejects(f.transport.engineering({ action: "status", status: "approved" }));
  assert.equal(f.refreshes(), 0); assert.equal(f.sent.length, 1);
});
test("second authentication denial is not retried", async () => {
  const f = fixture(current, [new Response('{"error":"Unauthorized"}', { status: 401 }), new Response('{"error":"Unauthorized"}', { status: 401 })]);
  await assert.rejects(f.transport.controller("overview")); assert.equal(f.refreshes(), 1); assert.equal(f.sent.length, 2);
});
test("a changed identity during renewal cannot authorize the original action", async () => {
  const f = fixture({ ...current, expires_at: 999 }, [], { ...current, user: { id: "different-user" } });
  await assert.rejects(f.transport.engineering({ action: "status" }), /renewal failed/); assert.equal(f.sent.length, 0);
});
test("missing refresh session cannot fall back to an engineering or administrator credential", async () => {
  const f = fixture({ ...current, expires_at: 999 }, [], null);
  await assert.rejects(f.transport.controller("overview")); assert.equal(f.sent.length, 0);
});
test("concurrent renewal uses a single refresh operation", async () => {
  const f = fixture({ ...current, expires_at: 999 }, [new Response('{"ok":true}'), new Response('{"ok":true}')]);
  await Promise.all([f.transport.controller("overview"), f.transport.controller("overview")]); assert.equal(f.refreshes(), 1);
});
