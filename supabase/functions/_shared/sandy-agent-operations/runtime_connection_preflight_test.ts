import assert from "node:assert/strict";
import { authenticateRuntime, bindRuntimeTask } from "./identity.ts";
import { bindRuntimeConnectionPreflight, runtimeConnectionPreflightOperation } from "./runtime_connection_preflight.ts";
const CUSTOMER = "81000000-0000-4000-8000-000000000001";
const TASK = "82000000-0000-4000-8000-000000000001";
const base = "https://zmqlyygzqoidkcwdysok.supabase.co";
class Db {
  task = { id: TASK, customer_id: CUSTOMER, channel: "web", request_id: "actual-preflight-request", user_request: "Which apps are connected?", status: "running" };
  writes: { table: string; body: any }[] = [];
  from(table: string) {
    const filters: [string, any][] = []; let value: any;
    const result = () => ({ data: table === "sandy_agent_tasks" && filters.every(([key, expected]) => this.task[key as keyof typeof this.task] === expected) ? this.task : value || null, error: null });
    const q = {
      select: () => q, eq: (key: string, expected: any) => { filters.push([key, expected]); return q; },
      maybeSingle: () => Promise.resolve(result()),
      upsert: (body: any) => { value = body; this.writes.push({ table, body }); return q; },
      insert: (body: any) => { value = body; this.writes.push({ table, body }); return q; },
      then: (resolve: (value: any) => unknown) => Promise.resolve(result()).then(resolve),
    }; return q;
  }
}
async function fixture(connectionError: string | null = null) {
  const db = new Db();
  const proof = await authenticateRuntime(new Request("https://internal.invalid", { headers: { authorization: "Bearer fixture-worker" } }), db, "fixture-worker"); assert.ok(proof);
  const principal = await bindRuntimeTask(proof, db, { taskId: TASK, customerId: CUSTOMER, channel: "web", requestId: db.task.request_id }); assert.ok(principal);
  const cap = bindRuntimeConnectionPreflight(principal, { channel: "web", requestId: db.task.request_id, connections: [{ connected_account_id: "ca_owned", company_id: null, toolkit_slug: "gmail", status: "ACTIVE" }], workspaceNames: new Map(), connectionError, requestedService: null }); assert.ok(cap);
  return { db, principal, cap };
}
const row = { id: "ca_owned", user_id: "sandy_customer_" + CUSTOMER, status: "ACTIVE" };
Deno.test("read-only connection inspection preserves provider evidence without findings, diagnosis or domain writes",async()=>{
 const {db,principal,cap}=await fixture();let scheduled=0;
 const result=await runtimeConnectionPreflightOperation(principal,cap,{db,base,composioKey:"fixture",autoImproveKey:"fixture",defer:()=>{scheduled++;},request:(async()=>Response.json({items:[],next_cursor:null})) as typeof fetch},true);
 assert.equal(result.mismatches,1);assert.equal(result.findings_recorded,0);assert.equal(result.diagnosis_requests_scheduled,0);assert.equal(scheduled,0);assert.equal(db.writes.length,0);
});
Deno.test("preflight confirms only a bounded complete provider page scoped to the actual task customer", async () => {
  const { db, principal, cap } = await fixture(); let calls = 0;
  const result = await runtimeConnectionPreflightOperation(principal, cap, { db, base, composioKey: "fixture-composio", autoImproveKey: "", defer: () => { throw Error("no diagnosis expected"); }, request: (async (url, init) => {
    calls++; assert.equal(String(url), "https://backend.composio.dev/api/v3.1/connected_accounts?limit=100&user_ids=" + encodeURIComponent(row.user_id));
    assert.equal(new Headers(init?.headers).get("x-api-key"), "fixture-composio");
    return Response.json({ items: [row], next_cursor: null });
  }) as typeof fetch });
  assert.equal(result.provider_check, "confirmed"); assert.equal(result.mismatches, 0); assert.equal(calls, 1);
  assert.match(result.response, /confirmed active by provider/); assert.equal(result.diagnosis_completed, false);
  assert.equal(db.writes[0].body.outcome, "verified");
});
Deno.test("malformed, rejected, foreign and paginated 2xx pages never become confirmation or diagnosis authority", async () => {
  for (const body of [{}, [], { items: "invalid" }, { items: [row], successful: false }, { items: [{ ...row, user_id: "sandy_customer_foreign" }] }, { items: [{ ...row, status: null }] }, { items: [{ ...row, status: "" }] }, { items: [row, { ...row, status: "INACTIVE" }] }, { items: [row], next_cursor: "more" }, { items: [row], error: "fixture_rejection" }]) {
    const { db, principal, cap } = await fixture(); let calls = 0;
    const result = await runtimeConnectionPreflightOperation(principal, cap, { db, base, composioKey: "fixture-composio", autoImproveKey: "fixture-diagnosis", defer: () => { throw Error("must not schedule"); }, request: (async () => { calls++; return Response.json(body); }) as typeof fetch });
    assert.equal(result.provider_check, "unavailable"); assert.equal(result.mismatches, 0); assert.equal(result.findings_recorded, 0); assert.equal(result.diagnosis_requests_scheduled, 0); assert.equal(calls, 1);
    assert.equal(db.writes.some(write => write.table === "sandy_supervisor_findings"), false);
  }
});
Deno.test("real scoped mismatch records one finding and schedules the original diagnosis request without claiming repair or completion", async () => {
  const { db, principal, cap } = await fixture(), background: Promise<unknown>[] = [], requests: { url: string; body: any }[] = [];
  const deps = { db, base, composioKey: "fixture-composio", autoImproveKey: "fixture-diagnosis", defer: (work: Promise<unknown>) => { background.push(work); }, request: (async (url: any, init: any) => {
    requests.push({ url: String(url), body: init?.body ? JSON.parse(init.body) : null });
    if (String(url).startsWith("https://backend.composio.dev/")) return Response.json({ items: [] });
    assert.equal(String(url), base + "/functions/v1/sandy-auto-improve"); assert.equal(new Headers(init.headers).get("authorization"), "Bearer fixture-diagnosis");
    return Response.json({ accepted: true }, { status: 202 });
  }) as typeof fetch };
  const result = await runtimeConnectionPreflightOperation(principal, cap, deps); await Promise.all(background);
  assert.equal(result.provider_check, "confirmed"); assert.equal(result.mismatches, 1); assert.equal(result.findings_recorded, 1); assert.equal(result.diagnosis_requests_scheduled, 1); assert.equal(result.diagnosis_completed, false);
  const finding = db.writes.find(write => write.table === "sandy_supervisor_findings"); assert.equal(finding?.body.fingerprint, "v2:connection:" + CUSTOMER + ":gmail:personal");
  assert.equal(requests.length, 2); assert.match(requests[1].body.source_ref, /^v2_conn_[a-f0-9]{40}$/); assert.equal(JSON.stringify(requests[1].body).includes(CUSTOMER), false);
  assert.equal(db.writes.some(write => write.table === "sandy_composio_connections"), false, "preflight records drift, never claims or applies connection repair");
});
Deno.test("serialized/cross-task scope and local lookup errors cannot reach a provider", async () => {
  const { db, principal, cap } = await fixture(); let calls = 0;
  const deps = { db, base, composioKey: "fixture-composio", autoImproveKey: "", defer: () => {}, request: (async () => { calls++; throw Error("unreachable"); }) as typeof fetch };
  assert.equal((await runtimeConnectionPreflightOperation(principal, JSON.parse(JSON.stringify(cap)), deps)).error, "runtime_connection_preflight_capability_required");
  db.task.request_id = "different-request";
  assert.equal((await runtimeConnectionPreflightOperation(principal, cap, deps)).error, "runtime_connection_preflight_task_mismatch");
  assert.equal(calls, 0);
  const broken = await fixture("fixture_connection_lookup_failed");
  const result = await runtimeConnectionPreflightOperation(broken.principal, broken.cap, { ...deps, db: broken.db });
  assert.equal(result.success, false); assert.equal(result.provider_check, "unavailable"); assert.equal(calls, 0);
});
