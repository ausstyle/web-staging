/** Deterministic private credential contracts; this never connects to a provider. */
import { credentialContracts } from "../../supabase/functions/sandy-credential-lifecycle-api/contracts.ts";

const base = new URL("../../", import.meta.url);
const migration = new URL(
  "supabase/migrations/20261021006000_sandy_credential_custody.sql",
  base,
);
const manifest = new URL(
  "supabase/functions/sandy-credential-lifecycle-api/gateway_manifest.json",
  base,
);
const marker =
  "-- Credential operation contracts: disabled until actual scoped fixture evidence.";
const rows = Object.values(await credentialContracts());
const quote = (value: string) => "'" + value.replaceAll("'", "''") + "'";
const json = (value: unknown) => quote(JSON.stringify(value)) + "::jsonb";
const dependencies = [
  "enabled_controller_owner",
  "normal_owner_scoped_execution_approval",
  "one_use_execution_grant",
  "verified_server_credential_target",
  "encrypted_vault_custody",
  "verified_dedicated_provider_fixture",
  "provider_credential_and_runtime_egress",
];
const prefix = (await Deno.readTextFile(migration)).split(marker)[0].trimEnd();
const statements = rows.map((row) => {
  const errorContract = {
    contract_sha256: row.contract_sha256,
    requires_approval: true,
    api_key_delegable: false,
    requires_cost_approval: !row.operation.startsWith("supabase.vault."),
    credential_material_transport: "encrypted_vault_only",
    requirement: row.requirement,
    spec_operation: row.spec_operation,
    provider_http_acceptance_is_completion: false,
    provider_cas_available: false,
    existing_oauth_access_tokens_survive_key_disable: true,
  };
  return "INSERT INTO public.sandy_operation_registry(operation,domain,description,permission_scope,is_mutation,input_schema,output_schema,handler,api_exposed,ui_exposed,ai_exposed,verified,implementation_state,source_repository,source_path,dependencies,error_contract) VALUES(" +
    [
      quote(row.operation),
      quote("credentials"),
      quote(
        "Encrypted provider custody with separate verified readback, explicit activation and retained preimage; provider HTTP acceptance never completes a mutation.",
      ),
      quote(row.permission_scope),
      row.is_mutation,
      json(row.input_schema),
      json(row.output_schema),
      quote("sandy-credential-lifecycle-api"),
      false,
      false,
      false,
      false,
      quote("source_ready"),
      quote("ausstyle/web-staging"),
      quote("supabase/functions/sandy-credential-lifecycle-api/index.ts"),
      json(dependencies),
      json(errorContract),
    ].join(",") + ") ON CONFLICT(operation) DO NOTHING;";
});
await Deno.writeTextFile(
  manifest,
  JSON.stringify({ contract_version: "1.0.0", operations: rows }, null, 2) +
    "\n",
);
await Deno.writeTextFile(
  migration,
  prefix + "\n\n" + marker + "\n" + statements.join("\n") + "\nCOMMIT;\n",
);
console.log(
  JSON.stringify({
    operations: rows.length,
    registry_exposed: false,
    verification: "source_ready",
  }),
);
