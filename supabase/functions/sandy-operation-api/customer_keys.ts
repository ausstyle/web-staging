import { Ajv } from "npm:ajv@8.17.1";
import { fullFormats } from "npm:ajv-formats@3.0.1/dist/formats.js";
import { type CustomerServiceDependencies } from "./customer_services.ts";
type Obj = Record<string, unknown>;
const scope = {
  type: "string",
  enum: [
    "tasks:read",
    "tasks:write",
    "calendar:read",
    "calendar:write",
    "files:read",
    "files:write",
  ],
};
const scopes = {
  type: "array",
  minItems: 1,
  maxItems: 6,
  uniqueItems: true,
  items: scope,
};
const uuid = { type: "string", format: "uuid" };
const text = { type: "string" };
const date = { type: "string", format: "date-time" };
const nullableDate = { type: ["string", "null"], format: "date-time" };
const properties = {
  id: uuid,
  name: { type: "string", maxLength: 80 },
  prefix: { type: "string", pattern: "^sandyop_[a-f0-9]{8}$" },
  scopes,
  created_at: date,
  last_used_at: nullableDate,
  expires_at: nullableDate,
  revoked_at: nullableDate,
};
const keyRecord = {
  type: "object",
  properties,
  required: ["id", "name", "prefix", "scopes", "created_at", "expires_at"],
  additionalProperties: false,
};
const input = (properties: Obj = {}, required: string[] = []) => ({
  type: "object",
  properties,
  required,
  additionalProperties: false,
});
const output = (properties: Obj, required = Object.keys(properties)) => ({
  type: "object",
  properties: {
    ok: { const: true },
    contract_version: { const: "1.0.0" },
    ...properties,
  },
  required: ["ok", "contract_version", ...required],
  additionalProperties: false,
});
export const customerKeyContracts: Readonly<
  Record<
    string,
    {
      handler: string;
      operation: string;
      permission_scope: string;
      is_mutation: boolean;
      input_schema: Obj;
      output_schema: Obj;
    }
  >
> = Object.freeze({
  "customer.keys.list": {
    handler: "sandy-operations-api",
    operation: "keys.list",
    permission_scope: "keys:read",
    is_mutation: false,
    input_schema: input(),
    output_schema: output({
      keys: { type: "array", maxItems: 200, items: keyRecord },
      response_item_cap: { const: 200 },
      response_items_truncated: { type: "boolean" },
    }),
  },
  "customer.keys.create": {
    handler: "sandy-operations-api",
    operation: "keys.create",
    permission_scope: "keys:write",
    is_mutation: true,
    input_schema: input({
      name: { type: "string", minLength: 1, maxLength: 80 },
      scopes,
      expires_at: date,
    }, ["scopes"]),
    output_schema: output({
      key: { type: "string", pattern: "^sandyop_[a-f0-9]{64}$" },
      record: keyRecord,
      warning: text,
      display_once: { const: true },
    }),
  },
  "customer.keys.revoke": {
    handler: "sandy-operations-api",
    operation: "keys.revoke",
    permission_scope: "keys:write",
    is_mutation: true,
    input_schema: input({ id: uuid }, ["id"]),
    output_schema: output({ revoked: { const: true } }),
  },
});
export const isCustomerKeyOperation = (operation: unknown): boolean =>
  typeof operation === "string" &&
  Object.hasOwn(customerKeyContracts, operation);
export function customerKeyContractMatches(operation: string, entry: Obj) {
  const c = customerKeyContracts[operation];
  return !!c && c.handler === entry.handler &&
    c.permission_scope === entry.permission_scope &&
    c.is_mutation === entry.is_mutation;
}
const ajv = new Ajv({ strict: true, validateFormats: true });
for (const [name, format] of Object.entries(fullFormats)) {
  ajv.addFormat(name, format);
}
const inputs = new Map(
  Object.entries(customerKeyContracts).map((
    [name, c],
  ) => [name, ajv.compile(c.input_schema)]),
);
const outputs = new Map(
  Object.entries(customerKeyContracts).map((
    [name, c],
  ) => [name, ajv.compile(c.output_schema)]),
);
const object = (value: unknown): value is Obj =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const validId = (value: unknown) =>
  typeof value === "string" &&
  /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value);
const reply = (status: number, data: Obj) =>
  Response.json(data, { status, headers: { "cache-control": "no-store" } });
