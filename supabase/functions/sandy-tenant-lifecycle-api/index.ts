import { approvedOwnerContract } from "../_shared/sandy_approval_contract.ts";
/** Administrative SQL boundary for a fixed, partial tenant manifest. The
 * encrypted artifact remains inside PostgreSQL/Vault; no customer session or
 * arbitrary SQL/provider transport is manufactured by this executor. */
import { Ajv } from "npm:ajv@8.17.1";
import { fullFormats } from "npm:ajv-formats@3.0.1/dist/formats.js";
import { createClient } from "npm:@supabase/supabase-js@2.57.4";
import {
  argumentDigest,
  canonicalJson,
  JsonRequestError,
  requestJson,
} from "../_shared/sandy_api_protocol.ts";
import { type JsonObject, tenantLifecycleHandler } from "./contracts.ts";
import {
  tenantLifecycleExecutionScope,
  tenantLifecycleOperations,
} from "./gateway.ts";
import {
  executeProtectedInventoryRpc,
  protectedInventoryOperationName,
  protectedInventoryRpcName,
} from "./protected_inventory.ts";
import {
  contentExportOperations,
  contentExportRpcName,
} from "./content_contracts.ts";
import { supportRecoveryOperations } from "./support_recovery_contracts.ts";
import {
  financialExportOperations,
  financialExportRpcName,
} from "./financial_contracts.ts";
import {
  financialRedactionOperations,
  financialRedactionResultMatches,
  financialRedactionRpcName,
} from "./financial_redaction_contracts.ts";
export type Operation = {
  operation: string;
  is_mutation: boolean;
  contract_sha256: string;
  manifest_sha256?: string;
  schema_sha256?: string;
  input_schema: JsonObject;
  result_schema: JsonObject;
};
export type ExecutionContext = {
  actor_id: string;
  tenant_id: null;
  request_id: string;
  grant_id: string;
  admission_id?: string;
  credential_id?: null;
};
export type PolicyResult = {
  allowed: boolean;
  reused?: boolean;
  admission_id?: string;
  error?: string;
  http_status?: number;
};
export type GrantRequest = ExecutionContext & {
  operation: string;
  input_sha256: string;
  contract_sha256: string;
  scope_sha256: string;
};
export type FinishRequest = {
  admission_id: string;
  outcome: "accepted" | "succeeded" | "failed" | "unknown";
  provider_http_status: number | null;
  provider_request_id: string | null;
  result_sha256: string;
};
export type RpcResult = {
  data: unknown;
  error: unknown;
  status: number;
  request_id?: string | null;
};
export type Dependencies = {
  service: string;
  projectUrl: string;
  authorizeContext(
    context: ExecutionContext,
    operation: Operation,
  ): Promise<PolicyResult>;
  consumeGrant(request: GrantRequest): Promise<PolicyResult>;
  finishExecution(request: FinishRequest): Promise<PolicyResult>;
  rpc(
    name:
      | "sandy_tenant_lifecycle_execute"
      | typeof protectedInventoryRpcName
      | typeof contentExportRpcName
      | typeof financialRedactionRpcName,
    args: JsonObject,
  ): Promise<RpcResult>;
};
const projectUrl = "https://zmqlyygzqoidkcwdysok.supabase.co";
const operations = tenantLifecycleOperations as Readonly<
  Record<string, Operation>
>;
const object = (value: unknown): value is JsonObject =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const uuid = (value: unknown): value is string =>
  typeof value === "string" &&
  /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value);
const httpStatus = (value: unknown): value is number =>
  Number.isInteger(value) && Number(value) >= 100 && Number(value) <= 599;
const providerRequestId = (value: unknown): string | null =>
  typeof value === "string" && /^[A-Za-z0-9_.:/-]{1,200}$/.test(value)
    ? value
    : null;
const ajv = new Ajv({
  strict: true,
  strictTypes: false,
  allowUnionTypes: true,
});
for (const [name, format] of Object.entries(fullFormats)) {
  ajv.addFormat(name, format);
}
const validators = new Map(
  Object.values(operations).map(
    (operation) => [operation.operation, {
      input: ajv.compile(operation.input_schema),
      result: ajv.compile(operation.result_schema),
    }],
  ),
);
export function validateTenantLifecycleContracts(): number {
  return validators.size;
}
const response = (status: number, body: JsonObject) =>
  Response.json(body, {
    status,
    headers: {
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    },
  });
const refusal = (status: number, error: string) =>
  response(status, { ok: false, error, executed: false });
