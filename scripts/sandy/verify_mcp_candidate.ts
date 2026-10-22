/** Protected release acceptance. Uses the existing normal-Auth engineering
 * identity and shared issuer; never a human session or service key as MCP user.
 * No caller-selected URL, provider mutation or production promotion is offered. */
import { createEngineeringSessionClient } from "../../supabase/functions/_shared/sandy_engineering_session_client.ts";
import type { IssuedSession } from "../../supabase/functions/_shared/sandy_engineering_session.ts";
import policy from "../../supabase/functions/sandy-operation-api/engineering_identity_policy.json" with { type: "json" };
import { AjvJsonSchemaValidator } from "npm:@modelcontextprotocol/sdk@1.32.1/validation/ajv";

type Obj = Record<string, any>;
const object = (v: unknown): v is Obj => !!v && typeof v === "object" && !Array.isArray(v);
const base = `https://${policy.project_ref}.supabase.co`, management = `https://api.supabase.com/v1/projects/${policy.project_ref}`;
// Honour the published execution machine's configured egress proxy. This does
// not introduce a relay or change the destination allowlist.
const proxy = import.meta.main ? Deno.env.get("HTTPS_PROXY") : undefined;
const client = proxy ? Deno.createHttpClient({ proxy: { url: proxy }, http2: false }) : undefined;
const transport: typeof fetch = (input, init = {}) => fetch(input, {
  ...init, ...(client ? { client } : {}), signal: init.signal ?? AbortSignal.timeout(30000),
});
export function failureKind(error: unknown): string {
  const name = error instanceof Error ? error.name : "";
  return name === "TimeoutError" ? "timeout" : name === "AbortError" ? "aborted"
    : name === "TypeError" ? "transport_or_type_error" : "unclassified";
}
/** Diagnostics only: never retain headers, bodies, query values or exception text.
 * Endpoint receipts use fixed labels, including for Auth paths containing IDs. */
