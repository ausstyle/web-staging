/** Existing sandyop_ keys are tenant principals. They never create or supply an
 * Auth user, Controller role, email or customer JWT. The original backend also
 * authenticates the original opaque key and derives its tenant independently.
 */
import { argumentDigest } from "../_shared/sandy_api_protocol.ts";
import {
  type ExecutionReceipt,
  finishExecution,
  type PolicyDb,
  type PolicyResult,
} from "./access_policy.ts";
type Obj = Record<string, unknown>;
export const customerKeyReadScopes: Readonly<Record<string, string>> = Object
  .freeze({
    "tasks.list": "tasks:read",
    "tasks.get": "tasks:read",
    "calendar.list": "calendar:read",
    "calendar.get": "calendar:read",
    "calendar.conflicts": "calendar:read",
    "files.list": "files:read",
    "files.get": "files:read",
    "files.search": "files:read",
  });
const scopes = new Set([
  "tasks:read",
  "tasks:write",
  "calendar:read",
  "calendar:write",
  "files:read",
  "files:write",
]);
export type CustomerKeyPrincipal = {
  kind: "customer_key";
  keyId: string;
  customerId: string;
  scopes: readonly string[];
  allowedOperations: readonly string[];
  keyRevisionSha256: string;
  expiresAt: string | null;
};
export type CustomerKeyExecutionInput = {
  operation: string;
  arguments: unknown;
  requestId: string;
  channel: "api" | "mcp";
  contractSha256: string;
};
export type CustomerKeyAdmission = {
  principal: CustomerKeyPrincipal;
  admissionId: string;
  grantId: string;
  requestId: string;
  operation: string;
  channel: "api" | "mcp";
  inputSha256: string;
  contractSha256: string;
  scopeSha256: string;
  expiresAt: string;
};
const uuid = (v: unknown): v is string =>
  typeof v === "string" &&
  /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(v);
const digest = (v: unknown): v is string =>
  typeof v === "string" && /^[a-f0-9]{64}$/.test(v);
const object = (v: unknown): v is Obj =>
  v !== null && typeof v === "object" && !Array.isArray(v);
const timestamp = (v: unknown): v is string =>
  typeof v === "string" && Number.isFinite(Date.parse(v));
const rawPattern = /^sandyop_[a-f0-9]{64}$/;
const allowed = (keyScopes: readonly string[]) =>
  Object.keys(customerKeyReadScopes).filter((o) =>
    keyScopes.includes(customerKeyReadScopes[o])
  ).sort();
const fail = (
  status: number,
  error: string,
  uncertain = false,
): PolicyResult<never> => ({
  ok: false,
  status,
  error,
  ...(uncertain ? { reconciliationRequired: true } : {}),
});
const refusals: Record<string, number> = {
  invalid_customer_key: 401,
  invalid_customer_key_admission: 400,
  customer_key_scope_denied: 403,
  customer_key_contract_changed: 409,
  request_id_conflict: 409,
  admission_already_recorded: 409,
  customer_key_rate_exceeded: 429,
  customer_key_grant_scope_denied: 403,
  customer_key_grant_used_or_expired: 409,
  admission_not_found: 404,
};
async function sha(value: string) {
  return Array.from(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)),
    ),
    (b) => b.toString(16).padStart(2, "0"),
  ).join("");
}
async function rpc(
  db: PolicyDb,
  name: string,
  args: Obj,
  mutation = false,
): Promise<PolicyResult<Obj>> {
  let response;
  try {
    response = await db.rpc(name, args);
  } catch {
    return fail(
      503,
      mutation
        ? "customer_key_policy_outcome_unknown"
        : "customer_key_policy_unavailable",
      mutation,
    );
  }
  if (response.error || !object(response.data)) {
    return fail(
      503,
      mutation
        ? "customer_key_policy_outcome_unknown"
        : "customer_key_policy_unavailable",
      mutation,
    );
  }
  const data = response.data;
  if (data.ok !== true) {
    const status = typeof data.error === "string"
      ? refusals[data.error]
      : undefined;
    return status && data.http_status === status
      ? fail(status, String(data.error))
      : fail(503, "customer_key_policy_response_invalid", mutation);
  }
  return { ok: true, value: data };
}
function validPrincipal(principal: CustomerKeyPrincipal): boolean {
  return object(principal) && principal.kind === "customer_key" &&
    uuid(principal.keyId) && uuid(principal.customerId) &&
    digest(principal.keyRevisionSha256) && Array.isArray(principal.scopes) &&
    principal.scopes.length > 0 && principal.scopes.length <= 6 &&
    principal.scopes.every((s) => scopes.has(s)) &&
    new Set(principal.scopes).size === principal.scopes.length &&
    Array.isArray(principal.allowedOperations) &&
    JSON.stringify(principal.allowedOperations) ===
      JSON.stringify(allowed(principal.scopes)) &&
    (principal.expiresAt === null ||
      (timestamp(principal.expiresAt) &&
        Date.parse(principal.expiresAt) > Date.now()));
}
export const isCustomerKeyReadOperation = (operation: string) =>
  Object.hasOwn(customerKeyReadScopes, operation);

