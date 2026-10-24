import assert from "node:assert/strict";
import {
  customerMutationContracts,
  type CustomerMutationDb,
  type CustomerMutationDependencies,
  type CustomerMutationOperation,
  customerMutationOperations,
  executeCustomerMutation,
  isCustomerMutationOperation,
  validateCustomerMutationArguments,
} from "./customer_mutations.ts";

type Row = Record<string, unknown>;
const customer = "11111111-1111-4111-8111-111111111111";
const actor = "22222222-2222-4222-8222-222222222222";
const itemId = "33333333-3333-4333-8333-333333333333";
const mutationId = "44444444-4444-4444-8444-444444444444";
const otherCustomer = "55555555-5555-4555-8555-555555555555";
const time = "2026-10-20T10:00:00.000Z";
const later = "2026-10-20T11:00:00.000Z";
const key = "synthetic-fixture-key";
const userJwt = "actual.user.session.jwt";
const base = "https://sandy.fixture.invalid";

function argsFor(operation: CustomerMutationOperation): Row {
  const args: Row = { idempotency_key: key };
  if (!operation.endsWith(".create")) args.id = itemId;
  if (operation === "tasks.create") args.title = "  Fixture task  ";
  if (operation === "tasks.update") args.priority = "high";
  if (operation === "calendar.create") {
    Object.assign(args, {
      title: "Fixture event",
      starts_at: time,
      ends_at: later,
    });
  }
  if (operation === "calendar.update") args.location = "Synthetic fixture";
  if (operation === "files.rename") args.name = "  Fixture file  ";
  if (operation === "files.set_description") args.description = "Fixture only";
  return args;
}

function receiptFor(
  operation: CustomerMutationOperation,
  args = argsFor(operation),
): Row {
  const item: Row = operation.startsWith("tasks.")
    ? {
      id: itemId,
      customer_id: customer,
      title: typeof args.title === "string"
        ? args.title.replace(/^ +| +$/g, "")
        : "Fixture task",
      status: "todo",
      priority: "normal",
      version: 2,
    }
    : operation.startsWith("calendar.")
    ? {
      id: itemId,
      customer_id: customer,
      title: "Fixture event",
      starts_at: time,
      ends_at: later,
      status: "confirmed",
    }
    : { id: itemId, owner_customer_id: customer };
  for (const [field, value] of Object.entries(args)) {
    if (!["idempotency_key", "id", "title", "name"].includes(field)) {
      item[field] = value;
    }
  }
  if (operation === "tasks.complete") {
    Object.assign(item, { status: "completed", completed_at: time });
  }
  if (operation === "tasks.archive") item.archived_at = time;
  if (operation === "calendar.cancel") item.status = "cancelled";
  if (operation === "files.rename") {
    item.display_name = String(args.name).trim().slice(0, 250);
  }
  if (operation === "files.set_description") {
    item.description = String(args.description ?? "").slice(0, 4000);
  }
  if (operation === "files.archive") {
    Object.assign(item, {
      library_state: "archived",
      library_state_changed_at: time,
    });
  }
  return {
    ok: true,
    contract_version: "1.0.0",
    operation,
    mutation_id: mutationId,
    reused: false,
    item,
  };
}

