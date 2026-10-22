import {
  buildMemoryOperationRequest,
  executeMemoryOperation,
  memoryContractMatches,
  memoryOperationContracts,
} from "./memory_operations.ts";
import { type CustomerServiceDependencies } from "./customer_services.ts";
type Obj = Record<string, unknown>;
const actor = "11111111-1111-4111-8111-111111111111",
  tenant = "22222222-2222-4222-8222-222222222222",
  id = "33333333-3333-4333-8333-333333333333",
  other = "44444444-4444-4444-8444-444444444444";
const user = "actual.user.jwt",
  service = "internal.service.jwt",
  anon = "public.anon.jwt";
function assert(v: unknown, message = "assertion failed"): asserts v {
  if (!v) throw Error(message);
}
function eq(a: unknown, b: unknown) {
  assert(JSON.stringify(a) === JSON.stringify(b));
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
      agendaCustomerId: null,
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
        [n, value],
      ) => [n, example(value as Obj, n)]),
    );
  }
  if (schema.type === "array") return [];
  if (schema.type === "boolean") return false;
  if (schema.type === "integer") return schema.minimum ?? 1;
  if (schema.format === "uuid") return id;
  if (schema.format === "date-time") return "2026-10-20T00:00:00Z";
  if (name === "timezone") return "Australia/Sydney";
  return "x".repeat(Math.max(Number(schema.minLength ?? 1), 1));
}
Deno.test("all21 remaining Memory branches are fixed typed mutations, including costly queries", () => {
  const x = h();
  eq(Object.keys(memoryOperationContracts).length, 21);
  for (const [operation, c] of Object.entries(memoryOperationContracts)) {
    const request = buildMemoryOperationRequest(
      x.deps,
      user,
      operation,
      example(c.input_schema),
    );
    assert(request, operation);
    const url = new URL(request.url);
    eq(url.origin, x.deps.base);
    eq(url.pathname, "/functions/v1/sandy-memory-centre");
    eq(url.searchParams.get("op"), c.action);
    eq(
      new Headers(request.init.headers).get("authorization"),
      `Bearer ${user}`,
    );
    eq(request.init.redirect, "error");
    eq(c.is_mutation, true);
    eq(c.permission_scope, "memory:write");
    assert(memoryContractMatches(operation, c));
    assert(!memoryContractMatches(operation, { ...c, is_mutation: false }));
  }
  for (
    const operation of [
      "memory.ask",
      "memory.search",
      "memory.biography",
      "memory.life_search",
      "memory.remember",
      "memory.get_to_know_question",
      "memory.enrich_question",
    ]
  ) eq(memoryOperationContracts[operation].consumes_model_resources, true);
});
Deno.test("Controller and Agenda identities confer no private memory access or service impersonation", async () => {
  const x = h();
  x.deps.principal = {
    id: actor,
    portalCustomerId: null,
    agendaCustomerId: tenant,
    controllerOwner: true,
  };
  eq(
    (await executeMemoryOperation(x.deps, user, "memory.biography", {})).status,
    403,
  );
  eq(x.calls.length, 0);
  for (const token of [service, anon, "sandyop_" + "a".repeat(64), ""]) {
    const y = h();
    eq(
      (await executeMemoryOperation(y.deps, token, "memory.biography", {}))
        .status,
      503,
    );
    eq(y.calls.length, 0);
  }
});
Deno.test("caller-selected identity/action, unconfirmed destructive intent and oversized inputs fail before execution", async () => {
  for (
    const [operation, args] of [
      ["memory.biography", { customer_id: other }],
      ["memory.search", { query: "a query", op: "forget" }],
      ["memory.forget", { id, confirm: false }],
      ["memory.fact_correct", { id, new_value: "corrected" }],
      ["memory.settings", {}],
      ["memory.remember", { text: "A note", request_id: "invalid" }],
      ["memory.ask", {
        query: "A valid question",
        history: Array.from(
          { length: 11 },
          () => ({ role: "user", content: "A turn" }),
        ),
      }],
    ] as [string, Obj][]
  ) {
    const x = h();
    eq(
      (await executeMemoryOperation(x.deps, user, operation, args)).status,
      400,
    );
    eq(x.calls.length, 0);
  }
});
Deno.test("generated biography citations, returned tenant markers and setting readbacks must be scoped", async () => {
  const good = h({
    ok: true,
    paragraphs: [{ text: "A supported fact.", source_ids: [id] }],
    sources: [{ id }],
  });
  eq(
    (await executeMemoryOperation(good.deps, user, "memory.biography", {}))
      .status,
    200,
  );
  const unsupported = h({
    ok: true,
    paragraphs: [{ text: "An unsupported fact.", source_ids: [other] }],
    sources: [{ id }],
  });
  eq(
    (await executeMemoryOperation(
      unsupported.deps,
      user,
      "memory.biography",
      {},
    )).status,
    502,
  );
  const foreign = h({ ok: true, matches: [{ id, owner_customer_id: other }] });
  eq(
    (await executeMemoryOperation(foreign.deps, user, "memory.search", {
      query: "a query",
    })).status,
    502,
  );
  const stale = h({
    ok: true,
    settings: {
      enabled: false,
      learning_enabled: false,
      proactive_enabled: false,
    },
  });
  eq(
    (await executeMemoryOperation(stale.deps, user, "memory.settings", {
      enabled: true,
    })).status,
    502,
  );
});
Deno.test("ask preserves actual task receipts without converting queued or model content into verification", async () => {
  const x = h({
    ok: true,
    answer: "Created a task.",
    sources: [],
    task: { id, created: true },
  });
  const response = await executeMemoryOperation(x.deps, user, "memory.ask", {
    query: "create a task called A task",
  });
  eq(response.status, 200);
  const body = await response.json();
  eq(body.task.created, true);
  assert(!Object.hasOwn(body, "verified"));
  const malformed = h({
    ok: true,
    answer: "Created a task.",
    sources: [],
    task: { id: "fake", created: true },
  });
  eq(
    (await executeMemoryOperation(malformed.deps, user, "memory.ask", {
      query: "a question",
    })).status,
    502,
  );
  const declined = h({ ok: true, confirmed: false });
  eq(
    (await executeMemoryOperation(declined.deps, user, "memory.life_file", {
      document_id: id,
      space_id: other,
    })).status,
    409,
  );
});
Deno.test("unknown outcomes, malformed envelopes and bounded streamed responses remain truthful and credential-free", async () => {
  const x = h();
  x.deps.fetch = (() => {
    throw Error(service);
  }) as typeof fetch;
  const unknown = await executeMemoryOperation(
    x.deps,
    user,
    "memory.remember",
    { text: "A personal note", request_id: id },
  );
  const receipt = await unknown.json();
  eq(receipt.executed, null);
  eq(receipt.reconciliation_required, true);
  assert(!JSON.stringify(receipt).includes(service));
  const rejected = h({ ok: false, error: service }, 503);
  const failure = await executeMemoryOperation(
    rejected.deps,
    user,
    "memory.biography",
    {},
  );
  eq(failure.status, 503);
  assert(!(await failure.text()).includes(service));
  const large = h();
  large.deps.fetch = (() =>
    Promise.resolve(
      new Response(
        JSON.stringify({
          ok: true,
          matches: [],
          extra: "x".repeat(4 * 1024 * 1024),
        }),
      ),
    )) as typeof fetch;
  eq(
    (await executeMemoryOperation(large.deps, user, "memory.search", {
      query: "a query",
    })).status,
    502,
  );
});
