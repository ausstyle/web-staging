import { prepareConnectedGmail, confirmConnectedGmail } from "./connected-gmail.ts";
import { agentOperationContracts, validAgentInput, validAgentOutput } from "./contracts.ts";
import { AgentDb, AgentPrincipal, isAgentPrincipal } from "./identity.ts";
import { currentVoiceSource } from "./voice_source.ts";
import { isBoundLegacyRuntimeProfile, legacyRuntimeResponses, type LegacyRuntimeProfile } from "./runtime_profiles.ts";
import { internalRuntimeRecordContracts, validRuntimeRecordInput, validRuntimeRecordOutput } from "./runtime_record_contracts.ts";
import { runtimeRecordOperation } from "./runtime_records.ts";
import { runtimeOperationalContract, validRuntimeOperationalInput, validRuntimeOperationalOutput } from "./runtime_operational_contracts.ts";
import { runtimeOperationalOperation, type RuntimeOperationalContext } from "./runtime_operational.ts";

import { runtimeConnectionPreflightContract, runtimeConnectionPreflightOperationName, validRuntimeConnectionPreflightInput, validRuntimeConnectionPreflightOutput } from "./runtime_connection_preflight_contract.ts";
import { runtimeConnectionPreflightOperation, type RuntimeConnectionPreflight } from "./runtime_connection_preflight.ts";

type Obj = Record<string, any>;
export type AgentServices = {
  db: AgentDb;
  base: string;
  composioKey: string;
  openaiKey: string;
  integrationToken: string;
  fetch?: typeof fetch;
  legacyRuntimeProfile?: LegacyRuntimeProfile;
  runtimeContext?: RuntimeOperationalContext;
  connectionPreflight?: RuntimeConnectionPreflight;
  autoImproveKey?: string;
  defer?: (promise: Promise<unknown>) => void;
};
export type AgentOutcome = { status: number; body: Obj; legacy: Obj };
const object = (x: unknown): x is Obj => x !== null && typeof x === "object" && !Array.isArray(x);
const failure = (error: string, extra: Obj = {}): Obj => ({ error, ...extra });
const stable = (x: any): string => JSON.stringify(x && typeof x === "object" ?
  (Array.isArray(x) ? x.map((v) => JSON.parse(stable(v))) : Object.fromEntries(Object.keys(x).sort().map((k) => [k, JSON.parse(stable(x[k]))]))) : x);
