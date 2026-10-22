import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { AjvJsonSchemaValidator } from "@modelcontextprotocol/sdk/validation/ajv";
import { createApp } from "../src/server.mjs";
import { callTool, describeTool, discover } from "../src/api-adapter.mjs";
import { transportInputSchema } from "../src/generated/mcp-transport.mjs";

const revision = "a".repeat(64), cursor = `sc1.${revision}.100`;
const input = { type: "object", properties: {}, additionalProperties: false };
const entry = operation => ({ operation, api_exposed: true, ai_exposed: true, executable: true,
  input_schema: input, output_schema: { type: "object", required: ["ok"], properties: { ok: { const: true } } } });

test("HTTP discovery pages canonical API and late-page calls describe only their own operation", async t => {
  const calls = [], late = entry("provider.late.get");
  const api = async (token, body) => {
    assert.equal(token, "fixture.user.jwt"); calls.push(body);
    if (body.action === "list") {
      assert.equal(body.channel, "mcp"); assert.equal(body.limit, 100);
      return { status: 200, result: { ok: true, catalogue_version: revision,
        operations: body.cursor ? [late] : Array.from({ length: 100 }, (_, i) => entry(`provider.item_${i}.get`)),
        ...(body.cursor ? {} : { next_cursor: cursor }) } };
    }
    if (body.action === "describe") {
      assert.equal(body.operation, late.operation);
      return { status: 200, result: { ok: true, operation: late } };
    }
    return { status: 200, result: { ok: true, operation: late.operation, executed: true, result: { ok: true } } };
  };
  const server = createApp({ api }).listen(0, "127.0.0.1"); await once(server, "listening");
  t.after(() => { server.closeAllConnections(); server.close(); });
  const post = async (method, params) => {
    const r = await fetch(`http://127.0.0.1:${server.address().port}/mcp`, { method: "POST",
      headers: { authorization: "Bearer fixture.user.jwt", "content-type": "application/json",
        accept: "application/json, text/event-stream", "mcp-protocol-version": "2025-03-26" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) });
    assert.equal(r.status, 200); return r.json();
  };
  const first = await post("tools/list", {});
  assert.equal(first.result.tools.length, 100); assert.equal(first.result.nextCursor, cursor);
  assert.ok(first.result._meta.sandy_unavailable_aliases.every(x => x.reason === "not_in_this_catalogue_page"));
  const second = await post("tools/list", { cursor });
  assert.equal(second.result.tools[0].name, late.operation); assert.equal(second.result.nextCursor, undefined);
  const called = await post("tools/call", { name: late.operation, arguments: {} });
  assert.equal(called.result.isError, false);
  assert.deepEqual(calls.map(x => x.action), ["list", "list", "describe", "execute"]);
});

test("stale, malformed and non-advancing API cursors fail explicitly without an unbounded fallback", async () => {
  await assert.rejects(discover(async () => { throw Error("must not call"); }, "user", undefined, undefined, "bad"),
    error => error.status === 400 && error.code === "invalid_catalogue_cursor");
  const reply = value => async () => ({ status: 200, result: { ok: true, operations: [], catalogue_version: revision, ...value } });
  for (const value of [{ next_cursor: "bad" }, { next_cursor: `sc1.${"b".repeat(64)}.100` },
    { operations: Array.from({ length: 101 }, () => entry("provider.read")) }])
    await assert.rejects(discover(reply(value), "user"), error => error.status === 503);
  await assert.rejects(discover(reply({ next_cursor: cursor }), "user", undefined, undefined, cursor), error => error.status === 409);
  await assert.rejects(discover(async () => ({ status: 409, result: { error: "catalogue_changed_restart_discovery" } }), "user"),
    error => error.status === 409 && error.code === "catalogue_changed_restart_discovery");
});