export function acceptanceRequestEvidence(send: typeof fetch) {
  let last: { endpoint: string; method: string; http_status: number | null; outcome: string } | undefined;
  const endpoint = (input: string | URL | Request) => {
    let url: URL;
    try { url = new URL(input instanceof Request ? input.url : String(input)); } catch { return "redacted_endpoint"; }
    if (url.protocol !== "https:" || url.username || url.password || url.port) return "redacted_endpoint";
    if (url.origin === base) {
      if (url.pathname === "/functions/v1/sandy-api-mcp") return "edge_mcp";
      const catalogue = "/functions/v1/sandy-operation-api/v1/capabilities";
      if ([catalogue, catalogue + "/supabase.logs.query", catalogue + "/engineering.job.approve"].includes(url.pathname))
        return "API_REST_catalogue";
      if (url.pathname.startsWith("/auth/v1/")) return "project_auth";
      if (url.pathname.startsWith("/rest/v1/rpc/")) return "project_session_rpc";
    }
    if (url.origin === "https://api.supabase.com") return "supabase_management";
    if (/^sandy-api-review---sandy-engineering-mcp-[a-z0-9-]+(?:\.[a-z0-9-]+)?\.run\.app$/.test(url.hostname) && url.pathname === "/mcp")
      return "candidate_mcp";
    return "redacted_endpoint";
  };
  const request: typeof fetch = async (input, init) => {
    const method = (init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
    const receipt = { endpoint: endpoint(input), method: ["GET", "POST"].includes(method) ? method : "OTHER",
      http_status: null as number | null, outcome: "pending" };
    last = receipt;
    try {
      const response = await send(input, init);
      receipt.http_status = response.status; receipt.outcome = "response_received";
      return response;
    } catch (error) { receipt.outcome = failureKind(error); throw error; }
  };
  return { request, snapshot: () => last ? { ...last } : null };
}
const requestEvidence = acceptanceRequestEvidence(transport), request = requestEvidence.request;
class Failure extends Error { constructor(readonly code: string) { super(code); } }
function requireThat(ok: unknown, code: string): asserts ok { if (!ok) throw new Failure(code); }

export type ManagementEvidence = { endpoint: string; method: string; http_status: number | null;
  classification: string; provider_code?: string; provider_response?: { message: string } };
export const engineeringIdentityQuery =
  "SELECT i.user_id,i.credential_epoch,i.bootstrap_generation,(SELECT count(*)::integer FROM public.sandy_controller_admins a WHERE a.auth_user_id=i.user_id) controller_memberships FROM public.sandy_engineering_test_identities i JOIN auth.users u ON u.id=i.user_id WHERE u.email='sandy-engineering-test@sandy-ai.internal' AND i.enabled AND i.revoked_at IS NULL AND i.rotation_state='ready'";
/** Closed Management paths; retain only reviewed error categories, never raw bodies. */
export async function managementRequest(path: "/api-keys" | "/database/query", credential: string,
  evidence: ManagementEvidence[], body?: Obj, transport: typeof fetch = request) {
  requireThat(path === "/api-keys" && body === undefined || path === "/database/query" && body?.read_only === true,
    "engineering_management_request_contract_invalid");
  const receipt: ManagementEvidence = { endpoint: management + path, method: body ? "POST" : "GET",
    http_status: null, classification: "transport_unavailable" };
  evidence.push(receipt);
  let response: Response;
  try { response = await transport(management + path, { method: receipt.method, redirect: "error",
    headers: { authorization: `Bearer ${credential}`, "content-type": "application/json" },
    ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(30000) }); }
  catch { throw new Failure("engineering_management_request_failed"); }
  receipt.http_status = response.status;
  receipt.classification = response.ok ? "success" : response.status === 401 ? "authentication_rejected"
    : response.status === 403 ? "authorization_denied" : response.status === 429 ? "rate_limited"
    : response.status >= 500 ? "provider_unavailable" : "request_rejected";
  if (!response.ok) {
    let failure: Obj = {};
    try { const parsed = await json(response); if (object(parsed)) failure = parsed; } catch { /* status remains evidence */ }
    const message = typeof failure.message === "string" ? failure.message : "";
    // Exact literals only. A known prefix followed by a credential, query or
    // private account detail must never pass through as a provider response.
    const publicMessages = new Set(["Unauthorized", "Forbidden", "Invalid access token", "Token expired",
      "You do not have permission to perform this action"]);
    receipt.provider_response = { message: publicMessages.has(message) ? message : "[redacted provider message]" };
    if (response.status === 401 && /(?:expired|invalid|revoked).{0,20}(?:token|jwt)|(?:token|jwt).{0,20}(?:expired|invalid|revoked)/i.test(message)) {
      receipt.classification = "token_invalid_expired_or_revoked";
    }
    const code = failure.code;
    if (typeof code === "string" && ["42501", "42703", "42P01", "42601", "PGRST301"].includes(code)) receipt.provider_code = code;
    if (response.status === 400 && /column .{1,100} does not exist/.test(message)) receipt.classification = "database_column_missing";
    if (response.status === 400 && /relation .{1,100} does not exist/.test(message)) receipt.classification = "database_relation_missing";
    throw new Failure("engineering_management_request_failed");
  }
  return await json(response) as any;
}

type BindingName = "SUPABASE_ACCESS_TOKEN" | "SANDY_SUPABASE_MANAGEMENT_TOKEN" | "SANDY_SUPABASE_ACCESS_TOKEN";
type Binding = { name: BindingName; credential: string | undefined };
const organization = "fygliqnwsicjuawdofrp";
/** Fixed project/organisation only. Profile fingerprints hash a public subject ID,
 * never a credential. No emails, usernames, other resources or raw bodies escape. */
export async function selectManagementBinding(bindings: Binding[], assessments: Obj[], transport: typeof fetch = request) {
  for (const binding of bindings) {
    if (!binding.credential) { assessments.push({ binding: binding.name, configured: false }); continue; }
    const evidence: ManagementEvidence[] = [], assessment: Obj = { binding: binding.name, configured: true,
      required_management_access_verified: false, requests: evidence };
    assessments.push(assessment);
    const metadata = async (path: string) => {
      requireThat(["/v1/profile", "/v1/organizations", `/v1/projects/${policy.project_ref}`,
        `/v1/organizations/${organization}/members`].includes(path), "management_metadata_path_denied");
      const row: ManagementEvidence = { endpoint: "https://api.supabase.com" + path, method: "GET", http_status: null, classification: "transport_unavailable" };
      evidence.push(row);
      try {
        const response = await transport(row.endpoint, { redirect: "error", headers: { authorization: `Bearer ${binding.credential}` }, signal: AbortSignal.timeout(30000) });
        row.http_status = response.status; row.classification = response.ok ? "success" : response.status === 403 ? "authorization_denied"
          : response.status === 401 ? "authentication_rejected" : response.status === 429 ? "rate_limited" : response.status >= 500 ? "provider_unavailable" : "request_rejected";
        if (!response.ok) { await response.body?.cancel(); return null; }
        return await json(response) as any;
      } catch { return null; }
    };
    const results = await Promise.allSettled([metadata("/v1/profile"), metadata(`/v1/projects/${policy.project_ref}`), metadata("/v1/organizations")]);
    const [profile, project, organizations] = results.map(r => r.status === "fulfilled" ? r.value : null);
    const subject = profile?.gotrue_id;
    if (typeof subject === "string" && /^[a-f0-9-]{36}$/.test(subject)) {
      assessment.profile_subject_sha256 = [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(subject)))].map(b => b.toString(16).padStart(2, "0")).join("");
    }
    assessment.target_project_visible = (project?.ref ?? project?.id) === policy.project_ref &&
      (project?.organization_slug ?? project?.organization_id) === organization;
    assessment.target_organization_visible = Array.isArray(organizations)
      ? organizations.some(r => r.slug === organization || r.id === organization) : null;
    assessment.account_ownership_verified = false;
    if (assessment.profile_subject_sha256 && assessment.target_project_visible) {
      const members = await metadata(`/v1/organizations/${organization}/members`);
      if (Array.isArray(members)) {
        const own = members.filter(r => r.user_id === subject).map(r => String(r.role_name).toLowerCase());
        assessment.self_organization_roles = own.filter(r => ["owner", "administrator", "admin", "developer", "read-only", "read_only"].includes(r));
        assessment.account_ownership_verified = own.includes("owner");
      }
    }
    try {
      const keys = await managementRequest("/api-keys", binding.credential, evidence, undefined, transport);
      requireThat(Array.isArray(keys) && ["service_role", "anon"].every(name => keys.some(r => r.name === name && typeof r.api_key === "string" && r.api_key.length > 0)), "engineering_session_configuration_unavailable");
      await managementRequest("/database/query", binding.credential, evidence, { read_only: true, query: "SELECT 1 AS acceptance_management_read_probe" }, transport);
      requireThat(assessment.target_project_visible, "engineering_management_project_binding_unverified");
      assessment.required_management_access_verified = true;
      return { name: binding.name, credential: binding.credential, keys };
    } catch (error) {
      const last = evidence.at(-1);
      // Only a provider authorization refusal permits another explicitly bound,
      // existing credential. Availability/schema failures must not be concealed.
      if (!(error instanceof Failure && error.code === "engineering_management_request_failed" &&
        (last?.http_status === 401 || last?.http_status === 403))) throw error;
      assessment.blocker = assessment.target_project_visible ? "project_visible_management_permission_denied" : "management_permission_denied_project_membership_unproven";
    }
  }
  throw new Failure("engineering_management_credential_scope_insufficient");
}

