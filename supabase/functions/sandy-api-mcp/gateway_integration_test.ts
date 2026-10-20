import assert from "node:assert/strict";
import {
  createOperationHandler,
  type OperationDependencies,
} from "../sandy-operation-api/index.ts";
import { createApi, createHandler } from "./index.ts";

// These tests compose the real API and MCP request handlers. Database rows and
// provider responses below are test fixtures, never production evidence.
type Row = Record<string, unknown>;
const preflight = () => ({
  operation: "engineering.preflight",
  handler: "sandy-operation-api",
  api_exposed: true,
  ai_exposed: true,
  verified: false,
  input_schema: {
    type: "object",
    title: "Registry-owned preflight input",
    properties: {},
    additionalProperties: false,
  },
  output_schema: {
    type: "object",
    properties: { ok: { type: "boolean" } },
    required: ["ok"],
  },
});
const release = () => ({
  ...preflight(),
  operation: "deployment.management.release",
  input_schema: {
    type: "object",
    properties: {
      function_slug: {
        type: "string",
        enum: ["sandy-operation-api", "sandy-api-mcp"],
      },
      source_ref: { type: "string", const: "main" },
      change_id: { type: "string" },
    },
    required: ["function_slug", "source_ref", "change_id"],
    additionalProperties: false,
  },
});

function compose(options: {
  role?: string | null;
  registry?: Row[];
  backend?: () => Response;
} = {}) {
  const registry = options.registry ?? [preflight(), release()];
  const identityTokens: string[] = [];
  const backendRequests: Request[] = [];
  const apiRequests: Request[] = [];
  const apiResponses: { status: number; body: Record<string, unknown> }[] = [];
  const db = {
    auth: {
      getUser(token: string) {
        identityTokens.push(token);
        return Promise.resolve({
          data: { user: { id: "fixture-controller" } },
          error: null,
        });
      },
    },
    from(table: string) {
      assert.ok(
        ["sandy_controller_admins", "sandy_operation_registry"].includes(table),
      );
      let rows: Row[] = table === "sandy_operation_registry"
        ? registry
        : options.role === null
        ? []
        : [{
          role: options.role ?? "owner",
          enabled: true,
          auth_user_id: "fixture-controller",
        }];
      const result = () => ({ data: rows, error: null });
      const query = {
        select: (_columns: string) => query,
        eq(key: string, value: unknown) {
          rows = rows.filter((row) => row[key] === value);
          return query;
        },
        in(key: string, values: unknown[]) {
          rows = rows.filter((row) => values.includes(row[key]));
          return query;
        },
        order: (_column: string) => query,
        maybeSingle: () =>
          Promise.resolve({ data: rows[0] ?? null, error: null }),
        then(
          resolve: (value: ReturnType<typeof result>) => unknown,
          reject?: (reason: unknown) => unknown,
        ) {
          return Promise.resolve(result()).then(resolve, reject);
        },
      };
      return query;
    },
  } as unknown as OperationDependencies["db"];
  const backendFetch: typeof fetch = (input, init) => {
    backendRequests.push(new Request(input, init));
    return Promise.resolve(
      options.backend?.() ?? Response.json({ ok: true, verified: false }),
    );
  };
  const gateway = createOperationHandler({
    base: "https://sandy.fixture.invalid",
    service: "fixture-service-key",
    anon: "fixture-anon-key",
    db,
    fetch: backendFetch,
  });
  const gatewayFetch: typeof fetch = async (input, init) => {
    const request = new Request(input, init);
    assert.equal(
      request.url,
      "https://sandy.fixture.invalid/functions/v1/sandy-operation-api",
    );
    apiRequests.push(request.clone());
    const response = await gateway(request);
    apiResponses.push({
      status: response.status,
      body: await response.clone().json(),
    });
    return response;
  };
  const mcp = createHandler(
    createApi(
      "https://sandy.fixture.invalid",
      "fixture-anon-key",
      gatewayFetch,
    ),
  );
  const request = (method: string, params: Row = {}) =>
    mcp(
      new Request("https://mcp.fixture.invalid", {
        method: "POST",
        headers: {
          authorization: "Bearer fixture.user.jwt",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: "integration-request",
          method,
          params,
        }),
      }),
    );
  return {
    request,
    registry,
    identityTokens,
    backendRequests,
    apiRequests,
    apiResponses,
  };
}

