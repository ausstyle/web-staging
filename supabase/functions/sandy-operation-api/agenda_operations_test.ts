import {
  agendaContractMatches,
  agendaContracts,
  buildAgendaRequest,
  executeAgendaOperation,
  isAgendaOperation,
} from "./agenda_operations.ts";
import { type CustomerServiceDependencies } from "./customer_services.ts";
type Obj = Record<string, unknown>;
const actor = "11111111-1111-4111-8111-111111111111",
  tenant = "22222222-2222-4222-8222-222222222222",
  id = "33333333-3333-4333-8333-333333333333",
  other = "44444444-4444-4444-8444-444444444444";
const user = "real.user.jwt",
  anon = "public.anon.jwt",
  service = "internal.service.jwt";
function assert(v: unknown, message = "assertion failed"): asserts v {
  if (!v) throw Error(message);
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
    const out = Object.fromEntries(
      Object.entries((schema.properties ?? {}) as Obj).map((
        [n, child],
      ) => [n, example(child as Obj, n)]),
    );
    if (Object.hasOwn(out, "invitation_id")) delete out.invitation_id;
    return out;
  }
  if (schema.type === "array") return [];
  if (schema.type === "boolean") return false;
  if (schema.type === "integer") return schema.minimum ?? 1;
  if (schema.format === "uuid") {
    return ["id", "task_id"].includes(name) ? id : other;
  }
  if (schema.format === "date-time") return "2026-10-20T00:00:00Z";
  if (schema.format === "email") return "recipient@example.test";
  if (name === "client_request_id") return `pending-${id}`;
  return "x".repeat(Math.max(Number(schema.minLength ?? 1), 1));
}
Deno.test("all25 Agenda contracts fix methods, actions and actual-session RPC selection", () => {
  eq(Object.keys(agendaContracts).length, 25);
  const x = h();
  for (const [operation, c] of Object.entries(agendaContracts)) {
    const args = example(c.input_schema);
    const request = buildAgendaRequest(x.deps, user, operation, args);
    assert(request, operation);
    const url = new URL(request.url);
    eq(url.origin, x.deps.base);
    eq(request.init.method, c.method);
    eq(request.init.redirect, "error");
    eq(
      new Headers(request.init.headers).get("authorization"),
      `Bearer ${user}`,
    );
    if (c.rpc) {
      eq(url.pathname, "/rest/v1/rpc/sandy_api_agenda_save_pins");
      eq(JSON.parse(String(request.init.body)), { p_task_ids: [] });
    } else {
      eq(url.pathname, "/functions/v1/sandy-agenda");
      eq(url.searchParams.get("action"), c.action);
    }
    if (c.method === "GET") eq(request.init.body, undefined);
    assert(agendaContractMatches(operation, c));
    assert(
      !agendaContractMatches(operation, { ...c, handler: "caller_service" }),
    );
  }
  assert(!isAgendaOperation("toString"));
  assert(!isAgendaOperation("agenda.auth.impersonate"));
});
Deno.test("matching customer grants are necessary and owner/service credentials cannot replace a customer", async () => {
  for (
    const principal of [
      {
        id: actor,
        portalCustomerId: tenant,
        agendaCustomerId: other,
        controllerOwner: true,
      },
      {
        id: actor,
        portalCustomerId: null,
        agendaCustomerId: tenant,
        controllerOwner: true,
      },
      {
        id: actor,
        portalCustomerId: tenant,
        agendaCustomerId: null,
        controllerOwner: true,
      },
    ]
  ) {
    const x = h();
    x.deps.principal = principal;
    eq(
      (await executeAgendaOperation(x.deps, user, "agenda.pins.save", {
        task_ids: [],
      })).status,
      403,
    );
    eq(x.calls.length, 0);
  }
  for (const token of [service, anon, ""]) {
    const x = h();
    eq(
      (await executeAgendaOperation(x.deps, token, "agenda.pins.save", {
        task_ids: [],
      })).status,
      503,
    );
    eq(x.calls.length, 0);
  }
});
Deno.test("fixed recipient mapping cannot be confused with caller tenant identity", async () => {
  const x = h({ ok: true });
  const response = await executeAgendaOperation(
    x.deps,
    user,
    "agenda.access.revoke",
    { task_id: id, recipient_customer_id: other, kind: "share" },
  );
  eq(response.status, 200);
  eq(JSON.parse(String(x.calls[0].init.body)), {
    task_id: id,
    customer_id: other,
    kind: "share",
  });
  for (
    const args of [{ task_id: id, customer_id: other, kind: "share" }, {
      task_id: id,
      recipient_customer_id: other,
      invitation_id: id,
      kind: "share",
    }, { task_id: id }]
  ) {
    eq(
      (await executeAgendaOperation(x.deps, user, "agenda.access.revoke", args))
        .status,
      400,
    );
  }
});
Deno.test("pin replacement is idempotent and canonical IDs are accepted without caller-selected actor or tenant", async () => {
  const upper = "AABBCCDD-AABB-CCDD-AABB-AABBCCDDEEFF";
  const x = h({ ok: true, task_ids: [upper.toLowerCase()], reused: true });
  const response = await executeAgendaOperation(
    x.deps,
    user,
    "agenda.pins.save",
    { task_ids: [upper] },
  );
  eq(response.status, 200);
  eq((await response.json()).reused, true);
  const sent = JSON.parse(String(x.calls[0].init.body));
  eq(sent, { p_task_ids: [upper] });
  for (
    const args of [
      { task_ids: [id, id] },
      { task_ids: Array(101).fill(id) },
      { task_ids: ["invalid"] },
      { task_ids: [], actor_id: actor },
      { task_ids: [], customer_id: tenant },
    ]
  ) {
    eq(
      (await executeAgendaOperation(x.deps, user, "agenda.pins.save", args))
        .status,
      400,
    );
  }
  const failed = h({
    ok: false,
    error: "owned_unarchived_tasks_required",
    http_status: 403,
  });
  eq(
    (await executeAgendaOperation(failed.deps, user, "agenda.pins.save", {
      task_ids: [other],
    })).status,
    403,
  );
});
Deno.test("passive reads cannot activate interpretation, messages or unsafe resource changes", async () => {
  const x = h();
  for (
    const [operation, args] of [
      ["agenda.overview", { action: "delegate" }],
      ["agenda.pins.list", { customer_id: other }],
      ["agenda.tasks.update", { id, interpret: true }],
      ["agenda.tasks.dependency", { task_id: id, depends_on_id: id }],
      ["agenda.categories.update", { id, parent_category_id: id }],
      ["agenda.tasks.complete_tree", { id, confirm_all: false }],
    ] as [string, Obj][]
  ) {
    eq(
      (await executeAgendaOperation(x.deps, user, operation, args)).status,
      400,
    );
  }
  eq(x.calls.length, 0);
  const update = buildAgendaRequest(x.deps, user, "agenda.tasks.update", {
    id,
    title: "Title",
  });
  assert(update);
  eq(JSON.parse(String(update.init.body)).interpret, false);
  const interpret = buildAgendaRequest(x.deps, user, "agenda.tasks.interpret", {
    id,
    title: "Title",
  });
  assert(interpret);
  eq(JSON.parse(String(interpret.init.body)).interpret, true);
});
Deno.test("Agenda overview and returned mutation resources remain scoped and real backend partial warnings survive", async () => {
  const overview = {
    tasks: [],
    suggestions: [],
    attention: [],
    dependencies: [],
    companies: [],
    categories: [],
    delegations: [],
    participants: [],
    externalInvitations: [],
    collaborators: [],
    receivedDelegations: [],
    email: "customer@example.test",
    customer_id: tenant,
    display_name: "Customer",
  };
  const good = h(overview);
  eq(
    (await executeAgendaOperation(good.deps, user, "agenda.overview", {}))
      .status,
    200,
  );
  const wrong = h({ ...overview, customer_id: other });
  eq(
    (await executeAgendaOperation(wrong.deps, user, "agenda.overview", {}))
      .status,
    502,
  );
  const resourceWrong = h({ ok: true, category: { id: other } });
  eq(
    (await executeAgendaOperation(
      resourceWrong.deps,
      user,
      "agenda.categories.update",
      { id, name: "Updated" },
    )).status,
    502,
  );
  const partial = h({
    ok: true,
    id,
    warning: "Task saved but idempotency record could not be stored",
  });
  const saved = await executeAgendaOperation(
    partial.deps,
    user,
    "agenda.tasks.create",
    { title: "A task" },
  );
  eq(
    (await saved.json()).warning,
    "Task saved but idempotency record could not be stored",
  );
});
Deno.test("network loss and rejected backends never report completed external work or disclose secrets", async () => {
  const x = h();
  x.deps.fetch = (() => {
    throw Error(service);
  }) as typeof fetch;
  const unknown = await executeAgendaOperation(
    x.deps,
    user,
    "agenda.delegation.create",
    { task_id: id, email: "recipient@example.test" },
  );
  const failed = await unknown.json();
  eq(failed.executed, null);
  eq(failed.reconciliation_required, true);
  assert(!JSON.stringify(failed).includes(service));
  const backend = h({ error: service, code: "invitation_send_failed" }, 503);
  const rejected = await executeAgendaOperation(
    backend.deps,
    user,
    "agenda.delegation.create",
    { task_id: id, email: "recipient@example.test" },
  );
  eq(rejected.status, 503);
  assert(!(await rejected.text()).includes(service));
});
