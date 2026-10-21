import { Ajv } from "npm:ajv@8.17.1";
import { fullFormats } from "npm:ajv-formats@3.0.1/dist/formats.js";
import { customerServiceContracts as sourceContracts } from "./customer_service_contracts.ts";

type Obj = Record<string, unknown>;
export type CustomerServiceContract = {
  handler: string;
  action: string;
  body_mode: "payload" | "flat" | "op";
  authorization: "portal" | "agenda" | "portal_and_agenda" | "controller_owner";
  permission_scope: string;
  is_mutation: boolean;
  input_schema: Obj;
  output_schema: Obj;
  accept_legacy_without_ok: boolean;
  consumes_model_resources: boolean;
  allow_shared_resources?: boolean;
  known_backend_dependency?: string;
};
export const customerServiceContracts = Object.freeze(
  sourceContracts,
) as unknown as Readonly<Record<string, CustomerServiceContract>>;
export const isCustomerServiceOperation = (operation: unknown): boolean =>
  typeof operation === "string" &&
  Object.hasOwn(customerServiceContracts, operation);
export const customerServiceGrant = (operation: string) =>
  customerServiceContracts[operation]?.authorization;
export function customerServiceContractMatches(
  operation: string,
  entry: Obj,
): boolean {
  const c = customerServiceContracts[operation];
  return !!c && c.handler === entry.handler &&
    c.permission_scope === entry.permission_scope &&
    c.is_mutation === entry.is_mutation;
}
const ajv = new Ajv({ strict: true, allErrors: false, validateFormats: true });
for (const [name, format] of Object.entries(fullFormats)) {
  ajv.addFormat(name, format);
}
const inputs = new Map(
  Object.entries(customerServiceContracts).map((
    [name, c],
  ) => [name, ajv.compile(c.input_schema)]),
);
const outputs = new Map(
  Object.entries(customerServiceContracts).map((
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
export type CustomerServiceDependencies = {
  base: string;
  anon: string;
  service: string;
  principal: {
    id: string;
    portalCustomerId: string | null;
    agendaCustomerId: string | null;
    controllerOwner: boolean;
  };
  fetch?: typeof fetch;
};
export function hasCustomerServiceGrant(
  principal: CustomerServiceDependencies["principal"],
  operation: string,
): boolean {
  if (!uuid(principal.id)) return false;
  switch (customerServiceGrant(operation)) {
    case "portal":
      return uuid(principal.portalCustomerId);
    case "agenda":
      return uuid(principal.agendaCustomerId);
    case "portal_and_agenda":
      return sameId(principal.portalCustomerId, principal.agendaCustomerId);
    case "controller_owner":
      return principal.controllerOwner === true;
    default:
      return false;
  }
}
const reply = (status: number, body: Obj) =>
  Response.json(body, { status, headers: { "cache-control": "no-store" } });
function validArguments(operation: string, args: unknown): args is Obj {
  if (
    !isCustomerServiceOperation(operation) || !object(args) ||
    JSON.stringify(args).length > 20000 ||
    inputs.get(operation)?.(args) !== true
  ) return false;
  if (
    operation === "social.relationships.create" &&
    sameId(args.person_id, args.related_person_id)
  ) return false;
  if (
    (operation === "calendar.client.events.create" ||
      operation === "calendar.client.events.update") &&
    typeof args.starts_at === "string" && typeof args.ends_at === "string" &&
    Date.parse(args.ends_at) < Date.parse(args.starts_at)
  ) return false;
  return true;
}
export function buildCustomerServiceRequest(
  deps: CustomerServiceDependencies,
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
  const c = customerServiceContracts[operation];
  const body = c.body_mode === "payload"
    ? { action: c.action, payload: args }
    : c.body_mode === "op"
    ? { ...args, op: c.action }
    : { ...args, action: c.action };
  return {
    url: base.origin + "/functions/v1/" + c.handler,
    init: {
      method: "POST",
      redirect: "error",
      signal: AbortSignal.timeout(
        operation === "controller.examiner.run" ? 130000 : 60000,
      ),
      headers: {
        authorization: `Bearer ${userToken}`,
        apikey: deps.anon,
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
    },
  };
}
async function boundedJson(response: Response): Promise<unknown> {
  if (!response.body) throw Error("missing_response");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      length += next.value.byteLength;
      if (length > 4 * 1024 * 1024) {
        await reader.cancel();
        throw Error("response_size_limit");
      }
      chunks.push(next.value);
    }
    const data = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) {
      data.set(chunk, offset);
      offset += chunk.length;
    }
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(data));
  } finally {
    reader.releaseLock();
  }
}
function scopedResponse(
  c: CustomerServiceContract,
  operation: string,
  args: Obj,
  payload: Obj,
  principal: CustomerServiceDependencies["principal"],
): boolean {
  for (
    const [op, field, target] of [
      ["controller.deployment.approve", "job", "job_id"],
      ["controller.supervisor.jobs.update", "job", "id"],
      ["controller.qa.update", "item", "id"],
      ["controller.missions.get", "mission", "id"],
      ["calendar.client.events.update", "event", "event_id"],
      ["task_files.confirm", "file", "id"],
    ]
  ) {
    if (
      operation === op &&
      (!object(payload[field]) ||
        !sameId((payload[field] as Obj).id, args[target]))
    ) return false;
  }
  if (
    ["controller.examiner.report", "controller.examiner.run.get"].includes(
      operation,
    ) && payload.run_key !== args.run_key
  ) return false;
  if (
    operation === "controller.roadmap.update" &&
    (!object(payload.item) || payload.item.feature_key !== args.key)
  ) return false;
  if (operation === "files.library.state.set" && payload.state !== args.state) {
    return false;
  }
  if (c.authorization === "controller_owner" || c.allow_shared_resources) {
    return true;
  }
  const tenant = c.authorization === "agenda"
    ? principal.agendaCustomerId
    : principal.portalCustomerId;
  for (const value of Object.values(payload)) {
    for (const item of Array.isArray(value) ? value : []) {
      if (object(item)) {
        for (const key of ["customer_id", "owner_customer_id"]) {
          if (
            Object.hasOwn(item, key) && !sameId(item[key], tenant)
          ) {
            return false;
          }
        }
      }
    }
  }
  return true;
}
function normalize(payload: Obj, secrets: string[]): Obj {
  let truncated = false;
  const capped = Object.fromEntries(
    Object.entries(payload).map(([key, value]) => {
      if (Array.isArray(value) && value.length > 200) {
        truncated = true;
        return [key, value.slice(0, 200)];
      }
      return [key, value];
    }),
  );
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
    ...(scrub(capped) as Obj),
    ok: true,
    contract_version: "1.0.0",
    response_item_cap: 200,
    response_items_truncated: truncated,
  };
}
export async function executeCustomerService(
  deps: CustomerServiceDependencies,
  userToken: string,
  operation: string,
  args: unknown,
): Promise<Response> {
  if (!hasCustomerServiceGrant(deps.principal, operation)) {
    return reply(403, {
      ok: false,
      error: "customer_service_grant_required",
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
  const c = customerServiceContracts[operation];
  if (c.known_backend_dependency) {
    return reply(424, {
      ok: false,
      error: "customer_backend_dependency_unavailable",
      dependency: c.known_backend_dependency,
      executed: false,
    });
  }
  const request = buildCustomerServiceRequest(deps, userToken, operation, args);
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
    payload = await boundedJson(upstream);
  } catch {
    return reply(502, {
      ok: false,
      error: "customer_backend_invalid_response",
      executed: true,
      reconciliation_required: c.is_mutation,
    });
  }
  if (
    !upstream.ok || !object(payload) || payload.error != null ||
    payload.ok === false || (!c.accept_legacy_without_ok && payload.ok !== true)
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
  if (!scopedResponse(c, operation, args, payload, deps.principal)) {
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
