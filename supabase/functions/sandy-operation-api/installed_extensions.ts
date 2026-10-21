/** Composition of installed application services. No provider business logic or
 * caller-selected transport is implemented here; the live registry is the catalogue. */
import {
  agendaContractMatches,
  agendaContracts,
  executeAgendaOperation,
  isAgendaOperation,
} from "./agenda_operations.ts";
import {
  customerKeyContractMatches,
  customerKeyContracts,
  executeCustomerKeyOperation,
  isCustomerKeyOperation,
} from "./customer_keys.ts";
import {
  executeMemoryOperation,
  isMemoryOperation,
  memoryContractMatches,
  memoryOperationContracts,
} from "./memory_operations.ts";
import { type CustomerServiceDependencies } from "./customer_services.ts";
import {
  agentContractMatches,
  agentOperationContracts,
} from "../_shared/sandy-agent-operations/contracts.ts";
import {
  guestExecutionScope,
  guestOperations,
} from "../sandy-guest-operation-api/index.ts";
import {
  databaseCapability,
  databaseExecutionScope,
  databaseOperations,
} from "../sandy-database-operation-api/gateway.ts";
import {
  credentialExecutionScope,
  credentialOperations,
  type Target,
} from "../sandy-credential-lifecycle-api/gateway.ts";
import {
  providerLifecycleContractMatches,
  providerLifecycleContracts,
} from "./provider_lifecycle.ts";
import {
  serviceExecutionScope,
  serviceOperations,
} from "../sandy-supabase-service-api/gateway.ts";
import {
  executeTenantConsent,
  type TenantConsentDb,
  tenantConsentOperations,
} from "../sandy-supabase-service-api/tenant_consent.ts";
import {
  gapExecutionScope,
  gapGatewayOperations,
  type ScopeBinding,
} from "../sandy-provider-gap-api/gateway.ts";
export {
  parsePackageRestoreBindings,
  type ScopeBinding,
} from "../sandy-provider-gap-api/gateway.ts";
export type { TenantConsentDb } from "../sandy-supabase-service-api/tenant_consent.ts";

type Obj = Record<string, unknown>;
export type ExtensionKind =
  | "agenda"
  | "customer_key"
  | "memory"
  | "agent"
  | "guest"
  | "database"
  | "credential"
  | "supabase_service"
  | "tenant_consent"
  | "provider_gap"
  | "lifecycle";
export type ExtensionContract = {
  kind: ExtensionKind;
  handler: string;
  permission_scope: string;
  is_mutation: boolean;
  input_schema?: Obj;
  output_schema?: Obj;
  contract_sha256?: string;
  requires_grant?: boolean;
};
const object = (v: unknown): v is Obj =>
  v !== null && typeof v === "object" && !Array.isArray(v);
const grouped = <
  T extends {
    permission_scope: string;
    is_mutation: boolean;
    input_schema?: Obj;
    output_schema?: Obj;
  },
>(
  records: Readonly<Record<string, T>>,
  kind: ExtensionKind,
  handler: string,
): [string, ExtensionContract][] =>
  Object.entries(records).map((
    [operation, contract],
  ) => [operation, {
    ...contract,
    kind,
    handler: "handler" in contract && typeof contract.handler === "string"
      ? contract.handler
      : handler,
  }]);
export const extensionContracts: Readonly<Record<string, ExtensionContract>> =
  Object.freeze(Object.fromEntries([
    ...grouped(agendaContracts, "agenda", "sandy-agenda"),
    ...grouped(customerKeyContracts, "customer_key", "sandy-operations-api"),
    ...grouped(memoryOperationContracts, "memory", "sandy-memory-centre"),
    ...grouped(agentOperationContracts, "agent", "sandy-agent-operation-api"),
    ...grouped(guestOperations, "guest", "sandy-guest-operation-api"),
    ...grouped(databaseOperations, "database", "sandy-database-operation-api"),
    ...grouped(
      credentialOperations,
      "credential",
      "sandy-credential-lifecycle-api",
    ),
    ...grouped(providerLifecycleContracts, "lifecycle", "sandy-operation-api"),
    ...grouped(
      serviceOperations,
      "supabase_service",
      "sandy-supabase-service-api",
    ),
    ...grouped(
      tenantConsentOperations,
      "tenant_consent",
      "sandy-operation-api",
    ),
    ...grouped(gapGatewayOperations, "provider_gap", "sandy-provider-gap-api"),
  ]));
export const extensionHandlers = Object.freeze(
  Object.fromEntries(
    Object.entries(extensionContracts).map((
      [operation, contract],
    ) => [operation, { functionName: contract.handler }]),
  ),
);
export const extensionKind = (operation: string): ExtensionKind | undefined =>
  extensionContracts[operation]?.kind;
export const extensionNeedsPortal = (operation: string) =>
  ["agenda", "memory", "agent", "tenant_consent"].includes(
    extensionKind(operation) ?? "",
  );
export const extensionNeedsAgenda = (operation: string) =>
  ["agenda", "customer_key"].includes(extensionKind(operation) ?? "");
