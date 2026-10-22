import { isAgentPrincipal, type AgentPrincipal } from "./identity.ts";
type Obj = Record<string, any>;
export type RuntimeConnectionPreflight = Readonly<{ taskId: string; customerId: string }>;
type Facts = { channel: string; requestId: string; connections: Obj[]; workspaceNames: Map<string, string>; connectionError: string | null; requestedService: string | null };
const bindings = new WeakMap<object, { principal: AgentPrincipal; facts: Facts }>();
export function bindRuntimeConnectionPreflight(principal: AgentPrincipal | null, facts: Facts): RuntimeConnectionPreflight | undefined {
  if (!principal || !isAgentPrincipal(principal) || principal.kind !== "trusted_runtime" || !principal.taskId) return undefined;
  const cap = Object.freeze({ taskId: principal.taskId, customerId: principal.customerId });
  bindings.set(cap, { principal, facts: structuredClone(facts) });
  return cap;
}
export type ConnectionPreflightDependencies = {
  db: any; base: string; composioKey: string; autoImproveKey: string;
  request: typeof fetch; defer: (promise: Promise<unknown>) => void;
};
async function boundedJson(response: Response): Promise<Obj | null> {
  const reader = response.body?.getReader(); if (!reader) return null;
  const parts: Uint8Array[] = []; let size = 0;
  try {
    for (;;) { const part = await reader.read(); if (part.done) break; size += part.value.length; if (size > 2 * 1024 * 1024) { await reader.cancel(); return null; } parts.push(part.value); }
    const all = new Uint8Array(size); let offset = 0; for (const part of parts) { all.set(part, offset); offset += part.length; }
    const result = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(all));
    return result && typeof result === "object" && !Array.isArray(result) ? result : null;
  } catch { return null; }
}

/** One governed task-bound check. This does not repair a connection or treat an
 * asynchronous diagnosis request as completion. Provider scope and a complete,
 * structurally valid page are required before recording a contradiction. */
