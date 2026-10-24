import assert from "node:assert/strict";
import {
  buildCustomerMutationReceiptRequest,
  customerMutationContracts,
  customerMutationOperations,
} from "./customer_mutations.ts";
import {
  customerMutationContractShas,
  literalTaskTitle,
  resolveCustomerMutationCertification,
} from "./customer_mutation_certification.ts";
const id = "10000000-0000-4000-8000-000000000001",
  customer = "20000000-0000-4000-8000-000000000001",
  readiness = "30000000-0000-4000-8000-000000000001",
  deployment = "zmqlyygzqoidkcwdysok_6e50ff35-5878-42e2-982c-c205df6cac2e_63",
  prefix = "customer_mutation_cert_12345678901234567890123456789012:";
function args(op: string): Record<string, unknown> {
  const a: Record<string, unknown> = {
    idempotency_key: prefix + op.replaceAll(".", "_"),
  };
  if (!op.endsWith(".create")) a.id = id;
  if (op === "tasks.create") a.title = '"Isolated literal task"';
  if (op === "tasks.update") a.priority = "high";
  if (op === "calendar.create") {
    Object.assign(a, {
      title: "Isolated local event",
      starts_at: "2026-10-24T10:00:00Z",
      ends_at: "2026-10-24T10:30:00Z",
    });
  }
  if (op === "calendar.update") a.location = null;
  if (op === "files.rename") a.name = "Isolated metadata file";
  return a;
}
function fixture(op: typeof customerMutationOperations[number]) {
  const calls: { url: string; init: RequestInit }[] = [];
  return {
    calls,
    input: {
      base: "https://zmqlyygzqoidkcwdysok.supabase.co",
      anon: "public.fixture",
      token: "normal.customer.jwt",
      readinessId: readiness,
      deploymentId: deployment,
      customerId: customer,
      args: args(op),
      entry: {
        operation: op,
        ...customerMutationContracts[op],
        api_exposed: true,
        ai_exposed: true,
        verified: false,
      },
      request: (async (url, init) => {
        calls.push({ url: String(url), init: init! });
        return Response.json({
          ok: true,
          readiness_id: readiness,
          customer_id: customer,
          operation: op,
          expires_at: new Date(Date.now() + 60000).toISOString(),
        });
      }) as typeof fetch,
    },
  };
}
Deno.test("all ten existing typed operation classes use one fixed readiness RPC and real bearer, without registry growth", async () => {
  assert.equal(customerMutationOperations.length, 10);
  for (const op of customerMutationOperations) {
    const f = fixture(op),
      r = await resolveCustomerMutationCertification(f.input);
    assert.equal(r.ok, true, op + JSON.stringify(r));
    assert.equal(f.calls.length, 1);
    assert.equal(
      f.calls[0].url,
      "https://zmqlyygzqoidkcwdysok.supabase.co/rest/v1/rpc/sandy_api_customer_mutation_private_readiness",
    );
    assert.equal(
      new Headers(f.calls[0].init.headers).get("authorization"),
      "Bearer normal.customer.jwt",
    );
    const body = JSON.parse(String(f.calls[0].init.body));
    assert.equal(body.p_operation, op);
    assert.equal(body.p_contract_sha256, customerMutationContractShas[op]);
    assert.equal(body.p_arguments.idempotency_key, undefined);
  }
});
Deno.test("arbitrary providers, redirects, changed contracts, forged fields and nonliteral task producers are denied before RPC", async () => {
  const f = fixture("tasks.create");
  for (
    const patch of [
      { base: "https://attacker.invalid" },
      { entry: { ...f.input.entry, operation: "github.commit" } },
      { entry: { ...f.input.entry, verified: true } },
      { entry: { ...f.input.entry, input_schema: { type: "object" } } },
      { args: { ...f.input.args, title: "Nonliteral model work" } },
      { args: { ...f.input.args, customer_id: customer } },
      { args: { ...f.input.args, source_kind: "fixture" } },
    ]
  ) {
    assert.equal(
      (await resolveCustomerMutationCertification({ ...f.input, ...patch })).ok,
      false,
    );
    assert.equal(f.calls.length, 0);
  }
});
Deno.test("existing straight/curly literal branch is recognized without claiming general model analysis", () => {
  for (const title of ['"Literal task"', "“Literal task”"]) {
    assert.equal(literalTaskTitle(title), true);
  }
  for (const title of ["Unquoted", '"mismatch”', null, '""']) {
    assert.equal(literalTaskTitle(title), false);
  }
});
Deno.test("the one original receipt transport binds QA metadata to the exact operation", async () => {
  for (const op of customerMutationOperations) {
    const f = fixture(op),
      r = await resolveCustomerMutationCertification(f.input);
    assert.equal(r.ok, true, op + JSON.stringify(r));
    if (!r.ok) throw Error("expected");
    const deps = {
      base: f.input.base,
      anon: f.input.anon,
      memoryCertification: r.value,
    };
    const request = buildCustomerMutationReceiptRequest(
      deps,
      f.input.token,
      op,
      args(op),
    );
    assert.ok(request);
    assert.equal(
      new Headers(request.init.headers).get("x-sandy-certification-id"),
      readiness,
    );
    assert.equal(JSON.stringify(request.init.body).includes("profile"), false);
    const other = op === "tasks.update" ? "tasks.complete" : "tasks.update";
    assert.equal(
      buildCustomerMutationReceiptRequest(
        deps,
        f.input.token,
        other,
        args(other),
      ),
      null,
    );
  }
});
Deno.test("denied, expired, foreign or oversized readiness responses never create an execution claim", async () => {
  for (
    const response of [
      Response.json({
        ok: false,
        error: "private_readiness_budget_exhausted",
        http_status: 429,
      }),
      Response.json({
        ok: true,
        readiness_id: readiness,
        customer_id: id,
        operation: "tasks.update",
        expires_at: new Date(Date.now() + 60000).toISOString(),
      }),
      Response.json({
        ok: true,
        readiness_id: readiness,
        customer_id: customer,
        operation: "tasks.update",
        expires_at: "2020-01-01",
      }),
      new Response("x".repeat(17000)),
    ]
  ) {
    const f = fixture("tasks.update");
    f.input.request = (async () => response) as typeof fetch;
    const r = await resolveCustomerMutationCertification(f.input);
    assert.equal(r.ok, false);
    if (!r.ok && r.error === "private_readiness_budget_exhausted") {
      assert.equal(r.status, 429);
    }
  }
});
