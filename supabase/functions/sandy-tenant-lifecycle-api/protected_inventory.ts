/** Safe metadata only. This operation neither exports credential material nor
 * restores/revokes credentials, consent, access grants or retention controls. */
import { Ajv, type ValidateFunction } from "npm:ajv@8.17.1";
import { fullFormats } from "npm:ajv-formats@3.0.1/dist/formats.js";
import {
  argumentDigest,
  canonicalJson,
} from "../_shared/sandy_api_protocol.ts";
import { tenantLifecycleScope } from "./contracts.ts";
type Obj = Record<string, unknown>;
const object = (value: unknown): value is Obj =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const obj = (properties: Obj): Obj => ({
  type: "object",
  properties,
  required: Object.keys(properties),
  additionalProperties: false,
});
const uuid = { type: "string", format: "uuid" };
const date = { type: "string", format: "date-time" };
const nilDate = { anyOf: [date, { type: "null" }] };
const count = { type: "integer", minimum: 0, maximum: 2147483647 };
const offset = { type: "integer", minimum: 0, maximum: 2147483000 };
const limit = { type: "integer", minimum: 1, maximum: 50 };
const scopes = {
  type: "array",
  maxItems: 256,
  items: { type: "string", minLength: 1, maxLength: 200 },
};
const str = (maxLength = 100) => ({ type: "string", maxLength });
export const protectedInventoryOperationName =
  "supabase.tenant.protected_resources.inventory";