export async function authenticateCustomerKey(
  db: PolicyDb,
  rawKey: unknown,
): Promise<PolicyResult<CustomerKeyPrincipal>> {
  if (typeof rawKey !== "string" || !rawPattern.test(rawKey)) {
    return fail(401, "invalid_customer_key");
  }
  const result = await rpc(db, "sandy_api_authenticate_customer_key", {
    p_secret_sha256: await sha(rawKey),
  });
  if (!result.ok) return result;
  const v = result.value;
  const principal: CustomerKeyPrincipal = {
    kind: "customer_key",
    keyId: String(v.key_id),
    customerId: String(v.customer_id),
    scopes: v.scopes as string[],
    allowedOperations: v.allowed_operations as string[],
    keyRevisionSha256: String(v.key_revision_sha256),
    expiresAt: v.expires_at as string | null,
  };
  if (v.kind !== "customer_key" || !validPrincipal(principal)) {
    return fail(503, "customer_key_policy_response_invalid");
  }
  return { ok: true, value: principal };
}
/** Mixed Auth/key modes are rejected. The public platform JWT remains the
 * gateway's configured anon bearer; the private key stays in its own header. */
export async function resolveCustomerKeyRequest(
  db: PolicyDb,
  request: Request,
  anonBearer: string,
): Promise<PolicyResult<CustomerKeyPrincipal> | null> {
  const key = request.headers.get("x-sandy-api-key");
  if (key === null || !key.startsWith("sandyop_")) return null;
  const bearer = request.headers.get("authorization")?.match(
    /^Bearer\s+([^\s]+)$/i,
  )?.[1];
  if (!anonBearer || bearer !== anonBearer) {
    return fail(401, "customer_key_transport_requires_anon_bearer");
  }
  return authenticateCustomerKey(db, key);
}
export async function customerKeyScopeDigest(
  principal: CustomerKeyPrincipal,
  operation: string,
): Promise<string> {
  if (
    !validPrincipal(principal) ||
    !principal.allowedOperations.includes(operation)
  ) throw Error("customer_key_scope_denied");
  return sha(
    `sandy_customer_key_v1:${principal.keyId.toLowerCase()}:${principal.customerId.toLowerCase()}:${
      customerKeyReadScopes[operation]
    }:${principal.keyRevisionSha256}`,
  );
}
export async function admitCustomerKeyExecution(
  db: PolicyDb,
  principal: CustomerKeyPrincipal,
  rawKey: string,
  input: CustomerKeyExecutionInput,
): Promise<PolicyResult<CustomerKeyAdmission>> {
  if (
    !validPrincipal(principal) || !rawPattern.test(rawKey) || !object(input) ||
    !uuid(input.requestId) ||
    !digest(input.contractSha256) || !["api", "mcp"].includes(input.channel) ||
    Object.keys(input).some((k) =>
      !["operation", "arguments", "requestId", "channel", "contractSha256"]
        .includes(k)
    )
  ) return fail(400, "invalid_customer_key_admission");
  if (!principal.allowedOperations.includes(input.operation)) {
    return fail(403, "customer_key_scope_denied");
  }
  let inputSha256: string, scopeSha256: string;
  try {
    inputSha256 = await argumentDigest(input.arguments);
    scopeSha256 = await customerKeyScopeDigest(principal, input.operation);
  } catch {
    return fail(400, "invalid_customer_key_admission");
  }
  const result = await rpc(db, "sandy_api_admit_customer_key_execution", {
    p_key_id: principal.keyId,
    p_customer_id: principal.customerId,
    p_secret_sha256: await sha(rawKey),
    p_key_revision_sha256: principal.keyRevisionSha256,
    p_operation: input.operation,
    p_channel: input.channel,
    p_input_sha256: inputSha256,
    p_request_id: input.requestId,
    p_contract_sha256: input.contractSha256,
    p_scope_sha256: scopeSha256,
  }, true);
  if (!result.ok) return result;
  const v = result.value;
  if (
    v.allowed !== true || v.reused !== false ||
    v.principal_kind !== "customer_key" ||
    v.customer_key_id !== principal.keyId ||
    v.tenant_id !== principal.customerId ||
    !uuid(v.admission_id) || !uuid(v.grant_id) || v.state !== "admitted" ||
    v.executed !== false || !timestamp(v.expires_at) ||
    Date.parse(v.expires_at) <= Date.now()
  ) return fail(503, "customer_key_admission_outcome_unknown", true);
  return {
    ok: true,
    value: {
      principal,
      admissionId: v.admission_id,
      grantId: v.grant_id,
      requestId: input.requestId,
      operation: input.operation,
      channel: input.channel,
      inputSha256,
      contractSha256: input.contractSha256,
      scopeSha256,
      expiresAt: v.expires_at,
    },
  };
}
export async function consumeCustomerKeyGrant(
  db: PolicyDb,
  rawKey: string,
  admission: CustomerKeyAdmission,
): Promise<PolicyResult<{ admissionId: string }>> {
  if (
    !object(admission) || !validPrincipal(admission.principal) ||
    !rawPattern.test(rawKey) || !uuid(admission.admissionId) ||
    !uuid(admission.grantId) ||
    !uuid(admission.requestId) ||
    ![admission.inputSha256, admission.contractSha256, admission.scopeSha256]
      .every(digest) ||
    !["api", "mcp"].includes(admission.channel) ||
    !admission.principal.allowedOperations.includes(admission.operation)
  ) return fail(400, "invalid_customer_key_admission");
  const p = admission.principal;
  const result = await rpc(db, "sandy_api_consume_customer_key_grant", {
    p_grant_id: admission.grantId,
    p_key_id: p.keyId,
    p_customer_id: p.customerId,
    p_secret_sha256: await sha(rawKey),
    p_key_revision_sha256: p.keyRevisionSha256,
    p_operation: admission.operation,
    p_channel: admission.channel,
    p_input_sha256: admission.inputSha256,
    p_request_id: admission.requestId,
    p_contract_sha256: admission.contractSha256,
    p_scope_sha256: admission.scopeSha256,
  }, true);
  if (!result.ok) return result;
  return result.value.allowed === true && result.value.reused === false &&
      result.value.admission_id === admission.admissionId
    ? { ok: true, value: { admissionId: admission.admissionId } }
    : fail(503, "customer_key_grant_outcome_unknown", true);
}
const response = (status: number, body: Obj) =>
  Response.json(body, {
    status,
    headers: {
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    },
  });
