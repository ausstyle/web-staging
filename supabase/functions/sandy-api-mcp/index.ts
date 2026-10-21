/**
 * Sandy MCP is a transport adapter. Sandy API authenticates the caller, filters
 * executable operations, owns their schemas, and dispatches their handlers.
 * Keep this entrypoint self-contained for the existing release packaging.
 */
type JsonObject = Record<string, unknown>;
export type ApiResponse = { status: number; result: unknown };
export type InvokeApi = (
  token: string,
  body: JsonObject,
  apiKey?: string,
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

export function createApi(
  base: string,
  anon: string,
  request: typeof fetch = fetch,
): InvokeApi {
  return async (token, body, apiKey) => {
    const response = await request(`${base}/functions/v1/sandy-operation-api`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        apikey: anon,
        "content-type": "application/json",
        ...(apiKey === undefined ? {} : { "x-sandy-api-key": apiKey }),
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(60000),
    });
    const result = await response.json().catch(() => ({
      error: "invalid_api_response",
    }));
    return { status: response.status, result };
  };
}

function failedResult(value: unknown): boolean {
  if (!isObject(value)) return false;
  if (value.ok === false || value.error != null) return true;
  return isObject(value.result) && failedResult(value.result);
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
    inputSchema: entry.input_schema,
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
    if (apiKey !== undefined && !apiKey.trim()) return json({ error: "invalid_api_credential" }, 401);
    let parsed: unknown;
    try {
      parsed = await req.json();
    } catch {
      return json(rpcError(null, -32700, "Invalid JSON"), 400);
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
        if (msg.method === "tools/list" && params.cursor !== undefined) {
          return json(
            rpcError(id, -32602, "Pagination cursor is not supported"),
            400,
          );
        }
        // Initialization authenticates through the same API as discovery.
        const a = await api(bearer, { action: "list" }, apiKey);
        if (a.status !== 200 || !isObject(a.result) || failedResult(a.result)) {
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
        const a = await api(bearer, {
          action: "execute",
          channel: "mcp",
          operation: params.name,
          arguments: params.arguments ?? {},
        }, apiKey);
        const output = isObject(a.result) ? a.result.result : undefined;
        const accepted = isObject(a.result) && a.result.accepted === true && a.result.executed === false && isObject(output);
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
