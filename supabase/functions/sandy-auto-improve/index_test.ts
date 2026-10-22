import assert from "node:assert/strict";
import { createAutoImproveHandler } from "./index.ts";
import { authenticateAutoImproveWorker, bindAutoImproveJob, autoImproveSource } from "../_shared/sandy-agent-operations/worker_diagnosis_identity.ts";
import { executeWorkerDiagnosis, diagnosisRequest, workerDiagnosisInstructions } from "../_shared/sandy-agent-operations/worker_diagnosis.ts";
import { workerDiagnosisContract, validWorkerDiagnosisInput, workerDiagnosisOperation } from "../_shared/sandy-agent-operations/worker_diagnosis_contract.ts";
import { isAgentPrincipal, isRuntimeConversationTask } from "../_shared/sandy-agent-operations/identity.ts";
type Obj = Record<string, any>;
const JOB = "91000000-0000-4000-8000-000000000001", AUDIT = "92000000-0000-4000-8000-000000000001";
const problem = "The provider connection status could not be confirmed from current evidence.";
const sha = async (text: string) => Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)))).map(v => v.toString(16).padStart(2, "0")).join("");
const proposal = { root_cause: "A hypothesis requiring investigation", investigation_steps: ["Inspect real receipts"], proposed_changes: [{ component: "connections", change: "Review provider scope", risk: "low" }], regression_tests: ["Check unknown handling"], deployment_plan: "Approval and review only", rollback_plan: "No deployment performed", risk_level: "low", requires_approval: true };
class Db {
  tables: Record<string, Obj[]> = { sandy_auto_improve_runs: [], sandy_evidence_improvement_queue: [], sandy_qa_engineering_handoffs: [] };
  audits: Obj[] = []; claimLost = false; finishLost = false; saveLost = false; handoffLost = false;
  from(table: string) {
    let mode = "read", value: Obj, columns: string[] | null = null, ignore = false;
    const filters: ((row: Obj) => boolean)[] = [];
    const project = (row: Obj | null) => row && columns ? Object.fromEntries(columns.map(key => [key, row[key]])) : row;
    const run = (single: boolean) => {
      const rows = this.tables[table] ??= [];
      if (mode === "upsert") {
        const existing = table === "sandy_auto_improve_runs" ? rows.find(row => row.source_type === value.source_type && row.source_ref === value.source_ref) : rows.find(row => row.issue_key === value.issue_key);
        if (ignore && existing) return { data: single ? null : [], error: null };
        if (table === "sandy_qa_engineering_handoffs" && this.handoffLost) return { data: null, error: { code: "fixture_handoff_loss" } };
        const row = { id: JOB, ...structuredClone(value) }; rows.push(row);
        return { data: single ? project(structuredClone(row)) : [project(structuredClone(row))], error: null };
      }
      const selected = rows.filter(row => filters.every(filter => filter(row)));
      if (mode === "update") for (const row of selected) Object.assign(row, structuredClone(value));
      if (mode === "update" && this.saveLost) return { data: null, error: { code: "fixture_save_response_lost" } };
      return { data: single ? project(structuredClone(selected[0] ?? null)) : selected.map(row => project(structuredClone(row))), error: null };
    };
    const q: any = { select: (text: string) => { columns = text === "*" ? null : text.split(","); return q; }, eq: (key: string, value: any) => { filters.push(row => row[key] === value); return q; },
      upsert: (row: Obj, options: Obj) => { mode = "upsert"; value = row; ignore = !!options.ignoreDuplicates; return q; }, update: (row: Obj) => { mode = "update"; value = row; return q; },
      maybeSingle: () => Promise.resolve(run(true)), then: (resolve: (v: any) => any) => Promise.resolve(run(false)).then(resolve) }; return q;
  }
  async rpc(name: string, args: Obj) {
    const job = this.tables.sandy_auto_improve_runs.find(row => row.id === (args.p_job_id || this.audits.find(a => a.id === args.p_audit_id)?.job_id));
    if (name === "sandy_claim_auto_improve_operation") {
      if (this.audits.some(a => a.job_id === args.p_job_id)) return { data: null, error: { code: "23505" } };
      if (!job || job.status !== "queued" || job.source_type !== args.p_source_type || job.source_ref !== args.p_source_ref || await sha(job.problem) !== args.p_problem_sha256 || args.p_source_sha256 !== autoImproveSource.sourceSha256) return { data: null, error: { code: "fixture_scope_refused" } };
      // Recheck after asynchronous digest to model the real atomic locked RPC.
      if (this.audits.some(a => a.job_id === args.p_job_id)) return { data: null, error: { code: "23505" } };
      this.audits.push({ id: AUDIT, job_id: job.id, state: "started", ...structuredClone(args) }); job.status = "analysing";
      return this.claimLost ? { data: null, error: { code: "fixture_claim_response_lost" } } : { data: { id: AUDIT }, error: null };
    }
    assert.equal(name, "sandy_finish_auto_improve_operation");
    const audit = this.audits.find(a => a.id === args.p_audit_id);
    if (this.finishLost || !audit || audit.state !== "started" || !job) return { data: null, error: { code: "fixture_final_receipt_lost" } };
    if (args.p_state === "succeeded" && (!args.p_provider_response_id || job.status !== "proposed" || JSON.stringify(job.proposed_fix) !== args.p_proposal_canonical)) return { data: null, error: { code: "fixture_actual_proposal_required" } };
    audit.state = args.p_state; Object.assign(audit, args);
    if (args.p_state === "unknown" && job.status === "analysing") { job.status = "failed"; job.last_error = args.p_error; }
    return { data: true, error: null };
  }
}
const request = (body: Obj = {}, authorization = "Bearer fixture-dedicated-key") => new Request("https://internal.invalid/diagnose", { method: "POST", headers: { authorization, "content-type": "application/json" }, body: JSON.stringify({ source_type: "system_awareness", source_ref: "actual-source-reference", problem, ...body }) });
async function setup(sourceType = "system_awareness") {
  const db = new Db(); db.tables.sandy_auto_improve_runs.push({ id: JOB, source_type: sourceType, source_ref: "actual-source-reference", problem, status: "queued" });
  const proof = authenticateAutoImproveWorker(request(), "fixture-db-service", "fixture-dedicated-key"); assert.ok(proof);
  const job = await bindAutoImproveJob(proof, db, { jobId: JOB, sourceType, sourceRef: "actual-source-reference", problem }); assert.ok(job);
  return { db, proof, job };
}
const envelope = (value = proposal) => Response.json({ id: "resp_diagnosis_fixture", status: "completed", output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify(value) }] }] });
Deno.test("diagnosis retains dedicated automation authentication and exact legacy response without customer or owner substitution", async () => {
  const db = new Db(); let calls = 0;
  const handler = createAutoImproveHandler({ db, serviceCredential: "fixture-db-service", automationSecret: "fixture-dedicated-key", openaiKey: "fixture-model", fetch: (async () => { calls++; return envelope(); }) as typeof fetch });
  for (const auth of ["Bearer fixture-db-service", "Bearer fixture-customer-session", "Bearer fixture-controller-owner", "", "fixture-dedicated-key"]) assert.equal((await handler(request({}, auth))).status, 403);
  assert.equal(db.tables.sandy_auto_improve_runs.length, 0);
  const result = await handler(request()); assert.equal(result.status, 200); assert.deepEqual(await result.json(), { ok: true, id: JOB, status: "proposed", requires_approval: true });
  assert.equal(calls, 1); assert.equal(db.audits[0].state, "succeeded");
  const repeated = await handler(request()); assert.equal(repeated.status, 200); assert.equal((await repeated.json()).already_registered, true); assert.equal(calls, 1);
});
Deno.test("diagnosis capabilities are nonserializable, job-bound and excluded from actual customer/runtime principals and public exposure", async () => {
  const { db, proof, job } = await setup();
  assert.equal(isAgentPrincipal(proof), false); assert.equal(isAgentPrincipal(job), false); assert.equal(isRuntimeConversationTask(job), false);
  assert.ok(workerDiagnosisContract.internal_only && workerDiagnosisContract.is_mutation && workerDiagnosisContract.consumes_model_resources && workerDiagnosisContract.sensitive);
  assert.equal(workerDiagnosisContract.api_exposed || workerDiagnosisContract.ui_exposed || workerDiagnosisContract.ai_exposed || workerDiagnosisContract.verified, false);
  for (const args of [{ customer_id: "invented" }, { model: "another-model" }, { executor: "arbitrary" }, { operation: "gmail.send" }]) assert.equal(validWorkerDiagnosisInput(args), false);
  assert.equal(await bindAutoImproveJob(JSON.parse(JSON.stringify(proof)), db, { jobId: JOB, sourceType: "system_awareness", sourceRef: "actual-source-reference", problem }), null);
  const noProvider = { db, openaiKey: "fixture-model", fetch: (() => { throw Error("must not execute"); }) as typeof fetch };
  assert.equal((await executeWorkerDiagnosis(JSON.parse(JSON.stringify(job)), {}, noProvider)).status, 403);
  assert.equal((await executeWorkerDiagnosis(job, { model: "public-override" }, noProvider)).status, 400);
  db.tables.sandy_auto_improve_runs[0].problem = "A different persisted failure description";
  assert.equal((await executeWorkerDiagnosis(job, {}, noProvider)).status, 503); assert.equal(db.audits.length, 0);
});
Deno.test("diagnosis preserves exact archived request policy, 65-second fixed transport, credentials and proposal-only handoff fields", async () => {
  const { db, job } = await setup("qa_failure"); db.tables.sandy_evidence_improvement_queue.push({ issue_key: "v2:auto_qa:actual-source-reference" });
  const original = await Deno.readTextFile("supabase/functions/sandy-auto-improve/legacy-policy-source.json");
  const pinned = JSON.parse(original); assert.equal(workerDiagnosisInstructions, pinned.instructions); assert.equal(await sha(workerDiagnosisInstructions), pinned.instructions_sha256);
  assert.deepEqual(diagnosisRequest("qa_failure", problem), { model: "gpt-5.2", store: false, reasoning: { effort: "high" }, instructions: pinned.instructions, input: "Provide a JSON diagnosis of this Sandy AI issue: " + JSON.stringify({ source_type: "qa_failure", problem }), text: { format: { type: "json_object" } }, max_output_tokens: 4500 });
  let timeout = 0; const originalTimeout = AbortSignal.timeout;
  AbortSignal.timeout = (milliseconds: number) => { timeout = milliseconds; return new AbortController().signal; };
  let result; try { result = await executeWorkerDiagnosis(job, {}, { db, openaiKey: "fixture-model", fetch: (async (url, init) => {
    assert.equal(String(url), "https://api.openai.com/v1/responses"); assert.equal(init?.method, "POST"); assert.equal(init?.redirect, undefined);
    assert.equal(new Headers(init?.headers).get("authorization"), "Bearer fixture-model"); assert.deepEqual(JSON.parse(String(init?.body)), diagnosisRequest("qa_failure", problem)); assert.ok(init?.signal);
    assert.equal(db.audits.length, 1); assert.equal(db.audits[0].state, "started"); assert.equal(db.tables.sandy_auto_improve_runs[0].status, "analysing"); return envelope();
  }) as typeof fetch }); } finally { AbortSignal.timeout = originalTimeout; }
  assert.equal(timeout, 65000);
  assert.equal(result.status, 200); assert.equal(result.body.operation, workerDiagnosisOperation); assert.equal(result.body.customer_id, null); assert.equal(result.body.auth_user_id, null);
  assert.equal(result.body.execution_verified, false); assert.equal(result.body.proposals_deployed, false);
  const handoff = db.tables.sandy_qa_engineering_handoffs[0]; assert.equal(handoff.approval_required, true); assert.deepEqual(handoff.verification, { status: "not_verified" }); assert.equal(handoff.evidence.proposal_only, true); assert.equal(handoff.evidence.diagnosis_id, JOB);
});
Deno.test("one atomic diagnosis job claim prevents concurrent, completed and unknown paid redispatch", async () => {
  const { db, job } = await setup(); let calls = 0;
  const deps = { db, openaiKey: "fixture-model", fetch: (async () => { calls++; return envelope(); }) as typeof fetch };
  const results = await Promise.all([executeWorkerDiagnosis(job, {}, deps), executeWorkerDiagnosis(job, {}, deps)]);
  assert.deepEqual(results.map(v => v.status).sort(), [200, 409]); assert.equal(calls, 1);
  assert.equal((await executeWorkerDiagnosis(job, {}, deps)).status, 409); assert.equal(calls, 1);
});
Deno.test("lost, malformed, failed or incomplete model results become unknown and cannot repeat after a failed hour", async () => {
  const invalid: (() => Promise<Response>)[] = [async () => { throw Error("fixture model result lost"); }, async () => Response.json({ id: "resp_x", status: "incomplete", output: [] }), async () => Response.json({ error: "private provider diagnostic must not be logged" }, { status: 502 }), async () => Response.json({ id: "resp_x", status: "failed", output: [] }), async () => Response.json({ id: "resp_x", output: [{ content: [{ type: "output_text", text: "not JSON" }] }] }), async () => Response.json({ id: "resp_x", output: [] })];
  for (const response of invalid) {
    const { db, job } = await setup(); let calls = 0;
    const deps = { db, openaiKey: "fixture-model", fetch: (async () => { calls++; return await response(); }) as typeof fetch };
    const first = await executeWorkerDiagnosis(job, {}, deps); assert.equal(first.status, 502); assert.equal(first.body.reconciliation_required, true); assert.equal(db.audits[0].state, "unknown");
    db.tables.sandy_auto_improve_runs[0].updated_at = "2000-01-01T00:00:00Z";
    const handler = createAutoImproveHandler({ ...deps, serviceCredential: "fixture-db-service", automationSecret: "fixture-dedicated-key" });
    assert.equal((await handler(request())).status, 409); assert.equal((await executeWorkerDiagnosis(job, {}, deps)).status, 409); assert.equal(calls, 1);
  }
});
Deno.test("lost claim or final receipt and committed save loss do not start a second model request or discard a proposal", async () => {
  for (const mode of ["claimLost", "finishLost", "saveLost"] as const) {
    const { db, job } = await setup(); db[mode] = true; let calls = 0;
    const deps = { db, openaiKey: "fixture-model", fetch: (async () => { calls++; return envelope(); }) as typeof fetch };
    const first = await executeWorkerDiagnosis(job, {}, deps); assert.equal(first.status, mode === "claimLost" ? 503 : 502);
    assert.equal(calls, mode === "claimLost" ? 0 : 1);
    if (mode !== "claimLost") assert.equal(db.tables.sandy_auto_improve_runs[0].status, "proposed");
    assert.equal((await executeWorkerDiagnosis(job, {}, deps)).status, 409); assert.equal(calls, mode === "claimLost" ? 0 : 1);
  }
});
Deno.test("QA diagnosis requires a real existing issue before paying and preserves proposals after a failed handoff", async () => {
  const { db, job } = await setup("qa_failure"); let calls = 0;
  const deps = { db, openaiKey: "fixture-model", fetch: (async () => { calls++; return envelope(); }) as typeof fetch };
  assert.equal((await executeWorkerDiagnosis(job, {}, deps)).legacy.error, "diagnosis_existing_qa_issue_required"); assert.equal(calls, 0); assert.equal(db.audits.length, 0);
  db.tables.sandy_evidence_improvement_queue.push({ issue_key: "v2:auto_qa:actual-source-reference" }); db.handoffLost = true;
  assert.equal((await executeWorkerDiagnosis(job, {}, deps)).status, 502); assert.equal(db.tables.sandy_auto_improve_runs[0].status, "proposed"); assert.deepEqual(db.tables.sandy_auto_improve_runs[0].proposed_fix, proposal);
  assert.equal(db.audits[0].state, "unknown"); assert.equal((await executeWorkerDiagnosis(job, {}, deps)).status, 409); assert.equal(calls, 1);
});

Deno.test("historical failed jobs never retry after an hour and missing provider configuration creates no paid claim", async () => {
  const { db, job } = await setup(); let calls = 0;
  const fetcher = (async () => { calls++; throw Error("must not execute"); }) as typeof fetch;
  assert.equal((await executeWorkerDiagnosis(job, {}, { db, openaiKey: "", fetch: fetcher })).status, 503);
  assert.equal(db.audits.length, 0); assert.equal(db.tables.sandy_auto_improve_runs[0].status, "queued");
  Object.assign(db.tables.sandy_auto_improve_runs[0], { status: "failed", updated_at: "2000-01-01T00:00:00Z" });
  const handler = createAutoImproveHandler({ db, serviceCredential: "fixture-db-service", automationSecret: "fixture-dedicated-key", openaiKey: "fixture-model", fetch: fetcher });
  const result = await handler(request()); assert.equal(result.status, 409); assert.equal((await result.json()).reconciliation_required, true);
  assert.equal(calls, 0); assert.equal(db.audits.length, 0);
});
