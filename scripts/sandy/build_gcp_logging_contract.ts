/** Additive closed metadata only; no provider/database connections or old migration edits. */
import { gapContracts } from "../../supabase/functions/sandy-provider-gap-api/contracts.ts";
import { argumentDigest } from "../../supabase/functions/_shared/sandy_api_protocol.ts";
const name = "gcp.logging.query", op = gapContracts[name];
const path = "supabase/functions/sandy-provider-gap-api/gateway_manifest.json";
const manifest = JSON.parse(await Deno.readTextFile(path));
for (
  const old of manifest.operations.filter((o: any) => o.operation !== name)
) {
  if (
    gapContracts[old.operation]?.contract_sha256 !== old.contract_sha256
  ) throw Error("existing_contract_changed");
}
manifest.operations = [
  ...manifest.operations.filter((o: any) => o.operation !== name),
  {
    operation: name,
    provider: "gcp",
    is_mutation: false,
    permission_scope: op.permission_scope,
    contract_sha256: op.contract_sha256,
    requires_grant: true,
    requires_cost_approval: false,
    api_key_delegable: false,
    requirement_ids: [67],
    input_schema_sha256: await argumentDigest(op.input_schema),
    output_schema_sha256: await argumentDigest(op.output_schema),
  },
].sort((a: any, b: any) => a.operation.localeCompare(b.operation));
manifest.operation_count = manifest.operations.length;
await Deno.writeTextFile(path, JSON.stringify(manifest) + "\n");
const q = (s: string) => "'" + s.replaceAll("'", "''") + "'",
  j = (v: unknown) => q(JSON.stringify(v)) + "::jsonb";
const values = [
  q(name),
  "'gcp'",
  q(op.description),
  q(op.permission_scope),
  "false",
  j(op.input_schema),
  j(op.output_schema),
  "'sandy-provider-gap-api'",
  "false",
  "false",
  "false",
  "false",
  "'source_ready'",
  "'ausstyle/web-staging'",
  "'supabase/functions/sandy-provider-gap-api/logging.ts'",
  j([
    "normal_authenticated_owner_or_applicable_delegation",
    "current_exact_scope_admission",
    "installed_current_contract",
    "exact_canary_log_target_approval",
    "existing_gcp_credential_authority",
  ]),
  j({
    version: "1.0.0",
    contract_sha256: op.contract_sha256,
    requires_grant: true,
    requires_approval: true,
    requires_cost_approval: false,
    api_key_delegable: false,
    requirement_ids: [67],
    canonical_operation: name,
    provider_source: op.source,
    provider_source_sha256: op.source_sha256,
    provider_operation_id: op.provider_operation_id,
    source_review_only: true,
    provider_schema_verified: true,
    runtime_provider_verified: false,
    provider_acceptance_is_effect_verification: false,
  }),
  j({ automatic: false, safe_to_retry: true }),
  j({
    automatic: false,
    applicable: false,
    reason: "Read-only; no automatic pagination or redispatch",
  }),
];
await Deno.writeTextFile(
  "supabase/migrations/20261024023000_sandy_gcp_logging_query_closed.sql",
  "-- Additive reviewed candidate. Duplicate operation fails; no exposure/authority changes.\nBEGIN;\nINSERT INTO public.sandy_operation_registry(operation,domain,description,permission_scope,is_mutation,input_schema,output_schema,handler,api_exposed,ui_exposed,ai_exposed,verified,implementation_state,source_repository,source_path,dependencies,error_contract,retry_policy,rollback_policy) VALUES\n(" +
    values.join(",") + ");\nCOMMIT;\n",
);
