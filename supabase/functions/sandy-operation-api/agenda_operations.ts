import { Ajv } from "npm:ajv@8.17.1";
import { fullFormats } from "npm:ajv-formats@3.0.1/dist/formats.js";
import { agendaContracts as sourceContracts } from "./agenda_contracts.ts";
import { type CustomerServiceDependencies } from "./customer_services.ts";
type Obj = Record<string, unknown>;
export type AgendaContract = {
  handler: string;
  action: string;
  is_mutation: boolean;
  permission_scope: string;
  input_schema: Obj;
  output_schema: Obj;
  method: "POST" | "GET";
  accept_legacy_without_ok: boolean;
  fixed?: Obj;
  argument_mapping?: Record<string, string>;
  rpc?: string;
  rpc_arguments?: Record<string, string>;
};
export const agendaContracts = Object.freeze(
  sourceContracts,
) as unknown as Readonly<Record<string, AgendaContract>>;
export const isAgendaOperation = (value: unknown): boolean =>
  typeof value === "string" && Object.hasOwn(agendaContracts, value);
export function agendaContractMatches(operation: string, entry: Obj) {
  const c = agendaContracts[operation];
  return !!c && c.handler === entry.handler &&
    c.permission_scope === entry.permission_scope &&
    c.is_mutation === entry.is_mutation;
}
const ajv = new Ajv({ strict: true, validateFormats: true });
for (const [name, format] of Object.entries(fullFormats)) {
  ajv.addFormat(name, format);
}
const inputs = new Map(
  Object.entries(agendaContracts).map((
    [name, c],
  ) => [name, ajv.compile(c.input_schema)]),
);
const outputs = new Map(
  Object.entries(agendaContracts).map((
    [name, c],
  ) => [name, ajv.compile(c.output_schema)]),
);
const object = (v: unknown): v is Obj =>
  v !== null && typeof v === "object" && !Array.isArray(v);
const uuid = (v: unknown): v is string =>
  typeof v === "string" &&
  /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(v);
const sameId = (a: unknown, b: unknown) =>
  uuid(a) && uuid(b) && a.toLowerCase() === b.toLowerCase();
const reply = (status: number, data: Obj) =>
  Response.json(data, { status, headers: { "cache-control": "no-store" } });
