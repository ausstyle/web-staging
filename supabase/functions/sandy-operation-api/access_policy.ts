/** Shared policy client. Secret material exists only in memory/one-time issuance response.
 * Normal Auth identity and API-key identity are different authentication modes.
 * A delegated principal never supplies a substitute customer JWT.
 */
import { argumentDigest } from "../_shared/sandy_api_protocol.ts";
export type PolicyDb = {
  rpc(
    name: string,
    args: Record<string, unknown>,
  ): PromiseLike<{ data: unknown; error: unknown }>;
};
export type SessionVerifier = (
  bearer: string,
) => Promise<{ id: string } | null>;
export type PolicyError = {
  ok: false;
  status: number;
  error: string;
  reconciliationRequired?: boolean;
  credentialId?: string;
};
export type ApiKeyContext = {
  kind: "api_key";
  principalId: string;
  tenantId: string | null;
  allowedOperations: string[];
  credentialId: string;
  expiresAt: string;
};
export type PolicyResult<T> = { ok: true; value: T } | PolicyError;
const object = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const uuid = (value: unknown): value is string =>
  typeof value === "string" &&
  /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value);
const digest = (value: unknown): value is string =>
  typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
const operation = (value: unknown): value is string =>
  typeof value === "string" && /^[a-z][a-z0-9_.-]{2,100}$/.test(value);
const timestamp = (value: unknown): value is string =>
  typeof value === "string" && Number.isFinite(Date.parse(value));
const exactKeys = (value: Record<string, unknown>, keys: string[]) =>
  Object.keys(value).every((key) => keys.includes(key));
const failure = (
  status: number,
  error: string,
  unknown = false,
): PolicyError => ({
  ok: false,
  status,
  error,
  ...(unknown ? { reconciliationRequired: true } : {}),
});
const knownErrors = new Set([
  "owner_required",
  "tenant_api_key_backend_unavailable",
  "invalid_credential_policy",
  "credential_limit_exceeded",
  "credential_operation_not_delegable",
  "invalid_api_credential",
  "credential_not_found",
  "tenant_execution_policy_unavailable",
  "invalid_execution_admission",
  "request_id_conflict",
  "admission_already_recorded",
  "operation_not_exposed",
  "credential_scope_denied",
  "declared_unit_budget_exceeded",
  "mutation_requires_verified_auth_approval",
  "scoped_mutation_approval_required",
  "read_approval_unexpected",
  "admission_rate_or_declared_units_exceeded",
  "execution_grant_scope_denied",
  "execution_grant_used_or_expired",
  "execution_contract_changed",
  "execution_credential_revoked_or_expired",
  "mutation_approval_changed",
  "invalid_execution_receipt",
  "admission_not_found",
  "execution_receipt_conflict",
  "execution_grant_not_consumed",
  "mutation_readback_required",
  "invalid_audit_query",
  "invalid_audit_verification",
  "audit_anchor_not_found",
  "audit_anchor_mismatch",
]);
function rpcRefusal(data: unknown): PolicyError | null {
  if (!object(data) || data.ok === true) return null;
  if (
    typeof data.error !== "string" || !knownErrors.has(data.error) ||
    !Number.isInteger(data.http_status) ||
    ![400, 401, 403, 404, 409, 422, 424, 429].includes(Number(data.http_status))
  ) return failure(503, "policy_response_invalid", true);
  return failure(Number(data.http_status), data.error);
}
async function rpc(
  db: PolicyDb,
  name: string,
  args: Record<string, unknown>,
  mutation: boolean,
): Promise<PolicyResult<Record<string, unknown>>> {
  try {
    const result = await db.rpc(name, args);
    if (!result || result.error || !object(result.data)) {
      return failure(
        503,
        mutation ? "policy_outcome_unknown" : "policy_unavailable",
        mutation,
      );
    }
    const refusal = rpcRefusal(result.data);
    if (refusal) return refusal;
    if (result.data.ok !== true) {
      return failure(503, "policy_response_invalid", mutation);
    }
    return { ok: true, value: result.data };
  } catch {
    return failure(
      503,
      mutation ? "policy_outcome_unknown" : "policy_unavailable",
      mutation,
    );
  }
}
async function rawDigest(value: string): Promise<string> {
  return Array.from(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)),
    ),
    (x) => x.toString(16).padStart(2, "0"),
  ).join("");
}
const tokenPattern =
  /^sandy_api_([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})\.([A-Za-z0-9_-]{43})$/i;

