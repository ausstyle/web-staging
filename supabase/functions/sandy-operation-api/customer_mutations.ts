/** Ten existing customer mutations, through the shared transactional service.
 * The gateway must additionally enforce its registry verification/approval gate.
 * Caller identity comes from Auth and the enabled customer directory. The RPC
 * independently derives that identity from the real user JWT and commits the
 * receipt with the mutation and all existing triggers in one transaction.
 */
import { Ajv } from "npm:ajv@8.17.1";
import { fullFormats } from "npm:ajv-formats@3.0.1/dist/formats.js";
type Row = Record<string, unknown>;
export const customerMutationOperations = [
  "tasks.create",
  "tasks.update",
  "tasks.complete",
  "tasks.archive",
  "calendar.create",
  "calendar.update",
  "calendar.cancel",
  "files.rename",
  "files.set_description",
  "files.archive",
] as const;
export type CustomerMutationOperation =
  typeof customerMutationOperations[number];
const object = (v: unknown): v is Row =>
  v !== null && typeof v === "object" && !Array.isArray(v);
const uuid = (v: unknown): v is string =>
  typeof v === "string" &&
  /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(v);
const same = (v: unknown, id: unknown) =>
  uuid(v) && uuid(id) && v.toLowerCase() === id.toLowerCase();
const timestamp = (v: unknown) =>
  typeof v === "string" && Number.isFinite(Date.parse(v));
const nullableUuid = { type: ["string", "null"], format: "uuid" };
const date = { type: "string", format: "date-time" };
const nullableDate = { type: ["string", "null"], format: "date-time" };
const id = { type: "string", format: "uuid" };
const text = { type: "string" };
const nullableText = { type: ["string", "null"] };
const key = {
  type: "string",
  minLength: 12,
  maxLength: 128,
  pattern: "^[A-Za-z0-9:_-]+$",
};
const taskStatus = {
  type: "string",
  enum: ["todo", "in_progress", "waiting", "blocked", "completed", "cancelled"],
};
const priority = { type: "string", enum: ["low", "normal", "high", "urgent"] };
const calendarStatus = {
  type: "string",
  enum: ["confirmed", "tentative", "cancelled"],
};
const taskFields: Row = {
  title: { type: "string", minLength: 1, maxLength: 240 },
  details: text,
  status: taskStatus,
  priority,
  due_at: nullableDate,
  start_at: nullableDate,
  next_review_at: nullableDate,
  parent_task_id: nullableUuid,
  company_id: nullableUuid,
  category_id: nullableUuid,
  position: { type: "integer", minimum: -2147483648, maximum: 2147483647 },
};
const calendarFields: Row = {
  title: { type: "string", minLength: 1 },
  description: nullableText,
  starts_at: date,
  ends_at: nullableDate,
  timezone: { type: "string", minLength: 1 },
  all_day: { type: "boolean" },
  location: nullableText,
  status: calendarStatus,
  company_id: nullableUuid,
};
const input = (fields: Row, required: string[], minProperties?: number) => ({
  type: "object",
  properties: { ...fields, idempotency_key: key },
  required: [...required, "idempotency_key"],
  additionalProperties: false,
  ...(minProperties ? { minProperties } : {}),
});
const inputs: Record<CustomerMutationOperation, Row> = {
  "tasks.create": input(taskFields, ["title"]),
  "tasks.update": input({ id, ...taskFields }, ["id"], 3),
  "tasks.complete": input({ id }, ["id"]),
  "tasks.archive": input({ id }, ["id"]),
  "calendar.create": input({ ...calendarFields, ends_at: date }, [
    "title",
    "starts_at",
    "ends_at",
  ]),
  "calendar.update": input({ id, ...calendarFields }, ["id"], 3),
  "calendar.cancel": input({ id }, ["id"]),
  "files.rename": input({ id, name: { type: "string", minLength: 1 } }, [
    "id",
    "name",
  ]),
  "files.set_description": input({ id, description: nullableText }, ["id"]),
  "files.archive": input({ id }, ["id"]),
};
function itemSchema(operation: CustomerMutationOperation): Row {
  const task = operation.startsWith("tasks.");
  const calendar = operation.startsWith("calendar.");
  const owner = task || calendar ? "customer_id" : "owner_customer_id";
  const fields: Row = { id, [owner]: id };
  if (task) {
    Object.assign(fields, {
      title: taskFields.title,
      status: taskStatus,
      priority,
      version: { type: "integer", minimum: 1 },
    });
  }
  if (calendar) {
    Object.assign(fields, {
      title: calendarFields.title,
      starts_at: date,
      ends_at: nullableDate,
      status: calendarStatus,
    });
  }
  if (operation === "tasks.complete") {
    Object.assign(fields, {
      status: { const: "completed" },
      completed_at: date,
    });
  }
  if (operation === "tasks.archive") fields.archived_at = date;
  if (operation === "calendar.cancel") fields.status = { const: "cancelled" };
  if (operation === "files.rename") {
    fields.display_name = { type: "string", minLength: 1, maxLength: 250 };
  }
  if (operation === "files.set_description") fields.description = text;
  if (operation === "files.archive") {
    Object.assign(fields, {
      library_state: { const: "archived" },
      library_state_changed_at: date,
    });
  }
  return {
    type: "object",
    properties: fields,
    required: Object.keys(fields),
    additionalProperties: true,
  };
}
export const customerMutationContracts = Object.fromEntries(
  customerMutationOperations.map((operation) => [operation, {
    handler: "sandy-operations-api",
    permission_scope: `${operation.split(".")[0]}:write`,
    is_mutation: true,
    input_schema: inputs[operation],
    output_schema: {
      type: "object",
      required: [
        "ok",
        "contract_version",
        "operation",
        "mutation_id",
        "reused",
        "item",
      ],
      properties: {
        ok: { const: true },
        contract_version: { const: "1.0.0" },
        operation: { const: operation },
        mutation_id: id,
        reused: { type: "boolean" },
        item: itemSchema(operation),
      },
      additionalProperties: false,
    },
    description:
      `Tenant-scoped ${operation} through the shared actual-session transaction and stable idempotency receipt. Contract v1.0.0; task triggers remain active; verification and approval gates remain required.`,
  }]),
) as unknown as Record<
  CustomerMutationOperation,
  {
    handler: string;
    permission_scope: string;
    is_mutation: true;
    input_schema: Row;
    output_schema: Row;
    description: string;
  }