export const protectedInventoryRpcName = "sandy_tenant_protected_inventory";
export const protectedInventoryScope = tenantLifecycleScope;
export const protectedInventoryResources = Object.freeze({
  sandy_operations_keys: {
    ownership: "customer_id",
    revocation: "dedicated_key_revocation_required_before_purge",
    retention: "retain_current_revocation_and_audit_evidence",
    fields: {
      id: uuid,
      scopes,
      created_at: date,
      last_used_at: nilDate,
      expires_at: nilDate,
      revoked_at: nilDate,
    },
  },
  sandy_api_keys: {
    ownership: "separate_api_tenant_namespace",
    unavailable: "no_customer_ownership_mapping",
    revocation: "ownership_mapping_required_before_revocation",
    retention: "preserve_unmapped_credentials_and_existing_audit",
    fields: {},
  },
  sandy_api_credentials: {
    ownership: "owner_principal_credential_namespace",
    unavailable: "customer_credential_execution_not_supported",
    revocation: "preserve_unrelated_owner_principal_credentials",
    retention: "preserve_unmapped_credentials_and_existing_audit",
    fields: {},
  },
  sandy_computer_api_grants: {
    ownership: "separate_api_tenant_namespace",
    unavailable: "no_customer_ownership_mapping",
    revocation: "ownership_mapping_required_before_revocation",
    retention: "preserve_current_access_decisions_and_existing_audit",
    fields: {},
  },
  sandy_context_api_grants: {
    ownership: "customer_id_grantee_not_api_tenant_owner",
    revocation: "dedicated_authorized_grant_deactivation_required",
    retention: "preserve_current_access_decisions_and_existing_audit",
    fields: {
      id: uuid,
      api_tenant_id: uuid,
      capabilities: scopes,
      active: { type: "boolean" },
      created_at: date,
    },
  },
  sandy_calendar_connections: {
    ownership: "customer_id",
    revocation: "provider_revocation_and_readback_required",
    retention: "current_policy_and_provider_retention_apply",
    fields: {
      id: uuid,
      provider: str(),
      direction: str(),
      connection_state: str(),
      last_sync_at: nilDate,
      created_at: date,
      updated_at: date,
    },
  },
  sandy_xero_connections: {
    ownership: "owner_customer_id",
    revocation: "provider_revocation_and_readback_required",
    retention: "current_policy_and_provider_retention_apply",
    fields: {
      id: uuid,
      status: str(),
      scopes,
      token_expires_at: nilDate,
      last_sync_at: nilDate,
      created_at: date,
      updated_at: date,
    },
  },
  sandy_voice_call_links: {
    ownership: "owner_customer_id",
    revocation: "dedicated_capability_revocation_required_before_purge",
    retention: "retain_current_revocation_and_audit_evidence",
    fields: {
      id: uuid,
      created_at: date,
      expires_at: date,
      revoked_at: nilDate,
      max_starts: count,
      starts: count,
      last_started_at: nilDate,
    },
  },
  sandy_supabase_tenant_consents: {
    ownership: "tenant_id_confirmed_customer",
    revocation: "current_consent_never_restored_from_snapshot",
    retention: "preserve_current_consent_and_immutable_evidence",
    fields: {
      operations: scopes,
      allow_erasure: { type: "boolean" },
      expires_at: date,
      revision: { type: "integer", minimum: 1 },
      updated_at: date,
    },
  },
  sandy_supabase_tenant_controls: {
    ownership: "tenant_id_confirmed_customer",
    revocation: "legal_hold_and_retention_are_not_credential_state",
    retention: "never_release_hold_or_shorten_retention_from_snapshot",
    fields: {
      legal_hold: { type: "boolean" },
      retention_until: nilDate,
      updated_at: date,
    },
  },
  sandy_supabase_managed_vault: {
    ownership: "tenant_id_confirmed_customer",
    revocation: "dedicated_credential_custody_required_before_purge",
    retention: "retain_custody_evidence_without_secret_material",
    fields: { name: { type: "string", pattern: "^[a-z][a-z0-9_-]{0,63}$" } },
  },
});
const pageSchemas = Object.fromEntries(
  Object.entries(protectedInventoryResources).map(([name, resource]) => {
    const unavailable = "unavailable" in resource;
    const common = {
      ownership: { const: resource.ownership },
      revocation_disposition: { const: resource.revocation },
      retention_disposition: { const: resource.retention },
      generic_restore_permitted: { const: false },
      offset,
      limit,
    };
    const missing = obj({
      ...common,
      status: { const: "schema_unavailable" },
      reason: { const: "reviewed_metadata_schema_not_available" },
      total_count: { type: "null" },
      items: { type: "array", maxItems: 0 },
      next_offset: { type: "null" },
    });
    return [
      name,
      unavailable
        ? obj({
          ...common,
          status: { const: "ownership_mapping_unavailable" },
          reason: { const: resource.unavailable },
          total_count: { type: "null" },
          items: { type: "array", maxItems: 0 },
          next_offset: { type: "null" },
        })
        : {
          anyOf: [
            obj({
              ...common,
              status: { const: "available" },
              reason: { type: "null" },
              total_count: count,
              items: {
                type: "array",
                maxItems: 50,
                items: obj(resource.fields),
              },
              next_offset: { anyOf: [count, { type: "null" }] },
            }),
            missing,
          ],
        },
    ];
  }),
);
const inputSchema = obj({ tenant_id: uuid, offset, limit });
export const protectedInventoryResultSchema = obj({
  tenant_id: uuid,
  inventory_version: { const: "protected_resource_metadata_v1" },
  observed_at: date,
  offset,
  limit,
  complete_tenant_coverage: { const: false },
  provider_revocation_verified: { const: false },
  generic_restore_permitted: { const: false },
  audit_evidence_disposition: { const: "retain_append_only_digest_evidence" },
  resources: obj(pageSchemas),
});
export const protectedInventoryContractPayload = Object.freeze({
  operation: protectedInventoryOperationName,
  requirement: 111,
  handler: "sandy-tenant-lifecycle-api",
  kind: "tenant_protected_inventory_sql",
  is_mutation: false,
  requires_grant: true,
  requires_approval: true,
  api_key_delegable: false,
  requires_cost_approval: false,
  permission_scope: "infrastructure:read",
  description:
    "Inventory explicit tenant-owned credential/control metadata with scoped owner approval and current customer consent. No credential material, provider revocation, access restoration, or complete tenant coverage.",
  complete_tenant_coverage: false,
  input_schema: inputSchema,
  result_schema: protectedInventoryResultSchema,
  output_schema: obj({
    ok: { const: true },
    operation: { const: protectedInventoryOperationName },
    contract_version: { const: "1.0.0" },
    executed: { const: true },
    request_state: { const: "observed" },
    admission_id: uuid,
    result: protectedInventoryResultSchema,
  }),
});
export const protectedInventoryOperation = Object.freeze({
  ...protectedInventoryContractPayload,
  contract_sha256: await argumentDigest(protectedInventoryContractPayload),
});
let validators:
  | { input: ValidateFunction; result: ValidateFunction }
  | undefined;
