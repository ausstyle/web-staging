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
const client = proxy ? Deno.createHttpClient({ proxy: { url: proxy } }) : undefined;
const request: typeof fetch = (input, init = {}) => fetch(input, {
  ...init, ...(client ? { client } : {}), signal: init.signal ?? AbortSignal.timeout(30000),
});
class Failure extends Error { constructor(readonly code: string) { super(code); } }
function requireThat(ok: unknown, code: string): asserts ok { if (!ok) throw new Failure(code); }

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
  for (; pages < 100; pages++) {
    const page = await get(`?limit=5${cursor ? "&cursor=" + encodeURIComponent(cursor) : ""}`);
    requireThat(page.status === 200 && page.body.ok === true && Array.isArray(page.body.operations) &&
      page.body.operations.length <= 5 && typeof page.body.catalogue_version === "string", "API_REST_catalogue_page_invalid");
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

export async function verify(target: string, token: string, anon: string) {
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
  const now = Date.now(), args = { source: "function_logs", start: new Date(now - 60000).toISOString(), end: new Date(now).toISOString(), limit: 5 };
  const validator = new AjvJsonSchemaValidator();
  requireThat(validator.getValidator(tool.inputSchema)(args).valid, "candidate_log_input_schema_mismatch");
  const envelope = (body: unknown) => {
    requireThat(object(body) && object(body.result), "candidate_invalid_tool_response");
    if (object(body.result._meta?.sandy_api)) return body.result._meta.sandy_api;
    try { return JSON.parse(body.result.content[0].text); } catch { throw new Failure("candidate_missing_API_envelope"); }
  };
  const positive = await rpc("tools/call", { name: tool.name, arguments: args }), api = envelope(positive.body);
  const result = (positive.body as Obj).result, payload = result.structuredContent;
  requireThat(positive.status === 200 && result.isError === false && api.status === 200 && api.result?.executed === true &&
    typeof api.result.admission_id === "string" && /^[a-f0-9]{8}-[a-f0-9-]{27}$/.test(api.result.admission_id) &&
    payload?.provider_http_status === 200 && Array.isArray(payload.result?.entries) &&
    payload.result.entries.every((entry: Obj) => typeof entry.message === "string" && policy.function_console_markers.includes(entry.message.trim())) &&
    validator.getValidator(tool.outputSchema)(payload).valid, "candidate_provider_execution_not_verified");
  const denied = await rpc("tools/call", { name: tool.name, arguments: { ...args, source: "auth_logs" } }), denial = envelope(denied.body);
  requireThat(denied.status === 200 && (denied.body as Obj).result.isError === true && denial.status === 403 &&
    denial.result?.executed === false && !denial.result?.admission_id, "candidate_wrong_log_source_not_denied");
  return { server_info: initialized.body.result.serverInfo, tools_discovered: tools.size,
    operation: tool.name, provider_log_query_verified: true, provider_http_status: 200,
    admission_id: api.result.admission_id, matching_fixture_markers: payload.result.entries.length,
    log_event_delivery_verified: payload.result.entries.length > 0,
    wrong_log_source_API_status: 403, wrong_source_denied_before_admission: true,
    VM_diagnostics_performed: false, remote_command_executed: false };
}

if (import.meta.main) {
  const outputIndex = Deno.args.indexOf("--output"), releaseIndex = Deno.args.indexOf("--release-dir"), edge = Deno.args.includes("--edge");
  const output = Deno.args[outputIndex + 1]; requireThat(outputIndex >= 0 && output && (edge !== (releaseIndex >= 0)), "candidate_arguments_invalid");
  const report: Obj = { observed_at: new Date().toISOString(), passed: false, credentials_recorded: false,
    personal_Controller_token_used: false, service_key_used_as_customer_session: false };
  const privateValues: string[] = []; let issued: IssuedSession | undefined, sessions: ReturnType<typeof createEngineeringSessionClient> | undefined;
  try {
    let target = `${base}/functions/v1/sandy-api-mcp`;
    if (!edge) {
      const directory = Deno.args[releaseIndex + 1]; requireThat(directory, "candidate_release_metadata_missing");
      const sourceIndex = Deno.args.indexOf("--source-commit");
      const source = sourceIndex >= 0 ? Deno.args[sourceIndex + 1] : Deno.env.get("GITHUB_SHA");
      requireThat(typeof source === "string" && /^[a-f0-9]{40}$/.test(source), "candidate_source_commit_required");
      report.source_commit_candidate = source;
      target = candidateUrl(JSON.parse(await Deno.readTextFile(`${directory}/before.json`)),
        JSON.parse(await Deno.readTextFile(`${directory}/after.json`)), source);
    }
    report.target = target;
    const credential = Deno.env.get("SANDY_SUPABASE_MANAGEMENT_TOKEN"); requireThat(credential, "engineering_management_credential_unavailable");
    privateValues.push(credential);
    const administration = async (path: string, body?: Obj) => {
      const response = await request(management + path, { method: body ? "POST" : "GET", redirect: "error",
        headers: { authorization: `Bearer ${credential}`, "content-type": "application/json" },
        ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(30000) });
      requireThat(response.ok, "engineering_management_request_failed"); return await json(response) as any;
    };
    const keys = await administration("/api-keys"), service = keys.find((row: Obj) => row.name === "service_role")?.api_key,
      anon = keys.find((row: Obj) => row.name === "anon")?.api_key;
    requireThat(typeof service === "string" && typeof anon === "string", "engineering_session_configuration_unavailable"); privateValues.push(service, anon);
    const rows = await administration("/database/query", { read_only: true, query:
      "SELECT i.user_id,i.credential_epoch,i.bootstrap_generation,(SELECT count(*)::integer FROM public.sandy_controller_admins a WHERE a.auth_user_id=i.user_id) controller_memberships FROM public.sandy_engineering_test_identities i JOIN auth.users u ON u.id=i.user_id WHERE u.email='sandy-engineering-test@sandy-ai.internal' AND i.enabled AND i.revoked_at IS NULL AND i.rotation_state='ready'" });
    requireThat(Array.isArray(rows) && rows.length === 1 && rows[0].controller_memberships === 0, "engineering_nonowner_identity_required");
    const workload = { userId: rows[0].user_id, epoch: rows[0].credential_epoch, bootstrapGeneration: rows[0].bootstrap_generation };
    sessions = createEngineeringSessionClient(base, service, request); issued = await sessions.get(workload); privateValues.push(issued.token);
    report.normal_Auth_user_verified = true; report.controller_memberships = 0;
    report.token_expiry_utc = new Date(issued.expiresAt).toISOString(); report.session_id = issued.sessionId;
    Object.assign(report, await verifyRestCatalogue(issued.token, anon));
    Object.assign(report, await verify(target, issued.token, anon)); report.passed = true;
  } catch (error) {
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
