import assert from "node:assert/strict";
import { createProviderReadHandler } from "./index.ts";

function harness(
  payload: unknown,
  status = 200,
  management = "test-management-credential",
) {
  const calls: Request[] = [];
  const handler = createProviderReadHandler({
    service: "test-service-credential",
    management,
    fetch: ((url: string | URL | Request, init?: RequestInit) => {
      calls.push(new Request(url, init));
      return Promise.resolve(
        Response.json(payload, {
          status,
          headers: { "x-request-id": "test-provider-request" },
        }),
      );
    }) as typeof fetch,
  });
  const request = (
    operation: unknown,
    args: unknown = {},
    token = "test-service-credential",
  ) =>
    handler(
      new Request("https://handler.invalid", {
        method: "POST",
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ operation, arguments: args }),
      }),
    );
  return { request, calls };
}
Deno.test("provider read handler denies end-user tokens and missing binding before provider access", async () => {
  const h = harness({});
  assert.equal(
    (await h.request("supabase.projects.get", {}, "customer-jwt")).status,
    403,
  );
  assert.equal(h.calls.length, 0);
  const missing = harness({}, 200, "");
  assert.equal((await missing.request("supabase.projects.get")).status, 424);
  assert.equal(missing.calls.length, 0);
});
Deno.test("project read is fixed to the approved project and returns projected identity with provider evidence", async () => {
  const h = harness({
    id: "zmqlyygzqoidkcwdysok",
    name: "Test project",
    status: "ACTIVE_HEALTHY",
    database_password: "must-not-leak",
  });
  const r = await h.request("supabase.projects.get");
  assert.equal(r.status, 200);
  const body = await r.json();
  assert.equal(body.result.id, "zmqlyygzqoidkcwdysok");
  assert.equal(body.provider_request_id, "test-provider-request");
  assert.equal(body.result.database_password, undefined);
  assert.equal(
    h.calls[0].url,
    "https://api.supabase.com/v1/projects/zmqlyygzqoidkcwdysok",
  );
  assert.equal(
    h.calls[0].headers.get("authorization"),
    "Bearer test-management-credential",
  );
  assert.equal(h.calls[0].redirect, "error");
  assert.equal(h.calls[0].method, "GET");
  assert.equal(
    (await h.request("supabase.projects.get", {
      project_ref: "another-project",
    })).status,
    400,
  );
  assert.equal(h.calls.length, 1);
  const wrong = harness({ id: "another-project" });
  assert.equal((await wrong.request("supabase.projects.get")).status, 502);
});
Deno.test("secret discovery returns names only even when provider includes plaintext values", async () => {
  const h = harness([{
    name: "EXAMPLE_KEY",
    value: "test-secret-value",
    updated_at: "2026-10-20",
  }]);
  const r = await h.request("supabase.functions.secrets.list");
  assert.equal(r.status, 200);
  const text = await r.text();
  assert.ok(!text.includes("test-secret-value"));
  assert.deepEqual(JSON.parse(text).result, [{
    name: "EXAMPLE_KEY",
    updated_at: "2026-10-20",
  }]);
});
Deno.test("branch path rejects traversal, cross-project IDs, URLs and extra arguments", async () => {
  const h = harness({
    name: "test-branch",
    project_ref: "test-branch-ref",
    service_role_key: "must-not-leak",
  });
  for (
    const args of [{}, { name: "../other-project" }, {
      name: "https://untrusted.invalid",
    }, { name: "test", ref: "other" }]
  ) {
    assert.equal((await h.request("supabase.branches.get", args)).status, 400);
  }
  assert.equal(h.calls.length, 0);
  const r = await h.request("supabase.branches.get", { name: "test-branch" });
  assert.equal(r.status, 200);
  assert.ok(
    h.calls[0].url.endsWith(
      "/projects/zmqlyygzqoidkcwdysok/branches/test-branch",
    ),
  );
  assert.equal((await r.json()).result.service_role_key, undefined);
});
Deno.test("all project metadata routes project only documented safe fields", async () => {
  const cases: [string, unknown, unknown][] = [
    ["supabase.project.health", [{
      name: "db",
      healthy: true,
      status: "ACTIVE_HEALTHY",
      error: "sensitive diagnostic",
    }], [{ name: "db", healthy: true, status: "ACTIVE_HEALTHY" }]],
    ["supabase.branches.list", [{
      id: "test-id",
      name: "test",
      password: "private",
    }], [{ id: "test-id", name: "test" }]],
    ["supabase.network.restrictions.get", {
      status: "applied",
      config: { dbAllowedCidrs: [], token: "private" },
    }, { status: "applied", config: { dbAllowedCidrs: [] } }],
    ["supabase.domains.get", {
      status: "1_not_started",
      data: { ownership_verification: "private" },
    }, { status: "1_not_started" }],
    ["supabase.backups.list", {
      region: "test",
      backups: [{ id: 1, status: "COMPLETED", download_url: "private" }],
    }, { region: "test", backups: [{ id: 1, status: "COMPLETED" }] }],
  ];
  for (const [operation, payload, expected] of cases) {
    const h = harness(payload);
    const r = await h.request(operation);
    assert.equal(r.status, 200);
    assert.deepEqual((await r.json()).result, expected);
    assert.equal(h.calls[0].method, "GET");
  }
});
Deno.test("provider denial and rate limits preserve failure and never expose provider error bodies", async () => {
  for (
    const [status, expected] of [
      [401, 502],
      [403, 502],
      [404, 404],
      [429, 429],
      [500, 502],
    ]
  ) {
    const h = harness({ error: "sensitive-provider-diagnostic" }, status);
    const r = await h.request("supabase.projects.get");
    assert.equal(r.status, expected);
    const text = await r.text();
    assert.ok(!text.includes("sensitive-provider-diagnostic"));
    assert.equal(JSON.parse(text).upstream_status, status);
  }
});
Deno.test("unknown operations and malformed provider responses cannot claim execution success", async () => {
  const h = harness(null);
  for (
    const operation of [
      "constructor",
      "supabase.projects.delete",
      "https://untrusted.invalid",
      null,
    ]
  ) {
    assert.equal((await h.request(operation)).status, 404);
  }
  assert.equal(h.calls.length, 0);
  assert.equal((await h.request("supabase.backups.list")).status, 502);
  assert.equal(
    (await h.request("supabase.functions.secrets.list")).status,
    502,
  );
});

