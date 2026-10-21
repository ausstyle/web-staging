import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { AjvJsonSchemaValidator } from "@modelcontextprotocol/sdk/validation/ajv";
import { createApp } from "../src/server.mjs";
import { aliases, callTool, createApiInvoker, discover } from "../src/api-adapter.mjs";

const project = "zmqlyygzqoidkcwdysok";
const endpoint = `https://${project}.supabase.co/functions/v1/sandy-operation-api`;
const user = "fixture.real.user.jwt";
const publicAnon = "eyJhbGciOiJIUzI1NiJ9." + Buffer.from(JSON.stringify({ role: "anon", ref: project })).toString("base64url") + ".fixtureSignature";
const serviceJwt = "eyJhbGciOiJIUzI1NiJ9." + Buffer.from(JSON.stringify({ role: "service_role", ref: project })).toString("base64url") + ".fixtureSignature";
const changeId = "11111111-2222-4333-8444-555555555555";
const input = { type: "object", properties: {}, additionalProperties: false };
const output = { type: "object", required: ["ok"], properties: { ok: { const: true } } };
const entry = (operation, overrides = {}) => ({
  operation, description: `API-owned ${operation}`, api_exposed: true, ai_exposed: true,
  executable: true, verified: false, input_schema: input, output_schema: output, ...overrides
});

function fixture() {
  const entries = Object.values(aliases).map(operation => entry(operation));
  const calls = [];
  const state = { entries, revision: "a".repeat(64), execution: null, discovery: null, expectedToken: user, expectedKey: undefined };
  const request = async (url, init) => {
    assert.equal(url, endpoint, "Every request must target canonical API only");
    assert.equal(new Headers(init.headers).get("authorization"), `Bearer ${state.expectedToken}`);
    assert.equal(new Headers(init.headers).get("x-sandy-api-key"), state.expectedKey ?? null);
    assert.equal(init.redirect, "error");
    const body = JSON.parse(init.body);
    calls.push(body);
    if (body.action === "list") {
      if (state.discovery) return state.discovery();
      return Response.json({ ok: true, operations: state.entries, catalogue_version: state.revision });
    }
    assert.equal(body.action, "execute");
    assert.equal(body.channel, "mcp");
    if (state.execution) return state.execution(body);
    const registered = state.entries.find(row => row.operation === body.operation);
    if (!registered?.api_exposed || !registered?.ai_exposed) {
      return Response.json({ ok: false, error: "operation_not_mcp_exposed", executed: false }, { status: 403 });
    }
    const validate = new AjvJsonSchemaValidator().getValidator(registered.input_schema);
    if (!validate(body.arguments).valid) {
      return Response.json({ ok: false, error: "invalid_operation_arguments", executed: false }, { status: 400 });
    }
    return Response.json({
      ok: true, operation: body.operation, executed: true,
      result: { ok: true, requested_operation: body.operation, arguments: body.arguments }
    });
  };
  const api = createApiInvoker(project, request, publicAnon);
  return { api, state, calls };
}

async function http(t, api, configuredAnon = "") {
  const server = createApp({ api, publicAnon: configuredAnon }).listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => { server.closeAllConnections(); server.close(); });
  const root = `http://127.0.0.1:${server.address().port}`;
  return async (method, params = {}, token = user, apiKey) => {
    const response = await fetch(root + "/mcp", {
      method: "POST",
      headers: {
        "content-type": "application/json", accept: "application/json, text/event-stream",
        "mcp-protocol-version": "2025-03-26",
        ...(token === null ? {} : { authorization: `Bearer ${token}` }),
        ...(apiKey !== undefined ? { "x-sandy-api-key": apiKey } : {})
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params })
    });
    return { response, body: await response.json() };
  };
}

test("HTTP discovery preserves five aliases and their exact API schemas, plus new canonical tools and revision changes", async t => {
  const f = fixture();
  const schema = { type: "object", required: ["change_id"], properties: { change_id: { type: "string", format: "uuid" } }, additionalProperties: false };
  f.state.entries.find(row => row.operation === "engineering.change.get").input_schema = schema;
  f.state.entries.push(entry("new.api.capability"));
  const post = await http(t, f.api);
  const first = await post("tools/list");
  assert.equal(first.response.status, 200);
  assert.deepEqual(first.body.result._meta, { sandy_catalogue_version: "a".repeat(64), sandy_unavailable_aliases: [] });
  const tools = first.body.result.tools;
  for (const [name, operation] of Object.entries(aliases)) {
    const tool = tools.find(row => row.name === name);
    const canonical = f.state.entries.find(row => row.operation === operation);
    assert.deepEqual(tool.inputSchema, canonical.input_schema);
    assert.deepEqual(tool.outputSchema, canonical.output_schema);
    assert.equal(tool._meta.sandy_operation, operation);
  }
  assert.ok(tools.some(row => row.name === "new.api.capability"));
  f.state.revision = "b".repeat(64);
  f.state.entries.find(row => row.operation === "engineering.change.get").input_schema = { ...schema, title: "Changed by API" };
  const changed = await post("tools/list");
  assert.equal(changed.body.result._meta.sandy_catalogue_version, "b".repeat(64));
  assert.equal(changed.body.result.tools.find(row => row.name === "sandy_engineering_change_details").inputSchema.title, "Changed by API");
  assert.deepEqual(f.calls, [{ action: "list" }, { action: "list" }]);
});