/** Wrap the existing, schema-checked canonical read callback. The same shared
 * finish RPC records digest-only outcomes; no customer business SQL is copied. */
export async function governedCustomerKeyExecution(
  db: PolicyDb,
  principal: CustomerKeyPrincipal,
  rawKey: string,
  input: CustomerKeyExecutionInput,
  execute: (admission: CustomerKeyAdmission) => Promise<Response>,
): Promise<Response> {
  const admitted = await admitCustomerKeyExecution(
    db,
    principal,
    rawKey,
    input,
  );
  if (!admitted.ok) {
    return response(admitted.status, {
      ok: false,
      error: admitted.error,
      executed: false,
      request_id: input.requestId,
      ...(admitted.reconciliationRequired
        ? { reconciliation_required: true }
        : {}),
    });
  }
  const admission = admitted.value,
    receipt = {
      request_id: admission.requestId,
      admission_id: admission.admissionId,
    };
  const consumed = await consumeCustomerKeyGrant(db, rawKey, admission);
  if (!consumed.ok) {
    return response(consumed.status, {
      ok: false,
      error: consumed.error,
      executed: false,
      ...receipt,
      ...(consumed.reconciliationRequired
        ? { reconciliation_required: true }
        : {}),
    });
  }
  let body: Obj, reply: Response;
  try {
    reply = await execute(admission);
    const data: unknown = await reply.json();
    if (!object(data)) throw Error();
    body = data;
  } catch {
    reply = response(502, {});
    body = {
      ok: false,
      error: "customer_key_read_outcome_unknown",
      executed: null,
      reconciliation_required: true,
    };
  }
  if (body.accepted === true) {
    reply = response(502, {});
    body = {
      ok: false,
      error: "customer_key_read_unexpected_admission",
      executed: null,
      reconciliation_required: true,
    };
  }
  const outcome =
    body.executed === null || body.reconciliation_required === true
      ? "unknown"
      : reply.ok && body.ok === true && body.accepted !== true
      ? "succeeded"
      : "failed";
  const http = Number.isInteger(body.upstream_status) &&
      Number(body.upstream_status) >= 100 && Number(body.upstream_status) <= 599
    ? Number(body.upstream_status)
    : null;
  const finished = await finishExecution(
    db,
    admission.admissionId,
    outcome,
    http,
    null,
    await argumentDigest(body),
  );
  if (!finished.ok) {
    return response(503, {
      ...body,
      ...receipt,
      ok: false,
      error: finished.error,
      reconciliation_required: true,
    });
  }
  return response(reply.status, { ...body, ...receipt });
}
/** Transport to an existing fixed handler, using the original opaque key. It
 * independently checks its hash, scopes and tenant for every resource query. */