function executionValidators() {
  if (!validators) {
    // Gateway discovery imports the descriptor but never executes this RPC.
    // Compile the two fixed schemas only at the backend execution boundary.
    const ajv = new Ajv({ strict: true });
    for (const [name, format] of Object.entries(fullFormats)) {
      ajv.addFormat(name, format);
    }
    validators = {
      input: ajv.compile(inputSchema),
      result: ajv.compile(protectedInventoryResultSchema),
    };
  }
  return validators;
}
const uuidPattern =
  /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
export type ProtectedInventoryRpcParameters = {
  p_actor: string;
  p_admission: string;
  p_canonical: string;
};
export type ProtectedInventoryDb = {
  rpc(
    name: typeof protectedInventoryRpcName,
    args: ProtectedInventoryRpcParameters,
  ): PromiseLike<{ data: unknown; error: unknown; status: number }>;
};
/** Called only by the shared lifecycle owner/grant/receipt handler. The SQL
 * primitive independently checks its consumed admission and current consent.
 * SDK HTTP status is retained; arbitrary SQL error details never leave here. */
export async function executeProtectedInventoryRpc(
  db: ProtectedInventoryDb,
  params: ProtectedInventoryRpcParameters,
): Promise<{ data: unknown; error: unknown; status: number }> {
  if (
    !object(params) || Object.keys(params).length !== 3 ||
    !Object.keys(params).every((key) =>
      ["p_actor", "p_admission", "p_canonical"].includes(key)
    ) || typeof params.p_actor !== "string" ||
    !uuidPattern.test(params.p_actor) ||
    typeof params.p_admission !== "string" ||
    !uuidPattern.test(params.p_admission) ||
    typeof params.p_canonical !== "string" ||
    new TextEncoder().encode(params.p_canonical).length > 196608
  ) throw new Error("tenant_inventory_parameters_invalid");
  let args: unknown;
  try {
    args = JSON.parse(params.p_canonical);
  } catch {
    throw new Error("tenant_inventory_parameters_invalid");
  }
  if (
    !object(args) || !executionValidators().input(args) ||
    canonicalJson(args) !== params.p_canonical
  ) throw new Error("tenant_inventory_parameters_invalid");
  let reply;
  try {
    reply = await db.rpc(protectedInventoryRpcName, params);
  } catch {
    throw new Error("tenant_inventory_transport_unavailable");
  }
  if (
    reply.error || !Number.isInteger(reply.status) ||
    reply.status < 200 || reply.status > 299
  ) {
    return {
      data: null,
      error: {
        code: object(reply.error) &&
            typeof reply.error.code === "string" &&
            /^[0-9A-Z]{5}$/.test(reply.error.code)
          ? reply.error.code
          : "tenant_inventory_rpc_failed",
      },
      status: reply.status,
    };
  }
  const data = reply.data;
  if (
    !object(data) || Object.keys(data).length !== 3 || data.ok !== true ||
    data.reused !== false || !object(data.result) ||
    !executionValidators().result(data.result) ||
    data.result.tenant_id !== args.tenant_id ||
    data.result.offset !== args.offset || data.result.limit !== args.limit ||
    JSON.stringify(data).length > 1048576 ||
    !Object.values(data.result.resources as Obj).every((page) =>
      object(page) && page.offset === args.offset &&
      page.limit === args.limit &&
      Array.isArray(page.items) && page.items.length <= Number(args.limit) &&
      (page.total_count === null ||
        (page.items.length === Math.min(
              Number(args.limit),
              Math.max(Number(page.total_count) - Number(args.offset), 0),
            ) &&
          page.next_offset ===
            (Number(args.offset) + page.items.length < Number(page.total_count)
              ? Number(args.offset) + page.items.length
              : null)))
    )
  ) {
    return {
      data: null,
      error: { code: "tenant_inventory_projection_invalid" },
      status: reply.status,
    };
  }
  return { data, error: null, status: reply.status };
}
