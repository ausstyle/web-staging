import {
  engineeringProofFor,
  engineeringRequest,
  engineeringTagged,
} from "./engineering_identity.ts";
import {
  createClient,
  type SupabaseClient,
} from "npm:@supabase/supabase-js@2.57.0";
import { createRegistrySchemaValidator } from "./registry_schema_validator.ts";
import { cataloguePage } from "../_shared/sandy_catalogue_page.ts";
import { operationRequestPath } from "./request_path.ts";
import { requestReadJobRetry } from "./retry_read_job.ts";
import { createCredentialResolver } from "./gateway_credentials.ts";
import { governedExecution } from "./governed_execution.ts";
import { readVerifiedExecution } from "../_shared/sandy_execution_receipt_transport.ts";
import {
  admittedCustomerReads,
  governedCustomerRead,
} from "./customer_read_admission.ts";
import { parseApiJobRoute, resolveApiJobRoute } from "./api_job_routes.ts";
import {
  buildCustomerKeyReadRequest,
  type CustomerKeyPrincipal,
  getCustomerKeyReceipt,
  governedCustomerKeyExecution,
  resolveCustomerKeyRequest,
} from "./customer_key_principal.ts";
import type { ExecutionAdmission } from "./access_policy.ts";
import {
  executePolicyOperation,
  isPolicyOperation,
  policyContractMatches,
  policyOperationContracts,
  requiresPolicyUserJWT,
} from "./policy_operations.ts";
import {
  inspectEngineeringMcp,
  MCP_DISCOVERY_OPERATION,
  mcpDiscoveryContract,
} from "./mcp_diagnostics.ts";
import {
  customerServiceContractMatches,
  customerServiceContracts,
  customerServiceGrant,
  executeCustomerService,
  hasCustomerServiceGrant,
  isCustomerServiceOperation,
} from "./customer_services.ts";
import {
  type ProviderConfig,
  providerExecutionScope as baselineProviderExecutionScope,
  providerOperations as baselineProviderOperations,
} from "../sandy-provider-operation-api/gateway.ts";
import {
  expandedProviderExecutionScope,
  providerExpansionOperations,
} from "../sandy-provider-operation-api/expansion_gateway.ts";
import { parseProviderBindings } from "../sandy-provider-operation-api/configured_scopes.ts";
import {
  customerMutationContracts,
  executeCustomerMutation,
  isCustomerMutationOperation,
} from "./customer_mutations.ts";
import {
  executeUserExtension,
  extensionAvailability,
  extensionContractMatches,
  extensionContracts,
  extensionExecutionScope,
  extensionHandlers,
  extensionHasAccess,
  extensionKind,
  extensionNeedsAgenda,
  extensionNeedsPortal,
  extensionOwnerOnly,
  extensionOwnsGrant,
  extensionOwnsUserAdmission,
  extensionRequiresUserSession,
  parsePackageRestoreBindings,
  type ScopeBinding,
  type TenantConsentDb,
} from "./installed_extensions.ts";
import {
  captureLifecyclePreimage,
  executeProviderLifecycle,
  isProviderLifecycleOperation,
  type LifecycleContext,
} from "./provider_lifecycle.ts";
import {
  customerContractMatches,
  customerOperationContracts,
  executeCustomerOperation,
  isCustomerOperation,
  requiresCustomerOwner,
} from "./customer_operations.ts";
import {
  executeLegacyOperation,
  isLegacyOperation,
  legacyContractMatches,
  legacyOperationContracts,
  requiresLegacyUserJWT,
} from "./legacy_operations.ts";
import {
  handleOrchestrationAction,
  isOrchestrationOperation,
  orchestrationActions,
  requestLegacyDeploymentJob,
} from "../sandy-orchestration-api/index.ts";
import { orchestrationContracts } from "../sandy-orchestration-api/contracts.ts";
import {
  argumentDigest,
  canonicalJson,
  JsonRequestError,
  requestJson,
} from "../_shared/sandy_api_protocol.ts";
const providerOperations = Object.freeze({
  ...baselineProviderOperations,
  ...providerExpansionOperations,
});
function providerExecutionScope(operation: string, config?: ProviderConfig) {
  return providerExpansionOperations[operation]
    ? expandedProviderExecutionScope(operation, config)
    : baselineProviderExecutionScope(operation, config);
}
export type DelegatedIdentity = {
  kind: "api_key" | "job_lease";
  principalId: string;
  allowedOperations: readonly string[];
  credentialId?: string;
  boundExecution?: {
    operation: string;
    arguments: Record<string, unknown>;
    inputDigest: string;
    channel: "api" | "mcp";
    registryContract?: Record<string, unknown>;
    dispatchId?: string;
  };
};
export type CredentialResolution = DelegatedIdentity | {
  status: number;
  error: string;
} | null;
import {
  buildEngineeringReadRequest,
  engineeringReadActions,
  engineeringReadTransportFailure,
  isEngineeringReadOperation,
  normalizeEngineeringReadResponse,
} from "./engineering_read.ts";

/**
 * Sandy API owns discovery, permissions and dispatch. Registry metadata alone
 * never enables an executor or certifies a production deployment.
 */
export type OperationDependencies = {
  base: string;
  service: string;
  anon: string;
  db: Pick<SupabaseClient, "auth" | "from" | "rpc">;
  fetch?: typeof fetch;
  executionPolicy?: boolean;
  catalogueRpc?: boolean;
  providerConfig?: ProviderConfig;
  packageRestoreBindings?: ScopeBinding[];
  authenticatedDb?: (userJWT: string) => TenantConsentDb;
  resolveCredential?: (
    request: Request,
    bearer: string,
  ) => Promise<CredentialResolution>;
};
const reply = (status: number, data: unknown) =>
  Response.json(data, {
    status,
    headers: {
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    },
  });
const infrastructureOperations = [
  "supabase.functions.list",
  "supabase.functions.get",
  "supabase.project.status",
  "system.registry.list",
  "system.registry.describe",
  "system.registry.summary",
  "deployment.jobs.get",
  "deployment.jobs.list",
  "deployment.jobs.events",
  "deployment.audit.list",
  "engineering.changes.list",
  "engineering.change.detail",
  "engineering.change.events",
  "engineering.change.tests",
  "engineering.change.artifacts",
] as const;
const providerReadOperations = [
  "supabase.db.migrations.list",
  "supabase.database.inspect",
  "supabase.schema.tables.list",
  "supabase.schema.functions.list",
  "supabase.schema.indexes.list",
  "supabase.database.connections.list",
  "supabase.schema.views.list",
  "supabase.schema.materialized_views.list",
  "supabase.schema.triggers.list",
  "supabase.schema.constraints.list",
  "supabase.schema.types.list",
  "supabase.schema.extensions.list",
  "supabase.database.roles.list",
  "supabase.database.grants.list",
  "supabase.database.default_privileges.list",
  "supabase.database.rls.policies.list",
  "supabase.database.locks.list",
  "supabase.database.cron.jobs.list",
  "supabase.projects.get",
  "supabase.project.health",
  "supabase.branches.list",
  "supabase.branches.get",
  "supabase.network.restrictions.get",
  "supabase.domains.get",
  "supabase.functions.secrets.list",
  "supabase.backups.list",
] as const;
const customerReadOperations = [
  "tasks.list",
  "tasks.get",
  "calendar.list",
  "calendar.get",
  "calendar.conflicts",
  "files.list",
  "files.get",
  "files.search",
] as const;
const isCustomerRead = (operation: string) =>
  customerReadOperations.includes(
    operation as typeof customerReadOperations[number],
  );
// Only passive portal reads belong here. The backend's ask action can create
// tasks; search/biography actions invoke paid models and need separate contracts.
const memoryReadActions: Readonly<Record<string, string>> = Object.freeze({
  "memory.overview": "overview",
  "memory.tree": "memory_tree",
  "memory.evidence": "evidence",
  "memory.life_brief": "life_brief",
  "memory.life_spaces": "life_spaces",
});
const isMemoryRead = (operation: string) =>
  Object.hasOwn(memoryReadActions, operation);
const videoReadActions: Readonly<Record<string, string>> = Object.freeze({
  "video.status": "video_status",
  "video.install.preflight": "video_install_preflight",
  "video.execution.preflight": "video_execution_preflight",
});
// This is an installed executor map, not a second schema or discovery catalogue.
// Existing registry contracts and exposure flags remain authoritative.
const allowedHandlers: Readonly<
  Record<string, { functionName: string; action?: string }>