function fixture(options: {
  directory?: unknown;
  directoryError?: unknown;
  user?: unknown;
  authError?: unknown;
  response?: unknown;
  status?: number;
  rawResponse?: string;
  throwFetch?: boolean;
} = {}) {
  const authTokens: string[] = [];
  const queries: unknown[][] = [];
  const requests: { url: string; init: RequestInit; json: Row }[] = [];
  const db = {
    auth: {
      getUser(token: string) {
        authTokens.push(token);
        return Promise.resolve({
          data: {
            user: Object.hasOwn(options, "user")
              ? options.user
              : { id: actor, email: "Customer@Fixture.Invalid" },
          },
          error: options.authError ?? null,
        });
      },
    },
    from(table: string) {
      assert.equal(
        table,
        "sandy_agenda_access",
        "resource lookups must remain inside the receipt transaction",
      );
      const query: unknown[] = [table];
      queries.push(query);
      const chain = {
        select(columns: string) {
          query.push(["select", columns]);
          return chain;
        },
        eq(field: string, value: unknown) {
          query.push(["eq", field, value]);
          return chain;
        },
        is() {
          throw new Error("No preflight resource query permitted");
        },
        maybeSingle() {
          return Promise.resolve({
            data: Object.hasOwn(options, "directory") ? options.directory : {
              customer_id: customer,
              email: "customer@fixture.invalid",
              enabled: true,
            },
            error: options.directoryError ?? null,
          });
        },
      };
      return chain;
    },
  } as unknown as CustomerMutationDb;
  const fetcher = (async (input: string | URL | Request, init: RequestInit) => {
    requests.push({
      url: String(input),
      init,
      json: JSON.parse(String(init.body)),
    });
    if (options.throwFetch) {
      throw new TypeError("Synthetic transport loss; no external request made");
    }
    return options.rawResponse === undefined
      ? Response.json(options.response ?? {}, { status: options.status ?? 200 })
      : new Response(options.rawResponse, { status: options.status ?? 200 });
  }) as typeof fetch;
  const dependencies: CustomerMutationDependencies = {
    base,
    anon: "fixture-public-anon",
    db,
    fetch: fetcher,
  };
  return { dependencies, authTokens, queries, requests };
}

Deno.test("All ten customer writes use one fixed transactional RPC and the actual caller JWT", async () => {
  assert.equal(customerMutationOperations.length, 10);
  for (const operation of customerMutationOperations) {
    const args = argsFor(operation);
    const receipt = receiptFor(operation, args);
    const f = fixture({ response: receipt });
    assert.ok(isCustomerMutationOperation(operation));
    assert.ok(validateCustomerMutationArguments(operation, args));
    const result = await executeCustomerMutation(
      f.dependencies,
      userJwt,
      operation,
      args,
    );
    assert.equal(
      result.status,
      200,
      `${operation}: ${JSON.stringify(result.body)}`,
    );
    assert.deepEqual(result.body, {
      ok: true,
      operation,
      executed: true,
      result: receipt,
    });
    assert.deepEqual(f.authTokens, [userJwt]);
    assert.deepEqual(f.queries, [[
      "sandy_agenda_access",
      ["select", "email,customer_id,enabled"],
      ["eq", "email", "customer@fixture.invalid"],
      ["eq", "enabled", true],
    ]]);
    assert.equal(f.requests.length, 1);
    const request = f.requests[0];
    assert.equal(
      request.url,
      `${base}/rest/v1/rpc/sandy_api_customer_mutation`,
    );
    assert.equal(request.init.method, "POST");
    assert.equal(request.init.redirect, "error");
    assert.deepEqual(request.init.headers, {
      authorization: `Bearer ${userJwt}`,
      apikey: "fixture-public-anon",
      "content-type": "application/json",
    });
    const { idempotency_key: _, ...fields } = args;
    assert.deepEqual(request.json, {
      p_operation: operation,
      p_arguments: fields,
      p_idempotency_key: key,
    });
    assert.equal(Object.hasOwn(request.json, "customer_id"), false);
    assert.equal(Object.hasOwn(result.body, "verified"), false);
    assert.equal(customerMutationContracts[operation].is_mutation, true);
  }
});

