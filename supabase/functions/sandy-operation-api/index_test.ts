import assert from "node:assert/strict";
import { createOperationHandler, type OperationDependencies } from "./index.ts";
import { createApi, createHandler } from "../sandy-api-mcp/index.ts";
import { legacyOperationContracts } from "./legacy_operations.ts";
import { customerOperationContracts } from "./customer_operations.ts";
import { customerServiceContracts } from "./customer_services.ts";
import { policyOperationContracts } from "./policy_operations.ts";
import { orchestrationContracts } from "../sandy-orchestration-api/contracts.ts";
import { extensionContracts } from "./installed_extensions.ts";
import { providerOperations } from "../sandy-provider-operation-api/gateway.ts";
import { installedOperationIds } from "./index.ts";
import { argumentDigest } from "../_shared/sandy_api_protocol.ts";
import { gapContracts } from "../sandy-provider-gap-api/contracts.ts";
import {
  createGapHandler,
  type Dependencies as GapDependencies,
} from "../sandy-provider-gap-api/index.ts";
import {
  createServiceHandler,
  type Dependencies as ServiceDependencies,
} from "../sandy-supabase-service-api/index.ts";

const preflight = {
  operation: "engineering.preflight",
  handler: "sandy-operation-api",
  api_exposed: true,
  ai_exposed: true,
  verified: false,
  input_schema: { type: "object", properties: {}, additionalProperties: false },
  output_schema: { type: "object" },
  permission_scope: "engineering:read",
  is_mutation: false,
};
const release = {
  ...preflight,
  operation: "deployment.management.release",
  verified: true,
  is_mutation: true,
  input_schema: {
    type: "object",
    required: ["function_slug", "source_ref", "change_id"],
    properties: {
      function_slug: {
        type: "string",
        enum: ["sandy-operation-api", "sandy-api-mcp"],
      },
      source_ref: { type: "string", const: "main" },
      change_id: { type: "string" },
    },
    additionalProperties: false,
  },
};
type Row = Record<string, unknown>;
type Options = {
  rows?: readonly Row[];
  role?: string | null;
  actorId?: string;
  registryError?: boolean;
  authError?: boolean;
  roleError?: boolean;
  tenant?: string | null;
  tenantError?: boolean;
  memoryTenant?: string | null;
  memoryEmail?: string;
  memoryError?: boolean;
  memoryAddressError?: boolean;
  memoryRevoked?: boolean;
  memoryPrimary?: boolean;
  emailConfirmed?: boolean;
  rpcData?: Row;
  rpcError?: boolean;
  rpcHandler?: (name: string, args: Row) => unknown | Promise<unknown>;
  executionPolicy?: boolean;
  backend?: (input: string, init?: RequestInit) => Response | Promise<Response>;
  resolveCredential?: OperationDependencies["resolveCredential"];
  authenticatedDb?: OperationDependencies["authenticatedDb"];
  packageRestoreBindings?: OperationDependencies["packageRestoreBindings"];
};
function harness(options: Options = {}) {
  const calls: { url: string; init?: RequestInit }[] = [];
  const rpcCalls: { name: string; args: unknown }[] = [];
  const identityTokens: string[] = [];
  const tables: string[] = [];
  const db = {
    async rpc(name: string, args: unknown) {
      rpcCalls.push({ name, args });
      return {
        data: options.rpcHandler
          ? await options.rpcHandler(name, args as Row)
          : options.rpcData ?? null,
        error: options.rpcError ? { message: "connection lost" } : null,
      };
    },
    auth: {
      getUser: (token: string) => {
        identityTokens.push(token);
        return Promise.resolve({
          data: {
            user: options.authError ? null : {
              id: options.actorId ?? "controller-test-user",
              ...(options.tenant !== undefined ||
                  options.memoryTenant !== undefined
                ? { email: "fixture-user@example.invalid" }
                : {}),
              ...(options.memoryTenant !== undefined &&
                  options.emailConfirmed !== false
                ? { email_confirmed_at: "2026-10-20T00:00:00Z" }
                : {}),
            },
          },
          error: options.authError ? { message: "invalid" } : null,
        });
      },
    },
    from(table: string) {
      tables.push(table);
      let rows = table === "sandy_memory_portal_accounts"
        ? options.memoryTenant
          ? [{
            customer_id: options.memoryTenant,
            auth_user_id: options.actorId ?? "controller-test-user",
            revoked_at: options.memoryRevoked ? "2026-10-20T00:00:00Z" : null,
          }]
          : []
        : table === "email_customer_addresses"
        ? options.memoryTenant
          ? [{
            customer_id: options.memoryTenant,
            normalized_email: options.memoryEmail ??
              "fixture-user@example.invalid",
            is_primary: options.memoryPrimary !== false,
          }]
          : []
        : table === "sandy_agenda_access"
        ? options.tenant
          ? [{
            customer_id: options.tenant,
            email: "fixture-user@example.invalid",
            enabled: true,
          }]
          : []
        : table === "sandy_operation_registry"
        ? options.rows ?? [preflight, release]
        : options.role === null
        ? []
        : [{
          role: options.role ?? "owner",
          enabled: true,
          auth_user_id: options.actorId ?? "controller-test-user",
        }];
      const error = table === "sandy_memory_portal_accounts"
        ? options.memoryError
        : table === "email_customer_addresses"
        ? options.memoryAddressError
        : table === "sandy_agenda_access"
        ? options.tenantError
        : table === "sandy_operation_registry"
        ? options.registryError
        : options.roleError;
      const result = () => ({
        data: error ? null : rows,
        error: error ? { message: "unavailable" } : null,
      });
      const query = {
        select: (_columns: string) => query,
        eq(key: string, value: unknown) {
          rows = rows.filter((row) => row[key] === value);
          return query;
        },
        is(key: string, value: unknown) {
          rows = rows.filter((row) => row[key] === value);
          return query;
        },
        in(key: string, values: unknown[]) {
          rows = rows.filter((row) => values.includes(row[key]));
          return query;
        },
        order: (_key: string) => query,
        maybeSingle: () =>
          Promise.resolve({
            ...result(),
            data: error ? null : rows[0] ?? null,
          }),
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
  const handler = createOperationHandler({
    base: "https://example.supabase.co",
    service: "test-service-credential",
    anon: "test-anon-key",
    db,
    resolveCredential: options.resolveCredential,
    executionPolicy: options.executionPolicy,
    authenticatedDb: options.authenticatedDb,
    packageRestoreBindings: options.packageRestoreBindings,
    fetch: ((input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      calls.push({ url, init });
      return Promise.resolve(
        options.backend
          ? options.backend(url, init)
          : Response.json({ ok: true }),
      );
    }) as typeof fetch,
  });
  const request = (
    body: unknown,
    authorization: string | null = "Bearer test-user-jwt",
  ) =>
    handler(
      new Request("https://local.invalid", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(authorization ? { authorization } : {}),
        },
        body: JSON.stringify(body),
      }),
    );
  return { handler, request, calls, rpcCalls, identityTokens, tables };
}

Deno.test("gateway requires authenticated controller membership", async () => {
  for (
    const [options, token, status] of [
      [{}, null, 401],
      [{ authError: true }, "Bearer bad", 401],
      [{ role: null }, "Bearer user", 403],
      [{ roleError: true }, "Bearer user", 503],
    ] as [Options, string | null, number][]
  ) {
    const h = harness(options);
    assert.equal((await h.request({ action: "list" }, token)).status, status);
    assert.equal(h.calls.length, 0);
  }
});

Deno.test("discovery exposes only enabled known handlers and preserves registry evidence and schemas", async () => {
  const h = harness({
    rows: [
      preflight,
      release,
      { ...preflight, operation: "unimplemented.operation" },
      { ...preflight, operation: "constructor" },
      { ...preflight, api_exposed: false },
      { ...preflight, handler: "untrusted-function" },
    ],
  });
  const response = await h.request({ action: "list" });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.deepEqual(body.operations, [{ ...preflight, executable: true }, {
    ...release,
    executable: true,
  }]);
  assert.equal(body.operations[0].verified, false);
  assert.equal(h.calls.length, 0);
});

Deno.test("non-owner cannot discover, describe or execute release", async () => {
  const h = harness({ role: "administrator" });
  const body = await (await h.request({ action: "list" })).json();
  assert.deepEqual(body.operations.map((row: Row) => row.operation), [
    "engineering.preflight",
  ]);
  for (const action of ["describe", "execute"]) {
    const response = await h.request({ action, operation: release.operation });
    assert.equal(response.status, 403);
    assert.equal((await response.json()).error, "owner_required");
  }
  assert.equal(h.calls.length, 0);
});

Deno.test("describe and execute fail closed for unimplemented or incorrectly registered handlers", async () => {
  for (
    const entry of [
      { ...preflight, operation: "unimplemented.operation" },
      { ...preflight, operation: "constructor" },
      { ...preflight, handler: "unexpected-handler" },
    ]
  ) {
    const h = harness({ rows: [entry] });
    for (const action of ["describe", "execute"]) {
      const response = await h.request({ action, operation: entry.operation });
      assert.equal(response.status, 422);
      assert.equal((await response.json()).executed, false);
    }
    assert.equal(h.calls.length, 0);
  }
});

Deno.test("registry errors prevent discovery and execution", async () => {
  const h = harness({ registryError: true });
  for (const action of ["list", "describe", "execute"]) {
    const response = await h.request({
      action,
      operation: preflight.operation,
    });
    assert.equal(response.status, 503);
    assert.equal(
      (await response.json()).error,
      "operation_registry_unavailable",
    );
  }
  assert.equal(h.calls.length, 0);
});

Deno.test("preflight forwards the user identity and reports execution separately from verification", async () => {
  const h = harness({
    backend: () => Response.json({ ok: true, registered_change_count: 3 }),
  });
  const response = await h.request({
    action: "execute",
    operation: preflight.operation,
    arguments: {},
  });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.ok, true);
  assert.equal(body.executed, true);
  assert.equal(body.verified, undefined);
  assert.deepEqual(body.result, { ok: true, registered_change_count: 3 });
  assert.equal(h.calls.length, 1);
  assert.equal(
    h.calls[0].url,
    "https://example.supabase.co/functions/v1/sandy-engineering-control",
  );
  assert.equal(
    new Headers(h.calls[0].init?.headers).get("authorization"),
    "Bearer test-user-jwt",
  );
  assert.deepEqual(JSON.parse(String(h.calls[0].init?.body)), {
    action: "preflight",
  });
});

Deno.test("preflight rejects arguments before making any backend call", async () => {
  const h = harness();
  for (
    const args of [null, [], "value", { action: "delete" }, {
      tenant_id: "another-tenant",
    }]
  ) {
    const response = await h.request({
      action: "execute",
      operation: preflight.operation,
      arguments: args,
    });
    assert.equal(response.status, 400);
    assert.equal((await response.json()).executed, false);
  }
  assert.equal(h.calls.length, 0);
});

Deno.test("backend domain failures remain failures even when HTTP succeeds", async () => {
  for (
    const result of [{ ok: false, error: "provider_denied" }, { ok: false }, {
      error: "database_unavailable",
    }, {}]
  ) {
    const h = harness({ backend: () => Response.json(result) });
    const response = await h.request({
      action: "execute",
      operation: preflight.operation,
    });
    assert.equal(response.status, 502);
    const body = await response.json();
    assert.equal(body.ok, false);
    assert.equal(body.executed, true);
    assert.equal(body.upstream_status, 200);
    assert.deepEqual(body.result, result);
  }
});

Deno.test("provider rejection status is preserved with a failed operation result", async () => {
  const h = harness({
    backend: () => Response.json({ error: "owner_required" }, { status: 403 }),
  });
  const response = await h.request({
    action: "execute",
    operation: preflight.operation,
  });
  assert.equal(response.status, 403);
  const body = await response.json();
  assert.equal(body.ok, false);
  assert.equal(body.executed, true);
  assert.equal(body.error, "owner_required");
});

Deno.test("invalid backend responses never become successful operations", async () => {
  for (
    const backend of [
      () => new Response("invalid json"),
      () => Response.json([]),
      () => Response.json(null),
    ]
  ) {
    const h = harness({ backend });
    const response = await h.request({
      action: "execute",
      operation: preflight.operation,
    });
    assert.equal(response.status, 502);
    const body = await response.json();
    assert.equal(body.ok, false);
    assert.equal(body.executed, true);
  }
});

Deno.test("transport failure does not claim confirmed backend execution", async () => {
  const h = harness({
    backend: () => {
      throw new Error("network unavailable");
    },
  });
  const response = await h.request({
    action: "execute",
    operation: preflight.operation,
  });
  assert.equal(response.status, 502);
  const body = await response.json();
  assert.equal(body.ok, false);
  assert.equal(body.executed, false);
});

const releaseArgs = {
  function_slug: "sandy-api-mcp",
  source_ref: "main",
  change_id: "11111111-2222-4333-8444-555555555555",
};
Deno.test("release validates scope arguments and rejects unknown fields before dispatch", async () => {
  const h = harness();
  for (
    const args of [
      null,
      [],
      { ...releaseArgs, function_slug: "sandy-task-api" },
      { ...releaseArgs, source_ref: "feature/unreviewed" },
      { ...releaseArgs, change_id: "------------------------------------" },
      { ...releaseArgs, change_id: 123 },
      { ...releaseArgs, injected: true },
    ]
  ) {
    const response = await h.request({
      action: "execute",
      operation: release.operation,
      arguments: args,
    });
    assert.equal(response.status, 400);
    assert.equal((await response.json()).executed, false);
  }
  assert.equal(h.calls.length, 0);
});