export function candidateUrl(before: Obj, after: Obj, source?: string): string {
  requireThat(before.service === "sandy-engineering-mcp" && before.project === "elaborate-haven-511518-a5" &&
    (!source || before.source_commit_candidate === source), "candidate_source_or_project_mismatch");
  const original = new URL(before.url), tagged = after.status?.traffic?.find((row: Obj) => row.tag === "sandy-api-review");
  requireThat(original.protocol === "https:" && /^sandy-engineering-mcp-[a-z0-9-]+(?:\.[a-z0-9-]+)?\.run\.app$/.test(original.hostname) &&
    !original.username && !original.password && !original.port && original.pathname === "/" && !original.search && !original.hash,
    "candidate_base_url_invalid");
  requireThat(tagged?.url, "candidate_tag_url_missing");
  const target = new URL(tagged.url);
  requireThat(target.origin === `https://sandy-api-review---${original.hostname}` && target.pathname === "/" &&
    !target.username && !target.password && !target.search && !target.hash, "candidate_tag_url_invalid");
  return target.origin + "/mcp";
}

async function json(response: Response): Promise<unknown> {
  const reader = response.body?.getReader(); requireThat(reader, "candidate_response_empty");
  const parts: Uint8Array[] = []; let length = 0;
  try { for (;;) { const part = await reader.read(); if (part.done) break;
    length += part.value.byteLength; requireThat(length <= 2300000, "candidate_response_size_limit"); parts.push(part.value); }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(length); let offset = 0;
  for (const part of parts) { bytes.set(part, offset); offset += part.length; }
  try { return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)); }
  catch { throw new Failure("candidate_response_invalid_json"); }
}