export async function runtimeConnectionPreflightOperation(principal: AgentPrincipal, capability: RuntimeConnectionPreflight | undefined, deps: ConnectionPreflightDependencies, readOnly = false): Promise<Obj> {
  const binding = capability && bindings.get(capability);
  if (!isAgentPrincipal(principal) || principal.kind !== "trusted_runtime" || !binding || binding.principal !== principal) return { error: "runtime_connection_preflight_capability_required" };
  const { facts } = binding, customerId = principal.customerId;
  const task = await deps.db.from("sandy_agent_tasks").select("id,customer_id,channel,request_id,user_request,status").eq("id", principal.taskId).maybeSingle();
  if (task.error || !task.data || task.data.id !== principal.taskId || task.data.customer_id !== customerId || task.data.channel !== facts.channel ||
    task.data.request_id !== facts.requestId || task.data.user_request !== principal.requestText || !["queued", "running"].includes(task.data.status)) return { error: "runtime_connection_preflight_task_mismatch" };
  if (deps.base !== "https://zmqlyygzqoidkcwdysok.supabase.co") return { error: "runtime_connection_preflight_backend_invalid" };
  if (facts.connectionError) {
    if(!readOnly)await deps.db.from("sandy_v2_awareness_audit").insert({ customer_id: customerId, channel: facts.channel, request_id: facts.requestId, subject: "connections", outcome: "error", evidence: { reason: facts.connectionError } });
    return { response: "I could not verify your current app connections from Sandy's database. I won't guess which services are linked.", success: false, provider_check: "unavailable", records: 0, mismatches: 0, findings_recorded: 0, diagnosis_requests_scheduled: 0, diagnosis_completed: false };
  }
  let providerCheck: "confirmed" | "unavailable" = "unavailable";
  const verifiedIds = new Set<string>(), userId = "sandy_customer_" + customerId;
  if (deps.composioKey) {
    try {
      const upstream = await deps.request("https://backend.composio.dev/api/v3.1/connected_accounts?limit=100&user_ids=" + encodeURIComponent(userId), { headers: { "x-api-key": deps.composioKey }, signal: AbortSignal.timeout(12000) });
      const body = await boundedJson(upstream);
      const rows = Array.isArray(body?.items) ? body!.items : Array.isArray(body?.data) ? body!.data : null;
      if (upstream.ok && body && body.error == null && body.successful !== false && body.success !== false && rows && rows.length <= 100 &&
        rows.every((x: any) => x && typeof x === "object" && !Array.isArray(x) && x.user_id === userId && typeof x.id === "string" && x.id.length > 0 && typeof x.status === "string" && x.status.trim().length > 0) && new Set(rows.map((x: any) => x.id)).size === rows.length &&
        (body.next_cursor === undefined || body.next_cursor === null || typeof body.next_cursor === "string")) {
        for (const row of rows) if (row.status.toUpperCase() === "ACTIVE") verifiedIds.add(row.id);
        providerCheck = body.next_cursor ? "unavailable" : "confirmed";
      }
    } catch { /* Unknown provider status never authorizes reconciliation. */ }
  }
  const active = facts.connections.filter(x => String(x.status).toUpperCase() === "ACTIVE");
  const selected = facts.requestedService ? active.filter(x => x.toolkit_slug.toLowerCase() === facts.requestedService) : active;
  const described = selected.map(x => {
    const location = x.company_id ? facts.workspaceNames.get(x.company_id) || "a company workspace" : "Personal";
    const provider = providerCheck === "confirmed" ? verifiedIds.has(x.connected_account_id) ? "confirmed active by provider" : "not confirmed active by provider" : "recorded active in Sandy; live provider status not verified";
    const ability = x.toolkit_slug === "gmail" ? "Gmail search and approval-gated sending are implemented in this chat" : "A connection does not establish that this chat can perform actions in that app";
    return x.toolkit_slug + " (" + location + "): " + provider + ". " + ability + ".";
  });
  const message = described.length ? "Sandy's connection records show:\n" + described.join("\n") : facts.requestedService ? "I found no active " + facts.requestedService + " connection recorded for your Sandy account. This does not establish whether authorisation is pending or has not been synced." : "I found no active app connections recorded for your Sandy account.";
  const mismatched = providerCheck === "confirmed" ? selected.filter(x => !verifiedIds.has(x.connected_account_id)) : [];
  let findings = 0, scheduled = 0;
  for (const x of readOnly?[]:mismatched) {
    const fingerprint = "v2:connection:" + customerId + ":" + x.toolkit_slug + ":" + (x.company_id || "personal");
    const found = await deps.db.from("sandy_supervisor_findings").upsert({ fingerprint, category: "integration_state_discrepancy", severity: "medium", state: "open", subject: "Recorded app connection not confirmed by provider",
      explanation: "The authenticated customer's local ACTIVE connection was not confirmed by Composio. Inspect provider status, sync and permissions before executing.",
      evidence: { app: x.toolkit_slug, provider_check: providerCheck, workspace: x.company_id ? "company" : "personal" },
      recommendation: "Recheck the provider and resolve tenant-scoped connection drift; do not claim repair without evidence.", source_type: "sandy_v2_awareness", source_id: fingerprint, updated_at: new Date().toISOString() }, { onConflict: "fingerprint" });
    if (found.error) continue;
    findings++;
    if (deps.autoImproveKey) {
      const hash = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(fingerprint)))).map(v => v.toString(16).padStart(2, "0")).join("");
      const work = deps.request(deps.base + "/functions/v1/sandy-auto-improve", { method: "POST", headers: { authorization: "Bearer " + deps.autoImproveKey, "content-type": "application/json" },
        body: JSON.stringify({ source_type: "system_awareness", source_ref: "v2_conn_" + hash.slice(0, 40), problem: "Sandy records an ACTIVE " + x.toolkit_slug + " connection but the provider did not confirm it active. Diagnose provider permissions, sync, execution scope and verification without exposing customer details." }), signal: AbortSignal.timeout(35000) })
        .then(q => { if (!q.ok) console.error("v2_chat_autodiagnosis_http", q.status); })
        .catch(() => { console.error("v2_chat_autodiagnosis_failed"); });
      deps.defer(work); scheduled++;
    }
  }
  const outcome = mismatched.length ? "contradiction" : providerCheck === "confirmed" ? "verified" : "unverified";
  if(!readOnly)await deps.db.from("sandy_v2_awareness_audit").insert({ customer_id: customerId, channel: facts.channel, request_id: facts.requestId, subject: "connections", outcome, evidence: { provider_check: providerCheck, records: selected.length, mismatches: mismatched.length, requested_service: facts.requestedService || "all" } });
  return { response: message, success: true, provider_check: providerCheck, records: selected.length, mismatches: mismatched.length, findings_recorded: findings, diagnosis_requests_scheduled: scheduled, diagnosis_completed: false };
}