export async function authenticateScopedCredential(
  db: PolicyDb,
  rawKey: unknown,
): Promise<PolicyResult<ApiKeyContext>> {
  if (typeof rawKey !== "string" || rawKey.length > 150) {
    return failure(401, "invalid_api_credential");
  }
  const parsed = rawKey.match(tokenPattern);
  if (!parsed) return failure(401, "invalid_api_credential");
  const result = await rpc(db, "sandy_api_authenticate_credential", {
    p_credential_id: parsed[1].toLowerCase(),
    p_secret_sha256: await rawDigest(rawKey),
  }, false);
  if (!result.ok) return result;
  const data = result.value;
  if (
    !uuid(data.credential_id) ||
    data.credential_id !== parsed[1].toLowerCase() ||
    !uuid(data.principal_id) || data.tenant_id !== null ||
    !timestamp(data.expires_at) || Date.parse(data.expires_at) <= Date.now() ||
    !Array.isArray(data.allowed_operations) ||
    data.allowed_operations.length < 1 || data.allowed_operations.length > 32 ||
    !data.allowed_operations.every(operation) ||
    new Set(data.allowed_operations).size !== data.allowed_operations.length
  ) return failure(503, "policy_response_invalid");
  return {
    ok: true,
    value: {
      kind: "api_key",
      principalId: data.principal_id,
      tenantId: null,
      allowedOperations: data.allowed_operations,
      credentialId: data.credential_id,
      expiresAt: data.expires_at,
    },
  };
}

/** Platform verifies its public anon JWT; the opaque key is a separate header.
 * Reject mixed user/key modes and never change Edge verify_jwt to accept a key.
 */
export async function resolveApiKeyRequest(
  db: PolicyDb,
  request: Request,
  configuredAnonJwt: string,
): Promise<PolicyResult<ApiKeyContext> | null> {
  const rawKey = request.headers.get("x-sandy-api-key");
  if (rawKey === null) return null;
  const bearer = request.headers.get("authorization")?.match(
    /^Bearer\s+([^\s]+)$/i,
  )?.[1];
  if (!configuredAnonJwt || bearer !== configuredAnonJwt) {
    return failure(401, "api_key_transport_requires_anon_bearer");
  }
  return authenticateScopedCredential(db, rawKey);
}

