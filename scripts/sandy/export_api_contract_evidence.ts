/** Export reviewed contract metadata without invoking handlers or providers.
 * Run with Deno and redirect stdout to a release evidence JSON file.
 * This is source evidence only; it never establishes deployment or verification.
 */
import { legacyOperationContracts } from "../../supabase/functions/sandy-operation-api/legacy_operations.ts";
import { customerOperationContracts } from "../../supabase/functions/sandy-operation-api/customer_operations.ts";
import { customerServiceContracts } from "../../supabase/functions/sandy-operation-api/customer_services.ts";
import { customerMutationContracts } from "../../supabase/functions/sandy-operation-api/customer_mutations.ts";
import { agendaContracts } from "../../supabase/functions/sandy-operation-api/agenda_contracts.ts";
import { customerKeyContracts } from "../../supabase/functions/sandy-operation-api/customer_keys.ts";
import { memoryOperationContracts } from "../../supabase/functions/sandy-operation-api/memory_contracts.ts";
import { policyOperationContracts } from "../../supabase/functions/sandy-operation-api/policy_operations.ts";
import { providerLifecycleContracts } from "../../supabase/functions/sandy-operation-api/provider_lifecycle.ts";
import {
  MCP_DISCOVERY_OPERATION,
  mcpDiscoveryContract,
} from "../../supabase/functions/sandy-operation-api/mcp_diagnostics.ts";
import { orchestrationContracts } from "../../supabase/functions/sandy-orchestration-api/contracts.ts";
import { agentOperationContracts } from "../../supabase/functions/_shared/sandy-agent-operations/contracts.ts";
import { internalRuntimeRecordContracts } from "../../supabase/functions/_shared/sandy-agent-operations/runtime_record_contracts.ts";
import { internalRuntimeOperationalContracts } from "../../supabase/functions/_shared/sandy-agent-operations/runtime_operational_contracts.ts";
import {
  runtimeConversationContract,
  runtimeConversationOperation,
} from "../../supabase/functions/_shared/sandy-agent-operations/runtime_conversation_contract.ts";
import { productOperations } from "../../supabase/functions/sandy-product-service-api/contracts.ts";
import { databaseOperations } from "../../supabase/functions/sandy-database-operation-api/gateway.ts";
import { providerOperations } from "../../supabase/functions/sandy-provider-operation-api/gateway.ts";
import { providerExpansionOperations } from "../../supabase/functions/sandy-provider-operation-api/expansion_gateway.ts";
import { credentialOperations } from "../../supabase/functions/sandy-credential-lifecycle-api/gateway.ts";
import { serviceOperations } from "../../supabase/functions/sandy-supabase-service-api/gateway.ts";
import { tenantConsentOperations } from "../../supabase/functions/sandy-supabase-service-api/tenant_consent.ts";
import { gapGatewayOperations } from "../../supabase/functions/sandy-provider-gap-api/gateway.ts";
import { supplementOperations } from "../../supabase/functions/sandy-provider-supplement-api/gateway.ts";
import { tenantLifecycleOperations } from "../../supabase/functions/sandy-tenant-lifecycle-api/gateway.ts";
import { tenantExportDownloadOperation } from "../../supabase/functions/sandy-tenant-lifecycle-api/download.ts";
import { tenantLifecycleConsentOverride } from "../../supabase/functions/sandy-tenant-lifecycle-api/consent_extension.ts";
import guestManifest from "../../supabase/functions/sandy-guest-operation-api/contracts.json" with {
  type: "json",
};

