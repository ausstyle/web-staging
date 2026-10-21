import { Ajv } from "npm:ajv@8.17.1";
import { fullFormats } from "npm:ajv-formats@3.0.1/dist/formats.js";
export const missionWorkProductOperation = "agent.missions.work_product.prepare";
export const missionWorkProductVersion = "1.0.0";
export const missionWorkProductContract = Object.freeze({
  description: "Prepare one internal draft for the actual dependency-ready Sandy-owned mission milestone, then create a client review record. Preserve provisional/approved plan gates. No research, file inspection, communication, payment or external action is performed.",
  permission_scope: "worker:missions", internal_only: true, sensitive: true, is_mutation: true, consumes_model_resources: true,
  api_exposed: false, ui_exposed: false, ai_exposed: false, verified: false, requirements: [154, 155, 160],
  input_schema: { type: "object", properties: {}, required: [], additionalProperties: false },
  output_schema: { type: "object", properties: {
    ok: { const: true }, operation: { const: missionWorkProductOperation }, contract_version: { const: missionWorkProductVersion }, principal_kind: { const: "trusted_internal_worker" }, auth_user_id: { type: "null" },
    customer_id: { type: "string", format: "uuid" }, run_id: { type: "string", format: "uuid" }, mission_id: { type: "string", format: "uuid" },
    outcome: { enum: ["draft_pending_review", "waiting"] }, work_product_id: { type: ["string", "null"], format: "uuid" },
    waiting_reason: { enum: [null, "no_eligible_internal_step", "blocked_by_milestone_dependencies"] }, requires_client_review: { const: true }, external_actions_performed: { const: 0 }, execution_verified: { const: false },
  }, required: ["ok", "operation", "contract_version", "principal_kind", "auth_user_id", "customer_id", "run_id", "mission_id", "outcome", "work_product_id", "waiting_reason", "requires_client_review", "external_actions_performed", "execution_verified"], additionalProperties: false },
});
const ajv = new Ajv({ strict: false, formats: fullFormats });
const input = ajv.compile(missionWorkProductContract.input_schema), output = ajv.compile(missionWorkProductContract.output_schema);
export const validMissionWorkProductInput = (value: unknown) => input(value) === true;
export const validMissionWorkProductOutput = (value: unknown) => output(value) === true;
