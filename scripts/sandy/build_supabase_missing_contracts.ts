/** Additive source generation only. Never connects to a database/provider. */
import { gapContracts } from "../../supabase/functions/sandy-provider-gap-api/contracts.ts";
import { argumentDigest } from "../../supabase/functions/_shared/sandy_api_protocol.ts";
const names = [
  "supabase.projects.list",
  "supabase.projects.create",
  "supabase.functions.invoke",
];
const path = "supabase/functions/sandy-provider-gap-api/gateway_manifest.json";
const manifest = JSON.parse(await Deno.readTextFile(path));
const additions = await Promise.all(names.map(async (name) => {
  const op = gapContracts[name];
  return {
    operation: op.operation,
    provider: op.provider,
    is_mutation: op.is_mutation,
    permission_scope: op.permission_scope,
    contract_sha256: op.contract_sha256,
    requires_grant: true,
    requires_cost_approval: op.requires_cost_approval === true,
    api_key_delegable: false,
    requirement_ids: op.requirement_ids,
    input_schema_sha256: await argumentDigest(op.input_schema),
    output_schema_sha256: await argumentDigest(op.output_schema),
  };
}));
for (
  const old of manifest.operations.filter((x: any) =>
    !names.includes(x.operation)
  )
) {
  if (gapContracts[old.operation]?.contract_sha256 !== old.contract_sha256) {
    throw Error("existing_contract_changed");
  }
}
manifest.operations = [
  ...manifest.operations.filter((x: any) => !names.includes(x.operation)),
  ...additions,
]
  .sort((a: any, b: any) => a.operation.localeCompare(b.operation));
manifest.operation_count = manifest.operations.length;
await Deno.writeTextFile(path, JSON.stringify(manifest) + "\n");
const quote = (s: string) => "'" + s.replaceAll("'", "''") + "'";
const json = (v: unknown) => quote(JSON.stringify(v)) + "::jsonb";
const rows = names.map((name) => {
  const op = gapContracts[name];
  return "(" +
    [
      quote(name),
      "'supabase'",
      quote(op.description),
      quote(op.permission_scope),
      String(op.is_mutation),
      json(op.input_schema),
      json(op.output_schema),
      "'sandy-provider-gap-api'",
      "false",
      "false",
      "false",
      "false",
      "'source_ready'",
      "'ausstyle/web-staging'",
      "'supabase/functions/sandy-provider-gap-api/project_functions.ts'",
      json([
        "normal_authenticated_owner_or_applicable_delegation",
        "current_exact_scope_admission",
        "installed_current_contract",
        ...(op.kind === "project_create"
          ? ["positive_cost_admission", "existing_per_project_password_custody"]
          : []),
        ...(op.kind === "function_invoke"
          ? ["same_normal_caller_session", "installed_jwt_protected_function"]
          : []),
      ]),
      json({
        version: "1.0.0",
        contract_sha256: op.contract_sha256,
        requires_grant: true,
        requires_approval: op.requires_approval,
        requires_cost_approval: op.requires_cost_approval === true,
        api_key_delegable: false,
        requirement_ids: op.requirement_ids,
        canonical_operation: name,
        provider_source: op.source,
        provider_source_sha256: op.source_sha256,
        provider_operation_id: op.provider_operation_id,
        source_review_only: true,
        provider_schema_verified: op.kind !== "function_invoke",
        runtime_provider_verified: false,
        provider_acceptance_is_effect_verification: false,
      }),
      json({ automatic: false, safe_to_retry: !op.is_mutation }),
      json({
        automatic: false,
        applicable: op.is_mutation,
        reason:
          "Reconcile provider receipt before any separately authorised compensation; no automatic redispatch",
      }),
    ].join(",") + ")";
});
const migration =
  "supabase/migrations/20261023160000_sandy_missing_supabase_contracts.sql";
const prefix =
  (await Deno.readTextFile(migration)).split("-- GENERATED_REGISTRY")[0];
await Deno.writeTextFile(
  migration,
  prefix + "-- GENERATED_REGISTRY\n" +
    "INSERT INTO public.sandy_operation_registry(operation,domain,description,permission_scope,is_mutation,input_schema,output_schema,handler,api_exposed,ui_exposed,ai_exposed,verified,implementation_state,source_repository,source_path,dependencies,error_contract,retry_policy,rollback_policy) VALUES\n" +
    rows.join(",\n") + ";\nCOMMIT;\n",
);
console.log(
  JSON.stringify({
    source_contracts_added: 3,
    existing_contracts_preserved: 35,
    production_changed: false,
  }),
);
