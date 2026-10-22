import {
  buildCustomerKeyRequest,
  customerKeyContracts,
  type CustomerKeyDependencies,
  executeCustomerKeyOperation,
} from "./customer_keys.ts";
const actor = "11111111-1111-4111-8111-111111111111",
  tenant = "22222222-2222-4222-8222-222222222222",
  id = "33333333-3333-4333-8333-333333333333";
const user = "actual.user.jwt",
  service = "internal.service.jwt",
  anon = "public.anon.jwt",
  fakeKey = "sandyop_" + "a".repeat(64);
function assert(v: unknown): asserts v {
  if (!v) throw Error("assertion failed");
}
function eq(a: unknown, b: unknown) {
  assert(JSON.stringify(a) === JSON.stringify(b));
}
const record = {
  id,
  name: "Fixture key",
  prefix: fakeKey.slice(0, 16),
  scopes: ["tasks:read"],
  created_at: "2026-10-20T00:00:00Z",
  expires_at: null,
};
function h(payload: unknown = { ok: true }, status = 200) {
  const calls: { url: string; init: RequestInit }[] = [];
  const deps: CustomerKeyDependencies = {
    base: "https://project.supabase.co",
    anon,
    service,
    emailConfirmed: true,
    principal: {
      id: actor,
      agendaCustomerId: tenant,
      portalCustomerId: null,
      controllerOwner: false,
    },
    fetch: ((url: unknown, init: RequestInit) => {
      calls.push({ url: String(url), init });
      return Promise.resolve(Response.json(payload, { status }));
    }) as typeof fetch,
  };
  return { deps, calls };
}
Deno.test("customer key contracts fix legacy selectors and use actual confirmed customer sessions", () => {
  const x = h();
  eq(Object.keys(customerKeyContracts).length, 3);
  for (
    const [operation, args] of [["customer.keys.list", {}], [
      "customer.keys.create",
      { scopes: ["tasks:read"] },
    ], ["customer.keys.revoke", { id }]] as const
  ) {
    const request = buildCustomerKeyRequest(x.deps, user, operation, args);
    assert(request);
    eq(request.url, `${x.deps.base}/functions/v1/sandy-operations-api`);
    eq(
      JSON.parse(String(request.init.body)).operation,
      customerKeyContracts[operation].operation,
    );
    eq(
      new Headers(request.init.headers).get("authorization"),
      `Bearer ${user}`,
    );
  }
});
Deno.test("owner, unconfirmed session, existing key and service credentials cannot administer customer keys", async () => {
  for (
    const patch of [{ emailConfirmed: false }, {
      principal: {
        ...h().deps.principal,
        agendaCustomerId: null,
        controllerOwner: true,
      },
    }]
  ) {
    const x = h();
    Object.assign(x.deps, patch);
    eq(
      (await executeCustomerKeyOperation(
        x.deps,
        user,
        "customer.keys.list",
        {},
      )).status,
      403,
    );
    eq(x.calls.length, 0);
  }
  for (const token of [service, anon, fakeKey, ""]) {
    const x = h();
    eq(
      (await executeCustomerKeyOperation(
        x.deps,
        token,
        "customer.keys.list",
        {},
      )).status,
      503,
    );
    eq(x.calls.length, 0);
  }
  const x = h();
  for (
    const args of [
      { scopes: ["admin:all"] },
      { scopes: ["tasks:read", "tasks:read"] },
      { scopes: ["tasks:read"], customer_id: tenant },
      { scopes: ["tasks:read"], expires_at: "2020-01-01T00:00:00Z" },
    ]
  ) {
    eq(
      (await executeCustomerKeyOperation(
        x.deps,
        user,
        "customer.keys.create",
        args,
      )).status,
      400,
    );
  }
  eq(x.calls.length, 0);
});
Deno.test("key list projects only nonsecret fields and bounds its response", async () => {
  const x = h({
    ok: true,
    keys: Array.from(
      { length: 201 },
      () => ({
        ...record,
        key_hash: "do-not-return",
        raw_key: "never-return",
        customer_id: tenant,
      }),
    ),
  });
  const response = await executeCustomerKeyOperation(
    x.deps,
    user,
    "customer.keys.list",
    {},
  );
  eq(response.status, 200);
  const body = await response.json();
  eq(body.keys.length, 200);
  eq(body.response_items_truncated, true);
  assert(!JSON.stringify(body).includes("do-not-return"));
  assert(!JSON.stringify(body).includes("never-return"));
  assert(!Object.hasOwn(body.keys[0], "customer_id"));
});
Deno.test("one-time issuance validates key prefix, scopes and receipt without exposing stored hashes", async () => {
  const x = h({
    ok: true,
    key: fakeKey,
    record: { ...record, key_hash: "never" },
    warning: "Copy once",
  });
  const response = await executeCustomerKeyOperation(
    x.deps,
    user,
    "customer.keys.create",
    { name: record.name, scopes: record.scopes },
  );
  eq(response.status, 200);
  const body = await response.json();
  eq(body.key, fakeKey);
  eq(body.display_once, true);
  assert(!Object.hasOwn(body.record, "key_hash"));
  for (
    const wrong of [{ ...record, scopes: ["tasks:write"] }, {
      ...record,
      prefix: "sandyop_bbbbbbbb",
    }, { ...record, name: "Different name" }]
  ) {
    const bad = h({
      ok: true,
      key: fakeKey,
      record: wrong,
      warning: "Copy once",
    });
    eq(
      (await executeCustomerKeyOperation(
        bad.deps,
        user,
        "customer.keys.create",
        { name: record.name, scopes: record.scopes },
      )).status,
      502,
    );
  }
});
Deno.test("unknown issuance or revocation outcomes require reconciliation and never echo backend secrets", async () => {
  const x = h();
  x.deps.fetch = (() => {
    throw Error(service);
  }) as typeof fetch;
  const response = await executeCustomerKeyOperation(
    x.deps,
    user,
    "customer.keys.create",
    { scopes: ["tasks:read"] },
  );
  const body = await response.json();
  eq(body.executed, null);
  eq(body.reconciliation_required, true);
  assert(!JSON.stringify(body).includes(service));
  const rejected = h({ ok: false, error: service }, 503);
  const failed = await executeCustomerKeyOperation(
    rejected.deps,
    user,
    "customer.keys.revoke",
    { id },
  );
  eq(failed.status, 503);
  assert(!(await failed.text()).includes(service));
});