test("per-call approval envelope preserves typed local refs and sends metadata separately from API arguments", async () => {
  const mutation = { ...entry("github.files.update"), is_mutation: true, input_schema: {
    type: "object", required: ["value"], additionalProperties: false,
    properties: { value: { $ref: "#/$defs/value" } }, $defs: { value: { type: "string", minLength: 1 } }
  } };
  const approvalId = "11111111-2222-4333-8444-555555555555", requestId = "22222222-3333-4444-8555-666666666666";
  let executes = 0;
  const api = async (token, body, key, metadata) => {
    if (body.action === "describe") return { status: 200, result: { ok: true, operation: mutation } };
    executes++; assert.equal(token, "normal.user.jwt"); assert.equal(key, "opaque-key");
    assert.deepEqual(body.arguments, { value: "reviewed" });
    assert.deepEqual(metadata, { approvalId, requestId });
    return { status: 200, result: { ok: true, operation: mutation.operation, executed: true, result: { ok: true } } };
  };
  const catalogue = await describeTool(api, "normal.user.jwt", mutation.operation);
  const tool = catalogue.tools[0], wrapped = { __sandy_execution: { approval_id: approvalId, request_id: requestId }, arguments: { value: "reviewed" } };
  const validate = new AjvJsonSchemaValidator().getValidator(tool.inputSchema);
  assert.equal(validate(wrapped).valid, true); assert.equal(validate({ value: "reviewed" }).valid, true);
  assert.equal(validate({ ...wrapped, arguments: { value: 1 } }).valid, false);
  assert.equal((await callTool(api, "normal.user.jwt", catalogue, mutation.operation, wrapped, "opaque-key")).isError, false);
  for (const [args, headers] of [[{ ...wrapped, extra: true }, {}],
    [{ ...wrapped, __sandy_execution: { approval_id: "bad" } }, {}],
    [wrapped, { requestId: approvalId }]]) {
    const denied = await callTool(api, "normal.user.jwt", catalogue, mutation.operation, args, "opaque-key", headers);
    assert.equal(denied.isError, true); assert.equal(JSON.parse(denied.content[0].text).error, "invalid_execution_metadata");
  }
  assert.equal(executes, 1);
});

test("Cloud Run build artifact is an exact generated copy of the Edge MCP transport module", async () => {
  const original = await readFile(new URL("../../../supabase/functions/_shared/sandy_mcp_transport.mjs", import.meta.url));
  const generated = await readFile(new URL("../src/generated/mcp-transport.mjs", import.meta.url), "utf8");
  const header = `// Generated from supabase/functions/_shared/sandy_mcp_transport.mjs; SHA256 ${createHash("sha256").update(original).digest("hex")}; do not edit.\n`;
  assert.equal(generated, header + original.toString("utf8"));
  assert.deepEqual(transportInputSchema(input).$defs.sandy_api_arguments, input);
});

test("canonical asynchronous receipts expose the typed handler payload without claiming provider completion", async () => {
  const operation = "provider.async.run", payload = { ok: true, job: { id: "job-1", state: "queued" } };
  const record = { ...entry(operation), output_schema: { type: "object", required: ["ok", "job"],
    properties: { ok: { const: true }, job: { type: "object", required: ["id", "state"] } }, additionalProperties: false } };
  let admission = "11111111-2222-4333-8444-555555555555";
  const api = async (_token, body) => body.action === "describe"
    ? { status: 200, result: { ok: true, operation: record } }
    : { status: 202, result: { ok: true, operation, accepted: true, executed: false, admission_id: admission, result: payload } };
  const catalogue = await describeTool(api, "normal.user.jwt", operation);
  const accepted = await callTool(api, "normal.user.jwt", catalogue, operation);
  assert.equal(accepted.isError, false); assert.deepEqual(accepted.structuredContent, payload);
  assert.equal(JSON.parse(accepted.content[0].text).executed, false);
  assert.equal(accepted._meta.sandy_api.result.executed, false);
  admission = null;
  assert.equal((await callTool(api, "normal.user.jwt", catalogue, operation)).isError, true);
});

test("normal HTTP tool calls carry per-call approval metadata through the shared adapter", async t => {
  const record = { ...entry("github.files.update"), is_mutation: true };
  const approvalId = "11111111-2222-4333-8444-555555555555";
  let executed = 0;
  const api = async (token, body, _key, metadata) => {
    assert.equal(token, "fixture.user.jwt");
    if (body.action === "describe") return { status: 200, result: { ok: true, operation: record } };
    assert.equal(body.action, "execute"); assert.deepEqual(body.arguments, {});
    assert.deepEqual(metadata, { approvalId }); executed++;
    return { status: 200, result: { ok: true, operation: record.operation, executed: true, result: { ok: true } } };
  };
  const server = createApp({ api }).listen(0, "127.0.0.1"); await once(server, "listening");
  t.after(() => { server.closeAllConnections(); server.close(); });
  const response = await fetch(`http://127.0.0.1:${server.address().port}/mcp`, { method: "POST",
    headers: { authorization: "Bearer fixture.user.jwt", "content-type": "application/json",
      accept: "application/json, text/event-stream", "mcp-protocol-version": "2025-03-26" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: {
      name: record.operation, arguments: { __sandy_execution: { approval_id: approvalId }, arguments: {} } } }) });
  assert.equal(response.status, 200); assert.equal((await response.json()).result.isError, false);
  assert.equal(executed, 1);
});
