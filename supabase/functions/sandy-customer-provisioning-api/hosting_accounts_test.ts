import { strict as assert } from "node:assert";
import { createOnboardingHandler } from "./index.ts";
import contracts from "./hosting_accounts.json" with { type: "json" };
import { canonicalJson } from "../_shared/sandy_api_protocol.ts";
const rid = "10000000-0000-4000-8000-000000000001";
const token = "synthetic.normal-customer-session-token";
function harness(patch = {}) {
  const calls: { url: string; init: RequestInit }[] = [];
  const response = {
    ok: true,
    executed: true,
    contract_version: "1.0.0",
    request_state: "succeeded",
    reconciliation_required: false,
    operation: "hosting.accounts.create",
    request_id: rid,
    reused: false,
    result: {
      account_id: rid,
      requested_plan: "starter",
      state: "logical_only",
      version: 1,
      provider_resources_created: false,
      billing_activated: false,
    },
    ...patch,
  };
  const handler = createOnboardingHandler({
    base: "https://zmqlyygzqoidkcwdysok.supabase.co",
    anon: "synthetic-anon",
    fetch: (async (url, init = {}) => {
      calls.push({ url: String(url), init });
      return Response.json(
        String(url).endsWith("/auth/v1/user")
          ? {
            id: rid,
            role: "authenticated",
            email_confirmed_at: "2026-10-23T00:00:00Z",
            email: "fixture@example.invalid",
            is_anonymous: false,
          }
          : response,
      );
    }) as typeof fetch,
  });
  const request = (
    args: Record<string, unknown> = { plan: "starter", idempotency_key: rid },
  ) =>
    handler(
      new Request("https://local.invalid", {
        method: "POST",
        headers: { authorization: "Bearer " + token },
        body: JSON.stringify({
          operation: "hosting.accounts.create",
          arguments: args,
          request_id: rid,
        }),
      }),
    );
  return { calls, request };
}
Deno.test("hosting account uses existing verified user transport and fixed RPC", async () => {
  const h = harness();
  const r = await h.request();
  assert.equal(r.status, 200);
  assert.equal(h.calls.length, 2);
  assert.ok(h.calls[1].url.endsWith("/rpc/sandy_hosting_account_execute"));
  assert.equal(
    new Headers(h.calls[1].init.headers).get("authorization"),
    "Bearer " + token,
  );
  assert.equal(
    JSON.parse(String(h.calls[1].init.body)).p_arguments.idempotency_key,
    rid,
  );
});
Deno.test("caller tenant and invalid idempotency key never reach Auth or SQL", async () => {
  for (
    const args of [{ plan: "starter", idempotency_key: rid, tenant_id: rid }, {
      plan: "starter",
      idempotency_key: "bad",
    }]
  ) {
    const h = harness();
    assert.equal((await h.request(args)).status, 400);
    assert.equal(h.calls.length, 0);
  }
});
Deno.test("logical account must not claim billing or provider provisioning", async () => {
  const h = harness({
    result: {
      account_id: rid,
      requested_plan: "starter",
      state: "logical_only",
      version: 1,
      provider_resources_created: true,
      billing_activated: true,
    },
  });
  const r = await h.request();
  assert.equal(r.status, 503);
  assert.equal((await r.json()).reconciliation_required, true);
});
Deno.test("hosting contracts have canonical immutable digests", async () => {
  for (const contract of Object.values(contracts)) {
    const { contract_sha256, ...body } = contract;
    const actual = new Uint8Array(
      await crypto.subtle.digest(
        "SHA-256",
        new TextEncoder().encode(canonicalJson(body)),
      ),
    );
    assert.equal(
      [...actual].map((x) => x.toString(16).padStart(2, "0")).join(""),
      contract_sha256,
    );
  }
});
