import { Ajv } from "npm:ajv@8.17.1";
import { fullFormats } from "npm:ajv-formats@3.0.1/dist/formats.js";
export const workerDiagnosisOperation = "agent.reliability.diagnosis.propose";
export const workerDiagnosisVersion = "1.0.0";
export const workerDiagnosisContract = Object.freeze({
  description: "Propose a reliability diagnosis for an actual reserved internal job through the dedicated existing automation identity. No code, migration, deployment, payment or provider action is executed. A model proposal is unverified and requires separate approval.",
  permission_scope: "worker:reliability", internal_only: true, sensitive: true, is_mutation: true, consumes_model_resources: true,
  api_exposed: false, ui_exposed: false, ai_exposed: false, verified: false, requirements: [155, 160],
  input_schema: { type: "object", properties: {}, required: [], additionalProperties: false },
  output_schema: { type: "object", properties: {
    ok: { const: true }, operation: { const: workerDiagnosisOperation }, contract_version: { const: workerDiagnosisVersion },
    principal_kind: { const: "trusted_internal_worker" }, auth_user_id: { type: "null" }, customer_id: { type: "null" },
    job_id: { type: "string", format: "uuid" }, status: { const: "proposed" }, proposal_only: { const: true }, requires_approval: { const: true },
    provider_response_received: { const: true }, execution_verified: { const: false }, proposals_deployed: { const: false },
  }, required: ["ok", "operation", "contract_version", "principal_kind", "auth_user_id", "customer_id", "job_id", "status", "proposal_only", "requires_approval", "provider_response_received", "execution_verified", "proposals_deployed"], additionalProperties: false },
});
const ajv = new Ajv({ strict: false, formats: fullFormats });
const input = ajv.compile(workerDiagnosisContract.input_schema), output = ajv.compile(workerDiagnosisContract.output_schema);
export const validWorkerDiagnosisInput = (value: unknown) => input(value) === true;
export const validWorkerDiagnosisOutput = (value: unknown) => output(value) === true;
