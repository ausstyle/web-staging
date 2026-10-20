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
};
type Row = Record<string, unknown>;
type Options = {
  rows?: Row[];
  role?: string | null;
  registryError?: boolean;
  authError?: boolean;
  roleError?: boolean;
  backend?: (input: string, init?: RequestInit) => Response | Promise<Response>;
};
function harness(options: Options = {}) {
  const calls: { url: string; init?: RequestInit }[] = [];
  const db = {
    auth: {
      getUser: () =>
        Promise.resolve({
          data: {
            user: options.authError ? null : { id: "controller-test-user" },
          },
          error: options.authError ? { message: "invalid" } : null,
        }),
    },
    from(table: string) {
      let rows = table === "sandy_operation_registry"
        ? options.rows ?? [preflight, release]
        : options.role === null
        ? []
        : [{
          role: options.role ?? "owner",
          enabled: true,
          auth_user_id: "controller-test-user",
        }];
      const error = table === "sandy_operation_registry"
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
  return { handler, request, calls };
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
