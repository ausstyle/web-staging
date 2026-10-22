import { Ajv } from "npm:ajv@8.17.1";
import { fullFormats } from "npm:ajv-formats@3.0.1/dist/formats.js";
import type { AgentOperationContract } from "./contracts.ts";
type Obj = Record<string, unknown>;
const uuid = { type: "string", format: "uuid" };
const text = (maxLength: number, minLength = 0) => ({ type: "string", minLength, maxLength });
const nullable = (schema: Obj) => ({ anyOf: [schema, { type: "null" }] });
const object = (properties: Obj, required = Object.keys(properties)): Obj => ({ type: "object", properties, required, additionalProperties: false });
const records = (limit: number, properties: Obj) => object({ records: { type: "array", maxItems: limit, items: { type: "object", properties, additionalProperties: false } } });
const key = { type: "string", pattern: "^[a-zA-Z0-9_.:-]{8,160}$" };
type Internal = AgentOperationContract & { internal_only: true; sensitive: true; api_exposed: false; ai_exposed: false; ui_exposed: false };
function contract(description: string, requirements: number[], input_schema: Obj, result: Obj, mutation = false): Internal {
  return {
    permission_scope: "runtime:records", is_mutation: mutation, consumes_model_resources: false, owner_only: false,
    internal_only: true, sensitive: true, api_exposed: false, ui_exposed: false, ai_exposed: false,
    input_schema,
    output_schema: object({ ok: { const: true }, contract_version: { const: "1.0.0" },
      principal_kind: { const: "trusted_runtime" }, task_id: uuid, result }),
    requirements, description,
  };
}
// Separate from agentOperationContracts: the public agent API and its catalogue
// still expose only their existing eight entries. JSON cannot obtain this scope.
export const internalRuntimeRecordContracts: Readonly<Record<string, Internal>> = Object.freeze({
  "agent.runtime.tasks.list": contract("List actual outstanding tenant tasks, exact total, priority/deadline and stored participant/delegation context; todo is not reported as in progress.", [153], object({}), object({
    outstanding_count: { type: "integer", minimum: 0 }, shown_count: { type: "integer", minimum: 0, maximum: 150 }, definition: text(1000, 1),
    status_breakdown: { type: "object", additionalProperties: { type: "integer", minimum: 0 } },
    in_progress_count: { type: "integer", minimum: 0, maximum: 150 }, todo_is_in_progress: { const: false },
    tasks: { type: "array", maxItems: 150, items: object({ id: uuid, title: text(1000), status: text(100),
      priority: nullable(text(100)), due_at: nullable(text(100)), responsible_customer_id: nullable(uuid),
      delegations: { type: "array", items: object({ assignee: text(1000), status: text(100), scope: {} }, ["assignee", "status"]) },
      participants: { type: "array", items: object({ role: text(100), status: text(100), customer_id: uuid }) },
    }, ["id", "title", "status", "delegations", "participants"]) },
  })),
  "agent.runtime.tasks.request_client_action": contract("Create or reuse a client-owned action under an actual customer-owned Sandy mission; no generic/duplicate requests or provider work.", [153, 154],
    object({ mission_id: uuid, title: text(240, 3), details: text(4000), idempotency_key: key }),
    object({ ok: { const: true }, task_id: uuid, already_exists: { const: true } }, ["ok", "task_id"]), true),
  "agent.runtime.history.search": contract("Read at most eight matches from the existing tenant-bound unified history RPC, preserving provenance and 1500-character content snippets.", [151, 152], object({ query: text(120, 2) }),
    object({ matches: { type: "array", maxItems: 8, items: { type: "object", properties: { content: text(1500) }, required: ["content"], additionalProperties: true } } })),
  "agent.runtime.images.request_approval": contract("Create or reuse an explicit client cost-approval task beneath an actual Sandy mission. Does not generate an image or consume model/provider units.", [153, 154, 160],
    object({ mission_id: uuid, prompt: text(2000, 5), idempotency_key: key }),
    object({ ok: { const: true }, approval_pending: { const: true }, task_id: uuid }), true),
  "agent.runtime.connections.list": contract("List stored active customer/workspace connections and existing connector configuration. Stored connection/configuration is not independent evidence of provider access or execution.", [145], object({}),
    object({ services: { type: "array", maxItems: 100, items: object({ service: text(300, 1), account_id: text(500, 1), workspace: text(1000), connector_enabled: { type: "boolean" },
      capabilities: { type: "array", maxItems: 10, items: text(200) }, send_workflow: text(1000),
    }, ["service", "account_id", "workspace", "connector_enabled", "capabilities"]) } })),
  "agent.runtime.context.tasks.find": contract("Read at most eight unarchived customer tasks matching the bounded task-relevant title lookup; caller cannot select a table or another customer.", [153], object({ query: text(180, 3) }),
    records(8, { id: uuid, title: text(1000), status: text(100), priority: nullable(text(100)), updated_at: nullable(text(100)) })),
  "agent.runtime.context.tasks.get": contract("Read one actual tenant-owned unarchived task by ID for the existing runtime narrow context tool.", [153], object({ id: uuid }),
    records(1, { id: uuid, title: text(1000), details: nullable({ type: "string" }), status: text(100), priority: nullable(text(100)), due_at: nullable(text(100)), parent_task_id: nullable(uuid) })),
  "agent.runtime.context.files.find": contract("Read at most eight customer-owned file metadata records through the original bounded narrow lookup; excludes deleted and archived records and does not fetch contents.", [156], object({ query: text(180, 3) }),
    records(8, { id: uuid, display_name: text(1000), mime_type: nullable(text(500)), description: nullable({ type: "string" }), created_at: nullable(text(100)), library_state: nullable(text(100)) })),
  "agent.runtime.context.memory.search": contract("Read at most five active customer-owned memory snippets through the original narrow lookup, preserving channel/time and truncating content to 900 characters.", [152], object({ query: text(180, 3) }),
    records(5, { id: uuid, channel: text(100), content: text(900), occurred_at: nullable(text(100)) })),
});
const ajv = new Ajv({ strict: false, formats: fullFormats });
const inputs = new Map(Object.entries(internalRuntimeRecordContracts).map(([name, item]) => [name, ajv.compile(item.input_schema)]));
const outputs = new Map(Object.entries(internalRuntimeRecordContracts).map(([name, item]) => [name, ajv.compile(item.output_schema)]));
export const validRuntimeRecordInput = (operation: string, value: unknown) => inputs.get(operation)?.(value) === true;
export const validRuntimeRecordOutput = (operation: string, value: unknown) => outputs.get(operation)?.(value) === true;
