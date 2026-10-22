import assert from "node:assert/strict";
import { voiceExecutiveTurn } from "./executive.ts";
const session = { id: "10000000-0000-4000-8000-000000000001", owner_customer_id: "20000000-0000-4000-8000-000000000002", state: "connected" };
const turnId = "30000000-0000-4000-8000-000000000003";
const broker = { base: "https://zmqlyygzqoidkcwdysok.supabase.co", credential: "fixture-service", timezone: "UTC" };
function fixture(patch: Record<string, unknown> = {}) {
  const calls: { table: string; filters: unknown[][] }[] = [];
  const responses = [
    { data: { id: turnId, role: "user", text: "Continue that task", created_at: "2026-10-22T10:00:00Z" } },
    { data: null },
    { data: [{ role: "assistant", text: "Verified prior answer" }, { role: "user", text: "Earlier question" }] },
  ];
  Object.assign(responses, patch);
  const db = { from(table: string) {
    const call = { table, filters: [] as unknown[][] }; calls.push(call);
    const result = responses.shift();
    const q: any = { then: (ok: any) => Promise.resolve(result).then(ok), maybeSingle: async () => result };
    for (const method of ["select", "eq", "lt", "order", "limit"]) q[method] = (...args: unknown[]) => { call.filters.push([method, ...args]); return q; };
    return q;
  }};
  return { db, calls };
}
Deno.test("voice uses the existing Executive with owner-scoped stored transcript and bounded history", async () => {
  const f = fixture(); let received: any;
  const out = await voiceExecutiveTurn(f.db, session, turnId, broker, async (url, init) => {
    assert.equal(url, broker.base + "/functions/v1/sandy-agent-runtime"); received = JSON.parse(String(init?.body));
    assert.equal(new Headers(init?.headers).get("authorization"), "Bearer fixture-service");
    return Response.json({ ok: true, task_id: "task", response: "Actual runtime answer", completion_state: "answered", completion_verified: true });
  });
  assert.equal(out.status, 200); const result = await out.json();
  assert.equal(result.delivery_verified, false); assert.equal(result.response, "Actual runtime answer");
  assert.equal(received.channel, "voice"); assert.equal(received.customer_id, session.owner_customer_id);
  assert.equal(received.request, "Continue that task"); assert.equal(received.history[0].assistant, "Verified prior answer");
  assert.match(received.request_id, /^voice_[a-f0-9]{32}_[a-f0-9]{32}$/);
  for (const call of f.calls) assert(call.filters.some(x => x[0] === "eq" && x[1] === (call.table === "sandy_agent_tasks" ? "customer_id" : "owner_customer_id") && x[2] === session.owner_customer_id));
  assert.equal(JSON.stringify(result).includes(broker.credential), false);
});
Deno.test("missing or ended voice turns never dispatch tools", async () => {
  let calls = 0; const request = async () => { calls++; throw Error("must not dispatch"); };
  assert.equal((await voiceExecutiveTurn(fixture().db, { ...session, ended_at: "now" }, turnId, broker, request)).status, 403);
  assert.equal((await voiceExecutiveTurn(fixture().db, session, "forged", broker, request)).status, 403);
  assert.equal((await voiceExecutiveTurn(fixture({ 0: { data: null } }).db, session, turnId, broker, request)).status, 404);
  assert.equal(calls, 0);
});
Deno.test("persisted completion and in-flight duplicate requests reuse the task without another execution", async () => {
  for (const status of ["completed", "running", "failed"]) {
    const f = fixture({ 1: { data: { id: "recorded-task", status, result: { text: "Saved answer", completion_state: "answered", completion_verified: true } } } });
    const out = await voiceExecutiveTurn(f.db, session, turnId, broker, () => { throw Error("duplicate dispatch"); });
    assert.equal(out.status, status === "completed" ? 200 : status === "running" ? 202 : 409);
    const result = await out.json(); assert.equal(result.reused, true);
    if (status !== "completed") assert.equal(result.completion_verified, false);
  }
});
Deno.test("partial Executive answer stays partial and a transport timeout never retries or claims speech delivery", async () => {
  const partial = await voiceExecutiveTurn(fixture().db, session, turnId, broker, async () => Response.json({ ok: true, response: "Useful partial answer", completion_state: "partial", completion_verified: false }));
  assert.equal((await partial.json()).completion_verified, false);
  let calls = 0;
  const unknown = await voiceExecutiveTurn(fixture().db, session, turnId, broker, () => { calls++; throw Error("private failure"); });
  const value = await unknown.json(); assert.equal(calls, 1); assert.equal(value.completion_state, "unknown_outcome");
  assert.equal(value.automatic_retry, false); assert.equal(value.delivery_verified, false);
  assert.equal(JSON.stringify(value).includes("private failure"), false);
});
Deno.test("receipt and history outages fail closed before runtime execution", async () => {
  for (const patch of [{ 1: { error: {} } }, { 2: { error: {}, data: null } }]) {
    const out = await voiceExecutiveTurn(fixture(patch).db, session, turnId, broker, () => { throw Error("must not dispatch"); });
    assert.equal(out.status, 503);
  }
});
