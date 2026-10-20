import {
  type ApiResponse,
  createApi,
  createHandler,
  type InvokeApi,
} from "./index.ts";

function assert(
  condition: unknown,
  message = "Assertion failed",
): asserts condition {
  if (!condition) throw new Error(message);
}
function equal(actual: unknown, expected: unknown) {
  assert(
    JSON.stringify(actual) === JSON.stringify(expected),
    `Expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}`,
  );
}
function request(body: unknown, authorization = "Bearer test.identity.token") {
  return new Request("https://mcp.test.invalid", {
    method: "POST",
    headers: { authorization, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}
function message(method: string, params: unknown = {}) {
  return { jsonrpc: "2.0", id: 7, method, params };
}
const init = message("initialize", {
  protocolVersion: "2025-03-26",
  capabilities: {},
  clientInfo: { name: "test-client", version: "1" },
});
const catalogue = { status: 200, result: { ok: true, operations: [] } };
const noApi: InvokeApi = () => {
  throw new Error("API must not be invoked");
};

Deno.test("missing and malformed bearer are rejected before API invocation", async () => {
  for (
    const header of ["", "Basic credentials", "Bearer bad token", "Bearer "]
  ) {
    const response = await createHandler(noApi)(request(init, header));
    equal(response.status, 401);
    equal(await response.json(), { error: "authentication_required" });
  }
});

Deno.test("initialization authenticates through API discovery and preserves denial", async () => {
  let calls = 0;
  const handler = createHandler(async (token, body) => {
    calls++;
    equal(token, "test.identity.token");
    equal(body, { action: "list" });
    return {
      status: 403,
      result: { error: "controller_administrator_required" },
    };
  });
  const response = await handler(request(init));
  equal(response.status, 403);
  equal((await response.json()).error.code, -32000);
  equal(calls, 1);
});

Deno.test("authenticated initialize returns MCP protocol capabilities", async () => {
  const response = await createHandler(async () => catalogue)(request(init));
  equal(response.status, 200);
  const body = await response.json();
  equal(body.id, 7);
  equal(body.result.protocolVersion, "2025-03-26");
  equal(body.result.capabilities, { tools: {} });
  equal(response.headers.get("cache-control"), "no-store");
});

Deno.test("discovery uses API schemas for new executable operation names", async () => {
  const input = {
    type: "object",
    properties: { resource_id: { type: "string", minLength: 1 } },
    required: ["resource_id"],
    additionalProperties: false,
  };
  const output = { type: "object", properties: { state: { type: "string" } } };
  const entry = {
    operation: "new.capability.inspect",
    api_exposed: true,
    ai_exposed: true,
    executable: true,
    input_schema: input,
    output_schema: output,
    description: "Inspect a registered resource",
  };
  const response = await createHandler(async () => ({
    status: 200,
    result: { ok: true, operations: [entry] },
  }))(request(message("tools/list")));
  equal((await response.json()).result.tools, [{
    name: entry.operation,
    description: entry.description,
    inputSchema: input,
    outputSchema: output,
  }]);
});

Deno.test("discovery omits disabled, unimplemented, malformed and duplicate rows", async () => {
  const entry = {
    operation: "resource.inspect",
    api_exposed: true,
    ai_exposed: true,
    executable: true,
    input_schema: { type: "object", properties: {} },
  };
  const rows = [
    { ...entry, operation: "resource.disabled", executable: false },
    { ...entry, operation: "resource.unimplemented", executable: undefined },
    { ...entry, operation: "resource.private", api_exposed: false },
    { ...entry, operation: "resource.hidden", ai_exposed: false },
    {
      ...entry,
      operation: "resource.bad_schema",
      input_schema: { type: "array" },
    },
    { ...entry, operation: "resource.missing_schema", input_schema: null },
    { ...entry, operation: "https://provider.test.invalid" },
    null,
    false,
    entry,
    entry,
  ];
  const response = await createHandler(async () => ({
    status: 200,
    result: { ok: true, operations: rows },
  }))(request(message("tools/list")));
  const tools = (await response.json()).result.tools;
  equal(tools.length, 1);
  equal(tools[0].name, "resource.inspect");
});

Deno.test("malformed API catalogue fails rather than advertising empty success", async () => {
  const response = await createHandler(async () => ({
    status: 200,
    result: { ok: true },
  }))(
    request(message("tools/list")),
  );
  equal(response.status, 502);
  equal((await response.json()).error.code, -32000);
});

Deno.test("tool invocation forwards caller and arguments only to Sandy API", async () => {
  const handler = createHandler(async (token, body) => {
    equal(token, "test.identity.token");
    equal(body, {
      action: "execute",
      channel: "mcp",
      operation: "resource.inspect",
      arguments: { id: "abc" },
    });
    return {
      status: 200,
      result: { executed: true, ok: true, result: { state: "ready" } },
    };
  });
  const response = await handler(request(message("tools/call", {
    name: "resource.inspect",
    arguments: { id: "abc" },
  })));
  const body = await response.json();
  equal(body.result.isError, false);
  equal(body.result.structuredContent, { state: "ready" });
  equal(JSON.parse(body.result.content[0].text).result.result, {
    state: "ready",
  });
});

Deno.test("tool invocation never turns downstream domain failures into success", async () => {
  const failures: ApiResponse[] = [
    { status: 403, result: { executed: true, error: "denied" } },
    { status: 200, result: { executed: false, ok: true } },
    { status: 200, result: { executed: true, ok: false } },
    { status: 200, result: { executed: true, error: "failed" } },
    {
      status: 200,
      result: {
        executed: true,
        result: { ok: false, error: "provider_denied" },
      },
    },
    {
      status: 200,
      result: { executed: true, result: { error: "domain_failure" } },
    },
    { status: 200, result: null },
    { status: 200, result: { executed: true, ok: true, result: null } },
    {
      status: 200,
      result: { executed: true, ok: true, result: ["unexpected"] },
    },
  ];
  for (const failure of failures) {
    const response = await createHandler(async () => failure)(
      request(message("tools/call", {
        name: "resource.inspect",
      })),
    );
    const body = await response.json();
    equal(body.result.isError, true);
    equal(body.result.structuredContent, undefined);
    equal(JSON.parse(body.result.content[0].text), failure);
  }
});

Deno.test("invalid JSON and JSON-RPC envelopes do not reach API", async () => {
  const invalid = [
    null,
    [],
    7,
    {},
    { jsonrpc: "1.0", id: 1, method: "tools/list" },
    { jsonrpc: "2.0", id: {}, method: "tools/list" },
    {
      jsonrpc: "2.0",
      method: "tools/call",
      params: { name: "resource.inspect" },
    },
  ];
  for (const body of invalid) {
    const response = await createHandler(noApi)(request(body));
    equal(response.status, 400);
    equal((await response.json()).error.code, -32600);
  }
  const response = await createHandler(noApi)(
    new Request("https://mcp.test.invalid", {
      method: "POST",
      headers: { authorization: "Bearer test.identity.token" },
      body: "{",
    }),
  );
  equal((await response.json()).error.code, -32700);
});

Deno.test("invalid method parameters cannot dispatch a tool", async () => {
  const invalid = [
    message("tools/call", []),
    message("tools/call", null),
    message("tools/call", { name: "resource.inspect", arguments: [] }),
    message("tools/call", { name: "resource.inspect", arguments: null }),
    message("tools/call", { name: "https://provider.test.invalid" }),
    message("tools/call", { name: "resource.inspect", _meta: false }),
    message("tools/list", { cursor: "ignored-page" }),
    message("initialize", {}),
  ];
  for (const body of invalid) {
    const response = await createHandler(noApi)(request(body));
    equal(response.status, 400);
    equal((await response.json()).error.code, -32602);
  }
});

Deno.test("initialized notification authenticates and returns no JSON-RPC response", async () => {
  let calls = 0;
  const response = await createHandler(async () => {
    calls++;
    return catalogue;
  })(request({
    jsonrpc: "2.0",
    method: "notifications/initialized",
  }));
  equal(calls, 1);
  equal(response.status, 202);
  equal(await response.text(), "");
});

Deno.test("network failure returns a controlled transport error", async () => {
  const response = await createHandler(async () => {
    throw new TypeError("unreachable");
  })(
    request(message("tools/list")),
  );
  equal(response.status, 502);
  equal((await response.json()).error.message, "Sandy API unavailable");
});

Deno.test("API transport targets only Sandy operation API and preserves caller identity", async () => {
  const api = createApi(
    "https://project.test.invalid",
    "public-anon",
    (async (url, init) => {
      equal(
        url,
        "https://project.test.invalid/functions/v1/sandy-operation-api",
      );
      equal(init?.method, "POST");
      const headers = new Headers(init?.headers);
      equal(headers.get("authorization"), "Bearer test.identity.token");
      equal(headers.get("apikey"), "public-anon");
      equal(JSON.parse(String(init?.body)), { action: "list" });
      assert(init?.signal instanceof AbortSignal);
      return Response.json({ ok: true, operations: [] });
    }) as typeof fetch,
  );
  equal(await api("test.identity.token", { action: "list" }), catalogue);
});