Deno.test("Customer mutation inputs reject forged routing, identity, malformed fields and empty updates before auth or fetch", async () => {
  const invalid: [unknown, unknown][] = [
    ["tasks.delete", { id: itemId, idempotency_key: key }],
    ["tasks.create", null],
    ["tasks.create", { title: "Fixture" }],
    ["tasks.create", { title: "   ", idempotency_key: key }],
    ["tasks.create", { title: "😀".repeat(121), idempotency_key: key }],
    ["tasks.create", { title: "Fixture", id: itemId, idempotency_key: key }],
    ["tasks.create", {
      title: "Fixture",
      customer_id: customer,
      idempotency_key: key,
    }],
    ["tasks.update", { id: itemId, idempotency_key: key }],
    ["tasks.update", { id: "bad", priority: "high", idempotency_key: key }],
    ["tasks.update", {
      id: itemId,
      parent_task_id: itemId,
      idempotency_key: key,
    }],
    ["tasks.update", { id: itemId, company_id: "bad", idempotency_key: key }],
    ["tasks.update", { id: itemId, status: "done", idempotency_key: key }],
    ["tasks.update", { id: itemId, position: 1.1, idempotency_key: key }],
    ["tasks.complete", {
      id: itemId,
      provider: "supabase",
      idempotency_key: key,
    }],
    ["tasks.archive", { id: itemId, action: "create", idempotency_key: key }],
    ["calendar.create", {
      title: "Fixture",
      starts_at: time,
      ends_at: time,
      idempotency_key: key,
    }],
    ["calendar.create", {
      title: "Fixture",
      starts_at: time,
      ends_at: null,
      idempotency_key: key,
    }],
    ["calendar.update", {
      id: itemId,
      starts_at: "2026-99-40T10:00:00Z",
      idempotency_key: key,
    }],
    ["calendar.update", {
      id: itemId,
      starts_at: time,
      ends_at: "2026-10-20T09:59:00Z",
      idempotency_key: key,
    }],
    ["calendar.update", { id: itemId, all_day: "true", idempotency_key: key }],
    ["files.rename", { id: itemId, name: "\uFEFF\t", idempotency_key: key }],
    ["files.set_description", {
      id: itemId,
      description: {},
      idempotency_key: key,
    }],
    ["files.archive", {
      id: itemId,
      owner_customer_id: customer,
      idempotency_key: key,
    }],
    ["files.archive", { id: itemId, idempotency_key: "short" }],
    ["files.archive", { id: itemId, idempotency_key: "forbidden key spaces" }],
  ];
  for (const [operation, args] of invalid) {
    const f = fixture();
    const result = await executeCustomerMutation(
      f.dependencies,
      userJwt,
      operation,
      args,
    );
    assert.equal(result.status, 400, String(operation));
    assert.deepEqual(f.authTokens, []);
    assert.deepEqual(f.requests, []);
  }
});

Deno.test("Actual Auth identity and enabled exact-email directory are required independently of gateway identity", async () => {
  const operation = "files.archive";
  for (
    const token of [
      "",
      "sandyop_opaque",
      "sandy_api_opaque.secret",
      "Bearer user.jwt",
      "user\n.jwt",
    ]
  ) {
    const f = fixture();
    assert.equal(
      (await executeCustomerMutation(
        f.dependencies,
        token,
        operation,
        argsFor(operation),
      )).status,
      401,
    );
    assert.deepEqual(f.authTokens, []);
    assert.deepEqual(f.requests, []);
  }
  for (
    const options of [
      { user: null },
      { user: { id: actor, email: "" } },
      { user: { id: "forged", email: "customer@fixture.invalid" } },
      { authError: { message: "Synthetic Auth failure" } },
    ]
  ) {
    const f = fixture(options);
    assert.equal(
      (await executeCustomerMutation(
        f.dependencies,
        userJwt,
        operation,
        argsFor(operation),
      )).status,
      401,
    );
    assert.deepEqual(f.requests, []);
  }
  for (
    const directory of [null, {
      customer_id: customer,
      email: "customer@fixture.invalid",
      enabled: false,
    }, {
      customer_id: otherCustomer,
      email: "other@fixture.invalid",
      enabled: true,
    }, { customer_id: "bad", email: "customer@fixture.invalid", enabled: true }]
  ) {
    const f = fixture({ directory });
    assert.equal(
      (await executeCustomerMutation(
        f.dependencies,
        userJwt,
        operation,
        argsFor(operation),
      )).status,
      403,
    );
    assert.deepEqual(f.requests, []);
  }
  const f = fixture({
    directoryError: { message: "Synthetic directory failure" },
  });
  assert.equal(
    (await executeCustomerMutation(
      f.dependencies,
      userJwt,
      operation,
      argsFor(operation),
    )).status,
    503,
  );
  assert.deepEqual(f.requests, []);
});

Deno.test("Calendar partial updates and task reference arguments reach authoritative transaction checks unchanged", async () => {
  for (
    const [operation, args] of [
      ["calendar.update", {
        id: itemId,
        starts_at: later,
        company_id: otherCustomer,
        idempotency_key: key,
      }],
      ["calendar.update", { id: itemId, ends_at: null, idempotency_key: key }],
      ["tasks.update", {
        id: itemId,
        parent_task_id: otherCustomer,
        company_id: otherCustomer,
        category_id: otherCustomer,
        due_at: null,
        idempotency_key: key,
      }],
    ] as [CustomerMutationOperation, Row][]
  ) {
    const f = fixture({
      response: {
        ok: false,
        error: "Event end must follow start",
        http_status: 400,
      },
    });
    const result = await executeCustomerMutation(
      f.dependencies,
      userJwt,
      operation,
      args,
    );
    assert.equal(f.requests.length, 1);
    const { idempotency_key: _, ...fields } = args;
    assert.deepEqual(f.requests[0].json.p_arguments, fields);
    assert.equal(result.status, 400);
    assert.equal(result.body.executed, false);
  }
});

