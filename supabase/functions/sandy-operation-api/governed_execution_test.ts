import assert from "node:assert/strict";
import { governedExecution } from "./governed_execution.ts";
import type { ExecutionAdmissionInput, PolicyDb } from "./access_policy.ts";
const actor = "10000000-0000-4000-8000-000000000001";
const requestId = "10000000-0000-4000-8000-000000000002";
const admissionId = "10000000-0000-4000-8000-000000000003";
const grantId = "10000000-0000-4000-8000-000000000004";
const input: ExecutionAdmissionInput = {
  actorId: actor, tenantId: null, operation: "supabase.projects.get", arguments: {},
  requestId, contractSha256: "a".repeat(64), scope: { project_ref: "fixed" },
};
function mock(options: { refuse?: string; loseFinish?: boolean } = {}) {
  const calls: { name: string; args: Record<string, unknown> }[] = [];
  let admitted = false;
  const db: PolicyDb = { rpc(name, args) {
    calls.push({ name, args });
    if (name === "sandy_api_admit_execution") {
      if (options.refuse || admitted) return Promise.resolve({ data: { ok: false, error: options.refuse ?? "admission_already_recorded", http_status: 409 }, error: null });
      admitted = true;
      return Promise.resolve({ data: {
        ok: true, allowed: true, reused: false, admission_id: admissionId, grant_id: grantId, state: "admitted", executed: false,
        request_id: requestId, principal_id: actor, actor_id: actor, tenant_id: null,
        operation: input.operation, input_sha256: args.p_input_sha256,
        contract_sha256: args.p_contract_sha256, scope_sha256: args.p_scope_sha256,
        expires_at: new Date(Date.now() + 60000).toISOString(),
      }, error: null });
    }
    if (name === "sandy_api_consume_execution_grant") return Promise.resolve({ data: { ok: true, allowed: true, reused: false, admission_id: admissionId }, error: null });
    if (options.loseFinish) return Promise.resolve({ data: null, error: { message: "private" } });
    return Promise.resolve({ data: { ok: true, admission_id: admissionId, state: args.p_outcome, reused: false }, error: null });
  } };
  return { db, calls };
}
Deno.test("governed read dispatch consumes once and records digest evidence, same request ID never redispatches", async () => {
  const h = mock(); let executed = 0;
  const dispatch = () => { executed++; return Promise.resolve(Response.json({ ok: true, operation: input.operation, executed: true, upstream_status: 200, result: { metadata: "safe" } })); };
  const response = await governedExecution(h.db, input, dispatch);
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.admission_id, admissionId);
  assert.deepEqual(h.calls.map(x => x.name), ["sandy_api_admit_execution", "sandy_api_consume_execution_grant", "sandy_api_finish_execution"]);
  assert.equal(h.calls[2].args.p_outcome, "succeeded");
  assert.match(String(h.calls[2].args.p_result_sha256), /^[a-f0-9]{64}$/);
  assert.equal(JSON.stringify(h.calls).includes("safe"), false);
  assert.equal((await governedExecution(h.db, input, dispatch)).status, 409);
  assert.equal(executed, 1);
});
Deno.test("admission refusal never dispatches; transport ambiguity and lost receipt preserve request correlation", async () => {
  let executed = 0;
  const refused = mock({ refuse: "request_id_conflict" });
  const response = await governedExecution(refused.db, input, () => { executed++; throw Error("not reached"); });
  assert.equal(response.status, 409); assert.equal(executed, 0);
  const h = mock();
  const unknown = await governedExecution(h.db, input, () => { throw Error("private provider detail"); });
  assert.equal(unknown.status, 502);
  const body = await unknown.json();
  assert.equal(body.executed, null); assert.equal(body.request_id, requestId);
  assert.equal(body.reconciliation_required, true);
  assert.equal(h.calls[2].args.p_outcome, "unknown");
  const lost = await governedExecution(mock({ loseFinish: true }).db, input, () => Promise.resolve(Response.json({ ok: true, executed: true, result: {} })));
  assert.equal(lost.status, 503);
  assert.equal((await lost.json()).reconciliation_required, true);
});
Deno.test("asynchronous acceptance is distinct from completion and providers consume at their final trusted boundary", async () => {
  const h = mock();
  const queued = await governedExecution(h.db, input, () => Promise.resolve(Response.json({ ok: true, accepted: true, executed: false, job_id: actor }, { status: 202 })));
  assert.equal(queued.status, 202);
  assert.equal(h.calls[2].args.p_outcome, "accepted");
  const provider = mock();
  const done = await governedExecution(provider.db, input, admission => {
    assert.equal(admission.grantId, grantId);
    return Promise.resolve(Response.json({ ok: true, executed: true, result: {} }));
  }, true);
  assert.equal(done.status, 200);
  assert.deepEqual(provider.calls.map(x => x.name), ["sandy_api_admit_execution"]);
});
