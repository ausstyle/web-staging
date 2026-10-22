import { Ajv } from "npm:ajv@8.17.1";
import { fullFormats } from "npm:ajv-formats@3.0.1/dist/formats.js";

/** Fixed compatibility requests to the deployed, tenant-scoped application
 * services (workspace v33, Composio gateway v32). This is an executor map;
 * public.sandy_operation_registry remains the only runtime catalogue.
 * Side-effecting/model-consuming branches must remain disabled until their
 * idempotency, authorization, cost and real functional evidence are established.
 */
type Obj = Record<string, unknown>;
export type CustomerOperationContract = {
  handler: "sandy-workspace" | "sandy-composio-gateway";
  action: string;
  authentication: "portal_user" | "owner_portal_user";
  permission_scope: string;
  is_mutation: boolean;
  consumes_model_resources: boolean;
  input_schema: Obj;
  output_schema: Obj;
  description: string;
  fixed?: Obj;
  requirement_ids: number[];
};
const uid = { type: "string", format: "uuid" };
const nullableUid = { type: ["string", "null"], format: "uuid" };
const str = (maximum: number, minimum = 1) => ({
  type: "string",
  minLength: minimum,
  maxLength: maximum,
});
const pattern = (value: string) => ({ type: "string", pattern: value });
const choices = (...values: string[]) => ({ type: "string", enum: values });
const obj = (properties: Obj = {}, required: string[] = []): Obj => ({
  type: "object",
  properties,
  required,
  additionalProperties: false,
});
const result = (properties: Obj, required = Object.keys(properties)): Obj => ({
  type: "object",
  properties: {
    ok: { const: true },
    contract_version: { const: "1.0.0" },
    ...properties,
  },
  required: ["ok", "contract_version", ...required],
  additionalProperties: true,
});
const record = { type: "object" };
const records = { type: "array", maxItems: 200, items: record };
const boolean = { type: "boolean" };
const toolkit = pattern("^[a-z0-9_-]{2,80}$");
const company = { company_id: nullableUid };
const definitions: Record<string, CustomerOperationContract> = {};
function workspace(
  operation: string,
  action: string,
  mutation: boolean,
  input: Obj,
  output: Obj,
  requirements: number[],
  fixed?: Obj,
  consumesModel = false,
) {
  definitions[operation] = {
    handler: "sandy-workspace",
    action,
    authentication: "portal_user",
    permission_scope: `workspace:${mutation ? "write" : "read"}`,
    is_mutation: mutation,
    consumes_model_resources: consumesModel,
    input_schema: input,
    output_schema: output,
    description:
      `Invoke fixed workspace action ${action} as the confirmed portal user; tenant and resource ownership are independently checked by the application service. Contract v1.0.0.`,
    requirement_ids: requirements,
    ...(fixed ? { fixed } : {}),
  };
}
workspace(
  "workspace.overview",
  "overview",
  false,
  obj(),
  result({
    name: str(500),
    email: str(320),
    counts: record,
    conversation_counts: record,
  }),
  [151, 153],
);
workspace(
  "workspace.command_centre",
  "command_centre",
  false,
  obj(),
  result({
    counts: record,
    approvals: records,
    alerts: records,
    working: records,
    summary: str(2000),
  }),
  [153, 154],
);
workspace(
  "workspace.search",
  "global_search",
  false,
  obj({ query: str(100, 2) }, ["query"]),
  result({
    results: records,
    coverage: { type: "array", items: str(100) },
    note: str(2000),
  }),
  [151, 153, 160],
);
workspace(
  "workspace.history",
  "history",
  false,
  obj({
    channel: choices("all", "email", "whatsapp", "voice", "web"),
    query: str(180, 0),
    limit: { type: "integer", minimum: 1, maximum: 50 },
    cursor: obj({
      offset: { type: "integer", minimum: 0, maximum: 100000 },
      cutoff: { type: "string", format: "date-time" },
    }),
    whatsapp_view: choices("topics", "timeline"),
  }),
  result({
    items: records,
    total: { type: "integer", minimum: 0 },
    counts: record,
    next_cursor: { type: ["object", "null"] },
  }),
  [151],
);
workspace(
  "workspace.missions.list",
  "mission_overview",
  false,
  obj(),
  result({ missions: records }),
  [154],
);
workspace(
  "workspace.missions.create",
  "mission_create",
  true,
  obj({
    title: str(240, 3),
    objective: str(6000, 10),
    success_criteria: str(2000, 0),
  }, ["title", "objective"]),
  result({
    task_id: uid,
    status: { const: "awaiting_plan" },
    message: str(2000),
  }),
  [154],
);
workspace(
  "workspace.missions.files.prepare",
  "mission_file_prepare",
  true,
  obj({
    question_id: uid,
    filename: str(200),
    mime_type: choices(
      "application/pdf",
      "image/png",
      "image/jpeg",
      "text/plain",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "application/msword",
      "application/vnd.ms-excel",
    ),
    size_bytes: { type: "integer", minimum: 1, maximum: 20971520 },
  }, ["question_id", "filename", "mime_type", "size_bytes"]),
  result({ file_id: uid, path: str(1000), token: str(10000) }),
  [154, 156],
);
workspace(
  "workspace.missions.files.confirm",
  "mission_file_confirm",
  true,
  obj({ file_id: uid }, ["file_id"]),
  result({ file_id: uid }),
  [154, 156],
);
workspace(
  "workspace.missions.files.download",
  "mission_file_download",
  false,
  obj({ file_id: uid }, ["file_id"]),
  result({
    url: { type: "string", format: "uri", pattern: "^https://" },
    filename: str(200),
  }),
  [154, 156],
);
workspace(
  "workspace.missions.questions",
  "mission_questions",
  false,
  obj({ task_id: uid }, ["task_id"]),
  result({ questions: records, decisions: records, files: records }),
  [154],
);
workspace(
  "workspace.missions.answer",
  "mission_answer",
  true,
  obj({ question_id: uid, answer: str(6000, 2) }, ["question_id", "answer"]),
  result({
    remaining: { type: "integer", minimum: 0 },
    replanning_queued: boolean,
  }),
  [154],
);
const missionReview = obj({
  task_id: uid,
  decision: choices("approve_plan", "request_revision"),
  feedback: str(1500, 0),
}, ["task_id", "decision"]);
missionReview.allOf = [{
  if: {
    properties: { decision: { const: "request_revision" } },
    required: ["decision"],
  },
  then: { properties: { feedback: str(1500, 5) }, required: ["feedback"] },
}];
workspace(
  "workspace.missions.review",
  "mission_review",
  true,
  missionReview,
  result({
    status: choices(
      "plan_approved_external_actions_still_gated",
      "awaiting_plan_revision",
    ),
    external_actions_authorised: { const: false },
    audit_recorded: boolean,
  }),
  [154],
);
workspace(
  "workspace.missions.resume",
  "mission_resume",
  true,
  obj({ task_id: uid }, ["task_id"]),
  result({}, []),
  [154],
);
const deliverableReview = obj({
  work_product_id: uid,
  decision: choices("approve", "revise"),
  feedback: str(1500, 0),
}, ["work_product_id", "decision"]);
deliverableReview.allOf = [{
  if: { properties: { decision: { const: "revise" } }, required: ["decision"] },
  then: { properties: { feedback: str(1500, 5) }, required: ["feedback"] },
}];
workspace(
  "workspace.missions.deliverables.review",
  "mission_deliverable_review",
  true,
  deliverableReview,
  result({
    state: choices("approved", "revision_requested"),
    follow_up_queued: { const: true },
    external_actions_authorised: { const: false },
  }),
  [154],
);
workspace(
  "workspace.missions.request_client",
  "mission_request_client",
  true,
  obj({ task_id: uid, title: str(240, 3), details: str(4000, 0) }, [
    "task_id",
    "title",
  ]),
  result({ task_id: uid }),
  [154],
);
workspace(
  "workspace.topics.thread",
  "topic_thread",
  false,
  obj({ topic_id: uid }, ["topic_id"]),
  result({ topic: record, conversations: records }),
  [151],
);
workspace(
  "workspace.topics.list",
  "topic_index",
  false,
  obj(),
  result({ topics: records, classification: { const: "cached" } }),
  [151, 152],
  { refresh: false },
);
workspace(
  "workspace.topics.refresh",
  "topic_index",
  true,
  obj(),
  result({
    topics: records,
    classification: choices("requested", "unavailable"),
  }),
  [151, 152, 160],
  { refresh: true },
  true,
);
workspace(
  "workspace.conversations.list",
  "web_conversations",
  false,
  obj(),
  result({ conversations: records }),
  [151],
);
workspace(
  "workspace.conversations.create",
  "web_new_conversation",
  true,
  obj(),
  result({ conversation_id: uid }),
  [151],
);
workspace(
  "workspace.conversations.history",
  "web_history",
  false,
  obj({ conversation_id: uid }),
  result({ conversation_id: nullableUid, turns: records }),
  [151],
);
workspace(
  "workspace.chat.ask",
  "ask",
  true,
  obj({
    question: str(12000, 2),
    request_id: pattern("^[A-Za-z0-9_-]{12,110}$"),
    conversation_id: uid,
    timezone: {
      type: "string",
      minLength: 1,
      maxLength: 100,
      pattern: "^[A-Za-z0-9_+./-]+$",
    },
  }, ["question", "request_id"]),
  result({
    response: str(200000, 0),
    conversation_id: uid,
    channel: { const: "web" },
  }),
  [151, 154, 160],
  undefined,
  true,
);

