import assert from "node:assert/strict";
import { createMissionExecutorHandler } from "./index.ts";
import { authenticateMissionExecutor, bindMissionWorkProductJob, missionExecutorSource } from "../_shared/sandy-agent-operations/worker_mission_identity.ts";
import { executeMissionWorkProduct, missionWorkProductInstructions, missionWorkProductRequest } from "../_shared/sandy-agent-operations/worker_mission.ts";
import { missionWorkProductContract, validMissionWorkProductInput } from "../_shared/sandy-agent-operations/worker_mission_contract.ts";
import { isAgentPrincipal, isRuntimeConversationTask } from "../_shared/sandy-agent-operations/identity.ts";
type Obj = Record<string, any>;
const CUSTOMER = "a1000000-0000-4000-8000-000000000001", MISSION = "a2000000-0000-4000-8000-000000000001", RUN = "a3000000-0000-4000-8000-000000000001";
const content = "This is an internal draft pending client review. Only the explicitly supplied objective is used. Unknown project facts remain [TO CONFIRM]. No external research, communication or action has occurred.";
const context = { project: "Actual customer project", objective: "Prepare an internal administrative checklist", approved_plan_summary: "A provisional reversible internal draft", milestone: "Prepare draft checklist", milestone_details: "Use stated project information only", revision_feedback: null, previous_draft: null };
class Db {
  runs: Obj[] = [{ id: RUN, customer_id: CUSTOMER, mission_task_id: MISSION, stage: "execute", state: "queued" }];
  audits: Obj[] = []; products: Obj[] = []; reviews: Obj[] = []; serial = 0;
  waitingReason: string | null = null; claimLost = false; finalFailure = false; finalResponseLost = false; contextChanged = false;
  context: Obj = structuredClone(context); provisional = true;
  from(table: string) {
    assert.ok(["sandy_mission_runs","sandy_mission_work_product_audit"].includes(table)); const filters: ((row: Obj) => boolean)[] = [];
    let max = Infinity, update: Obj | null = null, columns: string[] | null = null;
    const run = (single: boolean) => {
      const selected = (table === "sandy_mission_runs" ? this.runs : this.audits).filter(row => filters.every(filter => filter(row))).slice(0, max);
      if (update) for (const row of selected) Object.assign(row, update);
      const data = selected.map(row => columns ? Object.fromEntries(columns.map(key => [key, row[key]])) : structuredClone(row)); return { data: single ? data[0] || null : data, error: null };
    };
    const q: any = { select: (text: string) => { columns = text === "*" ? null : text.split(","); return q; }, eq: (key: string, value: unknown) => { filters.push(row => row[key] === value); return q; },
      order: () => q, limit: (value: number) => { max = value; return q; }, update: (value: Obj) => { update = value; return q; }, maybeSingle: () => Promise.resolve(run(true)),
      then: (resolve: (value: any) => any) => Promise.resolve(run(false)).then(resolve) }; return q;
  }
  async rpc(name: string, args: Obj) {
    if (name === "sandy_prepare_mission_work_product") {
      const run = this.runs.find(row => row.id === args.p_run_id);
      if (this.audits.some(a => a.run_id === args.p_run_id)) return { data: null, error: { code: "23505" } };
      if (this.audits.some(a => a.run_id !== args.p_run_id && ["started", "unknown"].includes(a.state))) return { data: null, error: { code: "P0001", message: "mission_milestone_outcome_requires_reconciliation" } };
      if (!run || run.state !== "queued" || run.stage !== "execute" || run.customer_id !== args.p_customer_id || run.mission_task_id !== args.p_mission_id || args.p_source_sha256 !== missionExecutorSource.sourceSha256) return { data: null, error: { code: "P0001" } };
      const id = `a4000000-0000-4000-8000-${String(++this.serial).padStart(12, "0")}`;
      this.audits.push({ id, customer_id:run.customer_id, mission_task_id:run.mission_task_id, source_sha256:args.p_source_sha256, run_id: run.id, state: "started", waiting_reason: this.waitingReason }); run.state = "running";
      return this.claimLost ? { data: null, error: { code: "fixture_claim_lost" } } : { data: { id, waiting_reason: this.waitingReason, context: this.context, provisional_plan: this.provisional }, error: null };
    }
    assert.equal(name, "sandy_finish_mission_work_product");
    const audit = this.audits.find(a => a.id === args.p_audit_id), run = this.runs.find(row => row.id === audit?.run_id);
    if (!audit || !run || audit.state !== "started") return { data: null, error: { code: "fixture_no_started_claim" } };
    if (args.p_state === "unknown") { audit.state = "unknown"; if (run.state === "running") run.state = "failed"; return { data: { ok: true, reconciliation_required: true }, error: null }; }
    if (this.finalFailure || this.contextChanged) return { data: null, error: { code: "fixture_final_failure" } };
    if (args.p_state === "waiting") { assert.ok(audit.waiting_reason); audit.state = "waiting"; run.state = "completed"; return { data: { ok: true, work_product_id: null }, error: null }; }
    const draft = JSON.parse(args.p_draft_canonical); assert.ok(args.p_provider_response_id); assert.match(args.p_response_sha256, /^[a-f0-9]{64}$/);
    const product = { id: `a5000000-0000-4000-8000-${String(this.serial).padStart(12, "0")}`, run_id: run.id, customer_id: run.customer_id, state: "pending_review", ...draft };
    this.products.push(product); this.reviews.push({ customer_id: run.customer_id, work_product_id: product.id, assigned_to: "client", external_actions_performed: 0 });
    Object.assign(audit,{state:"succeeded",provider_response_id:args.p_provider_response_id,response_sha256:args.p_response_sha256,draft_sha256:Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(args.p_draft_canonical)))).map(v=>v.toString(16).padStart(2,"0")).join(""),work_product_id:product.id,review_task_id:"a6000000-0000-4000-8000-000000000001",finished_at:new Date().toISOString()}); run.state = "completed";
    return this.finalResponseLost ? { data: null, error: { code: "fixture_committed_final_response_lost" } } : { data: { ok: true, work_product_id: product.id }, error: null };
  }
}
const req = (headers: Obj = { "x-email-ai-renewal-key": "fixture-renewal-key" }, body: Obj = {}) => new Request("https://internal.invalid/worker", { method: "POST", headers: { ...headers, "content-type": "application/json" }, body: JSON.stringify(body) });
const envelope = (draft: Obj = { title: "Draft for client review", content, content_type: "checklist", questions: [] }) => Response.json({ id: "resp_mission_fixture", status: "completed", output: [{ content: [{ type: "output_text", text: JSON.stringify(draft) }] }] });
const deps = (db: Db, request: typeof fetch) => ({ db, base: "https://zmqlyygzqoidkcwdysok.supabase.co", serviceCredential: "fixture-db-service", renewalSecret: "fixture-renewal-key", openaiKey: "fixture-model", fetch: request });
async function setup() {
  const db = new Db(), proof = authenticateMissionExecutor(req(), "fixture-renewal-key"); assert.ok(proof);
  const job = await bindMissionWorkProductJob(proof, db, { runId: RUN, customerId: CUSTOMER, missionId: MISSION }); assert.ok(job);
  return { db, proof, job };
}
Deno.test("mission executor preserves dedicated renewal authentication, two-job queue batch and original legacy result shape", async () => {
  const db = new Db(); db.runs.push({ ...db.runs[0], id: "a3000000-0000-4000-8000-000000000002" }, { ...db.runs[0], id: "a3000000-0000-4000-8000-000000000003" }); let calls = 0;
  const handler = createMissionExecutorHandler(deps(db, (async () => { calls++; return envelope(); }) as typeof fetch));
  for (const headers of [{ authorization: "Bearer fixture-db-service" }, { authorization: "Bearer customer-session" }, { "x-sandy-qa-token": "a".repeat(64) }, { "x-email-ai-renewal-key": "invalid" }]) assert.equal((await handler(req(headers))).status, 401);
  assert.equal(db.audits.length, 0);
  const response = await handler(req()); assert.equal(response.status, 200); const body = await response.json(); assert.equal(body.processed, 2); assert.equal(body.results[0].state, "completed"); assert.equal(body.results[0].draft, true);
  assert.equal(calls, 2); assert.equal(db.products.length, 2); assert.equal(db.reviews.length, 2); assert.equal(db.runs[2].state, "queued");
});
Deno.test("mission job capabilities cannot be serialized or substitute for customer/session authority or select a public model/executor", async () => {
  const { db, proof, job } = await setup(); let calls = 0;
  const service = deps(db, (async () => { calls++; throw Error("unreachable"); }) as typeof fetch);
  assert.equal(isAgentPrincipal(job) || isAgentPrincipal(proof) || isRuntimeConversationTask(job), false);
  assert.equal(await bindMissionWorkProductJob(JSON.parse(JSON.stringify(proof)), db, { runId: RUN, customerId: CUSTOMER, missionId: MISSION }), null);
  assert.equal((await executeMissionWorkProduct(JSON.parse(JSON.stringify(job)), {}, service)).status, 403);
  for (const args of [{ model: "alternate" }, { customer_id: CUSTOMER }, { milestone_id: "invented" }, { executor: "arbitrary-tool" }]) assert.equal(validMissionWorkProductInput(args), false);
  assert.equal((await executeMissionWorkProduct(job, { model: "alternate" }, service)).status, 400);
  assert.ok(missionWorkProductContract.sensitive && missionWorkProductContract.is_mutation && missionWorkProductContract.consumes_model_resources);
  assert.equal(missionWorkProductContract.api_exposed || missionWorkProductContract.ui_exposed || missionWorkProductContract.ai_exposed || missionWorkProductContract.verified, false);
  db.runs[0].customer_id = "a1000000-0000-4000-8000-000000000099";
  assert.equal((await executeMissionWorkProduct(job, {}, service)).status, 503); assert.equal(db.runs[0].state, "queued"); assert.equal(calls, 0);
});
Deno.test("mission request keeps exact archived instructions/model/input, omitted plan summary and fixed80-second transport", async () => {
  const { db, job } = await setup(); const pinned = JSON.parse(await Deno.readTextFile("supabase/functions/sandy-mission-executor/legacy-policy-source.json"));
  assert.equal(missionWorkProductInstructions, pinned.instructions);
  let timeout = 0; const original = AbortSignal.timeout; AbortSignal.timeout = milliseconds => { timeout = milliseconds; return new AbortController().signal; };
  try {
    const result = await executeMissionWorkProduct(job, {}, deps(db, (async (url, init) => {
      assert.equal(String(url), "https://api.openai.com/v1/responses"); assert.equal(init?.method, "POST"); assert.equal(init?.redirect, undefined); assert.equal(new Headers(init?.headers).get("authorization"), "Bearer fixture-model");
      const body = JSON.parse(String(init?.body)); assert.equal(body.model, "gpt-4.1-mini"); assert.equal(body.max_output_tokens, 1600); assert.equal(body.instructions, pinned.instructions); assert.equal(Object.hasOwn(body, "store"), false); assert.deepEqual(JSON.parse(body.input), context);
      assert.equal(db.audits[0].state, "started"); assert.equal(db.runs[0].state, "running"); return envelope();
    }) as typeof fetch));
    assert.equal(timeout, 80000); assert.equal(result.status, 200); assert.equal(result.body.customer_id, CUSTOMER); assert.equal(result.body.auth_user_id, null); assert.equal(result.body.external_actions_performed, 0); assert.equal(result.body.execution_verified, false); assert.equal(result.body.requires_client_review, true);
  } finally { AbortSignal.timeout = original; }
  const without = { ...context }; delete (without as Obj).approved_plan_summary;
  assert.equal(Object.hasOwn(JSON.parse(missionWorkProductRequest(without).input), "approved_plan_summary"), false);
});
Deno.test("no eligible or dependency-ready milestone retains waiting result without a model request", async () => {
  for (const reason of ["no_eligible_internal_step", "blocked_by_milestone_dependencies"]) {
    const { db, job } = await setup(); db.waitingReason = reason; let calls = 0;
    const result = await executeMissionWorkProduct(job, {}, deps(db, (async () => { calls++; throw Error("no model expected"); }) as typeof fetch));
    assert.equal(result.status, 200); assert.deepEqual(result.legacy, { run: RUN, state: "waiting", reason }); assert.equal(result.body.outcome, "waiting"); assert.equal(db.runs[0].state, "completed"); assert.equal(db.audits[0].state, "waiting"); assert.equal(calls, 0); assert.equal(db.products.length, 0);
  }
});
Deno.test("concurrent or repeated same-run execution consumes one model request and creates one review draft", async () => {
  const { db, job } = await setup(); let calls = 0;
  const service = deps(db, (async () => { calls++; await Promise.resolve(); return envelope(); }) as typeof fetch);
  const results = await Promise.all([executeMissionWorkProduct(job, {}, service), executeMissionWorkProduct(job, {}, service)]); assert.deepEqual(results.map(r => r.status).sort(), [200, 409]);
  assert.equal((await executeMissionWorkProduct(job, {}, service)).status, 409); assert.equal(calls, 1); assert.equal(db.products.length, 1); assert.equal(db.reviews.length, 1);
});
Deno.test("unknown model outcomes, invalid draft and incomplete provider envelopes cannot repeat paid work", async () => {
  for (const makeResponse of [async () => { throw Error("provider result lost"); }, async () => Response.json({ id: "resp_partial", status: "incomplete", output: [] }), async () => Response.json({ error: "private provider diagnostic" }, { status: 503 }), async () => envelope({ title: "Invalid", content: "too short" })]) {
    const { db, job } = await setup(); let calls = 0; const service = deps(db, (async () => { calls++; return await makeResponse(); }) as typeof fetch);
    const result = await executeMissionWorkProduct(job, {}, service); assert.equal(result.status, 502); assert.equal(result.body.reconciliation_required, true); assert.equal(db.audits[0].state, "unknown"); assert.equal(db.runs[0].state, "failed");
    assert.equal((await executeMissionWorkProduct(job, {}, service)).status, 409); assert.equal(calls, 1); assert.equal(db.products.length, 0);
  }
});
Deno.test("lost admission or atomic final receipt and concurrent context changes never duplicate paid work or review records", async () => {
  for (const mode of ["claimLost", "finalFailure", "finalResponseLost", "contextChanged"] as const) {
    const { db, job } = await setup(); db[mode] = true; let calls = 0; const service = deps(db, (async () => { calls++; return envelope(); }) as typeof fetch);
    const result = await executeMissionWorkProduct(job, {}, service); assert.equal(result.status, mode === "claimLost" ? 503 : mode === "finalResponseLost" ? 200 : 502); assert.equal(calls, mode === "claimLost" ? 0 : 1);
    assert.equal(db.products.length, mode === "finalResponseLost" ? 1 : 0); assert.equal(db.reviews.length, mode === "finalResponseLost" ? 1 : 0);
    assert.equal((await executeMissionWorkProduct(job, {}, service)).status, 409); assert.equal(calls, mode === "claimLost" ? 0 : 1);
  }
});
Deno.test("fenced legacy JSON draft normalizes original title/content/type bounds without external dispatch", async () => {
  const { db, job } = await setup(); const draft = { title: "x".repeat(300), content: content.repeat(100), content_type: "unsupported", questions: ["not an external action"] };
  const result = await executeMissionWorkProduct(job, {}, deps(db, (async () => Response.json({ id: "resp_fenced", status: "completed", output: [{ content: [{ type: "output_text", text: "```json\n" + JSON.stringify(draft) + "\n```" }] }] })) as typeof fetch));
  assert.equal(result.status, 200); assert.equal(db.products[0].title.length, 240); assert.equal(db.products[0].content.length, 14000); assert.equal(db.products[0].content_type, "draft"); assert.equal(db.products[0].state, "pending_review"); assert.equal(db.reviews[0].assigned_to, "client");
});

