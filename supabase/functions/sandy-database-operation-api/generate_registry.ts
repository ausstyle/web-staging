/** Build ONLY the unapplied 005000 draft. Never regenerate an applied migration. */
import { databaseOperations } from "./contracts.ts";
import { databaseCapability } from "./gateway.ts";
const path = new URL(
  "../../migrations/20261021005000_sandy_database_operation_contracts.sql",
  import.meta.url,
);
const quote = (v: string) => `'${v.replace(/'/g, "''")}'`;
const json = (v: unknown) => quote(JSON.stringify(v)) + "::jsonb";
const rows = Object.values(databaseOperations).map((op) => {
  const capability = databaseCapability(op.operation);
  const blocked = !capability.executable;
  const errors = {
    version: "1.0.0",
    contract_sha256: op.contract_sha256,
    requires_grant: true,
    requires_approval: true,
    api_key_delegable: false,
    sensitive_response: true,
    requirement: op.requirement,
    scope: {
      project_ref: "zmqlyygzqoidkcwdysok",
      database: "postgres",
      schema: "public",
    },
    execution:
      "Management-only private engine with canonical argument proof and consumed one-use owner admission",
    unknown_outcome:
      "reconcile through supabase.sql.receipt.get; never automatically redispatch",
    family_coverage:
      "only this named typed operation; not entire wildcard acceptance",
    atomicity:
      "transactional SQL effects and receipt together; maintenance/signals explicitly nontransactional",
    public_data_policy:
      "explicit-schema plain stored relations with builtin types; protected Sandy control/identity tables and credential-bearing source columns refused; sensitive output fails closed",
    read_only:
      "Management read_only:true plus transaction_read_only assertion for reads",
    parser: "libpg-query@18.1.5 vendored WASM instantiated from memory",
    ...(blocked
      ? {
        blocking_dependency: capability.unavailable_reason,
      }
      : {}),
  };
  const dependencies = [
    "enabled_controller_owner",
    "normal_owner_session",
    "exact_one_use_scoped_approval",
    "verified_contract",
    "SANDY_SUPABASE_MANAGEMENT_TOKEN",
    "sandy_api_access_audit_schema",
    ...(op.operation.includes("triggers.")
      ? ["reviewed_trigger_function_sha_binding"]
      : []),
  ];
  return " (" +
    [
      quote(op.operation),
      quote("supabase"),
      quote(op.description),
      quote(op.permission_scope),
      String(op.is_mutation),
      json(op.input_schema),
      json(op.output_schema),
      quote("sandy-database-operation-api"),
      "false",
      "false",
      "false",
      "false",
      quote(blocked ? "blocked_runtime_capability" : "source_ready"),
      quote("ausstyle/web-staging"),
      quote("supabase/functions/sandy-database-operation-api/index.ts"),
      json(dependencies),
      json({
        automatic: false,
        safe_to_retry: false,
        unknown_outcome:
          "read durable receipt via fresh read grant; no mutation redispatch",
      }),
      json({
        automatic: false,
        transactional_failure: "statement/effects/receipt roll back together",
        compensation:
          "separate reviewed forward migration or provider-specific recovery; maintenance/signals cannot be rolled back",
      }),
      json(errors),
    ].join(",") + ")";
});
const marker = "-- GENERATED_CONCRETE_DATABASE_CONTRACTS";
const source = await Deno.readTextFile(path);
const index = source.indexOf(marker);
if (index < 0) throw Error("contract_marker_missing");
const header =
  `${marker}\n-- Each concrete handler starts disabled and unverified. Existing operation IDs,\n-- flags and evidence are never overwritten by this additive installation.\nINSERT INTO public.sandy_operation_registry(operation,domain,description,permission_scope,is_mutation,input_schema,output_schema,handler,api_exposed,ui_exposed,ai_exposed,verified,implementation_state,source_repository,source_path,dependencies,retry_policy,rollback_policy,error_contract) VALUES\n`;
await Deno.writeTextFile(
  path,
  source.slice(0, index) + header + rows.join(",\n") +
    "\nON CONFLICT(operation) DO NOTHING;\nCOMMIT;\n",
);
console.log(`Generated ${rows.length} disabled/unverified concrete contracts`);
