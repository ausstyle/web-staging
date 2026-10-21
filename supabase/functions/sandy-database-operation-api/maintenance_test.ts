import assert from "node:assert/strict";
import {
  argumentDigest,
  canonicalJson,
} from "../_shared/sandy_api_protocol.ts";
import { ConsumerCredentialError } from "../_shared/sandy_credential_consumer.ts";
import {
  createDatabaseOperationHandler,
  type DatabaseFinish,
} from "./index.ts";
import {
  databaseOperations as baseContracts,
  databaseProject,
  databaseScope,
} from "./contracts.ts";
import { databaseCapability, databaseOperations } from "./gateway.ts";
import {
  compileGuardedSchedule,
  createMaintenanceOperationHandler,
  type MaintenanceDependencies,
  nativeVacuumSql,
  validateGuardedSchedule,
} from "./maintenance.ts";
import {
  maintenanceExecutionScope,
  maintenanceOperations,
} from "./maintenance_contracts.ts";
import {
  MaintenanceConfigurationError,
  type NativeMaintenanceConnection,
  validateMaintenanceUrl,
  verifyNativeMaintenanceSession,
} from "./maintenance_native.ts";

type Row = Record<string, any>;
const actor = "11111111-1111-4111-8111-111111111111";
const requestId = "22222222-2222-4222-8222-222222222222";
const grantId = "33333333-3333-4333-8333-333333333333";
const admissionId = "44444444-4444-4444-8444-444444444444";
const commandId = "55555555-5555-4555-8555-555555555555";
const lease = "66666666-6666-4666-8666-666666666666";
const scheduleId = "77777777-7777-4777-8777-777777777777";
const context = {
  actor_id: actor,
  tenant_id: null,
  request_id: requestId,
  grant_id: grantId,
  admission_id: admissionId,
};
// Synthetic password, never connected: native tests supply an in-memory adapter.
const nativeUrl =
  `postgresql://postgres:synthetic-test-only@db.${databaseProject}.supabase.co:5432/postgres?sslmode=verify-full`;
