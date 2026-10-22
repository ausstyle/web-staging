import assert from "node:assert/strict";
import { createCredentialResolver } from "./gateway_credentials.ts";
import { argumentDigest } from "../_shared/sandy_api_protocol.ts";

const job = "10000000-0000-4000-8000-000000000001";
const lease = "10000000-0000-4000-8000-000000000002";
const worker = "10000000-0000-4000-8000-000000000003";
const actor = "10000000-0000-4000-8000-000000000004";
const internal = (body: unknown, bearer = "service", key?: string) => new Request(
  "https://project.supabase.co/functions/v1/sandy-operation-api/v1/internal/execute",
  {
    method: "POST",
    headers: {
      authorization: `Bearer ${bearer}`,
      ...(key === undefined ? {} : { "x-sandy-api-key": key }),
    },
    body: JSON.stringify(body),
  },
);
Deno.test("worker identity is resolved only from a one-use DB lease, never HTTP actor or arguments", async () => {
  let calls = 0;
  const args = { limit: 3 };
  const resolve = createCredentialResolver({
    rpc(name, params) {
      calls++;
      assert.equal(name, "sandy_orch_resolve_dispatch");
      assert.deepEqual(params, { p_job_id: job, p_lease_token: lease, p_worker_id: worker });
      return Promise.resolve({
        data: {
          ok: true, job_id: job, principal_id: actor, tenant_id: null,
          operation: "deployment.jobs.list", arguments: args,
          input_sha256: "a".repeat(64), original_channel: "mcp",
          registry_contract: { operation: "deployment.jobs.list", is_mutation: false },
          dispatch_id: worker, attempt: 1,
          lease_until: new Date(Date.now() + 30000).toISOString(),
        }, error: null,
      });
    },
  }, "service", "anon");
  const value = await resolve(internal({ job_id: job, lease_token: lease, worker_id: worker }), "service");
  assert.ok(value && "kind" in value);
  if (!value || !("kind" in value)) return;
  assert.equal(value.principalId, actor);
  assert.equal(value.kind, "job_lease");
  assert.deepEqual(value.allowedOperations, ["deployment.jobs.list"]);
  assert.deepEqual(value.boundExecution?.arguments, args);
  assert.equal(calls, 1);
  assert.equal("userToken" in value, false);
  for (const body of [
    { job_id: job, lease_token: lease, worker_id: worker, actor_id: actor },
    { job_id: job, lease_token: lease, worker_id: worker, arguments: {} },
    { job_id: job, lease_token: "expired", worker_id: worker },
  ]) {
    assert.deepEqual(await resolve(internal(body), "service"), { status: 400, error: "invalid_job_lease_request" });
  }
  assert.equal(calls, 1);
});
Deno.test("internal service bearer alone is insufficient and scoped keys cannot impersonate workers", async () => {
  let calls = 0;
  const resolve = createCredentialResolver({ rpc() { calls++; return Promise.resolve({ data: null, error: null }); } }, "service", "anon");
  for (const request of [internal({}, "owner"), internal({}, "service", "opaque")]) {
    const token = request.headers.get("authorization")!.slice(7);
    assert.deepEqual(await resolve(request, token), { status: 403, error: "internal_worker_authentication_required" });
  }
  assert.equal(calls, 0);
  assert.deepEqual(await resolve(internal({}), "service"), { status: 400, error: "invalid_job_lease_request" });
  assert.equal(calls, 0);
});
Deno.test("lease refusals and lost/malformed DB replies never produce delegated authority", async () => {
  const digest = await argumentDigest({});
  for (const response of [
    { ok: false, error: "dispatch_already_started", http_status: 409 },
    { ok: false, error: "database_error_with_private_details", http_status: 500 },
    { ok: true, principal_id: actor, operation: "system.registry.summary", arguments: {}, input_sha256: digest },
  ]) {
    const resolve = createCredentialResolver({ rpc() { return Promise.resolve({ data: response, error: null }); } }, "service", "anon");
    const value = await resolve(internal({ job_id: job, lease_token: lease, worker_id: worker }), "service");
    assert.ok(value && "error" in value);
    assert.equal(JSON.stringify(value).includes("private_details"), false);
    if (response.error === "dispatch_already_started") assert.deepEqual(value, { status: 409, error: "dispatch_already_started" });
  }
  const lost = createCredentialResolver({ rpc() { throw Error("private database error"); } }, "service", "anon");
  assert.deepEqual(await lost(internal({ job_id: job, lease_token: lease, worker_id: worker }), "service"), { status: 503, error: "job_dispatch_authorisation_unavailable" });
});
Deno.test("normal sessions remain normal and key transport cannot use a user or service bearer", async () => {
  let calls = 0;
  const resolve = createCredentialResolver({ rpc() { calls++; throw Error("not reached"); } }, "service", "anon");
  const path = "https://project.supabase.co/functions/v1/sandy-operation-api";
  assert.equal(await resolve(new Request(path, { headers: { authorization: "Bearer user" } }), "user"), null);
  for (const bearer of ["user", "service"]) {
    assert.deepEqual(await resolve(new Request(path, { headers: { authorization: `Bearer ${bearer}`, "x-sandy-api-key": "secret" } }), bearer), { status: 401, error: "api_key_transport_requires_anon_bearer" });
  }
  assert.equal(calls, 0);
});