function composio(
  operation: string,
  action: string,
  mutation: boolean,
  input: Obj,
  output: Obj,
  owner = false,
  consumesModel = false,
) {
  definitions[operation] = {
    handler: "sandy-composio-gateway",
    action,
    authentication: owner ? "owner_portal_user" : "portal_user",
    permission_scope: `connections:${mutation ? "write" : "read"}`,
    is_mutation: mutation,
    consumes_model_resources: consumesModel,
    input_schema: input,
    output_schema: output,
    requirement_ids: [145],
    description:
      `Invoke fixed connected-service action ${action} with server-owned tenant/account selection and the real portal user's session. Contract v1.0.0; connection does not imply executable provider tools.`,
  };
}
composio(
  "composio.status",
  "status",
  false,
  obj(),
  result({
    configured: boolean,
    enabled: boolean,
    can_provision: boolean,
    customer_connection_required: { const: true },
    tool_execution_enabled: { const: false },
  }),
);
composio(
  "composio.companies.list",
  "list_companies",
  false,
  obj(),
  result({ companies: records }),
);
composio(
  "composio.connections.assign",
  "assign_connection",
  true,
  obj({
    connected_account_id: pattern("^ca_[A-Za-z0-9_-]{5,150}$"),
    company_id: nullableUid,
  }, ["connected_account_id", "company_id"]),
  result({ connection: record }),
);
composio(
  "composio.credentials.verify",
  "verify_api_key",
  false,
  obj(),
  result({
    configured: { const: true },
    provider_status: { type: "integer", minimum: 100, maximum: 599 },
    read_only: { const: true },
  }),
  true,
);
composio(
  "composio.auth_configs.provision",
  "provision_managed_apps",
  true,
  obj({
    toolkit_slugs: {
      type: "array",
      minItems: 1,
      maxItems: 3,
      uniqueItems: true,
      items: choices(
        "gmail",
        "googledrive",
        "googlecalendar",
        "googlecontacts",
        "googledocs",
        "googlesheets",
        "slack",
        "hubspot",
        "notion",
        "xero",
        "shopify",
        "github",
        "outlook",
        "microsoft_teams",
        "dropbox",
      ),
    },
  }, ["toolkit_slugs"]),
  result({
    results: records,
    created: { type: "integer", minimum: 0 },
    existing: { type: "integer", minimum: 0 },
    needs_attention: { type: "integer", minimum: 0 },
  }),
  true,
);
composio(
  "composio.auth_configs.initialize",
  "initialize_shared_auth",
  true,
  obj(),
  result({ provider_status: { type: ["integer", "null"] } }),
  true,
);
composio(
  "composio.auth_configs.list",
  "list_auth_configs",
  false,
  obj(),
  result({ configs: records }),
  true,
);
composio(
  "composio.connections.connect",
  "create_connect_link",
  true,
  obj({
    toolkit_slug: toolkit,
    auth_config_id: pattern("^ac_[A-Za-z0-9_-]{5,100}$"),
    ...company,
    purpose: choices("calendar", "general"),
  }, ["toolkit_slug"]),
  result({
    connect_url: { type: "string", format: "uri", pattern: "^https://" },
    expires_at: { type: ["string", "null"] },
    external_authorization_required: { const: true },
  }),
);
composio(
  "composio.connections.sync",
  "sync_connections",
  true,
  obj(),
  result({
    connections: records,
    count: { type: "integer", minimum: 0, maximum: 100 },
    tool_execution_enabled: { const: false },
    has_more: boolean,
  }),
);
composio(
  "composio.connections.resolve",
  "resolve_connection",
  false,
  obj({ toolkit_slug: toolkit, ...company }, ["toolkit_slug"]),
  result({
    toolkit_slug: toolkit,
    connected: { const: true },
    connection_selection: choices("server_owned", "server_owned_workspace"),
    execution_enabled: { const: false },
  }),
);
composio(
  "composio.connections.disconnect",
  "disconnect",
  true,
  obj({ connected_account_id: pattern("^ca_[A-Za-z0-9_-]{5,150}$") }, [
    "connected_account_id",
  ]),
  result({ disconnected: { const: true }, toolkit_slug: toolkit }),
);
composio(
  "composio.connections.list",
  "list_connections",
  false,
  obj(),
  result({ connections: records }),
);
composio(
  "composio.toolkits.list",
  "list_toolkits",
  false,
  obj(),
  result({ toolkits: records }),
);
composio(
  "composio.discover_tools",
  "discover_tools",
  false,
  obj({ toolkit_slug: toolkit, ...company }, ["toolkit_slug"]),
  result({
    toolkit_slug: toolkit,
    tools: records,
    has_more: boolean,
    notice: str(2000),
  }),
);
composio(
  "composio.execution_status",
  "execution_status",
  false,
  obj({ request_key: pattern("^[A-Za-z0-9_-]{8,128}$") }, ["request_key"]),
  result({ receipt: record }),
);
composio(
  "composio.awareness.refresh",
  "v2_awareness",
  true,
  obj({
    ...company,
    verify_provider: boolean,
    refresh_architecture: boolean,
    request_id: pattern("^[A-Za-z0-9_-]{1,110}$"),
  }),
  result({
    v2: { const: true },
    customer_scope: { const: "authenticated_customer_only" },
    policy: record,
    provider_check: choices("not_requested", "verified", "unavailable"),
    connections: records,
    capabilities: records,
    integrations: records,
    execution: record,
  }),
  false,
  true,
);