test("all five legacy tools execute only through authenticated API and retain MCP content/http_status with canonical evidence", async t => {
  const f = fixture();
  const post = await http(t, f.api);
  for (const [name, operation] of Object.entries(aliases)) {
    const { response, body } = await post("tools/call", { name, arguments: {} });
    assert.equal(response.status, 200);
    assert.equal(body.result.isError, false);
    const legacy = JSON.parse(body.result.content[0].text);
    assert.equal(legacy.http_status, 200);
    if (name.startsWith("sandy_video_")) {
      assert.equal(legacy.jsonrpc, "2.0");
      assert.equal(legacy.id, name === "sandy_video_install_preflight" ? "video-preflight" : "video-execution-preflight");
      const backend = JSON.parse(legacy.result.content[0].text);
      assert.equal(backend.http_status, 200);
      assert.equal(backend.requested_operation, operation);
    } else assert.equal(legacy.requested_operation, operation);
    assert.equal(body.result.structuredContent.ok, true);
    assert.equal(body.result._meta.sandy_api.result.executed, true);
    assert.equal(body.result._meta.sandy_api.result.operation, operation);
  }
  assert.deepEqual(f.calls.filter(row => row.action === "execute").map(row => row.operation), Object.values(aliases));
});

test("missing or newly unexposed aliases report the exact canonical capability gap and never fall back to a provider", async t => {
  const f = fixture();
  f.state.entries.find(row => row.operation === "engineering.models.canary").ai_exposed = false;
  const post = await http(t, f.api);
  const listed = await post("tools/list");
  assert.equal(listed.body.result.tools.some(row => row.name === "sandy_run_model_canary"), false);
  assert.deepEqual(listed.body.result._meta.sandy_unavailable_aliases, [{
    name: "sandy_run_model_canary", operation: "engineering.models.canary", reason: "canonical_operation_unavailable"
  }]);
  for (const name of ["sandy_run_model_canary", "unknown.api.operation"]) {
    const called = await post("tools/call", { name, arguments: {} });
    assert.equal(called.body.result.isError, true);
    const error = JSON.parse(called.body.result.content[0].text);
    assert.equal(error.error, "canonical_operation_unavailable");
    assert.equal(error.executed, false);
    assert.equal(error.missing_capability.tool, name);
  }
  assert.equal(f.calls.some(row => row.action === "execute"), false);
});

test("API validation and exposure races remain failed tool calls without privileged substitutions", async t => {
  const f = fixture();
  f.state.entries.find(row => row.operation === "engineering.change.get").input_schema = {
    type: "object", required: ["change_id"], properties: { change_id: { type: "string", format: "uuid" } }, additionalProperties: false
  };
  const post = await http(t, f.api);
  const invalid = await post("tools/call", { name: "sandy_engineering_change_details", arguments: { change_id: changeId, action: "execute_job" } });
  assert.equal(invalid.body.result.isError, true);
  assert.equal(JSON.parse(invalid.body.result.content[0].text).error, "invalid_operation_arguments");
  f.state.execution = () => Response.json({ ok: false, error: "operation_not_mcp_exposed", executed: false }, { status: 403 });
  const disabled = await post("tools/call", { name: "sandy_engineering_change_details", arguments: { change_id: changeId } });
  assert.equal(disabled.body.result.isError, true);
  assert.equal(disabled.body.result._meta.sandy_api.status, 403);
});

