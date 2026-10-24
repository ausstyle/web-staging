import assert from "node:assert/strict";
import {
  resolveTaskCancellationCertification,
  taskCancellationContractSha256,
} from "./task_cancellation_certification.ts";
import {
  buildCustomerMutationReceiptRequest,
  customerMutationContracts,
} from "./customer_mutations.ts";
const c = customerMutationContracts["tasks.update"];
const readiness = "10000000-0000-4000-8000-000000000001",
  customer = "20000000-0000-4000-8000-000000000001",
  fact = "30000000-0000-4000-8000-000000000001",
  deployment = "zmqlyygzqoidkcwdysok_6e50ff35-5878-42e2-982c-c205df6cac2e_61";
const args = {
  id: fact,
  status: "cancelled",
  idempotency_key: "task_cancel_cert_12345678901234567890123456789012:one",
};
const entry = {
  operation: "tasks.update",
  handler: c.handler,
  permission_scope: c.permission_scope,
  is_mutation: true,
  input_schema: c.input_schema,
  output_schema: c.output_schema,
  api_exposed: true,
  ai_exposed: true,
  verified: false,
  error_contract: { contract_sha256: taskCancellationContractSha256 },
};
function fixture(
  payload: unknown = {
    ok: true,
    readiness_id: readiness,
    customer_id: customer,
    expires_at: new Date(Date.now() + 60000).toISOString(),
  },
) {
  const calls: any[] = [];
  const input = {
    base: "https://zmqlyygzqoidkcwdysok.supabase.co",
    anon: "public.fixture",
    token: "normal.fixture.jwt",
    readinessId: readiness,
    deploymentId: deployment,
    entry,
    args,
    customerId: customer,
    request: (async (url, init) => {
      calls.push({ url, init });
      return Response.json(payload);
    }) as typeof fetch,
  };
  return { calls, input };
}
Deno.test("private readiness sends the same genuine customer bearer to one fixed resolver and validates the compiled contract digest", async () => {
  const x = fixture(),
    result = await resolveTaskCancellationCertification(x.input);
  assert.equal(result.ok, true);
  assert.equal(x.calls.length, 1);
  assert.equal(
    x.calls[0].url,
    "https://zmqlyygzqoidkcwdysok.supabase.co/rest/v1/rpc/sandy_api_task_cancel_private_readiness",
  );
  assert.equal(
    new Headers(x.calls[0].init.headers).get("authorization"),
    "Bearer normal.fixture.jwt",
  );
  assert.deepEqual(JSON.parse(x.calls[0].init.body), {
    p_artifact_id: readiness,
    p_api_deployment_id: deployment,
    p_contract_sha256: taskCancellationContractSha256,
    p_task_id: fact,
    p_idempotency_key: args.idempotency_key,
  });
});
Deno.test("private readiness is not a general execution, arbitrary-origin or registry-flag override", async () => {
  for (
    const patch of [
      { base: "https://attacker.invalid" },
      { deploymentId: "unknown" },
      { readinessId: "bad" },
      { entry: { ...entry, api_exposed: false } },
      { entry: { ...entry, verified: true } },
      { entry: { ...entry, operation: "github.commit" } },
      { entry: { ...entry, input_schema: { type: "object" } } },
      { args: { ...args, title: "not permitted" } },
      { args: { ...args, status: "completed" } },
      { args: { ...args, customer_id: customer } },
    ]
  ) {
    const x = fixture(),
      result = await resolveTaskCancellationCertification({
        ...x.input,
        ...patch,
      });
    assert.equal(result.ok, false);
    assert.equal(x.calls.length, 0);
  }
});
Deno.test("expired, denied, wrong-customer and wrong-artifact replies cannot enable a correction", async () => {
  for (
    const payload of [{
      ok: false,
      error: "private_readiness_denied",
      http_status: 403,
    }, {
      ok: true,
      readiness_id: fact,
      customer_id: customer,
      expires_at: new Date(Date.now() + 60000).toISOString(),
    }, {
      ok: true,
      readiness_id: readiness,
      customer_id: fact,
      expires_at: new Date(Date.now() + 60000).toISOString(),
    }, {
      ok: true,
      readiness_id: readiness,
      customer_id: customer,
      expires_at: "2020-01-01T00:00:00Z",
    }]
  ) {
    const x = fixture(payload);
    assert.equal(
      (await resolveTaskCancellationCertification(x.input)).ok,
      false,
    );
    assert.equal(x.calls.length, 1);
  }
});
Deno.test("readiness resolver transport and response-size failures fail closed without raw errors or automatic retries", async () => {
  for (
    const response of [() => {
      throw Error("private credential detail");
    }, () => new Response("x".repeat(17000))]
  ) {
    const x = fixture();
    let calls = 0;
    x.input.request = (async () => {
      calls++;
      return response();
    }) as typeof fetch;
    const result = await resolveTaskCancellationCertification(x.input);
    assert.equal(result.ok, false);
    assert.equal(calls, 1);
    assert.equal(JSON.stringify(result).includes("credential detail"), false);
  }
});

Deno.test("the existing mutation transport forwards readiness only for exact cancellation and genuine customer bearer", () => {
  const deps = {
    base: "https://zmqlyygzqoidkcwdysok.supabase.co",
    anon: "fixture.public",
    memoryCertification: { id: readiness, apiDeploymentId: deployment },
  };
  const r = buildCustomerMutationReceiptRequest(
    deps,
    "normal.fixture.jwt",
    "tasks.update",
    args,
  );
  assert.ok(r);
  assert.equal(
    new Headers(r.init.headers).get("authorization"),
    "Bearer normal.fixture.jwt",
  );
  assert.equal(
    new Headers(r.init.headers).get("x-sandy-certification-id"),
    readiness,
  );
  assert.deepEqual(JSON.parse(String(r.init.body)).p_arguments, {
    id: fact,
    status: "cancelled",
  });
  for (
    const a of [{ ...args, status: "completed" }, {
      ...args,
      title: "unexpected",
    }]
  ) {
    assert.equal(
      buildCustomerMutationReceiptRequest(
        deps,
        "normal.fixture.jwt",
        "tasks.update",
        a,
      ),
      null,
    );
  }
  assert.equal(
    buildCustomerMutationReceiptRequest(
      deps,
      "sandyop_fixture",
      "tasks.update",
      args,
    ),
    null,
  );
});