Deno.test("release dispatch preserves approved identifiers without claiming functional production verification", async () => {
  const provider = {
    ok: true,
    verified: true,
    receipt: { version: 2 },
    rollback_mode: "delete_new_function_only",
  };
  const h = harness({ backend: () => Response.json(provider) });
  const response = await h.request({
    action: "execute",
    operation: release.operation,
    arguments: releaseArgs,
  });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.ok, true);
  assert.equal(body.executed, true);
  assert.equal(body.verified, undefined);
  assert.deepEqual(body.result, provider);
  assert.equal(
    new Headers(h.calls[0].init?.headers).get("authorization"),
    "Bearer test-service-credential",
  );
  assert.deepEqual(JSON.parse(String(h.calls[0].init?.body)), {
    action: "engineering_release",
    ...releaseArgs,
  });
});

const infrastructure = (operation = "supabase.functions.list") => ({
  ...preflight,
  operation,
  handler: "sandy-infrastructure-read",
  permission_scope:
    ["deployment", "engineering", "system"].includes(operation.split(".")[0])
      ? `${operation.split(".")[0]}:read`
      : "infrastructure:read",
  ai_exposed: false,
});

Deno.test("all installed infrastructure reads delegate through API with service authentication and retain exposure flags", async () => {
  const operations = [
    "supabase.functions.list",
    "supabase.functions.get",
    "supabase.project.status",
    "system.registry.list",
    "system.registry.describe",
    "system.registry.summary",
    "deployment.jobs.get",
    "deployment.jobs.list",
    "deployment.jobs.events",
    "deployment.audit.list",
    "engineering.changes.list",
    "engineering.change.detail",
    "engineering.change.events",
    "engineering.change.tests",
    "engineering.change.artifacts",
  ];
  for (const operation of operations) {
    const entry = infrastructure(operation);
    const h = harness({ rows: [entry] });
    const catalogue = await (await h.request({ action: "list" })).json();
    assert.equal(catalogue.operations[0].ai_exposed, false);
    assert.equal(catalogue.operations[0].executable, true);
    const r = await h.request({ action: "execute", operation, arguments: {} });
    assert.equal(r.status, 200);
    assert.equal(
      h.calls[0].url,
      "https://example.supabase.co/functions/v1/sandy-infrastructure-read",
    );
    assert.equal(
      new Headers(h.calls[0].init?.headers).get("authorization"),
      "Bearer test-service-credential",
    );
    assert.deepEqual(JSON.parse(String(h.calls[0].init?.body)), {
      operation,
      arguments: {},
    });
    const mcp = await h.request({
      action: "execute",
      channel: "mcp",
      operation,
    });
    assert.equal(mcp.status, 403);
    assert.equal(h.calls.length, 1);
  }
});

Deno.test("global infrastructure reads require owner and cannot execute mutations", async () => {
  const entry = infrastructure();
  const h = harness({ rows: [entry], role: "administrator" });
  assert.deepEqual(
    (await (await h.request({ action: "list" })).json()).operations,
    [],
  );
  for (const action of ["describe", "execute"]) {
    assert.equal(
      (await h.request({ action, operation: entry.operation })).status,
      403,
    );
  }
  assert.equal(h.calls.length, 0);
  const conflicting = harness({ rows: [{ ...entry, is_mutation: true }] });
  assert.equal(
    (await conflicting.request({
      action: "execute",
      operation: entry.operation,
    })).status,
    503,
  );
  assert.equal(conflicting.calls.length, 0);
});

Deno.test("registry input validation rejects malformed nested inputs without coercing or dispatching", async () => {
  const entry = {
    ...infrastructure(),
    input_schema: {
      type: "object",
      required: ["target"],
      additionalProperties: false,
      properties: {
        target: {
          type: "object",
          required: ["id"],
          additionalProperties: false,
          properties: {
            id: { type: "string", format: "uuid" },
            count: { type: "integer", minimum: 1, maximum: 5 },
          },
        },
      },
    },
  };
  const h = harness({ rows: [entry] });
  for (
    const args of [{}, { target: { id: "bad" } }, {
      target: { id: "11111111-2222-4333-8444-555555555555", count: "2" },
    }, { target: { id: "11111111-2222-4333-8444-555555555555", count: 6 } }]
  ) {
    assert.equal(
      (await h.request({
        action: "execute",
        operation: entry.operation,
        arguments: args,
      })).status,
      400,
    );
  }
  assert.equal(h.calls.length, 0);
});

Deno.test("invalid and asynchronous registry schemas fail closed before dispatch", async () => {
  for (
    const input_schema of [
      null,
      { type: "object", properties: { id: { type: "imaginary" } } },
      { type: "object", $ref: "https://untrusted.invalid/schema" },
      { type: "object", $async: true },
      { type: "object", $async: false },
      {
        type: "object",
        properties: { child: { $ref: "#/definitions/async" } },
        definitions: { async: { type: "object", $async: true } },
      },
    ]
  ) {
    const entry = { ...infrastructure(), input_schema };
    const h = harness({ rows: [entry], executionPolicy: true });
    const response = await h.request({
      action: "execute",
      operation: entry.operation,
    });
    assert.equal(response.status, 503);
    assert.equal((await response.json()).executed, false);
    assert.equal(h.calls.length, 0);
    assert.equal(h.rpcCalls.length, 0);
  }
});

Deno.test("repeated registry revisions release validators and preserve format refusals before dispatch", async () => {
  const collect = (globalThis as unknown as { gc?: () => void }).gc;
  const entry: Row = { ...infrastructure() };
  const h = harness({ rows: [entry] });
  const iterations = collect ? 2048 : 24;
  const invalid = [
    {
      id: "invalid",
      email: "person@example.invalid",
      at: "2026-10-21T00:00:00Z",
    },
    {
      id: "11111111-2222-4333-8444-555555555555",
      email: "invalid",
      at: "2026-10-21T00:00:00Z",
    },
    {
      id: "11111111-2222-4333-8444-555555555555",
      email: "person@example.invalid",
      at: "2026-02-30T00:00:00Z",
    },
  ];
  let baseline = 0;
  for (let revision = 0; revision < iterations + 8; revision++) {
    entry.input_schema = {
      $id: `urn:sandy:test:registry-revision:${revision}`,
      type: "object",
      required: ["id", "email", "at"],
      properties: {
        id: { type: "string", format: "uuid" },
        email: { type: "string", format: "email" },
        at: { type: "string", format: "date-time" },
        ...Object.fromEntries(Array.from({ length: 48 }, (_, field) => [
          `optional_${field}`,
          { type: "string", enum: [`revision_${revision}_field_${field}`] },
        ])),
      },
      additionalProperties: false,
    };
    const response = await h.request({
      action: "execute",
      operation: entry.operation,
      arguments: invalid[revision % invalid.length],
    });
    assert.equal(response.status, 400);
    assert.equal((await response.json()).executed, false);
    if (revision === 7 && collect) {
      await new Promise((resolve) => setTimeout(resolve, 0));
      collect();
      baseline = Deno.memoryUsage().heapUsed;
    }
  }
  assert.equal(h.calls.length, 0);
  assert.equal(h.rpcCalls.length, 0);
  if (collect) {
    await new Promise((resolve) => setTimeout(resolve, 0));
    collect();
    const retainedBytes = Deno.memoryUsage().heapUsed - baseline;
    console.info({
      registry_revisions: iterations,
      retained_bytes: retainedBytes,
    });
    assert.ok(
      retainedBytes < 200 * 1024 * 1024,
      `registry revisions retained ${retainedBytes} bytes after collection`,
    );
  }
});

Deno.test("output schema mismatch is an executed failure rather than verified success", async () => {
  const entry = {
    ...infrastructure(),
    output_schema: {
      type: "object",
      required: ["items"],
      properties: { items: { type: "array" } },
    },
  };
  const h = harness({
    rows: [entry],
    backend: () => Response.json({ ok: true, items: "wrong" }),
  });
  const response = await h.request({
    action: "execute",
    operation: entry.operation,
  });
  assert.equal(response.status, 502);
  const body = await response.json();
  assert.equal(body.executed, true);
  assert.equal(body.error, "upstream_output_schema_mismatch");
  assert.equal(body.result, undefined);
});

Deno.test("canonical capabilities routes use existing authorization and version the caller's catalogue", async () => {
  const h = harness();
  const request = (path: string) =>
    h.handler(
      new Request(
        "https://example.supabase.co/functions/v1/sandy-operation-api" + path,
        {
          headers: { authorization: "Bearer test-user-jwt" },
        },
      ),
    );
  const catalogue = await (await request("/v1/capabilities")).json();
  assert.match(catalogue.catalogue_version, /^[a-f0-9]{64}$/);
  const again = await (await request("/v1/capabilities")).json();
  assert.equal(again.catalogue_version, catalogue.catalogue_version);
  assert.equal(
    (await request("/v1/capabilities/engineering.preflight")).status,
    200,
  );
  assert.equal(
    (await h.handler(new Request("https://example.invalid/v1/capabilities")))
      .status,
    401,
  );
  assert.equal(h.calls.length, 0);
});

Deno.test("canonical execute route binds operation to URL and rejects conflicting envelopes", async () => {
  const h = harness();
  const request = (body: unknown) =>
    h.handler(
      new Request(
        "https://example.invalid/v1/operations/engineering.preflight:execute",
        {
          method: "POST",
          headers: {
            authorization: "Bearer test-user-jwt",
            "content-type": "application/json",
          },
          body: JSON.stringify(body),
        },
      ),
    );
  assert.equal((await request({ arguments: {} })).status, 200);
  assert.equal(
    (await request({
      operation: "deployment.management.release",
      arguments: {},
    })).status,
    400,
  );
  assert.equal(h.calls.length, 1);
});

Deno.test("canonical job routes delegate exact job identifier to installed read handler", async () => {
  const job_id = "11111111-2222-4333-8444-555555555555";
  const h = harness({
    actorId: "10000000-0000-4000-8000-000000000003",
    rpcHandler: (name, args) => {
      assert.equal(name, "sandy_api_resolve_job_route");
      return {
        ok: true,
        job_id,
        job_kind: "legacy",
        operation: `deployment.jobs.${args.p_action}`,
      };
    },
    rows: [
      infrastructure("deployment.jobs.get"),
      infrastructure("deployment.jobs.events"),
    ].map((entry) => ({
      ...entry,
      input_schema: {
        type: "object",
        required: ["job_id"],
        properties: { job_id: { type: "string", format: "uuid" } },
        additionalProperties: false,
      },
    })),
  });
  for (const suffix of ["", "/events"]) {
    const response = await h.handler(
      new Request("https://example.invalid/v1/jobs/" + job_id + suffix, {
        headers: { authorization: "Bearer test-user-jwt" },
      }),
    );
    assert.equal(response.status, 200);
    assert.deepEqual(JSON.parse(String(h.calls.at(-1)?.init?.body)), {
      operation: suffix ? "deployment.jobs.events" : "deployment.jobs.get",
      arguments: { job_id },
    });
  }
});

