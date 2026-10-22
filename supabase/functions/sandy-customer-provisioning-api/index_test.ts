import { strict as assert } from "node:assert";
import { createOnboardingHandler } from "./index.ts";
import { onboardingContractMatches, onboardingOperations } from "./gateway.ts";
const actor = "10000000-0000-4000-8000-000000000001",
  customer = "10000000-0000-4000-8000-000000000002",
  rid = "10000000-0000-4000-8000-000000000003";
const token = "synthetic.normal-authenticated-session";
const goodUser = {
  id: actor,
  role: "authenticated",
  email: "fixture@example.invalid",
  email_confirmed_at: "2026-10-21T00:00:00Z",
  is_anonymous: false,
  app_metadata: {},
};
const goodResult = {
  ok: true,
  contract_version: "1.0.0",
  executed: true,
  request_state: "succeeded",
  request_id: rid,
  reconciliation_required: false,
  customer_id: customer,
  created: true,
  reused: false,
  phase: "verified",
  version: 1,
  display_name: "fixture",
  organisation_name: null,
  channels: [{ channel: "email", subject: goodUser.email, verified: true }],
  permissions_source: "existing_verified_portal_and_channel_grants",
  memory_customer_id: customer,
  automatic_provisioning: false,
};
function harness(user: unknown = goodUser, result: unknown = goodResult) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetcher = (async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = String(input);
    calls.push({ url, init });
    return Response.json(url.endsWith("/auth/v1/user") ? user : result);
  }) as typeof fetch;
  const handler = createOnboardingHandler({
    base: "https://zmqlyygzqoidkcwdysok.supabase.co",
    anon: "synthetic-anon",
    fetch: fetcher,
  });
  const request = (patch: Record<string, unknown> = {}) =>
    handler(
      new Request(
        "https://project.invalid/functions/v1/sandy-customer-provisioning-api",
        {
          method: "POST",
          headers: { authorization: "Bearer " + token },
          body: JSON.stringify({
            operation: "customer.onboarding.ensure",
            arguments: {},
            request_id: rid,
            channel: "mcp",
            ...patch,
          }),
        },
      ),
    );
  return { calls, handler, request };
}
Deno.test("normal verified customer executes only fixed user-scoped RPC with stable request id", async () => {
  const h = harness(), r = await h.request();
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), goodResult);
  assert.equal(h.calls.length, 2);
  const rpc = h.calls[1];
  assert.ok(rpc.url.endsWith("/rpc/sandy_customer_onboarding_execute"));
  assert.equal(
    new Headers(rpc.init.headers).get("authorization"),
    "Bearer " + token,
  );
  assert.equal(new Headers(rpc.init.headers).get("apikey"), "synthetic-anon");
  assert.deepEqual(JSON.parse(String(rpc.init.body)), {
    p_operation: "customer.onboarding.ensure",
    p_arguments: {},
    p_request_id: rid,
  });
  assert.equal(rpc.init.redirect, "error");
});
Deno.test("unverified, anonymous, machine and administrative identities never reach customer RPC", async () => {
  for (
    const patch of [
      { email_confirmed_at: null },
      { is_anonymous: true },
      { role: "service_role" },
      { app_metadata: { sandy_engineering_test: true } },
      { id: "invalid" },
    ]
  ) {
    const h = harness({ ...goodUser, ...patch });
    assert.equal((await h.request()).status, 403);
    assert.equal(h.calls.length, 1);
  }
});
Deno.test("caller tenant, unsupported operations, unexpected envelopes and invalid concurrency are denied before authentication", async () => {
  for (
    const patch of [
      { arguments: { customer_id: customer } },
      { operation: "supabase.projects.delete" },
      { provider_url: "https://untrusted.invalid" },
      {
        operation: "customer.onboarding.update",
        arguments: { display_name: "x" },
      },
      { request_id: "invalid" },
      { arguments: { display_name: "" } },
      { channel: "admin" },
      { arguments: [] },
    ]
  ) {
    const h = harness();
    assert.equal((await h.request(patch)).status, 400);
    assert.equal(h.calls.length, 0);
  }
});
Deno.test("known SQL denials preserve exact authorization and concurrency status", async () => {
  for (
    const [error, status] of [
      ["customer_access_revoked", 403],
      ["identity_link_conflict", 409],
      ["onboarding_version_conflict", 409],
      ["onboarding_rate_limit", 429],
    ] as const
  ) {
    const h = harness(goodUser, { ok: false, error, http_status: status }),
      r = await h.request();
    assert.equal(r.status, status);
    assert.deepEqual(await r.json(), { ok: false, error, executed: false });
  }
});
Deno.test("incomplete success payload is an unknown outcome rather than misleading success or safe retry", async () => {
  const h = harness(goodUser, { ok: true, customer_id: customer }),
    r = await h.request();
  assert.equal(r.status, 503);
  const body = await r.json();
  assert.equal(body.executed, null);
  assert.equal(body.automatic_retry, false);
  assert.equal(body.request_id, rid);
  assert.equal(body.reconciliation_required, true);
});
Deno.test("database transport failure never leaks provider errors or claims no execution", async () => {
  let calls = 0;
  const h = createOnboardingHandler({
    base: "https://zmqlyygzqoidkcwdysok.supabase.co",
    anon: "synthetic-anon",
    fetch: (async () => {
      if (calls++ === 0) return Response.json(goodUser);
      throw Error("private-provider-details");
    }) as typeof fetch,
  });
  const r = await h(
    new Request("https://project.invalid", {
      method: "POST",
      headers: { authorization: "Bearer " + token },
      body: JSON.stringify({
        operation: "customer.onboarding.ensure",
        arguments: {},
        request_id: rid,
      }),
    }),
  );
  assert.equal(r.status, 503);
  const body = await r.json();
  assert.equal(body.executed, null);
  assert.equal(
    JSON.stringify(body).includes("private-provider-details"),
    false,
  );
});
Deno.test("catalogue schema, hash and authorization flags must match installed handlers", () => {
  for (const contract of Object.values(onboardingOperations)) {
    const row = {
      ...contract,
      error_contract: {
        contract_sha256: contract.contract_sha256,
        requires_real_user_session: true,
        api_key_delegable: false,
        requires_approval: false,
      },
    };
    assert.equal(onboardingContractMatches(contract.operation, row), true);
    assert.equal(
      onboardingContractMatches(contract.operation, {
        ...row,
        input_schema: { type: "object" },
      }),
      false,
    );
    assert.equal(
      onboardingContractMatches(contract.operation, {
        ...row,
        error_contract: { ...row.error_contract, api_key_delegable: true },
      }),
      false,
    );
  }
});

Deno.test("a different completed request receipt is an unknown outcome, never a substituted success", async () => {
  const h = harness(goodUser, { ...goodResult, request_id: customer }),
    r = await h.request();
  assert.equal(r.status, 503);
  const value = await r.json();
  assert.equal(value.executed, null);
  assert.equal(value.request_id, rid);
  assert.equal(value.automatic_retry, false);
});
Deno.test("failed transactional job keeps its real job identifier and explicit denial through the handler", async () => {
  const h = harness(goodUser, {
    ok: false,
    error: "provisioning_transaction_failed",
    http_status: 503,
    executed: false,
    automatic_retry: false,
    request_id: rid,
    job_id: customer,
  });
  const r = await h.request();
  assert.equal(r.status, 503);
  assert.deepEqual(await r.json(), {
    ok: false,
    error: "provisioning_transaction_failed",
    executed: false,
    automatic_retry: false,
    request_id: rid,
    job_id: customer,
  });
});
