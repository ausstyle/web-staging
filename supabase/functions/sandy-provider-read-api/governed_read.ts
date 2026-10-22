/** Versioned internal boundary for gateway-owned consumed read admissions.
 * This module never consumes/finishes a grant or creates an Auth principal.
 */
import {
  argumentDigest,
  canonicalJson,
  JsonRequestError,
  requestJson,
} from "../_shared/sandy_api_protocol.ts";
import {
  ConsumerCredentialError,
  type ConsumerExecution,
} from "../_shared/sandy_credential_consumer.ts";

type Row = Record<string, unknown>;
type Db = {
  rpc(name: string, args: Row): PromiseLike<{ data: unknown; error: unknown }>;
};
export type ProviderReadExecution = {
  protocol: "consumed-admission-v1";
  operation: string;
  arguments: Row;
  actor_id: string;
  tenant_id: null;
  request_id: string;
  grant_id: string;
  admission_id: string;
  credential_id: string | null;
};
export type GovernedProviderReadDependencies = {
  service: string;
  db: Db;
  operations: readonly string[];
  validArguments(operation: string, args: unknown): boolean;
  core(management: string): (request: Request) => Promise<Response>;
  withManagementCredential<T>(
    execution: ConsumerExecution,
    use: (token: string) => Promise<T>,
  ): Promise<T>;
};
const object = (value: unknown): value is Row =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const uuid = (value: unknown): value is string =>
  typeof value === "string" &&
  /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i
    .test(value);
const digest = (value: unknown): value is string =>
  typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
const scope = Object.freeze({
  permission_scope: "infrastructure:read",
  sandy_project_ref: "zmqlyygzqoidkcwdysok",
});
const keys = [
  "protocol",
  "operation",
  "arguments",
  "actor_id",
  "tenant_id",
  "request_id",
  "grant_id",
  "admission_id",
  "credential_id",
];
const refused = (status: number, error: string) =>
  Response.json({ ok: false, error, executed: false }, {
    status,
    headers: {
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    },
  });
export function createGovernedProviderReadHandler(
  deps: GovernedProviderReadDependencies,
) {
  const operations = new Set(deps.operations);
  return async (request: Request): Promise<Response> => {
    if (request.method !== "POST") return refused(405, "method_not_allowed");
    if (
      !deps.service ||
      request.headers.get("authorization") !== `Bearer ${deps.service}` ||
      request.headers.has("x-sandy-api-key")
    ) return refused(403, "service_authorization_required");
    let body: unknown;
    try {
      body = await requestJson(request, 65536);
    } catch (error) {
      return refused(
        error instanceof JsonRequestError ? error.status : 400,
        error instanceof JsonRequestError ? error.code : "invalid_request",
      );
    }
    if (
      !object(body) || Object.keys(body).length !== keys.length ||
      Object.keys(body).some((key) => !keys.includes(key)) ||
      body.protocol !== "consumed-admission-v1" ||
      typeof body.operation !== "string" || !operations.has(body.operation)
    ) return refused(400, "consumed_provider_read_context_required");
    if (
      !uuid(body.actor_id) || body.tenant_id !== null ||
      !uuid(body.request_id) || !uuid(body.grant_id) ||
      !uuid(body.admission_id) ||
      body.credential_id !== null && !uuid(body.credential_id) ||
      !object(body.arguments) ||
      !deps.validArguments(body.operation, body.arguments)
    ) return refused(400, "invalid_provider_read_context");
    const context = body as ProviderReadExecution;
    let inputSha: string;
    let scopeSha: string;
    let canonical: string;
    try {
      canonical = canonicalJson(context.arguments);
      inputSha = await argumentDigest(context.arguments);
      scopeSha = await argumentDigest(scope);
    } catch {
      return refused(400, "invalid_provider_read_arguments");
    }
    let authorized: unknown;
    try {
      const result = await deps.db.rpc("sandy_provider_read_authorize", {
        p: {
          ...context,
          arguments_canonical: canonical,
          input_sha256: inputSha,
          scope_sha256: scopeSha,
        },
      });
      if (result.error) return refused(503, "provider_read_policy_unavailable");
      authorized = result.data;
    } catch {
      return refused(503, "provider_read_policy_unavailable");
    }
    if (!object(authorized) || authorized.ok !== true) {
      const error =
        object(authorized) && typeof authorized.error === "string" &&
          /^provider_read_[a-z_]{2,80}$/.test(authorized.error)
          ? authorized.error
          : "provider_read_context_refused";
      const status = object(authorized) &&
          [400, 403, 409, 424].includes(Number(authorized.http_status))
        ? Number(authorized.http_status)
        : 503;
      return refused(status, error);
    }
    if (
      authorized.actor_id !== context.actor_id ||
      authorized.admission_id !== context.admission_id ||
      authorized.request_id !== context.request_id ||
      authorized.operation !== context.operation ||
      authorized.input_sha256 !== inputSha ||
      authorized.scope_sha256 !== scopeSha ||
      !digest(authorized.registry_revision_sha256)
    ) return refused(503, "provider_read_policy_response_invalid");
    try {
      return await deps.withManagementCredential({
        actorId: context.actor_id,
        admissionId: context.admission_id,
        operation: context.operation,
      }, async (token) => {
        if (!token) throw new Error("provider_read_credential_unavailable");
        return await deps.core(token)(
          new Request(request.url, {
            method: "POST",
            headers: {
              authorization: `Bearer ${deps.service}`,
              "content-type": "application/json",
            },
            body: JSON.stringify({
              operation: context.operation,
              arguments: context.arguments,
            }),
          }),
        );
      });
    } catch (error) {
      if (error instanceof ConsumerCredentialError) {
        if (error.requestMayHaveExecuted) {
          return Response.json({
            ok: false,
            error: error.code,
            executed: null,
            reconciliation_required: true,
          }, {
            status: error.status,
            headers: { "cache-control": "no-store" },
          });
        }
        return refused(error.status, error.code);
      }
      return refused(503, "provider_read_credential_unavailable");
    }
  };
}
