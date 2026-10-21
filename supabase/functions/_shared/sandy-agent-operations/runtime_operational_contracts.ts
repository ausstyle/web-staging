import { Ajv } from "npm:ajv@8.17.1";
import { fullFormats } from "npm:ajv-formats@3.0.1/dist/formats.js";
import type { AgentOperationContract } from "./contracts.ts";
type Obj = Record<string, unknown>;
const text = { type: "string" };
const optionalText = { type: ["string", "null"] };
const count = { type: ["integer", "null"], minimum: 0 };
const obj = (properties: Obj, required = Object.keys(properties), additionalProperties = false): Obj => ({ type: "object", properties, required, additionalProperties });
const ok = (properties: Obj, required = Object.keys(properties), additionalProperties = false) => obj({ ok: { const: true }, ...properties }, ["ok", ...required], additionalProperties);
const jsonRecords = (maxItems: number) => ({ type: "array", maxItems, items: { type: "object" } });
type Operational = AgentOperationContract & { internal_only: true; sensitive: true; api_exposed: false; ui_exposed: false; ai_exposed: false };
const definition = (description: string, requirements: number[], result: Obj): Operational => ({
  description, requirements, internal_only: true, permission_scope: "runtime:operational", is_mutation: false,
  consumes_model_resources: false, owner_only: false, sensitive: true, api_exposed: false, ui_exposed: false, ai_exposed: false, input_schema: obj({}),
  output_schema: obj({ ok: { const: true }, contract_version: { const: "1.0.0" }, principal_kind: { const: "trusted_runtime" }, task_id: { type: "string", format: "uuid" }, result }),
});
/** Separate internal catalogue, never spread into the public eight operations. */
export const internalRuntimeOperationalContracts = Object.freeze({
  "agent.runtime.operational.activity": definition("Inspect the actual source-scoped web activity snapshot; absent/unknown coverage is not zero or a lifetime count.", [151], ok({ source: { const: "sandy_web_turns" }, status: { const: "verified" }, scope: { const: "web_only" }, all_web_messages: { type: "integer", minimum: 0 }, current_conversation_messages: count, current_conversation_state: text, cross_channel_available: { type: "boolean" }, note: text })),
  "agent.runtime.operational.communication": definition("Inspect stored customer/channel communication counts with verified identity/source coverage; never equate incoming email with customer-authored messages.", [146, 149, 150, 151], ok({ status: { enum: ["verified", "partial"] }, scope: { const: "customer_scoped_recorded_messages" },
    counts: obj({ web_messages: count, whatsapp_inbound_verified_identity: count, voice_user_turns: count, email_incoming_customer_linked: count, email_authored_by_verified_customer: count }),
    known_customer_originated_subset: count, missing_or_unverified: { type: "array", maxItems: 5, items: text }, source_provenance: obj({ web: text, whatsapp: text, voice: text, email: text }), completeness: text, caveat: text })),
  "agent.runtime.operational.connections": definition("Inspect stored active customer/workspace connection snapshot with explicit locally-recorded, not provider-verified status.", [145], ok({ source: { const: "sandy_composio_connections" }, services: { type: "array", maxItems: 100, items: obj({ service: text, workspace: text, chat_actions: text, state: { const: "locally_recorded_active_not_provider_verified" } }) }, note: text })),
  "agent.runtime.operational.environment": definition("Inspect the original server clock/timezone context; it supplies no physical location or geolocation permission.", [151, 161], ok({ source: { const: "server_clock_and_request_context" }, time: text, timezone: { type: "string", maxLength: 80 }, physical_location: { const: "not_available" }, precision: { const: "none" }, note: text })),
  "agent.runtime.operational.capabilities": definition("Inspect channel-filtered recorded capability/configuration and module metadata; stale module status becomes unverified and configured/deployed is not execution evidence.", [155, 160, 161], ok({ source: { type: "array", minItems: 2, maxItems: 2, items: { enum: ["sandy_capability_catalog", "sandy_ai_integrations"] } },
    capabilities: { type: "array", maxItems: 100, items: obj({ key: text, verified_at: optionalText, verification_note: optionalText }, ["key"]) },
    integration_configuration: { type: "array", maxItems: 100, items: obj({ key: text, enabled: { type: "boolean" }, status: optionalText, verified_at: optionalText }, ["key", "enabled"]) },
    module_status_source: { const: "sandy_module_status" }, master_modules: jsonRecords(1000), modules: jsonRecords(250), note: text })),
  "agent.runtime.operational.versions": definition("Inspect authoritative version registry facts captured by the actual source adapter; unavailable/stale/executing identity distinctions are preserved. Legacy v1 has no version context.", [161], ok({ schema_version: { const: 1 }, executing: obj({ component: text, generation: optionalText, revision: count, build_id: optionalText, verified: { type: "boolean" }, reason: text, source: text }, ["component", "verified"]),
    release: { type: "object" }, components: jsonRecords(1000), specialist_modules: jsonRecords(1000), lookup_status: { const: "available" }, checked_at: text,
  }, ["schema_version", "executing", "release", "lookup_status"], true)),
} satisfies Record<string, AgentOperationContract & { internal_only: true }>);
const ajv = new Ajv({ strict: false, formats: fullFormats });
const inputs = new Map(Object.entries(internalRuntimeOperationalContracts).map(([name, item]) => [name, ajv.compile(item.input_schema)]));
const outputs = new Map(Object.entries(internalRuntimeOperationalContracts).map(([name, item]) => [name, ajv.compile(item.output_schema)]));
export const runtimeOperationalContract = (name: string) => (internalRuntimeOperationalContracts as Record<string, AgentOperationContract>)[name];
export const validRuntimeOperationalInput = (name: string, value: unknown) => inputs.get(name)?.(value) === true;
export const validRuntimeOperationalOutput = (name: string, value: unknown) => outputs.get(name)?.(value) === true;
