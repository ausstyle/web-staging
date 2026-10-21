import { AjvJsonSchemaValidator } from "@modelcontextprotocol/sdk/validation/ajv";

// Compatibility names only. Contracts, permissions and executors belong to API.
export const aliases = Object.freeze({
  sandy_model_route_readiness: "engineering.models.readiness",
  sandy_run_model_canary: "engineering.models.canary",
  sandy_video_install_preflight: "video.install.preflight",
  sandy_video_execution_preflight: "video.execution.preflight",
  sandy_engineering_change_details: "engineering.change.get"
});
const object = value => value !== null && typeof value === "object" && !Array.isArray(value);
const operationName = value => typeof value === "string" && /^[a-z][a-z0-9_.-]{2,100}$/.test(value);
const failed = value => object(value) && (value.ok === false || value.error != null ||
  (Object.hasOwn(value, "accepted") && value.accepted !== true) ||
  (object(value.result) && failed(value.result)));

// This only checks public gateway configuration. Caller identity and key validity
// are never derived here: Sandy API authenticates every supplied credential.
export function isPublicAnonJwt(value) {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(value)) return false;
  try { return JSON.parse(Buffer.from(value.split(".")[1], "base64url").toString("utf8")).role === "anon"; }
  catch { return false; }
}

export class DiscoveryFailure extends Error {
  constructor(status, code) {
    super(code);
    this.status = status;
    this.code = code;
  }
}

export function executionMetadataHeaders(metadata) {
  const headers = {};
  for (const [key, header] of [["approvalId", "x-sandy-approval-id"], ["requestId", "x-sandy-request-id"]]) {
    const value = metadata?.[key];
    if (value !== undefined) {
      if (typeof value !== "string" || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value)) return null;
      headers[header] = value;
    }
  }
  return headers;
}

