// Central pure normalization for original mission planning behavior. No model,
// tool or record write is performed by these utilities.
type Obj = Record<string, any>;
export function missionQuestionCandidates(questions: unknown, previousQuestions: Obj[]) {
  const known = new Set(previousQuestions.map(q => q.question_key)), output: { question: string; question_key: string }[] = [];
  for (const candidate of (Array.isArray(questions) ? questions : []).filter(q => typeof q === "string" && q.trim().length > 8).slice(0, 8)) {
    const question = String(candidate).trim().slice(0, 1000), question_key = String(candidate).toLowerCase().replace(/\s+/g, " ").trim().slice(0, 500);
    if (known.has(question_key)) continue;
    // The archived implementation only deduped against prior rows. Duplicate
    // keys in one model batch violated the real unique(mission,question_key)
    // constraint after partial writes; keep the first candidate once.
    known.add(question_key); output.push({ question, question_key });
  }
  return output;
}
export function missionPlanMilestones(plan: Obj, job: { customerId: string; missionId: string; runId: string }) {
  if (!Array.isArray(plan.milestones) || plan.milestones.length < 3 || plan.milestones.length > 7 || plan.milestones.some((s: unknown) => !s || typeof s !== "object" || Array.isArray(s))) throw Error("planner_bad_milestones");
  return plan.milestones.map((s: Obj, index: number) => ({ customer_id: job.customerId, parent_task_id: job.missionId,
    title: String(s.title || "Milestone " + (index + 1)).slice(0, 240), details: String(s.description || "").slice(0, 2500), status: s.requires_approval || s.actor !== "sandy" ? "waiting" : "todo", priority: "normal",
    metadata: { sandy_mission_step: true, assigned_to: s.actor === "client" ? "client" : s.actor === "third_party" ? "external" : "sandy", approval_required: s.requires_approval === true || s.actor === "third_party", stage: "planned", mission_run_id: job.runId, plan_index: index + 1,
      suggested_tool: ["research_web", "search_customer_documents", "draft_execution_plan", "request_image_approval"].includes(String(s.suggested_tool || "")) ? String(s.suggested_tool) : "none", tool_execution_state: "not_executed",
      depends_on: Array.isArray(s.depends_on) ? s.depends_on.filter((n: unknown) => Number.isInteger(n) && Number(n) >= 1 && Number(n) <= plan.milestones.length && n !== index + 1).slice(0, 6) : [] } }));
}
