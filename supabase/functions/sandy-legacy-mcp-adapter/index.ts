/**
 * Replacement source for the legacy Sandy Operations MCP transport.
 * All contracts, authorization and execution come from Sandy API. Aliases below
 * translate existing MCP wire shapes; they contain no database/provider client.
 */
type ObjectValue = Record<string, unknown>;
export type ApiResult = { status: number; result: unknown };
export type ApiAuthContext = {
  apiKey?: string;
  approvalId?: string;
  requestId?: string;
};
export type InvokeApi = (
  token: string,
  body: ObjectValue,
  context?: ApiAuthContext,
) => Promise<ApiResult>;
type Entry = ObjectValue & { operation: string; input_schema: ObjectValue };
type Route = { operation: string; arguments: ObjectValue };
type Gap = { name: string; operation?: string; reason: string };
const object = (value: unknown): value is ObjectValue =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const operationName = (value: unknown): value is string =>
  typeof value === "string" && /^[a-z][a-z0-9_.-]{2,100}$/.test(value);
const own = (value: ObjectValue, key: string) => Object.hasOwn(value, key);
const uuid = (value: unknown): value is string =>
  typeof value === "string" &&
  /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value);
function executionHeaders(
  context?: ApiAuthContext,
): Record<string, string> | null {
  const headers: Record<string, string> = {};
  for (
    const [key, header] of [["approvalId", "x-sandy-approval-id"], [
      "requestId",
      "x-sandy-request-id",
    ]] as const
  ) {
    const value = context?.[key];
    if (value !== undefined) {
      if (!uuid(value)) return null;
      headers[header] = value;
    }
  }
  return headers;
}
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value));
const json = (
  value: unknown,
  status = 200,
  extra: Record<string, string> = {},
) =>
  Response.json(value, {
    status,
    headers: {
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
      ...extra,
    },
  });
const rpc = (id: unknown, result: unknown) => ({ jsonrpc: "2.0", id, result });
const rpcError = (id: unknown, code: number, message: string) => ({
  jsonrpc: "2.0",
  id,
  error: { code, message },
});
const directAliases: Readonly<Record<string, string>> = Object.freeze({
  operations_status: "deployment.jobs.get",
  deployment_status: "deployment.jobs.status",
  cloud_vm_status: "google_cloud.vm.status",
  cloud_run_status: "google_cloud.cloud_run.status",
  deployment_approve_read: "deployment.jobs.approve_read",
  deployment_execute: "deployment.jobs.execute",
  vm_bootstrap_status: "google_cloud.vm.bootstrap_status",
  vm_service_status: "google_cloud.vm.service_status",
  cloud_targets: "cloud.targets.list",
  engineering_change_register: "engineering.change.register",
});
export const legacyToolNames = Object.freeze([
  "operations_list",
  "operations_describe",
  "operations_status",
  "operations_execute",
  "deployment_status",
  "cloud_vm_status",
  "cloud_run_status",
  "deployment_approve_read",
  "deployment_execute",
  "vm_bootstrap_status",
  "vm_service_status",
  "vm_install_worker",
  "cloud_targets",
  "engineering_change_register",
  "engineering_change_approve",
  "deployment_request",
]);
const requestOperations = [
  "deployment.jobs.request",
  "engineering.implementation.request",
  "engineering.change.register",
  "engineering.change.status",
  "engineering.change.get",
];
const workerConstants = Object.freeze({
  provider: "google_cloud",
  operation: "install_worker",
  target: "sandy-deploy",
  payload: { installer: "restricted_deployment_worker_v1" },
});

