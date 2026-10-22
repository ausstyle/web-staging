/** Print additive 05100 metadata only; never rewrite an applied migration. */
import { maintenanceOperations } from "./maintenance_contracts.ts";
import { databaseOperations as original, databaseScope } from "./contracts.ts";
const quote = (value: string) => `'${value.replace(/'/g, "''")}'`;
const json = (value: unknown) => `${quote(JSON.stringify(value))}::jsonb`;
const guards = Object.values(maintenanceOperations).map((op) => {
  const known = [
    op.contract_sha256,
    ...(original[op.operation] ? [original[op.operation].contract_sha256] : []),
  ];
  return `(operation=${
    quote(op.operation)
  } AND (handler IS DISTINCT FROM 'sandy-database-operation-api' OR api_exposed IS DISTINCT FROM false OR verified IS DISTINCT FROM false OR error_contract->>'contract_sha256' IS NULL OR error_contract->>'contract_sha256' NOT IN(${
    known.map(quote).join(",")
  })))`;
});
console.log(
  `-- Supersede only known disabled v1 maintenance contracts. A verified or
-- differently installed contract requires a separate reviewed cutover.
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM public.sandy_operation_registry WHERE ${
    guards.join(" OR ")
  }) THEN
  RAISE EXCEPTION 'maintenance_contract_cutover_conflict';
 END IF;
END $$;`,
);
const rows = Object.values(maintenanceOperations).map((op) => {
  const dependencies = [
    "enabled_controller_owner",
    "normal_owner_session",
    "exact_one_use_scoped_approval",
    "verified_contract",
    "sandy_api_access_audit_schema",
    "sandy_database_maintenance_schema",
    "runtime_provider_egress",
    ...(op.kind === "vacuum_native"
      ? ["SANDY_DATABASE_MAINTENANCE_URL_fixed_project_direct_verified_TLS"]
      : ["supabase_management_consumer", "sandy_credential_consumer_schema"]),
    ...(op.kind.startsWith("cron_guarded_")
      ? [
        "existing_pg_cron_extension",
        "finite_explicit_standing_approval",
        "passive_plain_public_relations",
      ]
      : []),
  ];
  const error = {
    version: "2.0.0",
    contract_sha256: op.contract_sha256,
    requires_grant: true,
    requires_approval: true,
    api_key_delegable: false,
    sensitive_response: true,
    requirement: op.requirement,
    scope: databaseScope,
    execution: op.kind === "vacuum_native"
      ? "One reserved certificate-verified direct PostgreSQL session; VACUUM outside transaction; private exact-proof native finalizer with NULL HTTP status"
      : "Fixed-project Management RPC after consumed exact owner grant and current credential consumer resolution",
    unknown_outcome:
      "Fresh approved supabase.database.maintenance.receipt.get; no automatic redispatch",
    provider_verification:
      "Not established by source installation or component tests; registry stays disabled and unverified",
    ...(op.kind === "vacuum_native"
      ? {
        configuration_dependency: "SANDY_DATABASE_MAINTENANCE_URL",
        readback:
          "Actual pg_stat_all_tables before/after when available; accepted and unverified otherwise",
      }
      : {}),
    ...(op.kind.startsWith("cron_guarded_")
      ? {
        standing_authorization:
          "Exact immutable approved command; <=24h, <=100 runs, >=60s interval, <=100 affected rows, <=10 active schedules per owner; each run rechecks current owner, registry revision, approval, schema and shared principal quotas",
        failure:
          "Atomic SQL effects/postcondition/audit; pause on first failure, no automatic retry",
        provider_dependency:
          "Existing pg_cron; no automatic extension installation",
      }
      : {}),
  };
  return " (" +
    [
      quote(op.operation),
      quote("supabase"),
      quote(op.description),
      quote(op.permission_scope),
      String(op.is_mutation),
      json(op.input_schema),
      json(op.output_schema),
      quote(op.handler),
      "false",
      "false",
      "false",
      "false",
      quote("source_ready"),
      quote("ausstyle/web-staging"),
      quote("supabase/functions/sandy-database-operation-api/index.ts"),
      json(dependencies),
      json({
        automatic: false,
        safe_to_retry: false,
        unknown_outcome:
          "Reconcile owned durable receipt using a fresh read grant",
      }),
      json({
        automatic: false,
        vacuum: "Maintenance effects cannot be rolled back",
        cron: "Run effects and postconditions atomic; failed schedule paused",
      }),
      json(error),
    ].join(",") + ")";
});
console.log(
  "INSERT INTO public.sandy_operation_registry(operation,domain,description,permission_scope,is_mutation,input_schema,output_schema,handler,api_exposed,ui_exposed,ai_exposed,verified,implementation_state,source_repository,source_path,dependencies,retry_policy,rollback_policy,error_contract) VALUES\n" +
    rows.join(",\n") +
    "\nON CONFLICT(operation) DO UPDATE SET description=EXCLUDED.description,permission_scope=EXCLUDED.permission_scope,is_mutation=EXCLUDED.is_mutation,input_schema=EXCLUDED.input_schema,output_schema=EXCLUDED.output_schema,handler=EXCLUDED.handler,api_exposed=false,ui_exposed=false,ai_exposed=false,verified=false,implementation_state=EXCLUDED.implementation_state,source_repository=EXCLUDED.source_repository,source_path=EXCLUDED.source_path,dependencies=EXCLUDED.dependencies,retry_policy=EXCLUDED.retry_policy,rollback_policy=EXCLUDED.rollback_policy,error_contract=EXCLUDED.error_contract,updated_at=clock_timestamp();",
);
