import { isMissionPlanningJob, type MissionPlanningJob } from "./worker_mission_planning_identity.ts";
import { missionClarificationOperation, missionPlanningOperation, missionPlanningVersion, validMissionPlanningInput, validMissionPlanningOutput } from "./worker_mission_planning_contract.ts";
import { missionClarificationRequest, missionPlanningRequest, missionPlanningSource } from "./worker_mission_planning_profiles.ts";
import { missionPlanMilestones, missionQuestionCandidates } from "./worker_mission_planning_records.ts";
import { fixedRuntimeResponses } from "./runtime_responses_transport.ts";
type Obj = Record<string, any>;
export type MissionPlanningDependencies = { db: any; openaiKey: string; fetch?: typeof fetch };
export type MissionPlanningOutcome = { status: number; body: Obj; legacy: Obj };
const object = (v: unknown): v is Obj => !!v && typeof v === "object" && !Array.isArray(v);
const first = (v: any) => Array.isArray(v) ? v[0] : v;
const digest = async (text: string) => Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)))).map(v => v.toString(16).padStart(2, "0")).join("");
// This proof is minted only from the real stored proposal/one-use review claim.
// It is deliberately distinct from customer, runtime and primary planner proofs.
const reviews = new WeakMap<object, { job: MissionPlanningJob; auditId: string; context: Obj }>();
type ReviewCapability = Readonly<{ operation: typeof missionClarificationOperation }>;
async function modelPayload(response: Response): Promise<Obj | null> {
  const reader = response.body?.getReader(); if (!reader) return null;
  const parts: Uint8Array[] = []; let size = 0;
  try { for (;;) { const item = await reader.read(); if (item.done) break; size += item.value.length; if (size > 2 * 1024 * 1024) { await reader.cancel(); return null; } parts.push(item.value); }
    const bytes = new Uint8Array(size); let offset = 0; for (const part of parts) { bytes.set(part, offset); offset += part.length; }
    const payload = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
    return object(payload) && typeof payload.id === "string" && payload.id.length > 0 && payload.id.length <= 512 && Array.isArray(payload.output) && payload.status !== "incomplete" && payload.status !== "failed" && payload.error == null ? payload : null;
  } catch { return null; }
}
function outputText(payload: Obj) { return payload.output.flatMap((v: any) => (Array.isArray(v?.content) ? v.content : []).filter((c: any) => c?.type === "output_text" && typeof c.text === "string").map((c: any) => c.text)).join(""); }
function common(job: MissionPlanningJob) { return { ok: true, contract_version: missionPlanningVersion, principal_kind: "trusted_internal_worker", auth_user_id: null, customer_id: job.customerId, mission_id: job.missionId, run_id: job.runId, external_actions_performed: 0, execution_verified: false }; }
/** Named internal application operation. JSON cannot manufacture this child
 * capability or select arbitrary questions, model, tenant or provider URL. */
export async function executeMissionClarificationReview(capability: ReviewCapability, args: Obj, deps: MissionPlanningDependencies): Promise<Obj> {
  const bound = capability && reviews.get(capability);
  if (!bound || !isMissionPlanningJob(bound.job)) throw Error("mission_recorded_review_capability_required");
  if (!validMissionPlanningInput(missionClarificationOperation, args)) throw Error("invalid_mission_review_arguments");
  reviews.delete(capability); // One invocation even when provider/receipt is lost.
  let reason = "review_exception", payload: Obj | null = null, keep: number[] | null = null;
  try {
    const response = await fixedRuntimeResponses(missionClarificationRequest(bound.context as any), deps.openaiKey, 18000, deps.fetch ?? fetch, false);
    if (!response.ok) reason = "provider_http_" + response.status;
    else {
      payload = await modelPayload(response);
      if (!payload) reason = "model_outcome_unverified";
      else {
        const raw = outputText(payload); reason = raw.trim() ? "invalid_model_result" : "empty_model_output";
        if (raw.trim()) { const parsed = JSON.parse(raw);
          if (object(parsed) && Array.isArray(parsed.keep_indexes) && parsed.keep_indexes.every((n: unknown) => Number.isInteger(n) && Number(n) >= 0 && Number(n) < bound.context.candidates.length)) { keep = [...new Set<number>(parsed.keep_indexes)]; reason = "reviewed"; }
        }
      }
    }
  } catch { reason = "review_exception"; }
  const saved = await deps.db.rpc("sandy_record_mission_question_review", { p_audit_id: bound.auditId, p_reason: reason, p_keep_indexes: keep,
    p_provider_response_id: payload?.id || null, p_response_sha256: payload ? await digest(JSON.stringify(payload)) : null });
  if (saved.error || first(saved.data)?.ok !== true) throw Error("mission_question_review_receipt_unavailable");
  const result = { ...common(bound.job), operation: missionClarificationOperation, review_status: keep ? "reviewed" : "unavailable", keep_indexes: keep || [], model_review_verified: keep !== null, reconciliation_required: keep === null };
  if (!validMissionPlanningOutput(missionClarificationOperation, result)) throw Error("mission_question_review_result_invalid");
  return result;
}
/** Actual queued planning job -> durable claim -> fixed model proposal -> optional
 * durable reviewer -> atomic draft plan/questions. No external tool executes. */