export function createApi(
  base: string,
  anon: string,
  request: typeof fetch = fetch,
): InvokeApi {
  const origin = new URL(base);
  if (
    origin.protocol !== "https:" || origin.username || origin.password ||
    origin.pathname !== "/" || origin.search || origin.hash
  ) throw Error("invalid_api_origin");
  return async (token, body, context) => {
    const forwarded = executionHeaders(context);
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
    const response = await request(
      `${origin.origin}/functions/v1/sandy-operation-api`,
      {
        method: "POST",
        redirect: "error",
        headers: {
          authorization: `Bearer ${token}`,
          apikey: anon,
          "content-type": "application/json",
          ...(context?.apiKey ? { "x-sandy-api-key": context.apiKey } : {}),
          ...forwarded,
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(60000),
      },
    );
    return {
      status: response.status,
      result: await response.json().catch(() => ({
        error: "invalid_api_response",
      })),
    };
  };
}

function catalogue(
  result: ApiResult,
): { entries: Entry[]; version: string } | null {
  if (
    result.status !== 200 || !object(result.result) ||
    result.result.ok !== true ||
    !Array.isArray(result.result.operations) ||
    typeof result.result.catalogue_version !== "string" ||
    !/^[a-f0-9]{64}$/.test(result.result.catalogue_version)
  ) return null;
  const names = new Set<string>();
  const entries = result.result.operations.filter((entry): entry is Entry => {
    if (
      !object(entry) || entry.api_exposed !== true ||
      entry.ai_exposed !== true ||
      entry.executable !== true || !operationName(entry.operation) ||
      !object(entry.input_schema) || entry.input_schema.type !== "object" ||
      names.has(entry.operation)
    ) return false;
    names.add(entry.operation);
    return true;
  });
  return { entries, version: result.result.catalogue_version };
}

function projectedSchema(schema: ObjectValue, hidden: string[]): ObjectValue {
  const result = clone(schema);
  if (object(result.properties)) {
    for (const key of hidden) delete result.properties[key];
  }
  if (Array.isArray(result.required)) {
    result.required = result.required.filter((key) =>
      !hidden.includes(String(key))
    );
  }
  return result;
}

// Rebase local references when putting an API schema inside a legacy envelope.
// Root-level canonical tools still publish the original schema unchanged.
function embedded(schema: ObjectValue, key: string): ObjectValue {
  const resources = new Map<string, string>();
  const initialBase = "https://sandy.invalid/__schema_root";
  const pointer = (part: string) =>
    part.replace(/~/g, "~0").replace(/\//g, "~1");
  const maps = [
    "$defs",
    "definitions",
    "properties",
    "patternProperties",
    "dependencies",
    "dependentSchemas",
  ];
  const singles = [
    "additionalProperties",
    "additionalItems",
    "contains",
    "not",
    "if",
    "then",
    "else",
    "propertyNames",
    "unevaluatedProperties",
    "unevaluatedItems",
    "contentSchema",
  ];
  const arrays = ["allOf", "anyOf", "oneOf", "prefixItems"];
  const children = (
    value: ObjectValue,
    visit: (child: unknown, suffix: string) => unknown,
  ): ObjectValue => {
    const result = clone(value);
    for (const name of maps) {
      if (object(value[name])) {
        result[name] = Object.fromEntries(
          Object.entries(value[name]).map((
            [property, child],
          ) => [
            property,
            object(child)
              ? visit(child, `/${pointer(name)}/${pointer(property)}`)
              : child,
          ]),
        );
      }
    }
    for (const name of singles) {
      if (object(value[name])) {
        result[name] = visit(value[name], `/${pointer(name)}`);
      }
    }
    for (const name of arrays) {
      if (Array.isArray(value[name])) {
        result[name] = value[name].map((child, index) =>
          visit(child, `/${pointer(name)}/${index}`)
        );
      }
    }
    if (Array.isArray(value.items)) {
      result.items = value.items.map((child, index) =>
        visit(child, `/items/${index}`)
      );
    } else if (object(value.items)) result.items = visit(value.items, "/items");
    // Instance-valued annotations such as const/enum/default/examples are copied
    // unchanged, including literal objects with keys named $ref or $id.
    return result;
  };
  const collect = (value: unknown, base: string, path: string) => {
    if (!object(value)) return;
    const current = typeof value.$id === "string"
      ? new URL(value.$id, base).href
      : base;
    if (path === "" || typeof value.$id === "string") {
      resources.set(current, path);
    }
    if (path === "") resources.set(current.split("#")[0], path);
    if (typeof value.$anchor === "string") {
      resources.set(`${current.split("#")[0]}#${value.$anchor}`, path);
    }
    children(value, (child, suffix) => {
      collect(child, current, path + suffix);
      return child;
    });
  };
  collect(schema, initialBase, "");
  const visit = (value: unknown, base: string): unknown => {
    if (!object(value)) return value;
    const current = typeof value.$id === "string"
      ? new URL(value.$id, base).href
      : base;
    const result = children(value, (child) => visit(child, current));
    delete result.$id;
    if (typeof value.$ref === "string") {
      const resolved = new URL(value.$ref, current);
      const exact = resources.get(resolved.href);
      if (exact !== undefined) result.$ref = `#/$defs/${key}${exact}`;
      else {
        const resource = resources.get(resolved.href.split("#")[0]);
        result.$ref = resource !== undefined &&
            (!resolved.hash || resolved.hash.startsWith("#/"))
          ? `#/$defs/${key}${resource}${resolved.hash.slice(1)}`
          : resolved.href;
      }
      // External references retain their resolved identity; no remote schema is
      // fetched here. API and client validators decide whether they are known.
    }
    return result;
  };
  return visit(schema, initialBase) as ObjectValue;
}

function executeSchema(entries: Entry[]): ObjectValue {
  const defs: ObjectValue = {};
  const oneOf = entries.map((entry, index) => {
    const key = `operation_${index}`;
    defs[key] = embedded(entry.input_schema, key);
    return {
      type: "object",
      required: ["operation"],
      properties: {
        operation: { const: entry.operation },
        arguments: { $ref: `#/$defs/${key}` },
      },
      additionalProperties: false,
    };
  });
  return { type: "object", $defs: defs, oneOf };
}

function deploymentSchema(byName: Map<string, Entry>): ObjectValue {
  const defs: ObjectValue = {};
  const anyOf: ObjectValue[] = [];
  for (const [index, name] of requestOperations.entries()) {
    const entry = byName.get(name);
    if (!entry) continue;
    const key = `request_${index}`;
    if (name === "deployment.jobs.request") {
      defs[key] = embedded(entry.input_schema, key);
      anyOf.push({
        allOf: [{ $ref: `#/$defs/${key}` }, {
          not: {
            type: "object",
            required: ["provider", "operation"],
            properties: {
              provider: { enum: ["github", "supabase"] },
              operation: { not: { const: "read" } },
            },
          },
        }],
      });
      continue;
    }
    const hidden = name === "engineering.change.register"
      ? ["idempotency_key"]
      : name === "engineering.change.status"
      ? ["status"]
      : [];
    const implementation = name === "engineering.implementation.request";
    const canonical = `canonical_${index}`;
    const properties = object(entry.input_schema.properties)
      ? entry.input_schema.properties
      : {};
    const property = (
      name: string,
      fallback: ObjectValue = { type: "string" },
    ) =>
      own(properties, name)
        ? { $ref: `#/$defs/${canonical}/properties/${name}` }
        : fallback;
    if (implementation) {
      defs[canonical] = embedded(entry.input_schema, canonical);
      defs[key] = {
        allOf: [property("payload", { type: "object" }), {
          type: "object",
          properties: {
            engineering_change_id: property("change_id", {
              type: "string",
              format: "uuid",
            }),
          },
          required: ["engineering_change_id"],
        }],
      };
    } else {defs[key] = embedded(
        projectedSchema(entry.input_schema, hidden),
        key,
      );}
    anyOf.push({
      type: "object",
      required: [
        "provider",
        "operation",
        "target",
        "idempotency_key",
        "payload",
      ],
      properties: {
        provider: implementation ? property("provider") : { const: "supabase" },
        operation: implementation ? property("operation") : {
          const: name === "engineering.change.register"
            ? "register_change"
            : name === "engineering.change.status"
            ? "approve_change"
            : "get_change",
        },
        target: implementation
          ? property("target")
          : { const: "sandy-engineering-control" },
        idempotency_key: implementation
          ? property("idempotency_key")
          : object(properties.idempotency_key)
          ? clone(properties.idempotency_key)
          : { type: "string" },
        payload: { $ref: `#/$defs/${key}` },
      },
      additionalProperties: false,
      ...(implementation
        ? {
          not: {
            type: "object",
            required: ["provider", "operation", "target"],
            properties: {
              provider: { const: "supabase" },
              target: { const: "sandy-engineering-control" },
              operation: {
                enum: ["register_change", "approve_change", "get_change"],
              },
            },
          },
        }
        : {}),
    });
  }
  return { type: "object", $defs: defs, anyOf };
}

function discovery(entries: Entry[]) {
  const byName = new Map(entries.map((entry) => [entry.operation, entry]));
  const gaps: Gap[] = [];
  const tools: ObjectValue[] = entries.filter((entry) => {
    if (!legacyToolNames.includes(entry.operation)) return true;
    gaps.push({
      name: entry.operation,
      operation: entry.operation,
      reason: "canonical_name_reserved_for_legacy_alias",
    });
    return false;
  }).map((entry) => ({
    name: entry.operation,
    description: typeof entry.description === "string"
      ? entry.description
      : `Sandy API operation: ${entry.operation}`,
    inputSchema: clone(entry.input_schema),
    ...(object(entry.output_schema) && entry.output_schema.type === "object"
      ? { outputSchema: clone(entry.output_schema) }
      : {}),
  }));
  const add = (name: string, operation: string, input?: ObjectValue) => {
    const entry = byName.get(operation);
    if (!entry) {
      gaps.push({ name, operation, reason: "canonical_operation_unavailable" });
      return;
    }
    tools.push({
      name,
      description: `Compatibility alias for ${operation}. ${
        typeof entry.description === "string"
          ? entry.description
          : "Sandy API owns authorization and execution."
      }`,
      inputSchema: input ?? clone(entry.input_schema),
      ...(object(entry.output_schema) && entry.output_schema.type === "object"
        ? { outputSchema: clone(entry.output_schema) }
        : {}),
      _meta: { sandy_operation: operation, sandy_compatibility_alias: true },
    });
  };
  for (const [name, operation] of Object.entries(directAliases)) {
    add(name, operation);
  }
  const status = byName.get("engineering.change.status");
  add(
    "engineering_change_approve",
    "engineering.change.status",
    status ? projectedSchema(status.input_schema, ["status"]) : undefined,
  );
  const request = byName.get("deployment.jobs.request");
  add(
    "vm_install_worker",
    "deployment.jobs.request",
    request
      ? projectedSchema(request.input_schema, Object.keys(workerConstants))
      : undefined,
  );
  tools.push({
    name: "operations_list",
    description:
      "List caller-authorized executable MCP capabilities from Sandy API. Uninstalled registry rows and edge-function inventory are not included.",
    inputSchema: {
      type: "object",
      properties: {
        domain: { type: "string", maxLength: 80 },
        limit: { type: "integer", minimum: 1, maximum: 100 },
      },
      additionalProperties: false,
    },
  });
  tools.push({
    name: "operations_describe",
    description: "Describe an executable MCP capability through Sandy API.",
    inputSchema: {
      type: "object",
      required: ["operation"],
      properties: {
        operation: {
          type: "string",
          ...(entries.length
            ? { enum: entries.map((entry) => entry.operation) }
            : {}),
        },
      },
      additionalProperties: false,
    },
  });
  if (entries.length) {
    tools.push({
      name: "operations_execute",
      description:
        "Invoke a currently exposed operation through Sandy API. API validates its current schema and permissions.",
      inputSchema: executeSchema(entries),
    });
  } else {gaps.push({
      name: "operations_execute",
      reason: "no_mcp_executable_operations",
    });}
  if (requestOperations.some((operation) => byName.has(operation))) {
    tools.push({
      name: "deployment_request",
      description:
        "Translate supported legacy deployment request forms to Sandy API. Availability of each request form follows the canonical catalogue.",
      inputSchema: deploymentSchema(byName),
      _meta: {
        sandy_route_gaps: requestOperations.filter((operation) =>
          !byName.has(operation)
        ).map((operation) => ({
          operation,
          reason: "canonical_operation_unavailable",
        })),
      },
    });
  } else {gaps.push({
      name: "deployment_request",
      reason: "canonical_operation_unavailable",
    });}
  // Never let a registry operation shadow a legacy alias with another contract.
  const unique = new Set<string>();
  return {
    byName,
    gaps,
    tools: tools.filter((tool) => {
      if (typeof tool.name !== "string" || unique.has(tool.name)) return false;
      unique.add(tool.name);
      return true;
    }),
  };
}

function deploymentRoute(args: ObjectValue): Route | null {
  if (
    Object.keys(args).some((key) =>
      !["provider", "operation", "target", "idempotency_key", "payload"]
        .includes(key)
    ) ||
    typeof args.provider !== "string" || typeof args.operation !== "string" ||
    typeof args.target !== "string" ||
    typeof args.idempotency_key !== "string" ||
    (args.payload !== undefined && !object(args.payload))
  ) return null;
  const payload = (args.payload ?? {}) as ObjectValue;
  if (
    args.provider === "supabase" &&
    args.target === "sandy-engineering-control" &&
    ["register_change", "approve_change", "get_change"].includes(args.operation)
  ) {
    if (
      own(payload, "action") ||
      (args.operation === "approve_change" && own(payload, "status"))
    ) return null;
    if (args.operation === "register_change") {
      return {
        operation: "engineering.change.register",
        arguments: { ...payload, idempotency_key: args.idempotency_key },
      };
    }
    if (args.operation === "approve_change") {
      return {
        operation: "engineering.change.status",
        arguments: { ...payload, status: "approved" },
      };
    }
    return { operation: "engineering.change.get", arguments: payload };
  }
  if (
    ["github", "supabase"].includes(args.provider) && args.operation !== "read"
  ) {
    return {
      operation: "engineering.implementation.request",
      arguments: {
        change_id: payload.engineering_change_id,
        provider: args.provider,
        operation: args.operation,
        target: args.target,
        idempotency_key: args.idempotency_key,
        payload,
      },
    };
  }
  return {
    operation: "deployment.jobs.request",
    arguments: { ...args, payload },
  };
}

function resolve(name: string, args: ObjectValue): Route | null {
  if (name === "operations_execute") {
    if (
      !operationName(args.operation) ||
      (args.arguments !== undefined && !object(args.arguments)) ||
      Object.keys(args).some((key) => !["operation", "arguments"].includes(key))
    ) return null;
    return {
      operation: args.operation,
      arguments: (args.arguments ?? {}) as ObjectValue,
    };
  }
  if (name === "engineering_change_approve") {
    if (own(args, "status") || own(args, "action")) return null;
    return {
      operation: "engineering.change.status",
      arguments: { ...args, status: "approved" },
    };
  }
  if (name === "vm_install_worker") {
    if (Object.keys(args).some((key) => key !== "idempotency_key")) return null;
    return {
      operation: "deployment.jobs.request",
      arguments: {
        ...clone(workerConstants),
        idempotency_key: args.idempotency_key,
      },
    };
  }
  if (name === "deployment_request") return deploymentRoute(args);
  return {
    operation: Object.hasOwn(directAliases, name) ? directAliases[name] : name,
    arguments: args,
  };
}

function failed(value: unknown): boolean {
  return object(value) &&
    (value.ok === false || value.error != null ||
      (own(value, "accepted") && value.accepted !== true) ||
      (object(value.result) && failed(value.result)));
}
function successful(a: ApiResult, operation: string): boolean {
  if (
    a.status < 200 || a.status >= 300 || !object(a.result) ||
    a.result.ok !== true || failed(a.result) ||
    (a.result.operation !== undefined && a.result.operation !== operation)
  ) return false;
  if (a.result.executed === true) return object(a.result.result);
  if (
    a.status !== 202 || a.result.accepted !== true ||
    a.result.executed !== false ||
    typeof a.result.reused !== "boolean" ||
    typeof a.result.dispatch_required !== "boolean"
  ) return false;
  return (uuid(a.result.job_id) && typeof a.result.state === "string") ||
    (a.result.request_state === "recorded" && uuid(a.result.source_job_id) &&
      uuid(a.result.retry_job_id) &&
      typeof a.result.retry_job_status === "string" &&
      Number.isSafeInteger(a.result.retry_depth) &&
      Number(a.result.retry_depth) >= 1);
}
function legacyPayload(name: string, a: ApiResult): unknown {
  if (!object(a.result)) {
    return { http_status: a.status, error: "invalid_api_response" };
  }
  const payload = object(a.result.result) ? a.result.result : a.result;
  if (
    ["vm_install_worker", "deployment_request"].includes(name) &&
    uuid(payload.job_id) && typeof payload.state === "string"
  ) {
    return { ...payload, id: payload.job_id, status: payload.state };
  }
  if (name === "cloud_targets" && Array.isArray(payload.targets)) {
    return payload.targets;
  }
  if (
    ["operations_status", "deployment_status"].includes(name) &&
    object(payload.job)
  ) return payload.job;
  return { http_status: a.status, ...payload };
}
function missingResult(
  name: string,
  operation: string | undefined,
  version: string,
) {
  return {
    isError: true,
    content: [{
      type: "text",
      text: JSON.stringify({
        ok: false,
        error: "canonical_operation_unavailable",
        tool: name,
        ...(operation ? { operation } : {}),
        executed: false,
      }),
    }],
    _meta: { sandy_catalogue_version: version },
  };
}

async function readBody(req: Request): Promise<unknown> {
  const reader = req.body?.getReader();
  if (!reader) throw Error("invalid_json");
  const parts: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > 65536) {
      await reader.cancel();
      throw Error("request_too_large");
    }
    parts.push(value);
  }
  const joined = new Uint8Array(size);
  let offset = 0;
  for (const part of parts) {
    joined.set(part, offset);
    offset += part.length;
  }
  return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(joined));
}