const customerRead = (operation = "tasks.list") => ({
  ...preflight,
  operation,
  handler: "sandy-operations-api",
  permission_scope: `${operation.split(".")[0]}:read`,
});
const opaqueKey = "sandyop_" + "a".repeat(64);
const opaqueKeyId = "40000000-0000-4000-8000-000000000001";
const opaqueTenant = "40000000-0000-4000-8000-000000000002";
const opaqueAdmission = "40000000-0000-4000-8000-000000000003";
const opaqueGrant = "40000000-0000-4000-8000-000000000004";
function opaqueKeyHarness(
  options: { refusal?: string; ai?: boolean; backend?: Options["backend"] } =
    {},
) {
  return harness({
    role: null,
    rows: [
      { ...customerRead(), ai_exposed: options.ai ?? true },
      customerRead("calendar.list"),
      release,
    ],
    rpcHandler(name, args) {
      if (name === "sandy_api_authenticate_customer_key") {
        return {
          ok: true,
          kind: "customer_key",
          key_id: opaqueKeyId,
          customer_id: opaqueTenant,
          scopes: ["tasks:read"],
          allowed_operations: ["tasks.get", "tasks.list"],
          key_revision_sha256: "b".repeat(64),
          expires_at: null,
        };
      }
      if (name === "sandy_api_admit_customer_key_execution") {
        assert.equal(args.p_key_id, opaqueKeyId);
        assert.equal(args.p_customer_id, opaqueTenant);
        assert.equal(Object.hasOwn(args, "p_actor_id"), false);
        return {
          ok: true,
          allowed: true,
          reused: false,
          principal_kind: "customer_key",
          customer_key_id: opaqueKeyId,
          tenant_id: opaqueTenant,
          admission_id: opaqueAdmission,
          grant_id: opaqueGrant,
          state: "admitted",
          executed: false,
          expires_at: "2099-01-01T00:00:00Z",
        };
      }
      if (name === "sandy_api_consume_customer_key_grant") {
        return options.refusal
          ? { ok: false, error: options.refusal, http_status: 403 }
          : {
            ok: true,
            allowed: true,
            reused: false,
            admission_id: opaqueAdmission,
          };
      }
      if (name === "sandy_api_finish_execution") {
        return {
          ok: true,
          admission_id: opaqueAdmission,
          state: args.p_outcome,
          reused: false,
        };
      }
      throw Error("unexpected customer key RPC");
    },
    backend: options.backend ?? (() => Response.json({ ok: true, items: [] })),
  });
}
function opaqueRequest(body: unknown, bearer = "test-anon-key") {
  return new Request("https://local.invalid", {
    method: "POST",
    headers: {
      authorization: `Bearer ${bearer}`,
      "x-sandy-api-key": opaqueKey,
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
}
Deno.test("legacy customer keys have explicit tenant scope and no fabricated Auth/Controller/Agenda identity in the composed gateway", async () => {
  const h = opaqueKeyHarness();
  const list = await h.handler(opaqueRequest({ action: "list" }));
  assert.equal(list.status, 200);
  assert.deepEqual(
    (await list.json()).operations.map((r: Row) => r.operation),
    ["tasks.list"],
  );
  assert.deepEqual(h.identityTokens, []);
  assert.deepEqual(h.tables, ["sandy_operation_registry"]);
  for (
    const operation of [
      "calendar.list",
      "tasks.create",
      "customer.keys.create",
      "memory.tree",
      "supabase.projects.get",
    ]
  ) {
    const result = await h.handler(
      opaqueRequest({ action: "execute", operation, arguments: {} }),
    );
    assert.equal(result.status, 404);
  }
  const result = await h.handler(
    opaqueRequest({
      action: "execute",
      operation: "tasks.list",
      arguments: {},
    }),
  );
  assert.equal(result.status, 200);
  assert.equal((await result.json()).admission_id, opaqueAdmission);
  assert.equal(h.calls.length, 1);
  assert.equal(
    new Headers(h.calls[0].init?.headers).get("authorization"),
    `Bearer ${opaqueKey}`,
  );
  assert.deepEqual(JSON.parse(String(h.calls[0].init?.body)), {
    operation: "tasks.list",
    arguments: {},
  });
  assert.deepEqual(h.rpcCalls.slice(-4).map((c) => c.name), [
    "sandy_api_authenticate_customer_key",
    "sandy_api_admit_customer_key_execution",
    "sandy_api_consume_customer_key_grant",
    "sandy_api_finish_execution",
  ]);
  assert.deepEqual(h.identityTokens, []);
  assert.ok(h.tables.every((t) => t === "sandy_operation_registry"));
});
Deno.test("customer key gateway preserves mixed-auth rejection, final grant refusal, AI flags and job tenant non-disclosure", async () => {
  const h = opaqueKeyHarness();
  assert.equal(
    (await h.handler(opaqueRequest({ action: "list" }, "actual-user-session")))
      .status,
    401,
  );
  assert.equal(h.rpcCalls.length, 0);
  const hidden = await h.handler(
    new Request(`https://local.invalid/v1/jobs/${retryJobId}`, {
      headers: {
        authorization: "Bearer test-anon-key",
        "x-sandy-api-key": opaqueKey,
      },
    }),
  );
  assert.equal(hidden.status, 404);
  assert.ok(
    h.rpcCalls.every((c) => c.name === "sandy_api_authenticate_customer_key"),
  );
  const refused = opaqueKeyHarness({ refusal: "customer_key_scope_denied" });
  assert.equal(
    (await refused.handler(
      opaqueRequest({
        action: "execute",
        operation: "tasks.list",
        arguments: {},
      }),
    )).status,
    403,
  );
  assert.equal(refused.calls.length, 0);
  const ai = opaqueKeyHarness({ ai: false });
  assert.equal(
    (await ai.handler(
      opaqueRequest({
        action: "execute",
        operation: "tasks.list",
        arguments: {},
        channel: "mcp",
      }),
    )).status,
    403,
  );
  assert.equal(ai.calls.length, 0);
  assert.equal(
    (await ai.handler(
      opaqueRequest({
        action: "execute",
        operation: "tasks.list",
        arguments: {},
      }),
    )).status,
    200,
  );
});
Deno.test("canonical MCP reaches the governed customer key API with its original opaque backend identity", async () => {
  const h = opaqueKeyHarness(), apiRequests: Request[] = [];
  const mcp = createHandler(
    createApi(
      "https://example.supabase.co",
      "test-anon-key",
      (async (input, init) => {
        const req = new Request(input, init);
        apiRequests.push(req.clone());
        return h.handler(req);
      }) as typeof fetch,
    ),
  );
  const response = await mcp(
    new Request("https://local.invalid/mcp", {
      method: "POST",
      headers: {
        authorization: "Bearer test-anon-key",
        "x-sandy-api-key": opaqueKey,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name: "tasks.list", arguments: {} },
      }),
    }),
  );
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.result.isError, false);
  assert.deepEqual(result.result.structuredContent, { ok: true, items: [] });
  assert.equal(apiRequests.length, 1);
  assert.equal(apiRequests[0].headers.get("x-sandy-api-key"), opaqueKey);
  assert.equal((await apiRequests[0].json()).channel, "mcp");
  assert.deepEqual(h.identityTokens, []);
  assert.equal(h.calls.length, 1);
  assert.equal(h.rpcCalls.length, 4);
});
Deno.test("customer key execution receipt URLs recover only projected own-key evidence without admitting or dispatching again", async () => {
  const requestId = "40000000-0000-4000-8000-000000000005";
  const h = harness({
    role: null,
    rows: [{
      ...policyOperationContracts["system.execution.get"],
      operation: "system.execution.get",
      handler: "sandy-operation-api",
      api_exposed: true,
      ai_exposed: true,
      verified: false,
    }],
    rpcHandler(name, args) {
      if (name === "sandy_api_authenticate_customer_key") {
        return {
          ok: true,
          kind: "customer_key",
          key_id: opaqueKeyId,
          customer_id: opaqueTenant,
          scopes: ["tasks:read"],
          allowed_operations: ["tasks.get", "tasks.list"],
          key_revision_sha256: "b".repeat(64),
          expires_at: null,
        };
      }
      assert.equal(name, "sandy_api_get_customer_key_receipt");
      assert.equal(args.p_key_id, opaqueKeyId);
      assert.equal(args.p_customer_id, opaqueTenant);
      assert.equal(args.p_request_id, requestId);
      return {
        ok: true,
        admission_id: opaqueAdmission,
        request_id: requestId,
        operation: "tasks.list",
        request_state: "consumed",
        accepted: false,
        executed: null,
        completed: false,
        outcome: "pending",
        provider_http_status: null,
        provider_request_id_sha256: null,
        result_sha256: null,
        reconciliation_required: true,
        redispatch_permitted: false,
        created_at: "2026-10-21T00:00:00Z",
        finished_at: null,
        grant_id: opaqueGrant,
        key_hash: "must not expose",
      };
    },
  });
  const result = await h.handler(
    new Request(`https://local.invalid/v1/executions/${requestId}`, {
      headers: {
        authorization: "Bearer test-anon-key",
        "x-sandy-api-key": opaqueKey,
      },
    }),
  );
  assert.equal(result.status, 200);
  const body = await result.json();
  assert.equal(body.result.executed, null);
  assert.equal(body.result.redispatch_permitted, false);
  assert.equal(Object.hasOwn(body.result, "grant_id"), false);
  assert.equal(JSON.stringify(body).includes("must not expose"), false);
  assert.deepEqual(h.rpcCalls.map((c) => c.name), [
    "sandy_api_authenticate_customer_key",
    "sandy_api_get_customer_key_receipt",
  ]);
  assert.deepEqual(h.identityTokens, []);
  assert.equal(h.calls.length, 0);
  assert.ok(h.tables.every((t) => t === "sandy_operation_registry"));
});
Deno.test("original provider read dispatch carries one consumed versioned proof with its actual arguments and receipt", async () => {
  const operation = "supabase.branches.get",
    requestId = "50000000-0000-4000-8000-000000000001";
  const readArguments = { name: "main" };
  const expectedInputDigest = await argumentDigest(readArguments);
  const admission = "50000000-0000-4000-8000-000000000002",
    grant = "50000000-0000-4000-8000-000000000003";
  let refusedBeforeProvider = false;
  const h = harness({
    actorId: retryActorId,
    executionPolicy: true,
    backend: () =>
      refusedBeforeProvider
        ? Response.json({
          ok: false,
          error: "consumer_active_binding_refused",
          executed: false,
        }, { status: 424 })
        : Response.json({ ok: true }, {
          headers: { "x-sandy-provider-http-status": "201" },
        }),
    rows: [{
      ...infrastructure(operation),
      handler: "sandy-provider-read-api",
      input_schema: {
        type: "object",
        required: ["name"],
        properties: { name: { type: "string" } },
        additionalProperties: false,
      },
    }],
    rpcHandler(name, args) {
      if (name === "sandy_api_admit_execution") {
        assert.equal(args.p_input_sha256, expectedInputDigest);
        return {
          ok: true,
          allowed: true,
          reused: false,
          admission_id: admission,
          grant_id: grant,
          state: "admitted",
          executed: false,
          expires_at: "2099-01-01T00:00:00Z",
        };
      }
      if (name === "sandy_api_consume_execution_grant") {
        assert.equal(args.p_input_sha256, expectedInputDigest);
        return {
          ok: true,
          allowed: true,
          reused: false,
          admission_id: admission,
        };
      }
      if (name === "sandy_api_finish_execution") {
        assert.equal(
          args.p_provider_http_status,
          refusedBeforeProvider ? null : 201,
        );
        return {
          ok: true,
          admission_id: admission,
          state: args.p_outcome,
          reused: false,
        };
      }
      throw Error("unexpected RPC");
    },
  });
  const response = await h.handler(
    new Request("https://local.invalid", {
      method: "POST",
      headers: {
        authorization: "Bearer original-user-jwt",
        "content-type": "application/json",
        "x-sandy-request-id": requestId,
      },
      body: JSON.stringify({
        action: "execute",
        operation,
        arguments: readArguments,
      }),
    }),
  );
  assert.equal(response.status, 200);
  assert.equal((await response.json()).upstream_status, 201);
  assert.deepEqual(JSON.parse(String(h.calls[0].init?.body)), {
    protocol: "consumed-admission-v1",
    operation,
    arguments: readArguments,
    actor_id: retryActorId,
    tenant_id: null,
    request_id: requestId,
    grant_id: grant,
    admission_id: admission,
    credential_id: null,
  });
  assert.deepEqual(h.rpcCalls.map((c) => c.name), [
    "sandy_api_admit_execution",
    "sandy_api_consume_execution_grant",
    "sandy_api_finish_execution",
  ]);
  assert.equal(h.calls.length, 1);
  refusedBeforeProvider = true;
  const refused = await h.request({
    action: "execute",
    operation,
    arguments: readArguments,
  });
  assert.equal(refused.status, 424);
  assert.equal((await refused.json()).executed, false);
  assert.equal(h.rpcCalls.length, 6);
  assert.equal(h.calls.length, 2);
});
const memoryRead = (operation = "memory.tree") => ({
  ...preflight,
  operation,
  handler: "sandy-memory-centre",
  permission_scope: "memory:read",
  input_schema: operation === "memory.evidence"
    ? {
      type: "object",
      required: ["id"],
      properties: { id: { type: "string", format: "uuid" } },
      additionalProperties: false,
    }
    : preflight.input_schema,
  output_schema: {
    type: "object",
    required: operation === "memory.evidence"
      ? ["ok", "item"]
      : operation === "memory.overview"
      ? ["ok", "overview"]
      : operation === "memory.life_brief"
      ? ["ok", "brief"]
      : operation === "memory.life_spaces"
      ? ["ok", "spaces", "areas", "suggestions"]
      : ["ok", "subjects", "links"],
    properties: {
      ok: { const: true },
      item: { type: "object" },
      overview: { type: "object" },
      brief: { type: "object" },
      spaces: { type: "array", items: { type: "object" } },
      areas: { type: "array", items: { type: "object" } },
      suggestions: { type: "array", items: { type: "object" } },
      subjects: { type: "array", items: { type: "object" } },
      links: { type: "array", items: { type: "object" } },
    },
    additionalProperties: false,
  },
});

Deno.test("passive memory reads use a separate portal grant, fixed query action and original user session", async () => {
  const id = "11111111-2222-4333-8444-555555555555";
  for (
    const [operation, action] of [
      ["memory.overview", "overview"],
      ["memory.tree", "memory_tree"],
      ["memory.evidence", "evidence"],
      ["memory.life_brief", "life_brief"],
      ["memory.life_spaces", "life_spaces"],
    ]
  ) {
    const args = operation === "memory.evidence" ? { id } : {};
    const result = operation === "memory.evidence"
      ? { ok: true, item: { id, content: "Synthetic source" } }
      : operation === "memory.overview"
      ? { ok: true, overview: { name: "Synthetic fixture", settings: null } }
      : operation === "memory.life_brief"
      ? { ok: true, brief: { enabled: false } }
      : operation === "memory.life_spaces"
      ? { ok: true, spaces: [], areas: [], suggestions: [] }
      : { ok: true, subjects: [], links: [] };
    const h = harness({
      role: null,
      memoryTenant: "memory-tenant-one",
      rows: [memoryRead(operation), customerRead(), preflight, release],
      backend: (url, init) => {
        // This models the backend's independent session check, not a service call.
        assert.equal(
          new Headers(init?.headers).get("authorization"),
          "Bearer test-user-jwt",
        );
        assert.equal(new URL(url).searchParams.get("op"), action);
        assert.deepEqual(JSON.parse(String(init?.body)), args);
        return Response.json(result);
      },
    });
    const catalogue = await (await h.request({ action: "list" })).json();
    assert.deepEqual(catalogue.operations.map((row: Row) => row.operation), [
      operation,
    ]);
    const response = await h.request({
      action: "execute",
      channel: "mcp",
      operation,
      arguments: args,
    });
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.deepEqual(body.result, result);
    assert.equal(body.verified, undefined);
    assert.equal(h.calls.length, 1);
    assert.equal(
      h.calls[0].url,
      "https://example.supabase.co/functions/v1/sandy-memory-centre?op=" +
        action,
    );
    assert.equal(h.calls[0].init?.method, "POST");
    assert.equal(
      new Headers(h.calls[0].init?.headers).get("apikey"),
      "test-anon-key",
    );
  }
});