async function boundedText(response) {
  if (!response.body) return "";
  const reader = response.body.getReader();
  const chunks = [];
  let length = 0;
  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      length += chunk.value.byteLength;
      if (length > 2300000) {
        await reader.cancel().catch(() => {});
        return null;
      }
      chunks.push(chunk.value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return new TextDecoder().decode(bytes);
}

export function createApiInvoker(projectRef, request = fetch, anon = "") {
  if (!/^[a-z0-9]{20}$/.test(projectRef)) throw new Error("Invalid Supabase project reference");
  const endpoint = `https://${projectRef}.supabase.co/functions/v1/sandy-operation-api`;
  const publicProjectKey = isPublicAnonJwt(anon) || /^sb_publishable_[A-Za-z0-9_-]+$/.test(anon) ? anon : "";
  return async (userToken, body, apiKey, metadata) => {
    const forwarded = executionMetadataHeaders(metadata);
    if (!forwarded) return { status: 400, result: { ok: false, error: "invalid_execution_metadata", executed: false } };
    const response = await request(endpoint, {
      method: "POST",
      headers: {
        authorization: `Bearer ${userToken}`,
        "content-type": "application/json",
        ...(publicProjectKey ? { apikey: publicProjectKey } : {}),
        ...(apiKey !== undefined ? { "x-sandy-api-key": apiKey } : {}),
        ...forwarded
      },
      body: JSON.stringify(body),
      redirect: "error",
      signal: AbortSignal.timeout(60_000)
    });
    const raw = await boundedText(response);
    if (raw === null) {
      return { status: 502, result: { ok: false, error: "sandy_api_response_size_limit" } };
    }
    let result;
    try { result = JSON.parse(raw); }
    catch { result = { ok: false, error: "invalid_sandy_api_response" }; }
    return { status: response.status, result };
  };
}

export async function discover(api, userToken, apiKey, metadata) {
  let response;
  try { response = await api(userToken, { action: "list" }, apiKey, metadata); }
  catch { throw new DiscoveryFailure(503, "sandy_api_discovery_unavailable"); }
  if (!object(response)) throw new DiscoveryFailure(503, "invalid_sandy_api_catalogue");
  if (response.status === 401) throw new DiscoveryFailure(401, "invalid_identity");
  if (response.status === 403) throw new DiscoveryFailure(403, "sandy_api_access_required");
  const value = response.result;
  if (response.status !== 200 || !object(value) || value.ok !== true || failed(value) ||
      !Array.isArray(value.operations) || !/^[a-f0-9]{64}$/.test(value.catalogue_version ?? "")) {
    throw new DiscoveryFailure(503, "invalid_sandy_api_catalogue");
  }
  const operations = new Map();
  const duplicates = new Set();
  for (const entry of value.operations) {
    if (!object(entry) || !operationName(entry.operation) || entry.api_exposed !== true ||
        entry.ai_exposed !== true || entry.executable !== true ||
        !object(entry.input_schema) || entry.input_schema.type !== "object" ||
        entry.input_schema.$async !== undefined || !object(entry.output_schema) ||
        entry.output_schema.type !== "object" || entry.output_schema.$async !== undefined) continue;
    if (operations.has(entry.operation) || duplicates.has(entry.operation)) {
      operations.delete(entry.operation);
      duplicates.add(entry.operation);
      continue;
    }
    operations.set(entry.operation, entry);
  }
  const unavailableAliases = Object.entries(aliases).filter(([, operation]) => !operations.has(operation))
    .map(([name, operation]) => ({ name, operation, reason: "canonical_operation_unavailable" }));
  const toTool = (name, entry) => ({
    name,
    description: typeof entry.description === "string" ? entry.description : `Sandy API operation: ${entry.operation}`,
    inputSchema: entry.input_schema,
    outputSchema: entry.output_schema,
    _meta: { sandy_operation: entry.operation }
  });
  const tools = [...operations.values()].filter(entry => !Object.hasOwn(aliases, entry.operation))
    .map(entry => toTool(entry.operation, entry));
  for (const [name, operation] of Object.entries(aliases)) {
    if (operations.has(operation)) tools.push(toTool(name, operations.get(operation)));
  }
  return {
    operations,
    tools,
    metadata: {
      sandy_catalogue_version: value.catalogue_version,
      sandy_unavailable_aliases: unavailableAliases
    }
  };
}

function validOutput(entry, payload) {
  try {
    const validate = new AjvJsonSchemaValidator().getValidator(entry.output_schema);
    return validate(payload).valid === true;
  } catch { return false; }
}

function admissionReceipt(value) {
  const uuid = field => typeof field === "string" && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(field);
  if (typeof value.reused !== "boolean" || typeof value.dispatch_required !== "boolean") return false;
  if (value.request_state === "recorded") return uuid(value.retry_job_id);
  return value.request_state === undefined && uuid(value.job_id) &&
    typeof value.state === "string" && value.state.length > 0;
}

const toolError = (status, error, operation, metadata, extra = {}) => ({
  isError: true,
  content: [{ type: "text", text: JSON.stringify({
    http_status: status, ok: false, error, operation, executed: false, ...extra
  }) }],
  _meta: metadata
});

function legacySuccess(name, status, envelope, payload) {
  const backend = { http_status: envelope.upstream_status ?? status, ...payload };
  // These two aliases formerly traversed a second MCP. Preserve its successful
  // text envelope as formatting only; no request is sent to that transport.
  const id = name === "sandy_video_install_preflight" ? "video-preflight"
    : name === "sandy_video_execution_preflight" ? "video-execution-preflight" : null;
  if (id) return {
    http_status: status,
    jsonrpc: "2.0",
    id,
    result: { content: [{ type: "text", text: JSON.stringify(backend) }] }
  };
  return { ...payload, http_status: status };
}

export async function callTool(api, userToken, catalogue, name, args = {}, apiKey, metadata) {
  if (!operationName(name) || !object(args)) {
    return toolError(400, "invalid_tool_arguments", null, catalogue.metadata);
  }
  const operation = Object.hasOwn(aliases, name) ? aliases[name] : name;
  const entry = catalogue.operations.get(operation);
  if (!entry) {
    return toolError(424, "canonical_operation_unavailable", operation, catalogue.metadata, {
      missing_capability: { tool: name, operation, reason: "not_executable_or_not_mcp_exposed" }
    });
  }
  let response;
  try {
    response = await api(userToken, {
      action: "execute", channel: "mcp", operation, arguments: args
    }, apiKey, metadata);
  } catch {
    // The response was lost: the adapter cannot infer whether API executed work.
    return toolError(502, "sandy_api_outcome_unknown", operation, catalogue.metadata, {
      executed: null, reconciliation_required: true
    });
  }
  if (!object(response) || !Number.isInteger(response.status)) {
    return toolError(502, "invalid_sandy_api_response", operation, catalogue.metadata, {
      executed: null, reconciliation_required: true
    });
  }
  const envelope = response.result;
  const synchronous = response.status >= 200 && response.status < 300 && object(envelope) &&
    envelope.ok === true && envelope.executed === true && object(envelope.result) && !failed(envelope) &&
    envelope.operation === operation && validOutput(entry, envelope.result);
  // Successful admission is recorded work, never completed provider execution.
  const admission = response.status === 202 && object(envelope) && envelope.ok === true &&
    envelope.accepted === true && envelope.executed === false && admissionReceipt(envelope) &&
    envelope.operation === operation && !failed(envelope) && validOutput(entry, envelope);
  const payload = synchronous ? envelope.result : admission ? envelope : null;
  const isError = payload === null;
  const legacy = synchronous ? legacySuccess(name, response.status, envelope, payload)
    : admission ? { ...payload, http_status: response.status }
    : { http_status: response.status, result: envelope, ok: false,
      error: object(envelope) && typeof envelope.error === "string" ? envelope.error : "sandy_api_operation_failed" };
  return {
    isError,
    ...(payload ? { structuredContent: payload } : {}),
    content: [{ type: "text", text: JSON.stringify(legacy) }],
    _meta: { ...catalogue.metadata, sandy_api: { status: response.status, result: envelope } }
  };
}