export const extensionOwnsGrant = (operation: string) =>
  ["guest", "database", "credential", "supabase_service", "provider_gap"]
    .includes(extensionKind(operation) ?? "");
export const extensionOwnerOnly = (operation: string) =>
  extensionOwnsGrant(operation) || extensionKind(operation) === "lifecycle" ||
  (extensionKind(operation) === "agent" &&
    agentOperationContracts[operation].owner_only);
export const extensionRequiresUserSession = (operation: string) =>
  !!extensionKind(operation) && operation !== "system.lifecycle.poll";
export function extensionHasAccess(
  operation: string,
  principal: CustomerServiceDependencies["principal"],
  emailConfirmed: boolean,
): boolean {
  switch (extensionKind(operation)) {
    case "agenda":
      return !!principal.portalCustomerId &&
        principal.portalCustomerId === principal.agendaCustomerId;
    case "customer_key":
      return !!principal.agendaCustomerId && emailConfirmed;
    case "memory":
      return !!principal.portalCustomerId;
    case "tenant_consent":
      return !!principal.portalCustomerId && emailConfirmed;
    case "agent":
      return !!principal.portalCustomerId &&
        (!agentOperationContracts[operation].owner_only ||
          principal.controllerOwner);
    case "guest":
    case "database":
    case "credential":
    case "lifecycle":
    case "supabase_service":
    case "provider_gap":
      return principal.controllerOwner;
    default:
      return false;
  }
}
export function extensionContractMatches(
  operation: string,
  entry: Obj,
): boolean {
  if (isAgendaOperation(operation)) {
    return agendaContractMatches(operation, entry);
  }
  if (isCustomerKeyOperation(operation)) {
    return customerKeyContractMatches(operation, entry);
  }
  if (isMemoryOperation(operation)) {
    return memoryContractMatches(operation, entry);
  }
  const c = extensionContracts[operation];
  if (!c) return false;
  if (c.kind === "agent") return agentContractMatches(operation, entry);
  if (c.kind === "lifecycle") {
    return providerLifecycleContractMatches(operation, entry);
  }
  return entry.handler === c.handler &&
    entry.permission_scope === c.permission_scope &&
    entry.is_mutation === c.is_mutation &&
    object(entry.error_contract) &&
    entry.error_contract.contract_sha256 === c.contract_sha256;
}
export function extensionAvailability(
  operation: string,
  entry: Obj,
): { executable: boolean; unavailable_reason?: string } | null {
  const kind = extensionKind(operation);
  if (!kind) return null;
  if (
    kind === "guest" &&
    guestOperations[operation].kind === "unsupported_transport"
  ) {
    return {
      executable: false,
      unavailable_reason: operation.includes(".ssh.")
        ? "guest_ssh_transport_unavailable"
        : "guest_winrm_transport_unavailable",
    };
  }
  if (
    (entry.is_mutation === true ||
      (kind === "provider_gap"
        ? extensionContracts[operation].requires_grant === true
        : extensionOwnsGrant(operation))) &&
    entry.verified !== true
  ) {
    return {
      executable: false,
      unavailable_reason: "operation_requires_live_verification",
    };
  }
  if (kind === "database") return databaseCapability(operation);
  return { executable: true };
}
export async function executeUserExtension(
  deps: CustomerServiceDependencies & {
    emailConfirmed: boolean;
    userDb?: TenantConsentDb;
  },
  bearer: string,
  operation: string,
  args: unknown,
): Promise<Response | null> {
  switch (extensionKind(operation)) {
    case "agenda":
      return executeAgendaOperation(deps, bearer, operation, args);
    case "customer_key":
      return executeCustomerKeyOperation(deps, bearer, operation, args);
    case "memory":
      return executeMemoryOperation(deps, bearer, operation, args);
    case "tenant_consent":
      return deps.userDb
        ? executeTenantConsent(deps.userDb, operation, args)
        : Response.json({
          ok: false,
          error: "tenant_consent_session_required",
          executed: false,
        }, { status: 503, headers: { "cache-control": "no-store" } });
    default:
      return null;
  }
}
export async function extensionExecutionScope(
  operation: string,
  args: Obj,
  actorId: string,
  getCredentialTarget: (id: unknown) => Promise<unknown>,
  options?: { restoreBindings?: ScopeBinding[] },
): Promise<unknown> {
  const kind = extensionKind(operation);
  if (kind === "database") return databaseExecutionScope(operation);
  if (kind === "supabase_service") return serviceExecutionScope(operation);
  if (kind === "provider_gap") {
    return gapExecutionScope(operation, options?.restoreBindings);
  }
  if (kind === "guest") {
    return guestOperations[operation].kind === "task_status"
      ? {
        provider: "gcp_guest",
        project_id: "elaborate-haven-511518-a5",
        receipt_actor_id: actorId,
      }
      : guestExecutionScope(String(args.vm_name));
  }
  if (kind === "credential") {
    const target = await getCredentialTarget(args.target_id);
    if (!object(target)) throw Error("verified_credential_target_required");
    try {
      return await credentialExecutionScope(target as Target);
    } catch {
      throw Error("verified_credential_target_required");
    }
  }
  throw Error("extension_scope_not_defined");
}