export const customerOperationContracts: Readonly<
  Record<string, CustomerOperationContract>
> = Object.freeze(definitions);
export const isCustomerOperation = (operation: unknown): boolean =>
  typeof operation === "string" && Object.hasOwn(definitions, operation);
export const requiresCustomerOwner = (operation: string) =>
  definitions[operation]?.authentication === "owner_portal_user";
export function customerContractMatches(operation: string, entry: Obj) {
  const contract = definitions[operation];
  return !!contract && entry.handler === contract.handler &&
    entry.permission_scope === contract.permission_scope &&
    entry.is_mutation === contract.is_mutation;
}
const ajv = new Ajv({ strict: true, allErrors: false, validateFormats: true });
for (const [name, format] of Object.entries(fullFormats)) {
  ajv.addFormat(name, format);
}
const inputs = new Map(
  Object.entries(definitions).map((
    [name, c],
  ) => [name, ajv.compile(c.input_schema)]),
);
const outputs = new Map(
  Object.entries(definitions).map((
    [name, c],
  ) => [name, ajv.compile(c.output_schema)]),
);
const object = (value: unknown): value is Obj =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const uuid = (value: unknown): value is string =>
  typeof value === "string" &&
  /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value);
const sameId = (a: unknown, b: unknown) =>
  uuid(a) && uuid(b) && a.toLowerCase() === b.toLowerCase();