export function buildCustomerKeyReadRequest(
  base: string,
  anon: string,
  principal: CustomerKeyPrincipal,
  rawKey: string,
  operation: string,
  args: unknown,
): { url: string; init: RequestInit } | null {
  if (
    !validPrincipal(principal) ||
    !principal.allowedOperations.includes(operation) ||
    !rawPattern.test(rawKey) || !anon || !object(args) ||
    Object.keys(args).some((k) =>
      [
        "actor_id",
        "customer_id",
        "tenant_id",
        "owner_customer_id",
        "auth_user_id",
        "key_id",
        "credential_id",
        "operation",
        "scopes",
        "url",
        "headers",
      ].includes(k)
    )
  ) return null;
  let parsed: URL;
  try {
    parsed = new URL(base);
  } catch {
    return null;
  }
  if (
    parsed.protocol !== "https:" || parsed.username || parsed.password ||
    parsed.pathname !== "/" || parsed.search || parsed.hash
  ) return null;
  return {
    url: parsed.origin + "/functions/v1/sandy-operations-api",
    init: {
      method: "POST",
      redirect: "error",
      signal: AbortSignal.timeout(20000),
      headers: {
        authorization: `Bearer ${rawKey}`,
        apikey: anon,
        "content-type": "application/json",
      },
      body: JSON.stringify({ operation, arguments: args }),
    },
  };
}
export async function getCustomerKeyReceipt(
  db: PolicyDb,
  principal: CustomerKeyPrincipal,
  rawKey: string,
  requestId: unknown,
): Promise<PolicyResult<ExecutionReceipt>> {
  if (
    !validPrincipal(principal) || !rawPattern.test(rawKey) || !uuid(requestId)
  ) return fail(400, "invalid_customer_key_admission");
  const result = await rpc(db, "sandy_api_get_customer_key_receipt", {
    p_key_id: principal.keyId,
    p_customer_id: principal.customerId,
    p_secret_sha256: await sha(rawKey),
    p_request_id: requestId,
  });
  if (!result.ok) return result;
  const v = result.value, state = v.request_state;
  if (
    !uuid(v.admission_id) || v.request_id !== requestId ||
    typeof v.operation !== "string" ||
    !principal.allowedOperations.includes(v.operation) ||
    typeof state !== "string" ||
    !["admitted", "consumed", "succeeded", "failed", "unknown", "rejected"]
      .includes(state) ||
    v.accepted !== false || v.completed !== (state === "succeeded") ||
    v.redispatch_permitted !== false ||
    v.executed !==
      (["succeeded", "failed"].includes(state)
        ? true
        : ["consumed", "unknown"].includes(state)
        ? null
        : false) ||
    v.reconciliation_required !== ["consumed", "unknown"].includes(state) ||
    v.outcome !==
      (["admitted", "consumed"].includes(state) ? "pending" : state) ||
    !(v.provider_http_status === null ||
      (Number.isInteger(v.provider_http_status) &&
        Number(v.provider_http_status) >= 100 &&
        Number(v.provider_http_status) <= 599)) ||
    !(v.provider_request_id_sha256 === null ||
      digest(v.provider_request_id_sha256)) ||
    !(v.result_sha256 === null || digest(v.result_sha256)) ||
    !timestamp(v.created_at) ||
    !(v.finished_at === null || timestamp(v.finished_at))
  ) return fail(503, "customer_key_policy_response_invalid");
  const keys = [
    "ok",
    "admission_id",
    "request_id",
    "operation",
    "request_state",
    "accepted",
    "executed",
    "completed",
    "outcome",
    "provider_http_status",
    "provider_request_id_sha256",
    "result_sha256",
    "reconciliation_required",
    "redispatch_permitted",
    "created_at",
    "finished_at",
  ];
  return {
    ok: true,
    value: Object.fromEntries(keys.map((k) => [k, v[k]])) as ExecutionReceipt,
  };
}