test("HTTP 200 domain errors, malformed outputs and lost responses never become completed operations", async t => {
  const f = fixture();
  const post = await http(t, f.api);
  const operation = "video.install.preflight";
  for (const envelope of [
    { ok: false, operation, executed: true, result: { ok: false, error: "provider_failed" } },
    { ok: true, operation, executed: true, result: { ok: true, result: { ok: false, error: "nested_failed" } } },
    { ok: true, operation, executed: true, result: { ok: true, accepted: false } },
    { ok: true, operation, executed: true, result: { ok: true, accepted: null } },
    { ok: true, operation, executed: true, result: { missing: "required ok" } },
    { ok: true, operation: "other.operation", executed: true, result: { ok: true } },
    { ok: true, operation, executed: false, accepted: true },
    { ok: true, operation, executed: null, result: { ok: true } }
  ]) {
    f.state.execution = () => Response.json(envelope);
    const result = await post("tools/call", { name: "sandy_video_install_preflight", arguments: {} });
    assert.equal(result.body.result.isError, true);
    assert.equal("structuredContent" in result.body.result, false);
  }
  f.state.execution = () => { throw new Error(`private error ${user}`); };
  const lost = await post("tools/call", { name: "sandy_video_install_preflight", arguments: {} });
  assert.equal(lost.body.result.isError, true);
  const body = JSON.parse(lost.body.result.content[0].text);
  assert.equal(body.executed, null);
  assert.equal(body.reconciliation_required, true);
  assert.equal(JSON.stringify(lost.body).includes(user), false);
});

test("typed recorded admission stays accepted and executed:false; an incomplete or rejected receipt is an error", async t => {
  const f = fixture();
  const operation = "deployment.jobs.retry";
  const receipt = {
    ok: true, operation, accepted: true, executed: false, request_state: "recorded",
    retry_job_id: "22222222-3333-4444-8555-666666666666", dispatch_required: true, reused: false
  };
  f.state.entries.push(entry(operation, { output_schema: {
    type: "object", required: Object.keys(receipt), properties: {
      ok: { const: true }, operation: { const: operation }, accepted: { const: true },
      executed: { const: false }, request_state: { const: "recorded" },
      retry_job_id: { type: "string", format: "uuid" }, dispatch_required: { type: "boolean" }, reused: { type: "boolean" }
    }, additionalProperties: false
  } }));
  const post = await http(t, f.api);
  f.state.execution = () => Response.json(receipt, { status: 202 });
  const result = await post("tools/call", { name: operation, arguments: {} });
  assert.equal(result.body.result.isError, false);
  assert.deepEqual(result.body.result.structuredContent, receipt);
  assert.equal(JSON.parse(result.body.result.content[0].text).executed, false);
  for (const broken of [{ ...receipt, accepted: false }, { ...receipt, accepted: null }, { ...receipt, retry_job_id: undefined },
    { ...receipt, retry_job_id: "invalid-id" }, { ...receipt, dispatch_required: undefined }, { ...receipt, reused: undefined },
    { ...receipt, request_state: "pending" }]) {
    f.state.execution = () => Response.json(broken, { status: 202 });
    assert.equal((await post("tools/call", { name: operation, arguments: {} })).body.result.isError, true);
  }
});

test("generic request receipts preserve job state and require typed identity and admission fields", async t => {
  const f = fixture();
  const operation = "deployment.jobs.request";
  const receipt = {
    ok: true, operation, accepted: true, executed: false,
    job_id: "22222222-3333-4444-8555-666666666666", state: "pending_approval", reused: false, dispatch_required: false
  };
  f.state.entries.push(entry(operation, { output_schema: {
    type: "object", required: Object.keys(receipt), properties: {
      ok: { const: true }, operation: { const: operation }, accepted: { const: true }, executed: { const: false },
      job_id: { type: "string", format: "uuid" }, state: { type: "string" },
      reused: { type: "boolean" }, dispatch_required: { type: "boolean" }
    }, additionalProperties: false
  } }));
  const post = await http(t, f.api);
  for (const state of ["pending_approval", "approved", "failed"]) {
    f.state.execution = () => Response.json({ ...receipt, state }, { status: 202 });
    const result = await post("tools/call", { name: operation, arguments: {} });
    assert.equal(result.body.result.isError, false);
    assert.equal(result.body.result.structuredContent.state, state);
    assert.equal(result.body.result.structuredContent.executed, false);
  }
  for (const broken of [{ ...receipt, accepted: false }, { ...receipt, accepted: null }, { ...receipt, executed: null },
    { ...receipt, job_id: "bad-id" }, { ...receipt, state: undefined }, { ...receipt, reused: undefined },
    { ...receipt, dispatch_required: undefined }, { ...receipt, operation: "other.operation" }]) {
    f.state.execution = () => Response.json(broken, { status: 202 });
    const result = await post("tools/call", { name: operation, arguments: {} });
    assert.equal(result.body.result.isError, true);
    assert.equal("structuredContent" in result.body.result, false);
  }
});