export type CredentialPolicy = {
  operations: string[];
  ttlSeconds: number;
  requestsPerMinute: number;
  declaredUnitBudget: number;
  tenantId?: null;
};
export async function issueScopedCredential(
  db: PolicyDb,
  verifySession: SessionVerifier,
  bearer: string,
  policy: unknown,
): Promise<PolicyResult<Record<string, unknown>>> {
  // Only the normal Auth session resolver may establish an issuer. An opaque key
  // or an admin/project key is not accepted as a substitute by this helper.
  if (
    typeof bearer !== "string" ||
    !/^[-_A-Za-z0-9]+\.[-_A-Za-z0-9]+\.[-_A-Za-z0-9]+$/.test(bearer)
  ) return failure(401, "authenticated_user_session_required");
  let user: { id: string } | null;
  try {
    user = await verifySession(bearer);
  } catch {
    return failure(503, "identity_verification_unavailable");
  }
  if (!user || !uuid(user.id)) return failure(401, "invalid_identity");
  if (
    !object(policy) ||
    !exactKeys(policy, [
      "operations",
      "ttlSeconds",
      "requestsPerMinute",
      "declaredUnitBudget",
      "tenantId",
    ]) || !Array.isArray(policy.operations) || policy.operations.length < 1 ||
    policy.operations.length > 32 || !policy.operations.every(operation) ||
    new Set(policy.operations).size !== policy.operations.length ||
    !Number.isInteger(policy.ttlSeconds) || Number(policy.ttlSeconds) < 60 ||
    Number(policy.ttlSeconds) > 3600 ||
    !Number.isInteger(policy.requestsPerMinute) ||
    Number(policy.requestsPerMinute) < 1 ||
    Number(policy.requestsPerMinute) > 60 ||
    !Number.isInteger(policy.declaredUnitBudget) ||
    Number(policy.declaredUnitBudget) < 0 ||
    Number(policy.declaredUnitBudget) > 1000000 ||
    !(policy.tenantId === undefined || policy.tenantId === null)
  ) return failure(400, "invalid_credential_policy");
  const id = crypto.randomUUID();
  const entropy = crypto.getRandomValues(new Uint8Array(32));
  const secret = btoa(String.fromCharCode(...entropy)).replaceAll("+", "-")
    .replaceAll("/", "_").replaceAll("=", "");
  const rawKey = `sandy_api_${id}.${secret}`;
  const result = await rpc(db, "sandy_api_issue_credential", {
    p_actor_id: user.id,
    p_credential_id: id,
    p_secret_sha256: await rawDigest(rawKey),
    p_tenant_id: null,
    p_allowed_operations: policy.operations,
    p_ttl_seconds: policy.ttlSeconds,
    p_requests_per_minute: policy.requestsPerMinute,
    p_declared_unit_budget: policy.declaredUnitBudget,
  }, true);
  if (!result.ok) {
    return result.reconciliationRequired
      ? { ...result, credentialId: id }
      : result;
  }
  const data = result.value;
  if (
    data.credential_id !== id || data.principal_id !== user.id ||
    data.tenant_id !== null || !timestamp(data.expires_at) ||
    !Array.isArray(data.allowed_operations) ||
    JSON.stringify(data.allowed_operations) !==
      JSON.stringify(policy.operations) ||
    data.requests_per_minute !== policy.requestsPerMinute ||
    data.declared_unit_budget !== policy.declaredUnitBudget
  ) {
    return {
      ...failure(503, "credential_issuance_outcome_unknown", true),
      credentialId: id,
    };
  }
  // Project fields explicitly: the stored hash and any unexpected RPC data cannot escape.
  return {
    ok: true,
    value: {
      credential_id: id,
      principal_id: user.id,
      tenant_id: null,
      operations: policy.operations,
      expires_at: data.expires_at,
      requests_per_minute: policy.requestsPerMinute,
      declared_unit_budget: policy.declaredUnitBudget,
      unit_kind: "caller_declared_units_not_money",
      api_key: rawKey,
      display_once: true,
      transport: {
        authorization: "Bearer <public anon JWT>",
        key_header: "x-sandy-api-key",
      },
    },
  };
}
export async function revokeScopedCredential(
  db: PolicyDb,
  verifySession: SessionVerifier,
  bearer: string,
  credentialId: unknown,
): Promise<PolicyResult<Record<string, unknown>>> {
  if (!uuid(credentialId)) return failure(400, "invalid_credential_id");
  if (
    typeof bearer !== "string" ||
    !/^[-_A-Za-z0-9]+\.[-_A-Za-z0-9]+\.[-_A-Za-z0-9]+$/.test(bearer)
  ) return failure(401, "authenticated_user_session_required");
  let user: { id: string } | null;
  try {
    user = await verifySession(bearer);
  } catch {
    return failure(503, "identity_verification_unavailable");
  }
  if (!user || !uuid(user.id)) return failure(401, "invalid_identity");
  const result = await rpc(db, "sandy_api_revoke_credential", {
    p_actor_id: user.id,
    p_credential_id: credentialId.toLowerCase(),
  }, true);
  if (!result.ok) return result;
  const data = result.value;
  if (
    data.credential_id !== credentialId.toLowerCase() ||
    data.revoked !== true || typeof data.already_revoked !== "boolean"
  ) return failure(503, "credential_revocation_outcome_unknown", true);
  return {
    ok: true,
    value: {
      credential_id: data.credential_id,
      revoked: true,
      already_revoked: data.already_revoked,
    },
  };
}