Deno.test("Known transaction denials preserve backend error and execution state", async () => {
  for (
    const [status, error] of [
      [403, "Parent task inaccessible"],
      [403, "Company inaccessible"],
      [403, "Category does not belong to this workspace"],
      [409, "Review the Sandy draft in Missions before completing this task"],
      [409, "idempotency_key_conflict"],
      [424, "operation_requires_live_verification"],
      [429, "private_readiness_budget_exhausted"],
      [404, "customer_item_not_found"],
    ] as [number, string][]
  ) {
    const f = fixture({ response: { ok: false, error, http_status: status } });
    assert.deepEqual(
      await executeCustomerMutation(
        f.dependencies,
        userJwt,
        "tasks.complete",
        argsFor("tasks.complete"),
      ),
      { status, body: { ok: false, error, executed: false } },
    );
  }
  const f = fixture({
    response: {
      ok: false,
      error: "customer_mutation_transaction_failed",
      http_status: 503,
      reconciliation_required: true,
    },
  });
  const result = await executeCustomerMutation(
    f.dependencies,
    userJwt,
    "tasks.archive",
    argsFor("tasks.archive"),
  );
  assert.equal(result.status, 503);
  assert.equal(result.body.executed, null);
  assert.equal(result.body.retry_with_same_idempotency_key, true);
});

Deno.test("Foreign, malformed, wrong-operation or stale-effect receipts never fabricate mutation success or leak records", async () => {
  const operation = "tasks.update";
  const args = {
    id: itemId,
    title: "New fixture title",
    due_at: later,
    company_id: otherCustomer,
    idempotency_key: key,
  };
  const good = receiptFor(operation, args);
  for (
    const change of [
      { operation: "tasks.create" },
      { mutation_id: "invalid" },
      { reused: "false" },
      {
        item: {
          ...(good.item as Row),
          customer_id: otherCustomer,
          secret_fixture_marker: "do-not-echo",
        },
      },
      { item: { ...(good.item as Row), id: otherCustomer } },
      { item: { ...(good.item as Row), title: "Stale fixture title" } },
      { item: { ...(good.item as Row), due_at: time } },
      { item: { ...(good.item as Row), company_id: customer } },
      { item: { ...(good.item as Row), version: 0 } },
    ]
  ) {
    const f = fixture({ response: { ...good, ...change } });
    const result = await executeCustomerMutation(
      f.dependencies,
      userJwt,
      operation,
      args,
    );
    assert.deepEqual(result, {
      status: 502,
      body: {
        ok: false,
        error: "customer_mutation_result_unverified",
        executed: null,
        reconciliation_required: true,
        retry_with_same_idempotency_key: true,
      },
    });
    assert.equal(JSON.stringify(result).includes("do-not-echo"), false);
  }
});

Deno.test("Transport loss, invalid JSON and ambiguous backend envelopes preserve unknown outcome and same-key retry", async () => {
  for (
    const options of [
      { throwFetch: true },
      { rawResponse: "not JSON" },
      { response: { ok: true } },
      {
        response: {
          ok: false,
          http_status: 200,
          error: "invalid error contract",
        },
      },
      { response: { message: "Synthetic SQL failure" }, status: 500 },
    ]
  ) {
    const f = fixture(options);
    const result = await executeCustomerMutation(
      f.dependencies,
      userJwt,
      "files.archive",
      argsFor("files.archive"),
    );
    assert.equal(result.status, 502);
    assert.equal(result.body.ok, false);
    assert.equal(result.body.executed, null);
    assert.equal(result.body.reconciliation_required, true);
    assert.equal(result.body.retry_with_same_idempotency_key, true);
  }
  for (const status of [401, 403, 404]) {
    const f = fixture({
      status,
      response: { message: "Must not echo upstream diagnostics" },
    });
    const result = await executeCustomerMutation(
      f.dependencies,
      userJwt,
      "files.archive",
      argsFor("files.archive"),
    );
    assert.equal(result.status, status);
    assert.equal(result.body.executed, false);
    assert.equal(
      JSON.stringify(result).includes("upstream diagnostics"),
      false,
    );
  }
});