>;
// Existing Memory Centre correction, with the same receipt transport. It stays
// in the memory extension so Agenda access never grants private-memory authority.
export const memoryCorrectionMutationContract = {
  handler: "sandy-memory-centre",
  permission_scope: "memory:write",
  is_mutation: true,
  input_schema: input({
    id,
    confirm: { const: true },
    new_value: { type: ["string", "null"], minLength: 2, maxLength: 1000 },
  }, ["id", "confirm", "new_value"]),
  output_schema: {
    type: "object",
    additionalProperties: false,
    required: [
      "ok",
      "contract_version",
      "operation",
      "mutation_id",
      "reused",
      "item",
    ],
    properties: {
      ok: { const: true },
      contract_version: { const: "1.0.0" },
      operation: { const: "memory.fact_correct" },
      mutation_id: id,
      reused: { type: "boolean" },
      item: {
        type: "object",
        additionalProperties: false,
        required: [
          "id",
          "customer_id",
          "original_fact_id",
          "status",
          "original_status",
          "fact_value",
          "supersedes_fact_id",
          "rejection_id",
          "rejected_value",
          "corrected_value",
        ],
        properties: {
          id,
          customer_id: id,
          original_fact_id: id,
          status: { type: "string", enum: ["active", "rejected"] },
          original_status: {
            type: "string",
            enum: ["active", "superseded", "rejected"],
          },
          fact_value: { type: "string", minLength: 1, maxLength: 2000 },
          supersedes_fact_id: nullableUuid,
          rejection_id: nullableUuid,
          rejected_value: nullableText,
          corrected_value: nullableText,
        },
      },
    },
  },
} as const;
type ReceiptOperation = CustomerMutationOperation | "memory.fact_correct";
const ajv = new Ajv({ strict: true, validateFormats: true, allErrors: false });
for (const [name, format] of Object.entries(fullFormats)) {
  ajv.addFormat(name, format);
}
const inputValidators = new Map(
  customerMutationOperations.map(
    (operation) => [operation, ajv.compile(inputs[operation])],
  ),
);
const outputValidators = new Map(
  customerMutationOperations.map(
    (operation) => [
      operation,
      ajv.compile(customerMutationContracts[operation].output_schema),
    ],
  ),
);
const memoryCorrectionInput = ajv.compile(
  memoryCorrectionMutationContract.input_schema,
);
const memoryCorrectionOutput = ajv.compile(
  memoryCorrectionMutationContract.output_schema,
);
export function isCustomerMutationOperation(
  operation: unknown,
): operation is CustomerMutationOperation {
  return typeof operation === "string" &&
    Object.hasOwn(customerMutationContracts, operation);
}
export function validateCustomerMutationArguments(
  operation: unknown,
  args: unknown,
): args is Row {
  if (
    !isCustomerMutationOperation(operation) ||
    inputValidators.get(operation)!(args) !== true || !object(args)
  ) return false;
  if (
    (typeof args.title === "string" && !args.title.trim()) ||
    (typeof args.name === "string" && !args.name.trim())
  ) return false;
  if (
    operation.startsWith("tasks.") && typeof args.title === "string" &&
    args.title.length > 240
  ) return false;
  if (same(args.id, args.parent_task_id)) return false;
  for (
    const field of [
      "starts_at",
      "ends_at",
      "due_at",
      "start_at",
      "next_review_at",
    ]
  ) {
    if (typeof args[field] === "string" && !timestamp(args[field])) {
      return false;
    }
  }
  if (
    operation.startsWith("calendar.") && typeof args.starts_at === "string" &&
    typeof args.ends_at === "string" &&
    Date.parse(args.ends_at) <= Date.parse(args.starts_at)
  ) return false;
  return true;
}
type QueryResult = { data: unknown; error: unknown };
type Query = {
  eq(key: string, value: unknown): Query;
  is(key: string, value: null): Query;
  maybeSingle(): PromiseLike<QueryResult>;
};
export type CustomerMutationDb = {
  auth: {
    getUser(
      token: string,
    ): PromiseLike<
      { data: { user: { id: string; email?: string } | null }; error: unknown }
    >;
  };
  from(table: string): { select(columns: string): Query };
};
export type CustomerMutationDependencies = {
  base: string;
  anon: string;
  // The concrete SDK carries recursive query generics. Keep that implementation
  // outside this public boundary, and validate the small runtime surface below.
  db: unknown;
  fetch?: typeof fetch;
};
function customerMutationDb(value: unknown): CustomerMutationDb | null {
  if (
    !object(value) || !object(value.auth) ||
    typeof value.auth.getUser !== "function" || typeof value.from !== "function"
  ) return null;
  return value as unknown as CustomerMutationDb;
}
export type CustomerMutationResult = { status: number; body: Row };
const failure = (
  status: number,
  error: string,
  unknown = false,
): CustomerMutationResult => ({
  status,
  body: {
    ok: false,
    error,
    executed: unknown ? null : false,
    ...(unknown
      ? { reconciliation_required: true, retry_with_same_idempotency_key: true }
      : {}),
  },
});
function expectedEffect(
  operation: ReceiptOperation,
  args: Row,
  item: Row,
): boolean {
  if (operation === "memory.fact_correct") {
    if (!same(item.original_fact_id, args.id)) return false;
    if (args.new_value === null) {
      return same(item.id, args.id) && item.status === "rejected" &&
        item.original_status === "rejected" && uuid(item.rejection_id) &&
        item.corrected_value === null;
    }
    const value = String(args.new_value).trim();
    if (item.status !== "active" || item.fact_value !== value) return false;
    if (same(item.id, args.id)) {
      return item.original_status === "active" && item.rejection_id === null &&
        item.rejected_value === null && item.corrected_value === null;
    }
    return item.original_status === "superseded" &&
      same(item.supersedes_fact_id, args.id) && uuid(item.rejection_id) &&
      typeof item.rejected_value === "string" && item.corrected_value === value;
  }
  if (!operation.endsWith(".create") && !same(item.id, args.id)) return false;
  if (
    typeof args.title === "string" &&
    item.title !==
      (operation.startsWith("tasks.")
        ? args.title.replace(/^ +| +$/g, "")
        : args.title)
  ) return false;
  if (
    operation === "tasks.complete" &&
    (item.status !== "completed" || !timestamp(item.completed_at))
  ) return false;
  if (operation === "tasks.archive" && !timestamp(item.archived_at)) {
    return false;
  }
  if (operation === "calendar.cancel" && item.status !== "cancelled") {
    return false;
  }
  if (
    operation === "files.rename" &&
    item.display_name !== String(args.name).trim().slice(0, 250)
  ) return false;
  if (
    operation === "files.set_description" &&
    item.description !== String(args.description ?? "").slice(0, 4000)
  ) return false;
  if (
    operation === "files.archive" &&
    (item.library_state !== "archived" ||
      !timestamp(item.library_state_changed_at))
  ) return false;
  for (
    const key of [
      "status",
      "priority",
      "details",
      "position",
      "timezone",
      "all_day",
      "location",
      "description",
    ]
  ) {
    if (
      Object.hasOwn(args, key) && operation !== "files.set_description" &&
      item[key] !== args[key]
    ) return false;
  }
  for (const key of ["company_id", "parent_task_id", "category_id"]) {
    if (
      Object.hasOwn(args, key) &&
      !(args[key] === null ? item[key] === null : same(item[key], args[key]))
    ) return false;
  }
  for (
    const key of [
      "starts_at",
      "ends_at",
      "due_at",
      "start_at",
      "next_review_at",
    ]
  ) {
    if (
      Object.hasOwn(args, key) &&
      !(args[key] === null ? item[key] === null : timestamp(item[key]) &&
        Date.parse(String(item[key])) === Date.parse(String(args[key])))
    ) return false;
  }
  return true;
}
export async function executeCustomerMutation(
  dependencies: CustomerMutationDependencies,
  userJwt: string,
  operation: unknown,
  args: unknown,
): Promise<CustomerMutationResult> {
  if (
    !isCustomerMutationOperation(operation) ||
    !validateCustomerMutationArguments(operation, args)
  ) return failure(400, "invalid_customer_mutation_arguments");
  if (
    !/^[A-Za-z0-9._~-]+$/.test(userJwt) || userJwt.startsWith("sandyop_") ||
    userJwt.startsWith("sandy_api_")
  ) return failure(401, "customer_session_required");
  const db = customerMutationDb(dependencies.db);
  if (!db) return failure(503, "customer_authorisation_unavailable");
  let customer: string;
  try {
    const auth = await db.auth.getUser(userJwt);
    const user = auth.data.user;
    if (
      auth.error || !user || !uuid(user.id) || typeof user.email !== "string" ||
      !user.email
    ) return failure(401, "customer_session_required");
    const directory = await db.from("sandy_agenda_access").select(
      "email,customer_id,enabled",
    ).eq("email", user.email.toLowerCase()).eq("enabled", true).maybeSingle();
    if (directory.error) {
      return failure(503, "customer_authorisation_unavailable");
    }
    if (
      !object(directory.data) || !uuid(directory.data.customer_id) ||
      directory.data.enabled !== true ||
      directory.data.email !== user.email.toLowerCase()
    ) return failure(403, "customer_access_required");
    customer = directory.data.customer_id;
    // Resource/reference guards run in the RPC after receipt lookup; a replay
    // must remain possible after the original mutation archived its resource.
  } catch {
    return failure(503, "customer_authorisation_unavailable");
  }

  return await executeMutationReceipt(
    dependencies,
    userJwt,
    operation,
    args,
    customer,
  );
}