test("caller auth, malformed discovery, duplicate contracts and transport failures fail closed without credentials in errors", async t => {
  const f = fixture();
  const post = await http(t, f.api);
  assert.equal((await post("tools/list", {}, null)).response.status, 401);
  assert.equal(f.calls.length, 0);
  for (const [status, expected] of [[401, 401], [403, 403], [500, 503]]) {
    f.state.discovery = () => Response.json({ error: "private_detail" }, { status });
    const result = await post("tools/list");
    assert.equal(result.response.status, expected);
    assert.equal(JSON.stringify(result.body).includes("private_detail"), false);
  }
  f.state.discovery = () => Response.json({ ok: true, operations: {}, catalogue_version: "a".repeat(64) });
  assert.equal((await post("tools/list")).response.status, 503);
  f.state.discovery = null;
  f.state.entries.push({ ...f.state.entries[0] });
  const listed = await post("tools/list");
  assert.equal(listed.body.result.tools.some(row => row.name === "sandy_model_route_readiness"), false);
  assert.equal(listed.body.result._meta.sandy_unavailable_aliases[0].operation, "engineering.models.readiness");
});

test("transport only accepts the fixed project URL and rejects oversized or invalid API bodies", async () => {
  assert.throws(() => createApiInvoker("https://elsewhere.invalid"));
  for (const body of ["not-json", "x".repeat(2 * 1024 * 1024 + 1)]) {
    const api = createApiInvoker(project, async (url, init) => {
      assert.equal(url, endpoint);
      assert.equal(init.redirect, "error");
      return new Response(body);
    });
    await assert.rejects(discover(api, user));
  }
  const f = fixture();
  const catalogue = await discover(f.api, user);
  const result = await callTool(f.api, user, catalogue, "constructor", {});
  assert.equal(result.isError, true);
  assert.equal(f.calls.some(row => row.action === "execute"), false);
});

test("an incoming API-key header travels unchanged with the user JWT on both discovery and execution", async t => {
  const f = fixture();
  const opaque = "sandyop_" + "a".repeat(64);
  f.state.expectedKey = opaque;
  const post = await http(t, f.api);
  const listed = await post("tools/list", {}, user, opaque);
  assert.equal(listed.response.status, 200);
  const called = await post("tools/call", { name: "sandy_model_route_readiness", arguments: {} }, user, opaque);
  assert.equal(called.body.result.isError, false);
  assert.equal(JSON.stringify(called.body).includes(opaque), false);
  assert.equal(JSON.stringify(called.body).includes(user), false);
  assert.deepEqual(f.calls.map(row => row.action), ["list", "list", "execute"]);
});

test("opaque bearer keys use only configured public anon gateway JWT and remain opaque to the adapter", async t => {
  for (const opaque of ["sandyop_" + "b".repeat(64), "sandy_api_" + changeId + "." + "b".repeat(43)]) {
    const f = fixture();
    f.state.expectedToken = publicAnon;
    f.state.expectedKey = opaque;
    const post = await http(t, f.api, publicAnon);
    const result = await post("tools/call", { name: "sandy_video_install_preflight", arguments: {} }, opaque);
    assert.equal(result.body.result.isError, false);
    assert.deepEqual(f.calls.map(row => row.action), ["list", "execute"]);
    assert.equal(JSON.stringify(result.body).includes(opaque), false);
    assert.equal(JSON.stringify(result.body).includes(publicAnon), false);
    f.state.discovery = () => Response.json({ error: "invalid_api_key" }, { status: 401 });
    assert.equal((await post("tools/list", {}, opaque)).response.status, 401);
  }
});

test("missing/publication-unsafe gateway config and ambiguous key contexts fail without a fallback or service identity", async t => {
  const opaque = "sandyop_" + "c".repeat(64);
  for (const configuredAnon of ["", serviceJwt, "sb_publishable_fixture"]) {
    const f = fixture();
    const post = await http(t, f.api, configuredAnon);
    const result = await post("tools/list", {}, opaque);
    assert.equal(result.response.status, 503);
    assert.equal(result.body.error, "public_anon_jwt_required");
    assert.equal(f.calls.length, 0);
  }
  const f = fixture();
  const post = await http(t, f.api, publicAnon);
  const ambiguous = await post("tools/list", {}, opaque, "different_opaque_key");
  assert.equal(ambiguous.response.status, 400);
  assert.equal(ambiguous.body.error, "ambiguous_api_key_context");
  const empty = await post("tools/list", {}, user, "");
  assert.equal(empty.response.status, 401);
  assert.equal(empty.body.error, "api_key_context_required");
  assert.equal(f.calls.length, 0);
  const api = createApiInvoker(project, async (_url, init) => {
    assert.equal(new Headers(init.headers).get("authorization"), `Bearer ${user}`);
    assert.equal(new Headers(init.headers).get("apikey"), null);
    return Response.json({ ok: true, operations: [], catalogue_version: "a".repeat(64) });
  }, serviceJwt);
  await discover(api, user);
});