Deno.test("Controller and Agenda grants cannot substitute for a verified Memory Portal grant", async () => {
  for (
    const options of [
      { tenant: "agenda-tenant", memoryTenant: null },
      { memoryTenant: "memory-tenant", memoryRevoked: true },
      { memoryTenant: "memory-tenant", memoryPrimary: false },
      { memoryTenant: "memory-tenant", memoryEmail: "other@example.invalid" },
      { memoryTenant: "memory-tenant", emailConfirmed: false },
    ]
  ) {
    const h = harness({ ...options, rows: [memoryRead(), preflight] });
    const catalogue = await (await h.request({ action: "list" })).json();
    assert.deepEqual(catalogue.operations.map((row: Row) => row.operation), [
      "engineering.preflight",
    ]);
    for (const action of ["describe", "execute"]) {
      const response = await h.request({ action, operation: "memory.tree" });
      assert.equal(response.status, 403);
      assert.equal((await response.json()).error, "memory_access_required");
    }
    assert.equal(h.calls.length, 0);
  }
});

Deno.test("Memory Portal identity and email directory errors fail closed before dispatch", async () => {
  for (const error of [{ memoryError: true }, { memoryAddressError: true }]) {
    const h = harness({
      role: null,
      memoryTenant: "memory-tenant",
      rows: [memoryRead()],
      ...error,
    });
    const response = await h.request({
      action: "execute",
      operation: "memory.tree",
    });
    assert.equal(response.status, 503);
    assert.equal(
      (await response.json()).error,
      "memory_authorisation_unavailable",
    );
    assert.equal(h.calls.length, 0);
  }
});

Deno.test("API exposure remains independent of AI exposure across Controller, Agenda and Memory handlers", async () => {
  for (const candidate of [preflight, customerRead(), memoryRead()]) {
    const entry = { ...candidate, ai_exposed: false };
    const isMemory = entry.operation.startsWith("memory.");
    const h = harness({
      role: entry.operation.startsWith("engineering.") ? "owner" : null,
      tenant: entry.operation.startsWith("tasks.") ? "agenda-tenant" : null,
      memoryTenant: isMemory ? "memory-tenant" : null,
      rows: [entry],
      backend: () =>
        Response.json(
          isMemory ? { ok: true, subjects: [], links: [] } : { ok: true },
        ),
    });
    const catalogue = await (await h.request({ action: "list" })).json();
    assert.deepEqual(catalogue.operations, [{ ...entry, executable: true }]);
    assert.equal(
      (await h.request({ action: "describe", operation: entry.operation }))
        .status,
      200,
    );
    // Compose the actual MCP adapter and API handlers. MCP discovery excludes
    // API-only rows and a direct tool call still reaches API's channel gate.
    const mcp = createHandler(createApi(
      "https://example.supabase.co",
      "test-anon-key",
      ((input: RequestInfo | URL, init?: RequestInit) =>
        h.handler(new Request(input, init))) as typeof fetch,
    ));
    const mcpRequest = (method: string, params: Row = {}) =>
      mcp(
        new Request("https://mcp.fixture.invalid", {
          method: "POST",
          headers: {
            authorization: "Bearer test-user-jwt",
            "content-type": "application/json",
          },
          body: JSON.stringify({
            jsonrpc: "2.0",
            id: "exposure-test",
            method,
            params,
          }),
        }),
      );
    const tools = await (await mcpRequest("tools/list")).json();
    assert.deepEqual(tools.result.tools, []);
    const blocked = await (await mcpRequest("tools/call", {
      name: entry.operation,
      arguments: {},
    })).json();
    assert.equal(blocked.result.isError, true);
    const denial = JSON.parse(blocked.result.content[0].text);
    assert.equal(denial.status, 403);
    assert.equal(
      denial.result.error,
      "operation_not_mcp_exposed",
    );
    assert.equal(h.calls.length, 0);
    assert.equal(
      (await h.request({ action: "execute", operation: entry.operation }))
        .status,
      200,
    );
    assert.equal(h.calls.length, 1);
  }
});

Deno.test("passive memory dispatch rejects forged identity/action fields even if registry schemas become permissive", async () => {
  for (const operation of ["memory.tree", "memory.evidence"]) {
    const h = harness({
      role: null,
      memoryTenant: "memory-tenant",
      rows: [{ ...memoryRead(operation), input_schema: { type: "object" } }],
    });
    for (
      const args of [
        { customer_id: "another-tenant" },
        { owner_customer_id: "another-tenant" },
        { action: "forget" },
        { op: "ask" },
        { id: "not-a-uuid" },
        { id: "11111111-2222-4333-8444-555555555555", confirm: true },
      ]
    ) {
      const response = await h.request({
        action: "execute",
        operation,
        arguments: args,
      });
      assert.equal(response.status, 400);
      assert.equal((await response.json()).executed, false);
    }
    assert.equal(h.calls.length, 0);
  }
});

Deno.test("memory contract drift, hidden exposure and side-effecting read labels never enable dispatch", async () => {
  for (
    const entry of [
      { ...memoryRead(), is_mutation: true },
      { ...memoryRead(), permission_scope: "memory:write" },
      { ...memoryRead(), handler: "sandy-operation-api" },
      { ...memoryRead(), api_exposed: false },
      ...[
        "memory.ask",
        "memory.search",
        "memory.life_search",
        "memory.biography",
      ]
        .map((operation) => memoryRead(operation)),
    ]
  ) {
    const h = harness({
      role: null,
      memoryTenant: "memory-tenant",
      rows: [entry],
    });
    assert.deepEqual(
      (await (await h.request({ action: "list" })).json()).operations,
      [],
    );
    const response = await h.request({
      action: "execute",
      channel: "mcp",
      operation: entry.operation,
    });
    assert.equal(response.status >= 400, true);
    assert.equal(h.calls.length, 0);
  }
});

Deno.test("memory backend authorization errors and invalid outputs preserve failure", async () => {
  for (
    const [provider, expectedStatus, expectedError] of [
      [
        () =>
          Response.json({
            error: "Sign in with your verified customer account.",
          }, { status: 401 }),
        401,
        "Sign in with your verified customer account.",
      ],
      [
        () => Response.json({ error: "source_not_found" }, { status: 404 }),
        404,
        "source_not_found",
      ],
      [
        () => Response.json({ ok: true, subjects: [], links: "invalid" }),
        502,
        "upstream_output_schema_mismatch",
      ],
    ] as [() => Response, number, string][]
  ) {
    const h = harness({
      role: null,
      memoryTenant: "memory-tenant",
      rows: [memoryRead()],
      backend: provider,
    });
    const response = await h.request({
      action: "execute",
      operation: "memory.tree",
    });
    const body = await response.json();
    assert.equal(response.status, expectedStatus);
    assert.equal(body.ok, false);
    assert.equal(body.error, expectedError);
    assert.equal(body.executed, true);
    assert.equal(body.verified, undefined);
    assert.equal(h.calls.length, 1);
  }
});

Deno.test("customer sessions discover only their installed tenant reads and forward their identity, never service credentials", async () => {
  const entry = customerRead();
  const h = harness({
    role: null,
    tenant: "tenant-one",
    rows: [entry, preflight, release, infrastructure()],
  });
  const catalogue = await (await h.request({ action: "list" })).json();
  assert.deepEqual(catalogue.operations.map((row: Row) => row.operation), [
    "tasks.list",
  ]);
  const response = await h.request({
    action: "execute",
    channel: "mcp",
    operation: entry.operation,
  });
  assert.equal(response.status, 200);
  assert.equal(
    h.calls[0].url,
    "https://example.supabase.co/functions/v1/sandy-operations-api",
  );
  assert.equal(
    new Headers(h.calls[0].init?.headers).get("authorization"),
    "Bearer test-user-jwt",
  );
  assert.deepEqual(JSON.parse(String(h.calls[0].init?.body)), {
    operation: "tasks.list",
    arguments: {},
  });
  assert.equal(
    (await h.request({ action: "execute", operation: preflight.operation }))
      .status,
    403,
  );
  assert.equal(h.calls.length, 1);
});
Deno.test("Controller membership alone never grants access to a customer's reads", async () => {
  const h = harness({ tenant: null, rows: [customerRead(), preflight] });
  const catalogue = await (await h.request({ action: "list" })).json();
  assert.deepEqual(catalogue.operations.map((row: Row) => row.operation), [
    "engineering.preflight",
  ]);
  assert.equal(
    (await h.request({ action: "execute", operation: "tasks.list" })).status,
    403,
  );
  assert.equal(h.calls.length, 0);
});
Deno.test("tenant directory failures, forged tenant arguments and conflicting scope or mutation contracts fail closed", async () => {
  const h = harness({
    role: null,
    tenant: "tenant-one",
    tenantError: true,
    rows: [customerRead()],
  });
  assert.equal(
    (await h.request({ action: "execute", operation: "tasks.list" })).status,
    503,
  );
  assert.equal(h.calls.length, 0);
  const tenant = harness({
    role: null,
    tenant: "tenant-one",
    rows: [customerRead()],
  });
  assert.equal(
    (await tenant.request({
      action: "execute",
      operation: "tasks.list",
      arguments: { customer_id: "tenant-two" },
    })).status,
    400,
  );
  assert.equal(tenant.calls.length, 0);
  for (
    const entry of [{ ...customerRead(), is_mutation: true }, {
      ...customerRead(),
      permission_scope: "infrastructure:read",
    }]
  ) {
    const conflict = harness({
      role: null,
      tenant: "tenant-one",
      rows: [entry],
    });
    assert.equal(
      (await conflict.request({ action: "execute", operation: "tasks.list" }))
        .status,
      503,
    );
    assert.equal(conflict.calls.length, 0);
  }
});

Deno.test("lost release response is ambiguous and requires reconciliation rather than reporting no execution", async () => {
  const h = harness({
    backend: () => {
      throw Error("connection lost after request");
    },
  });
  const response = await h.request({
    action: "execute",
    operation: release.operation,
    arguments: releaseArgs,
  });
  const body = await response.json();
  assert.equal(response.status, 502);
  assert.equal(body.executed, null);
  assert.equal(body.reconciliation_required, true);
  assert.equal(body.ok, false);
});

Deno.test("all provider reads and customer reads are installed at the correct fixed backend", async () => {
  const providerOperations = [
    "supabase.projects.get",
    "supabase.project.health",
    "supabase.branches.list",
    "supabase.branches.get",
    "supabase.network.restrictions.get",
    "supabase.domains.get",
    "supabase.functions.secrets.list",
    "supabase.backups.list",
    "supabase.db.migrations.list",
    "supabase.database.inspect",
    "supabase.schema.tables.list",
    "supabase.schema.functions.list",
    "supabase.schema.indexes.list",
    "supabase.database.connections.list",
    "supabase.schema.views.list",
    "supabase.schema.materialized_views.list",
    "supabase.schema.triggers.list",
    "supabase.schema.constraints.list",
    "supabase.schema.types.list",
    "supabase.schema.extensions.list",
    "supabase.database.roles.list",
    "supabase.database.grants.list",
    "supabase.database.default_privileges.list",
    "supabase.database.rls.policies.list",
    "supabase.database.locks.list",
    "supabase.database.cron.jobs.list",
  ];
  for (const operation of providerOperations) {
    const entry = {
      ...infrastructure(operation),
      handler: "sandy-provider-read-api",
      ai_exposed: true,
    };
    const h = harness({ rows: [entry] });
    assert.equal(
      (await h.request({ action: "execute", channel: "mcp", operation }))
        .status,
      200,
    );
    assert.equal(
      h.calls[0].url,
      "https://example.supabase.co/functions/v1/sandy-provider-read-api",
    );
    assert.equal(
      new Headers(h.calls[0].init?.headers).get("authorization"),
      "Bearer test-service-credential",
    );
  }
  for (
    const operation of [
      "tasks.list",
      "tasks.get",
      "calendar.list",
      "calendar.get",
      "calendar.conflicts",
      "files.list",
      "files.get",
      "files.search",
    ]
  ) {
    const h = harness({
      rows: [customerRead(operation)],
      role: null,
      tenant: "tenant-one",
    });
    assert.equal(
      (await h.request({ action: "execute", operation })).status,
      200,
    );
    assert.equal(
      h.calls[0].url,
      "https://example.supabase.co/functions/v1/sandy-operations-api",
    );
    assert.equal(
      new Headers(h.calls[0].init?.headers).get("authorization"),
      "Bearer test-user-jwt",
    );
  }
});

const videoRead = (operation = "video.execution.preflight") => ({
  ...preflight,
  operation,
  handler: "sandy-deploy-provision",
  permission_scope: "infrastructure:read",
  verified: true,
});

