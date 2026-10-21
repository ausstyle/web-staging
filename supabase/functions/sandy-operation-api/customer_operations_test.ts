import {
  buildCustomerOperationRequest,
  customerContractMatches,
  customerOperationContracts,
  type CustomerOperationDependencies,
  executeCustomerOperation,
  isCustomerOperation,
  requiresCustomerOwner,
} from "./customer_operations.ts";
type Obj = Record<string, unknown>;
const actor = "11111111-1111-4111-8111-111111111111";
const tenant = "22222222-2222-4222-8222-222222222222";
const resource = "33333333-3333-4333-8333-333333333333";
const foreign = "44444444-4444-4444-8444-444444444444";
const user = "real.user.session",
  service = "internal.service.key",
  anon = "public.anon.key";
function assert(value: unknown, message = "assertion failed"): asserts value {
  if (!value) throw new Error(message);
}
function equal(a: unknown, b: unknown) {
  assert(
    JSON.stringify(a) === JSON.stringify(b),
    `${JSON.stringify(a)} differs from ${JSON.stringify(b)}`,
  );
}
function harness(payload: unknown = { ok: true }, status = 200) {
  const calls: { url: string; init: RequestInit }[] = [];
  const deps: CustomerOperationDependencies = {
    base: "https://project.supabase.co",
    anon,
    service,
    principal: {
      id: actor,
      customerId: tenant,
      portalAccess: true,
      controllerOwner: false,
    },
    fetch: ((url: unknown, init: RequestInit) => {
      calls.push({ url: String(url), init });
      return Promise.resolve(Response.json(payload, { status }));
    }) as typeof fetch,
  };
  return { deps, calls };
}
function example(schema: Obj, name = ""): unknown {
  if (Object.hasOwn(schema, "const")) return schema.const;
  if (Array.isArray(schema.enum)) return schema.enum[0];
  if (schema.type === "object") {
    return Object.fromEntries(
      Object.entries((schema.properties ?? {}) as Obj).map((
        [key, value],
      ) => [key, example(value as Obj, key)]),
    );
  }
  if (schema.type === "array") {
    return schema.minItems ? [example(schema.items as Obj)] : [];
  }
  if (schema.type === "boolean") return false;
  if (schema.type === "integer") return schema.minimum ?? 1;
  if (schema.format === "uuid") return resource;
  if (schema.format === "date-time") return "2026-10-20T00:00:00Z";
  if (name === "toolkit_slug") return "gmail";
  if (name === "connected_account_id") return "ca_12345";
  if (name === "auth_config_id") return "ac_12345";
  if (name === "request_id" || name === "request_key") {
    return "request_12345678";
  }
  if (name === "timezone") return "Australia/Sydney";
  return "x".repeat(Math.max(Number(schema.minLength ?? 1), 1));
}
Deno.test("all38 supported customer branches have fixed endpoint/action and real session forwarding", () => {
  const h = harness();
  equal(Object.keys(customerOperationContracts).length, 38);
  for (const [operation, c] of Object.entries(customerOperationContracts)) {
    const request = buildCustomerOperationRequest(
      h.deps,
      user,
      operation,
      example(c.input_schema),
    );
    assert(request, operation);
    const target = new URL(request.url),
      body = JSON.parse(String(request.init.body));
    equal(target.origin, h.deps.base);
    equal(target.pathname, `/functions/v1/${c.handler}`);
    if (c.handler === "sandy-workspace") {
      equal(target.searchParams.get("action"), c.action);
      assert(!Object.hasOwn(body, "action"));
    } else {
      equal(target.search, "");
      equal(body.operation, c.action);
    }
    assert(!Object.hasOwn(body, "customer_id"));
    assert(!Object.hasOwn(body, "auth_user_id"));
    equal(
      new Headers(request.init.headers).get("authorization"),
      `Bearer ${user}`,
    );
    equal(request.init.redirect, "error");
    assert(customerContractMatches(operation, c));
    assert(
      !customerContractMatches(operation, {
        ...c,
        handler: "arbitrary-function",
      }),
    );
  }
  assert(!isCustomerOperation("toString"));
  assert(!isCustomerOperation("composio.execute_read"));
});
Deno.test("customer identity cannot be inferred from Controller, Agenda, a service key or caller arguments", async () => {
  for (
    const patch of [{ portalAccess: false }, { customerId: "invalid" }, {
      id: "invalid",
    }]
  ) {
    const h = harness();
    Object.assign(h.deps.principal, patch, { controllerOwner: true });
    equal(
      (await executeCustomerOperation(h.deps, user, "workspace.overview", {}))
        .status,
      403,
    );
    equal(h.calls.length, 0);
  }
  for (const token of [service, anon, "", "Bearer injected"]) {
    const h = harness();
    equal(
      (await executeCustomerOperation(h.deps, token, "workspace.overview", {}))
        .status,
      503,
    );
    equal(h.calls.length, 0);
  }
  for (
    const injected of [
      { customer_id: foreign },
      { tenant_id: foreign },
      { action: "ask" },
      { operation: "execute_tool" },
      { connected_account_id: "ca_foreign" },
      { endpoint: "https://attacker.example" },
    ]
  ) {
    const h = harness();
    equal(
      (await executeCustomerOperation(
        h.deps,
        user,
        "workspace.overview",
        injected,
      )).status,
      400,
    );
    equal(h.calls.length, 0);
  }
});
Deno.test("cached topic reads cannot trigger classification while refresh and awareness are explicitly mutations", async () => {
  const h = harness({ ok: true, topics: [], classification: "cached" });
  equal(
    (await executeCustomerOperation(h.deps, user, "workspace.topics.list", {}))
      .status,
    200,
  );
  equal(JSON.parse(String(h.calls[0].init.body)), { refresh: false });
  equal(
    (await executeCustomerOperation(h.deps, user, "workspace.topics.list", {
      refresh: true,
    })).status,
    400,
  );
  for (
    const operation of [
      "workspace.topics.refresh",
      "workspace.chat.ask",
      "composio.awareness.refresh",
    ]
  ) {
    equal(customerOperationContracts[operation].is_mutation, true);
    equal(customerOperationContracts[operation].consumes_model_resources, true);
  }
  equal(
    customerOperationContracts["composio.connections.sync"].is_mutation,
    true,
  );
  equal(
    customerOperationContracts["workspace.missions.files.prepare"].is_mutation,
    true,
  );
  equal(
    customerOperationContracts["composio.execution_status"].is_mutation,
    false,
  );
});
Deno.test("global auth configuration and architecture refresh retain separate owner authorization", async () => {
  for (
    const operation of [
      "composio.auth_configs.initialize",
      "composio.auth_configs.list",
      "composio.auth_configs.provision",
      "composio.credentials.verify",
    ]
  ) {
    assert(requiresCustomerOwner(operation));
    const h = harness();
    equal(
      (await executeCustomerOperation(
        h.deps,
        user,
        operation,
        example(customerOperationContracts[operation].input_schema),
      )).status,
      403,
    );
    equal(h.calls.length, 0);
  }
  const h = harness();
  equal(
    (await executeCustomerOperation(
      h.deps,
      user,
      "composio.awareness.refresh",
      { refresh_architecture: true },
    )).status,
    403,
  );
  equal(h.calls.length, 0);
});
Deno.test("resource and returned tenant mismatches fail closed without leaking private data", async () => {
  const cases: [string, Obj, Obj][] = [
    ["workspace.conversations.history", { conversation_id: resource }, {
      conversation_id: foreign,
      turns: [],
    }],
    ["workspace.topics.thread", { topic_id: resource }, {
      topic: { id: foreign },
      conversations: [],
    }],
    ["workspace.missions.files.confirm", { file_id: resource }, {
      file_id: foreign,
    }],
    ["composio.connections.resolve", { toolkit_slug: "gmail" }, {
      toolkit_slug: "other",
      connected: true,
      connection_selection: "server_owned",
      execution_enabled: false,
    }],
    ["composio.connections.list", {}, {
      connections: [{ customer_id: foreign, private: "do not reveal" }],
    }],
    ["composio.connections.assign", {
      connected_account_id: "ca_12345",
      company_id: resource,
    }, {
      connection: { connected_account_id: "ca_other", company_id: resource },
    }],
  ];
  for (const [operation, args, payload] of cases) {
    const h = harness({ ok: true, ...payload });
    const response = await executeCustomerOperation(
      h.deps,
      user,
      operation,
      args,
    );
    equal(response.status, 502);
    assert(!(await response.text()).includes("do not reveal"));
  }
});
Deno.test("conditional review rules, input caps and fixed provider selection reject malformed requests", async () => {
  for (
    const [operation, args] of [
      ["workspace.missions.review", {
        task_id: resource,
        decision: "request_revision",
      }],
      ["workspace.missions.deliverables.review", {
        work_product_id: resource,
        decision: "revise",
        feedback: "x",
      }],
      ["workspace.missions.files.prepare", {
        question_id: resource,
        filename: "a.pdf",
        mime_type: "application/pdf",
        size_bytes: 20971521,
      }],
      ["workspace.chat.ask", {
        question: "x".repeat(12001),
        request_id: "request_12345678",
      }],
      ["composio.discover_tools", {
        toolkit_slug: "gmail",
        connected_account_id: "ca_12345",
      }],
      ["composio.connections.connect", {
        toolkit_slug: "gmail",
        google_services: ["all"],
      }],
    ] as [string, Obj][]
  ) {
    const h = harness();
    equal(
      (await executeCustomerOperation(h.deps, user, operation, args)).status,
      400,
    );
    equal(h.calls.length, 0);
  }
});
Deno.test("bounded responses disclose API truncation and preserve native cursor and unavailable classification", async () => {
  const h = harness({
    ok: true,
    topics: Array.from({ length: 201 }, (_, id) => ({ id })),
    classification: "cached",
  });
  const result = await (await executeCustomerOperation(
    h.deps,
    user,
    "workspace.topics.list",
    {},
  )).json();
  equal(result.topics.length, 200);
  equal(result.response_item_cap, 200);
  equal(result.response_items_truncated, true);
  const unavailable = harness({
    ok: true,
    topics: [],
    classification: "unavailable",
    unclassified: 10,
  });
  const failedRefresh = await executeCustomerOperation(
    unavailable.deps,
    user,
    "workspace.topics.refresh",
    {},
  );
  equal(failedRefresh.status, 200);
  equal((await failedRefresh.json()).classification, "unavailable");
  const cursor = { offset: 50, cutoff: "2026-10-20T00:00:00Z" };
  const history = harness({
    ok: true,
    items: [],
    total: 100,
    counts: {},
    next_cursor: cursor,
  });
  equal(
    (await (await executeCustomerOperation(
      history.deps,
      user,
      "workspace.history",
      {},
    )).json()).next_cursor,
    cursor,
  );
});
Deno.test("signed upload credentials are intentional short-lived results; internal authentication never escapes", async () => {
  const h = harness({
    ok: true,
    file_id: resource,
    path: `${tenant}/${resource}/file.pdf`,
    token: "short-lived-upload-token",
    unexpected: {
      access_token: "private",
      debug: `${service} ${anon} ${user}`,
    },
  });
  const response = await executeCustomerOperation(
    h.deps,
    user,
    "workspace.missions.files.prepare",
    {
      question_id: resource,
      filename: "file.pdf",
      mime_type: "application/pdf",
      size_bytes: 50,
    },
  );
  equal(response.status, 200);
  const data = await response.json();
  equal(data.token, "short-lived-upload-token");
  for (const secret of [service, anon, user, '"private"']) {
    assert(!JSON.stringify(data).includes(secret));
  }
});
Deno.test("unknown and partially accepted mutation results preserve reconciliation instead of fabricating completion", async () => {
  const h = harness();
  h.deps.fetch = (() => {
    throw new Error(service);
  }) as typeof fetch;
  const unknown = await executeCustomerOperation(
    h.deps,
    user,
    "workspace.missions.create",
    { title: "A mission", objective: "An objective with criteria" },
  );
  equal(unknown.status, 502);
  const receipt = await unknown.json();
  equal(receipt.executed, null);
  equal(receipt.reconciliation_required, true);
  assert(!JSON.stringify(receipt).includes(service));
  const partial = harness({
    error: "Review saved; follow-up could not be queued",
    code: service,
  }, 503);
  const failed = await executeCustomerOperation(
    partial.deps,
    user,
    "workspace.missions.deliverables.review",
    { work_product_id: resource, decision: "approve" },
  );
  equal(failed.status, 503);
  const rejected = await failed.json();
  equal(rejected.reconciliation_required, true);
  assert(!JSON.stringify(rejected).includes(service));
  const malformed = harness({ ok: true, conversation_id: resource });
  equal(
    (await executeCustomerOperation(
      malformed.deps,
      user,
      "workspace.conversations.list",
      {},
    )).status,
    502,
  );
});