Deno.test("composed discovery carries registry schemas through API and MCP without adapter schema copies", async () => {
  const registered = preflight();
  const h = compose({
    registry: [registered, release(), {
      ...preflight(),
      operation: "not.implemented",
    }, { ...preflight(), ai_exposed: false }],
  });
  const response = await h.request("tools/list");
  assert.equal(response.status, 200);
  const first = (await response.json()).result;
  const tools = first.tools;
  assert.match(first._meta.sandy_catalogue_version, /^[a-f0-9]{64}$/);
  assert.equal(tools.length, 2);
  assert.deepEqual(tools[0].inputSchema, registered.input_schema);
  assert.deepEqual(tools[0].outputSchema, registered.output_schema);
  assert.equal(h.apiResponses[0].body.ok, true);
  const apiRows = h.apiResponses[0].body.operations as Row[];
  assert.equal(apiRows[0].executable, true);
  assert.equal(apiRows[0].verified, false);
  registered.input_schema.title =
    "Revised registry schema, same running adapter";
  const revised = (await (await h.request("tools/list")).json()).result;
  const revisedTools = revised.tools;
  assert.notEqual(
    revised._meta.sandy_catalogue_version,
    first._meta.sandy_catalogue_version,
  );
  assert.equal(
    revisedTools[0].inputSchema.title,
    registered.input_schema.title,
  );
  assert.equal(h.backendRequests.length, 0);
});

Deno.test("composed owner filtering hides release and blocks direct MCP invocation for non-owners", async () => {
  const h = compose({ role: "administrator" });
  const tools = (await (await h.request("tools/list")).json()).result.tools;
  assert.deepEqual(tools.map((tool: { name: string }) => tool.name), [
    "engineering.preflight",
  ]);
  const response = await h.request("tools/call", {
    name: "deployment.management.release",
    arguments: {
      function_slug: "sandy-api-mcp",
      source_ref: "main",
      change_id: "11111111-2222-4333-8444-555555555555",
    },
  });
  assert.equal((await response.json()).result.isError, true);
  assert.equal(h.apiResponses[1].status, 403);
  assert.equal(h.apiResponses[1].body.error, "owner_required");
  assert.equal(h.backendRequests.length, 0);
});

Deno.test("composed tool execution forwards authenticated identity through every real layer", async () => {
  const h = compose();
  const response = await h.request("tools/call", {
    name: "engineering.preflight",
    arguments: {},
  });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.result.isError, false);
  assert.deepEqual(h.identityTokens, ["fixture.user.jwt"]);
  assert.equal(h.apiRequests.length, 1);
  assert.equal(
    h.apiRequests[0].headers.get("authorization"),
    "Bearer fixture.user.jwt",
  );
  assert.equal(h.backendRequests.length, 1);
  const backend = h.backendRequests[0];
  assert.equal(
    backend.url,
    "https://sandy.fixture.invalid/functions/v1/sandy-engineering-control",
  );
  assert.equal(backend.headers.get("authorization"), "Bearer fixture.user.jwt");
  assert.deepEqual(await backend.json(), { action: "preflight" });
  assert.deepEqual(body.result.structuredContent, {
    ok: true,
    verified: false,
  });
  const envelope = JSON.parse(body.result.content[0].text);
  assert.equal(envelope.result.executed, true);
  assert.equal(envelope.result.verified, undefined);
  assert.equal(envelope.result.result.verified, false);
});

Deno.test("composed HTTP-200 backend domain failure surfaces as MCP error without fabricated verification", async () => {
  const provider = {
    ok: false,
    error: "fixture_provider_denied",
    verified: false,
  };
  const h = compose({ backend: () => Response.json(provider) });
  const response = await h.request("tools/call", {
    name: "engineering.preflight",
    arguments: {},
  });
  const body = await response.json();
  assert.equal(body.result.isError, true);
  assert.equal(body.result.structuredContent, undefined);
  assert.equal(h.backendRequests.length, 1);
  assert.equal(h.apiResponses[0].status, 502);
  const envelope = JSON.parse(body.result.content[0].text);
  assert.equal(envelope.status, 502);
  assert.equal(envelope.result.ok, false);
  assert.equal(envelope.result.executed, true);
  assert.equal(envelope.result.upstream_status, 200);
  assert.equal(envelope.result.error, "fixture_provider_denied");
  assert.deepEqual(envelope.result.result, provider);
  assert.equal(envelope.result.verified, undefined);
});

Deno.test("composed initialization rejects authenticated users without controller membership", async () => {
  const h = compose({ role: null });
  const response = await h.request("initialize", {
    protocolVersion: "2025-03-26",
    capabilities: {},
    clientInfo: { name: "fixture-client", version: "1" },
  });
  assert.equal(response.status, 403);
  assert.equal((await response.json()).error.code, -32000);
  assert.deepEqual(h.identityTokens, ["fixture.user.jwt"]);
  assert.equal(
    h.apiResponses[0].body.error,
    "controller_administrator_required",
  );
  assert.equal(h.backendRequests.length, 0);
});