export type CustomerKeyDependencies = CustomerServiceDependencies & {
  emailConfirmed: boolean;
};
export function buildCustomerKeyRequest(
  deps: CustomerKeyDependencies,
  userToken: string,
  operation: string,
  args: unknown,
): { url: string; init: RequestInit } | null {
  if (
    !isCustomerKeyOperation(operation) || !object(args) ||
    inputs.get(operation)?.(args) !== true || !userToken ||
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
  return {
    url: base.origin + "/functions/v1/sandy-operations-api",
    init: {
      method: "POST",
      redirect: "error",
      signal: AbortSignal.timeout(35000),
      headers: {
        authorization: `Bearer ${userToken}`,
        apikey: deps.anon,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        operation: customerKeyContracts[operation].operation,
        arguments: args,
      }),
    },
  };
}
export async function executeCustomerKeyOperation(
  deps: CustomerKeyDependencies,
  userToken: string,
  operation: string,
  args: unknown,
): Promise<Response> {
  if (
    !validId(deps.principal.id) || !validId(deps.principal.agendaCustomerId) ||
    deps.emailConfirmed !== true
  ) {
    return reply(403, {
      ok: false,
      error: "confirmed_agenda_user_required",
      executed: false,
    });
  }
  if (
    !isCustomerKeyOperation(operation) || !object(args) ||
    inputs.get(operation)?.(args) !== true
  ) {
    return reply(400, {
      ok: false,
      error: "invalid_operation_arguments",
      executed: false,
    });
  }
  if (
    typeof args.expires_at === "string" &&
    Date.parse(args.expires_at) <= Date.now()
  ) {
    return reply(400, {
      ok: false,
      error: "key_expiry_must_be_future",
      executed: false,
    });
  }
  const c = customerKeyContracts[operation],
    request = buildCustomerKeyRequest(deps, userToken, operation, args);
  if (!request) {
    return reply(503, {
      ok: false,
      error: "customer_key_session_required",
      executed: false,
    });
  }
  let response: Response;
  try {
    response = await (deps.fetch ?? fetch)(request.url, request.init);
  } catch {
    return reply(502, {
      ok: false,
      error: "customer_key_outcome_unknown",
      executed: null,
      reconciliation_required: c.is_mutation,
    });
  }
  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    return reply(502, {
      ok: false,
      error: "customer_key_invalid_response",
      executed: true,
      reconciliation_required: c.is_mutation,
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
        error: "customer_key_backend_rejected",
        upstream_status: response.status,
        executed: true,
        reconciliation_required: c.is_mutation && response.status >= 500,
      },
    );
  }
  let result: Obj;
  if (operation === "customer.keys.list") {
    if (!Array.isArray(payload.keys)) {
      return reply(502, {
        ok: false,
        error: "customer_key_output_contract_mismatch",
        executed: true,
      });
    }
    // Project the non-secret record fields; stored hashes and unexpected backend
    // fields are never exposed by key administration.
    const keys = payload.keys.slice(0, 200).map((row) =>
      object(row)
        ? Object.fromEntries(
          Object.entries(row).filter(([name]) =>
            Object.hasOwn(properties, name)
          ),
        )
        : row
    );
    result = {
      ok: true,
      contract_version: "1.0.0",
      keys,
      response_item_cap: 200,
      response_items_truncated: payload.keys.length > 200,
    };
  } else if (operation === "customer.keys.create") {
    if (
      !object(payload.record) || typeof payload.key !== "string" ||
      !payload.key.startsWith(String(payload.record.prefix)) ||
      JSON.stringify(payload.record.scopes) !== JSON.stringify(args.scopes) ||
      (args.name !== undefined && payload.record.name !== args.name) ||
      (args.expires_at !== undefined &&
        Date.parse(String(payload.record.expires_at)) !==
          Date.parse(String(args.expires_at)))
    ) {
      return reply(502, {
        ok: false,
        error: "customer_key_issuance_receipt_mismatch",
        executed: true,
        reconciliation_required: true,
      });
    }
    const record = Object.fromEntries(
      Object.entries(payload.record).filter(([name]) =>
        Object.hasOwn(properties, name)
      ),
    );
    result = {
      ok: true,
      contract_version: "1.0.0",
      key: payload.key,
      record,
      warning: payload.warning,
      display_once: true,
    };
  } else {result = {
      ok: true,
      contract_version: "1.0.0",
      revoked: payload.revoked,
    };}
  if (outputs.get(operation)?.(result) !== true) {
    return reply(502, {
      ok: false,
      error: "customer_key_output_contract_mismatch",
      executed: true,
      reconciliation_required: c.is_mutation,
    });
  }
  return reply(response.status, result);
}
