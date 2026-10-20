import assert from "node:assert/strict";
import { createOperationHandler, type OperationDependencies } from "./index.ts";

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
  rows?: Row[];
  role?: string | null;
  registryError?: boolean;
  authError?: boolean;
  roleError?: boolean;
  tenant?: string | null;
  tenantError?: boolean;
  rpcData?: Row;
  rpcError?: boolean;
  backend?: (input: string, init?: RequestInit) => Response | Promise<Response>;
};
function harness(options: Options = {}) {
  const calls: { url: string; init?: RequestInit }[] = [];
  const rpcCalls: { name: string; args: unknown }[] = [];
  const db = {
    rpc(name: string, args: unknown) {
      rpcCalls.push({ name, args });
      return Promise.resolve({
        data: options.rpcData ?? null,
        error: options.rpcError ? { message: "connection lost" } : null,
      });
    },
    auth: {
      getUser: () =>
        Promise.resolve({
          data: {
            user: options.authError ? null : {
              id: "controller-test-user",
              ...(options.tenant !== undefined
                ? { email: "fixture-user@example.invalid" }
                : {}),
            },
          },
          error: options.authError ? { message: "invalid" } : null,
        }),
    },
    from(table: string) {
      let rows = table === "sandy_agenda_access"
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
          auth_user_id: "controller-test-user",
        }];
      const error = table === "sandy_agenda_access"
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
  return { handler, request, calls, rpcCalls };
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
      { ...preflight, ai_exposed: false },
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
      { ...preflight, ai_exposed: false },
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
    ]
  ) {
    const entry = { ...infrastructure(), input_schema };
    const h = harness({ rows: [entry] });
    assert.equal(
      (await h.request({ action: "execute", operation: entry.operation }))
        .status,
      503,
    );
    assert.equal(h.calls.length, 0);
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
    rpcData: {
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
  assert.equal(h.rpcCalls.length, 1);
});
