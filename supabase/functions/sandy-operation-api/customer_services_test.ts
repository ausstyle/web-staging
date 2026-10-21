import {
  buildCustomerServiceRequest,
  customerServiceContractMatches,
  customerServiceContracts,
  type CustomerServiceDependencies,
  executeCustomerService,
  hasCustomerServiceGrant,
  isCustomerServiceOperation,
} from "./customer_services.ts";
type Obj = Record<string, unknown>;
const actor = "11111111-1111-4111-8111-111111111111",
  tenant = "22222222-2222-4222-8222-222222222222",
  id = "33333333-3333-4333-8333-333333333333",
  other = "44444444-4444-4444-8444-444444444444";
const user = "customer.user.jwt",
  service = "internal.service.jwt",
  anon = "public.anon.jwt";
function assert(x: unknown, message = "assertion failed"): asserts x {
  if (!x) throw Error(message);
}
function eq(a: unknown, b: unknown) {
  assert(
    JSON.stringify(a) === JSON.stringify(b),
    `${JSON.stringify(a)} != ${JSON.stringify(b)}`,
  );
}
function h(payload: unknown = { ok: true }, status = 200) {
  const calls: { url: string; init: RequestInit }[] = [];
  const deps: CustomerServiceDependencies = {
    base: "https://project.supabase.co",
    anon,
    service,
    principal: {
      id: actor,
      portalCustomerId: tenant,
      agendaCustomerId: tenant,
      controllerOwner: true,
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
        [n, s],
      ) => [n, example(s as Obj, n)]),
    );
  }
  if (schema.type === "array") return [];
  if (schema.type === "boolean") return false;
  if (schema.type === "integer") return schema.minimum ?? 1;
  if (schema.format === "uuid") {
    return name === "related_person_id" ? other : id;
  }
  if (schema.format === "date-time") return "2026-10-20T00:00:00Z";
  if (name === "timezone") return "Australia/Sydney";
  return "x".repeat(Math.max(Number(schema.minLength ?? 1), 1));
}
Deno.test("all57 installed application contracts select fixed services, selectors and user authentication", () => {
  eq(Object.keys(customerServiceContracts).length, 57);
  const { deps } = h();
  for (const [operation, c] of Object.entries(customerServiceContracts)) {
    const request = buildCustomerServiceRequest(
      deps,
      user,
      operation,
      example(c.input_schema),
    );
    assert(request, operation);
    eq(request.url, `${deps.base}/functions/v1/${c.handler}`);
    eq(request.init.redirect, "error");
    eq(
      new Headers(request.init.headers).get("authorization"),
      `Bearer ${user}`,
    );
    const sent = JSON.parse(String(request.init.body));
    if (c.body_mode === "payload") {
      eq(sent.action, c.action);
      assert(Object.hasOwn(sent, "payload"));
    } else eq(sent[c.body_mode === "op" ? "op" : "action"], c.action);
    assert(!Object.hasOwn(sent, "customer_id"));
    assert(!Object.hasOwn(sent, "actor_id"));
    assert(customerServiceContractMatches(operation, c));
    assert(
      !customerServiceContractMatches(operation, {
        ...c,
        is_mutation: !c.is_mutation,
      }),
    );
  }
  assert(!isCustomerServiceOperation("toString"));
  assert(!isCustomerServiceOperation("controller.arbitrary"));
});
Deno.test("portal, Agenda and Controller grants are separate and shared file access requires the same customer", async () => {
  const { deps, calls } = h();
  deps.principal = {
    id: actor,
    portalCustomerId: null,
    agendaCustomerId: null,
    controllerOwner: true,
  };
  assert(hasCustomerServiceGrant(deps.principal, "controller.overview"));
  for (
    const operation of [
      "social.people.list",
      "calendar.client.overview",
      "task_files.counts",
    ]
  ) {
    eq((await executeCustomerService(deps, user, operation, {})).status, 403);
  }
  deps.principal = {
    id: actor,
    portalCustomerId: tenant,
    agendaCustomerId: other,
    controllerOwner: false,
  };
  assert(hasCustomerServiceGrant(deps.principal, "social.people.list"));
  assert(hasCustomerServiceGrant(deps.principal, "calendar.client.overview"));
  eq(
    (await executeCustomerService(deps, user, "task_files.counts", {})).status,
    403,
  );
  eq(
    (await executeCustomerService(deps, user, "controller.overview", {}))
      .status,
    403,
  );
  eq(calls.length, 0);
});
Deno.test("tenant, action, provider and credential overrides never reach fixed backends", async () => {
  const { deps, calls } = h();
  for (
    const args of [
      { customer_id: other },
      { action: "create_person" },
      { op: "overview" },
      { endpoint: "https://attacker.example" },
      { source: { id: other } },
    ]
  ) {
    eq(
      (await executeCustomerService(deps, user, "social.people.list", args))
        .status,
      400,
    );
  }
  for (const token of [service, anon, "", "Bearer arbitrary"]) {
    eq(
      (await executeCustomerService(deps, token, "social.people.list", {}))
        .status,
      503,
    );
  }
  eq(calls.length, 0);
});
Deno.test("legacy read responses need complete stable shapes and preserve bounded result limitations", async () => {
  const graph = h({ people: [], connections: [] });
  const response = await executeCustomerService(
    graph.deps,
    user,
    "social.people.list",
    {},
  );
  eq(response.status, 200);
  eq((await response.json()).ok, true);
  const malformed = h({ people: [] });
  eq(
    (await executeCustomerService(
      malformed.deps,
      user,
      "social.people.list",
      {},
    )).status,
    502,
  );
  const capped = h({
    tasks: Array.from({ length: 201 }, (_, i) => ({ id: i })),
    read_only: false,
  });
  const result = await (await executeCustomerService(
    capped.deps,
    user,
    "controller.self_tasks.list",
    {},
  )).json();
  eq(result.tasks.length, 200);
  eq(result.response_item_cap, 200);
  eq(result.response_items_truncated, true);
  const history = h({
    file_id: id,
    history: [],
    merged_copies: 0,
    recorded_sources: 0,
    recorded_usages: 0,
    complete: false,
    coverage_note: "Recorded sources only",
  });
  const fileHistory = await executeCustomerService(
    history.deps,
    user,
    "files.library.history",
    { id },
  );
  eq((await fileHistory.json()).complete, false);
});
Deno.test("returned resource and tenant mismatches are rejected while backend-authorized sharing remains possible", async () => {
  const cross = h({ people: [{ id, customer_id: other }], connections: [] });
  eq(
    (await executeCustomerService(cross.deps, user, "social.people.list", {}))
      .status,
    502,
  );
  const foreignJob = h({
    ok: true,
    job: { id: other },
    execution_started: false,
    notice: "Approved",
  });
  eq(
    (await executeCustomerService(
      foreignJob.deps,
      user,
      "controller.deployment.approve",
      { job_id: id },
    )).status,
    502,
  );
  const foreignRun = h({
    ok: true,
    run_key: "wrong",
    run: null,
    generated_tests: [],
    production_threads: [],
    production_history: [],
    summary: {},
    limits: {},
  });
  eq(
    (await executeCustomerService(
      foreignRun.deps,
      user,
      "controller.examiner.report",
      { run_key: "expected" },
    )).status,
    502,
  );
  const shared = h({
    files: [{ id, owner_customer_id: other }],
    can_upload: false,
    can_delete_all: false,
  });
  eq(
    (await executeCustomerService(shared.deps, user, "task_files.list", {
      task_id: id,
    })).status,
    200,
  );
});
Deno.test("read-labelled connection reconciliation and all model/send/lifecycle work are classified as mutations", () => {
  for (
    const operation of [
      "calendar.client.sources.reconcile",
      "calendar.client.timezone.observe",
      "calendar.client.attachments.prepare",
      "controller.examiner.run",
      "controller.examiner.production.run",
      "controller.qa.update",
      "files.library.state.set",
    ]
  ) eq(customerServiceContracts[operation].is_mutation, true);
  eq(
    customerServiceContracts["controller.examiner.run"]
      .consumes_model_resources,
    true,
  );
  eq(
    customerServiceContracts["calendar.client.timezone.get"].is_mutation,
    false,
  );
  eq(customerServiceContracts["social.people.list"].is_mutation, false);
});
Deno.test("verification, scheduling and graph invariants fail before mutation", async () => {
  for (
    const [operation, args] of [
      ["social.relationships.create", {
        person_id: id,
        related_person_id: id,
        relationship: "self",
      }],
      ["calendar.client.events.create", {
        title: "A meeting",
        starts_at: "2026-10-20T10:00:00Z",
        ends_at: "2026-10-20T09:00:00Z",
      }],
      ["controller.supervisor.jobs.update", { id, status: "verified" }],
      ["controller.self_tasks.update", { id, status: "rejected" }],
      ["calendar.client.attachments.prepare", {
        event_id: id,
        file_name: "a.pdf",
        byte_size: 10485761,
        content_type: "application/pdf",
      }],
    ] as [string, Obj][]
  ) {
    const x = h();
    eq(
      (await executeCustomerService(x.deps, user, operation, args)).status,
      400,
    );
    eq(x.calls.length, 0);
  }
  const broken = h();
  const response = await executeCustomerService(
    broken.deps,
    user,
    "controller.self_tasks.update",
    { id, notes: "A note" },
  );
  eq(response.status, 424);
  eq((await response.json()).executed, false);
  eq(broken.calls.length, 0);
});
Deno.test("provider dispatch remains running, and lost writes require reconciliation without leaking credentials", async () => {
  const run = h({
    ok: true,
    run_key: "production:example",
    status: "running",
    mode: "mandatory_full_cycle_v2",
    minimum_tests: 10,
    review_channels: ["web", "email"],
  }, 202);
  const ack = await executeCustomerService(
    run.deps,
    user,
    "controller.examiner.production.run",
    {},
  );
  eq(ack.status, 202);
  const receipt = await ack.json();
  eq(receipt.status, "running");
  assert(!Object.hasOwn(receipt, "verified"));
  const lost = h();
  lost.deps.fetch = (() => {
    throw Error(service);
  }) as typeof fetch;
  const unknown = await executeCustomerService(
    lost.deps,
    user,
    "social.people.create",
    { name: "New contact" },
  );
  const failure = await unknown.json();
  eq(failure.executed, null);
  eq(failure.reconciliation_required, true);
  assert(!JSON.stringify(failure).includes(service));
  const protectedOutput = h({
    people: [],
    connections: [],
    unsafe: { access_token: "private", note: `${service} ${anon} ${user}` },
  });
  const clean = await (await executeCustomerService(
    protectedOutput.deps,
    user,
    "social.people.list",
    {},
  )).text();
  for (const value of [service, anon, user, '"private"']) {
    assert(!clean.includes(value));
  }
});
Deno.test("backend output byte cap applies to streamed responses and never fabricates success", async () => {
  const large = h();
  large.deps.fetch = (() =>
    Promise.resolve(
      new Response(
        JSON.stringify({
          people: [],
          connections: [],
          extra: "x".repeat(4 * 1024 * 1024),
        }),
      ),
    )) as typeof fetch;
  const failed = await executeCustomerService(
    large.deps,
    user,
    "social.people.list",
    {},
  );
  eq(failed.status, 502);
  eq((await failed.json()).error, "customer_backend_invalid_response");
});
