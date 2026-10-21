/** Read-only protocol discovery of the existing fixed Engineering MCP endpoint.
 * The gateway supplies an already authorized owner's actual credential context.
 * Only initialize and tools/list are sent; tools/call is never sent or proxied.
 */
type Row = Record<string, unknown>;
export const MCP_DISCOVERY_OPERATION =
  "google_cloud.mcp.authenticated_discovery";
export const ENGINEERING_MCP_ENDPOINT =
  "https://sandy-engineering-mcp-4pqn6jsfxq-ew.a.run.app/mcp";
const object = (value: unknown): value is Row =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const name = (value: unknown): value is string =>
  typeof value === "string" && /^[a-z][a-z0-9_.-]{2,100}$/.test(value);
const text = (value: unknown): value is string =>
  typeof value === "string" && value.length > 0 && value.length <= 200;
type DiscoveryResult = { status: number; body: Row };
type Dependencies = {
  userToken: string;
  apiKey?: string;
  request?: typeof fetch;
  now?: () => Date;
};
const rejection = (
  stage: string,
  error: string,
  upstreamStatus?: number,
): DiscoveryResult => ({
  status: upstreamStatus === 401 || upstreamStatus === 403 ? 424 : 502,
  body: {
    ok: false,
    operation: MCP_DISCOVERY_OPERATION,
    error,
    stage,
    ...(upstreamStatus ? { upstream_status: upstreamStatus } : {}),
    tool_execution_requested: false,
  },
});

async function readJson(response: Response): Promise<unknown> {
  if (!response.body) throw Error("mcp_invalid_json");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.length;
      if (size > 2 * 1024 * 1024) {
        await reader.cancel().catch(() => {});
        throw Error("mcp_response_size_limit");
      }
      chunks.push(chunk.value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    throw Error("mcp_invalid_json");
  }
}

export async function inspectEngineeringMcp(
  arguments_: unknown,
  dependencies: Dependencies,
): Promise<DiscoveryResult> {
  if (!object(arguments_) || Object.keys(arguments_).length) {
    return {
      status: 400,
      body: {
        ok: false,
        error: "mcp_diagnostic_accepts_no_arguments",
        tool_execution_requested: false,
      },
    };
  }
  if (
    !/^[A-Za-z0-9._~-]+$/.test(dependencies.userToken) ||
    dependencies.apiKey === ""
  ) {
    return {
      status: 401,
      body: {
        ok: false,
        error: "mcp_diagnostic_authentication_context_required",
        tool_execution_requested: false,
      },
    };
  }
  const request = dependencies.request ?? fetch;
  const headers: Record<string, string> = {
    authorization: `Bearer ${dependencies.userToken}`,
    "content-type": "application/json",
    accept: "application/json, text/event-stream",
    "mcp-protocol-version": "2025-03-26",
    ...(dependencies.apiKey === undefined
      ? {}
      : { "x-sandy-api-key": dependencies.apiKey }),
  };
  const call = async (
    method: "initialize" | "tools/list",
    id: string,
    params: Row,
  ): Promise<{ response: Response; data: unknown } | DiscoveryResult> => {
    let response: Response;
    try {
      response = await request(ENGINEERING_MCP_ENDPOINT, {
        method: "POST",
        redirect: "error",
        headers,
        body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
        signal: AbortSignal.timeout(15000),
      });
    } catch {
      return rejection(method, "mcp_discovery_unavailable");
    }
    if (!response.ok) {
      return rejection(
        method,
        response.status === 401 || response.status === 403
          ? "mcp_session_rejected"
          : "mcp_http_failure",
        response.status,
      );
    }
    let data: unknown;
    try {
      data = await readJson(response);
    } catch (error) {
      return rejection(
        method,
        error instanceof Error && error.message === "mcp_response_size_limit"
          ? "mcp_response_size_limit"
          : "mcp_invalid_json",
        response.status,
      );
    }
    if (
      !object(data) || data.jsonrpc !== "2.0" || data.id !== id ||
      !object(data.result) || data.error != null
    ) return rejection(method, "mcp_invalid_rpc_response", response.status);
    return { response, data };
  };
  const initialized = await call("initialize", "sandy-discovery-initialize", {
    protocolVersion: "2025-03-26",
    capabilities: {},
    clientInfo: { name: "sandy-api-discovery", version: "1.0.0" },
  });
  if ("status" in initialized) return initialized;
  const initial = (initialized.data as Row).result as Row;
  if (
    initial.protocolVersion !== "2025-03-26" || !object(initial.serverInfo) ||
    !text(initial.serverInfo.name) || !text(initial.serverInfo.version) ||
    !object(initial.capabilities) || !object(initial.capabilities.tools)
  ) {
    return rejection(
      "initialize",
      "mcp_incompatible_initialization",
      initialized.response.status,
    );
  }
  const session = initialized.response.headers.get("mcp-session-id");
  if (session !== null) {
    if (!/^[\x21-\x7e]{1,256}$/.test(session)) {
      return rejection("initialize", "mcp_invalid_session_metadata");
    }
    headers["mcp-session-id"] = session;
  }
  const listed = await call("tools/list", "sandy-discovery-tools", {});
  if ("status" in listed) return listed;
  const result = (listed.data as Row).result as Row;
  if (
    !Array.isArray(result.tools) || result.tools.length > 5000 ||
    result.nextCursor !== undefined
  ) {
    return rejection(
      "tools/list",
      "mcp_incomplete_or_invalid_tool_catalogue",
      listed.response.status,
    );
  }
  const names: string[] = [];
  for (const tool of result.tools) {
    if (
      !object(tool) || !name(tool.name) || !object(tool.inputSchema) ||
      tool.inputSchema.type !== "object" || names.includes(tool.name)
    ) {
      return rejection(
        "tools/list",
        "mcp_invalid_tool_catalogue",
        listed.response.status,
      );
    }
    names.push(tool.name);
  }
  const metadata = object(result._meta) ? result._meta : {};
  const revision = metadata.sandy_catalogue_version;
  if (
    revision !== undefined &&
    (typeof revision !== "string" || !/^[a-f0-9]{64}$/.test(revision))
  ) {
    return rejection(
      "tools/list",
      "mcp_invalid_catalogue_version",
      listed.response.status,
    );
  }
  let gaps: Row[] | null = null;
  if (metadata.sandy_unavailable_aliases !== undefined) {
    if (
      !Array.isArray(metadata.sandy_unavailable_aliases) ||
      metadata.sandy_unavailable_aliases.length > 500
    ) {
      return rejection(
        "tools/list",
        "mcp_invalid_compatibility_metadata",
        listed.response.status,
      );
    }
    gaps = [];
    for (const gap of metadata.sandy_unavailable_aliases) {
      if (
        !object(gap) || !name(gap.name) || !name(gap.operation) ||
        typeof gap.reason !== "string" || gap.reason.length > 100
      ) {
        return rejection(
          "tools/list",
          "mcp_invalid_compatibility_metadata",
          listed.response.status,
        );
      }
      gaps.push({
        name: gap.name,
        operation: gap.operation,
        reason: gap.reason,
      });
    }
  }
  return {
    status: 200,
    body: {
      ok: true,
      contract_version: "1.0.0",
      operation: MCP_DISCOVERY_OPERATION,
      stage: "tools/list",
      initialize_status: initialized.response.status,
      tools_status: listed.response.status,
      protocol_version: initial.protocolVersion,
      server_info: {
        name: initial.serverInfo.name,
        version: initial.serverInfo.version,
      },
      tools: names,
      tool_count: names.length,
      catalogue_version: revision ?? null,
      compatibility_gaps: gaps,
      tool_execution_requested: false,
      observed_at: (dependencies.now ?? (() => new Date()))().toISOString(),
    },
  };
}