Deno.test("video reads use the original fixed service actions and preserve provider payloads without promoting verification", async () => {
  const cases = [
    {
      operation: "video.status",
      action: "video_status",
      arguments: { target: "sandy-video" },
      result: { ok: true, name: "sandy-video", status: "RUNNING" },
    },
    {
      operation: "video.install.preflight",
      action: "video_install_preflight",
      arguments: {},
      result: {
        ok: true,
        installation_authorized: false,
        livekit_verified: false,
      },
    },
    {
      operation: "video.execution.preflight",
      action: "video_execution_preflight",
      arguments: {},
      result: {
        ok: true,
        osconfig_http: 200,
        osconfig_enabled: true,
        installation_executed: false,
      },
    },
  ];
  for (const expected of cases) {
    const entry = {
      ...videoRead(expected.operation),
      input_schema: expected.operation === "video.status"
        ? {
          type: "object",
          properties: { target: { const: "sandy-video" } },
        }
        : videoRead().input_schema,
    };
    const h = harness({
      rows: [entry],
      backend: () => Response.json(expected.result),
    });
    const catalogue = await (await h.request({ action: "list" })).json();
    assert.deepEqual(catalogue.operations, [{ ...entry, executable: true }]);
    const response = await h.request({
      action: "execute",
      channel: "mcp",
      operation: expected.operation,
      arguments: expected.arguments,
    });
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.deepEqual(body.result, expected.result);
    assert.equal(body.executed, true);
    assert.equal(body.verified, undefined);
    assert.deepEqual(h.identityTokens, ["test-user-jwt", "test-user-jwt"]);
    assert.equal(h.calls.length, 1);
    assert.equal(
      h.calls[0].url,
      "https://example.supabase.co/functions/v1/sandy-deploy-provision",
    );
    assert.equal(
      new Headers(h.calls[0].init?.headers).get("authorization"),
      "Bearer test-service-credential",
    );
    assert.deepEqual(JSON.parse(String(h.calls[0].init?.body)), {
      action: expected.action,
    });
  }
});

Deno.test("video infrastructure reads require an owner independently of tenant access and retain registry exposure policy", async () => {
  for (
    const operation of [
      "video.status",
      "video.install.preflight",
      "video.execution.preflight",
    ]
  ) {
    for (
      const options of [
        { role: "administrator" },
        { role: null, tenant: "fixture-tenant" },
      ]
    ) {
      const h = harness({ ...options, rows: [videoRead(operation)] });
      assert.deepEqual(
        (await (await h.request({ action: "list" })).json()).operations,
        [],
      );
      for (const action of ["describe", "execute"]) {
        assert.equal((await h.request({ action, operation })).status, 403);
      }
      assert.equal(h.calls.length, 0);
    }
    const disabled = harness({
      rows: [{ ...videoRead(operation), api_exposed: false }],
    });
    assert.equal(
      (await disabled.request({ action: "execute", operation })).status,
      404,
    );
    assert.equal(disabled.calls.length, 0);
    const apiOnly = harness({
      rows: [{ ...videoRead(operation), ai_exposed: false }],
    });
    const catalogue = await (await apiOnly.request({ action: "list" })).json();
    assert.equal(catalogue.operations[0].ai_exposed, false);
    assert.equal(
      (await apiOnly.request({
        action: "execute",
        channel: "mcp",
        operation,
      })).status,
      403,
    );
    assert.equal(apiOnly.calls.length, 0);
    assert.equal(
      (await apiOnly.request({ action: "execute", operation })).status,
      200,
    );
  }
});

Deno.test("video dispatch refuses registry mutation, scope and handler conflicts and caller action or target overrides", async () => {
  for (
    const [override, expected] of [
      [{ is_mutation: true }, 503],
      [{ permission_scope: "infrastructure:write" }, 503],
      [{ handler: "sandy-operation-api" }, 503],
      [{ handler: "untrusted-provisioner" }, 422],
    ] as [Row, number][]
  ) {
    const h = harness({ rows: [{ ...videoRead(), ...override }] });
    const response = await h.request({
      action: "execute",
      operation: "video.execution.preflight",
    });
    assert.equal(response.status, expected);
    assert.equal((await response.json()).executed, false);
    assert.equal(h.calls.length, 0);
  }
  for (
    const operation of [
      "video.status",
      "video.install.preflight",
      "video.execution.preflight",
    ]
  ) {
    // Even a loosened registry schema cannot select a write action or another VM.
    for (
      const args of [
        { action: "create_video" },
        { target: "other-vm" },
        { job_id: "11111111-2222-4333-8444-555555555555" },
      ]
    ) {
      const h = harness({
        rows: [{ ...videoRead(operation), input_schema: { type: "object" } }],
      });
      const response = await h.request({
        action: "execute",
        operation,
        arguments: args,
      });
      assert.equal(response.status, 400);
      assert.equal((await response.json()).executed, false);
      assert.equal(h.calls.length, 0);
    }
  }
});

Deno.test("video provider failure and transport failure retain truthful execution outcomes", async () => {
  for (const status of [200, 502]) {
    const h = harness({
      rows: [videoRead()],
      backend: () =>
        Response.json({ ok: false, error: "google_sts_unavailable" }, {
          status,
        }),
    });
    const response = await h.request({
      action: "execute",
      operation: "video.execution.preflight",
    });
    const body = await response.json();
    assert.equal(response.status, 502);
    assert.equal(body.ok, false);
    assert.equal(body.error, "google_sts_unavailable");
    assert.equal(body.executed, true);
    assert.equal(body.verified, undefined);
    assert.equal(h.calls.length, 1);
  }
  const unavailable = harness({
    rows: [videoRead()],
    backend: () => Promise.reject(new TypeError("network unavailable")),
  });
  const response = await unavailable.request({
    action: "execute",
    operation: "video.execution.preflight",
  });
  const body = await response.json();
  assert.equal(response.status, 502);
  assert.equal(body.ok, false);
  assert.equal(body.executed, false);
  assert.equal(body.error, "upstream_unavailable");
});

const cancelOperation = {
  ...preflight,
  operation: "deployment.jobs.cancel",
  is_mutation: true,
  verified: true,
  input_schema: {
    type: "object",
    required: ["job_id"],
    properties: { job_id: { type: "string", format: "uuid" } },
    additionalProperties: false,
  },
  output_schema: {
    type: "object",
    required: ["ok", "job_id", "state", "already_cancelled"],
    properties: {
      ok: { const: true },
      job_id: { type: "string", format: "uuid" },
      state: { const: "cancelled" },
      already_cancelled: { type: "boolean" },
    },
    additionalProperties: false,
  },
};
const cancelJobId = "11111111-2222-4333-8444-555555555555";
Deno.test("queued cancellation requires a verified exposed contract and owner; binds actor to the actual authenticated identity", async () => {
  for (
    const [entry, role, status] of [
      [{ ...cancelOperation, api_exposed: false }, "owner", 404],
      [{ ...cancelOperation, verified: false }, "owner", 424],
      [cancelOperation, "operator", 403],
    ] as [Row, string, number][]
  ) {
    const h = harness({ rows: [entry], role });
    assert.equal(
      (await h.request({
        action: "execute",
        operation: cancelOperation.operation,
        arguments: { job_id: cancelJobId },
      })).status,
      status,
    );
    assert.equal(h.rpcCalls.length, 0);
  }
  const h = harness({
    rows: [cancelOperation],
    rpcData: {
      ok: true,
      job_id: cancelJobId,
      state: "cancelled",
      already_cancelled: false,
    },
  });
  const response = await h.request({
    action: "execute",
    operation: cancelOperation.operation,
    arguments: { job_id: cancelJobId },
  });
  assert.equal(response.status, 200);
  assert.deepEqual(h.rpcCalls, [{
    name: "sandy_api_cancel_deployment_job",
    args: { p_job_id: cancelJobId, p_actor_id: "controller-test-user" },
  }]);
  assert.equal(h.calls.length, 0);
  assert.equal(
    (await h.request({
      action: "execute",
      operation: cancelOperation.operation,
      arguments: { job_id: cancelJobId, actor_id: "forged-owner" },
    })).status,
    400,
  );
});
Deno.test("cancellation preserves running-job refusal, ownership denial and ambiguous transaction outcomes", async () => {
  for (
    const [error, status] of [["job_not_cancellable", 409], [
      "owner_required",
      403,
    ], ["job_not_found", 404]] as [string, number][]
  ) {
    const h = harness({
      rows: [cancelOperation],
      rpcData: { ok: false, error, http_status: status },
    });
    const response = await h.request({
      action: "execute",
      operation: cancelOperation.operation,
      arguments: { job_id: cancelJobId },
    });
    assert.equal(response.status, status);
    assert.equal((await response.json()).executed, false);
  }
  const uncertain = harness({ rows: [cancelOperation], rpcError: true });
  const response = await uncertain.request({
    action: "execute",
    operation: cancelOperation.operation,
    arguments: { job_id: cancelJobId },
  });
  const body = await response.json();
  assert.equal(response.status, 502);
  assert.equal(body.executed, null);
  assert.equal(body.reconciliation_required, true);
});
Deno.test("canonical cancellation route rejects actor overrides and uses the registered operation", async () => {
  const h = harness({
    rows: [cancelOperation],
    actorId: "10000000-0000-4000-8000-000000000003",
    rpcHandler: (name) =>
      name === "sandy_api_resolve_job_route"
        ? {
          ok: true,
          job_id: cancelJobId,
          job_kind: "legacy",
          operation: "deployment.jobs.cancel",
        }
        : {
          ok: true,
          job_id: cancelJobId,
          state: "cancelled",
          already_cancelled: true,
        },
  });
  const request = (body: unknown) =>
    h.handler(
      new Request(`https://example.invalid/v1/jobs/${cancelJobId}:cancel`, {
        method: "POST",
        headers: {
          authorization: "Bearer test-user-jwt",
          "content-type": "application/json",
        },
        body: JSON.stringify(body),
      }),
    );
  assert.equal((await request({})).status, 200);
  assert.equal((await request({ actor_id: "forged" })).status, 400);
  assert.deepEqual(h.rpcCalls.map((c) => c.name), [
    "sandy_api_resolve_job_route",
    "sandy_api_cancel_deployment_job",
  ]);
});