export async function executeMissionPlanning(job: MissionPlanningJob, args: Obj, deps: MissionPlanningDependencies): Promise<MissionPlanningOutcome> {
  const refused = (status: number, error: string, unknown = false): MissionPlanningOutcome => ({ status, body: { ok: false, operation: missionPlanningOperation, error, executed: unknown ? null : false, reconciliation_required: unknown }, legacy: { job: job?.runId || null, state: "failed", reason: error, ...(unknown ? { reconciliation_required: true } : {}) } });
  if (!isMissionPlanningJob(job)) return refused(403, "mission_planning_job_capability_required");
  if (!validMissionPlanningInput(missionPlanningOperation, args)) return refused(400, "invalid_mission_planning_arguments");
  if (!deps.openaiKey) return refused(503, "mission_planner_provider_not_configured");
  const reserved = await deps.db.rpc("sandy_prepare_mission_plan", { p_run_id: job.runId, p_customer_id: job.customerId, p_mission_id: job.missionId, p_source_sha256: missionPlanningSource.sourceSha256 });
  const claim = first(reserved.data);
  if (reserved.error || !claim?.id) {
    const unresolved = reserved.error?.message === "mission_plan_outcome_requires_reconciliation";
    // Fail only known, scoped pre-dispatch preconditions. A lost admission
    // response leaves its durable running claim untouched and cannot repeat.
    if (reserved.error?.code === "P0001") await deps.db.from("sandy_mission_runs").update({ state: unresolved ? "blocked" : "failed", error: unresolved ? "mission_plan_outcome_requires_reconciliation" : "mission_plan_precondition_failed", updated_at: new Date().toISOString() }).eq("id", job.runId).eq("customer_id", job.customerId).eq("mission_task_id", job.missionId).eq("state", "queued");
    return refused(unresolved ? 409 : 503, unresolved ? "mission_plan_outcome_requires_reconciliation" : "mission_plan_admission_unavailable", unresolved);
  }
  try {
    if (!object(claim.context) || !Array.isArray(claim.previous_questions)) throw Error("mission_planner_context_unavailable");
    const response = await fixedRuntimeResponses(missionPlanningRequest(claim.context as any), deps.openaiKey, 75000, deps.fetch ?? fetch, false);
    const payload = await modelPayload(response); if (!response.ok || !payload) throw Error("mission_planner_outcome_unverified");
    const raw = outputText(payload).trim(); let plan: Obj; try { plan = JSON.parse(raw); } catch { const match = raw.match(/\{[\s\S]*\}/); if (!match) throw Error("planner_invalid_json"); plan = JSON.parse(match[0]); }
    if (!object(plan)) throw Error("planner_invalid_json");
    const milestones = missionPlanMilestones(plan, job), candidates = missionQuestionCandidates(plan.questions_for_client, claim.previous_questions);
    const recorded = await deps.db.rpc("sandy_record_mission_plan_proposal", { p_audit_id: claim.id, p_plan_canonical: JSON.stringify(plan), p_milestones_canonical: JSON.stringify(milestones), p_candidates_canonical: JSON.stringify(candidates), p_provider_response_id: payload.id, p_response_sha256: await digest(JSON.stringify(payload)) });
    const proposal = first(recorded.data); if (recorded.error || !proposal?.ok) throw Error("mission_plan_proposal_receipt_unavailable");
    if (proposal.review_required === true) {
      if (!object(proposal.review_context)) throw Error("mission_recorded_review_context_unavailable");
      const capability = Object.freeze({ operation: missionClarificationOperation }); reviews.set(capability, { job, auditId: claim.id, context: proposal.review_context });
      await executeMissionClarificationReview(capability, {}, deps);
    }
    const finished = await deps.db.rpc("sandy_finish_mission_plan", { p_audit_id: claim.id, p_unknown: false });
    const result = first(finished.data); if (finished.error || result?.ok !== true) throw Error("mission_plan_final_receipt_unavailable");
    const body = { ...common(job), operation: missionPlanningOperation, outcome: result.new_questions ? "awaiting_client_information" : "awaiting_client_plan_review", created_milestones: result.created_milestones, new_questions: result.new_questions, clarification_review: result.clarification_review, requires_client_plan_review: true };
    if (!validMissionPlanningOutput(missionPlanningOperation, body)) throw Error("mission_plan_result_invalid");
    return { status: 200, body, legacy: { job: job.runId, state: "completed", milestones: result.created_milestones } };
  } catch {
    await deps.db.rpc("sandy_finish_mission_plan", { p_audit_id: claim.id, p_unknown: true });
    return refused(502, "mission_plan_outcome_requires_reconciliation", true);
  }
}
