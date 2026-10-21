/**
 * Sandy MCP is a transport adapter. Sandy API authenticates the caller, filters
 * executable operations, owns their schemas, and dispatches their handlers.
 * Keep this entrypoint self-contained for the existing release packaging.
 */
type JsonObject = Record<string, unknown>;
const CATALOGUE_CURSOR = /^sc1\.[a-f0-9]{64}\.[1-9][0-9]{0,5}$/;
export type ApiResponse = { status: number; result: unknown };
export type ApiExecutionMetadata = { approvalId?: string; requestId?: string };
export type InvokeApi = (
  token: string,
  body: JsonObject,
  apiKey?: string,
  metadata?: ApiExecutionMetadata,
) => Promise<ApiResponse>;

const isObject = (value: unknown): value is JsonObject =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const rpc = (id: unknown, result: unknown) => ({ jsonrpc: "2.0", id, result });
const rpcError = (id: unknown, code: number, message: string) => ({
  jsonrpc: "2.0",
  id,
  error: { code, message },
});
const json = (data: unknown, status = 200) =>
  Response.json(data, {
    status,
    headers: {
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    },
  });
const validId = (id: unknown) =>
  id === null || typeof id === "string" ||
  (typeof id === "number" && Number.isFinite(id));
const uuid = (value: unknown): value is string =>
  typeof value === "string" &&
  /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value);
function executionHeaders(
  metadata?: ApiExecutionMetadata,
): Record<string, string> | null {
  const headers: Record<string, string> = {};
  for (
    const [key, header] of [["approvalId", "x-sandy-approval-id"], [
      "requestId",
      "x-sandy-request-id",
    ]] as const
  ) {
    const value = metadata?.[key];
    if (value !== undefined) {
      if (!uuid(value)) return null;
      headers[header] = value;
    }
  }
  return headers;
}
async function boundedJson(
  message: Request | Response,
  limit: number,
): Promise<unknown> {
  const reader = message.body?.getReader();
  if (!reader) throw Error("invalid_json");
  const parts: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const part = await reader.read();
      if (part.done) break;
      size += part.value.byteLength;
      if (size > limit) {
        await reader.cancel().catch(() => {});
        throw Error("body_size_limit");
      }
      parts.push(part.value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const part of parts) {
    bytes.set(part, offset);
    offset += part.byteLength;
  }
  return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
}

export function createApi(
  base: string,
  anon: string,
  request: typeof fetch = fetch,
): InvokeApi {
  return async (token, body, apiKey, metadata) => {
    const forwarded = executionHeaders(metadata);
    if (!forwarded) {
      return {
        status: 400,
        result: {
          ok: false,
          error: "invalid_execution_metadata",
          executed: false,
        },
      };
    }
    const response = await request(`${base}/functions/v1/sandy-operation-api`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        apikey: anon,
        "content-type": "application/json",
        ...(apiKey === undefined ? {} : { "x-sandy-api-key": apiKey }),
        ...forwarded,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(60000),
    });
    const result = await boundedJson(response, 2300000).catch((error) => ({
      error: error instanceof Error && error.message === "body_size_limit"
        ? "sandy_api_response_size_limit"
        : "invalid_api_response",
      executed: null,
      reconciliation_required: true,
    }));
    return { status: response.status, result };
  };
}

function failedResult(value: unknown): boolean {
  if (!isObject(value)) return false;
  if (value.ok === false || value.error != null) return true;
  return isObject(value.result) && failedResult(value.result);
}

/** A backward-compatible tool envelope lets MCP clients supply per-call
 * approvals without changing connection headers or the Sandy API arguments. */
export function transportInputSchema(input: JsonObject): JsonObject {
  const prefix = "#/$defs/sandy_api_arguments";
  const relocate = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(relocate);
    if (!isObject(value)) return value;
    return Object.fromEntries(Object.entries(value).map(([key, child]) => [key,
      key === "$ref" && typeof child === "string" && child.startsWith("#")
        ? prefix + child.slice(1) : relocate(child)]));
  };
  const metadata = { type: "object", minProperties: 1, additionalProperties: false,
    properties: { approval_id: { type: "string", format: "uuid" }, request_id: { type: "string", format: "uuid" } } };
  return { type: "object", $defs: { sandy_api_arguments: relocate(input) }, anyOf: [
    { $ref: prefix },
    { type: "object", required: ["__sandy_execution", "arguments"], additionalProperties: false,
      properties: { __sandy_execution: metadata, arguments: { $ref: prefix } } },
  ] };
}
function unpackExecution(arguments_: JsonObject, header: ApiExecutionMetadata) {
  if (!Object.hasOwn(arguments_, "__sandy_execution")) return { arguments_, metadata: header };
  const value = arguments_.__sandy_execution;
  if (Object.keys(arguments_).length !== 2 || !isObject(arguments_.arguments) || !isObject(value) ||
    Object.keys(value).length === 0 || Object.keys(value).some(key => !["approval_id", "request_id"].includes(key))) return null;
  const metadata = { ...header };
  for (const [field, key] of [["approval_id", "approvalId"], ["request_id", "requestId"]] as const) {
    if (value[field] === undefined) continue;
    if (!uuid(value[field]) || (header[key] !== undefined && header[key]!.toLowerCase() !== value[field].toLowerCase())) return null;
    metadata[key] = value[field];
  }
  return { arguments_: arguments_.arguments, metadata };
}