export const mcpDiscoveryContract = Object.freeze({
  operation: MCP_DISCOVERY_OPERATION,
  handler: "sandy-operation-api",
  permission_scope: "infrastructure:read",
  is_mutation: false,
  input_schema: { type: "object", properties: {}, additionalProperties: false },
  output_schema: {
    type: "object",
    required: [
      "ok",
      "contract_version",
      "operation",
      "stage",
      "initialize_status",
      "tools_status",
      "protocol_version",
      "server_info",
      "tools",
      "tool_count",
      "catalogue_version",
      "compatibility_gaps",
      "tool_execution_requested",
      "observed_at",
    ],
    properties: {
      ok: { const: true },
      contract_version: { const: "1.0.0" },
      operation: { const: MCP_DISCOVERY_OPERATION },
      stage: { const: "tools/list" },
      initialize_status: { type: "integer", minimum: 200, maximum: 299 },
      tools_status: { type: "integer", minimum: 200, maximum: 299 },
      protocol_version: { const: "2025-03-26" },
      server_info: {
        type: "object",
        required: ["name", "version"],
        properties: {
          name: { type: "string", minLength: 1, maxLength: 200 },
          version: { type: "string", minLength: 1, maxLength: 200 },
        },
        additionalProperties: false,
      },
      tools: {
        type: "array",
        maxItems: 5000,
        uniqueItems: true,
        items: { type: "string", pattern: "^[a-z][a-z0-9_.-]{2,100}$" },
      },
      tool_count: { type: "integer", minimum: 0, maximum: 5000 },
      catalogue_version: {
        type: ["string", "null"],
        pattern: "^[a-f0-9]{64}$",
      },
      compatibility_gaps: {
        type: ["array", "null"],
        maxItems: 500,
        items: {
          type: "object",
          required: ["name", "operation", "reason"],
          properties: {
            name: { type: "string", pattern: "^[a-z][a-z0-9_.-]{2,100}$" },
            operation: { type: "string", pattern: "^[a-z][a-z0-9_.-]{2,100}$" },
            reason: { type: "string", maxLength: 100 },
          },
          additionalProperties: false,
        },
      },
      tool_execution_requested: { const: false },
      observed_at: { type: "string", format: "date-time" },
    },
    additionalProperties: false,
  },
});