export type ExecutionAdmissionInput = {
  actorId: string;
  tenantId: null;
  operation: string;
  arguments: unknown;
  requestId: string;
  credentialId?: string | null;
  contractSha256: string;
  scope: unknown;
  declaredCostUnits?: number;
  approvalId?: string | null;
};
export type ExecutionAdmission = {
  admissionId: string;
  grantId: string;
  requestId: string;
  actorId: string;
  tenantId: null;
  operation: string;
  inputSha256: string;
  contractSha256: string;
  scopeSha256: string;
  expiresAt: string;
};
export async function admitExecution(
  db: PolicyDb,
  input: ExecutionAdmissionInput,
): Promise<PolicyResult<ExecutionAdmission>> {
  if (
    !object(input) || !uuid(input.actorId) || input.tenantId !== null ||
    !operation(input.operation) || !uuid(input.requestId) ||
    !digest(input.contractSha256) ||
    !(input.credentialId == null || uuid(input.credentialId)) ||
    !(input.approvalId == null || uuid(input.approvalId)) ||
    !Number.isInteger(input.declaredCostUnits ?? 0) ||
    Number(input.declaredCostUnits ?? 0) < 0 ||
    Number(input.declaredCostUnits ?? 0) > 1000000
  ) return failure(400, "invalid_execution_admission");
  let inputSha: string, scopeSha: string;
  try {
    inputSha = await argumentDigest(input.arguments);
    scopeSha = await argumentDigest(input.scope);
  } catch {
    return failure(400, "invalid_execution_admission");
  }
  const result = await rpc(db, "sandy_api_admit_execution", {
    p_actor_id: input.actorId,
    p_tenant_id: null,
    p_operation: input.operation,
    p_input_sha256: inputSha,
    p_request_id: input.requestId,
    p_credential_id: input.credentialId ?? null,
    p_contract_sha256: input.contractSha256,
    p_scope_sha256: scopeSha,
    p_declared_cost_units: input.declaredCostUnits ?? 0,
    p_approval_id: input.approvalId ?? null,
  }, true);
  if (!result.ok) return result;
  const data = result.value;
  if (data.allowed !== true || data.reused !== false) {
    return failure(409, "admission_already_recorded");
  }
  if (
    !uuid(data.admission_id) || !uuid(data.grant_id) ||
    data.state !== "admitted" || data.executed !== false ||
    !timestamp(data.expires_at)
  ) return failure(503, "execution_admission_outcome_unknown", true);
  return {
    ok: true,
    value: {
      admissionId: data.admission_id,
      grantId: data.grant_id,
      requestId: input.requestId,
      actorId: input.actorId,
      tenantId: null,
      operation: input.operation,
      inputSha256: inputSha,
      contractSha256: input.contractSha256,
      scopeSha256: scopeSha,
      expiresAt: data.expires_at,
    },
  };
}
export async function consumeExecutionGrant(
  db: PolicyDb,
  input: ExecutionAdmission,
): Promise<PolicyResult<{ admissionId: string }>> {
  if (
    !uuid(input.grantId) || !uuid(input.admissionId) || !uuid(input.actorId) ||
    input.tenantId !== null || !operation(input.operation) ||
    !uuid(input.requestId) ||
    ![input.inputSha256, input.contractSha256, input.scopeSha256].every(digest)
  ) return failure(400, "invalid_execution_grant");
  const result = await rpc(db, "sandy_api_consume_execution_grant", {
    p_grant_id: input.grantId,
    p_actor_id: input.actorId,
    p_tenant_id: null,
    p_operation: input.operation,
    p_input_sha256: input.inputSha256,
    p_request_id: input.requestId,
    p_contract_sha256: input.contractSha256,
    p_scope_sha256: input.scopeSha256,
  }, true);
  if (!result.ok) return result;
  if (
    result.value.allowed !== true || result.value.reused !== false ||
    result.value.admission_id !== input.admissionId
  ) return failure(503, "execution_grant_outcome_unknown", true);
  return { ok: true, value: { admissionId: input.admissionId } };
}
export async function finishExecution(
  db: PolicyDb,
  admissionId: string,
  outcome: "accepted" | "succeeded" | "failed" | "unknown",
  providerHttpStatus: number | null,
  providerRequestId: string | null,
  resultDigest: string,
): Promise<
  PolicyResult<{ admissionId: string; state: string; reused: boolean }>
> {
  if (
    !uuid(admissionId) ||
    !["accepted", "succeeded", "failed", "unknown"].includes(outcome) ||
    !digest(resultDigest) ||
    !(providerHttpStatus === null ||
      (Number.isInteger(providerHttpStatus) && providerHttpStatus >= 100 &&
        providerHttpStatus <= 599)) ||
    !(providerRequestId === null ||
      (typeof providerRequestId === "string" &&
        providerRequestId.length <= 1000))
  ) return failure(400, "invalid_execution_receipt");
  const result = await rpc(db, "sandy_api_finish_execution", {
    p_admission_id: admissionId,
    p_outcome: outcome,
    p_provider_http_status: providerHttpStatus,
    p_provider_request_id: providerRequestId,
    p_result_sha256: resultDigest,
  }, true);
  if (!result.ok) return result;
  if (
    result.value.admission_id !== admissionId ||
    result.value.state !== outcome || typeof result.value.reused !== "boolean"
  ) return failure(503, "execution_receipt_outcome_unknown", true);
  return {
    ok: true,
    value: { admissionId, state: outcome, reused: result.value.reused },
  };
}

