import assert from "node:assert/strict";
import { missionPlanningRequest, missionClarificationRequest, missionPlanningInstructions, missionClarificationInstructions, missionPlanningTimeout, missionClarificationTimeout, missionPlanningSource } from "./worker_mission_planning_profiles.ts";
import { missionQuestionCandidates, missionPlanMilestones } from "./worker_mission_planning_records.ts";
import { internalMissionPlanningContracts, missionPlanningOperation, missionClarificationOperation, validMissionPlanningInput, validMissionPlanningOutput } from "./worker_mission_planning_contract.ts";
Deno.test("planning profiles preserve exact archived instruction policy and separate75/18-second phases", async () => {
  const pinned = JSON.parse(await Deno.readTextFile("supabase/functions/sandy-mission-runner/legacy-policy-source.json"));
  assert.equal(pinned.source_sha256, missionPlanningSource.sourceSha256); assert.equal(missionPlanningInstructions, pinned.planner.instructions); assert.equal(missionClarificationInstructions, pinned.clarification_reviewer.instructions);
  assert.equal(missionPlanningTimeout, 75000); assert.equal(missionClarificationTimeout, 18000);
  for (const [instructions, expected] of [[missionPlanningInstructions, pinned.planner.instructions_sha256], [missionClarificationInstructions, pinned.clarification_reviewer.instructions_sha256]]) {
    const digest = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(instructions)))).map(v => v.toString(16).padStart(2, "0")).join(""); assert.equal(digest, expected);
  }
});
Deno.test("planner keeps actual tasks, answered context and tool readiness but never claims attached file contents inspected", () => {
  const mission = { title: "Actual project", details: "Prepare a reversible administrative draft", metadata: { revision_feedback: "Keep answered facts", plan_summary: "Existing reviewed summary" } }, steps = [{ id: "actual-task", status: "completed", owner: "client" }], tools = [{ tool_key: "openai_web_search", readiness: "unverified" }], answered = [{ question: "What is already decided?", answer: "Use editable defaults" }];
  const body = missionPlanningRequest({ mission, steps, availableTools: tools, documents: [{ filename: "provided.pdf", mime_type: "application/pdf", content: "fixture document bytes were not inspected", storage_path: "private/path" }], answered });
  assert.equal(body.model, "gpt-4.1-mini"); assert.equal(body.max_output_tokens, 1600); assert.equal(Object.hasOwn(body, "store"), false);
  const input = JSON.parse(body.input); assert.deepEqual(input.existing_tasks, steps); assert.deepEqual(input.available_tools, tools); assert.deepEqual(input.client_answers, answered);
  assert.deepEqual(input.uploaded_documents, [{ filename: "provided.pdf", type: "application/pdf", content_inspected: false }]); assert.equal(body.input.includes("fixture document bytes"), false); assert.equal(body.input.includes("private/path"), false);
});
Deno.test("clarification profile uses authoritative last25 answered questions with original500-character bounds", () => {
  const answered = Array.from({ length: 30 }, (_, i) => ({ status: "answered", question: "Question " + i + "x".repeat(600), answer: "Answer " + i + "y".repeat(600) }));
  answered.push({ status: "open", question: "Unanswered is not authority", answer: "not actually answered" });
  const body = missionClarificationRequest({ answered, candidates: [{ question: "A genuinely new decision-blocking question?" }] });
  assert.equal(body.store, false); assert.equal(body.max_output_tokens, 900); assert.equal(body.model, "gpt-4.1-mini");
  const input = JSON.parse(body.input); assert.equal(input.answered.length, 25); assert.match(input.answered[0].question, /^Question 5/); assert.ok(input.answered.every((q: any) => q.question.length === 500 && q.answer.length === 500));
  assert.equal(body.input.includes("not actually answered"), false); assert.deepEqual(input.candidates, ["A genuinely new decision-blocking question?"]);
});
Deno.test("same-batch question-key collisions cannot violate the actual unique mission/question constraint or repeat prior questions", () => {
  const known = [{ question_key: "already answered question?", status: "answered", answer: "Settled" }, { question_key: "cancelled question?", status: "cancelled" }];
  const result = missionQuestionCandidates([" Already   answered question? ", "Cancelled question?", "A new decision question?", "a NEW decision question?", "tiny", null, "A separate useful question?"], known);
  assert.deepEqual(result.map(q => q.question_key), ["a new decision question?", "a separate useful question?"]); assert.equal(new Set(result.map(q => q.question_key)).size, result.length);
});
Deno.test("milestone normalization preserves actor approval gates and bounded within-plan dependencies without executing tools", () => {
  const plan = { milestones: [{ title: "Client decision", actor: "client", requires_approval: false, depends_on: [] }, { title: "Internal draft", actor: "sandy", requires_approval: false, depends_on: [1, 2, 3, 9, "1"], suggested_tool: "research_web" }, { title: "Third-party step", actor: "third_party", requires_approval: false, suggested_tool: "arbitrary_tool" }] };
  const steps = missionPlanMilestones(plan, { customerId: "actual-fixture-customer", missionId: "actual-fixture-mission", runId: "actual-fixture-run" });
  assert.deepEqual(steps.map(s => s.status), ["waiting", "todo", "waiting"]); assert.equal(steps[2].metadata.approval_required, true); assert.equal(steps[2].metadata.suggested_tool, "none"); assert.deepEqual(steps[1].metadata.depends_on, [1, 3]); assert.ok(steps.every(s => s.metadata.tool_execution_state === "not_executed"));
  assert.throws(() => missionPlanMilestones({ milestones: [] }, { customerId: "fixture", missionId: "fixture", runId: "fixture" }), /planner_bad_milestones/);
});
Deno.test("both planning contracts remain closed and unavailable model review cannot masquerade as verified review", () => {
  for (const [name, contract] of Object.entries(internalMissionPlanningContracts)) {
    assert.ok(contract.internal_only && contract.sensitive && contract.is_mutation && contract.consumes_model_resources); assert.equal(contract.api_exposed || contract.ui_exposed || contract.ai_exposed || contract.verified, false);
    assert.equal(validMissionPlanningInput(name, {}), true); assert.equal(validMissionPlanningInput(name, { customer_id: "invented", model: "another" }), false);
  }
  const base = { ok: true, contract_version: "1.0.0", principal_kind: "trusted_internal_worker", auth_user_id: null, customer_id: "b1000000-0000-4000-8000-000000000001", mission_id: "b2000000-0000-4000-8000-000000000001", run_id: "b3000000-0000-4000-8000-000000000001", external_actions_performed: 0, execution_verified: false, operation: missionClarificationOperation, keep_indexes: [] };
  assert.equal(validMissionPlanningOutput(missionClarificationOperation, { ...base, review_status: "unavailable", model_review_verified: false, reconciliation_required: true }), true);
  assert.equal(validMissionPlanningOutput(missionClarificationOperation, { ...base, review_status: "reviewed", model_review_verified: false, reconciliation_required: false }), false);
  assert.equal(validMissionPlanningInput(missionPlanningOperation, { executor: "arbitrary" }), false);
});
