import assert from "node:assert/strict";
import { executeMemoryOperation } from "./memory_operations.ts";
import type { CustomerServiceDependencies } from "./customer_services.ts";
const actor = "10000000-0000-4000-8000-000000000001",
  customer = "20000000-0000-4000-8000-000000000001",
  original = "30000000-0000-4000-8000-000000000001",
  corrected = "40000000-0000-4000-8000-000000000001",
  rejection = "50000000-0000-4000-8000-000000000001",
  mutation = "60000000-0000-4000-8000-000000000001";
const args = {
  id: original,
  confirm: true,
  new_value: "corrected fixture value",
  idempotency_key: "memory-fixture-correction-0001",
};
const receipt = (patch: Record<string, unknown> = {}) => ({
  ok: true,
  contract_version: "1.0.0",
  operation: "memory.fact_correct",
  mutation_id: mutation,
  reused: false,
  item: {
    id: corrected,
    customer_id: customer,
    original_fact_id: original,
    status: "active",
    original_status: "superseded",
    fact_value: args.new_value,
    supersedes_fact_id: original,
    rejection_id: rejection,
    rejected_value: "old fixture value",
    corrected_value: args.new_value,
    ...patch,
  },
});
function fixture(payload: unknown = receipt(), fail = false) {
  const calls: any[] = [];
  const deps: CustomerServiceDependencies = {
    base: "https://project.supabase.co",
    anon: "public.anon",
    service: "private.service",
    principal: {
      id: actor,
      portalCustomerId: customer,
      agendaCustomerId: null,
      controllerOwner: false,
    },
    fetch: (async (url, init) => {
      calls.push({ url: String(url), init });
      if (fail) throw Error("private transport detail");
      return Response.json(payload);
    }) as typeof fetch,
  };
  return { deps, calls };
}
Deno.test("canonical correction reuses the actual-user fixed shared receipt transaction and verifies original action provenance", async () => {
  const x = fixture();
  const response = await executeMemoryOperation(
    x.deps,
    "normal.user.jwt",
    "memory.fact_correct",
    args,
  );
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), receipt());
  assert.equal(x.calls.length, 1);
  const call = x.calls[0];
  assert.equal(
    call.url,
    "https://project.supabase.co/rest/v1/rpc/sandy_api_customer_mutation",
  );
  assert.equal(
    new Headers(call.init.headers).get("authorization"),
    "Bearer normal.user.jwt",
  );
  assert.deepEqual(JSON.parse(call.init.body), {
    p_operation: "memory.fact_correct",
    p_arguments: { id: original, confirm: true, new_value: args.new_value },
    p_idempotency_key: args.idempotency_key,
  });
  assert.equal(call.init.redirect, "error");
});
Deno.test("correction requires confirmation and stable key; customer or provider overrides never dispatch", async () => {
  for (
    const invalid of [
      { ...args, confirm: false },
      { id: original, confirm: true, new_value: args.new_value },
      { ...args, customer_id: customer },
      { ...args, actor_id: actor },
      { ...args, new_value: " " },
    ]
  ) {
    const x = fixture();
    const response = await executeMemoryOperation(
      x.deps,
      "normal.user.jwt",
      "memory.fact_correct",
      invalid,
    );
    assert.equal(response.status, 400);
    assert.equal(x.calls.length, 0);
  }
});
Deno.test("Controller membership, Agenda membership or a service key cannot substitute for the private portal session", async () => {
  for (
    const token of [
      "private.service",
      "public.anon",
      "sandyop_" + "a".repeat(64),
      "",
    ]
  ) {
    const x = fixture();
    assert.notEqual(
      (await executeMemoryOperation(x.deps, token, "memory.fact_correct", args))
        .status,
      200,
    );
    assert.equal(x.calls.length, 0);
  }
  const x = fixture();
  x.deps.principal.portalCustomerId = null;
  x.deps.principal.agendaCustomerId = customer;
  x.deps.principal.controllerOwner = true;
  assert.equal(
    (await executeMemoryOperation(
      x.deps,
      "normal.user.jwt",
      "memory.fact_correct",
      args,
    )).status,
    403,
  );
  assert.equal(x.calls.length, 0);
});
Deno.test("foreign, stale or unsupported correction receipts are not returned as successful customer facts", async () => {
  for (
    const patch of [
      { customer_id: actor },
      { original_fact_id: actor },
      { corrected_value: "wrong value" },
      { original_status: "active" },
      { rejection_id: null },
      { supersedes_fact_id: actor },
    ]
  ) {
    const x = fixture(receipt(patch)),
      response = await executeMemoryOperation(
        x.deps,
        "normal.user.jwt",
        "memory.fact_correct",
        args,
      ),
      body = await response.json();
    assert.equal(response.status, 502);
    assert.equal(body.executed, null);
    assert.equal(body.reconciliation_required, true);
    assert.equal(body.automatic_retry, false);
    assert.equal(body.item, undefined);
  }
});
Deno.test("known wrong-target refusal remains404 with no misleading correction receipt", async () => {
  const x = fixture({
      ok: false,
      error: "customer_item_not_found",
      http_status: 404,
    }),
    response = await executeMemoryOperation(
      x.deps,
      "normal.user.jwt",
      "memory.fact_correct",
      args,
    );
  assert.equal(response.status, 404);
  assert.deepEqual(await response.json(), {
    ok: false,
    error: "customer_item_not_found",
    executed: false,
  });
});
Deno.test("rejection and unchanged-value replay need the corresponding actual status and rejection evidence", async () => {
  const rejected = receipt({
    id: original,
    status: "rejected",
    original_status: "rejected",
    fact_value: "old fixture value",
    supersedes_fact_id: null,
    corrected_value: null,
  });
  const x = fixture(rejected);
  assert.equal(
    (await executeMemoryOperation(
      x.deps,
      "normal.user.jwt",
      "memory.fact_correct",
      { ...args, new_value: null },
    )).status,
    200,
  );
  const unchanged = receipt({
    id: original,
    original_status: "active",
    supersedes_fact_id: null,
    rejection_id: null,
    rejected_value: null,
    corrected_value: null,
  });
  const y = fixture({ ...unchanged, reused: true });
  assert.equal(
    (await executeMemoryOperation(
      y.deps,
      "normal.user.jwt",
      "memory.fact_correct",
      args,
    )).status,
    200,
  );
});
Deno.test("lost write response is unknown, redacted and never retried by the adapter", async () => {
  const x = fixture(undefined, true),
    response = await executeMemoryOperation(
      x.deps,
      "normal.user.jwt",
      "memory.fact_correct",
      args,
    ),
    body = await response.json();
  assert.equal(response.status, 502);
  assert.equal(body.executed, null);
  assert.equal(body.reconciliation_required, true);
  assert.equal(body.automatic_retry, false);
  assert.equal(x.calls.length, 1);
  assert.equal(
    JSON.stringify(body).includes("private transport detail"),
    false,
  );
  assert.equal(JSON.stringify(body).includes("normal.user.jwt"), false);
});
