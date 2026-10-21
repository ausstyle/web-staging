import assert from "node:assert/strict";
import { Ajv } from "npm:ajv@8.17.1";
import { fullFormats } from "npm:ajv-formats@3.0.1/dist/formats.js";
import {
  ENGINEERING_MCP_ENDPOINT,
  inspectEngineeringMcp,
  MCP_DISCOVERY_OPERATION,
  mcpDiscoveryContract,
} from "./mcp_diagnostics.ts";
const revision = "a".repeat(64);
type Row = Record<string, unknown>;
const init = {
  protocolVersion: "2025-03-26",
  capabilities: { tools: {} },
  serverInfo: { name: "sandy-engineering-mcp", version: "0.2.0" },
};
const list = {
  tools: [{
    name: "engineering.preflight",
    inputSchema: { type: "object", additionalProperties: false },
  }],
  _meta: {
    sandy_catalogue_version: revision,
    sandy_unavailable_aliases: [{
      name: "sandy_run_model_canary",
      operation: "engineering.models.canary",
      reason: "canonical_operation_unavailable",
    }],
  },
};
function fixture(
  reply?: (body: Row, index: number) => Response | Promise<Response>,
) {
  const requests: Request[] = [];
  const request: typeof fetch = async (input, options) => {
    const incoming = new Request(input, options);
    requests.push(incoming);
    assert.equal(incoming.url, ENGINEERING_MCP_ENDPOINT);
    assert.equal(incoming.method, "POST");
    assert.equal(incoming.redirect, "error");
    const body = await incoming.clone().json();
    return reply ? reply(body, requests.length) : Response.json({
      jsonrpc: "2.0",
      id: body.id,
      result: body.method === "initialize" ? init : list,
    });
  };
  return { requests, request };
}
Deno.test("MCP diagnostic only initializes and discovers the fixed server with the actual user credential context", async () => {
  const f = fixture();
  const result = await inspectEngineeringMcp({}, {
    userToken: "fixture.actual.user.jwt",
    apiKey: "fixture-private-key",
    request: f.request,
    now: () => new Date("2026-10-20T23:50:00Z"),
  });
  assert.equal(result.status, 200);
  const requests = await Promise.all(
    f.requests.map((request) => request.clone().json()),
  );
  assert.deepEqual(requests.map((body) => body.method), [
    "initialize",
    "tools/list",
  ]);
  assert.ok(
    f.requests.every((request) =>
      request.headers.get("authorization") ===
        "Bearer fixture.actual.user.jwt" &&
      request.headers.get("x-sandy-api-key") === "fixture-private-key"
    ),
  );
  assert.equal(result.body.operation, MCP_DISCOVERY_OPERATION);
  assert.equal(result.body.tool_execution_requested, false);
  assert.equal(result.body.catalogue_version, revision);
  assert.equal(result.body.tool_count, 1);
  assert.deepEqual(result.body.tools, ["engineering.preflight"]);
  assert.deepEqual(
    result.body.compatibility_gaps,
    list._meta.sandy_unavailable_aliases,
  );
  assert.equal(JSON.stringify(result).includes("fixture-private-key"), false);
  assert.equal(
    JSON.stringify(result).includes("fixture.actual.user.jwt"),
    false,
  );
  const ajv = new Ajv({ strict: true, validateFormats: true });
  for (const [name, format] of Object.entries(fullFormats)) {
    ajv.addFormat(name, format);
  }
  assert.equal(
    ajv.compile(mcpDiscoveryContract.output_schema)(result.body),
    true,
  );
});
Deno.test("legacy server metadata remains observed without fabricating an API catalogue version or missing-alias status", async () => {
  const f = fixture((body) =>
    Response.json({
      jsonrpc: "2.0",
      id: body.id,
      result: body.method === "initialize"
        ? {
          ...init,
          serverInfo: { name: "sandy-engineering-mcp", version: "0.1.0" },
        }
        : { tools: list.tools },
    })
  );
  const result = await inspectEngineeringMcp({}, {
    userToken: "fixture.user.jwt",
    request: f.request,
  });
  assert.equal(result.status, 200);
  assert.equal(result.body.catalogue_version, null);
  assert.equal(result.body.compatibility_gaps, null);
  assert.deepEqual(result.body.server_info, {
    name: "sandy-engineering-mcp",
    version: "0.1.0",
  });
});
Deno.test("MCP session metadata is forwarded only to the same fixed endpoint and never returned", async () => {
  const f = fixture((body) =>
    Response.json({
      jsonrpc: "2.0",
      id: body.id,
      result: body.method === "initialize" ? init : list,
    }, {
      headers: body.method === "initialize"
        ? { "mcp-session-id": "fixture-private-session-id" }
        : {},
    })
  );
  const result = await inspectEngineeringMcp({}, {
    userToken: "fixture.user.jwt",
    request: f.request,
  });
  assert.equal(result.status, 200);
  assert.equal(f.requests[0].headers.get("mcp-session-id"), null);
  assert.equal(
    f.requests[1].headers.get("mcp-session-id"),
    "fixture-private-session-id",
  );
  assert.equal(
    JSON.stringify(result).includes("fixture-private-session-id"),
    false,
  );
});
Deno.test("diagnostic arguments cannot inject endpoints, methods, tool calls or a service execution context", async () => {
  const f = fixture();
  for (
    const args of [
      { endpoint: "https://other.fixture.invalid/mcp" },
      { method: "tools/call" },
      { tool: "deployment_execute" },
      { service: "fixture-service-value" },
      [],
      null,
    ]
  ) {
    assert.equal(
      (await inspectEngineeringMcp(args, {
        userToken: "fixture.user.jwt",
        request: f.request,
      })).status,
      400,
    );
  }
  assert.equal(
    (await inspectEngineeringMcp({}, { userToken: "", request: f.request }))
      .status,
    401,
  );
  assert.equal(
    (await inspectEngineeringMcp({}, {
      userToken: "fixture.user.jwt",
      apiKey: "",
      request: f.request,
    })).status,
    401,
  );
  assert.equal(f.requests.length, 0);
});
Deno.test("malformed, incomplete, repeated or paginated MCP catalogues never become verified discovery", async () => {
  for (
    const malformed of [
      { tools: null },
      { tools: [...list.tools, ...list.tools] },
      { tools: [{ name: "unsafe name", inputSchema: { type: "object" } }] },
      { tools: list.tools, nextCursor: "more" },
      { ...list, _meta: { sandy_catalogue_version: "invalid" } },
      {
        ...list,
        _meta: {
          sandy_unavailable_aliases: [{
            name: "valid_name",
            operation: "bad operation",
            reason: "unavailable",
          }],
        },
      },
    ]
  ) {
    const f = fixture((body) =>
      Response.json({
        jsonrpc: "2.0",
        id: body.id,
        result: body.method === "initialize" ? init : malformed,
      })
    );
    const result = await inspectEngineeringMcp({}, {
      userToken: "fixture.user.jwt",
      request: f.request,
    });
    assert.equal(result.status, 502);
    assert.equal(result.body.ok, false);
    assert.equal(result.body.tool_execution_requested, false);
    assert.equal(f.requests.length, 2);
  }
});
Deno.test("protocol, authentication, response and transport failures remain precise and do not trigger a tool or retry", async () => {
  for (
    const response of [
      () => Response.json({ error: "private-fixture-detail" }, { status: 403 }),
      () => Response.json({ jsonrpc: "2.0", id: "wrong-id", result: init }),
      () =>
        Response.json({
          jsonrpc: "2.0",
          id: "sandy-discovery-initialize",
          error: { message: "private-fixture-detail" },
        }),
      () =>
        Response.json({
          jsonrpc: "2.0",
          id: "sandy-discovery-initialize",
          result: { ...init, protocolVersion: "unsupported" },
        }),
      () => new Response("not-json"),
      () => new Response(" ".repeat(2 * 1024 * 1024 + 1)),
      () => Promise.reject(new Error("private-fixture-detail")),
    ]
  ) {
    const f = fixture(response);
    const result = await inspectEngineeringMcp({}, {
      userToken: "fixture.user.jwt",
      request: f.request,
    });
    assert.ok([424, 502].includes(result.status));
    assert.equal(result.body.ok, false);
    assert.equal(result.body.stage, "initialize");
    assert.equal(f.requests.length, 1);
    assert.equal(
      JSON.stringify(result).includes("private-fixture-detail"),
      false,
    );
  }
});