> = Object.freeze({
  ...extensionHandlers,
  ...Object.fromEntries(
    Object.entries(customerMutationContracts).map(
      (
        [operation, contract],
      ) => [operation, { functionName: contract.handler }],
    ),
  ),
  ...Object.fromEntries(
    Object.keys(providerOperations).map(
      (
        operation,
      ) => [operation, { functionName: "sandy-provider-operation-api" }],
    ),
  ),
  ...Object.fromEntries(
    Object.entries(customerServiceContracts).map(
      (
        [operation, contract],
      ) => [operation, {
        functionName: contract.handler,
        action: contract.action,
      }],
    ),
  ),
  ...Object.fromEntries(
    Object.entries(policyOperationContracts).map(
      ([operation]) => [operation, { functionName: "sandy-operation-api" }],
    ),
  ),
  [MCP_DISCOVERY_OPERATION]: { functionName: "sandy-operation-api" },
  ...Object.fromEntries(
    Object.entries(customerOperationContracts).map(
      (
        [operation, contract],
      ) => [operation, {
        functionName: contract.handler,
        action: contract.action,
      }],
    ),
  ),
  ...Object.fromEntries(
    Object.entries(legacyOperationContracts).map(
      (
        [operation, contract],
      ) => [operation, {
        functionName: contract.handler,
        action: contract.action,
      }],
    ),
  ),
  ...Object.fromEntries(
    Object.entries(orchestrationActions).map(
      (
        [operation, action],
      ) => [operation, { functionName: "sandy-orchestration-api", action }],
    ),
  ),
  "deployment.jobs.request": {
    functionName: "sandy-orchestration-api",
    action: "legacy_job_request",
  },
  ...Object.fromEntries(
    Object.entries(engineeringReadActions).map((
      [operation, action],
    ) => [operation, { functionName: "sandy-engineering-control", action }]),
  ),
  "deployment.jobs.retry": {
    functionName: "sandy-operation-api",
    action: "retry_read_job",
  },
  "deployment.jobs.cancel": {
    functionName: "sandy-operation-api",
    action: "cancel_pending_job",
  },
  ...Object.fromEntries(
    Object.entries(videoReadActions).map(([operation, action]) => [operation, {
      functionName: "sandy-deploy-provision",
      action,
    }]),
  ),
  ...Object.fromEntries(customerReadOperations.map((operation) => [operation, {
    functionName: "sandy-operations-api",
  }])),
  ...Object.fromEntries(
    Object.entries(memoryReadActions).map(([operation, action]) => [operation, {
      functionName: "sandy-memory-centre",
      action,
    }]),
  ),
  ...Object.fromEntries(providerReadOperations.map((operation) => [operation, {
    functionName: "sandy-provider-read-api",
  }])),
  ...Object.fromEntries(
    infrastructureOperations.map((operation) => [operation, {
      functionName: "sandy-infrastructure-read",
    }]),
  ),
  "engineering.preflight": {
    functionName: "sandy-engineering-control",
    action: "preflight",
  },
  "deployment.management.release": {
    functionName: "sandy-deployment-api",
    action: "engineering_release",
  },
});
export const installedOperationIds: readonly string[] = Object.freeze(
  Object.keys(allowedHandlers).sort(),
);
const schemaValid = createRegistrySchemaValidator().isValid;
const registryColumns =
  "operation,domain,permission_scope,is_mutation,input_schema,output_schema,handler,api_exposed,ai_exposed,verified,last_verified_at,error_contract";
function validOperation(value: unknown): value is string {
  return typeof value === "string" && /^[a-z][a-z0-9_.-]{2,100}$/.test(value);
}
function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
async function executionContractDigest(
  entry: Record<string, unknown>,
): Promise<string> {
  const configured = isObject(entry.error_contract)
    ? entry.error_contract.contract_sha256
    : null;
  return typeof configured === "string" && /^[a-f0-9]{64}$/.test(configured)
    ? configured
    : await argumentDigest(Object.fromEntries([
      "operation",
      "handler",
      "permission_scope",
      "is_mutation",
      "input_schema",
      "output_schema",
      "api_exposed",
      "ai_exposed",
      "verified",
    ].map((key) => [key, entry[key]])));
}
function enabledEntry(
  entry: unknown,
): entry is Record<string, unknown> & {
  operation: keyof typeof allowedHandlers;
} {
  // API exposure and AI exposure are independent. MCP applies its own discovery
  // filter and every channel:mcp execution checks the registry's AI flag below.
  return isObject(entry) && typeof entry.operation === "string" &&
    Object.hasOwn(allowedHandlers, entry.operation) &&
    (entry.handler === "sandy-operation-api" ||
      entry.handler === allowedHandlers[entry.operation].functionName) &&
    entry.api_exposed === true;
}
// Discovery must not advertise a malformed read contract that dispatch refuses.
function discoverableContract(entry: Record<string, unknown>): boolean {
  const operation = String(entry.operation);
  if (extensionKind(operation)) {
    return extensionContractMatches(operation, entry);
  }
  if (isCustomerMutationOperation(operation)) {
    const c = customerMutationContracts[operation];
    return entry.handler === c.handler && entry.is_mutation === true &&
      entry.permission_scope === c.permission_scope;
  }
  const provider = providerOperations[operation];
  if (provider) {
    return entry.handler === "sandy-provider-operation-api" &&
      entry.is_mutation === provider.is_mutation &&
      entry.permission_scope === provider.permission_scope &&
      isObject(entry.error_contract) &&
      entry.error_contract.contract_sha256 === provider.contract_sha256;
  }
  if (isCustomerServiceOperation(operation)) {
    return customerServiceContractMatches(operation, entry);
  }
  if (isPolicyOperation(operation)) {
    return policyContractMatches(operation, entry);
  }
  if (operation === MCP_DISCOVERY_OPERATION) {
    return entry.handler === "sandy-operation-api" &&
      entry.is_mutation === false &&
      entry.permission_scope === "infrastructure:read";
  }
  if (isCustomerOperation(operation)) {
    return customerContractMatches(operation, entry);
  }
  if (isLegacyOperation(operation)) {
    return legacyContractMatches(operation, entry);
  }
  if (isOrchestrationOperation(operation)) {
    const contract = orchestrationContracts.find((item) =>
      item.operation === operation
    );
    return !!contract && entry.handler === "sandy-orchestration-api" &&
      entry.is_mutation === contract.is_mutation &&
      entry.permission_scope ===
        (contract.is_mutation ? "orchestration:write" : "orchestration:read");
  }
  if (operation === "deployment.jobs.request") {
    return entry.handler === "sandy-orchestration-api" &&
      entry.is_mutation === true &&
      entry.permission_scope === "deployment:write";
  }
  if (Object.hasOwn(videoReadActions, operation)) {
    return entry.handler === "sandy-deploy-provision" &&
      entry.is_mutation === false &&
      entry.permission_scope === "infrastructure:read";
  }
  if (isEngineeringReadOperation(operation)) {
    return entry.handler === "sandy-engineering-control" &&
      entry.is_mutation === false &&
      entry.permission_scope === "engineering:read";
  }
  if (isCustomerRead(operation)) {
    return entry.is_mutation === false &&
      entry.permission_scope === `${operation.split(".")[0]}:read`;
  }
  if (isMemoryRead(operation)) {
    return entry.handler === "sandy-memory-centre" &&
      entry.is_mutation === false && entry.permission_scope === "memory:read";
  }
  if (
    infrastructureOperations.includes(
      operation as typeof infrastructureOperations[number],
    ) ||
    providerReadOperations.includes(
      operation as typeof providerReadOperations[number],
    )
  ) {
    const family = operation.split(".")[0];
    const expectedScope =
      ["deployment", "engineering", "system"].includes(family)
        ? `${family}:read`
        : "infrastructure:read";
    return entry.is_mutation === false &&
      entry.permission_scope === expectedScope;
  }
  return true;
}
function requiresUserSession(operation: string): boolean {
  return !!providerExpansionOperations[operation] ||
    extensionRequiresUserSession(operation) ||
    isCustomerMutationOperation(operation) ||
    isCustomerServiceOperation(operation) || requiresPolicyUserJWT(operation) ||
    operation === MCP_DISCOVERY_OPERATION || isCustomerOperation(operation) ||
    requiresLegacyUserJWT(operation) || isCustomerRead(operation) ||
    isMemoryRead(operation) ||
    isEngineeringReadOperation(operation) ||
    operation === "engineering.preflight";
}
function ownerOnly(operation: string) {
  return extensionOwnerOnly(operation) || !!providerOperations[operation] ||
    customerServiceGrant(operation) === "controller_owner" ||
    isPolicyOperation(operation) || operation === MCP_DISCOVERY_OPERATION ||
    requiresCustomerOwner(operation) || isLegacyOperation(operation) ||
    isOrchestrationOperation(operation) ||
    operation === "deployment.jobs.request" ||
    operation === "deployment.management.release" ||
    operation === "deployment.jobs.cancel" ||
    operation === "deployment.jobs.retry" ||
    Object.hasOwn(videoReadActions, operation) ||
    isEngineeringReadOperation(operation) ||
    infrastructureOperations.includes(
      operation as typeof infrastructureOperations[number],
    ) ||
    providerReadOperations.includes(
      operation as typeof providerReadOperations[number],
    );
}
function executionAvailability(
  entry: Record<string, unknown>,
  config?: ProviderConfig,
  authorizedByStandingPolicy = false,
) {
  const extension = extensionAvailability(
    String(entry.operation),
    entry,
    config?.verifiedBindings,
    authorizedByStandingPolicy,
  );
  if (extension) return extension;
  const provider = providerOperations[String(entry.operation)];
  if (
    (entry.is_mutation === true || provider?.requires_grant) &&
    entry.verified !== true && !authorizedByStandingPolicy
  ) {
    return {
      executable: false,
      unavailable_reason: "operation_requires_live_verification",
    };
  }
  if (provider) {
    try {
      providerExecutionScope(provider.operation, config);
    } catch (error) {
      return {
        executable: false,
        unavailable_reason: error instanceof Error &&
            /^verified_[a-z_]+_scope_binding_required$/.test(error.message)
          ? error.message
          : "provider_scope_configuration_required",
      };
    }
  }
  return { executable: true };
}
async function upstreamResult(
  operation: string,
  response: Response,
  outputSchema: unknown,
  trustedProviderStatus?: number,
  preserveExecutionClaim = false,
) {
  const upstreamStatus = trustedProviderStatus ?? response.status;
  const untrustedExecution = preserveExecutionClaim
    ? { executed: null, reconciliation_required: true }
    : { executed: true };
  let result: unknown;
  try {
    result = await response.json();
  } catch {
    return reply(502, {
      ok: false,
      operation,
      ...untrustedExecution,
      upstream_status: upstreamStatus,
      error: "upstream_invalid_json",
    });
  }
  if (!isObject(result)) {
    return reply(502, {
      ok: false,
      operation,
      ...untrustedExecution,
      upstream_status: upstreamStatus,
      error: "upstream_invalid_response",
      result,
    });
  }
  const ok = response.ok && result.ok === true && result.error == null;
  if (ok && schemaValid(outputSchema, result) !== true) {
    return reply(502, {
      ok: false,
      operation,
      ...untrustedExecution,
      upstream_status: upstreamStatus,
      error: "upstream_output_schema_mismatch",
    });
  }
  if (ok && result.accepted === true && result.executed === false) {
    return reply(202, {
      ...result,
      ok: true,
      operation,
      executed: false,
      result,
    });
  }
  return reply(response.ok && !ok ? 502 : response.status, {
    ok,
    operation,
    executed: preserveExecutionClaim ? (ok ? result.executed : null) : true,
    upstream_status: upstreamStatus,
    result,
    ...(ok && readVerifiedExecution(response, operation, result.admission_id)
      ? {
        execution_receipt: readVerifiedExecution(
          response,
          operation,
          result.admission_id,
        ),
      }
      : {}),
    ...(preserveExecutionClaim && ok
      ? {
        request_state: result.request_state,
        request_id: result.request_id,
        admission_id: result.admission_id,
        reconciliation_required: result.reconciliation_required,
      }
      : {}),
    ...(preserveExecutionClaim && !ok ? { reconciliation_required: true } : {}),
    ...(!ok
      ? {
        error: typeof result.error === "string"
          ? result.error
          : "upstream_operation_failed",
      }
      : {}),
  });
}