Deno.test("Stable archive replay is validated without a pre-receipt active-resource lookup", async () => {
  const operation = "tasks.archive";
  const receipt = { ...receiptFor(operation), reused: true };
  const f = fixture({ response: receipt });
  const first = await executeCustomerMutation(
    f.dependencies,
    userJwt,
    operation,
    argsFor(operation),
  );
  const replay = await executeCustomerMutation(
    f.dependencies,
    userJwt,
    operation,
    argsFor(operation),
  );
  assert.deepEqual(first, replay);
  assert.equal((replay.body.result as Row).mutation_id, mutationId);
  assert.equal((replay.body.result as Row).reused, true);
  assert.equal(
    f.queries.length,
    2,
    "only independent tenant-directory reads occur outside RPC",
  );
  assert.deepEqual(f.requests[0].json, f.requests[1].json);
});

Deno.test("File normalization preserves legacy Unicode trim, UTF-16 slicing and omitted/null clearing semantics", async () => {
  for (
    const [operation, args] of [
      ["files.rename", {
        id: itemId,
        name: `\uFEFF\t${"😀".repeat(130)}  `,
        idempotency_key: key,
      }],
      ["files.set_description", {
        id: itemId,
        description: "😀".repeat(2100),
        idempotency_key: key,
      }],
      ["files.set_description", { id: itemId, idempotency_key: key }],
      ["files.set_description", {
        id: itemId,
        description: null,
        idempotency_key: key,
      }],
    ] as [CustomerMutationOperation, Row][]
  ) {
    const receipt = receiptFor(operation, args);
    const f = fixture({ response: receipt });
    const result = await executeCustomerMutation(
      f.dependencies,
      userJwt,
      operation,
      args,
    );
    assert.equal(result.status, 200);
    const { idempotency_key: _, ...raw } = args;
    assert.deepEqual(
      f.requests[0].json.p_arguments,
      raw,
      "normalization must happen exactly once inside the shared transaction",
    );
  }
  const taskArgs = { title: " \tTask title\t ", idempotency_key: key };
  const f = fixture({ response: receiptFor("tasks.create", taskArgs) });
  assert.equal(
    (await executeCustomerMutation(
      f.dependencies,
      userJwt,
      "tasks.create",
      taskArgs,
    )).status,
    200,
    "task title follows PostgreSQL btrim, not file JS trim",
  );
});

Deno.test("Backend configuration cannot redirect authenticated writes to arbitrary paths or insecure origins", async () => {
  for (
    const configured of [
      "http://sandy.fixture.invalid",
      "https://user:secret@sandy.fixture.invalid",
      "https://sandy.fixture.invalid/other",
      "https://sandy.fixture.invalid?override=1",
      "not-a-url",
    ]
  ) {
    const f = fixture();
    f.dependencies.base = configured;
    const result = await executeCustomerMutation(
      f.dependencies,
      userJwt,
      "files.archive",
      argsFor("files.archive"),
    );
    assert.equal(result.status, 503);
    assert.equal(result.body.executed, false);
    assert.deepEqual(f.requests, []);
  }
});

Deno.test("Malformed SDK boundaries fail before customer mutation dispatch", async () => {
  for (
    const db of [
      null,
      undefined,
      {},
      { auth: {}, from: () => ({}) },
      { auth: { getUser: () => null }, from: () => ({}) },
      {
        auth: {
          getUser: () =>
            Promise.resolve({
              data: { user: { id: actor, email: "customer@fixture.invalid" } },
              error: null,
            }),
        },
        from: () => ({ select: () => null }),
      },
    ]
  ) {
    const f = fixture();
    f.dependencies.db = db;
    const result = await executeCustomerMutation(
      f.dependencies,
      userJwt,
      "tasks.create",
      argsFor("tasks.create"),
    );
    assert.equal(result.status, 503);
    assert.equal(result.body.error, "customer_authorisation_unavailable");
    assert.equal(result.body.executed, false);
    assert.deepEqual(f.requests, []);
  }
});
