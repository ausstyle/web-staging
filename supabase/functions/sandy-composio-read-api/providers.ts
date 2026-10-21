import { argumentDigest, requestJson } from "../_shared/sandy_api_protocol.ts";
import { createRegistrySchemaValidator } from "../sandy-operation-api/registry_schema_validator.ts";
export type Obj = Record<string, unknown>;
export const object = (v: unknown): v is Obj =>
  !!v && typeof v === "object" && !Array.isArray(v);
export class ComposioReadError extends Error {
  constructor(
    public code: string,
    public status = 502,
    public providerStatus: number | null = null,
    public attempted = false,
  ) {
    super(code);
  }
}
const forbidden = new Set([
  "access_token",
  "refresh_token",
  "id_token",
  "authorization",
  "password",
  "client_secret",
  "api_key",
  "credentials",
  "credential",
  "private_key",
  "secret",
  "token",
]);
/** Reviewed profiles deliberately use a bounded literal schema subset. No caller
 * regex, refs, URI resolver, union selector or arbitrary object passthrough. */
export function reviewedSchema(
  schema: unknown,
  depth = 0,
  budget = { nodes: 0 },
): boolean {
  if (!object(schema) || depth > 8 || ++budget.nodes > 256) return false;
  const allowed = new Set([
    "type",
    "properties",
    "required",
    "additionalProperties",
    "items",
    "minItems",
    "maxItems",
    "minLength",
    "maxLength",
    "minimum",
    "maximum",
    "enum",
    "const",
    "description",
  ]);
  if (Object.keys(schema).some((k) => !allowed.has(k))) return false;
  if (
    schema.enum !== undefined &&
    (!Array.isArray(schema.enum) || schema.enum.length < 1 ||
      schema.enum.length > 100)
  ) return false;
  if (schema.type === "object") {
    if (
      schema.additionalProperties !== false || !object(schema.properties) ||
      Object.keys(schema.properties).length > 100 ||
      !Array.isArray(schema.required) || schema.required.some((k) =>
        typeof k !== "string" || !Object.hasOwn(schema.properties as Obj, k)
      )
    ) {
      return false;
    }
    return Object.entries(schema.properties).every(([k, v]) =>
      k.length <= 100 && !forbidden.has(k.toLowerCase()) &&
      reviewedSchema(v, depth + 1, budget)
    );
  }
  if (schema.type === "array") {
    return Number.isInteger(schema.maxItems) && Number(schema.maxItems) >= 0 &&
      Number(schema.maxItems) <= 100 &&
      reviewedSchema(schema.items, depth + 1, budget);
  }
  if (schema.type === "string") {
    return Number.isInteger(schema.maxLength) &&
      Number(schema.maxLength) >= 0 && Number(schema.maxLength) <= 10000;
  }
  if (["integer", "number"].includes(String(schema.type))) {
    return typeof schema.minimum === "number" &&
      typeof schema.maximum === "number" && Number.isFinite(schema.minimum) &&
      Number.isFinite(schema.maximum) &&
      Math.abs(schema.minimum) <= Number.MAX_SAFE_INTEGER &&
      Math.abs(schema.maximum) <= Number.MAX_SAFE_INTEGER &&
      schema.minimum <= schema.maximum;
  }
  return ["boolean", "null"].includes(String(schema.type));
}
export function validReadProfile(v: unknown): v is Obj {
  return object(v) && v.effect_contract === "reviewed_read_only" &&
    v.enabled === true && typeof v.profile_id === "string" &&
    /^[a-z0-9_-]{3,100}$/.test(v.profile_id) &&
    typeof v.toolkit_slug === "string" &&
    /^[a-z0-9_-]{2,80}$/.test(v.toolkit_slug) &&
    typeof v.tool_slug === "string" &&
    /^[A-Za-z0-9_-]{3,120}$/.test(v.tool_slug) &&
    typeof v.provider_definition_sha256 === "string" &&
    /^[a-f0-9]{64}$/.test(v.provider_definition_sha256) &&
    typeof v.review_reference === "string" && v.review_reference.length >= 8 &&
    v.review_reference.length <= 1000 && object(v.input_schema) &&
    v.input_schema.type === "object" && object(v.output_schema) &&
    v.output_schema.type === "object" && reviewedSchema(v.input_schema) &&
    reviewedSchema(v.output_schema);
}
export function emptyReadResult(profileId: string | null = null): Obj {
  return {
    toolkits: [],
    data: null,
    profile_id: profileId,
    result_sha256: null,
    provider_verified: false,
    source: "composio_customer_read_service",
    payload_stored: false,
  };
}
export async function executeComposioRead(
  deps: { fetch: typeof fetch; key: string },
  operation: string,
  args: Obj,
  context: Obj,
): Promise<{ result: Obj; providerStatus: number }> {
  const validator = createRegistrySchemaValidator();
  const tenant = context.tenant_id;
  if (
    typeof tenant !== "string" || !Array.isArray(context.connections) ||
    context.connections.length > 100 || !Array.isArray(context.profiles) ||
    context.profiles.length > 100
  ) throw new ComposioReadError("private_customer_context_invalid", 503);
  const executing = operation === "composio.execute_read",
    profile = context.profile;
  if (
    executing &&
    (!validReadProfile(profile) || profile.profile_id !== args.profile_id ||
      validator.isValid(profile.input_schema, args.arguments) !== true)
  ) throw new ComposioReadError("reviewed_read_profile_invalid", 424);
  let attempted = false;
  const remote = async (
    path: string,
    body?: Obj,
  ): Promise<{ value: Obj; status: number }> => {
    let response: Response;
    try {
      if (body) attempted = true;
      response = await deps.fetch("https://backend.composio.dev" + path, {
        method: body ? "POST" : "GET",
        redirect: "error",
        headers: { "x-api-key": deps.key, "content-type": "application/json" },
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(20000),
      });
    } catch {
      throw new ComposioReadError(
        "provider_read_response_unavailable",
        502,
        null,
        attempted,
      );
    }
    if (!response.ok) {
      throw new ComposioReadError(
        "provider_read_refused",
        502,
        response.status,
        attempted,
      );
    }
    const value = await requestJson(
      new Request(
        "https://bounded.invalid",
        { method: "POST", body: response.body, duplex: "half" } as RequestInit,
      ),
      300000,
    ).catch(() => null);
    if (!object(value)) {
      throw new ComposioReadError(
        "provider_read_response_invalid",
        502,
        response.status,
        attempted,
      );
    }
    return { value, status: response.status };
  };
  const accounts = await remote(
    "/api/v3.1/connected_accounts?limit=100&user_ids=" +
      encodeURIComponent("sandy_customer_" + tenant),
  );
  if (accounts.value.next_cursor) {
    throw new ComposioReadError(
      "provider_connection_inventory_incomplete",
      503,
      accounts.status,
    );
  }
  const entries = accounts.value.items ?? accounts.value.data;
  if (
    !Array.isArray(entries) || entries.length > 100 ||
    entries.some((x) => !object(x))
  ) {
    throw new ComposioReadError(
      "provider_connection_inventory_invalid",
      502,
      accounts.status,
    );
  }
  const accountEntries: unknown[] = entries;
  function verified(connection: Obj): boolean {
    const candidates = accountEntries.filter((x) =>
      object(x) && x.id === connection.connected_account_id
    );
    if (candidates.length > 1) {
      throw new ComposioReadError(
        "provider_connection_inventory_ambiguous",
        502,
        accounts.status,
      );
    }
    const item = candidates[0];
    return object(item) && item.user_id === "sandy_customer_" + tenant &&
      String(item.status).toUpperCase() === "ACTIVE" &&
      (object(item.toolkit) ? item.toolkit.slug : item.toolkit_slug) ===
        connection.toolkit_slug &&
      String(connection.status).toUpperCase() === "ACTIVE";
  }
  if (!executing) {
    const toolkits = context.connections.map((c) => {
      if (
        !object(c) || typeof c.connected_account_id !== "string" ||
        typeof c.toolkit_slug !== "string" ||
        !/^[a-z0-9_-]{2,80}$/.test(c.toolkit_slug)
      ) throw new ComposioReadError("private_customer_context_invalid", 503);
      return {
        toolkit_slug: c.toolkit_slug,
        company_id: c.company_id,
        provider_confirmed_active: verified(c),
        read_profiles: (context.profiles as unknown[]).filter((p) =>
          object(p) && p.toolkit_slug === c.toolkit_slug
        ).map((p) => (p as Obj).profile_id),
      };
    });
    const result: Obj = {
      ...emptyReadResult(),
      toolkits,
      provider_verified: true,
    };
    result.result_sha256 = await argumentDigest({
      ...result,
      result_sha256: null,
    });
    return { result, providerStatus: accounts.status };
  }
  if (
    context.connections.length !== 1 || !object(context.connections[0]) ||
    !verified(context.connections[0])
  ) {
    throw new ComposioReadError(
      "provider_connection_not_verified",
      403,
      accounts.status,
    );
  }
  const connection = context.connections[0], p = profile as Obj;
  if (
    connection.toolkit_slug !== p.toolkit_slug ||
    connection.company_id !== args.company_id
  ) {
    throw new ComposioReadError(
      "private_customer_connection_binding_invalid",
      503,
    );
  }
  const tools = await remote(
    "/api/v3/tools?toolkit_slug=" + encodeURIComponent(String(p.toolkit_slug)) +
      "&limit=100",
  );
  const definitions = tools.value.items ?? tools.value.data;
  if (tools.value.next_cursor) {
    throw new ComposioReadError(
      "provider_tool_inventory_incomplete",
      503,
      tools.status,
    );
  }
  if (!Array.isArray(definitions) || definitions.length > 100) {
    throw new ComposioReadError(
      "provider_tool_inventory_invalid",
      502,
      tools.status,
    );
  }
  const matches = definitions.filter((x) =>
    object(x) && (x.slug ?? x.name) === p.tool_slug
  );
  if (
    matches.length !== 1 ||
    await argumentDigest(matches[0]) !== p.provider_definition_sha256
  ) {
    throw new ComposioReadError(
      "reviewed_provider_definition_changed",
      409,
      tools.status,
    );
  }
  const read = await remote(
    "/api/v3/tools/execute/" + encodeURIComponent(String(p.tool_slug)),
    {
      connected_account_id: connection.connected_account_id,
      arguments: args.arguments,
    },
  );
  if (
    read.value.successful !== true ||
    read.value.error !== null && read.value.error !== undefined ||
    !object(read.value.data) ||
    validator.isValid(p.output_schema, read.value.data) !== true ||
    new TextEncoder().encode(JSON.stringify(read.value.data)).byteLength >
      100000
  ) {
    throw new ComposioReadError(
      "reviewed_provider_output_invalid",
      502,
      read.status,
      true,
    );
  }
  const result: Obj = {
    ...emptyReadResult(String(p.profile_id)),
    data: read.value.data,
    provider_verified: true,
  };
  result.result_sha256 = await argumentDigest(read.value.data);
  return { result, providerStatus: read.status };
}
