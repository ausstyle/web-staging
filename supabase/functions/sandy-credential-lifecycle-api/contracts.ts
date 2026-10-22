import providerSources from "./provider_sources.json" with { type: "json" };
import { argumentDigest } from "../_shared/sandy_api_protocol.ts";
export { credentialExecutionScope } from "./scope.ts";
const uuid = { type: "string", format: "uuid" };
const objectSchema = (
  properties: Record<string, unknown>,
  required = Object.keys(properties),
) => ({ type: "object", properties, required, additionalProperties: false });
const requestSchema = (
  properties: Record<string, unknown>,
  required: string[] = Object.keys(properties),
) =>
  objectSchema({ target_id: uuid, ...properties }, ["target_id", ...required]);
const resultSchema = objectSchema({
  target_id: uuid,
  rotation_id: uuid,
  version_id: uuid,
  active_version_id: uuid,
  retained_version_id: { type: ["string", "null"] },
  verification_admission_id: uuid,
  provider_version_id: { type: ["string", "null"] },
  provider_verified: { type: "boolean" },
  provider_readback_verified: { type: "boolean" },
  provider_revocation_observed: { type: "boolean" },
  previous_credential_revoked: { const: false },
  custody_deleted: { type: "boolean" },
  provider_credential_revoked: { const: false },
  encrypted_at_rest: { const: true },
  active: { type: "boolean" },
  material_sha256: { type: "string", pattern: "^[a-f0-9]{64}$" },
  target_config_sha256: { type: "string", pattern: "^[a-f0-9]{64}$" },
  probe_kind: { type: "string" },
  revocation_scope: {
    enum: ["new_key_authentication", "secret_version_access"],
  },
  issued_tokens_may_remain_valid: { type: "boolean" },
  atomic_provider_cas: { const: false },
  reconciliation_required: { type: "boolean" },
  effect_confirmed: { const: false },
  accepted: { const: true },
}, []);
const rows = [
  [
    "supabase.vault.secrets.create_version",
    true,
    109,
    requestSchema({
      value: { type: "string", minLength: 1, maxLength: 65536 },
    }),
  ],
  [
    "supabase.vault.secrets.delete",
    true,
    109,
    requestSchema({ version_id: uuid }),
  ],
  [
    "system.credentials.provider.adopt",
    true,
    109,
    requestSchema({ acknowledge_provider_has_no_cas: { const: true } }),
  ],
  [
    "supabase.functions.secrets.rotate",
    true,
    84,
    requestSchema({
      source_version_id: uuid,
      acknowledge_provider_has_no_cas: { const: true },
    }),
  ],
  [
    "github.repo_secrets.rotate",
    true,
    134,
    requestSchema({
      source_version_id: uuid,
      acknowledge_provider_has_no_cas: { const: true },
    }),
  ],
  [
    "gcp.secrets.create_version",
    true,
    66,
    requestSchema({
      source_version_id: uuid,
      acknowledge_provider_has_no_cas: { const: true },
    }),
  ],
  [
    "gcp.secrets.rotate",
    true,
    66,
    requestSchema({
      source_version_id: uuid,
      acknowledge_provider_has_no_cas: { const: true },
    }),
  ],
  [
    "gcp.secrets.access",
    true,
    66,
    requestSchema({ acknowledge_provider_has_no_cas: { const: true } }),
  ],
  [
    "gcp.service_accounts.keys.rotate",
    true,
    20,
    requestSchema({ acknowledge_provider_has_no_cas: { const: true } }),
  ],
  [
    "system.credentials.provider.reconcile",
    true,
    109,
    requestSchema({
      rotation_id: uuid,
      acknowledge_provider_has_no_cas: { const: true },
    }),
  ],
  [
    "system.credentials.provider.verify",
    false,
    109,
    requestSchema({ rotation_id: uuid }),
  ],
  [
    "system.credentials.provider.activate",
    true,
    109,
    requestSchema({
      rotation_id: uuid,
      verification_admission_id: uuid,
      acknowledge_provider_has_no_cas: { const: true },
    }),
  ],
  [
    "system.credentials.provider.rollback",
    true,
    109,
    requestSchema({
      rollback_rotation_id: uuid,
      acknowledge_provider_has_no_cas: { const: true },
    }),
  ],
  [
    "system.credentials.provider.revoke",
    true,
    20,
    requestSchema({
      version_id: uuid,
      verification_rotation_id: uuid,
      acknowledge_provider_has_no_cas: { const: true },
    }),
  ],
] as const;
export type CredentialContract = {
  operation: string;
  spec_operation: string;
  is_mutation: boolean;
  requirement: number;
  input_schema: Record<string, unknown>;
  output_schema: Record<string, unknown>;
  contract_sha256: string;
  permission_scope: "infrastructure:write";
};
const requiredResults = (operation: string): string[] =>
  operation === "system.credentials.provider.verify"
    ? [
      "target_id",
      "rotation_id",
      "material_sha256",
      "target_config_sha256",
      "provider_verified",
      "provider_version_id",
      "probe_kind",
      "atomic_provider_cas",
    ]
    : operation === "supabase.vault.secrets.create_version"
    ? [
      "target_id",
      "version_id",
      "encrypted_at_rest",
      "active",
      "accepted",
      "effect_confirmed",
    ]
    : operation === "supabase.vault.secrets.delete"
    ? [
      "version_id",
      "custody_deleted",
      "provider_credential_revoked",
      "accepted",
      "effect_confirmed",
    ]
    : operation === "system.credentials.provider.activate"
    ? [
      "target_id",
      "rotation_id",
      "active_version_id",
      "retained_version_id",
      "provider_readback_verified",
      "previous_credential_revoked",
      "accepted",
      "effect_confirmed",
    ]
    : operation === "system.credentials.provider.reconcile"
    ? [
      "target_id",
      "rotation_id",
      "accepted",
      "effect_confirmed",
      "reconciliation_required",
    ]
    : operation === "system.credentials.provider.revoke"
    ? [
      "version_id",
      "provider_revocation_observed",
      "custody_deleted",
      "revocation_scope",
      "issued_tokens_may_remain_valid",
      "accepted",
      "effect_confirmed",
    ]
    : [
      "target_id",
      "rotation_id",
      "version_id",
      "provider_version_id",
      "accepted",
      "effect_confirmed",
      "reconciliation_required",
      "previous_credential_revoked",
      "encrypted_at_rest",
      "atomic_provider_cas",
    ];