function discoveryTools(result: JsonObject) {
  const entries = Array.isArray(result.operations) ? result.operations : [];
  const names = new Set<string>();
  return entries.filter((entry): entry is JsonObject => {
    if (
      !isObject(entry) || entry.api_exposed !== true ||
      entry.ai_exposed !== true ||
      entry.executable !== true || typeof entry.operation !== "string" ||
      !/^[a-z][a-z0-9_.-]{2,100}$/.test(entry.operation) ||
      !isObject(entry.input_schema) || entry.input_schema.type !== "object" ||
      names.has(entry.operation)
    ) return false;
    names.add(entry.operation);
    return true;
  }).map((entry) => ({
    name: entry.operation,
    description: typeof entry.description === "string"
      ? entry.description
      : `Sandy API operation: ${entry.operation}`,
    inputSchema: entry.is_mutation === true || isObject(entry.error_contract) &&
        (entry.error_contract.requires_approval === true || entry.error_contract.requires_grant === true)
      ? transportInputSchema(entry.input_schema as JsonObject) : entry.input_schema,
    ...(isObject(entry.output_schema) && entry.output_schema.type === "object"
      ? { outputSchema: entry.output_schema }
      : {}),
  }));
}

export function createHandler(api: InvokeApi) {
  return async (req: Request): Promise<Response> => {
    if (req.method !== "POST") {
      return json({ error: "method_not_allowed" }, 405);
    }
    const auth = req.headers.get("authorization") ?? "";
    const bearer = auth.match(/^Bearer ([A-Za-z0-9._~-]+)$/i)?.[1];
    if (!bearer) return json({ error: "authentication_required" }, 401);
    const apiKey = req.headers.get("x-sandy-api-key") ?? undefined;
    if (apiKey !== undefined && !apiKey.trim()) {
      return json({ error: "invalid_api_credential" }, 401);
    }
    const metadata: ApiExecutionMetadata = {
      ...(req.headers.has("x-sandy-approval-id")
        ? { approvalId: req.headers.get("x-sandy-approval-id")! }
        : {}),
      ...(req.headers.has("x-sandy-request-id")
        ? { requestId: req.headers.get("x-sandy-request-id")! }
        : {}),
    };
    if (!executionHeaders(metadata)) {
      return json({ error: "invalid_execution_metadata" }, 400);
    }
    let parsed: unknown;
    try {
      parsed = await boundedJson(req, 1550000);
    } catch (error) {
      const oversized = error instanceof Error &&
        error.message === "body_size_limit";
      return json(
        rpcError(
          null,
          -32700,
          oversized ? "Request too large" : "Invalid JSON",
        ),
        oversized ? 413 : 400,
      );
    }
    if (
      !isObject(parsed) || parsed.jsonrpc !== "2.0" ||
      typeof parsed.method !== "string" || !parsed.method ||
      ("id" in parsed && !validId(parsed.id))
    ) {
      return json(rpcError(null, -32600, "Invalid JSON-RPC request"), 400);
    }
    const msg = parsed;
    const id = msg.id ?? null;
    if (msg.params !== undefined && !isObject(msg.params)) {
      return json(rpcError(id, -32602, "Parameters must be an object"), 400);
    }
    const params = (msg.params ?? {}) as JsonObject;
    if (params._meta !== undefined && !isObject(params._meta)) {
      return json(rpcError(id, -32602, "Invalid request metadata"), 400);
    }
    if (!("id" in msg) && msg.method !== "notifications/initialized") {
      // Do not execute tools from malformed notifications without a response ID.
      return json(rpcError(null, -32600, "Request ID required"), 400);
    }
    try {
      if (
        msg.method === "initialize" ||
        msg.method === "notifications/initialized" ||
        msg.method === "tools/list"
      ) {
        if (
          msg.method === "initialize" &&
          (typeof params.protocolVersion !== "string" ||
            !isObject(params.capabilities) ||
            !isObject(params.clientInfo) ||
            typeof params.clientInfo.name !== "string" ||
            typeof params.clientInfo.version !== "string")
        ) {
          return json(
            rpcError(id, -32602, "Invalid initialization parameters"),
            400,
          );
        }
        if (msg.method === "notifications/initialized" && "id" in msg) {
          return json(
            rpcError(id, -32600, "Notification must not have an ID"),
            400,
          );
        }
        if (
          msg.method === "tools/list" && params.cursor !== undefined &&
          (typeof params.cursor !== "string" ||
            !CATALOGUE_CURSOR.test(params.cursor))
        ) {
          return json(
            rpcError(id, -32602, "Invalid pagination cursor"),
            400,
          );
        }
        // Initialization authenticates through the same API as discovery.
        const a = await api(
          bearer,
          {
            action: "list",
            channel: "mcp",
            limit: msg.method === "tools/list" ? 100 : 1,
            ...(params.cursor === undefined ? {} : { cursor: params.cursor }),
          },
          apiKey,
          metadata,
        );
        if (a.status !== 200 || !isObject(a.result) || failedResult(a.result)) {
          if (
            a.status === 409 && isObject(a.result) &&
            a.result.error === "catalogue_changed_restart_discovery"
          ) {
            return json(
              rpcError(
                id,
                -32001,
                "Catalogue changed; restart tools/list without a cursor",
              ),
              409,
            );
          }
          const status = a.status >= 400 && a.status <= 599 ? a.status : 502;
          return json(
            rpcError(id, -32000, "Sandy API discovery unavailable"),
            status,
          );
        }
        if (msg.method === "notifications/initialized") {
          return new Response(null, { status: 202 });
        }
        if (msg.method === "initialize") {
          return json(rpc(id, {
            protocolVersion: "2025-03-26",
            capabilities: { tools: {} },
            serverInfo: { name: "sandy-api-mcp", version: "0.3.0" },
          }));
        }
        if (!Array.isArray(a.result.operations)) {
          return json(rpcError(id, -32000, "Invalid Sandy API catalogue"), 502);
        }
        return json(rpc(id, {
          tools: discoveryTools(a.result),
          ...(typeof a.result.next_cursor === "string" &&
              CATALOGUE_CURSOR.test(a.result.next_cursor)
            ? { nextCursor: a.result.next_cursor }
            : {}),
          ...(typeof a.result.catalogue_version === "string" &&
              /^[a-f0-9]{64}$/.test(a.result.catalogue_version)
            ? { _meta: { sandy_catalogue_version: a.result.catalogue_version } }
            : {}),
        }));
      }
      if (msg.method === "tools/call") {
        if (
          typeof params.name !== "string" ||
          !/^[a-z][a-z0-9_.-]{2,100}$/.test(params.name) ||
          (params.arguments !== undefined && !isObject(params.arguments))
        ) {
          return json(
            rpcError(id, -32602, "Invalid tool call parameters"),
            400,
          );
        }
        const execution = unpackExecution(params.arguments ?? {}, metadata);
        if (!execution) return json(rpcError(id, -32602, "Invalid or conflicting execution metadata"), 400);
        const a = await api(
          bearer,
          {
            action: "execute",
            channel: "mcp",
            operation: params.name,
            arguments: execution.arguments_,
          },
          apiKey,
          execution.metadata,
        );
        const output = isObject(a.result) ? a.result.result : undefined;
        const accepted = isObject(a.result) && a.result.accepted === true &&
          a.result.executed === false && isObject(output);
        const failed = a.status < 200 || a.status >= 300 ||
          !isObject(a.result) || (a.result.executed !== true && !accepted) ||
          failedResult(a.result) || !isObject(output);
        return json(rpc(id, {
          isError: failed,
          // API operation schemas describe the handler payload. Keep transport
          // and deployment evidence intact in the text envelope as well.
          ...(!failed ? { structuredContent: output } : {}),
          content: [{
            type: "text",
            text: JSON.stringify({ status: a.status, result: a.result }),
          }],
        }));
      }
      return json(rpcError(id, -32601, "Method not found"));
    } catch {
      return json(rpcError(id, -32000, "Sandy API unavailable"), 502);
    }
  };
}

if (import.meta.main) {
  Deno.serve(createHandler(createApi(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_ANON_KEY") ?? "",
  )));
}