export type ExecutionReceipt = {
  ok: true;
  admission_id: string;
  request_id: string;
  operation: string;
  request_state:
    | "admitted"
    | "consumed"
    | "accepted"
    | "succeeded"
    | "failed"
    | "unknown"
    | "rejected";
  accepted: boolean;
  executed: boolean | null;
  completed: boolean;
  outcome:
    | "pending"
    | "accepted"
    | "succeeded"
    | "failed"
    | "unknown"
    | "rejected";
  provider_http_status: number | null;
  provider_request_id_sha256: string | null;
  result_sha256: string | null;
  reconciliation_required: boolean;
  redispatch_permitted: false;
  created_at: string;
  finished_at: string | null;
};
/** Read existing evidence after a lost reply. This helper never admits or dispatches work. */
export async function getExecutionReceipt(
  db: PolicyDb,
  actorId: string,
  requestId: unknown,
  credentialId: string | null = null,
): Promise<PolicyResult<ExecutionReceipt>> {
  if (
    !uuid(actorId) || !uuid(requestId) ||
    !(credentialId === null || uuid(credentialId))
  ) {
    return failure(400, "invalid_execution_receipt");
  }
  const result = await rpc(db, "sandy_api_get_execution_receipt", {
    p_actor_id: actorId,
    p_request_id: requestId,
    p_credential_id: credentialId,
  }, false);
  if (!result.ok) return result;
  const data = result.value;
  const states = [
    "admitted",
    "consumed",
    "accepted",
    "succeeded",
    "failed",
    "unknown",
    "rejected",
  ];
  if (
    !uuid(data.admission_id) || data.request_id !== requestId ||
    !operation(data.operation) ||
    !states.includes(String(data.request_state)) ||
    typeof data.request_state !== "string" ||
    data.accepted !== (data.request_state === "accepted") ||
    data.completed !== (data.request_state === "succeeded") ||
    data.reconciliation_required !==
      ["consumed", "accepted", "unknown"].includes(data.request_state) ||
    data.outcome !==
      (["admitted", "consumed"].includes(data.request_state)
        ? "pending"
        : data.request_state) ||
    data.redispatch_permitted !== false ||
    !(data.provider_http_status === null ||
      (Number.isInteger(data.provider_http_status) &&
        Number(data.provider_http_status) >= 100 &&
        Number(data.provider_http_status) <= 599)) ||
    !(data.provider_request_id_sha256 === null ||
      digest(data.provider_request_id_sha256)) ||
    !(data.result_sha256 === null || digest(data.result_sha256)) ||
    !timestamp(data.created_at) ||
    !(data.finished_at === null || timestamp(data.finished_at))
  ) {
    return failure(503, "policy_response_invalid");
  }
  const expectedExecution =
    ["admitted", "rejected"].includes(data.request_state)
      ? false
      : ["accepted", "succeeded"].includes(data.request_state) ||
          (data.request_state === "failed" &&
            data.provider_http_status !== null)
      ? true
      : null;
  if (data.executed !== expectedExecution) {
    return failure(503, "policy_response_invalid");
  }
  // Explicit projection excludes grant IDs, internal admission policy and unexpected DB fields.
  return {
    ok: true,
    value: {
      ok: true,
      admission_id: data.admission_id,
      request_id: requestId,
      operation: data.operation,
      request_state: data.request_state as ExecutionReceipt["request_state"],
      accepted: data.accepted as boolean,
      executed: data.executed as boolean | null,
      completed: data.completed as boolean,
      outcome: data.outcome as ExecutionReceipt["outcome"],
      provider_http_status: data.provider_http_status as number | null,
      provider_request_id_sha256: data.provider_request_id_sha256 as
        | string
        | null,
      result_sha256: data.result_sha256 as string | null,
      reconciliation_required: data.reconciliation_required as boolean,
      redispatch_permitted: false,
      created_at: data.created_at,
      finished_at: data.finished_at as string | null,
    },
  };
}