// Installed application handlers return sanitized refusal/unknown envelopes.
// Preserve those execution claims while validating every positive result.
async function applicationResult(
  operation: string,
  response: Response,
  outputSchema: unknown,
  preserveExecutionClaim = false,
) {
  if (response.ok) {
    return upstreamResult(
      operation,
      response,
      outputSchema,
      undefined,
      preserveExecutionClaim,
    );
  }
  let result: unknown;
  try {
    result = await response.json();
  } catch {
    result = null;
  }
  if (!isObject(result)) {
    return reply(502, {
      ok: false,
      operation,
      error: "application_handler_invalid_response",
      executed: null,
      reconciliation_required: true,
    });
  }
  return reply(response.status, { ...result, ok: false, operation });
}

export function createOperationHandler(dependencies: OperationDependencies) {
  const { base, service, anon, db } = dependencies;
  const fetchBackend = dependencies.fetch ?? fetch;
  return async (request: Request): Promise<Response> => {
    const url = new URL(request.url);
    const path = operationRequestPath(url.pathname);
    let routedBody: Record<string, unknown> | undefined;
    const internalExecution = path === "/v1/internal/execute";
    const planAction = path === "/v1/plans:validate"
      ? "orchestration.plans.validate"
      : path === "/v1/plans:execute"
      ? "orchestration.plans.execute"
      : null;
    const describePath = path.match(
      /^\/v1\/capabilities\/([a-z][a-z0-9_.-]{2,100})$/,
    );
    const executePath = path.match(
      /^\/v1\/operations\/([a-z][a-z0-9_.-]{2,100}):execute$/,
    );
    const parsedJob = await parseApiJobRoute(request);
    if (!parsedJob.ok) {
      return reply(parsedJob.status, {
        ok: false,
        error: parsedJob.error,
        executed: false,
      });
    }
    const jobRoute = parsedJob.value;
    const executionReceiptPath = path.match(
      /^\/v1\/executions\/([a-f0-9-]{36})$/i,
    );
    if (jobRoute) {
      // Classification follows actual authentication below; the URL never
      // chooses durable/legacy scope or supplies an execution identity.
    } else if (request.method === "GET") {
      if (path === "/v1/capabilities") {
        const limit = url.searchParams.get("limit") ?? "100";
        if (
          !/^[1-9][0-9]{0,2}$/.test(limit) || Number(limit) > 100 ||
          [...url.searchParams.keys()].some((key) =>
            !["limit", "cursor"].includes(key) ||
            url.searchParams.getAll(key).length !== 1
          )
        ) {
          return reply(400, {
            error: "invalid_catalogue_page",
            executed: false,
          });
        }
        routedBody = {
          action: "list",
          channel: "api",
          limit: Number(limit),
          ...(url.searchParams.has("cursor")
            ? { cursor: url.searchParams.get("cursor") }
            : {}),
        };
      } else if (describePath) {
        routedBody = { action: "describe", operation: describePath[1] };
      } else if (executionReceiptPath) {
        routedBody = {
          action: "execute",
          operation: "system.execution.get",
          arguments: { request_id: executionReceiptPath[1] },
        };
      } else if (path === "/v1/audit") {
        const after = url.searchParams.get("after") ?? "0";
        const limit = url.searchParams.get("limit") ?? "100";
        if (
          !/^\d{1,15}$/.test(after) || !/^\d{1,3}$/.test(limit) ||
          [...url.searchParams.keys()].some((key) =>
            !["after", "limit", "operation", "resource"].includes(key)
          )
        ) return reply(400, { error: "invalid_audit_query" });
        const operation = url.searchParams.get("operation") ??
          url.searchParams.get("resource");
        if (operation && !validOperation(operation)) {
          return reply(400, {
            error: "audit_resource_filter_requires_operation_id",
          });
        }
        routedBody = {
          action: "execute",
          operation: "system.audit.list",
          arguments: {
            after_sequence: Number(after),
            limit: Number(limit),
            ...(operation ? { operation } : {}),
          },
        };
      } else return reply(405, { error: "method_not_allowed" });
    } else if (request.method !== "POST") {
      return reply(405, { error: "method_not_allowed" });
    } else if (
      path !== "" && path !== "/" && !executePath &&
      !internalExecution && !planAction
    ) {
      return reply(404, { error: "route_not_found" });
    }
    if (!base || !service) {
      return reply(503, { error: "api_configuration_missing" });
    }
    const bearer = (request.headers.get("authorization") ?? "").match(
      /^Bearer\s+(.+)$/i,
    )?.[1];
    if (!bearer) return reply(401, { error: "authentication_required" });
    let delegation: DelegatedIdentity | null = null;
    let user:
      | { id: string; email?: string; email_confirmed_at?: string | null }
      | null = null;
    let credential: CredentialResolution = null;
    let customerKey: CustomerKeyPrincipal | null = null;
    const customerKeySecret = request.headers.get("x-sandy-api-key");
    const customerKeyResolution = await resolveCustomerKeyRequest(
      db,
      request,
      anon,
    );
    if (customerKeyResolution) {
      if (!customerKeyResolution.ok) {
        return reply(customerKeyResolution.status, {
          ok: false,
          error: customerKeyResolution.error,
          executed: false,
        });
      }
      if (internalExecution) {
        return reply(403, { error: "job_lease_required", executed: false });
      }
      customerKey = customerKeyResolution.value;
    }
    if (!customerKey && dependencies.resolveCredential) {
      try {
        credential = await dependencies.resolveCredential(
          request.clone(),
          bearer,
        );
      } catch {
        return reply(503, {
          error: "credential_authorisation_unavailable",
          executed: false,
        });
      }
    }
    if (credential && "error" in credential) {
      return reply(
        [400, 401, 403, 404, 409, 410, 413, 423, 429, 503].includes(
            credential.status,
          )
          ? credential.status
          : 503,
        {
          error: /^[a-z][a-z0-9_]{2,80}$/.test(credential.error)
            ? credential.error
            : "credential_authorisation_failed",
          executed: false,
        },
      );
    }
    if (customerKey) {
      // This principal has a key ID and tenant, and no Auth user or email.
    } else if (credential) {
      if (
        !["api_key", "job_lease"].includes(credential.kind) ||
        !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(
          credential.principalId,
        ) ||
        !Array.isArray(credential.allowedOperations) ||
        !credential.allowedOperations.length ||
        credential.allowedOperations.some((operation) =>
          !validOperation(operation)
        )
      ) {
        return reply(401, {
          error: "invalid_delegated_identity",
          executed: false,
        });
      }
      const engineering = engineeringProofFor(credential);
      if (engineering) {
        // The delegated authority is never a fabricated user session: verify the
        // actual non-owner workload JWT again before entering canonical routing.
        const verified = await db.auth.getUser(bearer);
        if (
          internalExecution || verified.error || !verified.data.user ||
          verified.data.user.id !== engineering.machineUserId ||
          verified.data.user.role !== "authenticated" ||
          verified.data.user.is_anonymous === true ||
          !engineeringTagged(verified.data.user)
        ) {
          return reply(401, {
            error: "invalid_engineering_auth_session",
            executed: false,
          });
        }
      }
      delegation = credential;
      user = { id: credential.principalId };
      if (credential.kind === "job_lease" && !engineering) {
        const execution = credential.boundExecution;
        if (
          !internalExecution || !execution ||
          !credential.allowedOperations.includes(execution.operation) ||
          !isObject(execution.arguments) ||
          !["api", "mcp"].includes(execution.channel) ||
          await argumentDigest(execution.arguments) !== execution.inputDigest
        ) {
          return reply(403, {
            error: "invalid_job_execution_scope",
            executed: false,
          });
        }
        routedBody = {
          action: "execute",
          operation: execution.operation,
          arguments: execution.arguments,
          channel: execution.channel,
        };
      } else if (internalExecution) {
        return reply(403, { error: "job_lease_required", executed: false });
      }
    } else {
      if (internalExecution || request.headers.has("x-sandy-api-key")) {
        return reply(401, {
          error: "delegated_authentication_required",
          executed: false,
        });
      }
      let identity: Awaited<ReturnType<typeof db.auth.getUser>>;
      try {
        identity = await db.auth.getUser(bearer);
      } catch {
        return reply(503, {
          error: "authentication_unavailable",
          executed: false,
        });
      }
      const { data, error: authError } = identity;
      if (authError) {
        const invalidSession = [400, 401, 403, 422].includes(
          Number(authError.status),
        );
        return reply(invalidSession ? 401 : 503, {
          error: invalidSession
            ? "invalid_identity"
            : "authentication_unavailable",
          executed: false,
        });
      }
      if (
        !data.user || data.user.role !== "authenticated" ||
        data.user.is_anonymous === true
      ) {
        return reply(401, { error: "invalid_identity" });
      }
      user = data.user;
      if (engineeringTagged(data.user)) {
        return engineeringRequest(
          {
            db,
            entry: async (operation) => {
              const selected = await db.from("sandy_operation_registry").select(
                registryColumns,
              ).eq("operation", operation).maybeSingle();
              return !selected.error && isObject(selected.data)
                ? selected.data
                : null;
            },
            contractMatches: (entry) =>
              enabledEntry(entry) && discoverableContract(entry),
            argumentsValid: (schema, args) =>
              schemaValid(schema, args) === true,
            executionScope: async (operation, args) => {
              const scope = extensionKind(operation)
                ? await extensionExecutionScope(
                  operation,
                  args,
                  data.user!.id,
                  async () => null,
                  {
                    restoreBindings: dependencies.packageRestoreBindings,
                    getProtocolBindings: async (actorId: string) => {
                      const selected = await db.rpc(
                        "sandy_vm_protocol_public_bindings",
                        { p_actor: actorId },
                      );
                      return selected.error ? undefined : selected.data;
                    },
                    providerBindings: dependencies.providerConfig
                      ?.verifiedBindings,
                  },
                )
                : providerExecutionScope(
                  operation,
                  dependencies.providerConfig,
                );
              if (!isObject(scope)) {
                throw Error("provider_scope_configuration_required");
              }
              return scope;
            },
            delegate: (forwarded, scopedCredential) =>
              createOperationHandler({
                ...dependencies,
                resolveCredential: async (_request, token) =>
                  token === bearer && engineeringProofFor(scopedCredential)
                    ? scopedCredential as unknown as DelegatedIdentity
                    : {
                      status: 401,
                      error: "invalid_engineering_auth_session",
                    },
              })(forwarded),
          },
          // The verified workload uses the same normalized route contract as
          // ordinary users. Its delegation layer accepts canonical JSON only;
          // a GET must not lose its already validated pagination or operation.
          routedBody && request.method === "GET"
            ? new Request(`${base}/functions/v1/sandy-operation-api`, {
              method: "POST",
              headers: request.headers,
              body: JSON.stringify(routedBody),
            })
            : request,
          data.user as unknown as Record<string, unknown>,
          bearer,
        );
      }
    }
    if (!user && !customerKey) return reply(401, { error: "invalid_identity" });
    const { data: admin, error: roleError } = user
      ? await db.from(
        "sandy_controller_admins",
      )
        .select("role,enabled").eq("auth_user_id", user.id).eq("enabled", true)
        .maybeSingle()
      : { data: null, error: null };
    if (roleError) return reply(503, { error: "authorisation_unavailable" });
    if (jobRoute) {
      if (customerKey || !user) {
        return reply(404, { error: "job_not_found", executed: false });
      }
      const resolved = await resolveApiJobRoute(db, {
        kind: delegation?.kind ?? "user",
        actorId: user.id,
        // REST job URLs are the API channel. MCP calls use their named
        // operation and retain their original channel in the existing pipeline.
        channel: "api",
        tenantId: null,
        credentialId: delegation?.credentialId,
        allowedOperations: delegation?.allowedOperations,
      }, jobRoute);
      if (!resolved.ok) {
        return reply(resolved.status, {
          ok: false,
          error: resolved.error,
          executed: false,
        });
      }
      routedBody = {
        action: "execute",
        operation: resolved.value.operation,
        arguments: resolved.value.arguments,
      };
    }
    let body: Record<string, unknown>;
    try {
      const value = routedBody ?? await requestJson(request, 1550000);
      if (!isObject(value)) throw Error();
      body = planAction
        ? { action: "execute", operation: planAction, arguments: value }
        : executePath
        ? {
          action: "execute",
          operation: executePath[1],
          arguments: value.arguments ?? {},
        }
        : value;
      if (
        executePath && Object.keys(value).some((key) => key !== "arguments")
      ) throw Error();
    } catch (error) {
      return reply(error instanceof JsonRequestError ? error.status : 400, {
        error: error instanceof JsonRequestError
          ? error.code
          : "invalid_request",
      });
    }
    // Reuse the existing customer-access directory; never trust a caller's
    // customer_id. The downstream customer handler independently verifies the
    // same user session and scopes every resource query to that tenant.
    let tenantAccess = customerKey !== null;
    let agendaCustomerId: string | null = customerKey?.customerId ?? null;
    const additionalGrant = typeof body.operation === "string"
      ? customerServiceGrant(body.operation)
      : undefined;
    const customerRequest = typeof body.operation === "string" &&
      (extensionNeedsAgenda(body.operation) || isCustomerRead(body.operation) ||
        isCustomerMutationOperation(body.operation) ||
        additionalGrant === "agenda" ||
        additionalGrant === "portal_and_agenda");
    const memoryRequest = typeof body.operation === "string" &&
      (extensionNeedsPortal(body.operation) || isMemoryRead(body.operation) ||
        isCustomerOperation(body.operation) || additionalGrant === "portal" ||
        additionalGrant === "portal_and_agenda");
    if (
      typeof user?.email === "string" &&
      (customerRequest || body.action === "list" || !admin)
    ) {
      const { data: access, error: accessError } = await db.from(
        "sandy_agenda_access",
      )
        .select("customer_id").eq("email", user.email.toLowerCase()).eq(
          "enabled",
          true,
        ).maybeSingle();
      if (accessError && customerRequest) {
        return reply(503, { error: "tenant_authorisation_unavailable" });
      }
      tenantAccess = !accessError && typeof access?.customer_id === "string";
      if (tenantAccess) agendaCustomerId = access!.customer_id;
    }
    // Memory Portal has its own grant and verified primary-email check. Agenda
    // access and Controller membership confer no access to these private records.
    let memoryAccess = false;
    let portalCustomerId: string | null = null;
    if (
      typeof user?.email === "string" && user.email_confirmed_at &&
      (memoryRequest || body.action === "list" || !admin)
    ) {
      const { data: portal, error: portalError } = await db.from(
        "sandy_memory_portal_accounts",
      ).select("customer_id").eq("auth_user_id", user.id).is(
        "revoked_at",
        null,
      ).maybeSingle();
      if (portalError && memoryRequest) {
        return reply(503, { error: "memory_authorisation_unavailable" });
      }
      if (!portalError && typeof portal?.customer_id === "string") {
        const { data: address, error: addressError } = await db.from(
          "email_customer_addresses",
        ).select("normalized_email").eq("customer_id", portal.customer_id).eq(
          "is_primary",
          true,
        ).maybeSingle();
        if (addressError && memoryRequest) {
          return reply(503, { error: "memory_authorisation_unavailable" });
        }
        memoryAccess = !addressError &&
          address?.normalized_email === user.email.toLowerCase();
        if (memoryAccess) portalCustomerId = portal.customer_id;
      }
    }
    const onboardingAccess = !delegation && !customerKey &&
      typeof user?.email === "string" && !!user.email_confirmed_at &&
      (body.action === "list" ||
        (typeof body.operation === "string" &&
          extensionKind(body.operation) === "onboarding"));
    if (!admin && !tenantAccess && !memoryAccess && !onboardingAccess) {
      return reply(403, { error: "controller_administrator_required" });
    }
    const customerServicePrincipal = user
      ? {
        id: user.id,
        portalCustomerId,
        agendaCustomerId,
        controllerOwner: admin?.role === "owner",
      }
      : null;
    if (body.action === "list") {
      const { data, error } = dependencies.catalogueRpc
        ? await db.rpc("sandy_api_catalogue_records", {
          p_operations: Object.keys(allowedHandlers),
        })
        : await db.from("sandy_operation_registry")
          .select(registryColumns).eq("api_exposed", true)
          .in("operation", Object.keys(allowedHandlers)).order("operation");
      if (error) return reply(503, { error: "operation_registry_unavailable" });
      const entries: unknown[] = data ?? [];
      const operations: (Record<string, unknown> & {
        operation: string;
        executable: boolean;
      })[] = entries.filter(enabledEntry)
        .filter(discoverableContract)
        .filter((entry) =>
          !delegation ||
          ((delegation.allowedOperations.includes(entry.operation) ||
            (delegation.kind === "api_key" &&
              entry.operation === "system.execution.get")) &&
            (engineeringProofFor(delegation) ||
              (entry.is_mutation === false &&
                !requiresUserSession(entry.operation))))
        )
        .filter((entry) =>
          customerKey
            ? entry.is_mutation === false &&
              (customerKey.allowedOperations.includes(entry.operation) ||
                entry.operation === "system.execution.get")
            : extensionKind(entry.operation)
            ? extensionHasAccess(
              entry.operation,
              customerServicePrincipal!,
              !!user!.email_confirmed_at,
            )
            : isCustomerServiceOperation(entry.operation)
            ? hasCustomerServiceGrant(
              customerServicePrincipal!,
              entry.operation,
            )
            : (isMemoryRead(entry.operation) ||
                isCustomerOperation(entry.operation))
            ? memoryAccess
            : (isCustomerRead(entry.operation) ||
                isCustomerMutationOperation(entry.operation))
            ? tenantAccess
            : !!admin
        )
        .filter((entry) =>
          !ownerOnly(entry.operation) || admin?.role === "owner" ||
          (customerKey !== null && entry.operation === "system.execution.get")
        )
        .map((entry) => ({
          ...entry,
          ...executionAvailability(
            entry,
            dependencies.providerConfig,
            engineeringProofFor(delegation)?.standingOperations?.includes(
              String(entry.operation),
            ) === true,
          ),
        }));
      const bytes = new TextEncoder().encode(JSON.stringify(operations));
      const digest = new Uint8Array(
        await crypto.subtle.digest("SHA-256", bytes),
      );
      const catalogue_version = Array.from(
        digest,
        (b) => b.toString(16).padStart(2, "0"),
      ).join("");
      if (body.limit !== undefined || body.cursor !== undefined) {
        const visible = body.channel === "mcp"
          ? operations.filter((entry) =>
            entry.ai_exposed === true && entry.executable === true
          )
          : operations;
        const page = cataloguePage(
          visible,
          catalogue_version,
          body.limit ?? 100,
          body.cursor,
        );
        return page.ok
          ? reply(200, { ...page, catalogue_version })
          : reply(page.status, {
            ok: false,
            error: page.error,
            executed: false,
          });
      }
      return reply(200, { ok: true, operations, catalogue_version });
    }
    if (body.action !== "describe" && body.action !== "execute") {
      return reply(400, { error: "unknown_action" });
    }
    if (!validOperation(body.operation)) {
      return reply(400, { error: "invalid_operation" });
    }
    const operation = body.operation;
    const customerKeyReceipt = customerKey !== null &&
      operation === "system.execution.get";
    if (
      customerKey && !customerKey.allowedOperations.includes(operation) &&
      !customerKeyReceipt
    ) {
      return reply(404, { error: "operation_not_registered", executed: false });
    }
    if (
      delegation && !delegation.allowedOperations.includes(operation) &&
      !(delegation.kind === "api_key" && operation === "system.execution.get")
    ) {
      return reply(403, {
        error: "credential_operation_scope_denied",
        executed: false,
      });
    }
    if (
      delegation && !engineeringProofFor(delegation) &&
      requiresUserSession(operation)
    ) {
      return reply(403, {
        error: "operation_requires_user_session",
        executed: false,
      });
    }
    const { data: storedEntry, error } = await db.from(
      "sandy_operation_registry",
    )
      .select(registryColumns).eq("operation", operation).maybeSingle();
    if (error) return reply(503, { error: "operation_registry_unavailable" });
    const entry: unknown = storedEntry;
    if (!isObject(entry) || entry.api_exposed !== true) {
      return reply(404, { error: "operation_not_registered" });
    }
    const boundContract = delegation?.boundExecution?.registryContract;
    if (
      boundContract &&
      Object.entries(boundContract).some(([key, value]) =>
        !Object.hasOwn(entry, key) ||
        canonicalJson(entry[key]) !== canonicalJson(value)
      )
    ) {
      return reply(409, {
        error: "job_execution_contract_changed",
        executed: false,
      });
    }
    if (body.channel === "mcp" && entry.ai_exposed !== true) {
      return reply(403, {
        error: "operation_not_mcp_exposed",
        executed: false,
      });
    }
    if (!enabledEntry(entry)) {
      return reply(422, {
        ok: false,
        error: "executor_not_implemented_or_not_enabled",
        operation,
        executed: false,
      });
    }
    if (
      customerKey
        ? !customerKey.allowedOperations.includes(operation) &&
          !customerKeyReceipt
        : extensionKind(operation)
        ? !extensionHasAccess(
          operation,
          customerServicePrincipal!,
          !!user?.email_confirmed_at,
        )
        : isCustomerServiceOperation(operation)
        ? !hasCustomerServiceGrant(customerServicePrincipal!, operation)
        : (isMemoryRead(operation) || isCustomerOperation(operation))
        ? !memoryAccess
        : (isCustomerRead(operation) || isCustomerMutationOperation(operation))
        ? !tenantAccess
        : !admin
    ) {
      return reply(403, {
        error: (isMemoryRead(operation) || isCustomerOperation(operation))
          ? "memory_access_required"
          : (isCustomerRead(operation) ||
              isCustomerMutationOperation(operation))
          ? "customer_access_required"
          : "controller_administrator_required",
        executed: false,
      });
    }
    if (
      ownerOnly(operation) && admin?.role !== "owner" && !customerKeyReceipt
    ) {
      return reply(403, { error: "owner_required", executed: false });
    }
    if (body.action === "describe") {
      if (!discoverableContract(entry)) {
        return reply(503, {
          error: "executor_contract_conflict",
          executed: false,
        });
      }
      return reply(200, {
        ok: true,
        operation: {
          ...entry,
          ...executionAvailability(
            entry,
            dependencies.providerConfig,
            engineeringProofFor(delegation)?.standingOperations?.includes(
              String(entry.operation),
            ) === true,
          ),
        },
      });
    }
    const handler = allowedHandlers[entry.operation];
    const inputValidation = schemaValid(
      entry.input_schema,
      body.arguments ?? {},
    );
    if (inputValidation !== true) {
      return reply(inputValidation === null ? 503 : 400, {
        error: inputValidation === null
          ? "operation_schema_unavailable"
          : "invalid_operation_arguments",
        executed: false,
      });
    }
    if (schemaValid(entry.output_schema, {}) === null) {
      return reply(503, {
        error: "operation_schema_unavailable",
        executed: false,
      });
    }
    if (!discoverableContract(entry)) {
      return reply(503, {
        error: isCustomerRead(operation)
          ? "customer_executor_contract_conflict"
          : isMemoryRead(operation)
          ? "memory_executor_contract_conflict"
          : isEngineeringReadOperation(operation)
          ? "engineering_read_executor_contract_conflict"
          : Object.hasOwn(videoReadActions, operation)
          ? "video_read_executor_contract_conflict"
          : "read_executor_contract_conflict",
        executed: false,
      });
    }
    if (entry.is_mutation === true && delegation?.kind === "api_key") {
      return reply(403, {
        error: "credential_mutation_scope_denied",
        executed: false,
      });
    }
    if (
      (entry.is_mutation === true ||
        providerOperations[operation]?.requires_grant === true) &&
      entry.verified !== true &&
      !engineeringProofFor(delegation)?.standingOperations?.includes(operation)
    ) {
      return reply(424, {
        error: "operation_requires_live_verification",
        executed: false,
      });
    }
    const extensionReady = extensionAvailability(
      operation,
      entry,
      dependencies.providerConfig?.verifiedBindings,
      engineeringProofFor(delegation)?.standingOperations?.includes(
        operation,
      ) === true,
    );
    if (extensionReady && !extensionReady.executable) {
      return reply(424, {
        ok: false,
        operation,
        error: extensionReady.unavailable_reason,
        executed: false,
      });
    }
    if (customerKey) {
      if (!customerKeySecret) {
        return reply(401, { error: "invalid_customer_key", executed: false });
      }
      if (customerKeyReceipt) {
        const result = await getCustomerKeyReceipt(
          db,
          customerKey,
          customerKeySecret,
          isObject(body.arguments) ? body.arguments.request_id : undefined,
        );
        return result.ok
          ? applicationResult(
            operation,
            reply(200, result.value),
            entry.output_schema,
          )
          : reply(result.status, {
            ok: false,
            error: result.error,
            executed: false,
          });
      }
      const forwarded = buildCustomerKeyReadRequest(
        base,
        anon,
        customerKey,
        customerKeySecret,
        operation,
        body.arguments ?? {},
      );
      if (!forwarded) {
        return reply(400, {
          error: "invalid_operation_arguments",
          executed: false,
        });
      }
      return governedCustomerKeyExecution(db, customerKey, customerKeySecret, {
        operation,
        arguments: body.arguments ?? {},
        requestId: request.headers.get("x-sandy-request-id") ??
          crypto.randomUUID(),
        channel: body.channel === "mcp" ? "mcp" : "api",
        contractSha256: await executionContractDigest(entry),
      }, async () => {
        const result = await fetchBackend(forwarded.url, forwarded.init);
        return upstreamResult(operation, result, entry.output_schema);
      });
    }
    if (!user || !customerServicePrincipal) {
      return reply(401, { error: "invalid_identity" });
    }
    const dispatchUser = user;
    const originalChannel = body.channel === "mcp" ? "mcp" : "api";
    const lifecycleEngineeringProof = engineeringProofFor(delegation);
    const lifecycleKind = lifecycleEngineeringProof
      ? "user"
      : delegation?.kind ?? "user";
    const lifecycleContext = (requestId: string): LifecycleContext => ({
      actorId: dispatchUser.id,
      kind: lifecycleKind,
      ...(lifecycleEngineeringProof
        ? {
          engineering: {
            userId: lifecycleEngineeringProof.machineUserId,
            sessionId: lifecycleEngineeringProof.sessionId,
            epoch: lifecycleEngineeringProof.epoch,
          },
        }
        : {}),
      requestId,
      originalChannel,
      ...(request.headers.get("x-sandy-approval-id")
        ? { scope: { approvalId: request.headers.get("x-sandy-approval-id")! } }
        : {}),
    });
    const executeCanonical = async (
      context: LifecycleContext,
      childOperation: string,
      args: Record<string, unknown>,
    ): Promise<Response> => {
      if (
        context.actorId !== dispatchUser.id ||
        context.kind !== lifecycleKind ||
        context.originalChannel !== originalChannel ||
        !validOperation(childOperation)
      ) {
        return reply(403, {
          ok: false,
          error: "lifecycle_canonical_context_denied",
          executed: false,
        });
      }
      const headers: Record<string, string> = {
        authorization: `Bearer ${bearer}`,
        "content-type": "application/json",
        "x-sandy-request-id": context.requestId,
      };
      if (context.scope?.approvalId) {
        headers["x-sandy-approval-id"] = context.scope.approvalId;
      }
      let canonical: (request: Request) => Promise<Response>;
      let childRequest: Request;
      if (context.kind === "user") {
        // The existing verified user's real JWT is forwarded, not replaced by
        // the internal platform/service credential.
        canonical = createOperationHandler({
          ...dependencies,
          // A standing parent's one-request credential must never be inherited
          // by a different child. Forward its real workload JWT through Auth
          // and current policy again; no replacement Owner session is created.
          resolveCredential: lifecycleEngineeringProof
            ? undefined
            : dependencies.resolveCredential,
        });
        childRequest = new Request(`${base}/functions/v1/sandy-operation-api`, {
          method: "POST",
          headers,
          body: JSON.stringify({
            action: "execute",
            operation: childOperation,
            arguments: args,
            channel: originalChannel,
          }),
        });
      } else {
        // A leased lifecycle poll may derive only these two read contracts.
        // This resolver is in-process and not an HTTP authentication endpoint.
        if (
          context.kind !== "job_lease" ||
          operation !== "system.lifecycle.poll" ||
          ![
            "gcp.compute.zone_operations.get",
            "gcp.compute.global_operations.get",
          ].includes(childOperation) ||
          providerOperations[childOperation]?.is_mutation !== false ||
          providerOperations[childOperation]?.requires_grant !== false
        ) {
          return reply(403, {
            ok: false,
            error: "lifecycle_job_child_scope_denied",
            executed: false,
          });
        }
        const inputDigest = await argumentDigest(args);
        canonical = createOperationHandler({
          ...dependencies,
          resolveCredential: async () => ({
            kind: "job_lease",
            principalId: dispatchUser.id,
            allowedOperations: [childOperation],
            boundExecution: {
              operation: childOperation,
              arguments: args,
              inputDigest,
              channel: originalChannel,
              dispatchId: context.requestId,
            },
          }),
        });
        childRequest = new Request(
          `${base}/functions/v1/sandy-operation-api/v1/internal/execute`,
          { method: "POST", headers, body: "{}" },
        );
      }
      const response = await canonical(childRequest);
      const result: unknown = await response.json().catch(() => null);
      if (!isObject(result)) {
        return reply(502, {
          ok: false,
          error: "canonical_child_response_invalid",
          executed: null,
        });
      }
      // Public API envelopes retain the handler payload for MCP's output schema.
      // Lifecycle consumes that real provider payload and its original proof.
      if (
        response.ok && isObject(result.result) &&
        result.result.operation === childOperation &&
        result.result.contract_version === "1.0.0" &&
        result.result.admission_id === result.admission_id
      ) {
        return reply(response.status, {
          ...result.result,
          request_id: result.request_id,
        });
      }
      return reply(response.status, result);
    };
    const dispatch = async (
      _admission?: ExecutionAdmission,
    ): Promise<Response> => {
      const kind = extensionKind(operation);
      if (kind) {
        if (kind === "lifecycle") {
          const response = await executeProviderLifecycle(
            { db, executeCanonical },
            lifecycleContext(
              request.headers.get("x-sandy-request-id") ?? crypto.randomUUID(),
            ),
            operation,
            body.arguments ?? {},
          );
          return applicationResult(operation, response, entry.output_schema);
        }
        let userDb: TenantConsentDb | undefined;
        if (kind === "tenant_consent" || kind === "tenant_download") {
          if (!anon && !dependencies.authenticatedDb) {
            return reply(503, {
              error: "tenant_consent_session_required",
              executed: false,
            });
          }
          try {
            userDb = dependencies.authenticatedDb
              ? dependencies.authenticatedDb(bearer)
              : createClient(base, anon, {
                global: { headers: { Authorization: `Bearer ${bearer}` } },
                auth: { persistSession: false, autoRefreshToken: false },
              });
          } catch {
            return reply(503, {
              error: "tenant_consent_session_required",
              executed: false,
            });
          }
        }
        const local = await executeUserExtension(
          {
            base,
            anon,
            service,
            principal: customerServicePrincipal,
            fetch: fetchBackend,
            emailConfirmed: !!dispatchUser.email_confirmed_at,
            ...(userDb ? { userDb } : {}),
          },
          bearer,
          operation,
          body.arguments ?? {},
        );
        if (local) {
          return applicationResult(operation, local, entry.output_schema);
        }
        let response: Response;
        try {
          if (kind === "agent" || extensionOwnsUserAdmission(operation)) {
            response = await fetchBackend(
              `${base}/functions/v1/${extensionContracts[operation].handler}`,
              {
                method: "POST",
                redirect: "error",
                headers: {
                  authorization: `Bearer ${bearer}`,
                  apikey: anon,
                  "content-type": "application/json",
                },
                body: JSON.stringify({
                  operation,
                  arguments: body.arguments ?? {},
                  channel: originalChannel,
                  ...(extensionOwnsUserAdmission(operation) &&
                      (request.headers.has("x-sandy-request-id") ||
                        kind === "composio_customer")
                    ? {
                      request_id: request.headers.get("x-sandy-request-id") ??
                        crypto.randomUUID(),
                    }
                    : {}),
                  ...(extensionOwnsUserAdmission(operation) &&
                      kind !== "composio_customer" &&
                      request.headers.has("x-sandy-approval-id")
                    ? {
                      approval_id: request.headers.get("x-sandy-approval-id"),
                    }
                    : {}),
                }),
                signal: AbortSignal.timeout(
                  extensionOwnsUserAdmission(operation) ? 120000 : 60000,
                ),
              },
            );
          } else {
            if (!_admission) {
              return reply(503, {
                ok: false,
                error: "execution_policy_required",
                executed: false,
              });
            }
            response = await fetchBackend(
              `${base}/functions/v1/${extensionContracts[operation].handler}`,
              {
                method: "POST",
                redirect: "error",
                headers: {
                  authorization: `Bearer ${service}`,
                  apikey: service,
                  "content-type": "application/json",
                },
                body: JSON.stringify({
                  operation,
                  arguments: body.arguments ?? {},
                  actor_id: dispatchUser.id,
                  tenant_id: null,
                  request_id: _admission.requestId,
                  grant_id: _admission.grantId,
                  admission_id: _admission.admissionId,
                  credential_id: null,
                  ...(kind === "system_metadata"
                    ? { channel: originalChannel }
                    : {}),
                }),
                signal: AbortSignal.timeout(60000),
              },
            );
          }
        } catch {
          return reply(502, {
            ok: false,
            operation,
            error: "application_execution_outcome_unknown",
            executed: null,
            reconciliation_required: true,
          });
        }
        return applicationResult(
          operation,
          response,
          entry.output_schema,
          extensionOwnsUserAdmission(operation) || kind === "system_metadata",
        );
      }
      if (isCustomerMutationOperation(operation)) {
        const response = await executeCustomerMutation(
          { base, anon, db, fetch: fetchBackend },
          bearer,
          operation,
          body.arguments ?? {},
        );
        return applicationResult(
          operation,
          reply(response.status, response.body),
          entry.output_schema,
        );
      }
      if (providerOperations[operation]) {
        if (!_admission) {
          return reply(503, {
            ok: false,
            error: "execution_policy_required",
            executed: false,
          });
        }
        if (
          [
            "github.files.upsert",
            "gcp.compute.instances.start",
            "gcp.compute.instances.stop",
          ].includes(operation)
        ) {
          const captured = await captureLifecyclePreimage(
            { db, executeCanonical },
            lifecycleContext(_admission.requestId),
            _admission.admissionId,
            operation,
            isObject(body.arguments) ? body.arguments : {},
          );
          if (!captured.ok) return captured;
        }
        let response: Response;
        try {
          response = await fetchBackend(
            `${base}/functions/v1/sandy-provider-operation-api`,
            {
              method: "POST",
              redirect: "error",
              headers: {
                authorization: `Bearer ${service}`,
                apikey: service,
                "content-type": "application/json",
              },
              body: JSON.stringify({
                operation,
                arguments: body.arguments ?? {},
                actor_id: dispatchUser.id,
                tenant_id: null,
                request_id: _admission.requestId,
                grant_id: _admission.grantId,
                admission_id: _admission.admissionId,
                credential_id: delegation?.credentialId ?? null,
              }),
              signal: AbortSignal.timeout(60000),
            },
          );
        } catch {
          return reply(502, {
            ok: false,
            error: "provider_execution_outcome_unknown",
            executed: null,
            reconciliation_required: true,
          });
        }
        return applicationResult(operation, response, entry.output_schema);
      }
      if (isCustomerServiceOperation(operation)) {
        const response = await executeCustomerService(
          {
            base,
            anon,
            service,
            principal: customerServicePrincipal,
            fetch: fetchBackend,
          },
          bearer,
          operation,
          body.arguments ?? {},
        );
        return applicationResult(operation, response, entry.output_schema);
      }
      if (isPolicyOperation(operation)) {
        const response = await executePolicyOperation(
          {
            db,
            verifySession: async (token) => {
              const { data, error } = await db.auth.getUser(token);
              return !error && data.user ? { id: data.user.id } : null;
            },
            ownsEngineeringReceipt: async (receiptRequestId) => {
              const proof = engineeringProofFor(delegation);
              if (
                !proof?.standingOperations?.includes("system.execution.get")
              ) return false;
              const { data, error } = await db.rpc(
                "sandy_engineering_owns_execution",
                {
                  p_user_id: proof.machineUserId,
                  p_session_id: proof.sessionId,
                  p_epoch: proof.epoch,
                  p_request_id: receiptRequestId,
                },
              );
              return !error && isObject(data) && data.ok === true &&
                data.owned === true;
            },
          },
          {
            kind: delegation?.kind ?? "user",
            actorId: dispatchUser.id,
            ...(!delegation ? { userJWT: bearer } : {}),
            credentialId: delegation?.credentialId,
          },
          operation,
          body.arguments ?? {},
        );
        return applicationResult(operation, response, entry.output_schema);
      }
      if (operation === MCP_DISCOVERY_OPERATION) {
        const result = await inspectEngineeringMcp(body.arguments ?? {}, {
          userToken: bearer,
          request: fetchBackend,
        });
        return applicationResult(
          operation,
          reply(result.status, result.body),
          entry.output_schema,
        );
      }
      if (isCustomerOperation(operation)) {
        const response = await executeCustomerOperation(
          {
            base,
            anon,
            service,
            principal: {
              id: dispatchUser.id,
              customerId: portalCustomerId ?? "",
              portalAccess: memoryAccess,
              controllerOwner: admin?.role === "owner",
            },
            fetch: fetchBackend,
          },
          bearer,
          operation,
          body.arguments ?? {},
        );
        return applicationResult(operation, response, entry.output_schema);
      }
      if (isLegacyOperation(operation)) {
        const response = await executeLegacyOperation(
          {
            base,
            service,
            anon,
            principal: {
              id: dispatchUser.id,
              role: admin?.role ?? "",
              enabled: admin?.enabled === true,
            },
            rpc: (name, args) => db.rpc(name, args),
            fetch: fetchBackend,
          },
          bearer,
          operation,
          body.arguments ?? {},
        );
        return applicationResult(operation, response, entry.output_schema);
      }
      if (isOrchestrationOperation(operation)) {
        const response = await handleOrchestrationAction(
          db,
          dispatchUser.id,
          orchestrationActions[operation],
          body.arguments ?? {},
          body.channel === "mcp" ? "mcp" : "api",
        );
        return applicationResult(operation, response, entry.output_schema);
      }
      if (operation === "deployment.jobs.request") {
        const response = await requestLegacyDeploymentJob(
          db,
          dispatchUser.id,
          body.arguments ?? {},
        );
        return applicationResult(operation, response, entry.output_schema);
      }
      if (isEngineeringReadOperation(operation)) {
        if (!discoverableContract(entry)) {
          return reply(503, {
            error: "engineering_read_executor_contract_conflict",
            executed: false,
          });
        }
        const forwarded = buildEngineeringReadRequest(
          base,
          anon,
          bearer,
          operation,
          body.arguments ?? {},
        );
        if (!forwarded) {
          return reply(400, {
            error: "invalid_operation_arguments",
            executed: false,
          });
        }
        try {
          const response = await fetchBackend(forwarded.url, forwarded.init);
          const normalized = await normalizeEngineeringReadResponse(
            operation,
            body.arguments ?? {},
            response,
          );
          return upstreamResult(operation, normalized, entry.output_schema);
        } catch {
          return reply(502, engineeringReadTransportFailure());
        }
      }
      if (operation === "deployment.jobs.retry") {
        if (entry.verified !== true) {
          return reply(424, {
            error: "operation_requires_live_verification",
            executed: false,
          });
        }
        if (
          entry.handler !== "sandy-operation-api" ||
          entry.is_mutation !== true ||
          entry.permission_scope !== "deployment:write"
        ) {
          return reply(503, {
            error: "retry_executor_contract_conflict",
            executed: false,
          });
        }
        const admission = await requestReadJobRetry(
          db,
          dispatchUser.id,
          body.arguments ?? {},
        );
        const receipt: Record<string, unknown> = {
          ...admission.body,
          operation,
        };
        if (
          receipt.ok === true &&
          schemaValid(entry.output_schema, receipt) !== true
        ) {
          return reply(502, {
            error: "retry_result_invalid",
            accepted: null,
            executed: null,
            reconciliation_required: true,
          });
        }
        return reply(admission.status, receipt);
      }
      if (operation === "deployment.jobs.cancel") {
        if (entry.verified !== true) {
          return reply(424, {
            error: "operation_requires_live_verification",
            executed: false,
          });
        }
        const { data, error } = await Promise.resolve().then(() =>
          db.rpc("sandy_api_cancel_deployment_job", {
            p_job_id: (body.arguments as Record<string, unknown>).job_id,
            p_actor_id: dispatchUser.id,
          })
        ).catch(() => ({ data: null, error: true }));
        if (error) {
          return reply(502, {
            error: "cancellation_outcome_unknown",
            executed: null,
            reconciliation_required: true,
          });
        }
        if (!isObject(data) || data.ok !== true) {
          return reply(
            isObject(data) && [403, 404, 409].includes(Number(data.http_status))
              ? Number(data.http_status)
              : 503,
            {
              ok: false,
              error: isObject(data) && typeof data.error === "string"
                ? data.error
                : "cancellation_unavailable",
              executed: false,
            },
          );
        }
        if (schemaValid(entry.output_schema, data) !== true) {
          return reply(502, {
            error: "cancellation_result_invalid",
            executed: null,
            reconciliation_required: true,
          });
        }
        return reply(200, {
          ok: true,
          operation,
          executed: true,
          result: data,
        });
      }
      if (handler.functionName === "sandy-operations-api") {
        if (
          entry.is_mutation !== false ||
          entry.permission_scope !== `${operation.split(".")[0]}:read`
        ) {
          return reply(503, {
            error: "customer_executor_contract_conflict",
            executed: false,
          });
        }
        try {
          const response = await fetchBackend(
            `${base}/functions/v1/sandy-operations-api`,
            {
              method: "POST",
              headers: {
                authorization: `Bearer ${bearer}`,
                apikey: anon,
                "content-type": "application/json",
              },
              body: JSON.stringify({
                operation,
                arguments: body.arguments ?? {},
              }),
              signal: AbortSignal.timeout(20000),
            },
          );
          return upstreamResult(operation, response, entry.output_schema);
        } catch {
          return reply(502, {
            ok: false,
            error: "upstream_unavailable",
            executed: false,
          });
        }
      }
      if (handler.functionName === "sandy-memory-centre") {
        if (!discoverableContract(entry)) {
          return reply(503, {
            error: "memory_executor_contract_conflict",
            executed: false,
          });
        }
        const args = body.arguments ?? {};
        // Keep this check even if a registry contract is accidentally broadened:
        // neither tenant identity nor backend action can be caller-controlled.
        if (
          !isObject(args) ||
          (operation === "memory.evidence"
            ? Object.keys(args).some((key) => key !== "id") ||
              typeof args.id !== "string" ||
              !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i
                .test(args.id)
            : Object.keys(args).length !== 0)
        ) {
          return reply(400, {
            error: "invalid_operation_arguments",
            executed: false,
          });
        }
        try {
          const response = await fetchBackend(
            `${base}/functions/v1/sandy-memory-centre?op=${
              memoryReadActions[operation]
            }`,
            {
              method: "POST",
              headers: {
                authorization: `Bearer ${bearer}`,
                apikey: anon,
                "content-type": "application/json",
              },
              body: JSON.stringify(args),
              signal: AbortSignal.timeout(25000),
            },
          );
          return upstreamResult(operation, response, entry.output_schema);
        } catch {
          return reply(502, {
            ok: false,
            error: "upstream_unavailable",
            executed: false,
          });
        }
      }
      if (
        ["sandy-infrastructure-read", "sandy-provider-read-api"].includes(
          handler.functionName,
        )
      ) {
        if (!discoverableContract(entry)) {
          return reply(503, {
            error: "read_executor_contract_conflict",
            executed: false,
          });
        }
        // These are global infrastructure records. Never grant a tenant caller
        // the service credential; only the already authenticated Controller admin
        // reaches this fixed read-only handler through this gateway.
        const args = body.arguments ?? {};
        if (
          handler.functionName === "sandy-provider-read-api" &&
          dependencies.executionPolicy && !_admission
        ) {
          return reply(424, {
            ok: false,
            error: "consumed_read_admission_required",
            executed: false,
          });
        }
        if (
          !isObject(args) ||
          (args.limit !== undefined &&
            (!Number.isInteger(args.limit) || Number(args.limit) < 1 ||
              Number(args.limit) > 200))
        ) {
          return reply(400, {
            error: "invalid_operation_arguments",
            executed: false,
          });
        }
        try {
          const response = await fetchBackend(
            `${base}/functions/v1/${handler.functionName}`,
            {
              method: "POST",
              headers: {
                authorization: `Bearer ${service}`,
                apikey: service,
                "content-type": "application/json",
              },
              body: JSON.stringify({
                operation,
                arguments: args,
                ...(handler.functionName === "sandy-provider-read-api" &&
                    _admission
                  ? {
                    protocol: "consumed-admission-v1",
                    actor_id: dispatchUser.id,
                    tenant_id: null,
                    request_id: _admission.requestId,
                    grant_id: _admission.grantId,
                    admission_id: _admission.admissionId,
                    credential_id: delegation?.credentialId ?? null,
                  }
                  : {}),
              }),
              signal: AbortSignal.timeout(20000),
            },
          );
          if (handler.functionName === "sandy-provider-read-api") {
            if (!response.ok) {
              return applicationResult(
                operation,
                response,
                entry.output_schema,
              );
            }
            const statusHeader = response.headers.get(
              "x-sandy-provider-http-status",
            );
            const providerStatus =
              statusHeader !== null && /^[1-5][0-9]{2}$/.test(statusHeader)
                ? Number(statusHeader)
                : undefined;
            return upstreamResult(
              operation,
              response,
              entry.output_schema,
              providerStatus,
            );
          }
          return upstreamResult(operation, response, entry.output_schema);
        } catch {
          return reply(502, {
            ok: false,
            error: "upstream_unavailable",
            executed: false,
          });
        }
      }
      if (Object.hasOwn(videoReadActions, operation)) {
        if (
          entry.handler !== "sandy-deploy-provision" ||
          entry.is_mutation !== false ||
          entry.permission_scope !== "infrastructure:read"
        ) {
          return reply(503, {
            error: "video_read_executor_contract_conflict",
            executed: false,
          });
        }
        const args = body.arguments ?? {};
        if (
          !isObject(args) || Object.keys(args).some((key) =>
            operation !== "video.status" || key !== "target"
          ) || (args.target !== undefined && args.target !== "sandy-video")
        ) {
          return reply(400, {
            error: "invalid_operation_arguments",
            executed: false,
          });
        }
        try {
          // Retain the existing fixed read actions, including the effective
          // single OS Config check for video.execution.preflight. The API owns
          // caller authorization; the provider handler receives only its service
          // identity and cannot be retargeted or given an action by the caller.
          const response = await fetchBackend(
            `${base}/functions/v1/sandy-deploy-provision`,
            {
              method: "POST",
              headers: {
                authorization: `Bearer ${service}`,
                apikey: service,
                "content-type": "application/json",
              },
              body: JSON.stringify({ action: videoReadActions[operation] }),
              signal: AbortSignal.timeout(45000),
            },
          );
          return upstreamResult(operation, response, entry.output_schema);
        } catch {
          return reply(502, {
            ok: false,
            error: "upstream_unavailable",
            executed: false,
          });
        }
      }
      if (operation === "deployment.management.release") {
        const args = body.arguments;
        if (
          !isObject(args) || Object.keys(args).some((key) =>
            !["function_slug", "source_ref", "change_id"].includes(key)
          ) ||
          typeof args.function_slug !== "string" ||
          !["sandy-operation-api", "sandy-api-mcp"].includes(
            args.function_slug,
          ) ||
          args.source_ref !== "main" || typeof args.change_id !== "string" ||
          !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i
            .test(
              args.change_id,
            )
        ) {
          return reply(400, {
            error: "invalid_release_parameters",
            executed: false,
          });
        }
        let response: Response;
        try {
          response = await fetchBackend(
            `${base}/functions/v1/${handler.functionName}`,
            {
              method: "POST",
              headers: {
                authorization: `Bearer ${service}`,
                apikey: service,
                "content-type": "application/json",
              },
              body: JSON.stringify({ action: handler.action, ...args }),
              signal: AbortSignal.timeout(45000),
            },
          );
        } catch {
          return reply(502, {
            ok: false,
            error: "release_backend_unavailable",
            executed: null,
            reconciliation_required: true,
          });
        }
        return upstreamResult(operation, response, entry.output_schema);
      }
      const args = body.arguments;
      const administratorRead = operation === "engineering.preflight" && isObject(args) &&
        Object.keys(args).length === 1 && args.connection === "sandy-gcp-admin";
      if (
        args !== undefined &&
        (!isObject(args) || Object.keys(args).length !== 0) && !administratorRead
      ) {
        return reply(400, {
          error: "operation_accepts_no_arguments",
          executed: false,
        });
      }
      if (administratorRead && admin?.role !== "owner") {
        return reply(403, { error: "administrator_read_owner_authority_required", executed: false });
      }
      let response: Response;
      try {
        // Engineering Control must receive the authenticated controller user's JWT.
        response = await fetchBackend(
          `${base}/functions/v1/${handler.functionName}`,
          {
            method: "POST",
            headers: {
              authorization: `Bearer ${bearer}`,
              apikey: anon,
              "content-type": "application/json",
            },
            body: JSON.stringify({ action: handler.action, ...(administratorRead ? { connection: "sandy-gcp-admin" } : {}) }),
            signal: AbortSignal.timeout(administratorRead ? 95000 : 20000),
          },
        );
      } catch {
        return reply(502, {
          ok: false,
          error: "upstream_unavailable",
          executed: false,
        });
      }
      return upstreamResult(operation, response, entry.output_schema);
    };
    if (
      dependencies.executionPolicy && !delegation && !customerKey &&
      admin?.role !== "owner" && admittedCustomerReads.includes(operation) &&
      entry.is_mutation === false
    ) {
      const authenticatedDb = dependencies.authenticatedDb
        ? dependencies.authenticatedDb(bearer)
        : createClient(base, anon, {
          global: { headers: { Authorization: `Bearer ${bearer}` } },
          auth: { persistSession: false },
        });
      return governedCustomerRead(
        db,
        authenticatedDb,
        dispatchUser.id,
        operation,
        body.arguments ?? {},
        request.headers.get("x-sandy-request-id") ?? crypto.randomUUID(),
        await executionContractDigest(entry),
        originalChannel,
        () => dispatch(),
      );
    }
    if (
      dependencies.executionPolicy && admin?.role === "owner" &&
      !extensionOwnsUserAdmission(operation) &&
      (entry.is_mutation === false || !!providerOperations[operation] ||
        extensionOwnsGrant(operation)) &&
      !isPolicyOperation(operation) &&
      !(lifecycleEngineeringProof && isProviderLifecycleOperation(operation))
    ) {
      const contractSha256 = await executionContractDigest(entry);
      let scope: unknown;
      try {
        scope = extensionOwnsGrant(operation)
          ? await extensionExecutionScope(
            operation,
            isObject(body.arguments) ? body.arguments : {},
            dispatchUser.id,
            async (id) => {
              if (
                typeof id !== "string" ||
                !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i
                  .test(id)
              ) return null;
              const { data, error } = await db.from("sandy_credential_targets")
                .select(
                  "id,provider,resource,enabled,verified,config_sha256,scope_sha256",
                ).eq("id", id).maybeSingle();
              if (error) throw Error("verified_credential_target_required");
              return data;
            },
            {
              restoreBindings: dependencies.packageRestoreBindings,
              getProtocolBindings: async (actorId: string) => {
                const selected = await db.rpc(
                  "sandy_vm_protocol_public_bindings",
                  { p_actor: actorId },
                );
                return selected.error ? undefined : selected.data;
              },
              providerBindings: dependencies.providerConfig?.verifiedBindings,
            },
          )
          : providerOperations[operation]
          ? providerExecutionScope(operation, dependencies.providerConfig)
          : {
            sandy_project_ref: "zmqlyygzqoidkcwdysok",
            permission_scope: entry.permission_scope,
          };
      } catch (error) {
        return reply(424, {
          ok: false,
          error: error instanceof Error &&
              (/^verified_[a-z_]+_scope_binding_required$/.test(
                error.message,
              ) ||
                [
                  "verified_credential_target_required",
                  "verified_vm_protocol_binding_required",
                  "fixed_vm_required",
                ]
                  .includes(error.message))
            ? error.message
            : "provider_scope_configuration_required",
          executed: false,
        });
      }
      const declaredUnits = request.headers.get("x-sandy-declared-units") ??
        "0";
      if (!/^\d{1,7}$/.test(declaredUnits) || Number(declaredUnits) > 1000000) {
        return reply(400, {
          error: "invalid_declared_unit_budget",
          executed: false,
        });
      }
      return governedExecution(
        db,
        {
          actorId: dispatchUser.id,
          tenantId: null,
          operation,
          arguments: body.arguments ?? {},
          requestId: delegation?.boundExecution?.dispatchId ??
            request.headers.get("x-sandy-request-id") ?? crypto.randomUUID(),
          credentialId: delegation?.credentialId ?? null,
          contractSha256,
          scope,
          declaredCostUnits: Number(declaredUnits),
          approvalId: request.headers.get("x-sandy-approval-id"),
        },
        dispatch,
        !!providerOperations[operation] || extensionOwnsGrant(operation),
      );
    }
    return dispatch();
  };
}

if (import.meta.main) {
  const base = Deno.env.get("SUPABASE_URL") ?? "";
  const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const anon = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
  if (!base || !service) {
    Deno.serve(() => reply(503, { error: "api_configuration_missing" }));
  } else {
    const db = createClient(base, service, { auth: { persistSession: false } });
    Deno.serve(createOperationHandler({
      base,
      service,
      anon,
      db,
      resolveCredential: createCredentialResolver(db, service, anon),
      executionPolicy: true,
      catalogueRpc: true,
      providerConfig: {
        verifiedBindings: parseProviderBindings(
          Deno.env.get("SANDY_GCP_SCOPE_BINDINGS_JSON"),
        ),
      },
      packageRestoreBindings: parsePackageRestoreBindings(
        Deno.env.get("SANDY_GITHUB_PACKAGE_RESTORE_BINDINGS_JSON"),
      ),
    }));
  }
}