function valid(operation: string, args: unknown): args is Obj {
  if (
    !isAgendaOperation(operation) || !object(args) ||
    JSON.stringify(args).length > 20000 ||
    inputs.get(operation)?.(args) !== true
  ) return false;
  if (
    operation === "agenda.tasks.dependency" &&
    sameId(args.task_id, args.depends_on_id)
  ) return false;
  if (
    operation === "agenda.tasks.update" && sameId(args.id, args.parent_task_id)
  ) return false;
  if (
    operation === "agenda.categories.update" &&
    sameId(args.id, args.parent_category_id)
  ) return false;
  return true;
}
export function buildAgendaRequest(
  deps: CustomerServiceDependencies,
  userToken: string,
  operation: string,
  args: unknown,
): { url: string; init: RequestInit } | null {
  if (
    !valid(operation, args) || !userToken ||
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
  const c = agendaContracts[operation];
  const payload = Object.fromEntries(
    Object.entries(args).map((
      [key, value],
    ) => [c.argument_mapping?.[key] ?? key, value]),
  );
  const target = c.rpc
    ? `/rest/v1/rpc/${c.rpc}`
    : `/functions/v1/sandy-agenda?action=${c.action}`;
  return {
    url: base.origin + target,
    init: {
      method: c.method,
      redirect: "error",
      signal: AbortSignal.timeout(
        operation === "agenda.tasks.interpret" ? 35000 : 60000,
      ),
      headers: {
        authorization: `Bearer ${userToken}`,
        apikey: deps.anon,
        "content-type": "application/json",
      },
      ...(c.method === "POST"
        ? {
          body: JSON.stringify(
            c.rpc
              ? Object.fromEntries(Object.entries(c.rpc_arguments ?? {}).map(([parameter, argument]) => [parameter, args[argument]]))
              : { ...payload, ...c.fixed },
          ),
        }
        : {}),
    },
  };
}
function normalized(payload: Obj, secrets: string[]): Obj {
  let truncated = false;
  function clean(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(clean);
    if (object(value)) {
      return Object.fromEntries(
        Object.entries(value).map((
          [k, v],
        ) => [
          k,
          /^(access_token|refresh_token|authorization|api_key|password|private_key)$/i
              .test(k)
            ? "[REDACTED]"
            : clean(v),
        ]),
      );
    }
    if (typeof value === "string") {
      let text = value.replace(
        /Bearer\s+[A-Za-z0-9._~-]+/gi,
        "Bearer [REDACTED]",
      );
      for (const secret of secrets) {
        if (secret) text = text.replaceAll(secret, "[REDACTED]");
      }
      return text;
    }
    return value;
  }
  const capped = Object.fromEntries(
    Object.entries(payload).map(([k, v]) => {
      if (Array.isArray(v) && v.length > 200) {
        truncated = true;
        return [k, v.slice(0, 200)];
      }
      return [k, v];
    }),
  );
  return {
    ...(clean(capped) as Obj),
    ok: true,
    contract_version: "1.0.0",
    response_item_cap: 200,
    response_items_truncated: truncated,
  };
}
async function boundedResponseJson(response: Response): Promise<unknown> {
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
export async function executeAgendaOperation(
  deps: CustomerServiceDependencies,
  userToken: string,
  operation: string,
  args: unknown,
): Promise<Response> {
  const p = deps.principal;
  if (!uuid(p.id) || !sameId(p.portalCustomerId, p.agendaCustomerId)) {
    return reply(403, {
      ok: false,
      error: "matching_portal_agenda_grants_required",
      executed: false,
    });
  }
  if (!valid(operation, args)) {
    return reply(400, {
      ok: false,
      error: "invalid_operation_arguments",
      executed: false,
    });
  }
  const c = agendaContracts[operation],
    request = buildAgendaRequest(deps, userToken, operation, args);
  if (!request) {
    return reply(503, {
      ok: false,
      error: "agenda_handler_configuration_invalid",
      executed: false,
    });
  }
  let response: Response;
  let payload: unknown;
  try {
    response = await (deps.fetch ?? fetch)(request.url, request.init);
  } catch {
    return reply(502, {
      ok: false,
      error: "agenda_backend_outcome_unknown",
      executed: null,
      reconciliation_required: c.is_mutation,
    });
  }
  try {
    payload = await boundedResponseJson(response);
  } catch {
    return reply(502, {
      ok: false,
      error: "agenda_backend_invalid_response",
      executed: true,
      reconciliation_required: c.is_mutation,
    });
  }
  const status =
    object(payload) && c.rpc && Number.isInteger(payload.http_status)
      ? Number(payload.http_status)
      : response.status;
  if (
    !response.ok || status >= 400 || !object(payload) ||
    payload.error != null || payload.ok === false ||
    (!c.accept_legacy_without_ok && payload.ok !== true)
  ) {
    return reply(status >= 400 && status <= 599 ? status : 502, {
      ok: false,
      error: "agenda_backend_rejected",
      upstream_status: status,
      executed: true,
      reconciliation_required: c.is_mutation && status >= 500,
    });
  }
  if (
    operation === "agenda.overview" &&
    !sameId(payload.customer_id, p.portalCustomerId)
  ) {
    return reply(502, {
      ok: false,
      error: "agenda_backend_tenant_mismatch",
      executed: true,
    });
  }
  if (
    operation === "agenda.sharing.accept_link" &&
    !sameId(payload.task_id, args.task_id)
  ) {
    return reply(502, {
      ok: false,
      error: "agenda_backend_resource_mismatch",
      executed: true,
      reconciliation_required: true,
    });
  }
  if (
    operation === "agenda.categories.update" &&
    (!object(payload.category) || !sameId(payload.category.id, args.id))
  ) {
    return reply(502, {
      ok: false,
      error: "agenda_backend_resource_mismatch",
      executed: true,
      reconciliation_required: true,
    });
  }
  if (
    operation === "agenda.pins.save" &&
    (!Array.isArray(payload.task_ids) || !Array.isArray(args.task_ids) ||
      payload.task_ids.length !== args.task_ids.length ||
      !payload.task_ids.every((id, index) =>
        sameId(id, (args.task_ids as unknown[])[index])
      ))
  ) {
    return reply(502, {
      ok: false,
      error: "agenda_pin_receipt_mismatch",
      executed: true,
      reconciliation_required: true,
    });
  }
  const result = normalized(payload, [deps.service, deps.anon, userToken]);
  if (outputs.get(operation)?.(result) !== true) {
    return reply(502, {
      ok: false,
      error: "agenda_backend_output_contract_mismatch",
      executed: true,
      reconciliation_required: c.is_mutation,
    });
  }
  return reply(status, result);
}
