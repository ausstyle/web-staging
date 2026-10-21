/** Internal application operation. A contract is not a customer session, and
 * this metadata must never enable a public caller to select a legacy profile. */
export const runtimeConversationOperation = "agent.runtime.conversation.respond";
export const runtimeConversationVersion = "1.0.0";
export const runtimeConversationContract = Object.freeze({
  operation: runtimeConversationOperation,
  version: runtimeConversationVersion,
  permission_scope: "runtime:conversation",
  is_mutation: true,
  consumes_model_resources: true,
  sensitive: true,
  api_exposed: false,
  ui_exposed: false,
  ai_exposed: false,
  requirements: [151, 160],
  input_schema: {
    type: "object",
    properties: {
      round: { type: "integer", minimum: 0, maximum: 3 },
      tool_results: {
        type: "array", maxItems: 200,
        items: {
          type: "object",
          properties: {
            type: { const: "function_call_output" },
            call_id: { type: "string", minLength: 1, maxLength: 512 },
            output: { type: "string", maxLength: 2 * 1024 * 1024 },
          },
          required: ["type", "call_id", "output"], additionalProperties: false,
        },
      },
    },
    required: ["round", "tool_results"], additionalProperties: false,
  },
  output_schema: {
    type: "object",
    properties: {
      ok: { const: true },
      operation: { const: runtimeConversationOperation },
      contract_version: { const: runtimeConversationVersion },
      principal_kind: { const: "trusted_runtime" },
      customer_id: { type: ["string", "null"], format: "uuid" },
      task_id: { type: "string", format: "uuid" },
      round: { type: "integer", minimum: 0, maximum: 3 },
      selected_model: { type: "string", minLength: 1, maxLength: 200 },
      response: {
        type: "object",
        properties: {
          id: { type: "string", minLength: 1, maxLength: 512 },
          output: { type: "array", maxItems: 200, items: { type: "object" } },
        },
        required: ["id", "output"], additionalProperties: true,
      },
    },
    required: ["ok", "operation", "contract_version", "principal_kind", "customer_id", "task_id", "round", "selected_model", "response"],
    additionalProperties: false,
  },
});