type Row = Record<string, unknown>;
const groups: {
  name: string;
  source_path: string;
  handler_source_path: string;
  handler: string;
  contracts: Record<string, unknown>;
}[] = [];
function add(
  name: string,
  source: string,
  contracts: unknown,
  handler: string,
  handlerSource = source,
) {
  groups.push({
    name,
    source_path: `supabase/functions/${source}`,
    handler_source_path: `supabase/functions/${handlerSource}`,
    handler,
    contracts: contracts as Record<string, unknown>,
  });
}
add(
  "legacy_application",
  "sandy-operation-api/legacy_operations.ts",
  legacyOperationContracts,
  "",
);
add(
  "customer_workspace_composio",
  "sandy-operation-api/customer_operations.ts",
  customerOperationContracts,
  "",
);
add(
  "customer_services",
  "sandy-operation-api/customer_service_contracts.ts",
  customerServiceContracts,
  "",
  "sandy-operation-api/customer_services.ts",
);
add(
  "customer_atomic_mutations",
  "sandy-operation-api/customer_mutations.ts",
  customerMutationContracts,
  "sandy-operations-api",
);
add(
  "agenda",
  "sandy-operation-api/agenda_contracts.ts",
  agendaContracts,
  "sandy-agenda",
  "sandy-operation-api/agenda_operations.ts",
);
add(
  "customer_keys",
  "sandy-operation-api/customer_keys.ts",
  customerKeyContracts,
  "sandy-operations-api",
);
add(
  "memory",
  "sandy-operation-api/memory_contracts.ts",
  memoryOperationContracts,
  "sandy-memory-centre",
  "sandy-operation-api/memory_operations.ts",
);
add(
  "policy",
  "sandy-operation-api/policy_operations.ts",
  policyOperationContracts,
  "sandy-operation-api",
);
add(
  "provider_lifecycle",
  "sandy-operation-api/provider_lifecycle.ts",
  providerLifecycleContracts,
  "sandy-operation-api",
);
add("mcp_diagnostic", "sandy-operation-api/mcp_diagnostics.ts", {
  [MCP_DISCOVERY_OPERATION]: mcpDiscoveryContract,
}, "sandy-operation-api");
add(
  "orchestration",
  "sandy-orchestration-api/contracts.ts",
  Object.fromEntries(orchestrationContracts.map((c) => [c.operation, c])),
  "sandy-orchestration-api",
  "sandy-orchestration-api/index.ts",
);
add(
  "agent",
  "_shared/sandy-agent-operations/contracts.ts",
  agentOperationContracts,
  "sandy-agent-operation-api",
  "_shared/sandy-agent-operations/service.ts",
);
add(
  "database",
  "sandy-database-operation-api/gateway.ts",
  databaseOperations,
  "sandy-database-operation-api",
  "sandy-database-operation-api/index.ts",
);
add(
  "provider",
  "sandy-provider-operation-api/gateway_manifest.json",
  providerOperations,
  "sandy-provider-operation-api",
  "sandy-provider-operation-api/index.ts",
);
add(
  "credential_custody",
  "sandy-credential-lifecycle-api/gateway_manifest.json",
  credentialOperations,
  "sandy-credential-lifecycle-api",
  "sandy-credential-lifecycle-api/index.ts",
);
add(
  "managed_guest",
  "sandy-guest-operation-api/contracts.json",
  Object.fromEntries(guestManifest.operations.map((c) => [c.operation, c])),
  "sandy-guest-operation-api",
  "sandy-guest-operation-api/index.ts",
);
add(
  "supabase_services",
  "sandy-supabase-service-api/contracts.ts",
  serviceOperations,
  "sandy-supabase-service-api",
  "sandy-supabase-service-api/index.ts",
);
add(
  "tenant_service_consent",
  "sandy-supabase-service-api/tenant_consent.ts",
  {
    ...tenantConsentOperations,
    [tenantLifecycleConsentOverride.operation]: tenantLifecycleConsentOverride,
  },
  "sandy-operation-api",
);
add(
  "provider_gaps",
  "sandy-provider-gap-api/gateway_manifest.json",
  gapGatewayOperations,
  "sandy-provider-gap-api",
  "sandy-provider-gap-api/index.ts",
);
add(
  "provider_constituents",
  "sandy-provider-operation-api/expansion_gateway_manifest.json",
  providerExpansionOperations,
  "sandy-provider-operation-api",
  "sandy-provider-operation-api/index.ts",
);
add(
  "product_services",
  "sandy-product-service-api/contracts.json",
  productOperations,
  "sandy-product-service-api",
  "sandy-product-service-api/index.ts",
);
add(
  "internal_runtime_records",
  "_shared/sandy-agent-operations/runtime_record_contracts.ts",
  Object.fromEntries(
    Object.entries(internalRuntimeRecordContracts).map((
      [operation, contract],
    ) => [
      operation,
      { ...contract, handler: `internal:${operation}@1.0.0` },
    ]),
  ),
  "",
  "_shared/sandy-agent-operations/runtime_records.ts",
);
add(
  "internal_runtime_conversation",
  "_shared/sandy-agent-operations/runtime_conversation_contract.ts",
  { [runtimeConversationOperation]: runtimeConversationContract },
  "internal:agent.runtime.conversation.respond@1.0.0",
  "_shared/sandy-agent-operations/runtime_conversation.ts",
);
add(
  "tenant_lifecycle",
  "sandy-tenant-lifecycle-api/gateway.ts",
  tenantLifecycleOperations,
  "sandy-tenant-lifecycle-api",
  "sandy-tenant-lifecycle-api/index.ts",
);
add(
  "tenant_export_download",
  "sandy-tenant-lifecycle-api/download.ts",
  { [tenantExportDownloadOperation.operation]: tenantExportDownloadOperation },
  "sandy-operation-api",
);
add(
  "provider_supplement",
  "sandy-provider-supplement-api/gateway_manifest.json",
  supplementOperations,
  "sandy-provider-supplement-api",
  "sandy-provider-supplement-api/index.ts",
);
add(
  "internal_runtime_operational",
  "_shared/sandy-agent-operations/runtime_operational_contracts.ts",
  Object.fromEntries(
    Object.entries(internalRuntimeOperationalContracts).map((
      [operation, contract],
    ) => [
      operation,
      { ...contract, handler: `internal:${operation}@1.0.0` },
    ]),
  ),
  "",
  "_shared/sandy-agent-operations/runtime_operational.ts",
);
const rows: Row[] = [];
for (const group of groups) {
  for (const [operation, value] of Object.entries(group.contracts)) {
    const contract = value as Row;
    const explicit = contract.requirement_ids ?? contract.requirements ??
      (contract.requirement == null ? [] : [contract.requirement]);
    if (
      !Array.isArray(explicit) ||
      explicit.some((n) =>
        !Number.isInteger(n) || Number(n) < 1 || Number(n) > 161
      )
    ) throw Error(`Invalid requirement metadata: ${operation}`);
    rows.push({
      operation,
      group: group.name,
      source_path: group.source_path,
      handler_source_path: group.handler_source_path,
      handler: contract.handler ?? group.handler,
      is_mutation: contract.is_mutation === true,
      requirement_ids: explicit,
      contract_sha256: contract.contract_sha256 ?? null,
      known_backend_dependency: contract.known_backend_dependency ?? null,
      evidence_level:
        "source_contract_only_not_deployment_or_functional_verification",
    });
  }
}
const seen = new Set<string>();
for (const row of rows) {
  if (
    typeof row.operation !== "string" ||
    !/^[a-z][a-z0-9_.-]{2,100}$/.test(row.operation) || seen.has(row.operation)
  ) throw Error(`Invalid/duplicate contract: ${row.operation}`);
  seen.add(row.operation);
}
const gatewayIds = Deno.args.includes("--include-gateway")
  ? (await import("../../supabase/functions/sandy-operation-api/index.ts"))
    .installedOperationIds
  : null;
console.log(
  JSON.stringify(
    {
      schema_version: 1,
      source_only: true,
      contract_count: rows.length,
      installed_operation_ids: gatewayIds,
      groups: groups.map(({ contracts, ...group }) => ({
        ...group,
        count: Object.keys(contracts).length,
      })),
      contracts: rows.sort((a, b) =>
        String(a.operation).localeCompare(String(b.operation))
      ),
    },
    null,
    2,
  ),
);
