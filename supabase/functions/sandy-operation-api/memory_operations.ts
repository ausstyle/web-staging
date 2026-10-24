import {
  buildCustomerMutationReceiptRequest,
  executeMemoryCorrection,
} from "./customer_mutations.ts";
import { Ajv } from "npm:ajv@8.17.1";
import { fullFormats } from "npm:ajv-formats@3.0.1/dist/formats.js";
import { memoryOperationContracts as sourceContracts } from "./memory_contracts.ts";
import { type CustomerServiceDependencies } from "./customer_services.ts";
type Obj = Record<string, unknown>;
export type MemoryOperationContract = {
  handler: string;
  action: string;
  permission_scope: string;
  is_mutation: boolean;
  input_schema: Obj;
  output_schema: Obj;
  consumes_model_resources: boolean;
};
export const memoryOperationContracts = Object.freeze(
  sourceContracts,
) as unknown as Readonly<Record<string, MemoryOperationContract>>;
export const isMemoryOperation = (operation: unknown): boolean =>
  typeof operation === "string" &&
  Object.hasOwn(memoryOperationContracts, operation);
export function memoryContractMatches(operation: string, entry: Obj) {
  const c = memoryOperationContracts[operation];
  return !!c && c.handler === entry.handler &&
    c.permission_scope === entry.permission_scope &&
    c.is_mutation === entry.is_mutation;
}
const ajv = new Ajv({ strict: true, validateFormats: true });
for (const [name, format] of Object.entries(fullFormats)) {
  ajv.addFormat(name, format);
}
const inputs = new Map(
  Object.entries(memoryOperationContracts).map((
    [name, c],
  ) => [name, ajv.compile(c.input_schema)]),
);
const outputs = new Map(
  Object.entries(memoryOperationContracts).map((
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
const reply = (status: number, data: Obj) =>
  Response.json(data, { status, headers: { "cache-control": "no-store" } });
function valid(operation: string, args: unknown): args is Obj {
  return isMemoryOperation(operation) && object(args) &&
    JSON.stringify(args).length <= 20000 &&
    inputs.get(operation)?.(args) === true;
}
export function buildMemoryOperationRequest(
  deps: CustomerServiceDependencies,
  userToken: string,
  operation: string,
  args: unknown,
): { url: string; init: RequestInit } | null {
  if (
    !valid(operation, args) || !userToken ||
    !/^[A-Za-z0-9._~-]+$/.test(userToken) ||
    [deps.service, deps.anon].includes(userToken) ||
    userToken.startsWith("sandyop_")
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
  if (operation === "memory.fact_correct") {
    return buildCustomerMutationReceiptRequest(
      deps,
      userToken,
      operation,
      args,
    );
  }
  const c = memoryOperationContracts[operation];
  return {
    url: base.origin + "/functions/v1/sandy-memory-centre?op=" + c.action,
    init: {
      method: "POST",
      redirect: "error",
      signal: AbortSignal.timeout(c.consumes_model_resources ? 135000 : 60000),
      headers: {
        authorization: `Bearer ${userToken}`,
        apikey: deps.anon,
        "content-type": "application/json",
      },
      body: JSON.stringify(args),
    },
  };
}
async function responseJson(response: Response): Promise<unknown> {
  if (!response.body) throw Error("missing_response");
  const reader = response.body.getReader(), chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      size += part.value.byteLength;
      if (size > 4 * 1024 * 1024) {
        await reader.cancel();
        throw Error("response_size_limit");
      }
      chunks.push(part.value);
    }
    const data = new Uint8Array(size);
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
function normalized(payload: Obj, secrets: string[]): Obj {
  function clean(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(clean);
    if (object(value)) {
      return Object.fromEntries(
        Object.entries(value).map((
          [name, child],
        ) => [
          name,
          /^(access_token|refresh_token|authorization|api_key|private_key|password)$/i
              .test(name)
            ? "[REDACTED]"
            : clean(child),
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
  return { ...(clean(payload) as Obj), ok: true, contract_version: "1.0.0" };
}
function scopedResponse(
  operation: string,
  args: Obj,
  payload: Obj,
  tenant: string,
): boolean {
  for (const value of Object.values(payload)) {
    for (
      const row of Array.isArray(value) ? value : object(value) ? [value] : []
    ) {
      if (object(row)) {
        for (
          const key of ["customer_id", "owner_customer_id"]
        ) {
          if (Object.hasOwn(row, key) && !sameId(row[key], tenant)) {
            return false;
          }
        }
      }
    }
  }
  if (operation === "memory.ask" && Object.hasOwn(payload, "task")) {
    if (
      !object(payload.task) || !uuid(payload.task.id) ||
      typeof payload.task.created !== "boolean"
    ) return false;
  }
  if (
    operation === "memory.biography" && Array.isArray(payload.paragraphs) &&
    Array.isArray(payload.sources)
  ) {
    const ids = new Set(
      payload.sources.filter(object).map((source) => source.id),
    );
    for (const paragraph of payload.paragraphs) {
      if (
        !object(paragraph) || !Array.isArray(paragraph.source_ids) ||
        !paragraph.source_ids.every((id) => ids.has(id))
      ) return false;
    }
  }
  if (operation === "memory.settings" && object(payload.settings)) {
    for (const name of ["enabled", "learning_enabled", "proactive_enabled"]) {
      if (
        typeof args[name] === "boolean" && payload.settings[name] !== args[name]
      ) return false;
    }
  }
  return true;
}
export async function executeMemoryOperation(
  deps: CustomerServiceDependencies,
  userToken: string,
  operation: string,
  args: unknown,
): Promise<Response> {
  const p = deps.principal;
  if (!uuid(p.id) || !uuid(p.portalCustomerId)) {
    return reply(403, {
      ok: false,
      error: "portal_customer_access_required",
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
  if (operation === "memory.fact_correct") {
    if (!userToken || [deps.service, deps.anon].includes(userToken)) {
      return reply(503, {
        ok: false,
        error: "memory_user_session_required",
        executed: false,
      });
    }
    const outcome = await executeMemoryCorrection(
      deps,
      userToken,
      p.portalCustomerId,
      args,
    );
    return reply(
      outcome.status,
      outcome.status === 200 && object(outcome.body.result)
        ? outcome.body.result
        : outcome.body,
    );
  }
  const request = buildMemoryOperationRequest(deps, userToken, operation, args);
  if (!request) {
    return reply(503, {
      ok: false,
      error: "memory_user_session_required",
      executed: false,
    });
  }
  let response: Response;
  try {
    response = await (deps.fetch ?? fetch)(request.url, request.init);
  } catch {
    return reply(502, {
      ok: false,
      error: "memory_backend_outcome_unknown",
      executed: null,
      reconciliation_required: true,
    });
  }
  let payload: unknown;
  try {
    payload = await responseJson(response);
  } catch {
    return reply(502, {
      ok: false,
      error: "memory_backend_invalid_response",
      executed: true,
      reconciliation_required: true,
    });
  }
  if (
    !response.ok || !object(payload) || payload.ok !== true ||
    payload.error != null
  ) {
    return reply(
      response.status >= 400 && response.status <= 599 ? response.status : 502,
      {
        ok: false,
        error: "memory_backend_rejected",
        upstream_status: response.status,
        executed: true,
        reconciliation_required: response.status >= 500,
      },
    );
  }
  if (operation === "memory.life_file" && payload.confirmed === false) {
    return reply(409, {
      ok: false,
      error: "memory_document_assignment_not_confirmed",
      executed: true,
      reconciliation_required: false,
    });
  }
  if (!scopedResponse(operation, args, payload, p.portalCustomerId)) {
    return reply(502, {
      ok: false,
      error: "memory_backend_unscoped_response",
      executed: true,
      reconciliation_required: true,
    });
  }
  const result = normalized(payload, [deps.service, deps.anon, userToken]);
  if (outputs.get(operation)?.(result) !== true) {
    return reply(502, {
      ok: false,
      error: "memory_backend_output_contract_mismatch",
      executed: true,
      reconciliation_required: true,
    });
  }
  return reply(response.status, result);
}
