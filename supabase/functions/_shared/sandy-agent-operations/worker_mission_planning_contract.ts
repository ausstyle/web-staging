import { Ajv } from "npm:ajv@8.17.1";
import { fullFormats } from "npm:ajv-formats@3.0.1/dist/formats.js";
export const missionPlanningOperation = "agent.missions.plan.prepare";
export const missionClarificationOperation = "agent.missions.questions.review";
export const missionPlanningVersion = "1.0.0";
const privateFlags = { permission_scope: "worker:missions", internal_only: true, sensitive: true, is_mutation: true, consumes_model_resources: true,
  api_exposed: false, ui_exposed: false, ai_exposed: false, verified: false, requirements: [154, 155, 160] };
const common = { ok: { const: true }, contract_version: { const: missionPlanningVersion }, principal_kind: { const: "trusted_internal_worker" }, auth_user_id: { type: "null" },
  customer_id: { type: "string", format: "uuid" }, mission_id: { type: "string", format: "uuid" }, run_id: { type: "string", format: "uuid" }, external_actions_performed: { const: 0 }, execution_verified: { const: false } };
export const internalMissionPlanningContracts = Object.freeze({
  [missionPlanningOperation]: { ...privateFlags,
    description: "Prepare a reversible mission plan for the actual stored planning job, preserving client tasks, completed work, answered questions and approval gates. No external tools execute; client plan review is required.",
    input_schema: { type: "object", properties: {}, required: [], additionalProperties: false },
    output_schema: { type: "object", properties: { ...common, operation: { const: missionPlanningOperation },
      outcome: { enum: ["awaiting_client_information", "awaiting_client_plan_review"] }, created_milestones: { type: "integer", minimum: 3, maximum: 7 }, new_questions: { type: "integer", minimum: 0, maximum: 8 },
      clarification_review: { type: "string", minLength: 1, maxLength: 80 }, requires_client_plan_review: { const: true } },
      required: [...Object.keys(common), "operation", "outcome", "created_milestones", "new_questions", "clarification_review", "requires_client_plan_review"], additionalProperties: false },
  },
  [missionClarificationOperation]: { ...privateFlags,
    description: "Review the actual recorded planning proposal's candidate questions against authoritative answered questions. Task-bound process-local capability only; unavailable/unknown review is explicit and never repeated automatically.",
    input_schema: { type: "object", properties: {}, required: [], additionalProperties: false },
    output_schema: { type: "object", properties: { ...common, operation: { const: missionClarificationOperation },
      review_status: { enum: ["reviewed", "unavailable"] }, keep_indexes: { type: "array", maxItems: 8, uniqueItems: true, items: { type: "integer", minimum: 0, maximum: 7 } }, model_review_verified: { type: "boolean" },
      reconciliation_required: { type: "boolean" } },
      required: [...Object.keys(common), "operation", "review_status", "keep_indexes", "model_review_verified", "reconciliation_required"],
      allOf: [{ if: { properties: { review_status: { const: "reviewed" } } }, then: { properties: { model_review_verified: { const: true }, reconciliation_required: { const: false } } }, else: { properties: { model_review_verified: { const: false } } } }], additionalProperties: false },
  },
});
const ajv = new Ajv({ strict: false, formats: fullFormats });
const entries = new Map(Object.entries(internalMissionPlanningContracts).map(([name, contract]) => [name, { input: ajv.compile(contract.input_schema), output: ajv.compile(contract.output_schema) }]));
export const validMissionPlanningInput = (operation: string, value: unknown) => entries.get(operation)?.input(value) === true;
export const validMissionPlanningOutput = (operation: string, value: unknown) => entries.get(operation)?.output(value) === true;