const retryJobId = "10000000-0000-4000-8000-000000000001";
const retryChildId = "10000000-0000-4000-8000-000000000002";
const retryActorId = "10000000-0000-4000-8000-000000000003";
function canonicalJobRequest(
  jobId: string,
  suffix = "",
  body?: unknown,
  headers: Record<string, string> = {},
) {
  return new Request(`https://local.invalid/v1/jobs/${jobId}${suffix}`, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      authorization: "Bearer actual-user-session",
      "content-type": "application/json",
      ...headers,
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}
Deno.test("durable job URLs resolve the actual principal once and reach existing canonical handlers without legacy fallback", async () => {
  const actions = ["get", "events", "cancel", "retry"] as const;
  const names = [
    "sandy_orch_job",
    "sandy_orch_events_page",
    "sandy_orch_cancel",
    "sandy_orch_retry",
  ];
  for (const [index, action] of actions.entries()) {
    const operation = `orchestration.jobs.${action}`;
    const contract = orchestrationContracts.find((c) =>
      c.operation === operation
    )!;
    assert.ok(contract);
    const h = harness({
      actorId: retryActorId,
      rows: [{
        ...contract,
        handler: "sandy-orchestration-api",
        permission_scope: contract.is_mutation
          ? "orchestration:write"
          : "orchestration:read",
        api_exposed: true,
        ai_exposed: false,
        verified: true,
        output_schema: { type: "object" },
      }],
      rpcHandler: (name, args) => {
        if (name === "sandy_api_resolve_job_route") {
          assert.equal(args.p_actor_id, retryActorId);
          assert.equal(args.p_channel, "api");
          assert.equal(args.p_action, action);
          return {
            ok: true,
            job_id: retryJobId,
            job_kind: "durable",
            operation,
          };
        }
        assert.equal(name, names[index]);
        assert.equal(args.p_actor_id, retryActorId);
        assert.equal(args.p_job_id, retryJobId);
        if (action === "events") {
          assert.deepEqual(args, {
            p_actor_id: retryActorId,
            p_job_id: retryJobId,
            p_after: 14,
            p_limit: 15,
          });
        }
        return { ok: true };
      },
    });
    const response = await h.handler(
      canonicalJobRequest(
        retryJobId,
        action === "events"
          ? "/events?after=14&limit=15"
          : action === "get"
          ? ""
          : `:${action}`,
        ["cancel", "retry"].includes(action) ? {} : undefined,
      ),
    );
    assert.equal(
      response.status,
      action === "retry" ? 202 : 200,
      JSON.stringify(await response.clone().json()),
    );
    assert.equal((await response.json()).operation, operation);
    assert.deepEqual(h.rpcCalls.map((c) => c.name), [
      "sandy_api_resolve_job_route",
      names[index],
    ]);
    assert.equal(h.calls.length, 0);
    assert.deepEqual(h.identityTokens, ["actual-user-session"]);
  }
});
Deno.test("resolved job reads retain one central admission, grant, request ID and receipt", async () => {
  const admission = "20000000-0000-4000-8000-000000000001";
  const grant = "20000000-0000-4000-8000-000000000002";
  const requestId = "20000000-0000-4000-8000-000000000003";
  const contract = orchestrationContracts.find((c) =>
    c.operation === "orchestration.jobs.get"
  )!;
  const h = harness({
    actorId: retryActorId,
    executionPolicy: true,
    rows: [{
      ...contract,
      handler: "sandy-orchestration-api",
      permission_scope: "orchestration:read",
      api_exposed: true,
      ai_exposed: true,
      verified: false,
      output_schema: { type: "object" },
    }],
    rpcHandler(name, args) {
      switch (name) {
        case "sandy_api_resolve_job_route":
          return {
            ok: true,
            job_id: retryJobId,
            job_kind: "durable",
            operation: "orchestration.jobs.get",
          };
        case "sandy_api_admit_execution":
          assert.equal(args.p_request_id, requestId);
          assert.equal(args.p_actor_id, retryActorId);
          assert.equal(args.p_operation, "orchestration.jobs.get");
          return {
            ok: true,
            allowed: true,
            reused: false,
            admission_id: admission,
            grant_id: grant,
            state: "admitted",
            executed: false,
            expires_at: "2099-01-01T00:00:00Z",
          };
        case "sandy_api_consume_execution_grant":
          assert.equal(args.p_grant_id, grant);
          return {
            ok: true,
            allowed: true,
            reused: false,
            admission_id: admission,
          };
        case "sandy_orch_job":
          return { ok: true };
        case "sandy_api_finish_execution":
          assert.equal(args.p_admission_id, admission);
          return {
            ok: true,
            admission_id: admission,
            state: "succeeded",
            reused: false,
          };
        default:
          throw Error("unexpected RPC");
      }
    },
  });
  const response = await h.handler(
    canonicalJobRequest(retryJobId, "", undefined, {
      "x-sandy-request-id": requestId,
    }),
  );
  assert.equal(response.status, 200);
  assert.equal((await response.json()).admission_id, admission);
  assert.deepEqual(h.rpcCalls.map((c) => c.name), [
    "sandy_api_resolve_job_route",
    "sandy_api_admit_execution",
    "sandy_api_consume_execution_grant",
    "sandy_orch_job",
    "sandy_api_finish_execution",
  ]);
  assert.equal(h.calls.length, 0);
});
Deno.test("job URLs preserve key scope, authenticated non-disclosure and verified rollback dependencies", async () => {
  const keyId = "30000000-0000-4000-8000-000000000001";
  const approval = "30000000-0000-4000-8000-000000000002";
  const source = "30000000-0000-4000-8000-000000000003";
  const badAuth = harness({ actorId: retryActorId, authError: true });
  assert.equal(
    (await badAuth.handler(canonicalJobRequest(retryJobId))).status,
    401,
  );
  assert.equal(badAuth.rpcCalls.length, 0);
  for (
    const error of [
      "job_not_found",
      "ambiguous_job_id",
      "job_rollback_snapshot_required",
    ]
  ) {
    const status = error === "job_not_found"
      ? 404
      : error === "ambiguous_job_id"
      ? 409
      : 424;
    const h = harness({
      actorId: retryActorId,
      rpcData: { ok: false, error, http_status: status },
    });
    const response = await h.handler(
      canonicalJobRequest(
        retryJobId,
        error === "job_rollback_snapshot_required" ? ":rollback" : "",
        error === "job_rollback_snapshot_required"
          ? { compensation_approval_id: approval }
          : undefined,
      ),
    );
    assert.equal(response.status, status);
    assert.equal((await response.json()).executed, false);
    assert.equal(h.rpcCalls.length, 1);
    assert.equal(h.calls.length, 0);
  }
  const key = harness({
    actorId: retryActorId,
    rows: [{
      ...infrastructure("deployment.jobs.get"),
      input_schema: {
        type: "object",
        required: ["job_id"],
        properties: { job_id: { type: "string", format: "uuid" } },
        additionalProperties: false,
      },
    }],
    resolveCredential: async () => ({
      kind: "api_key",
      principalId: retryActorId,
      credentialId: keyId,
      allowedOperations: ["deployment.jobs.get"],
    }),
    rpcHandler(name, args) {
      assert.equal(name, "sandy_api_resolve_job_route");
      assert.equal(args.p_credential_id, keyId);
      assert.deepEqual(args.p_allowed_operations, ["deployment.jobs.get"]);
      return {
        ok: true,
        job_id: retryJobId,
        job_kind: "legacy",
        operation: "deployment.jobs.get",
      };
    },
  });
  assert.equal(
    (await key.handler(canonicalJobRequest(retryJobId))).status,
    200,
  );
  assert.deepEqual(key.identityTokens, []);
  assert.equal(key.calls.length, 1);
  const refused = await key.handler(
    canonicalJobRequest(retryJobId, ":cancel", {}),
  );
  assert.equal(refused.status, 404);
  assert.equal(key.rpcCalls.length, 1);
  const rollback = harness({
    actorId: retryActorId,
    rows: [extensionRow("system.lifecycle.compensate")],
    rpcData: {
      ok: true,
      job_id: retryJobId,
      job_kind: "legacy",
      operation: "system.lifecycle.compensate",
      source_request_id: source,
    },
  });
  const result = await rollback.handler(
    canonicalJobRequest(retryJobId, ":rollback", {
      compensation_approval_id: approval,
    }),
  );
  assert.equal(result.status, 424);
  assert.equal(
    (await result.json()).error,
    "operation_requires_live_verification",
  );
  assert.equal(rollback.rpcCalls.length, 1);
  assert.equal(rollback.calls.length, 0);
  const leased = harness({
    actorId: retryActorId,
    resolveCredential: async () => ({
      kind: "job_lease",
      principalId: retryActorId,
      allowedOperations: ["orchestration.jobs.get"],
      boundExecution: {
        operation: "orchestration.jobs.get",
        arguments: { job_id: retryJobId },
        inputDigest: "0".repeat(64),
        channel: "api",
      },
    }),
  });
  // A leased worker enters only its fixed internal route. A caller cannot use
  // a public job URL to resolve a second job or consume that lease again.
  assert.equal(
    (await leased.handler(canonicalJobRequest(retryJobId))).status,
    403,
  );
  assert.equal(leased.rpcCalls.length, 0);
  assert.equal(leased.calls.length, 0);
});
const retryEntry = {
  ...preflight,
  operation: "deployment.jobs.retry",
  verified: true,
  permission_scope: "deployment:write",
  is_mutation: true,
  input_schema: {
    type: "object",
    required: ["job_id"],
    properties: { job_id: { type: "string", format: "uuid" } },
    additionalProperties: false,
  },
};
const retryReceipt = {
  ok: true,
  accepted: true,
  executed: false,
  request_state: "recorded",
  source_job_id: retryJobId,
  retry_job_id: retryChildId,
  retry_job_status: "approved",
  reused: false,
  retry_depth: 1,
  dispatch_required: true,
};
Deno.test("canonical retry records a receipt through one fixed RPC with authenticated actor", async () => {
  const h = harness({
    rows: [retryEntry],
    actorId: retryActorId,
    rpcHandler: (name) =>
      name === "sandy_api_resolve_job_route"
        ? {
          ok: true,
          job_id: retryJobId,
          job_kind: "legacy",
          operation: "deployment.jobs.retry",
        }
        : retryReceipt,
  });
  const response = await h.handler(
    new Request(`https://local.invalid/v1/jobs/${retryJobId}:retry`, {
      method: "POST",
      headers: {
        authorization: "Bearer user-session",
        "content-type": "application/json",
      },
      body: "{}",
    }),
  );
  assert.equal(response.status, 202);
  const result = await response.json();
  assert.equal(result.accepted, true);
  assert.equal(result.executed, false);
  assert.equal(result.dispatch_required, true);
  assert.equal(result.retry_job_id, retryChildId);
  assert.equal(result.operation, "deployment.jobs.retry");
  assert.deepEqual(h.rpcCalls, [{
    name: "sandy_api_resolve_job_route",
    args: {
      p_actor_id: retryActorId,
      p_job_id: retryJobId,
      p_action: "retry",
      p_channel: "api",
      p_credential_id: null,
      p_allowed_operations: null,
    },
  }, {
    name: "sandy_api_retry_read_deployment_job",
    args: { p_job_id: retryJobId, p_actor_id: retryActorId },
  }]);
  assert.equal(h.calls.length, 0);
  assert.deepEqual(h.identityTokens, ["user-session"]);
});
Deno.test("retry refuses nonowners, unverified and MCP-disabled mutations before RPC", async () => {
  for (
    const [options, expected] of [
      [{ role: "viewer", rows: [retryEntry] }, 403],
      [{ rows: [{ ...retryEntry, verified: false }] }, 424],
      [{ rows: [{ ...retryEntry, ai_exposed: false }] }, 403],
      [{ rows: [{ ...retryEntry, is_mutation: false }] }, 503],
    ] as const
  ) {
    const h = harness({ ...options, actorId: retryActorId });
    const response = await h.request({
      action: "execute",
      operation: "deployment.jobs.retry",
      arguments: { job_id: retryJobId },
      ...(options.rows?.[0]?.ai_exposed === false ? { channel: "mcp" } : {}),
    });
    assert.equal(response.status, expected);
    assert.equal(h.rpcCalls.length, 0);
    assert.equal(h.calls.length, 0);
  }
});
Deno.test("retry rejects route arguments and preserves ambiguous RPC receipt", async () => {
  const h = harness({
    rows: [retryEntry],
    actorId: retryActorId,
    rpcError: true,
  });
  const invalid = await h.handler(
    new Request(`https://local.invalid/v1/jobs/${retryJobId}:retry`, {
      method: "POST",
      headers: {
        authorization: "Bearer user-session",
        "content-type": "application/json",
      },
      body: '{"actor":"forged"}',
    }),
  );
  assert.equal(invalid.status, 400);
  assert.equal(h.rpcCalls.length, 0);
  const unknown = await h.request({
    action: "execute",
    operation: "deployment.jobs.retry",
    arguments: { job_id: retryJobId },
  });
  assert.equal(unknown.status, 503);
  const body = await unknown.json();
  assert.equal(body.accepted, null);
  assert.equal(body.executed, null);
  assert.equal(body.reconciliation_required, true);
});

Deno.test("discovery omits read contracts that fixed dispatch cannot execute", async () => {
  const rows = [
    {
      ...preflight,
      operation: "video.status",
      handler: "sandy-deploy-provision",
      permission_scope: "infrastructure:read",
    },
    {
      ...preflight,
      operation: "video.install.preflight",
      handler: "sandy-deploy-provision",
      permission_scope: "infrastructure:read",
      is_mutation: true,
    },
    {
      ...preflight,
      operation: "supabase.schema.views.list",
      handler: "sandy-provider-read-api",
      permission_scope: "tenant:write",
    },
    {
      ...preflight,
      operation: "tasks.list",
      handler: "sandy-operations-api",
      permission_scope: "tasks:write",
    },
  ];
  const h = harness({ rows, tenant: "fixture-tenant" });
  const response = await h.request({ action: "list" });
  assert.equal(response.status, 200);
  const data = await response.json();
  assert.deepEqual(data.operations.map((row: Row) => row.operation), [
    "video.status",
  ]);
});

Deno.test("engineering API reads preserve real user context and normalize complete legacy responses", async () => {
  const entry = {
    ...preflight,
    operation: "engineering.change.list",
    handler: "sandy-engineering-control",
  };
  const h = harness({
    rows: [entry],
    backend: () => Response.json({ changes: [] }),
  });
  const response = await h.request({
    action: "execute",
    operation: entry.operation,
    arguments: {},
  });
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.result.ok, true);
  assert.equal(result.result.contract_version, "1.0.0");
  assert.deepEqual(JSON.parse(String(h.calls[0].init?.body)), {
    action: "list",
  });
  assert.equal(
    h.calls[0].url,
    "https://example.supabase.co/functions/v1/sandy-engineering-control",
  );
  assert.equal(
    new Headers(h.calls[0].init?.headers).get("authorization"),
    "Bearer test-user-jwt",
  );
  for (const role of ["viewer", null]) {
    const denied = harness({ rows: [entry], role, tenant: "fixture-tenant" });
    assert.equal(
      (await denied.request({
        action: "execute",
        operation: entry.operation,
        arguments: {},
      })).status,
      403,
    );
    assert.equal(denied.calls.length, 0);
  }
});
Deno.test("engineering API read admission rejects action overrides, corrupt contracts and partial responses", async () => {
  const entry = {
    ...preflight,
    operation: "engineering.change.list",
    handler: "sandy-engineering-control",
  };
  for (
    const alteration of [{ is_mutation: true }, {
      permission_scope: "engineering:write",
    }]
  ) {
    const h = harness({ rows: [{ ...entry, ...alteration }] });
    assert.deepEqual(
      (await (await h.request({ action: "list" })).json()).operations,
      [],
    );
    assert.equal(
      (await h.request({
        action: "execute",
        operation: entry.operation,
        arguments: {},
      })).status,
      503,
    );
    assert.equal(h.calls.length, 0);
  }
  const h = harness({
    rows: [entry],
    backend: () => Response.json({ changes: null }),
  });
  const override = await h.request({
    action: "execute",
    operation: entry.operation,
    arguments: { action: "approve_job" },
  });
  assert.equal(override.status, 400);
  assert.equal(h.calls.length, 0);
  const malformed = await h.request({
    action: "execute",
    operation: entry.operation,
    arguments: {},
  });
  assert.equal(malformed.status, 502);
  assert.equal((await malformed.json()).ok, false);
  const unavailable = harness({
    rows: [entry],
    backend: () => {
      throw Error("private diagnostic");
    },
  });
  const unknown = await unavailable.request({
    action: "execute",
    operation: entry.operation,
    arguments: {},
  });
  assert.equal(unknown.status, 502);
  const body = await unknown.json();
  assert.equal(body.executed, null);
  assert.equal(JSON.stringify(body).includes("private diagnostic"), false);
});