const digest = async (value: string) => Array.from(new Uint8Array(await crypto.subtle.digest(
  "SHA-256", new TextEncoder().encode(value),
))).map((v) => v.toString(16).padStart(2, "0")).join("");
async function providerJson(response: Response): Promise<Obj | null> {
  // The actual provider/broker is fixed. Bound response size without logging
  // provider bodies, which can contain customer content or secret diagnostics.
  const reader = response.body?.getReader();
  if (!reader) return null;
  const chunks: Uint8Array[] = []; let length = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > 2 * 1024 * 1024) { await reader.cancel(); return null; }
      chunks.push(value);
    }
    const bytes = new Uint8Array(length); let offset = 0;
    for (const part of chunks) { bytes.set(part, offset); offset += part.byteLength; }
    const data = JSON.parse(new TextDecoder().decode(bytes));
    return object(data) ? data : null;
  } catch { return null; }
}
async function feature(db: AgentDb, name: string) {
  const r = await db.from("sandy_ai_integrations").select("enabled").eq("integration_key", name).maybeSingle();
  return !r.error && r.data?.enabled === true;
}
async function gmailAccount(db: AgentDb, customerId: string, workspace: string, recent = false) {
  let query = db.from("sandy_composio_connections").select("connected_account_id,company_id,status")
    .eq("customer_id", customerId).eq("toolkit_slug", "gmail");
  query = recent ? query.eq("status", "ACTIVE").is("company_id", null).limit(3)
    : query.in("status", ["ACTIVE", "active"]).limit(25);
  const accounts = await query;
  if (accounts.error) return failure("gmail_connection_lookup_failed");
  let eligible = accounts.data || [];
  if (!recent && workspace && !["personal", "private", "personal (private)"].includes(workspace)) {
    const companies = await db.from("sandy_agenda_companies").select("id,name").eq("customer_id", customerId);
    if (companies.error) return failure("workspace_lookup_failed");
    const matches = (companies.data || []).filter((x: Obj) => String(x.name).toLowerCase() === workspace);
    if (matches.length !== 1) return failure(matches.length ? "ambiguous_workspace" : "workspace_not_found");
    eligible = eligible.filter((x: Obj) => x.company_id === matches[0].id);
  } else eligible = eligible.filter((x: Obj) => x.company_id == null);
  if (!eligible.length) return failure("gmail_not_connected_in_selected_workspace");
  if (eligible.length !== 1) return failure("multiple_gmail_accounts_in_workspace");
  return { account: eligible[0] };
}
async function gmailFetch(deps: AgentServices, customerId: string, accountId: string, args: Obj) {
  const r = await (deps.fetch ?? fetch)("https://backend.composio.dev/api/v3/tools/execute/GMAIL_FETCH_EMAILS", {
    method: "POST", redirect: "error", headers: { "x-api-key": deps.composioKey, "content-type": "application/json" },
    body: JSON.stringify({ connected_account_id: accountId, user_id: "sandy_customer_" + customerId,
      version: "20261015_00", arguments: args }), signal: AbortSignal.timeout(25000),
  });
  return { r, data: await providerJson(r) };
}
async function recentGmail(ctx: AgentPrincipal, limit: number, deps: AgentServices): Promise<Obj> {
  const selected = await gmailAccount(deps.db, ctx.customerId, "", true);
  if (selected.error) return selected;
  if (!deps.composioKey) return failure("gmail_tool_not_configured");
  const unique = new Map<string, Obj>(), seenTokens = new Set<string>();
  let pageToken: string | undefined, providerStatus = 200, providerError = "", pageCount = 0;
  try {
    for (let page = 0; page < 20 && unique.size < limit; page++) {
      const args: Obj = { query: "in:inbox", max_results: limit - unique.size, include_payload: false };
      if (pageToken) args.page_token = pageToken;
      const { r, data } = await gmailFetch(deps, ctx.customerId, selected.account.connected_account_id, args);
      providerStatus = r.status;
      if (!r.ok || !data || data.successful === false || data.error != null || !object(data.data)) {
        providerError = "gmail_provider_error"; break;
      }
      let payload = data.data;
      if (object(payload.data)) payload = payload.data;
      if (!Array.isArray(payload.messages) && Array.isArray(payload.results)) {
        const value = payload.results[0]?.response || payload.results[0] || {};
        payload = value.data || value.data_preview || value;
      }
      const rows = Array.isArray(payload.messages) ? payload.messages : Array.isArray(payload.emails)
        ? payload.emails : Array.isArray(payload.results) ? payload.results : null;
      if (!rows) { providerError = "gmail_provider_invalid_result"; break; }
      pageCount++;
      for (const message of rows) {
        if (!object(message)) continue;
        const id = String(message.messageId || message.id || message.message_id || "");
        if (id && !unique.has(id)) unique.set(id, message);
      }
      const next = String(payload.nextPageToken || payload.next_page_token || "");
      if (!next || seenTokens.has(next)) { pageToken = undefined; break; }
      seenTokens.add(next); pageToken = next;
    }
  } catch { providerError = "gmail_provider_unavailable"; }
  const messages = [...unique.values()].slice(0, limit);
  const details = { provider_status: providerStatus, returned: messages.length, requested: limit,
    pages: pageCount, has_more_pages: !!pageToken, provider_error: providerError || null };
  let response = "";
  if (providerError) response = "Gmail is connected, but retrieval stopped due to a provider error (HTTP " + providerStatus + "). Retrieved " + messages.length + " verified messages out of " + limit + ".";
  else if (!messages.length) response = "Gmail responded, but no message records were returned for this search.";
  else {
    const formatted = messages.map((m, i) => {
      const headers = Array.isArray(m.payload?.headers) ? m.payload.headers : Array.isArray(m.headers) ? m.headers : [];
      const header = (name: string) => String(headers.find((h: Obj) => String(h.name || "").toLowerCase() === name)?.value || "");
      return (i + 1) + ". " + String(m.subject || header("subject") || "(subject unavailable)").slice(0, 160) + " — " + String(m.sender || m.from || header("from") || "sender unavailable").slice(0, 160);
    });
    response = "Retrieved " + messages.length + " of " + limit + " requested Gmail messages from Personal:\n" + formatted.join("\n");
    if (messages.length < limit) response += "\nOnly " + messages.length + " distinct messages were returned after " + pageCount + " page(s); no additional page was available. I cannot supply the missing " + (limit - messages.length) + ".";
  }
  return providerError ? failure(providerError, { response, details }) : { response, details, read_only: true };
}
async function rawOperation(ctx: AgentPrincipal, operation: string, args: Obj, deps: AgentServices): Promise<Obj> {
  const { db } = deps;
  if (operation === runtimeConnectionPreflightOperationName) return await runtimeConnectionPreflightOperation(ctx, deps.connectionPreflight, {
    db, base: deps.base, composioKey: deps.composioKey, autoImproveKey: deps.autoImproveKey || "", request: deps.fetch ?? fetch,
    defer: deps.defer ?? (() => { throw Error("runtime_defer_required"); }),
  });
  if (runtimeOperationalContract(operation)) return await runtimeOperationalOperation(ctx, operation, db, deps.runtimeContext);
  if (internalRuntimeRecordContracts[operation]) return await runtimeRecordOperation(ctx, operation, args, db);
  if (operation === "gmail.drafts.prepare") return await prepareConnectedGmail(db, ctx.customerId, args);
  if (operation === "gmail.drafts.confirm_send") {
    const expected = new RegExp("^confirm send\\s+" + args.draft_id + "\\s*$", "i");
    if (!expected.test(args.confirmation.trim()) ||
      (ctx.kind === "trusted_runtime" && !expected.test(ctx.requestText.trim())))
      return failure("explicit_confirmation_required");
    return await confirmConnectedGmail(db, ctx.customerId, args.draft_id, deps.composioKey, deps.fetch ?? fetch);
  }
  if (operation === "gmail.messages.recent") return await recentGmail(ctx, args.limit, deps);
  if (operation === "gmail.messages.search") {
    const selected = await gmailAccount(db, ctx.customerId, String(args.workspace || "").trim().toLowerCase());
    if (selected.error) return selected;
    if (!deps.composioKey) return failure("gmail_tool_not_configured");
    try {
      const { r, data } = await gmailFetch(deps, ctx.customerId, selected.account.connected_account_id,
        { query: args.query || "in:anywhere", max_results: 10, include_payload: true });
      return r.ok && data && data.successful !== false && data.error == null && object(data.data)
        ? { ok: true, read_only: true, data: JSON.stringify(data.data).slice(0, 18000) }
        : failure("gmail_provider_read_failed", { provider_status: r.status });
    } catch { return failure("gmail_provider_unavailable"); }
  }
  const flags: Record<string, string> = { "agent.web.research": "openai_web_search",
    "agent.documents.search": "openai_file_search", "agent.evaluations.list": "openai_evals",
    "agent.execution_plan.draft": "openai_agents" };
  if (!await feature(db, flags[operation])) return failure("agent_feature_disabled");
  if (!deps.openaiKey) return failure("agent_provider_not_configured");
  if (operation === "agent.evaluations.list") {
    try {
      const response = await (deps.fetch ?? fetch)("https://api.openai.com/v1/evals?limit=20", {
        redirect: "error", headers: { authorization: "Bearer " + deps.openaiKey }, signal: AbortSignal.timeout(20000),
      });
      const data = await providerJson(response);
      return response.ok && data && Array.isArray(data.data) && data.data.length <= 20 && data.error == null
        ? { items: data.data.map((v: Obj) => ({ id: v.id, name: v.name, created_at: v.created_at })), read_only: true }
        : failure("evals_provider_failed");
    } catch { return failure("evals_unavailable"); }
  }
  const body: Obj = { model: "gpt-4.1-mini", input: args.query ?? args.goal,
    max_output_tokens: operation === "agent.execution_plan.draft" ? 800 : 1200 };
  if (operation === "agent.web.research") body.tools = [{ type: "web_search_preview" }];
  if (operation === "agent.documents.search") {
    const store = await db.from("sandy_file_search_stores").select("vector_store_id,verified_at")
      .eq("customer_id", ctx.customerId).maybeSingle();
    if (store.error || !store.data?.verified_at || !/^vs_[A-Za-z0-9_-]+$/.test(store.data.vector_store_id || ""))
      return failure("customer_vector_store_unverified");
    body.tools = [{ type: "file_search", vector_store_ids: [store.data.vector_store_id], max_num_results: 5 }];
  }
  if (operation === "agent.execution_plan.draft")
    body.instructions = "Return a concise plan, dependencies and verification steps. This is planning only; never claim any action was performed.";
  if (!deps.legacyRuntimeProfile && (!deps.integrationToken || !/^https:\/\/[a-z0-9-]+\.supabase\.co\/?$/.test(deps.base)))
    return failure("agent_broker_not_configured");
  try {
    // This is the existing broker integration credential, never an auth-user JWT.
    const response = deps.legacyRuntimeProfile
      ? await legacyRuntimeResponses(deps.legacyRuntimeProfile, ctx, operation as "agent.web.research" | "agent.documents.search" | "agent.execution_plan.draft", body, deps.openaiKey, deps.fetch ?? fetch)
      : await (deps.fetch ?? fetch)(deps.base.replace(/\/$/, "") + "/functions/v1/sandy-openai-gateway-v4", {
      method: "POST", redirect: "error", headers: { "x-sandy-integration-token": deps.integrationToken,
        "x-sandy-purpose": "web", "x-sandy-task": (ctx.requestText || String(args.query ?? args.goal ?? "")).replace(/[^\x20-\x7E]/g, " ").slice(0, 240),
        authorization: "Bearer " + deps.openaiKey, "content-type": "application/json" },
      body: JSON.stringify(body), signal: AbortSignal.timeout(operation === "agent.execution_plan.draft" ? 45000 : 65000),
    });
    const data = await providerJson(response);
    if (!response.ok || !data || data.error != null || data.status === "failed" || !Array.isArray(data.output))
      return failure("agent_provider_failed");
    const parts = data.output.flatMap((v: Obj) => Array.isArray(v.content) ? v.content : [])
      .filter((v: Obj) => v.type === "output_text" && typeof v.text === "string");
    const text = parts.map((v: Obj) => v.text).join(" ").trim();
    if (!text || data.status === "incomplete") return failure("agent_provider_incomplete_result");
    if (operation === "agent.execution_plan.draft") return { plan: text, executed: false };
    const type = operation === "agent.web.research" ? "url_citation" : "file_citation";
    const citations = parts.flatMap((v: Obj) => Array.isArray(v.annotations) ? v.annotations : [])
      .filter((v: Obj) => v.type === type).map((v: Obj) => type === "url_citation"
        ? { title: v.title, url: v.url } : { file_id: v.file_id, filename: v.filename });
    return { answer: text, citations };
  } catch { return failure("agent_provider_unavailable"); }
}

