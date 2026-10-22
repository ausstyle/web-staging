import { Ajv } from "npm:ajv@8.17.1";
import { fullFormats } from "npm:ajv-formats@3.0.1/dist/formats.js";
type Obj = Record<string, unknown>;
const str = (maxLength: number, minLength = 1) => ({ type: "string", minLength, maxLength });
const uuid = { type: "string", format: "uuid" };
const obj = (properties: Obj, required = Object.keys(properties)): Obj =>
  ({ type: "object", properties, required, additionalProperties: false });
const result = (properties: Obj, required = Object.keys(properties)): Obj => obj({
  ok: { const: true }, contract_version: { const: "1.0.0" }, ...properties,
}, ["ok", "contract_version", ...required]);
const identity = { principal_kind: { enum: ["auth_user", "trusted_runtime"] },
  task_id: { type: ["string", "null"], format: "uuid" } };
const withIdentity = (properties: Obj, required = Object.keys(properties)) =>
  result({ ...properties, ...identity }, [...required, ...Object.keys(identity)]);
const key = { type: "string", pattern: "^[a-zA-Z0-9_.:-]{8,160}$" };
export type AgentOperationContract = {
  permission_scope: string; is_mutation: boolean; consumes_model_resources: boolean;
  owner_only: boolean; input_schema: Obj; output_schema: Obj; requirements: number[];
  description: string;
};
export const agentOperationContracts: Readonly<Record<string, AgentOperationContract>> = Object.freeze({
  "gmail.messages.search": {
    permission_scope: "gmail:read", is_mutation: false, consumes_model_resources: false, owner_only: false,
    input_schema: obj({ query: str(250), workspace: str(200, 0) }, ["query"]),
    output_schema: withIdentity({ read_only: { const: true }, data: str(18000, 0) }),
    requirements: [147, 160],
    description: "Search the authenticated customer's single active Gmail account in the selected personal/company workspace; fixed Composio read tool, at most ten results.",
  },
  "gmail.messages.recent": {
    permission_scope: "gmail:read", is_mutation: false, consumes_model_resources: false, owner_only: false,
    input_schema: obj({ limit: { type: "integer", minimum: 1, maximum: 25 } }),
    output_schema: withIdentity({ response: str(14000, 0), details: obj({
      provider_status: { type: "integer", minimum: 100, maximum: 599 },
      returned: { type: "integer", minimum: 0, maximum: 25 }, requested: { type: "integer", minimum: 1, maximum: 25 },
      pages: { type: "integer", minimum: 0, maximum: 20 }, has_more_pages: { type: "boolean" },
      provider_error: { type: ["string", "null"] },
    }), read_only: { const: true } }),
    requirements: [147, 160],
    description: "Read distinct recent inbox message summaries from the customer's single active Personal Gmail account, with bounded pagination and truthful partial-provider evidence.",
  },
  "gmail.drafts.prepare": {
    permission_scope: "gmail:write", is_mutation: true, consumes_model_resources: false, owner_only: false,
    input_schema: obj({ to: str(254), subject: str(300), body: str(12000), workspace: str(200, 0),
      account_id: str(300, 0), idempotency_key: key }, ["to", "subject", "body", "idempotency_key"]),
    output_schema: withIdentity({ awaiting_confirmation: { const: true }, draft_id: uuid,
      to: str(254), subject: str(300), body: str(12000), workspace: str(200), account_id: str(300), instruction: str(300) }),
    requirements: [147],
    description: "Persist the exact customer-owned Gmail draft for separate explicit confirmation; does not send. Tenant-bound idempotency prevents duplicate drafts after an interrupted request.",
  },
  "gmail.drafts.confirm_send": {
    permission_scope: "gmail:send", is_mutation: true, consumes_model_resources: false, owner_only: false,
    input_schema: obj({ draft_id: uuid, confirmation: str(100) }),
    output_schema: withIdentity({ text: str(2000), state: { const: "sent" }, success: { const: true },
      message_id: { type: "string", pattern: "^[a-fA-F0-9]{8,64}$" }, sent_mail_verified: { const: true },
      duplicate_prevented: { type: "boolean" } }, ["text", "state", "success", "message_id", "sent_mail_verified"]),
    requirements: [147],
    description: "Send only an explicitly confirmed, immutable customer-owned saved Gmail draft. Atomic claim forbids repeat send attempts; success requires matching provider message ID, recipient, subject and independent Sent Mail verification.",
  },
  "agent.web.research": {
    permission_scope: "agent:execute", is_mutation: true, consumes_model_resources: true, owner_only: false,
    input_schema: obj({ query: str(2000, 4), idempotency_key: key }),
    output_schema: withIdentity({ answer: str(24000), citations: { type: "array", maxItems: 100,
      items: obj({ title: str(2000, 0), url: { type: "string", format: "uri", maxLength: 4000 } }) } }),
    requirements: [160], description: "Research public web information through the existing fixed Sandy model broker and enabled web-search feature flag; bounded paid model use, citations preserved.",
  },
  "agent.documents.search": {
    permission_scope: "agent:execute", is_mutation: true, consumes_model_resources: true, owner_only: false,
    input_schema: obj({ query: str(1000, 3), idempotency_key: key }),
    output_schema: withIdentity({ answer: str(24000), citations: { type: "array", maxItems: 100,
      items: obj({ file_id: str(300), filename: str(1000, 0) }) } }),
    requirements: [156, 160], description: "Search only the authenticated customer's independently verified vector store through the existing fixed Sandy model broker; caller cannot supply a store ID.",
  },
  "agent.evaluations.list": {
    permission_scope: "controller:read", is_mutation: false, consumes_model_resources: false, owner_only: true,
    input_schema: obj({}), output_schema: withIdentity({ items: { type: "array", maxItems: 20,
      items: obj({ id: str(300), name: str(2000), created_at: { type: "integer", minimum: 0 } }) }, read_only: { const: true } }),
    requirements: [155, 160], description: "Owner-only read of at most twenty project-wide OpenAI evaluation definitions, controlled by the existing eval feature flag. No evaluations are run.",
  },
  "agent.execution_plan.draft": {
    permission_scope: "agent:execute", is_mutation: true, consumes_model_resources: true, owner_only: false,
    input_schema: obj({ goal: str(3000, 5), idempotency_key: key }),
    output_schema: withIdentity({ plan: str(24000), executed: { const: false } }),
    requirements: [154, 160], description: "Draft a dependency-aware plan through the existing fixed model broker with planning-only instructions and bounded model use; does not execute plan actions.",
  },
});
const ajv = new Ajv({ strict: true, allErrors: false, validateFormats: true });
for (const [name, format] of Object.entries(fullFormats)) ajv.addFormat(name, format);
const inputs = new Map(Object.entries(agentOperationContracts).map(([id, c]) => [id, ajv.compile(c.input_schema)]));
const outputs = new Map(Object.entries(agentOperationContracts).map(([id, c]) => [id, ajv.compile(c.output_schema)]));
export const validAgentInput = (id: string, args: unknown): boolean => inputs.get(id)?.(args) === true;
export const validAgentOutput = (id: string, value: unknown): boolean => outputs.get(id)?.(value) === true;
const canonical = (value: any): string => JSON.stringify(value && typeof value === "object" ?
  (Array.isArray(value) ? value.map((item) => JSON.parse(canonical(item))) :
    Object.fromEntries(Object.keys(value).sort().map((name) => [name, JSON.parse(canonical(value[name]))]))) : value);
export function agentContractMatches(id: string, entry: Record<string, unknown>): boolean {
  const c = agentOperationContracts[id];
  return !!c && entry.handler === "sandy-agent-operation-api" &&
    entry.permission_scope === c.permission_scope && entry.is_mutation === c.is_mutation &&
    canonical(entry.input_schema) === canonical(c.input_schema) &&
    canonical(entry.output_schema) === canonical(c.output_schema);
}