Deno.test("another queued run ID cannot repeat the same unresolved milestone outcome", async () => {
  const { db, job } = await setup(); let calls = 0;
  const service = deps(db, (async () => { calls++; throw Error("model result lost"); }) as typeof fetch);
  assert.equal((await executeMissionWorkProduct(job, {}, service)).status, 502);
  const nextId = "a3000000-0000-4000-8000-000000000009"; db.runs.push({ ...db.runs[0], id: nextId, state: "queued" });
  const proof = authenticateMissionExecutor(req(), "fixture-renewal-key"); assert.ok(proof);
  const next = await bindMissionWorkProductJob(proof, db, { runId: nextId, customerId: CUSTOMER, missionId: MISSION }); assert.ok(next);
  const result = await executeMissionWorkProduct(next, {}, service); assert.equal(result.status, 409); assert.equal(result.body.reconciliation_required, true); assert.equal(db.runs[1].state, "blocked"); assert.equal(calls, 1); assert.equal(db.audits.length, 1);
});

Deno.test("noncompleted model output cannot create a draft, review commitment or successful mission receipt",async()=>{
 for(const status of ["cancelled","queued","in_progress","unknown_provider_state",undefined]){
  const {db,job}=await setup();let calls=0;
  const request=(async()=>{calls++;return Response.json({id:"resp_nonterminal_fixture",status,output:[{content:[{type:"output_text",text:JSON.stringify({title:"Plausible draft",content,content_type:"checklist"})}]}]});})as typeof fetch;
  const result=await executeMissionWorkProduct(job,{},deps(db,request));
  assert.equal(result.status,502);assert.equal(result.body.reconciliation_required,true);assert.equal(result.body.executed,null);
  assert.equal(db.products.length,0);assert.equal(db.reviews.length,0);assert.equal(db.audits[0].state,"unknown");
  assert.equal((await executeMissionWorkProduct(job,{},deps(db,request))).status,409);assert.equal(calls,1);
 }
});
