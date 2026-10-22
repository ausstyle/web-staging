import { Ajv } from "npm:ajv@8.17.1";
import { fullFormats } from "npm:ajv-formats@3.0.1/dist/formats.js";
import type { AgentOperationContract } from "./contracts.ts";
export const runtimeConnectionPreflightOperationName = "agent.runtime.connections.preflight";
export const runtimeConnectionInspectOperationName = "agent.runtime.connections.inspect";
const count = { type: "integer", minimum: 0, maximum: 100 };
export const runtimeConnectionPreflightContract: AgentOperationContract & { internal_only: true; sensitive: true; api_exposed: false; ui_exposed: false; ai_exposed: false } = Object.freeze({
  description: "Check the task-bound customer's recorded connections against one complete identity-bound Composio page. Record scoped discrepancies and optionally schedule the existing private diagnosis workflow; never claim repair or diagnosis completion.",
  permission_scope: "runtime:connections", is_mutation: true, consumes_model_resources: true, owner_only: false,
  internal_only: true, sensitive: true, api_exposed: false, ui_exposed: false, ai_exposed: false,
  requirements: [145, 155, 160],
  input_schema: { type: "object", properties: { idempotency_key: { type: "string", pattern: "^[a-zA-Z0-9_.:-]{8,160}$" } }, required: ["idempotency_key"], additionalProperties: false },
  output_schema: { type: "object", properties: {
    ok: { const: true }, contract_version: { const: "1.0.0" }, principal_kind: { const: "trusted_runtime" }, task_id: { type: "string", format: "uuid" },
    result: { type: "object", properties: {
      response: { type: "string", minLength: 1, maxLength: 65536 }, success: { type: "boolean" }, provider_check: { enum: ["confirmed", "unavailable"] },
      records: count, mismatches: count, findings_recorded: count, diagnosis_requests_scheduled: count, diagnosis_completed: { const: false },
    }, required: ["response", "success", "provider_check", "records", "mismatches", "findings_recorded", "diagnosis_requests_scheduled", "diagnosis_completed"], additionalProperties: false },
  }, required: ["ok", "contract_version", "principal_kind", "task_id", "result"], additionalProperties: false },
});
const ajv = new Ajv({ strict: false, formats: fullFormats });
export const runtimeConnectionInspectContract = Object.freeze({...runtimeConnectionPreflightContract,
  description:"Inspect task-bound provider connections without discrepancy writes or automatic diagnosis.",is_mutation:false,consumes_model_resources:false});
const input = ajv.compile(runtimeConnectionPreflightContract.input_schema), output = ajv.compile(runtimeConnectionPreflightContract.output_schema);
export const validRuntimeConnectionPreflightInput = (_name: string, value: unknown) => input(value) === true;
export const validRuntimeConnectionPreflightOutput = (_name: string, value: unknown) => output(value) === true;