export async function verifyRestCatalogue(token: string, anon: string) {
  const get = async (suffix: string) => {
    const response = await request(`${base}/functions/v1/sandy-operation-api/v1/capabilities${suffix}`, {
      redirect: "error", headers: { authorization: `Bearer ${token}`, apikey: anon },
    });
    return { status: response.status, body: await json(response) as Obj };
  };
  const names = new Set<string>(), cursors = new Set<string>();
  let cursor: string | undefined, version: string | undefined, pages = 0;
  // Use the API's supported maximum page size to avoid dozens of full
  // catalogue reconstructions. All permission and cursor assertions remain.
  const pageSize = 100;
  for (; pages < 100; pages++) {
    const page = await get(`?limit=${pageSize}${cursor ? "&cursor=" + encodeURIComponent(cursor) : ""}`);
    requireThat(page.status === 200 && page.body.ok === true && Array.isArray(page.body.operations) &&
      page.body.operations.length <= pageSize && typeof page.body.catalogue_version === "string", "API_REST_catalogue_page_invalid");
    if (version) requireThat(version === page.body.catalogue_version, "API_REST_catalogue_changed");
    version = page.body.catalogue_version;
    for (const operation of page.body.operations) {
      requireThat(typeof operation.operation === "string" && !names.has(operation.operation), "API_REST_catalogue_duplicate");
      names.add(operation.operation);
    }
    cursor = page.body.next_cursor;
    if (!cursor) { pages++; break; }
    requireThat(typeof cursor === "string" && !cursors.has(cursor), "API_REST_cursor_did_not_advance");
    cursors.add(cursor);
  }
  requireThat(!cursor && names.has("supabase.logs.query"), "API_REST_discovery_incomplete");
  const described = await get("/supabase.logs.query");
  requireThat(described.status === 200 && described.body.ok === true && described.body.operation?.operation === "supabase.logs.query" &&
    object(described.body.operation.input_schema) && object(described.body.operation.output_schema), "API_REST_description_invalid");
  const malformed = await get("?limit=1&limit=2");
  const denied = await get("/engineering.job.approve");
  requireThat(malformed.status === 400 && denied.status === 403, "API_REST_validation_or_authorization_failed");
  return { API_REST_discovery_pages: pages, API_REST_operations_observed: names.size,
    API_REST_description_verified: true, duplicate_page_parameter_status: 400, out_of_scope_description_status: 403 };
}