export function createLegacyHandler(
  api: InvokeApi,
  options: { resource?: string; issuer?: string } = {},
) {
  return async (req: Request): Promise<Response> => {
    const url = new URL(req.url);
    if (req.method === "GET" && url.searchParams.get("health") === "1") {
      return json({
        ok: true,
        service: "sandy-operations-mcp",
        protocol: "2025-03-26",
        tool_count: legacyToolNames.length,
        tool_count_scope: "compatibility_aliases",
        tools_dynamic: true,
        execution: "sandy-api-only",
        authentication: "required",
        build: "sandy-api-adapter-v1",
      });
    }
    if (
      req.method === "GET" &&
      url.pathname.endsWith("/.well-known/oauth-protected-resource")
    ) {
      return json({
        resource: options.resource ??
          url.origin +
            url.pathname.replace(
              /\/\.well-known\/oauth-protected-resource$/,
              "",
            ),
        authorization_servers: options.issuer ? [options.issuer] : [],
      });
    }
    if (req.method !== "POST") {
      return json(
        {
          error: req.headers.get("accept")?.includes("text/event-stream")
            ? "stream_not_supported"
            : "method_not_allowed",
        },
        405,
        { Allow: "POST" },
      );
    }
    const token = (req.headers.get("authorization") ?? "").match(
      /^Bearer ([A-Za-z0-9._~-]+)$/i,
    )?.[1];
    if (!token) {
      return json(
        {
          error: "unauthorized",
          error_description: "Connect with Sandy Supabase OAuth",
        },
        401,
        options.resource
          ? {
            "WWW-Authenticate":
              `Bearer resource_metadata="${options.resource}"`,
          }
          : {},
      );
    }
    const apiKey = req.headers.get("x-sandy-api-key");
    if (apiKey !== null && !apiKey) {
      return json({ error: "api_key_context_required" }, 401);
    }
    // Only Sandy API resolves a private issued key. The Authorization header
    // remains the caller's actual user JWT or public platform JWT.
    const authContext: ApiAuthContext | undefined = apiKey === null &&
        !req.headers.has("x-sandy-approval-id") &&
        !req.headers.has("x-sandy-request-id")
      ? undefined
      : {
        ...(apiKey === null ? {} : { apiKey }),
        ...(req.headers.has("x-sandy-approval-id")
          ? { approvalId: req.headers.get("x-sandy-approval-id")! }
          : {}),
        ...(req.headers.has("x-sandy-request-id")
          ? { requestId: req.headers.get("x-sandy-request-id")! }
          : {}),
      };
    if (!executionHeaders(authContext)) {
      return json({ error: "invalid_execution_metadata" }, 400);
    }
    let parsed: unknown;
    try {
      parsed = await readBody(req);
    } catch (error) {
      return json(
        rpcError(
          null,
          -32700,
          error instanceof Error && error.message === "request_too_large"
            ? "Request too large"
            : "Parse error",
        ),
        error instanceof Error && error.message === "request_too_large"
          ? 413
          : 400,
      );
    }
    if (
      !object(parsed) || parsed.jsonrpc !== "2.0" ||
      typeof parsed.method !== "string" ||
      (own(parsed, "id") &&
        !(parsed.id === null || typeof parsed.id === "string" ||
          (typeof parsed.id === "number" && Number.isFinite(parsed.id)))) ||
      (parsed.params !== undefined && !object(parsed.params))
    ) return json(rpcError(null, -32600, "Invalid JSON-RPC request"), 400);
    const id = parsed.id ?? null;
    const params = (parsed.params ?? {}) as ObjectValue;
    if (!own(parsed, "id") && parsed.method !== "notifications/initialized") {
      return json(rpcError(null, -32600, "Request ID required"), 400);
    }
    if (params._meta !== undefined && !object(params._meta)) {
      return json(rpcError(id, -32602, "Invalid metadata"), 400);
    }
    try {
      const a = await api(token, { action: "list" }, authContext);
      const current = catalogue(a);
      if (!current) {
        return json(
          rpcError(id, -32000, "Sandy API catalogue unavailable"),
          a.status >= 400 && a.status <= 599 ? a.status : 502,
        );
      }
      const discovered = discovery(current.entries);
      const meta = {
        sandy_catalogue_version: current.version,
        sandy_compatibility_gaps: discovered.gaps,
        ...(object(params._meta) &&
            typeof params._meta.sandy_catalogue_version === "string" &&
            params._meta.sandy_catalogue_version !== current.version
          ? { sandy_catalogue_changed: true }
          : {}),
      };
      if (parsed.method === "notifications/initialized") {
        return own(parsed, "id")
          ? json(rpcError(id, -32600, "Notification must not have an ID"), 400)
          : new Response(null, { status: 202 });
      }
      if (parsed.method === "initialize") {
        if (
          typeof params.protocolVersion !== "string" ||
          !object(params.capabilities) || !object(params.clientInfo) ||
          typeof params.clientInfo.name !== "string" ||
          typeof params.clientInfo.version !== "string"
        ) {
          return json(
            rpcError(id, -32602, "Invalid initialization parameters"),
            400,
          );
        }
        return json(
          rpc(id, {
            protocolVersion: "2025-03-26",
            capabilities: { tools: {} },
            serverInfo: { name: "Sandy Private Operations", version: "0.3.0" },
            _meta: meta,
          }),
        );
      }
      if (parsed.method === "ping") return json(rpc(id, { _meta: meta }));
      if (parsed.method === "tools/list") {
        return params.cursor !== undefined
          ? json(
            rpcError(id, -32602, "Pagination cursor is not supported"),
            400,
          )
          : json(rpc(id, { tools: discovered.tools, _meta: meta }));
      }
      if (parsed.method !== "tools/call") {
        return json(rpcError(id, -32601, "Method not found"));
      }
      if (
        typeof params.name !== "string" || !operationName(params.name) ||
        (params.arguments !== undefined && !object(params.arguments))
      ) return json(rpcError(id, -32602, "Invalid tool call parameters"), 400);
      const name = params.name, args = (params.arguments ?? {}) as ObjectValue;
      if (name === "operations_list") {
        if (
          Object.keys(args).some((key) => !["domain", "limit"].includes(key)) ||
          (args.domain !== undefined &&
            (typeof args.domain !== "string" || args.domain.length > 80)) ||
          (args.limit !== undefined &&
            (!Number.isInteger(args.limit) || Number(args.limit) < 1 ||
              Number(args.limit) > 100))
        ) return json(rpcError(id, -32602, "Invalid discovery arguments"), 400);
        const entries = current.entries.filter((entry) =>
          args.domain === undefined || entry.domain === args.domain
        ).slice(0, Number(args.limit ?? 50));
        return json(rpc(id, {
          isError: false,
          content: [{
            type: "text",
            text: JSON.stringify({
              operations: entries,
              count: entries.length,
              catalogue_scope: "caller_authorized_executable_mcp_operations",
              unavailable_metadata: [
                "uninstalled_registry_rows",
                "edge_function_inventory",
              ],
              catalogue_version: current.version,
            }),
          }],
          _meta: meta,
        }));
      }
      if (name === "operations_describe") {
        if (
          !operationName(args.operation) ||
          Object.keys(args).some((key) => key !== "operation")
        ) return json(rpcError(id, -32602, "Invalid describe arguments"), 400);
        if (!discovered.byName.has(args.operation)) {
          return json(
            rpc(id, missingResult(name, args.operation, current.version)),
          );
        }
        const described = await api(token, {
          action: "describe",
          channel: "mcp",
          operation: args.operation,
        }, authContext);
        const good = described.status === 200 && object(described.result) &&
          described.result.ok === true && object(described.result.operation) &&
          described.result.operation.operation === args.operation;
        return json(rpc(id, {
          isError: !good,
          content: [{
            type: "text",
            text: JSON.stringify(
              good && object(described.result)
                ? described.result.operation
                : { http_status: described.status, result: described.result },
            ),
          }],
          _meta: meta,
        }));
      }
      const route = resolve(name, args);
      if (!route) {
        return json(
          rpcError(id, -32602, "Invalid compatibility arguments"),
          400,
        );
      }
      if (!discovered.byName.has(route.operation)) {
        return json(
          rpc(id, missingResult(name, route.operation, current.version)),
        );
      }
      let executed: ApiResult;
      try {
        executed = await api(token, {
          action: "execute",
          channel: "mcp",
          operation: route.operation,
          arguments: route.arguments,
        }, authContext);
      } catch {
        return json(rpc(id, {
          isError: true,
          content: [{
            type: "text",
            text: JSON.stringify({
              ok: false,
              error: "sandy_api_outcome_unknown",
              operation: route.operation,
              executed: null,
              reconciliation_required: true,
            }),
          }],
          _meta: meta,
        }));
      }
      const good = successful(executed, route.operation);
      const payload = object(executed.result) && object(executed.result.result)
        ? executed.result.result
        : executed.result;
      return json(
        rpc(id, {
          isError: !good,
          ...(good && object(payload) ? { structuredContent: payload } : {}),
          content: [{
            type: "text",
            text: JSON.stringify(legacyPayload(name, executed)),
          }],
          _meta: {
            ...meta,
            sandy_api: { status: executed.status, result: executed.result },
          },
        }),
      );
    } catch {
      return json(rpcError(id, -32000, "Sandy API unavailable"), 502);
    }
  };
}

if (import.meta.main) {
  const base = Deno.env.get("SUPABASE_URL") ?? "";
  Deno.serve(
    createLegacyHandler(
      createApi(base, Deno.env.get("SUPABASE_ANON_KEY") ?? ""),
      {
        resource: `${base}/functions/v1/sandy-operations-mcp`,
        issuer: `${base}/auth/v1`,
      },
    ),
  );
}