const now = Date.parse("2026-10-21T12:00:00Z");
const cronArgs = () => ({
  name: "Synthetic bounded schedule",
  schedule: "*/5 * * * *",
  command: {
    sql:
      "UPDATE public.fixture_table SET value=$1::text WHERE id=$2::int4 RETURNING id",
    parameters: [{ type: "text", value: "Approved value" }, {
      type: "int4",
      value: 1,
    }],
    max_affected_rows: 1,
    verifications: [{
      sql: "SELECT value FROM public.fixture_table WHERE id=1",
      expected_rows: [{ value: "Approved value" }],
    }],
  },
  standing: {
    expires_at: "2026-10-21T13:00:00Z",
    max_runs: 2,
    min_interval_seconds: 300,
  },
});
const session = {
  database: "postgres",
  role: "postgres",
  statement_timeout: "15s",
  lock_timeout: "3s",
  read_only: "off",
  search_path: "pg_catalog",
};
function fixture(overrides: Partial<MaintenanceDependencies> = {}) {
  const events: string[] = [];
  const grants: Row[] = [];
  const receipts: DatabaseFinish[] = [];
  const deps: MaintenanceDependencies = {
    service: "synthetic-service",
    management: "synthetic-management",
    maintenanceUrl: nativeUrl,
    now: () => now,
    authorizeContext: async () => {
      events.push("owner_registry");
      return { allowed: true };
    },
    consumeGrant: async (grant) => {
      events.push("consume");
      grants.push(grant);
      return { allowed: true, admission_id: admissionId };
    },
    finishExecution: async (receipt) => {
      events.push(`finish_${receipt.outcome}`);
      receipts.push(receipt);
      return { allowed: true };
    },
    ...overrides,
  };
  return { deps, events, grants, receipts };
}
function invoke(
  deps: MaintenanceDependencies,
  operation: string,
  args: Row,
  extra: Row = {},
  headers: Record<string, string> = {},
) {
  return createMaintenanceOperationHandler(deps)(
    new Request("https://synthetic.invalid", {
      method: "POST",
      headers: {
        authorization: "Bearer synthetic-service",
        "content-type": "application/json",
        ...headers,
      },
      body: JSON.stringify({
        ...context,
        operation,
        arguments: args,
        ...extra,
      }),
    }),
  );
}
function nativeFixture(
  events: string[],
  options: {
    failVacuum?: boolean;
    tag?: string;
    result?: Row;
    finalizer?: Row;
    session?: Row;
  } = {},
) {
  const sql: string[] = [];
  let closed = false;
  const receipt = options.result ?? {
    command_id: commandId,
    operation: "supabase.database.vacuum",
    project_ref: databaseProject,
    request_state: "accepted",
    provider_protocol: "postgres",
    provider_command_tag: "VACUUM",
    command_completed: true,
    transactional: false,
    verification_passed: false,
    independently_observed: false,
    reconciliation_required: true,
  };
  const connection: NativeMaintenanceConnection = {
    async query(statement, parameters = [], simple = false) {
      sql.push(statement);
      if (statement.startsWith("SELECT current_database")) {
        events.push("session");
        return { rows: [options.session ?? session] };
      }
      if (statement.startsWith("VACUUM")) {
        events.push("vacuum");
        assert.equal(simple, true);
        assert.deepEqual(parameters, []);
        if (options.failVacuum) {
          throw new Error(
            "synthetic password and raw provider details must not escape",
          );
        }
        return { rows: [], command: options.tag ?? "VACUUM" };
      }
      let result: Row;
      if (statement.includes("sandy_api_maintenance_reserve(")) {
        events.push("reserve");
        const p = JSON.parse(parameters[0] as string);
        assert.equal(p.arguments.table, "fixture_table");
        assert.equal(p.target_table, "fixture_table");
        result = { ok: true, command_id: commandId, lease_token: lease };
      } else if (statement.includes("sandy_api_maintenance_start(")) {
        events.push("start");
        assert.deepEqual(parameters, [commandId, lease]);
        result = { ok: true };
      } else if (statement.includes("sandy_api_maintenance_finish(")) {
        events.push("native_receipt");
        assert.deepEqual(parameters.slice(0, 3), [
          commandId,
          lease,
          "accepted",
        ]);
        assert.deepEqual(JSON.parse(parameters[3] as string), {
          provider_protocol: "postgres",
          provider_command_tag: "VACUUM",
          command_completed: true,
        });
        result = { ok: true, result: receipt };
      } else if (statement.includes("sandy_api_maintenance_finish_native(")) {
        events.push("native_finalizer");
        assert.deepEqual(parameters, [admissionId, canonicalJson(receipt)]);
        result = options.finalizer ??
          {
            ok: true,
            admission_id: admissionId,
            state: "accepted",
            provider_http_status: null,
          };
      } else if (statement.includes("sandy_api_maintenance_mark_unknown(")) {
        events.push("mark_unknown");
        result = { ok: true };
      } else throw Error("Unexpected native statement");
      return { rows: [{ result }] };
    },
    async close() {
      closed = true;
      events.push("closed");
    },
  };
  return {
    connection,
    sql,
    get closed() {
      return closed;
    },
  };
}

Deno.test("maintenance v2 overrides only the three former blockers and adds owned recovery read", async () => {
  assert.equal(Object.keys(baseContracts).length, 78);
  assert.equal(Object.keys(databaseOperations).length, 79);
  assert.equal(Object.keys(maintenanceOperations).length, 4);
  for (const [name, op] of Object.entries(maintenanceOperations)) {
    assert.equal(databaseCapability(name).executable, true);
    assert.equal(op.api_key_delegable, false);
    assert.deepEqual(maintenanceExecutionScope(name), databaseScope);
    const { contract_sha256, ...source } = op;
    assert.equal(contract_sha256, await argumentDigest(source));
  }
  for (const [name, op] of Object.entries(baseContracts)) {
    if (!maintenanceOperations[name]) {
      assert.equal(databaseOperations[name], op);
    }
  }
  assert.throws(() => maintenanceExecutionScope("supabase.database.invented"));
});