export async function verify(target: string, token: string, anon: string, requireLogEvent = false) {
  const rpc = async (method: string, params: Obj, requestId = crypto.randomUUID()) => {
    const response = await request(target, { method: "POST", redirect: "error",
      headers: { authorization: `Bearer ${token}`, apikey: anon, "content-type": "application/json",
        accept: "application/json, text/event-stream", "mcp-protocol-version": "2025-03-26", "x-sandy-request-id": requestId },
      body: JSON.stringify({ jsonrpc: "2.0", id: crypto.randomUUID(), method, params }), signal: AbortSignal.timeout(90000) });
    const body = await json(response); return { status: response.status, body };
  };
  const initialized = await rpc("initialize", { protocolVersion: "2025-03-26", capabilities: {},
    clientInfo: { name: "sandy-authorized-release-acceptance", version: "1.0.0" } });
  requireThat(initialized.status === 200 && object(initialized.body) && initialized.body.result?.serverInfo,
    "candidate_authenticated_initialization_failed");
  const tools = new Map<string, Obj>(), seen = new Set<string>(); let cursor: string | undefined;
  for (let page = 0; page < 100; page++) {
    const listed = await rpc("tools/list", cursor ? { cursor } : {});
    requireThat(listed.status === 200 && object(listed.body) && Array.isArray(listed.body.result?.tools), "candidate_authenticated_discovery_failed");
    for (const tool of listed.body.result.tools) {
      requireThat(object(tool) && typeof tool.name === "string" && !tools.has(tool.name), "candidate_duplicate_or_invalid_tool");
      tools.set(tool.name, tool);
    }
    const next = listed.body.result.nextCursor;
    if (next === undefined) { cursor = undefined; break; }
    requireThat(typeof next === "string" && /^sc1\.[a-f0-9]{64}\.[1-9][0-9]{0,5}$/.test(next) && !seen.has(next), "candidate_cursor_invalid");
    seen.add(next); cursor = next;
  }
  requireThat(!cursor, "candidate_discovery_page_limit");
  // Acceptance uses the existing read-only engineering fixture. It must not
  // depend on optional VM access or revisit the working LiveKit installation.
  const tool = tools.get("supabase.logs.query"); requireThat(tool, "candidate_log_fixture_scope_unavailable");
  const now = Date.now(), args = { source: "function_logs", start: new Date(now - 60000).toISOString(), end: new Date(now).toISOString(), limit: requireLogEvent ? 100 : 5 };
  if (requireLogEvent) {
    // The protected release verifies the fixture source digest immediately before
    // this harmless GET. The same normal customer Auth session is retained.
    const emitted = await request(`${base}/functions/v1/${policy.function_slug}`, {
      redirect: "error", headers: { authorization: `Bearer ${token}`, apikey: anon, "cache-control": "no-store" },
    });
    const marker = await json(emitted) as Obj;
    requireThat(emitted.status === 200 && marker.fixture === "sandy_engineering_execution_fixture_20261021" &&
      [1, 2].includes(marker.version), "candidate_log_fixture_invocation_failed");
  }
  const validator = new AjvJsonSchemaValidator();
  requireThat(validator.getValidator(tool.inputSchema)(args).valid, "candidate_log_input_schema_mismatch");
  const envelope = (body: unknown) => {
    requireThat(object(body) && object(body.result), "candidate_invalid_tool_response");
    if (object(body.result._meta?.sandy_api)) return body.result._meta.sandy_api;
    try { return JSON.parse(body.result.content[0].text); } catch { throw new Failure("candidate_missing_API_envelope"); }
  };
  let positive: any, api: Obj = {}, payload: Obj = {};
  let logAttempts = 0;
  for (const wait of (requireLogEvent ? [0, 5000, 15000, 30000] : [0])) {
    if (wait) await new Promise(resolve => setTimeout(resolve, wait));
    if (requireLogEvent) args.end = new Date(Date.now()).toISOString();
    logAttempts++;
    positive = await rpc("tools/call", { name: tool.name, arguments: args }); api = envelope(positive.body);
    const result = (positive.body as Obj).result; payload = result.structuredContent;
  requireThat(positive.status === 200 && result.isError === false && api.status === 200 && api.result?.executed === true &&
    typeof api.result.admission_id === "string" && /^[a-f0-9]{8}-[a-f0-9-]{27}$/.test(api.result.admission_id) &&
    payload?.provider_http_status === 200 && Array.isArray(payload.result?.entries) &&
    payload.result.entries.every((entry: Obj) => typeof entry.message === "string" && policy.function_console_markers.includes(entry.message.trim())) &&
    validator.getValidator(tool.outputSchema)(payload).valid, "candidate_provider_execution_not_verified");
    if (!requireLogEvent || payload.result.entries.length > 0) break;
  }
  const denied = await rpc("tools/call", { name: tool.name, arguments: { ...args, source: "auth_logs" } }), denial = envelope(denied.body);
  requireThat(denied.status === 200 && (denied.body as Obj).result.isError === true && denial.status === 403 &&
    denial.result?.executed === false && !denial.result?.admission_id, "candidate_wrong_log_source_not_denied");
  return { server_info: initialized.body.result.serverInfo, tools_discovered: tools.size,
    operation: tool.name, provider_log_query_verified: true, provider_http_status: 200,
    admission_id: api.result.admission_id, matching_fixture_markers: payload.result.entries.length,
    log_event_delivery_verified: payload.result.entries.length > 0,
    fixture_invoked: requireLogEvent, log_read_attempts: logAttempts,
    wrong_log_source_API_status: 403, wrong_source_denied_before_admission: true,
    VM_diagnostics_performed: false, remote_command_executed: false };
}

