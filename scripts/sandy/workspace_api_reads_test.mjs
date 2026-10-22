import test from "node:test";
import assert from "node:assert/strict";
import { createWorkspaceReadClient, workspaceReadOperations } from "../../sandy/workspace-api-reads.mjs";
const session = token => ({ data: { session: { access_token: token } }, error: null });
const ok = (operation, result = {}) => Response.json({ ok: true, operation, executed: true,
  result: { ok: true, contract_version: "1.0.0", ...result } });
test("all five passive UI actions execute fixed API operations with the real session", async () => {
  const calls = [];
  const client = createWorkspaceReadClient({ getSession: async () => session("user-session") }, {
    publicKey: "sb_publishable_fixture",
    request: async (url, init) => { const body = JSON.parse(init.body); calls.push({ url, init, body }); return ok(body.operation, { name: "Fixture" }); },
  });
  for (const [action, operation] of Object.entries(workspaceReadOperations)) {
    const result = await client.call(action, action === "global_search" ? { query: "test" } : {});
    assert.equal(result.name, "Fixture");
    const { url, init, body } = calls.at(-1);
    assert.equal(url, "https://zmqlyygzqoidkcwdysok.supabase.co/functions/v1/sandy-operation-api");
    assert.equal(init.headers.Authorization, "Bearer user-session");
    assert.equal(init.headers.apikey, "sb_publishable_fixture");
    assert.equal(init.cache, "no-store");
    assert.equal(body.operation, operation);
    assert.equal(body.channel, "api");
    assert.equal(body.action, "execute");
    assert.equal("customer_id" in body, false);
  }
});
test("first-page null cursor is omitted; subsequent exact cutoff cursor is preserved", async () => {
  const bodies = [], cursor = { offset: 40, cutoff: "2026-10-21T00:00:00Z" };
  const client = createWorkspaceReadClient({ getSession: async () => session("session") }, {
    request: async (_url, init) => { const b = JSON.parse(init.body); bodies.push(b); return ok(b.operation, { items: [], next_cursor: cursor }); },
  });
  const original = { cursor: null, limit: 40, channel: "all", query: "" };
  await client.call("history", original); await client.call("history", { cursor, limit: 40 });
  assert.equal("cursor" in bodies[0].arguments, false);
  assert.equal(original.cursor, null);
  assert.deepEqual(bodies[1].arguments.cursor, cursor);
});
test("one 401 refresh preserves the operation and payload and retries with only the refreshed user token", async () => {
  const calls = []; let refreshed = 0;
  const client = createWorkspaceReadClient({ getSession: async () => session("expired"), refreshSession: async () => { refreshed++; return session("refreshed-user"); } }, {
    request: async (_url, init) => { calls.push(init); return calls.length === 1 ? Response.json({}, { status: 401 }) : ok("workspace.history", { items: [] }); },
  });
  await client.call("history", { limit: 5 });
  assert.equal(refreshed, 1); assert.equal(calls.length, 2);
  assert.equal(calls[0].body, calls[1].body);
  assert.equal(calls[1].headers.Authorization, "Bearer refreshed-user");
});
test("invalid or deferred success, provider refusal and network failure never fall back to the legacy executor", async () => {
  for (const response of [
    Response.json({ ok: true, operation: "workspace.overview", executed: false, result: {} }),
    Response.json({ ok: true, operation: "workspace.history", executed: true, result: { ok: true, contract_version: "1.0.0" } }),
    Response.json({ ok: false, error: "portal_customer_access_required", executed: false }, { status: 403 }),
    Response.json({ ok: true, operation: "workspace.overview", executed: true, result: { ok: false, contract_version: "1.0.0" } }),
    new Response("not JSON"), null,
  ]) {
    let calls = 0;
    const client = createWorkspaceReadClient({ getSession: async () => session("user") }, { request: async () => { calls++; if (!response) throw Error("network"); return response; } });
    await assert.rejects(() => client.call("overview")); assert.equal(calls, 1);
  }
});
test("missing authentication ends at login and unknown actions do not dispatch", async () => {
  let calls = 0, logins = 0;
  const client = createWorkspaceReadClient({ getSession: async () => ({ data: { session: null } }) }, {
    request: async () => { calls++; throw Error("unexpected"); }, onSessionExpired: () => { logins++; },
  });
  await assert.rejects(() => client.call("overview"));
  await assert.rejects(() => client.call("mission_create", {}));
  assert.equal(client.handles("mission_create"), false); assert.equal(client.handles("toString"), false);
  assert.equal(calls, 0); assert.equal(logins, 1);
});