const descriptors: Omit<CredentialContract, "contract_sha256">[] = rows.map((
  [operation, is_mutation, requirement, input_schema],
) => ({
  operation,
  spec_operation: operation.replace(
    "gcp.service_accounts.",
    "gcp.serviceAccounts.",
  ).replace(/\.create_version$/, ".createVersion"),
  is_mutation,
  requirement,
  input_schema,
  permission_scope: "infrastructure:write",
  output_schema: objectSchema({
    ok: { const: true },
    operation: { const: operation },
    contract_version: { const: "1.0.0" },
    admission_id: uuid,
    executed: { const: true },
    request_state: { enum: ["observed", "accepted"] },
    result: { ...resultSchema, required: requiredResults(operation) },
  }),
}));
let compiled: Promise<Readonly<Record<string, CredentialContract>>> | undefined;
export function credentialContracts(): Promise<
  Readonly<Record<string, CredentialContract>>
> {
  return compiled ??= Promise.all(descriptors.map(async (row) => ({
    ...row,
    contract_sha256: await argumentDigest({
      ...row,
      version: "1.0.0",
      provider_contract_revisions: providerSources,
      credential_material_transport: "encrypted_vault_only",
      requires_approval: true,
      api_key_delegable: false,
    }),
  }))).then((rows) =>
    Object.freeze(Object.fromEntries(rows.map((row) => [row.operation, row])))
  );
}