Deno.test("delegated API identity never substitutes a transport credential for a customer session", async () => {
  const actor = "20000000-0000-4000-8000-000000000001";
  const read = infrastructure("supabase.functions.list");
  const h = harness({
    actorId: actor,
    rows: [read, preflight],
    resolveCredential: async () => ({
      kind: "api_key",
      principalId: actor,
      allowedOperations: [read.operation, preflight.operation],
    }),
  });
  const listed =
    await (await h.request({ action: "list" }, "Bearer public-anon-transport"))
      .json();
  assert.deepEqual(listed.operations.map((row: Row) => row.operation), [
    read.operation,
  ]);
  const response = await h.request({
    action: "execute",
    operation: read.operation,
    arguments: {},
  }, "Bearer public-anon-transport");
  assert.equal(response.status, 200);
  assert.deepEqual(h.identityTokens, []);
  assert.equal(
    new Headers(h.calls[0].init?.headers).get("authorization"),
    "Bearer test-service-credential",
  );
  const userOnly = await h.request({
    action: "execute",
    operation: preflight.operation,
    arguments: {},
  }, "Bearer public-anon-transport");
  assert.equal(userOnly.status, 403);
  assert.equal(
    (await userOnly.json()).error,
    "operation_requires_user_session",
  );
  const denied = await h.request({
    action: "execute",
    operation: "video.status",
    arguments: {},
  }, "Bearer public-anon-transport");
  assert.equal(denied.status, 403);
  assert.equal(h.calls.length, 1);
});
Deno.test("job leases execute only the stored operation and canonical argument digest through the same gateway", async () => {
  const actor = "20000000-0000-4000-8000-000000000001";
  const read = infrastructure("supabase.functions.list");
  const digest =
    "44136fa355b3678a1146ad16f7e8649e94fb4fc21fe77e8310c060f61caaff8a";
  const resolver = async () => ({
    kind: "job_lease" as const,
    principalId: actor,
    allowedOperations: [read.operation],
    boundExecution: {
      operation: read.operation,
      arguments: {},
      inputDigest: digest,
      channel: "api" as const,
    },
  });
  const h = harness({
    actorId: actor,
    rows: [read],
    resolveCredential: resolver,
  });
  const response = await h.handler(
    new Request("https://local.invalid/v1/internal/execute", {
      method: "POST",
      headers: { authorization: "Bearer internal-service" },
      body: '{"operation":"forged","arguments":{"target":"other"}}',
    }),
  );
  assert.equal(response.status, 200);
  assert.deepEqual(h.identityTokens, []);
  assert.deepEqual(JSON.parse(String(h.calls[0].init?.body)), {
    operation: read.operation,
    arguments: {},
  });
  const bad = harness({
    actorId: actor,
    rows: [read],
    resolveCredential: async () => ({
      ...await resolver(),
      boundExecution: {
        operation: read.operation,
        arguments: {},
        channel: "api" as const,
        inputDigest: "0".repeat(64),
      },
    }),
  });
  assert.equal(
    (await bad.handler(
      new Request("https://local.invalid/v1/internal/execute", {
        method: "POST",
        headers: { authorization: "Bearer internal-service" },
        body: "{}",
      }),
    )).status,
    403,
  );
  assert.equal(bad.calls.length, 0);
});
Deno.test("delegated identities recheck current membership and cannot enter through unconfigured resolver", async () => {
  const actor = "20000000-0000-4000-8000-000000000001";
  const read = infrastructure();
  for (const role of [null, "viewer"]) {
    const h = harness({
      actorId: actor,
      role,
      rows: [read],
      resolveCredential: async () => ({
        kind: "api_key",
        principalId: actor,
        allowedOperations: [read.operation],
      }),
    });
    assert.equal(
      (await h.request({
        action: "execute",
        operation: read.operation,
        arguments: {},
      })).status,
      403,
    );
    assert.equal(h.calls.length, 0);
  }
  const h = harness({ rows: [read] });
  const response = await h.handler(
    new Request("https://local.invalid/v1/internal/execute", {
      method: "POST",
      headers: { authorization: "Bearer internal-service" },
      body: "{}",
    }),
  );
  assert.equal(response.status, 401);
  assert.equal(h.calls.length, 0);
  assert.deepEqual(h.identityTokens, []);
});
Deno.test("all unverified mutations fail closed and discovery declares them nonexecutable", async () => {
  const unverified = { ...release, verified: false };
  const h = harness({ rows: [unverified] });
  const catalogue = await (await h.request({ action: "list" })).json();
  assert.equal(catalogue.operations[0].executable, false);
  const response = await h.request({
    action: "execute",
    operation: unverified.operation,
    arguments: releaseArgs,
  });
  assert.equal(response.status, 424);
  assert.equal(h.calls.length, 0);
});

Deno.test("all newly installed application contracts traverse the same gateway and preserve user grants and verification gates", async () => {
  const actor = "10000000-0000-4000-8000-000000000001";
  const tenant = "10000000-0000-4000-8000-000000000002";
  const contracts: Row[] = [
    ...Object.entries(legacyOperationContracts).map(([operation, c]) => ({
      ...c,
      operation,
    })),
    ...Object.entries(customerOperationContracts).map(([operation, c]) => ({
      ...c,
      operation,
    })),
    ...Object.entries(customerServiceContracts).map(([operation, c]) => ({
      ...c,
      operation,
    })),
    ...Object.entries(policyOperationContracts).map(([operation, c]) => ({
      ...c,
      operation,
      handler: "sandy-operation-api",
    })),
    ...orchestrationContracts.map((c) => ({
      ...c,
      handler: "sandy-orchestration-api",
      permission_scope: c.is_mutation
        ? "orchestration:write"
        : "orchestration:read",
    })),
  ];
  const rows: Row[] = contracts.map((c) => ({
    ...c,
    api_exposed: true,
    ai_exposed: true,
    verified: false,
  }));
  const h = harness({ actorId: actor, tenant, memoryTenant: tenant, rows });
  for (const row of rows) {
    const response = await h.request({
      action: "describe",
      operation: row.operation,
    });
    assert.equal(response.status, 200, String(row.operation));
    const body = await response.json();
    assert.equal(body.operation.operation, row.operation);
    assert.equal(body.operation.executable, row.is_mutation !== true);
  }
  assert.equal(h.calls.length, 0);
  const ownerOnly = harness({ actorId: actor, rows });
  const portalOnly = harness({
    actorId: actor,
    role: null,
    memoryTenant: tenant,
    rows,
  });
  assert.equal(
    (await ownerOnly.request({
      action: "describe",
      operation: "social.people.list",
    })).status,
    403,
  );
  assert.equal(
    (await portalOnly.request({
      action: "describe",
      operation: "controller.overview",
    })).status,
    403,
  );
});