if (import.meta.main) {
  const outputIndex = Deno.args.indexOf("--output"), releaseIndex = Deno.args.indexOf("--release-dir"), edge = Deno.args.includes("--edge");
  const output = Deno.args[outputIndex + 1]; requireThat(outputIndex >= 0 && output && (edge !== (releaseIndex >= 0)), "candidate_arguments_invalid");
  const report: Obj = { observed_at: new Date().toISOString(), passed: false, credentials_recorded: false,
    personal_Controller_token_used: false, service_key_used_as_customer_session: false };
  const privateValues: string[] = []; let issued: IssuedSession | undefined, sessions: ReturnType<typeof createEngineeringSessionClient> | undefined;
  report.acceptance_stage = "candidate_source";
  try {
    let target = `${base}/functions/v1/sandy-api-mcp`;
    if (!edge) {
      const directory = Deno.args[releaseIndex + 1]; requireThat(directory, "candidate_release_metadata_missing");
      const sourceIndex = Deno.args.indexOf("--source-commit");
      const source = sourceIndex >= 0 ? Deno.args[sourceIndex + 1] : Deno.env.get("GITHUB_SHA");
      requireThat(sourceIndex < 0 || typeof source === "string" && /^[a-f0-9]{40}$/.test(source), "candidate_source_commit_invalid");
      target = candidateUrl(JSON.parse(await Deno.readTextFile(`${directory}/before.json`)),
        JSON.parse(await Deno.readTextFile(`${directory}/after.json`)), source);
      report.candidate_source_commit = source ?? null;
    }
    report.target = target;
    report.acceptance_stage = "management_configuration";
    const primaryName = Deno.env.get("SANDY_ACCEPTANCE_PRIMARY_BINDING") ?? "SANDY_SUPABASE_MANAGEMENT_TOKEN";
    requireThat(["SUPABASE_ACCESS_TOKEN", "SANDY_SUPABASE_MANAGEMENT_TOKEN"].includes(primaryName), "engineering_management_binding_invalid");
    const bindings: Binding[] = [
      { name: primaryName as BindingName, credential: Deno.env.get("SANDY_SUPABASE_MANAGEMENT_TOKEN") },
      { name: "SANDY_SUPABASE_MANAGEMENT_TOKEN", credential: Deno.env.get("SANDY_ACCEPTANCE_EXISTING_MANAGEMENT_TOKEN") },
      { name: "SANDY_SUPABASE_ACCESS_TOKEN", credential: Deno.env.get("SANDY_ACCEPTANCE_EXISTING_ACCESS_TOKEN") },
    ];
    requireThat(bindings.some(b => b.credential), "engineering_management_credential_unavailable");
    for (const b of bindings) if (b.credential) privateValues.push(b.credential);
    const assessments: Obj[] = []; report.management_credential_assessments = assessments;
    const selected = await selectManagementBinding(bindings, assessments);
    const credential = selected.credential; report.management_credential_binding = selected.name;
    const managementEvidence: ManagementEvidence[] = []; report.management_requests = managementEvidence;
    const administration = (path: "/api-keys" | "/database/query", body?: Obj) =>
      managementRequest(path, credential, managementEvidence, body);
    const keys = selected.keys, service = keys.find((row: Obj) => row.name === "service_role")?.api_key,
      anon = keys.find((row: Obj) => row.name === "anon")?.api_key;
    requireThat(typeof service === "string" && typeof anon === "string", "engineering_session_configuration_unavailable"); privateValues.push(service, anon);
    const rows = await administration("/database/query", { read_only: true, query: engineeringIdentityQuery });
    requireThat(Array.isArray(rows) && rows.length === 1 && rows[0].controller_memberships === 0, "engineering_nonowner_identity_required");
    const workload = { userId: rows[0].user_id, epoch: rows[0].credential_epoch, bootstrapGeneration: rows[0].bootstrap_generation };
    report.acceptance_stage = "engineering_session";
    sessions = createEngineeringSessionClient(base, service, request); issued = await sessions.get(workload); privateValues.push(issued.token);
    report.normal_Auth_user_verified = true; report.controller_memberships = 0;
    report.token_expiry_utc = new Date(issued.expiresAt).toISOString(); report.session_id = issued.sessionId;
    report.acceptance_stage = "api_rest_catalogue";
    Object.assign(report, await verifyRestCatalogue(issued.token, anon));
    report.acceptance_stage = "mcp_candidate";
    Object.assign(report, await verify(target, issued.token, anon, Deno.args.includes("--require-log-event")));
    requireThat(!Deno.args.includes("--require-log-event") || report.log_event_delivery_verified === true, "candidate_log_event_delivery_unverified");
    report.acceptance_stage = "complete"; report.passed = true;
  } catch (error) {
    // Copy before retirement sends its own requests and overwrites the tracker.
    report.failure_kind = failureKind(error);
    report.failure_request = requestEvidence.snapshot();
    report.error = error instanceof Failure ? error.code : error instanceof Error && /^engineering_(auth|workload|credential)_[a-z_]+$/.test(error.message)
      ? error.message : "candidate_verification_failed";
  } finally {
    if (issued && sessions) {
      try { await sessions.retireIssued(issued); report.normal_Auth_session_retired = true; }
      catch { report.passed = false; report.cleanup_error = "engineering_auth_retirement_failed"; }
    }
    let serialized = JSON.stringify(report, null, 2);
    for (const value of privateValues) serialized = serialized.split(value).join("[REDACTED]");
    await Deno.writeTextFile(output, serialized + "\n"); console.log(serialized);
  }
  if (!report.passed) Deno.exit(1);
}