Deno.test("provider add-on prerequisite is explicit and excludes billing details", async () => {
  const h = harness({
    message: "Private billing data",
    error: {
      code: "entitlement_required",
      upgrade_url: "https://billing.invalid/private",
    },
  }, 400);
  const response = await h.request("supabase.domains.get");
  assert.equal(response.status, 424);
  const text = await response.text();
  assert.equal(JSON.parse(text).error, "provider_entitlement_required");
  assert.ok(!text.includes("billing"));
});

Deno.test("trusted provider status header reflects actual Management responses and is absent before dispatch", async () => {
  const accepted = harness({ id: "zmqlyygzqoidkcwdysok" }, 201);
  const response = await accepted.request("supabase.projects.get");
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("x-sandy-provider-http-status"), "201");
  const rejected = await accepted.request(
    "supabase.projects.get",
    {},
    "user-session",
  );
  assert.equal(rejected.headers.get("x-sandy-provider-http-status"), null);
  const entitlement = harness({ error: { code: "entitlement_required" } }, 400);
  assert.equal(
    (await entitlement.request("supabase.domains.get")).headers.get(
      "x-sandy-provider-http-status",
    ),
    "400",
  );
});

Deno.test("database metadata operations use fixed provider-enforced read-only queries and omit SQL bodies and private data", async () => {
  const cases: [string, Record<string, unknown>][] = [
    ["supabase.db.migrations.list", { version: "20261020", name: "test" }],
    ["supabase.database.inspect", { schema_name: "public" }],
    ["supabase.schema.tables.list", {
      table_schema: "public",
      table_name: "test_table",
      table_type: "BASE TABLE",
    }],
    ["supabase.schema.functions.list", {
      schema: "public",
      name: "test_function",
      arguments: "id uuid",
      result: "jsonb",
    }],
    ["supabase.schema.indexes.list", {
      schemaname: "public",
      tablename: "test_table",
      indexname: "test_index",
    }],
    ["supabase.database.connections.list", {
      state: "idle",
      wait_event_type: "Client",
      count: 3,
    }],
  ];
  for (const [operation, expected] of cases) {
    const h = harness([{
      ...expected,
      statements: ["private SQL body"],
      query: "private customer query",
      api_key: "private",
    }]);
    const response = await h.request(operation);
    assert.equal(response.status, 200);
    assert.deepEqual((await response.json()).result, [expected]);
    const request = h.calls[0];
    assert.equal(request.method, "POST");
    assert.ok(
      request.url.endsWith("/projects/zmqlyygzqoidkcwdysok/database/query"),
    );
    const body = await request.json();
    assert.equal(body.read_only, true);
    assert.match(body.query, /^SELECT /);
    assert.ok(!body.query.includes("*") || body.query.includes("count(*)"));
    const injection = await h.request(operation, {
      query: "DROP TABLE customer_data",
      project_ref: "another",
    });
    assert.equal(injection.status, 400);
    assert.equal(h.calls.length, 1);
  }
});

