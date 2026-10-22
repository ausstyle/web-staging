import { JsonRequestError, requestJson } from "../_shared/sandy_api_protocol.ts";
import { type PolicyDb, resolveApiKeyRequest } from "./access_policy.ts";
import type { CredentialResolution } from "./index.ts";

const uuid = (value: unknown): value is string =>
  typeof value === "string" &&
  /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value);
const object = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

/** Only a DB-leased job or a separately verified scoped key can supply a
 * delegated identity. Neither mode supplies a customer Auth session. */
export function createCredentialResolver(
  db: PolicyDb,
  serviceBearer: string,
  anonBearer: string,
): (request: Request, bearer: string) => Promise<CredentialResolution> {
  return async (request, bearer) => {
    const internal = new URL(request.url).pathname.replace(
      /^\/functions\/v1\/sandy-operation-api/,
      "",
    ) === "/v1/internal/execute";
    if (!internal) {
      const key = await resolveApiKeyRequest(db, request, anonBearer);
      if (key === null) return null;
      return key.ok
        ? key.value
        : { status: key.status, error: key.error };
    }
    if (
      !serviceBearer || bearer !== serviceBearer ||
      request.headers.has("x-sandy-api-key")
    ) return { status: 403, error: "internal_worker_authentication_required" };
    let body: unknown;
    try {
      body = await requestJson(request);
    } catch (error) {
      return {
        status: error instanceof JsonRequestError ? error.status : 400,
        error: error instanceof JsonRequestError
          ? error.code
          : "invalid_job_lease_request",
      };
    }
    if (
      !object(body) ||
      Object.keys(body).sort().join(",") !== "job_id,lease_token,worker_id" ||
      !uuid(body.job_id) || !uuid(body.lease_token) || !uuid(body.worker_id)
    ) return { status: 400, error: "invalid_job_lease_request" };
    let result;
    try {
      result = await db.rpc("sandy_orch_resolve_dispatch", {
        p_job_id: body.job_id,
        p_lease_token: body.lease_token,
        p_worker_id: body.worker_id,
      });
    } catch {
      return { status: 503, error: "job_dispatch_authorisation_unavailable" };
    }
    if (result.error || !object(result.data)) {
      return { status: 503, error: "job_dispatch_authorisation_unavailable" };
    }
    const value = result.data;
    if (value.ok !== true) {
      const errors: Record<string, number> = {
        invalid_or_expired_job_lease: 403,
        dispatch_already_started: 409,
        job_not_dispatchable: 409,
        execution_authorization_or_contract_changed: 403,
      };
      return typeof value.error === "string" && Object.hasOwn(errors, value.error)
        ? { status: errors[value.error], error: value.error }
        : { status: 503, error: "invalid_job_dispatch_authorisation" };
    }
    if (
      value.job_id !== body.job_id || !uuid(value.principal_id) ||
      value.tenant_id !== null || typeof value.operation !== "string" ||
      !/^[a-z][a-z0-9_.-]{2,100}$/.test(value.operation) ||
      !object(value.arguments) ||
      typeof value.input_sha256 !== "string" ||
      !/^[a-f0-9]{64}$/.test(value.input_sha256) ||
      !["api", "mcp"].includes(String(value.original_channel)) ||
      !object(value.registry_contract) ||
      value.registry_contract.operation !== value.operation ||
      !uuid(value.dispatch_id) ||
      !Number.isInteger(value.attempt) || Number(value.attempt) < 1 ||
      !Number.isFinite(Date.parse(String(value.lease_until))) ||
      Date.parse(String(value.lease_until)) <= Date.now()
    ) return { status: 503, error: "invalid_job_dispatch_authorisation" };
    return {
      kind: "job_lease",
      principalId: value.principal_id,
      allowedOperations: [value.operation],
      boundExecution: {
        operation: value.operation,
        arguments: value.arguments,
        inputDigest: value.input_sha256,
        channel: value.original_channel as "api" | "mcp",
        registryContract: value.registry_contract,
        dispatchId: value.dispatch_id,
      },
    };
  };
}
