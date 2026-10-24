import { isAgentPrincipal, type AgentPrincipal } from "./identity.ts";
type Obj = Record<string, any>;
export type RuntimeOperationalContext = Readonly<{ taskId: string; customerId: string }>;
export type RuntimeOperationalFacts = {
  channel: string; activityFacts: Obj; communicationFacts: Obj;
  services: Obj[]; connectionError: string | null; clock: string; timezone: string;
  versions?: { available: boolean; facts: Obj; executing: Obj };
};
const snapshots = new WeakMap<object, { principal: AgentPrincipal; facts: RuntimeOperationalFacts }>();
/** Fixed runtime adapters capture their actual source-qualified observations.
 * A JSON object or user header cannot create this principal-bound capability. */
export function bindRuntimeOperationalContext(principal: AgentPrincipal | null, facts: RuntimeOperationalFacts): RuntimeOperationalContext | undefined {
  if (!principal || !isAgentPrincipal(principal) || principal.kind !== "trusted_runtime" || !principal.taskId) return undefined;
  if (!["email", "whatsapp", "voice", "web", "internal", "test"].includes(facts.channel) || JSON.stringify(facts).length > 2 * 1024 * 1024) throw Error("runtime_operational_context_invalid");
  const capability = Object.freeze({ taskId: principal.taskId, customerId: principal.customerId });
  snapshots.set(capability, { principal, facts: structuredClone(facts) });
  return capability;
}
export async function runtimeOperationalOperation(principal: AgentPrincipal, operation: string, db: any, capability?: RuntimeOperationalContext): Promise<Obj> {
  const snapshot = capability && snapshots.get(capability);
  if (!isAgentPrincipal(principal) || principal.kind !== "trusted_runtime" || !snapshot || snapshot.principal !== principal) return { error: "runtime_operational_context_required" };
  const { facts } = snapshot;
  const bound = await db.from("sandy_agent_tasks").select("id,customer_id,channel,status,user_request").eq("id", principal.taskId).eq("customer_id", principal.customerId).maybeSingle();
  if (bound.error || !bound.data || bound.data.id !== principal.taskId || bound.data.customer_id !== principal.customerId ||
    bound.data.channel !== facts.channel || bound.data.user_request !== principal.requestText || !["queued", "running"].includes(bound.data.status)) return { error: "runtime_operational_task_binding_mismatch" };
  if (operation === "agent.runtime.operational.versions") return !facts.versions ? { error: "unsupported_operational_domain" } : facts.versions.available
    ? { ok: true, ...structuredClone(facts.versions.facts) }
    : { error: "version_registry_unavailable", executing: structuredClone(facts.versions.executing) };
  if (operation === "agent.runtime.operational.activity") return facts.activityFacts.status === "verified"
    ? { ok: true, source: "sandy_web_turns", ...structuredClone(facts.activityFacts), cross_channel_available: facts.communicationFacts.status !== "unavailable", note: "This field is web-only. Use communication_activity to inspect records from other channels." }
    : { error: "conversation_activity_unavailable", note: "Cannot verify a customer-scoped web count; do not guess." };
  if (operation === "agent.runtime.operational.communication") return facts.communicationFacts.status !== "unavailable"
    ? { ok: true, ...structuredClone(facts.communicationFacts) }
    : { error: "communication_activity_unavailable", reason: "authoritative_channel_metrics_not_available" };
  if (operation === "agent.runtime.operational.connections") return facts.connectionError ? { error: "customer_connections_unavailable" }
    : { ok: true, source: "sandy_composio_connections", services: structuredClone(facts.services), note: "This operation reads locally stored connection records only. It makes no request to Gmail or any other external service. Success verifies only this local read. chat_actions describes configured behavior, not an executed action; use the separate provider-action receipt before claiming external access or execution." };
  if (operation === "agent.runtime.operational.environment") return { ok: true, source: "server_clock_and_request_context", time: facts.clock, timezone: facts.timezone,
    physical_location: "not_available", precision: "none", note: "A timezone is not proof of current physical location. Do not imply geolocation access." };
  if (operation === "agent.runtime.operational.capabilities") {
    const [caps, integrations, moduleRegistry, masterRegistry] = await Promise.all([
      db.from("sandy_capability_catalog").select("feature_key,channels,last_verified_at,verification_note").limit(100),
      db.from("sandy_ai_integrations").select("integration_key,enabled,deployment_status,last_verified_at").limit(100),
      db.from("sandy_module_status").select("module_key,module_group,deployed_version,deployment_state,operational_status,remaining_steps,evidence,last_tested_at,observed_at").limit(250),
      db.from("sandy_master_modules").select("module_key,module_name,description,component_patterns,sort_order,acceptance_requirements").order("sort_order"),
    ]);
    const observedAt = Date.now();
    if ([caps, integrations, moduleRegistry, masterRegistry].some(result => result.error || !Array.isArray(result.data))) return { error: "capability_catalog_unavailable" };
    const modules = moduleRegistry.data.map((m: Obj) => {
      const testedAt = typeof m.last_tested_at === "string" ? Date.parse(m.last_tested_at) : NaN;
      const stale = !Number.isFinite(testedAt) || testedAt > observedAt || observedAt - testedAt >= 86400000;
      return { ...m, operational_status: stale ? "unverified" : m.operational_status, stale };
    });
    return {
      ok: true, source: ["sandy_capability_catalog", "sandy_ai_integrations"],
      capabilities: (caps.data || []).filter((x: Obj) => Array.isArray(x.channels) && x.channels.includes(facts.channel)).map((x: Obj) => ({ key: x.feature_key, verified_at: x.last_verified_at, verification_note: x.verification_note })),
      integration_configuration: (integrations.data || []).map((x: Obj) => ({ key: x.integration_key, enabled: x.enabled, status: x.deployment_status, verified_at: x.last_verified_at })),
      module_status_source: "sandy_module_status", master_modules: masterRegistry.data,
      module_summary: { returned_modules: modules.length, unverified_modules: modules.filter((m: Obj) => m.stale).length, scope: "returned_module_rows", possibly_truncated: modules.length === 250 },
      modules,
      note: "A configured or deployed feature is not necessarily operational or authorised for the current customer.",
    };
  }
  return { error: "unsupported_operational_domain" };
}