Deno.test("bounded metadata projections omit definitions, credentials, policies and scheduler commands", async () => {
  const cases: [string, Record<string, unknown>, number][] = [
    [
      "supabase.schema.views.list",
      { schema: "public", name: "test_view" },
      1000,
    ],
    ["supabase.schema.materialized_views.list", {
      schema: "public",
      name: "test_materialized_view",
      populated: true,
      has_indexes: false,
    }, 1000],
    ["supabase.schema.triggers.list", {
      schema: "public",
      table_name: "test_table",
      name: "test_trigger",
      enabled: "O",
      on_insert: true,
      on_update: false,
      on_delete: false,
      on_truncate: false,
    }, 1000],
    ["supabase.schema.constraints.list", {
      schema: "public",
      table_name: "test_table",
      name: "test_constraint",
      type: "p",
      deferrable: false,
      initially_deferred: false,
      validated: true,
    }, 1000],
    ["supabase.schema.types.list", {
      schema: "public",
      name: "test_type",
      type: "c",
      category: "C",
    }, 1000],
    ["supabase.schema.extensions.list", {
      name: "test_extension",
      schema: "public",
      version: "1.0",
      relocatable: true,
    }, 200],
    ["supabase.database.roles.list", {
      name: "test_role",
      can_login: false,
      inherit: true,
      create_role: false,
      create_database: false,
      replication: false,
      bypass_rls: false,
      connection_limit: -1,
    }, 1000],
    ["supabase.database.grants.list", {
      object_schema: "public",
      object_name: "test_table",
      object_type: "table",
      grantor: "test_owner",
      grantee: "test_reader",
      privilege_type: "SELECT",
      is_grantable: false,
    }, 1000],
    ["supabase.database.default_privileges.list", {
      owner_role: "test_owner",
      schema: null,
      object_type: "r",
      grantee: "test_reader",
      privilege_type: "SELECT",
      is_grantable: false,
    }, 1000],
    ["supabase.database.rls.policies.list", {
      schema: "public",
      table_name: "test_table",
      name: "test_policy",
      permissive: "PERMISSIVE",
      roles: ["test_reader"],
      command: "SELECT",
    }, 1000],
    ["supabase.database.locks.list", {
      lock_type: "relation",
      mode: "AccessShareLock",
      granted: true,
      count: 2,
    }, 200],
    ["supabase.database.cron.jobs.list", {
      job_id: "123",
      name: null,
      schedule: "*/5 * * * *",
      active: false,
    }, 200],
  ];
  for (const [operation, expected, limit] of cases) {
    const h = harness([{
      ...expected,
      definition: "PRIVATE VIEW SQL",
      function_body: "PRIVATE FUNCTION SQL",
      policy_expression: "PRIVATE CUSTOMER SCOPE",
      rolpassword: "PRIVATE PASSWORD HASH",
      rolconfig: ["PRIVATE CONFIGURATION"],
      query: "PRIVATE CUSTOMER QUERY",
      username: "PRIVATE CONNECTION USER",
      nodehost: "PRIVATE CONNECTION HOST",
      command: operation === "supabase.database.rls.policies.list"
        ? expected.command
        : "PRIVATE SCHEDULER COMMAND",
    }]);
    const response = await h.request(operation);
    assert.equal(response.status, 200, operation);
    const text = await response.text();
    assert.ok(!text.includes("PRIVATE"), operation);
    const result = JSON.parse(text);
    assert.deepEqual(result.result, [expected], operation);
    assert.equal(result.result_limit, limit, operation);
    assert.equal(result.possibly_truncated, false, operation);
    const request = h.calls[0];
    assert.equal(request.method, "POST", operation);
    assert.equal(
      request.url,
      "https://api.supabase.com/v1/projects/zmqlyygzqoidkcwdysok/database/query",
      operation,
    );
    const submitted = await request.json();
    assert.equal(submitted.read_only, true, operation);
    assert.match(submitted.query, /^SELECT /, operation);
    assert.ok(submitted.query.endsWith(`LIMIT ${limit}`), operation);
    assert.ok(!submitted.query.includes("SELECT *"), operation);
    assert.ok(!submitted.query.includes("pg_get_triggerdef"), operation);
    assert.ok(!submitted.query.includes("pg_get_constraintdef"), operation);
    assert.ok(!submitted.query.includes("rolpassword"), operation);
    assert.equal(
      (await h.request(operation, {
        query: "UPDATE cron.job SET active = true",
      }))
        .status,
      400,
      operation,
    );
    assert.equal(h.calls.length, 1, operation);
  }
});

Deno.test("bounded lists conservatively signal a full page and cap provider overrun without claiming completeness", async () => {
  const h = harness(Array.from({ length: 1001 }, (_, index) => ({
    schema: "public",
    name: `test_view_${index}`,
  })));
  const response = await h.request("supabase.schema.views.list");
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.result.length, 1000);
  assert.equal(body.result_limit, 1000);
  assert.equal(body.possibly_truncated, true);
  const empty = harness([]);
  const emptyResponse = await empty.request(
    "supabase.schema.materialized_views.list",
  );
  const emptyBody = await emptyResponse.json();
  assert.equal(emptyBody.possibly_truncated, false);
  assert.deepEqual(emptyBody.result, []);
  const invalid = harness({ data: [] });
  assert.equal(
    (await invalid.request("supabase.schema.views.list")).status,
    502,
  );
});