const extensionActor = "10000000-0000-4000-8000-000000000001";
const extensionTenant = "10000000-0000-4000-8000-000000000002";
function extensionRow(operation: string, verified = false): Row {
  const c = extensionContracts[operation];
  assert.ok(c, operation);
  return {
    ...gapContracts[operation],
    ...c,
    operation,
    api_exposed: true,
    ai_exposed: true,
    verified,
    error_contract: {
      ...(c.contract_sha256 ? { contract_sha256: c.contract_sha256 } : {}),
    },
  };
}
Deno.test("all 258 service extensions are installed with their exact contracts and truthful readiness", async () => {
  assert.equal(Object.keys(extensionContracts).length, 258);
  assert.equal(
    new Set(installedOperationIds).size,
    installedOperationIds.length,
  );
  assert.ok(Object.isFrozen(installedOperationIds));
  const rows = Object.keys(extensionContracts).map((op) => extensionRow(op));
  const h = harness({
    actorId: extensionActor,
    tenant: extensionTenant,
    memoryTenant: extensionTenant,
    rows,
  });
  for (const row of rows) {
    const response = await h.request({
      action: "describe",
      operation: row.operation,
    });
    assert.equal(response.status, 200, String(row.operation));
    const payload = await response.json();
    const closed = row.is_mutation === true ||
      ["guest", "database", "credential", "supabase_service"].includes(
        String(row.kind),
      ) ||
      (row.kind === "provider_gap" && row.requires_grant === true);
    assert.equal(payload.operation.executable, !closed, String(row.operation));
    assert.equal(payload.operation.handler, row.handler);
  }
  assert.equal(h.calls.length, 0);
});
Deno.test("new owner service and provider-gap operations retain verified approval and real-user boundaries", async () => {
  const ownerOps = [
    "supabase.auth.users.list",
    "supabase.logs.query",
    "supabase.orgs.list",
  ];
  const rows = ownerOps.map((op) => extensionRow(op));
  const portal = harness({
    actorId: extensionActor,
    role: null,
    memoryTenant: extensionTenant,
    rows,
  });
  for (const operation of ownerOps) {
    assert.equal(
      (await portal.request({ action: "describe", operation })).status,
      403,
    );
  }
  const owner = harness({ actorId: extensionActor, rows });
  assert.equal(
    (await owner.request({
      action: "execute",
      operation: "supabase.auth.users.list",
      arguments: { tenant_id: extensionTenant },
    })).status,
    424,
  );
  assert.equal(owner.calls.length, 0);
  assert.equal(owner.rpcCalls.length, 0);
  for (const kind of ["api_key", "job_lease"] as const) {
    const delegated = harness({
      actorId: extensionActor,
      rows,
      resolveCredential: async () => ({
        kind,
        principalId: extensionActor,
        allowedOperations: ["supabase.orgs.list"],
      }),
    });
    assert.equal(
      (await delegated.request({
        action: "execute",
        operation: "supabase.orgs.list",
        arguments: {},
      })).status,
      403,
    );
    assert.equal(delegated.calls.length, 0);
  }
});
Deno.test("owner Supabase service composes its actual handler with one admission and one owned grant/receipt", async () => {
  const operation = "supabase.auth.users.get",
    admission = "60000000-0000-4000-8000-000000000001",
    grant = "60000000-0000-4000-8000-000000000002",
    target = "60000000-0000-4000-8000-000000000003";
  let consumed = 0, finished = 0, providerReads = 0;
  const backend = createServiceHandler({
    service: "test-service-credential",
    projectUrl: "https://zmqlyygzqoidkcwdysok.supabase.co",
    client: {
      auth: {
        admin: {
          getUserById: async (id: string) => {
            assert.equal(id, target);
            providerReads++;
            return {
              data: {
                user: {
                  id: target,
                  email: "fixture@example.invalid",
                  user_metadata: { private_field: "must not expose" },
                },
              },
              error: null,
            };
          },
        },
      },
    } as unknown as ServiceDependencies["client"],
    authorizeContext: async (context, contract) => {
      assert.equal(context.actor_id, extensionActor);
      assert.equal(context.tenant_id, null);
      assert.equal(context.credential_id, null);
      assert.equal(contract.operation, operation);
      return { allowed: true };
    },
    consumeGrant: async (value) => {
      consumed++;
      assert.equal(value.grant_id, grant);
      assert.equal(
        value.input_sha256,
        await argumentDigest({ tenant_id: extensionTenant, user_id: target }),
      );
      return { allowed: true, reused: false, admission_id: admission };
    },
    finishExecution: async (value) => {
      finished++;
      assert.equal(value.admission_id, admission);
      assert.equal(value.outcome, "succeeded");
      return { allowed: true };
    },
    rpc: async (name, args) => {
      assert.equal(name, "sandy_supabase_service_authorize");
      assert.equal(args.p_actor, extensionActor);
      assert.equal(args.p_admission, admission);
      return {
        data: {
          ok: true,
          bucket_id: `sandy-service-v1-tenant-${extensionTenant}`,
          user_ids: [target],
        },
        error: null,
      };
    },
  });
  const h = harness({
    actorId: extensionActor,
    executionPolicy: true,
    rows: [extensionRow(operation, true)],
    rpcHandler(name) {
      assert.equal(name, "sandy_api_admit_execution");
      return {
        ok: true,
        allowed: true,
        reused: false,
        admission_id: admission,
        grant_id: grant,
        state: "admitted",
        executed: false,
        expires_at: "2099-01-01T00:00:00Z",
      };
    },
    backend: (url, init) => {
      assert.equal(
        url,
        "https://example.supabase.co/functions/v1/sandy-supabase-service-api",
      );
      return backend(new Request(url, init));
    },
  });
  const result = await h.request({
    action: "execute",
    operation,
    arguments: { tenant_id: extensionTenant, user_id: target },
  });
  assert.equal(result.status, 200, JSON.stringify(await result.clone().json()));
  assert.equal(
    JSON.stringify(await result.json()).includes("must not expose"),
    false,
  );
  assert.deepEqual([consumed, finished, providerReads], [1, 1, 1]);
  assert.equal(h.rpcCalls.length, 1);
  assert.equal(h.calls.length, 1);
});
Deno.test("provider-gap organization read composes fixed-provider code and owns its exact grant without gateway double consumption", async () => {
  const operation = "supabase.orgs.list",
    admission = "61000000-0000-4000-8000-000000000001",
    grant = "61000000-0000-4000-8000-000000000002";
  let consumed = 0, finished = 0, providerCalls = 0;
  const backend = createGapHandler(
    {
      service: "test-service-credential",
      management: "synthetic-provider-token",
      authorizeContext: async (context, contract) => {
        assert.equal(context.actor_id, extensionActor);
        assert.equal(context.credential_id, null);
        assert.equal(contract.api_key_delegable, false);
        return { allowed: true };
      },
      consumeGrant: async (value) => {
        consumed++;
        assert.equal(value.grant_id, grant);
        assert.equal(
          value.scope_sha256,
          await argumentDigest({
            provider: "supabase",
            project_ref: "zmqlyygzqoidkcwdysok",
          }),
        );
        return { allowed: true, reused: false, admission_id: admission };
      },
      finishExecution: async (value) => {
        finished++;
        assert.equal(value.admission_id, admission);
        assert.equal(value.outcome, "succeeded");
        return { allowed: true, reused: false };
      },
      fetch: (async (input, init) => {
        providerCalls++;
        const url = new URL(String(input));
        assert.equal(url.origin, "https://api.supabase.com");
        assert.equal(
          new Headers(init?.headers).get("authorization"),
          "Bearer synthetic-provider-token",
        );
        return url.pathname === "/v1/projects/zmqlyygzqoidkcwdysok"
          ? Response.json({
            ref: "zmqlyygzqoidkcwdysok",
            organization_id: "org-id",
            organization_slug: "org",
          })
          : Response.json([{
            id: "org-id",
            slug: "org",
            name: "Fixture organization",
          }]);
      }) as typeof fetch,
    } satisfies GapDependencies,
  );
  const h = harness({
    actorId: extensionActor,
    executionPolicy: true,
    rows: [extensionRow(operation)],
    rpcHandler(name) {
      assert.equal(name, "sandy_api_admit_execution");
      return {
        ok: true,
        allowed: true,
        reused: false,
        admission_id: admission,
        grant_id: grant,
        state: "admitted",
        executed: false,
        expires_at: "2099-01-01T00:00:00Z",
      };
    },
    backend: (url, init) => {
      assert.equal(
        url,
        "https://example.supabase.co/functions/v1/sandy-provider-gap-api",
      );
      return backend(new Request(url, init));
    },
  });
  const result = await h.request({
    action: "execute",
    operation,
    arguments: {},
  });
  assert.equal(result.status, 200, JSON.stringify(await result.clone().json()));
  assert.deepEqual([consumed, finished, providerCalls], [1, 1, 2]);
  assert.equal(h.rpcCalls.length, 1);
  assert.equal(h.calls.length, 1);
});
Deno.test("provider package restore scope binds only the trusted server authority and never caller bindings", async () => {
  const operation = "github.packages.restore",
    admission = "62000000-0000-4000-8000-000000000001",
    grant = "62000000-0000-4000-8000-000000000002";
  const bindings: NonNullable<OperationDependencies["packageRestoreBindings"]> =
    [{
      verified: true,
      repository: "ausstyle/web-staging",
      repository_id: 123,
      owner: "ausstyle",
      package_type: "npm",
      package_name: "fixture",
      exclusive_namespace: true,
      expires_at: "2099-01-01T00:00:00Z",
      attestation_sha256: "a".repeat(64),
    }];
  const expected = await argumentDigest({
    provider: "github",
    repository: "ausstyle/web-staging",
    restore_bindings: bindings,
  });
  const h = harness({
    actorId: extensionActor,
    executionPolicy: true,
    rows: [extensionRow(operation, true)],
    packageRestoreBindings: bindings,
    rpcHandler(name, args) {
      assert.equal(name, "sandy_api_admit_execution");
      assert.equal(args.p_scope_sha256, expected);
      return {
        ok: true,
        allowed: true,
        reused: false,
        admission_id: admission,
        grant_id: grant,
        state: "admitted",
        executed: false,
        expires_at: "2099-01-01T00:00:00Z",
      };
    },
    backend: (_url, init) => {
      const body = JSON.parse(String(init?.body));
      assert.equal(Object.hasOwn(body, "restore_bindings"), false);
      assert.equal(Object.hasOwn(body.arguments, "restore_bindings"), false);
      return Response.json({
        ok: false,
        error: "package_restore_binding_required",
        executed: false,
      }, { status: 424 });
    },
  });
  const args = {
    package_type: "npm",
    package_name: "fixture",
    expected_package_id: 123,
  };
  assert.equal(
    (await h.request({
      action: "execute",
      operation,
      arguments: { ...args, restore_bindings: [] },
    })).status,
    400,
  );
  assert.equal(h.rpcCalls.length, 0);
  assert.equal(
    (await h.request({
      action: "execute",
      operation,
      arguments: args,
      restore_bindings: [],
    })).status,
    424,
  );
  assert.equal(h.rpcCalls.length, 1);
  assert.equal(h.calls.length, 1);
});
Deno.test("tenant consent uses only the actual confirmed portal user JWT and never a Controller/service/key substitute", async () => {
  const rows = [
    extensionRow("supabase.tenant.consent.get"),
    extensionRow("supabase.tenant.consent.set", true),
  ];
  const calls: { name: string; args: Row }[] = [], tokens: string[] = [];
  const h = harness({
    actorId: extensionActor,
    role: null,
    memoryTenant: extensionTenant,
    rows,
    authenticatedDb: (token) => {
      tokens.push(token);
      return {
        rpc: async (name, args) => {
          calls.push({ name, args });
          return {
            data: {
              ok: true,
              tenant_id: extensionTenant,
              operations: [],
              approved_emails: [],
              allow_erasure: false,
              expires_at: null,
              revision: 0,
              legal_hold: false,
              retention_until: null,
            },
            error: null,
          };
        },
      };
    },
  });
  assert.equal(
    (await h.request({
      action: "execute",
      operation: "supabase.tenant.consent.get",
      arguments: {},
    })).status,
    200,
  );
  assert.equal(
    (await h.request({
      action: "execute",
      operation: "supabase.tenant.consent.set",
      arguments: {
        operations: [],
        approved_emails: [],
        allow_erasure: false,
        expires_at: new Date(Date.now() + 3600000).toISOString(),
      },
    })).status,
    200,
  );
  assert.deepEqual(tokens, ["test-user-jwt", "test-user-jwt"]);
  assert.deepEqual(calls.map((c) => c.name), [
    "sandy_supabase_tenant_consent_get",
    "sandy_supabase_tenant_consent_set",
  ]);
  assert.equal(h.rpcCalls.length, 0);
  assert.equal(h.calls.length, 0);
  assert.equal(
    (await h.request({
      action: "execute",
      operation: "supabase.tenant.consent.get",
      arguments: { tenant_id: extensionTenant },
    })).status,
    400,
  );
  for (
    const options of [{ role: "owner" }, {
      role: null,
      tenant: extensionTenant,
    }, { role: null, memoryTenant: extensionTenant, emailConfirmed: false }]
  ) {
    const denied = harness({
      ...options,
      actorId: extensionActor,
      rows,
      authenticatedDb: () => {
        throw Error("must not obtain session");
      },
    });
    assert.equal(
      (await denied.request({
        action: "execute",
        operation: "supabase.tenant.consent.get",
        arguments: {},
      })).status,
      403,
    );
  }
});
Deno.test("Agenda, customer key and agent grants remain independent from Controller privilege", async () => {
  const rows = [
    extensionRow("agenda.pins.list"),
    extensionRow("customer.keys.list"),
    extensionRow("gmail.messages.search"),
  ];
  const owner = harness({ actorId: extensionActor, rows });
  for (const row of rows) {
    assert.equal(
      (await owner.request({ action: "describe", operation: row.operation }))
        .status,
      403,
    );
  }
  const portal = harness({
    actorId: extensionActor,
    role: null,
    memoryTenant: extensionTenant,
    rows,
  });
  assert.equal(
    (await portal.request({
      action: "describe",
      operation: "gmail.messages.search",
    })).status,
    200,
  );
  assert.equal(
    (await portal.request({
      action: "describe",
      operation: "agenda.pins.list",
    })).status,
    403,
  );
  const mismatched = harness({
    actorId: extensionActor,
    role: null,
    tenant: "10000000-0000-4000-8000-000000000003",
    memoryTenant: extensionTenant,
    rows,
  });
  assert.equal(
    (await mismatched.request({
      action: "describe",
      operation: "agenda.pins.list",
    })).status,
    403,
  );
  const unconfirmed = harness({
    actorId: extensionActor,
    tenant: extensionTenant,
    memoryTenant: extensionTenant,
    emailConfirmed: false,
    rows,
  });
  assert.equal(
    (await unconfirmed.request({
      action: "describe",
      operation: "customer.keys.list",
    })).status,
    403,
  );
});
Deno.test("customer key administration and Gmail reads forward the real user JWT to their fixed services", async () => {
  const key = harness({
    actorId: extensionActor,
    role: null,
    tenant: extensionTenant,
    memoryTenant: extensionTenant,
    rows: [extensionRow("customer.keys.list")],
    backend: () => Response.json({ ok: true, keys: [] }),
  });
  assert.equal(
    (await key.request({
      action: "execute",
      operation: "customer.keys.list",
      arguments: {},
    })).status,
    200,
  );
  assert.equal(
    key.calls[0].url,
    "https://example.supabase.co/functions/v1/sandy-operations-api",
  );
  assert.deepEqual(JSON.parse(String(key.calls[0].init?.body)), {
    operation: "keys.list",
    arguments: {},
  });
  assert.equal(
    new Headers(key.calls[0].init?.headers).get("authorization"),
    "Bearer test-user-jwt",
  );
  const gmail = harness({
    actorId: extensionActor,
    role: null,
    memoryTenant: extensionTenant,
    rows: [extensionRow("gmail.messages.search")],
    backend: () =>
      Response.json({
        ok: true,
        contract_version: "1.0.0",
        principal_kind: "auth_user",
        task_id: null,
        read_only: true,
        data: "fixture",
      }),
  });
  assert.equal(
    (await gmail.request({
      action: "execute",
      channel: "mcp",
      operation: "gmail.messages.search",
      arguments: { query: "in:inbox" },
    })).status,
    200,
  );
  assert.equal(
    gmail.calls[0].url,
    "https://example.supabase.co/functions/v1/sandy-agent-operation-api",
  );
  assert.equal(
    new Headers(gmail.calls[0].init?.headers).get("authorization"),
    "Bearer test-user-jwt",
  );
  assert.deepEqual(JSON.parse(String(gmail.calls[0].init?.body)), {
    operation: "gmail.messages.search",
    arguments: { query: "in:inbox" },
    channel: "mcp",
  });
});
Deno.test("sensitive reads and unavailable SSH stay closed before grants, provider access or credential lookup", async () => {
  const cases: [string, Row][] = [
    ["supabase.sql.query", { sql: "SELECT 1" }],
    ["gcp.vm.agent.status", { vm_name: "sandy-video" }],
    ["system.credentials.provider.verify", {
      target_id: extensionActor,
      rotation_id: extensionTenant,
    }],
  ];
  for (const [operation, args] of cases) {
    const h = harness({
      actorId: extensionActor,
      rows: [extensionRow(operation)],
    });
    const response = await h.request({
      action: "execute",
      operation,
      arguments: args,
    });
    assert.equal(response.status, 424, operation);
    assert.equal(
      (await response.json()).error,
      "operation_requires_live_verification",
    );
    assert.equal(h.rpcCalls.length, 0);
    assert.equal(h.calls.length, 0);
  }
  const ssh = harness({
    actorId: extensionActor,
    rows: [extensionRow("gcp.vm.ssh.exec", true)],
  });
  const response = await ssh.request({
    action: "execute",
    operation: "gcp.vm.ssh.exec",
    arguments: { vm_name: "sandy-video", command: "true" },
  });
  assert.equal(response.status, 424);
  assert.equal(
    (await response.json()).error,
    "guest_ssh_transport_unavailable",
  );
  assert.equal(ssh.calls.length, 0);
});
Deno.test("lifecycle polling reenters the real gateway and consumes the provider envelope with original proof", async () => {
  const child = "gcp.compute.zone_operations.get",
    c = providerOperations[child];
  const rows = [extensionRow("system.lifecycle.poll"), {
    ...c,
    handler: "sandy-provider-operation-api",
    input_schema: { type: "object" },
    output_schema: { type: "object" },
    api_exposed: true,
    ai_exposed: true,
    verified: false,
    error_contract: { contract_sha256: c.contract_sha256 },
  }];
  const grants = new Map<string, string>();
  let admissions = 0;
  const h = harness({
    actorId: extensionActor,
    rows,
    executionPolicy: true,
    rpcHandler: (name, args) => {
      if (name === "sandy_api_admit_execution") {
        admissions++;
        const admission = crypto.randomUUID(), grant = crypto.randomUUID();
        grants.set(grant, admission);
        return {
          ok: true,
          allowed: true,
          reused: false,
          admission_id: admission,
          grant_id: grant,
          state: "admitted",
          executed: false,
          expires_at: new Date(Date.now() + 60000).toISOString(),
        };
      }
      if (name === "sandy_api_consume_execution_grant") {
        return {
          ok: true,
          allowed: true,
          reused: false,
          admission_id: grants.get(String(args.p_grant_id)),
        };
      }
      if (name === "sandy_api_finish_execution") {
        return {
          ok: true,
          admission_id: args.p_admission_id,
          state: args.p_outcome,
          reused: false,
        };
      }
      throw Error(`unexpected RPC ${name}`);
    },
    backend: (_url, init) => {
      const sent = JSON.parse(String(init?.body));
      assert.equal(sent.operation, child);
      assert.equal(sent.actor_id, extensionActor);
      assert.equal(sent.tenant_id, null);
      assert.equal(
        new Headers(init?.headers).get("authorization"),
        "Bearer test-service-credential",
      );
      return Response.json({
        ok: true,
        operation: child,
        contract_version: "1.0.0",
        provider: "gcp",
        request_state: "observed",
        executed: true,
        admission_id: sent.admission_id,
        provider_http_status: 200,
        provider_request_id: "fixture-provider-read",
        result: { name: "operation-test", status: "DONE", id: "22" },
        possibly_truncated: false,
        result_limit: 100,
        next_page: null,
      });
    },
  });
  const response = await h.request({
    action: "execute",
    operation: "system.lifecycle.poll",
    arguments: { scope: "zone", operation_name: "operation-test" },
  });
  assert.equal(
    response.status,
    200,
    JSON.stringify(await response.clone().json()),
  );
  const body = await response.json();
  assert.equal(body.result.terminal, true);
  assert.equal(body.result.effect_confirmed, false);
  assert.match(body.result.read_admission_id, /^[a-f0-9-]{36}$/);
  assert.equal(admissions, 2);
  assert.equal(h.calls.length, 1);
  assert.deepEqual(h.identityTokens, ["test-user-jwt", "test-user-jwt"]);
});
