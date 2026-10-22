import assert from "node:assert/strict";
import {
  admittedCustomerReads,
  governedCustomerRead,
} from "./customer_read_admission.ts";
import type { PolicyDb } from "./access_policy.ts";
const actor = "10000000-0000-4000-8000-000000000001",
  tenant = "10000000-0000-4000-8000-000000000002";
const admission = "10000000-0000-4000-8000-000000000003",
  grant = "10000000-0000-4000-8000-000000000004",
  request = "10000000-0000-4000-8000-000000000005";
function fixture(
  options: {
    refuse?: string;
    wrongActor?: boolean;
    lostFinish?: boolean;
    refuseConsume?: boolean;
  } = {},
) {
  const calls: {
    boundary: string;
    name: string;
    args: Record<string, unknown>;
  }[] = [];
  const session: PolicyDb = {
    rpc(name, args) {
      calls.push({ boundary: "normal_user", name, args });
      if (options.refuse) {
        return Promise.resolve({
          data: { ok: false, error: options.refuse, http_status: 403 },
          error: null,
        });
      }
      if (name === "sandy_api_admit_customer_read") {
        return Promise.resolve({
          data: {
            ok: true,
            allowed: true,
            reused: false,
            actor_id: options.wrongActor ? tenant : actor,
            tenant_id: tenant,
            admission_id: admission,
            grant_id: grant,
            scope_sha256: "c".repeat(64),
            expires_at: new Date(Date.now() + 60000).toISOString(),
            state: "admitted",
            executed: false,
          },
          error: null,
        });
      }
      return Promise.resolve({
        data: options.refuseConsume
          ? {
            ok: false,
            error: "customer_read_access_denied",
            http_status: 403,
          }
          : { ok: true, allowed: true, reused: false, admission_id: admission },
        error: null,
      });
    },
  };
  const service: PolicyDb = {
    rpc(name, args) {
      calls.push({ boundary: "service_settlement", name, args });
      return Promise.resolve({
        data: options.lostFinish ? null : {
          ok: true,
          admission_id: admission,
          state: args.p_outcome,
          reused: false,
        },
        error: options.lostFinish ? { private: "not logged" } : null,
      });
    },
  };
  let executions = 0;
  const run = (
    body: Record<string, unknown> = {
      ok: true,
      executed: true,
      result: { private: "own data" },
    },
    operation = "tasks.list",
  ) =>
    governedCustomerRead(
      service,
      session,
      actor,
      operation,
      {},
      request,
      "a".repeat(64),
      "mcp",
      () => {
        executions++;
        return Promise.resolve(Response.json(body));
      },
    );
  return { calls, run, executions: () => executions };
}
Deno.test("customer read uses real user boundary, one-use grant and the existing service-only digest settlement", async () => {
  const h = fixture();
  const response = await h.run();
  assert.equal(response.status, 200);
  assert.equal((await response.json()).admission_id, admission);
  assert.deepEqual(h.calls.map((x) => [x.boundary, x.name]), [
    ["normal_user", "sandy_api_admit_customer_read"],
    ["normal_user", "sandy_api_consume_customer_read"],
    ["service_settlement", "sandy_api_finish_execution"],
  ]);
  assert.equal(h.calls[2].args.p_outcome, "succeeded");
  assert.equal(JSON.stringify(h.calls).includes("own data"), false);
  assert.equal(Object.hasOwn(h.calls[0].args, "p_actor_id"), false);
  assert.equal(Object.hasOwn(h.calls[0].args, "p_tenant_id"), false);
});
Deno.test("customer admission refusal, changed principal and revoked consumption never dispatch", async () => {
  for (
    const options of [
      { refuse: "customer_read_access_denied" },
      { refuse: "admission_already_recorded" },
      { wrongActor: true },
      { refuseConsume: true },
    ]
  ) {
    const h = fixture(options);
    const response = await h.run();
    assert.equal(response.ok, false);
    assert.equal(h.executions(), 0);
    assert.equal(
      h.calls.some((x) => x.boundary === "service_settlement"),
      false,
    );
  }
});
Deno.test("customer read cannot select provider/mutation handlers or treat queue acceptance/lost receipt as success", async () => {
  assert.equal(admittedCustomerReads.length, 8);
  const wrong = fixture();
  assert.equal((await wrong.run({}, "tasks.create")).status, 400);
  assert.equal(wrong.calls.length, 0);
  assert.equal(wrong.executions(), 0);
  const queued = fixture();
  const response = await queued.run({
    ok: true,
    accepted: true,
    executed: false,
  });
  assert.equal(response.status, 502);
  assert.equal((await response.json()).executed, null);
  assert.equal(queued.calls[2].args.p_outcome, "unknown");
  const lost = fixture({ lostFinish: true });
  const failed = await lost.run();
  assert.equal(failed.status, 503);
  assert.equal((await failed.json()).reconciliation_required, true);
});