export type CustomerOperationDependencies = {
  base: string;
  anon: string;
  service: string;
  principal: {
    id: string;
    customerId: string;
    portalAccess: boolean;
    controllerOwner: boolean;
  };
  fetch?: typeof fetch;
};
const reply = (status: number, body: Obj) =>
  Response.json(body, { status, headers: { "cache-control": "no-store" } });
function validArguments(operation: string, args: unknown): args is Obj {
  return isCustomerOperation(operation) && object(args) &&
    JSON.stringify(args).length <= 20000 &&
    inputs.get(operation)?.(args) === true;
}
export function buildCustomerOperationRequest(
  deps: CustomerOperationDependencies,
  userToken: string,
  operation: string,
  args: unknown,
): { url: string; init: RequestInit } | null {
  if (
    !validArguments(operation, args) || !userToken ||
    !/^[A-Za-z0-9._~-]+$/.test(userToken) ||
    [deps.service, deps.anon].includes(userToken)
  ) return null;
  let base: URL;
  try {
    base = new URL(deps.base);
  } catch {
    return null;
  }
  if (
    base.protocol !== "https:" || base.username || base.password ||
    base.pathname !== "/" || base.search || base.hash
  ) return null;
  const c = definitions[operation];
  const suffix = c.handler === "sandy-workspace" ? "?action=" + c.action : "";
  const payload = c.handler === "sandy-workspace"
    ? { ...args, ...c.fixed }
    : { ...args, ...c.fixed, operation: c.action };
  return {
    url: base.origin + "/functions/v1/" + c.handler + suffix,
    init: {
      method: "POST",
      redirect: "error",
      signal: AbortSignal.timeout(
        operation === "workspace.chat.ask" ? 130000 : 60000,
      ),
      headers: {
        authorization: `Bearer ${userToken}`,
        apikey: deps.anon,
        "content-type": "application/json",
      },
      body: JSON.stringify(payload),
    },
  };
}
const listFields = [
  "items",
  "missions",
  "questions",
  "decisions",
  "files",
  "conversations",
  "topics",
  "turns",
  "companies",
  "connections",
  "configs",
  "toolkits",
  "tools",
  "results",
  "capabilities",
  "integrations",
];
function normalize(payload: Obj, secrets: string[]): Obj {
  let truncated = false;
  const out = { ...payload };
  for (const key of listFields) {
    if (Array.isArray(out[key]) && out[key].length > 200) {
      out[key] = out[key].slice(0, 200);
      truncated = true;
    }
  }
  function scrub(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(scrub);
    if (object(value)) {
      return Object.fromEntries(
        Object.entries(value).map((
          [key, child],
        ) => [
          key,
          /^(authorization|access_token|refresh_token|api_key|private_key|password)$/i
              .test(key)
            ? "[REDACTED]"
            : scrub(child),
        ]),
      );
    }
    if (typeof value === "string") {
      let clean = value.replace(
        /Bearer\s+[A-Za-z0-9._~-]+/gi,
        "Bearer [REDACTED]",
      );
      for (const secret of secrets) {
        if (secret) clean = clean.replaceAll(secret, "[REDACTED]");
      }
      return clean;
    }
    return value;
  }
  return {
    ...(scrub(out) as Obj),
    ok: true,
    contract_version: "1.0.0",
    response_item_cap: 200,
    response_items_truncated: truncated,
  };
}
function responseScoped(
  operation: string,
  args: Obj,
  payload: Obj,
  customerId: string,
): boolean {
  if (
    operation === "workspace.conversations.history" && args.conversation_id &&
    !sameId(payload.conversation_id, args.conversation_id)
  ) return false;
  if (
    operation === "workspace.chat.ask" && args.conversation_id &&
    !sameId(payload.conversation_id, args.conversation_id)
  ) return false;
  if (
    operation === "workspace.topics.thread" &&
    (!object(payload.topic) || !sameId(payload.topic.id, args.topic_id))
  ) return false;
  if (
    operation === "workspace.missions.files.confirm" &&
    !sameId(payload.file_id, args.file_id)
  ) return false;
  if (
    operation === "composio.connections.resolve" ||
    operation === "composio.discover_tools"
  ) { if (payload.toolkit_slug !== args.toolkit_slug) return false; }
  if (
    operation === "composio.connections.assign" &&
    (!object(payload.connection) ||
      payload.connection.connected_account_id !== args.connected_account_id ||
      payload.connection.company_id !== args.company_id)
  ) return false;
  // Verify tenant markers wherever an application service includes them; tenant
  // selection itself remains the independently authenticated backend's job.
  for (const key of listFields) {
    const values = Array.isArray(payload[key]) ? payload[key] : [];
    for (const value of values) {
      if (object(value)) {
        if (
          Object.hasOwn(value, "customer_id") &&
          !sameId(value.customer_id, customerId)
        ) return false;
        if (
          Object.hasOwn(value, "owner_customer_id") &&
          !sameId(value.owner_customer_id, customerId)
        ) return false;
      }
    }
  }
  return true;
}
export async function executeCustomerOperation(
  deps: CustomerOperationDependencies,
  userToken: string,
  operation: string,
  args: unknown,
): Promise<Response> {
  const principal = deps.principal;
  if (
    !uuid(principal.id) || !uuid(principal.customerId) ||
    principal.portalAccess !== true
  ) {
    return reply(403, {
      ok: false,
      error: "portal_customer_access_required",
      executed: false,
    });
  }
  if (!validArguments(operation, args)) {
    return reply(400, {
      ok: false,
      error: "invalid_operation_arguments",
      executed: false,
    });
  }
  const c = definitions[operation];
  if (requiresCustomerOwner(operation) && principal.controllerOwner !== true) {
    return reply(403, {
      ok: false,
      error: "controller_owner_required",
      executed: false,
    });
  }
  if (
    operation === "composio.awareness.refresh" &&
    args.refresh_architecture === true && principal.controllerOwner !== true
  ) {
    return reply(403, {
      ok: false,
      error: "controller_owner_required",
      executed: false,
    });
  }
  const request = buildCustomerOperationRequest(
    deps,
    userToken,
    operation,
    args,
  );
  if (!request) {
    return reply(503, {
      ok: false,
      error: "customer_handler_configuration_invalid",
      executed: false,
    });
  }
  let upstream: Response;
  try {
    upstream = await (deps.fetch ?? fetch)(request.url, request.init);
  } catch {
    return reply(502, {
      ok: false,
      error: "customer_backend_outcome_unknown",
      executed: null,
      reconciliation_required: c.is_mutation,
    });
  }
  let payload: unknown;
  try {
    payload = await upstream.json();
  } catch {
    return reply(502, {
      ok: false,
      error: "customer_backend_invalid_json",
      executed: true,
      reconciliation_required: c.is_mutation,
    });
  }
  if (
    !upstream.ok || !object(payload) || payload.ok !== true ||
    payload.error != null
  ) {
    return reply(
      upstream.status >= 400 && upstream.status <= 599 ? upstream.status : 502,
      {
        ok: false,
        error: "customer_backend_rejected",
        upstream_status: upstream.status,
        executed: true,
        reconciliation_required: c.is_mutation && upstream.status >= 500,
      },
    );
  }
  if (!responseScoped(operation, args, payload, principal.customerId)) {
    return reply(502, {
      ok: false,
      error: "customer_backend_unscoped_response",
      executed: true,
      reconciliation_required: c.is_mutation,
    });
  }
  const normalized = normalize(payload, [deps.service, deps.anon, userToken]);
  if (outputs.get(operation)?.(normalized) !== true) {
    return reply(502, {
      ok: false,
      error: "customer_backend_output_contract_mismatch",
      executed: true,
      reconciliation_required: c.is_mutation,
    });
  }
  return reply(upstream.status, normalized);
}