Deno.test("native URL accepts only the configured fixed project's direct verified TLS identity", () => {
  assert.equal(validateMaintenanceUrl(nativeUrl), nativeUrl);
  for (
    const bad of [
      undefined,
      "",
      nativeUrl.replace("db.", "proxy."),
      nativeUrl.replace(databaseProject, "wrongproject"),
      nativeUrl.replace(":5432", ":6543"),
      nativeUrl.replace("/postgres?", "/other?"),
      nativeUrl.replace("postgres:synthetic", "other:synthetic"),
      nativeUrl.replace("verify-full", "disable"),
      `${nativeUrl}&sslmode=verify-full`,
      `${nativeUrl}&host=relay.invalid`,
      `${nativeUrl}#override`,
      "https://relay.invalid/sql",
    ]
  ) {
    assert.throws(
      () => validateMaintenanceUrl(bad),
      MaintenanceConfigurationError,
    );
  }
  assert.equal(
    nativeVacuumSql({ table: "fixture_table", analyze: true }),
    'VACUUM (ANALYZE true, FREEZE false, TRUNCATE false, SKIP_LOCKED true) "public"."fixture_table"',
  );
  assert.throws(() => nativeVacuumSql({ table: 'fixture_table"; SELECT 1' }));
});

Deno.test("native session enforces actual database, role, search path and server deadlines", async () => {
  await verifyNativeMaintenanceSession({
    query: async () => ({ rows: [session] }),
    close: async () => {},
  });
  for (
    const patch of [
      { database: "wrong" },
      { role: "service_role" },
      { search_path: "public" },
      { read_only: "on" },
      { statement_timeout: "0" },
      { statement_timeout: "16s" },
      { lock_timeout: "4s" },
    ]
  ) {
    await assert.rejects(() =>
      verifyNativeMaintenanceSession({
        query: async () => ({ rows: [{ ...session, ...patch }] }),
        close: async () => {},
      })
    );
  }
});

Deno.test("guarded cron excludes seconds, macros and malformed numeric schedules", () => {
  for (
    const source of ["* * * * *", "0,15,30,45 1-4/2 * * 1-5", "59 23 31 12 7"]
  ) assert.equal(validateGuardedSchedule(source), true, source);
  for (
    const source of [
      "1 second",
      "@reboot",
      "* * * * * *",
      "60 * * * *",
      "*/0 * * * *",
      "* 24 * * *",
      "* * 0 * *",
      "* * * * MON",
      "*  * * * *",
      "* * * * *;SELECT 1",
    ]
  ) assert.equal(validateGuardedSchedule(source), false, source);
});

Deno.test("cron compiler binds exact single-effect command and bounded standing lifetime", async () => {
  const args = cronArgs();
  const compiled = await compileGuardedSchedule(args, now);
  assert.equal(compiled.plan.statement.mode, "dml");
  assert.equal(compiled.standing.max_affected_rows, 1);
  assert.equal(
    compiled.plan.sha256,
    await argumentDigest({
      statement: compiled.plan.statement,
      verifications: compiled.plan.verifications,
    }),
  );
  assert.match(compiled.plan.statement.sql, /\$1/);
  assert.ok(!compiled.plan.statement.sql.includes("Approved value"));
  const query = cronArgs();
  query.command.sql = "SELECT 1 AS value";
  query.command.parameters = [];
  assert.equal(
    (await compileGuardedSchedule(query, now)).plan.statement.mode,
    "query",
  );
  for (
    const sql of [
      "SELECT net.http_get('https://relay.invalid')",
      "SELECT set_config('role','postgres',false)",
      "UPDATE public.fixture_table SET value='x'",
      "WITH changed AS (DELETE FROM public.fixture_table RETURNING *) UPDATE public.fixture_table SET value='x' RETURNING id",
      "UPDATE public.fixture_table SET value='x' RETURNING id; SELECT 1",
    ]
  ) {
    const bad = cronArgs();
    bad.command.sql = sql;
    bad.command.parameters = [];
    await assert.rejects(() => compileGuardedSchedule(bad, now));
  }
  for (
    const expires_at of [
      "2026-10-21T12:00:30Z",
      "2026-10-23T12:00:00Z",
      "invalid",
    ]
  ) {
    await assert.rejects(() =>
      compileGuardedSchedule({
        ...cronArgs(),
        standing: { ...args.standing, expires_at },
      }, now)
    );
  }
});