/** A portal principal is a verified expectation, never the RPC's authority. The
 * actual user JWT is forwarded; SQL independently derives its current customer. */
export async function executeMemoryCorrection(
  dependencies: Pick<CustomerMutationDependencies, "base" | "anon" | "fetch">,
  userJwt: string,
  customer: string,
  args: unknown,
): Promise<CustomerMutationResult> {
  if (
    !uuid(customer) || !object(args) || memoryCorrectionInput(args) !== true ||
    (typeof args.new_value === "string" && args.new_value.trim().length < 2)
  ) return failure(400, "invalid_customer_mutation_arguments");
  if (
    !userJwt || !/^[A-Za-z0-9._~-]+$/.test(userJwt) ||
    userJwt.startsWith("sandyop_") || userJwt.startsWith("sandy_api_")
  ) return failure(401, "customer_session_required");
  const result = await executeMutationReceipt(
    dependencies,
    userJwt,
    "memory.fact_correct",
    args,
    customer,
  );
  if (result.body.executed === null) result.body.automatic_retry = false;
  return result;
}
export function buildCustomerMutationReceiptRequest(
  dependencies: Pick<CustomerMutationDependencies, "base" | "anon">,
  userJwt: string,
  operation: ReceiptOperation,
  args: Row,
): { url: string; init: RequestInit } | null {
  if (
    !(operation === "memory.fact_correct"
      ? memoryCorrectionInput(args) === true
      : validateCustomerMutationArguments(operation, args)) ||
    !/^[A-Za-z0-9._~-]+$/.test(userJwt) || userJwt.startsWith("sandyop_") ||
    userJwt.startsWith("sandy_api_")
  ) return null;
  let origin: URL;
  try {
    origin = new URL(dependencies.base);
  } catch {
    return null;
  }
  if (
    origin.protocol !== "https:" || origin.username || origin.password ||
    origin.pathname !== "/" || origin.search || origin.hash
  ) return null;
  const { idempotency_key, ...fields } = args;
  return {
    url: `${origin.origin}/rest/v1/rpc/sandy_api_customer_mutation`,
    init: {
      method: "POST",
      redirect: "error",
      headers: {
        authorization: `Bearer ${userJwt}`,
        apikey: dependencies.anon,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        p_operation: operation,
        p_arguments: fields,
        p_idempotency_key: idempotency_key,
      }),
      signal: AbortSignal.timeout(30000),
    },
  };
}
async function executeMutationReceipt(
  dependencies: Pick<CustomerMutationDependencies, "base" | "anon" | "fetch">,
  userJwt: string,
  operation: ReceiptOperation,
  args: Row,
  customer: string,
): Promise<CustomerMutationResult> {
  const request = buildCustomerMutationReceiptRequest(
    dependencies,
    userJwt,
    operation,
    args,
  );
  if (!request) return failure(503, "customer_backend_configuration_invalid");
  let response: Response;
  try {
    response = await (dependencies.fetch ?? fetch)(request.url, request.init);
  } catch {
    return failure(502, "customer_mutation_outcome_unknown", true);
  }
  let result: unknown;
  try {
    result = await response.json();
  } catch {
    return failure(502, "customer_mutation_response_invalid", true);
  }
  if (!response.ok) {
    if ([401, 403, 404].includes(response.status)) {
      return failure(
        response.status,
        response.status === 404
          ? "customer_mutation_backend_unavailable"
          : "customer_session_rejected",
      );
    }
    return failure(502, "customer_mutation_outcome_unknown", true);
  }
  if (
    object(result) && result.ok === false && typeof result.error === "string" &&
    Number.isInteger(result.http_status) &&
    [400, 401, 403, 404, 409, 424, 503].includes(Number(result.http_status))
  ) {
    return failure(
      Number(result.http_status),
      result.error,
      result.reconciliation_required === true,
    );
  }
  if (
    !object(result) ||
    (operation === "memory.fact_correct"
        ? memoryCorrectionOutput(result)
        : outputValidators.get(operation)!(result)) !== true ||
    !object(result.item) || !same(
      result.item[
        operation.startsWith("files.") ? "owner_customer_id" : "customer_id"
      ],
      customer,
    ) || !expectedEffect(operation, args, result.item)
  ) return failure(502, "customer_mutation_result_unverified", true);
  return { status: 200, body: { ok: true, operation, executed: true, result } };
}
