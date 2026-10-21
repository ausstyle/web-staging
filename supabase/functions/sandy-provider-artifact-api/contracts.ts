import { argumentDigest } from "../_shared/sandy_api_protocol.ts";
export type Obj = Record<string, unknown>;
export const ARTIFACT_OPERATION = "provider.artifacts.read_private";
export const SOURCE_OPERATIONS = Object.freeze([
  "github.actions.jobs.logs.capture",
  "github.actions.jobs.steps.logs.capture",
  "github.actions.runs.attempts.logs.capture",
  "github.actions.runs.logs.capture",
  "github.actions.artifacts.download.capture",
  "gcp.artifacts.files.download.capture",
]);
const uuid = {
    type: "string",
    format: "uuid",
    pattern:
      "^[a-fA-F0-9]{8}-[a-fA-F0-9]{4}-[1-8][a-fA-F0-9]{3}-[89aAbB][a-fA-F0-9]{3}-[a-fA-F0-9]{12}$",
  },
  digest = { type: "string", pattern: "^[a-f0-9]{64}$" };
const object = (properties: Obj) => ({
  type: "object",
  properties,
  required: Object.keys(properties),
  additionalProperties: false,
});
const input = object({
  custody_id: uuid,
  expected_sha256: digest,
  source_operation: { enum: SOURCE_OPERATIONS },
  source_input_sha256: digest,
  source_scope_sha256: digest,
});
const result = object({
  custody_id: uuid,
  sha256: digest,
  byte_length: { type: "integer", minimum: 0, maximum: 1048576 },
  media_type: { type: "string", minLength: 1, maxLength: 100 },
  content_base64: {
    type: "string",
    maxLength: 1398104,
    pattern: "^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$",
  },
  source_operation: { enum: SOURCE_OPERATIONS },
  source_input_sha256: digest,
  source_scope_sha256: digest,
  artifact_class: { const: "provider_download" },
  consumed: { const: true },
  content_returned: { const: true },
});
const descriptor = {
  operation: ARTIFACT_OPERATION,
  contract_version: "1.0.0",
  handler: "sandy-provider-artifact-api",
  permission_scope: "infrastructure:write",
  is_mutation: false,
  requires_approval: true,
  requires_grant: true,
  api_key_delegable: false,
  input_schema: input,
  output_schema: object({
    ok: { const: true },
    operation: { const: ARTIFACT_OPERATION },
    contract_version: { const: "1.0.0" },
    request_state: { const: "delivered" },
    executed: { const: true },
    admission_id: uuid,
    result,
    reconciliation_required: { const: false },
  }),
};
export const artifactContract = Object.freeze({
  ...descriptor,
  contract_sha256: await argumentDigest(descriptor),
});
export const artifactOperations = Object.freeze({
  [ARTIFACT_OPERATION]: artifactContract,
});
export function artifactExecutionScope(operation: string, args: Obj): Obj {
  if (
    operation !== ARTIFACT_OPERATION ||
    typeof args.source_operation !== "string" ||
    !SOURCE_OPERATIONS.includes(args.source_operation)
  ) throw Error("artifact_source_class_required");
  return {
    provider: "sandy_private_artifacts",
    artifact_class: "provider_download",
    project_ref: "zmqlyygzqoidkcwdysok",
    custody_id: args.custody_id,
    expected_sha256: args.expected_sha256,
    source_operation: args.source_operation,
    source_input_sha256: args.source_input_sha256,
    source_scope_sha256: args.source_scope_sha256,
  };
}