Deno.test("missing native configuration, invalid standing bounds and delegated contexts consume no grant", async () => {
  const f = fixture({ maintenanceUrl: "" });
  assert.equal(
    (await invoke(f.deps, "supabase.database.vacuum", {
      table: "fixture_table",
    })).status,
    424,
  );
  assert.deepEqual(f.events, []);
  for (const patch of [{ max_runs: 101 }, { min_interval_seconds: 1 }]) {
    const args = cronArgs();
    Object.assign(args.standing, patch);
    assert.equal(
      (await invoke(f.deps, "supabase.database.cron.jobs.create", args)).status,
      400,
    );
  }
  assert.equal(
    (await invoke(f.deps, "supabase.database.vacuum", {
      table: "fixture_table",
    }, { credential_id: grantId })).status,
    400,
  );
  assert.equal(
    (await invoke(
      f.deps,
      "supabase.database.vacuum",
      { table: "fixture_table" },
      {},
      { "x-sandy-api-key": "synthetic" },
    )).status,
    403,
  );
  assert.deepEqual(f.events, []);
});

Deno.test("native VACUUM follows consumed approval and finalizes exact private proof without HTTP fiction", async () => {
  const f = fixture();
  const native = nativeFixture(f.events);
  f.deps.connect = async (url) => {
    assert.equal(url, nativeUrl);
    f.events.push("connect");
    return native.connection;
  };
  f.deps.fetch = () => {
    throw Error("Native maintenance must never use HTTP SQL");
  };
  const reply = await invoke(f.deps, "supabase.database.vacuum", {
    table: "fixture_table",
    analyze: true,
  });
  const body = await reply.json();
  assert.equal(reply.status, 200);
  assert.equal(body.provider_http_status, null);
  assert.equal(body.provider_protocol, "postgres");
  assert.equal(body.result.verification_passed, false);
  assert.equal(body.result.reconciliation_required, true);
  assert.equal(
    f.receipts.length,
    0,
    "HTTP finalizer must never manufacture native completion",
  );
  assert.deepEqual(f.events, [
    "owner_registry",
    "consume",
    "connect",
    "session",
    "reserve",
    "start",
    "vacuum",
    "native_receipt",
    "native_finalizer",
    "closed",
  ]);
  assert.equal(
    f.grants[0].input_sha256,
    await argumentDigest({ table: "fixture_table", analyze: true }),
  );
  assert.equal(f.grants[0].scope_sha256, await argumentDigest(databaseScope));
  assert.ok(native.sql.every((sql) => !/\bBEGIN\b|\bCOMMIT\b/.test(sql)));
  assert.equal(native.closed, true);
});

Deno.test("unknown native result is private, never retried and cannot be reported as verified", async () => {
  for (
    const options of [{ failVacuum: true }, { tag: "SELECT" }, {
      finalizer: { ok: false },
    }]
  ) {
    const f = fixture();
    const native = nativeFixture(f.events, options);
    f.deps.connect = async () => native.connection;
    const reply = await invoke(f.deps, "supabase.database.vacuum", {
      table: "fixture_table",
    });
    const body = await reply.json();
    assert.equal(reply.status, 502);
    assert.equal(body.executed, null);
    assert.equal(body.automatic_retry, false);
    assert.equal(body.reconciliation_required, true);
    assert.equal(f.events.filter((e) => e === "vacuum").length, 1);
    assert.equal(f.receipts[0].outcome, "unknown");
    assert.equal(f.receipts[0].provider_http_status, null);
    assert.ok(!JSON.stringify(body).includes("password"));
    assert.ok(!JSON.stringify(body).includes(lease));
    assert.equal(native.closed, true);
  }
});

Deno.test("grant refusal and invalid native session cannot execute a maintenance command", async () => {
  const f = fixture({
    consumeGrant: async () => ({
      allowed: false,
      error: "grant_expired",
      http_status: 409,
    }),
    connect: () => {
      throw Error("must not connect");
    },
  });
  assert.equal(
    (await invoke(f.deps, "supabase.database.vacuum", {
      table: "fixture_table",
    })).status,
    409,
  );
  const g = fixture();
  const native = nativeFixture(g.events, {
    session: { ...session, statement_timeout: "0" },
  });
  g.deps.connect = async () => native.connection;
  assert.equal(
    (await invoke(g.deps, "supabase.database.vacuum", {
      table: "fixture_table",
    })).status,
    424,
  );
  assert.ok(!g.events.includes("vacuum"));
  assert.equal(g.receipts[0].outcome, "failed");
});

