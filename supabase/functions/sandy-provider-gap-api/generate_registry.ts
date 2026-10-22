/** Reproducibly generate reviewed registry rows; never connects to a database. */
import { argumentDigest } from "../_shared/sandy_api_protocol.ts";
import { gapContracts } from "./contracts.ts";
const quote = (s: string) => "'" + s.replaceAll("'", "''") + "'";
const json = (v: unknown) => quote(JSON.stringify(v)) + "::jsonb";
const gateway = [];
const rows = [];
for (const op of Object.values(gapContracts)) {
  const metadata = {
    version: "1.0.0",
    contract_sha256: op.contract_sha256,
    requires_grant: op.requires_approval,
    requires_approval: op.requires_approval,
    requires_cost_approval: false,
    api_key_delegable: op.api_key_delegable,
    requirement_ids: op.requirement_ids,
    source_review_only: true,
    provider_schema_verified: true,
    runtime_provider_verified: false,
    provider_source: op.source,
    provider_source_sha256: op.source_sha256,
    provider_operation_id: op.provider_operation_id,
    canonical_operation: op.operation === "supabase.logs.query"
      ? "supabase.project.logs.query"
      : op.operation,
    unknown_outcome:
      "Reconcile authoritative provider state with a new read admission; no automatic mutation redispatch",
    provider_acceptance_is_effect_verification: false,
  };
  gateway.push({
    operation: op.operation,
    provider: op.provider,
    is_mutation: op.is_mutation,
    permission_scope: op.permission_scope,
    contract_sha256: op.contract_sha256,
    requires_grant: op.requires_approval,
    requires_cost_approval: false,
    api_key_delegable: op.api_key_delegable,
    requirement_ids: op.requirement_ids,
    input_schema_sha256: await argumentDigest(op.input_schema),
    output_schema_sha256: await argumentDigest(op.output_schema),
  });
  const dependencies = [
    "enabled_controller_owner",
    "normal_owner_session",
    "one_use_exact_scope_admission",
    "credential_consumer_schema",
    "runtime_provider_egress",
    ...(op.requires_approval
      ? ["verified_contract", "explicit_exact_scope_approval"]
      : []),
    ...(op.kind.includes("restore")
      ? [
        "immutable_prior_provider_package_identity_proof",
        "expiring_verified_exclusive_namespace_binding",
      ]
      : []),
  ];
  rows.push(
    "(" +
      [
        quote(op.operation),
        quote(op.provider),
        quote(op.description),
        quote(op.permission_scope),
        String(op.is_mutation),
        json(op.input_schema),
        json(op.output_schema),
        quote("sandy-provider-gap-api"),
        String(!op.requires_approval),
        "false",
        String(!op.requires_approval),
        "false",
        quote("source_ready"),
        quote("ausstyle/web-staging"),
        quote("supabase/functions/sandy-provider-gap-api/index.ts"),
        json(dependencies),
        json(metadata),
        json({ automatic: false, safe_to_retry: !op.is_mutation }),
        json({
          automatic: false,
          applicable: false,
          reason: op.is_mutation
            ? "Provider-specific independently approved compensation; deleted discussion content is not recoverable by Sandy"
            : "Read-only",
        }),
      ].join(",") + ")",
  );
}
const sql =
  "-- Generated fixed provider-gap contracts. No production verification is asserted.\nBEGIN;\nINSERT INTO public.sandy_operation_registry(operation,domain,description,permission_scope,is_mutation,input_schema,output_schema,handler,api_exposed,ui_exposed,ai_exposed,verified,implementation_state,source_repository,source_path,dependencies,error_contract,retry_policy,rollback_policy) VALUES\n" +
  rows.join(",\n") + ";\nCOMMIT;\n";
await Deno.writeTextFile(
  new URL(
    "../../migrations/20261021008100_sandy_provider_gap_contracts.sql",
    import.meta.url,
  ),
  sql,
);
await Deno.writeTextFile(
  new URL("./gateway_manifest.json", import.meta.url),
  JSON.stringify({
    handler: "sandy-provider-gap-api",
    contract_version: "1.0.0",
    operation_count: gateway.length,
    operations: gateway,
  }) + "\n",
);
console.log(
  JSON.stringify({
    ok: true,
    operations: gateway.length,
    default_closed: Object.values(gapContracts).filter((x) =>
      x.requires_approval
    ).length,
    verified: false,
  }),
);