const policyErrors = new Set([
  "owner_required",
  "execution_policy_unavailable",
  "verified_execution_contract_required",
  "execution_contract_not_enabled",
  "execution_grant_scope_denied",
  "execution_grant_used_or_expired",
  "execution_contract_changed",
  "execution_credential_revoked_or_expired",
  "mutation_approval_changed",
  "invalid_execution_admission",
  "invalid_execution_receipt",
  "scoped_mutation_approval_required",
  "mutation_requires_verified_auth_approval",
  "execution_scope_denied",
]);
function policyRefusal(result: PolicyResult, defaultStatus = 403): Response {
  const known = typeof result.error === "string" &&
    policyErrors.has(result.error);
  return refusal(
    known &&
      [400, 401, 403, 409, 422, 424, 429, 503].includes(
        Number(result.http_status),
      )
      ? Number(result.http_status)
      : known
      ? defaultStatus
      : 503,
    known ? result.error! : "execution_policy_unavailable",
  );
}
/** The common finish RPC returns ok/state/reused, not an allowed field. */
export function normalizeTenantLifecycleFinish(
  request: FinishRequest,
  value: unknown,
): PolicyResult {
  return object(value) && value.ok === true &&
      value.admission_id === request.admission_id &&
      value.state === request.outcome && typeof value.reused === "boolean"
    ? {
      allowed: true,
      admission_id: request.admission_id,
      reused: value.reused,
    }
    : {
      allowed: false,
      error: "execution_receipt_state_unknown",
      http_status: 503,
    };
}
function resultMatchesRequest(
  operation: Operation,
  args: JsonObject,
  result: JsonObject,
): boolean {
  if (Object.hasOwn(financialRedactionOperations, operation.operation)) {
    return financialRedactionResultMatches(operation.operation, args, result);
  }
  if (operation.operation === protectedInventoryOperationName) {
    return result.tenant_id === args.tenant_id &&
      result.offset === args.offset && result.limit === args.limit;
  }
  if (
    Object.hasOwn(supportRecoveryOperations, operation.operation) &&
    result.case_id !== args.case_id
  ) return false;
  if (
    result.tenant_id !== args.tenant_id ||
    result.manifest_sha256 !== operation.manifest_sha256 ||
    result.schema_sha256 !== operation.schema_sha256
  ) return false;
  if (
    args.snapshot_id !== undefined && result.snapshot_id !== args.snapshot_id
  ) return false;
  if (
    args.expected_manifest_sha256 !== undefined &&
    result.manifest_sha256 !== args.expected_manifest_sha256
  ) return false;
  if (
    args.expected_current_sha256 !== undefined &&
    result.before_sha256 !== args.expected_current_sha256
  ) return false;
  const state: Record<string, string> = {
    "supabase.tenant.export": "exported",
    "supabase.tenant.erase": "erased",
    "supabase.tenant.restore": "restored",
    "supabase.tenant.exports.purge": "purged",
    "supabase.tenant.manifests.export": "exported",
    "supabase.tenant.manifests.erase": "erased",
    "supabase.tenant.manifests.restore": "restored",
    "supabase.tenant.manifests.exports.purge": "purged",
    "supabase.tenant.content.export": "exported",
    "supabase.tenant.content.exports.purge": "purged",
    "supabase.tenant.financial.export": "exported",
    "supabase.tenant.financial.exports.purge": "purged",
    "supabase.tenant.support.snapshot": "exported",
    "supabase.tenant.support.erase": "erased",
    "supabase.tenant.support.restore": "restored",
    "supabase.tenant.support.snapshots.purge": "purged",
  };
  return !state[operation.operation] ||
    result.state === state[operation.operation];
}
export function createTenantLifecycleHandler(deps: Dependencies) {
  return async (request: Request): Promise<Response> => {
    if (request.method !== "POST") return refusal(405, "method_not_allowed");
    if (
      !deps.service ||
      request.headers.get("authorization") !== "Bearer " + deps.service
    ) return refusal(401, "internal_service_identity_required");
    if (deps.projectUrl !== projectUrl) {
      return refusal(503, "fixed_project_configuration_mismatch");
    }
    let body: unknown;
    try {
      body = await requestJson(request, 196608);
    } catch (error) {
      return refusal(
        error instanceof JsonRequestError ? error.status : 400,
        "invalid_request",
      );
    }
    if (
      !object(body) || !Object.keys(body).every((key) =>
        [
          "operation",
          "arguments",
          "actor_id",
          "tenant_id",
          "request_id",
          "grant_id",
          "admission_id",
          "credential_id",
        ].includes(key)
      )
    ) return refusal(400, "invalid_execution_context");
    const operation = typeof body.operation === "string"
      ? operations[body.operation]
      : undefined;
    if (!operation) return refusal(404, "operation_not_implemented");
    if (
      !uuid(body.actor_id) || body.tenant_id !== null ||
      !uuid(body.request_id) || !uuid(body.grant_id) ||
      (body.admission_id !== undefined && !uuid(body.admission_id)) ||
      (body.credential_id !== undefined && body.credential_id !== null)
    ) return refusal(400, "invalid_execution_context");
    const args = body.arguments;
    if (!object(args) || !validators.get(operation.operation)!.input(args)) {
      return refusal(400, "invalid_arguments");
    }
    const context: ExecutionContext = {
      actor_id: body.actor_id,
      tenant_id: null,
      request_id: body.request_id,
      grant_id: body.grant_id,
      ...(body.admission_id ? { admission_id: String(body.admission_id) } : {}),
      ...(body.credential_id === null ? { credential_id: null } : {}),
    };
    let authorized: PolicyResult;
    try {
      authorized = await deps.authorizeContext(context, operation);
    } catch {
      return refusal(503, "execution_policy_unavailable");
    }
    if (authorized.allowed !== true) return policyRefusal(authorized);
    let consumed: PolicyResult;
    try {
      consumed = await deps.consumeGrant({
        ...context,
        operation: operation.operation,
        input_sha256: await argumentDigest(args),
        contract_sha256: operation.contract_sha256,
        scope_sha256: await argumentDigest(
          tenantLifecycleExecutionScope(operation.operation),
        ),
      });
    } catch {
      return refusal(503, "execution_policy_unavailable");
    }
    if (consumed.allowed !== true) return policyRefusal(consumed);
    if (consumed.reused !== false || !uuid(consumed.admission_id)) {
      return refusal(409, "execution_grant_used_or_expired");
    }
    const admission = consumed.admission_id;
    let status: number | null = null, requestId: string | null = null;
    const finish = async (
      outcome: FinishRequest["outcome"],
      value: unknown,
    ): Promise<boolean> => {
      try {
        return (await deps.finishExecution({
          admission_id: admission,
          outcome,
          provider_http_status: status,
          provider_request_id: requestId,
          result_sha256: await argumentDigest(value),
        })).allowed === true;
      } catch {
        return false;
      }
    };
    if (context.admission_id && context.admission_id !== admission) {
      const recorded = await finish("failed", {
        error: "execution_admission_mismatch",
      });
      return response(recorded ? 409 : 503, {
        ok: false,
        error: recorded
          ? "execution_admission_mismatch"
          : "execution_receipt_state_unknown",
        executed: false,
        admission_id: admission,
        ...(!recorded ? { reconciliation_required: true } : {}),
      });
    }
    let reply: RpcResult;
    try {
      const parameters = {
        p_actor: context.actor_id,
        p_admission: admission,
        p_canonical: canonicalJson(args),
      };
      reply = operation.operation === protectedInventoryOperationName
        ? await executeProtectedInventoryRpc({
          rpc: (name, params) => deps.rpc(name, params),
        }, parameters)
        : await deps.rpc(
          Object.hasOwn(financialRedactionOperations, operation.operation)
            ? financialRedactionRpcName
            : Object.hasOwn(financialExportOperations, operation.operation)
            ? financialExportRpcName
            : Object.hasOwn(contentExportOperations, operation.operation)
            ? contentExportRpcName
            : "sandy_tenant_lifecycle_execute",
          parameters,
        );
    } catch {
      const outcome = operation.is_mutation ? "unknown" : "failed",
        recorded = await finish(outcome, {
          error: "tenant_lifecycle_transport_outcome_unknown",
        });
      return response(503, {
        ok: false,
        error: recorded
          ? "tenant_lifecycle_transport_outcome_unknown"
          : "execution_receipt_state_unknown",
        executed: operation.is_mutation ? null : true,
        operation: operation.operation,
        admission_id: admission,
        request_state: outcome,
        reconciliation_required: operation.is_mutation || !recorded,
      });
    }
    status = httpStatus(reply.status) ? reply.status : null;
    requestId = providerRequestId(reply.request_id);
    const envelope = reply.data;
    const successful = status !== null && status >= 200 && status <= 299 &&
      !reply.error && object(envelope) && envelope.ok === true &&
      typeof envelope.reused === "boolean" && object(envelope.result);
    if (!successful) {
      // A received PostgreSQL RPC error is an atomic rollback; loss of transport
      // or a success-shaped but unproven response leaves a mutation uncertain.
      const knownRollback = object(reply.error) &&
        typeof reply.error.code === "string" &&
        /^[0-9A-Z]{5}$/.test(reply.error.code) && status !== null &&
        [400, 401, 403, 404, 409, 422].includes(status);
      const unknown = operation.is_mutation && !knownRollback;
      const outcome = unknown ? "unknown" : "failed",
        recorded = await finish(outcome, {
          error: "tenant_lifecycle_execution_failed",
        });
      return response(recorded ? (knownRollback ? 403 : 502) : 503, {
        ok: false,
        error: recorded
          ? "tenant_lifecycle_execution_failed"
          : "execution_receipt_state_unknown",
        executed: knownRollback ? false : unknown ? null : true,
        operation: operation.operation,
        admission_id: admission,
        request_state: outcome,
        reconciliation_required: unknown || !recorded,
      });
    }
    const result = envelope.result as JsonObject;
    if (
      !validators.get(operation.operation)!.result(result) ||
      !resultMatchesRequest(operation, args, result)
    ) {
      const outcome = operation.is_mutation ? "unknown" : "failed",
        recorded = await finish(outcome, {
          error: "tenant_lifecycle_result_invalid",
        });
      return response(recorded ? 502 : 503, {
        ok: false,
        error: recorded
          ? "tenant_lifecycle_result_invalid"
          : "execution_receipt_state_unknown",
        executed: operation.is_mutation ? null : true,
        operation: operation.operation,
        admission_id: admission,
        request_state: outcome,
        reconciliation_required: operation.is_mutation || !recorded,
      });
    }
    const recorded = await finish(
      operation.is_mutation ? "accepted" : "succeeded",
      result,
    );
    if (!recorded) {
      return response(503, {
        ok: false,
        error: "execution_receipt_state_unknown",
        executed: true,
        operation: operation.operation,
        admission_id: admission,
        reconciliation_required: true,
      });
    }
    return response(200, {
      ok: true,
      operation: operation.operation,
      contract_version: "1.0.0",
      executed: true,
      request_state: operation.is_mutation ? "accepted" : "observed",
      admission_id: admission,
      result,
    });
  };
}
/** Per-request client: no session persistence, redirects or credential fallback. */
export function runtimeHandler(request: Request): Promise<Response> {
  const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    configuredUrl = Deno.env.get("SUPABASE_URL") ?? "";
  if (!service || configuredUrl !== projectUrl) {
    return Promise.resolve(
      refusal(503, "fixed_project_configuration_mismatch"),
    );
  }
  const client = createClient(projectUrl, service, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: {
      fetch: (input, init) =>
        fetch(input, {
          ...init,
          redirect: "error",
          signal: AbortSignal.timeout(20000),
        }),
    },
  });
  return createTenantLifecycleHandler({
    service,
    projectUrl,
    authorizeContext: async (context, operation) => {
      const [owner, registry] = await Promise.all([
        client.from("sandy_controller_admins").select("auth_user_id").eq(
          "auth_user_id",
          context.actor_id,
        ).eq("role", "owner").eq("enabled", true).maybeSingle(),
        client.from("sandy_operation_registry").select(
          "handler,api_exposed,verified,is_mutation,error_contract",
        ).eq("operation", operation.operation).maybeSingle(),
      ]);
      if (owner.error || registry.error) {
        return {
          allowed: false,
          error: "execution_policy_unavailable",
          http_status: 503,
        };
      }
      const entry = registry.data;
      return owner.data &&
          approvedOwnerContract(entry, {
            handler: tenantLifecycleHandler,
            is_mutation: operation.is_mutation,
            contract_sha256: operation.contract_sha256,
          })
        ? { allowed: true }
        : {
          allowed: false,
          error: "verified_execution_contract_required",
          http_status: 424,
        };
    },
    consumeGrant: async (input) => {
      const { data, error, status } = await client.rpc(
        "sandy_api_consume_execution_grant",
        {
          p_grant_id: input.grant_id,
          p_actor_id: input.actor_id,
          p_tenant_id: input.tenant_id,
          p_operation: input.operation,
          p_input_sha256: input.input_sha256,
          p_request_id: input.request_id,
          p_contract_sha256: input.contract_sha256,
          p_scope_sha256: input.scope_sha256,
        },
      );
      if (error || status < 200 || status > 299 || !object(data)) {
        return {
          allowed: false,
          error: "execution_policy_unavailable",
          http_status: 503,
        };
      }
      return data as PolicyResult;
    },
    finishExecution: async (input) => {
      const { data, error, status } = await client.rpc(
        "sandy_api_finish_execution",
        {
          p_admission_id: input.admission_id,
          p_outcome: input.outcome,
          p_provider_http_status: input.provider_http_status,
          p_provider_request_id: input.provider_request_id,
          p_result_sha256: input.result_sha256,
        },
      );
      return error || status < 200 || status > 299
        ? {
          allowed: false,
          error: "execution_receipt_state_unknown",
          http_status: 503,
        }
        : normalizeTenantLifecycleFinish(input, data);
    },
    rpc: async (name, args) => {
      const { data, error, status } = await client.rpc(name, args);
      return { data, error, status };
    },
  })(request);
}
if (import.meta.main) Deno.serve(runtimeHandler);
