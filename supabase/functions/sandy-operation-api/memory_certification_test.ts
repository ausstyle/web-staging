import assert from "node:assert/strict";
import { resolveMemoryCertification } from "./memory_certification.ts";
import {
  buildCustomerMutationReceiptRequest,
  memoryCorrectionContractSha256,
  memoryCorrectionMutationContract as c,
} from "./customer_mutations.ts";
const readiness = "10000000-0000-4000-8000-000000000001",
  customer = "20000000-0000-4000-8000-000000000001",
  fact = "30000000-0000-4000-8000-000000000001",
  deployment = "zmqlyygzqoidkcwdysok_6e50ff35-5878-42e2-982c-c205df6cac2e_61";
const args = {
  id: fact,
  confirm: true,
  new_value: "fixture correction",
  idempotency_key: "memory_cert_12345678901234567890123456789012:one",
};
const entry = {
  operation: "memory.fact_correct",
  handler: c.handler,
  permission_scope: c.permission_scope,
  is_mutation: true,
  input_schema: c.input_schema,
  output_schema: c.output_schema,
  api_exposed: false,
  ai_exposed: false,
  verified: false,
  error_contract: { contract_sha256: memoryCorrectionContractSha256 },
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
  const x = fixture(), result = await resolveMemoryCertification(x.input);
  assert.equal(result.ok, true);
  assert.equal(x.calls.length, 1);
  assert.equal(
    x.calls[0].url,
    "https://zmqlyygzqoidkcwdysok.supabase.co/rest/v1/rpc/sandy_api_memory_private_readiness",
  );
  assert.equal(
    new Headers(x.calls[0].init.headers).get("authorization"),
    "Bearer normal.fixture.jwt",
  );
  assert.deepEqual(JSON.parse(x.calls[0].init.body), {
    p_artifact_id: readiness,
    p_api_deployment_id: deployment,
    p_contract_sha256: memoryCorrectionContractSha256,
    p_fact_id: fact,
    p_idempotency_key: args.idempotency_key,
  });
});
Deno.test("private readiness is not a general execution, arbitrary-origin or registry-flag override", async () => {
  for (
    const patch of [
      { base: "https://attacker.invalid" },
      { deploymentId: "unknown" },
      { readinessId: "bad" },
      { entry: { ...entry, api_exposed: true } },
      { entry: { ...entry, verified: true } },
      { entry: { ...entry, operation: "github.commit" } },
      { entry: { ...entry, input_schema: { type: "object" } } },
      {
        entry: {
          ...entry,
          error_contract: { contract_sha256: "a".repeat(64) },
        },
      },
    ]
  ) {
    const x = fixture(),
      result = await resolveMemoryCertification({ ...x.input, ...patch });
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
    assert.equal((await resolveMemoryCertification(x.input)).ok, false);
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
    const result = await resolveMemoryCertification(x.input);
    assert.equal(result.ok, false);
    assert.equal(calls, 1);
    assert.equal(JSON.stringify(result).includes("credential detail"), false);
  }
});
Deno.test("only the fixed correction RPC receives protected readiness metadata, never arguments or identity substitution", () => {
  const request = buildCustomerMutationReceiptRequest(
    {
      base: "https://zmqlyygzqoidkcwdysok.supabase.co",
      anon: "public.fixture",
      memoryCertification: { id: readiness, apiDeploymentId: deployment },
    },
    "normal.fixture.jwt",
    "memory.fact_correct",
    args,
  );
  assert.ok(request);
  const headers = new Headers(request.init.headers);
  assert.equal(headers.get("authorization"), "Bearer normal.fixture.jwt");
  assert.equal(headers.get("x-sandy-certification-id"), readiness);
  assert.equal(headers.get("x-sandy-api-deployment-id"), deployment);
  assert.equal(
    JSON.stringify(JSON.parse(String(request.init.body)).p_arguments).includes(
      readiness,
    ),
    false,
  );
});