Deno.test("Management cron resolves consumer only after grant and preserves real HTTP status", async () => {
  const f = fixture();
  let fetches = 0;
  f.deps.withManagementCredential = async (execution, use) => {
    f.events.push("consumer");
    assert.equal(execution.admissionId, admissionId);
    return await use("synthetic-consumer-token");
  };
  f.deps.fetch = async (input, init) => {
    fetches++;
    f.events.push("provider");
    assert.equal(
      String(input),
      `https://api.supabase.com/v1/projects/${databaseProject}/database/query`,
    );
    assert.equal(init?.redirect, "error");
    assert.equal(
      (init?.headers as Row).authorization,
      "Bearer synthetic-consumer-token",
    );
    const p = JSON.parse(init?.body as string);
    assert.equal(p.read_only, false);
    assert.match(p.query, /SELECT public\.sandy_api_maintenance_cron_upsert/);
    assert.ok(!p.query.includes("Approved value"));
    return Response.json([{
      result: {
        ok: true,
        result: {
          schedule_id: scheduleId,
          cron_job_id: 123,
          revision: 1,
          active: true,
          standing_authorization: true,
        },
      },
    }], { status: 201 });
  };
  const reply = await invoke(
    f.deps,
    "supabase.database.cron.jobs.create",
    cronArgs(),
  );
  const body = await reply.json();
  assert.equal(reply.status, 200);
  assert.equal(body.contract_version, "2.0.0");
  assert.equal(body.provider_http_status, 201);
  assert.equal(body.provider_protocol, "management_https");
  assert.equal(f.receipts[0].provider_http_status, 201);
  assert.deepEqual(f.events, [
    "owner_registry",
    "consume",
    "consumer",
    "provider",
    "finish_accepted",
  ]);
  assert.equal(fetches, 1);
});

Deno.test("configured consumer refusal never falls back to environment or claims a provider effect", async () => {
  const f = fixture({
    withManagementCredential: async () => {
      throw new ConsumerCredentialError("consumer_active_readback_required");
    },
    fetch: () => {
      throw Error("no fallback");
    },
  });
  const reply = await invoke(
    f.deps,
    "supabase.database.cron.jobs.create",
    cronArgs(),
  );
  const body = await reply.json();
  assert.equal(reply.status, 424);
  assert.equal(body.executed, false);
  assert.equal(body.error, "consumer_active_readback_required");
  assert.equal(f.receipts[0].outcome, "failed");
});

Deno.test("receipt recovery uses fresh read grant, read_only request and explicit missing result", async () => {
  const f = fixture();
  f.deps.fetch = async (_input, init) => {
    assert.equal(JSON.parse(init?.body as string).read_only, true);
    return Response.json([{ result: { ok: true, result: null } }], {
      status: 201,
    });
  };
  const reply = await invoke(
    f.deps,
    "supabase.database.maintenance.receipt.get",
    { request_id: requestId },
  );
  const body = await reply.json();
  assert.equal(reply.status, 404);
  assert.equal(body.error, "maintenance_receipt_not_found");
  assert.equal(f.receipts[0].outcome, "failed");
  assert.equal(f.grants.length, 1);
});

Deno.test("raw SQL, credentials and oversized provider results never escape maintenance projections", async () => {
  for (
    const result of [
      { schedule_id: scheduleId, readback: { password: "synthetic-secret" } },
      { schedule_id: scheduleId, sql: "SELECT secret" },
      { schedule_id: "x".repeat(20000) },
    ]
  ) {
    const f = fixture({
      fetch: async () =>
        Response.json([{ result: { ok: true, result } }], { status: 201 }),
    });
    const reply = await invoke(
      f.deps,
      "supabase.database.cron.jobs.create",
      cronArgs(),
    );
    const body = await reply.text();
    assert.equal(reply.status, 502);
    assert.ok(!body.includes("synthetic-secret"));
    assert.ok(!body.includes("SELECT secret"));
  }
});

Deno.test("deployed database entry dispatches maintenance before legacy blocked plan logic", async () => {
  const f = fixture({ maintenanceUrl: "" });
  const reply = await createDatabaseOperationHandler(f.deps)(
    new Request("https://synthetic.invalid", {
      method: "POST",
      headers: { authorization: "Bearer synthetic-service" },
      body: JSON.stringify({
        ...context,
        operation: "supabase.database.vacuum",
        arguments: { table: "fixture_table" },
      }),
    }),
  );
  assert.equal(reply.status, 424);
  assert.equal(
    (await reply.json()).error,
    "database_native_maintenance_configuration_required",
  );
  assert.deepEqual(f.events, []);
});
