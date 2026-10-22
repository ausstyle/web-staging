import assert from "node:assert/strict";
import {
  createOperationHandler,
  type OperationDependencies,
} from "../sandy-operation-api/index.ts";
import { createApi, createHandler } from "./index.ts";
import { argumentDigest } from "../_shared/sandy_api_protocol.ts";
import { loadExpandedProviderOperation } from "../sandy-provider-operation-api/expansion.ts";
import { expandedProviderExecutionScope } from "../sandy-provider-operation-api/expansion_gateway.ts";

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
  actorId?: string;
  executionPolicy?: boolean;
  rpc?: (name: string, args: Row) => Promise<{ data: unknown; error: null }>;
} = {}) {
  const registry = options.registry ?? [preflight(), release()];
  const identityTokens: string[] = [];
  const backendRequests: Request[] = [];
  const apiRequests: Request[] = [];
  const apiResponses: { status: number; body: Record<string, unknown> }[] = [];
  const db = {
    rpc(name: string, args: Row) {
      if (!options.rpc) throw Error("unexpected policy RPC");
      return options.rpc(name, args);
    },
    auth: {
      getUser(token: string) {
        identityTokens.push(token);
        return Promise.resolve({
          data: {
            user: {
              id: options.actorId ?? "fixture-controller",
              role: "authenticated",
              is_anonymous: false,
            },
          },
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
          auth_user_id: options.actorId ?? "fixture-controller",
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
    executionPolicy: options.executionPolicy,
  });
  const gatewayFetch: typeof fetch = async (input, init) => {
    const request = new Request(input, init);
    assert.equal(
      request.url,
      "https://sandy.fixture.invalid/functions/v1/sandy-operation-api",
    );
    apiRequests.push(request.clone());
    // Supabase Edge forwards the function-name path after removing /functions/v1.
    const response = await gateway(
      new Request("https://edge.fixture.invalid/sandy-operation-api", request),
    );
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
  const request = (
    method: string,
    params: Row = {},
    headers: Record<string, string> = {},
  ) =>
    mcp(
      new Request("https://mcp.fixture.invalid", {
        method: "POST",
        headers: {
          authorization: "Bearer fixture.user.jwt",
          "content-type": "application/json",
          ...headers,
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

Deno.test("MCP discovery traverses byte-bounded API pages and refuses stale schema cursors", async () => {
  const first = {
      ...preflight(),
      input_schema: {
        ...preflight().input_schema,
        description: "x".repeat(950000),
      },
    },
    second = {
      ...release(),
      input_schema: {
        ...release().input_schema,
        title: "Original",
        description: "y".repeat(950000),
      },
    };
  const h = compose({ registry: [first, second] });
  const one = await (await h.request("tools/list")).json();
  assert.equal(one.result.tools.length, 1);
  assert.match(one.result.nextCursor, /^sc1\.[a-f0-9]{64}\.1$/);
  const two =
    await (await h.request("tools/list", { cursor: one.result.nextCursor }))
      .json();
  assert.equal(two.result.tools.length, 1);
  assert.equal(two.result.nextCursor, undefined);
  assert.deepEqual([one.result.tools[0].name, two.result.tools[0].name], [
    first.operation,
    second.operation,
  ]);
  assert.deepEqual(one.result.tools[0].inputSchema, first.input_schema);
  assert.deepEqual(two.result.tools[0].inputSchema, second.input_schema);
  second.input_schema.title = "Changed while paging";
  const stale = await h.request("tools/list", {
    cursor: one.result.nextCursor,
  });
  assert.equal(stale.status, 409);
  assert.match((await stale.json()).error.message, /restart/);
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

Deno.test("forwarded MCP IDs reach canonical admission bound to actual actor, operation, arguments and scope", async () => {
  // Synthetic scoped-policy fixture exercises the actual transport and API;
  // it does not issue a real approval or replace a production customer session.
  const actor = "70000000-0000-4000-8000-000000000001",
    other = "70000000-0000-4000-8000-000000000002",
    approval = "70000000-0000-4000-8000-000000000003",
    requestId = "70000000-0000-4000-8000-000000000004";
  const operation = "gcp.instance_group_managers.get",
    args = { path: { instanceGroupManager: "fixture" } };
  const expectedInput = await argumentDigest(args),
    expectedScope = await argumentDigest(
      expandedProviderExecutionScope(operation),
    );
  const original = await loadExpandedProviderOperation(operation);
  assert.ok(original);
  const unrelated = await loadExpandedProviderOperation(
    "github.repos.get_branch_protection",
  );
  assert.ok(unrelated);
  for (
    const scenario of [
      { actor, operation, args, approval, allowed: true, contract: original },
      {
        actor: other,
        operation,
        args,
        approval,
        allowed: false,
        contract: original,
      },
      {
        actor,
        operation,
        args: { path: { instanceGroupManager: "different" } },
        approval,
        allowed: false,
        contract: original,
      },
      {
        actor,
        operation,
        args,
        approval: other,
        allowed: false,
        contract: original,
      },
      {
        actor,
        operation: unrelated.operation,
        args: { path: { branch: "fixture" } },
        approval,
        allowed: false,
        contract: unrelated,
      },
    ]
  ) {
    let admissions = 0;
    const h = compose({
      actorId: scenario.actor,
      executionPolicy: true,
      registry: [{
        ...preflight(),
        ...scenario.contract,
        handler: "sandy-provider-operation-api",
        api_exposed: true,
        ai_exposed: true,
        verified: true,
        output_schema: {
          type: "object",
          required: ["ok"],
          properties: { ok: { const: true } },
        },
        error_contract: { contract_sha256: scenario.contract.contract_sha256 },
      }],
      async rpc(name, proof) {
        admissions++;
        assert.equal(name, "sandy_api_admit_execution");
        assert.equal(proof.p_actor_id, scenario.actor);
        assert.equal(proof.p_tenant_id, null);
        assert.equal(proof.p_operation, scenario.operation);
        assert.equal(proof.p_input_sha256, await argumentDigest(scenario.args));
        assert.equal(proof.p_request_id, requestId);
        assert.equal(proof.p_approval_id, scenario.approval);
        assert.equal(proof.p_credential_id, null);
        const bound = proof.p_actor_id === actor &&
          proof.p_operation === operation &&
          proof.p_input_sha256 === expectedInput &&
          proof.p_scope_sha256 === expectedScope &&
          proof.p_approval_id === approval;
        assert.equal(bound, scenario.allowed);
        return {
          error: null,
          data: bound
            ? {
              ok: true,
              allowed: true,
              reused: false,
              admission_id: other,
              grant_id: approval,
              state: "admitted",
              executed: false,
              expires_at: new Date(Date.now() + 60000).toISOString(),
            }
            : {
              ok: false,
              http_status: 403,
              error: "scoped_mutation_approval_required",
            },
        };
      },
      backend: () =>
        Response.json({
          ok: true,
          operation,
          executed: true,
          result: { metadata: "synthetic" },
        }),
    });
    const result = await (await h.request("tools/call", {
      name: scenario.operation,
      arguments: scenario.args,
      _meta: { actor_id: other, tenant_id: other },
    }, {
      "x-sandy-approval-id": scenario.approval,
      "x-sandy-request-id": requestId,
      "x-sandy-actor-id": other,
      "x-sandy-tenant-id": other,
    })).json();
    assert.equal(result.result.isError, !scenario.allowed);
    assert.equal(admissions, 1);
    assert.equal(h.backendRequests.length, scenario.allowed ? 1 : 0);
    assert.deepEqual(h.identityTokens, ["fixture.user.jwt"]);
    assert.equal(
      h.apiRequests[0].headers.get("x-sandy-approval-id"),
      scenario.approval,
    );
    assert.equal(h.apiRequests[0].headers.get("x-sandy-request-id"), requestId);
    assert.equal(h.apiRequests[0].headers.get("x-sandy-actor-id"), null);
    assert.equal(h.apiRequests[0].headers.get("x-sandy-tenant-id"), null);
  }
});