/** The only executor used by the API and the active runtime. Audit claims are
 * committed before work; a lost mutation/model result is never blindly replayed. */
export async function executeAgentOperation(
  context: AgentPrincipal,
  operation: string,
  args: Obj,
  deps: AgentServices,
): Promise<AgentOutcome> {
  const refused = (status: number, error: string, extra: Obj = {}): AgentOutcome => ({ status,
    body: { ok: false, operation, error, executed: false, ...extra }, legacy: { error, ...extra } });
  if (!isAgentPrincipal(context)) return refused(403, "agent_principal_required");
  if (context.voiceSessionId && !await currentVoiceSource(deps.db,context.voiceSessionId,context.customerId)) return refused(403,"voice_source_authorization_expired_or_revoked");
  if (deps.legacyRuntimeProfile && !isBoundLegacyRuntimeProfile(deps.legacyRuntimeProfile, context))
    return refused(403, "runtime_transport_profile_denied");
  const record = internalRuntimeRecordContracts[operation];
  const operational = runtimeOperationalContract(operation);
  const preflight = operation === runtimeConnectionPreflightOperationName ? runtimeConnectionPreflightContract : null;
  const internal = record || operational || preflight;
  const contract = agentOperationContracts[operation] || internal;
  if (!contract) return refused(404, "agent_operation_not_supported");
  if (context.readOnly === true && contract.is_mutation) return refused(403, "read_only_assessment_mutation_denied");
  if (internal && context.kind !== "trusted_runtime") return refused(403, "trusted_runtime_customer_task_required");
  const validInput = record ? validRuntimeRecordInput : operational ? validRuntimeOperationalInput : preflight ? validRuntimeConnectionPreflightInput : validAgentInput;
  const validOutput = record ? validRuntimeRecordOutput : operational ? validRuntimeOperationalOutput : preflight ? validRuntimeConnectionPreflightOutput : validAgentOutput;
  if (!validInput(operation, args)) return refused(400, "invalid_agent_arguments");
  if (contract.owner_only && context.kind === "auth_user" && !context.controllerOwner)
    return refused(403, "controller_owner_required");
  const requestHash = await digest(stable(args));
  const idempotencyKey = typeof args.idempotency_key === "string" ? args.idempotency_key : null;
  const claim = await deps.db.from("sandy_agent_operation_audit").insert({
    operation, principal_kind: context.kind, customer_id: context.customerId,
    auth_user_id: context.authUserId, task_id: context.taskId,
    idempotency_key: idempotencyKey, request_sha256: requestHash, state: "started",
  }).select("id").maybeSingle();
  if (claim.error?.code === "23505" && idempotencyKey) {
    const previous = await deps.db.from("sandy_agent_operation_audit").select("request_sha256,state,result")
      .eq("customer_id", context.customerId).eq("principal_kind", context.kind)
      .eq("operation", operation).eq("idempotency_key", idempotencyKey).maybeSingle();
    if (previous.error || !previous.data) return refused(503, "agent_idempotency_lookup_failed");
    if (previous.data.request_sha256 !== requestHash) return refused(409, "idempotency_scope_mismatch");
    if (previous.data.state === "succeeded" && validOutput(operation, previous.data.result))
      return { status: 200, body: previous.data.result, legacy: internal ? previous.data.result.result : previous.data.result };
    return refused(409, "agent_operation_outcome_requires_reconciliation", { executed: null, reconciliation_required: true });
  }
  if (claim.error || !claim.data?.id) return refused(503, "agent_audit_unavailable");
  let legacy: Obj;
  let providerAttempted = false;
  const fetcher = deps.fetch ?? fetch;
  const observed: AgentServices = { ...deps, fetch: ((input, init) => {
    providerAttempted = true;
    return fetcher(input, init);
  }) as typeof fetch };
  try { legacy = context.voiceSessionId&&!await currentVoiceSource(deps.db,context.voiceSessionId,context.customerId)
    ? failure("voice_source_authorization_expired_or_revoked") : await rawOperation(context, operation, args, observed); }
  catch { legacy = failure("agent_operation_interrupted"); }
  const candidate = { ...(internal ? { result: legacy } : legacy), ok: true, contract_version: "1.0.0",
    principal_kind: context.kind, task_id: context.taskId };
  const success = !legacy.error && validOutput(operation, candidate);
  const uncertain = !success && ((contract.consumes_model_resources && providerAttempted) ||
    legacy.error === "draft_save_failed" ||
    ["unknown", "sending", "recorded_sent_unverified"].includes(legacy.state));
  const error = typeof legacy.error === "string" ? legacy.error :
    legacy.state && legacy.state !== "sent" ? "gmail_send_" + legacy.state : "agent_invalid_provider_result";
  const body = success ? candidate : { ok: false, operation, error,
    executed: uncertain ? null : providerAttempted, reconciliation_required: uncertain,
    result: legacy, principal_kind: context.kind, task_id: context.taskId };
  const finished = await deps.db.from("sandy_agent_operation_audit").update({
    state: success ? "succeeded" : uncertain ? "unknown" : "failed",
    result: success && idempotencyKey ? candidate : null, error: success ? null : error,
    finished_at: new Date().toISOString(),
  }).eq("id", claim.data.id).eq("customer_id", context.customerId).eq("state", "started").select("id").maybeSingle();
  if (finished.error || !finished.data) return { status: 502,
    body: { ok: false, operation, error: "agent_audit_completion_failed", executed: null, reconciliation_required: true },
    legacy: failure("agent_audit_completion_failed", { text: "The operation's final audit receipt is unavailable. Its outcome requires reconciliation; do not repeat it automatically.", state: "unknown" }) };
  return { status: success ? 200 : uncertain ? 502 : 422, body, legacy };
}

/** Compatibility boundary: raw legacy output shape, same central executor. */
export async function executeRuntimeOperation(
  context: AgentPrincipal | null,
  operation: string,
  args: Obj,
  deps: AgentServices,
  step: string,
): Promise<Obj> {
  if (!context || context.kind !== "trusted_runtime") return failure("runtime_customer_binding_required");
  const input = { ...args };
  if (["gmail.drafts.prepare", "agent.web.research", "agent.documents.search", "agent.execution_plan.draft"].includes(operation) || internalRuntimeRecordContracts[operation]?.is_mutation || operation === runtimeConnectionPreflightOperationName)
    input.idempotency_key = "runtime:" + context.taskId + ":" + (await digest(step)).slice(0, 40);
  const outcome = await executeAgentOperation(context, operation, input, deps);
  return outcome.legacy;
}
