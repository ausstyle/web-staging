/** Real provider integration for the versioned handler, without a Controller session.
 * This exercises the local handler, not the deployed endpoint or end-user auth.
 * Only fixed read-only provider routes are called. No secret values are emitted.
 */
import { createProviderReadHandler } from "../../supabase/functions/sandy-provider-read-api/index.ts";
import { Ajv } from "npm:ajv@8.17.1";
import { fullFormats } from "npm:ajv-formats@3.0.1/dist/formats.js";
const token = Deno.env.get("SANDY_SUPABASE_MANAGEMENT_TOKEN");
if (!token) throw Error("management_binding_missing");
const service = crypto.randomUUID(); // local test harness only; never a production key
const handler = createProviderReadHandler({ service, management: token });
const boundedMetadata = [
  "supabase.schema.views.list",
  "supabase.schema.materialized_views.list",
  "supabase.schema.triggers.list",
  "supabase.schema.constraints.list",
  "supabase.schema.types.list",
  "supabase.schema.extensions.list",
  "supabase.database.roles.list",
  "supabase.database.grants.list",
  "supabase.database.default_privileges.list",
  "supabase.database.rls.policies.list",
  "supabase.database.locks.list",
  "supabase.database.cron.jobs.list",
];
// Load the actual installed output contracts independently of the handler.
const schemaResponse = await fetch(
  "https://api.supabase.com/v1/projects/zmqlyygzqoidkcwdysok/database/query",
  {
    method: "POST",
    redirect: "error",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      read_only: true,
      query:
        "SELECT operation, output_schema FROM public.sandy_operation_registry WHERE handler = 'sandy-provider-read-api' ORDER BY operation",
    }),
  },
);
if (!schemaResponse.ok) throw Error("registry_contract_read_failed");
const schemas = new Map(
  (await schemaResponse.json()).map((
    row: { operation: string; output_schema: object },
  ) => [row.operation, row.output_schema]),
);
const ajv = new Ajv({ strict: true, allErrors: false, validateFormats: true });
for (const [name, format] of Object.entries(fullFormats)) {
  ajv.addFormat(name, format);
}
const tests: Record<string, unknown>[] = [];
let branchName: string | undefined;
for (
  const operation of [
    "supabase.db.migrations.list",
    "supabase.database.inspect",
    "supabase.schema.tables.list",
    "supabase.schema.functions.list",
    "supabase.schema.indexes.list",
    "supabase.database.connections.list",
    "supabase.projects.get",
    "supabase.project.health",
    "supabase.branches.list",
    "supabase.branches.get",
    "supabase.network.restrictions.get",
    "supabase.domains.get",
    "supabase.functions.secrets.list",
    "supabase.backups.list",
    ...boundedMetadata,
  ]
) {
  const args = operation === "supabase.branches.get"
    ? { name: branchName ?? "sandy-api-test-nonexistent-20261020" }
    : {};
  const response = await handler(
    new Request("https://local-handler.invalid", {
      method: "POST",
      headers: {
        authorization: `Bearer ${service}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ operation, arguments: args }),
    }),
  );
  const body = await response.json();
  if (
    operation === "supabase.branches.list" && body.ok && body.result?.length
  ) branchName = body.result[0].name;
  const negativeBranch = operation === "supabase.branches.get" && !branchName;
  let passed = negativeBranch
    ? response.status === 404 && body.upstream_status === 404
    : response.status === 200 && body.ok === true &&
      body.project_id === "zmqlyygzqoidkcwdysok" &&
      body.contract_version === "1.0.0" &&
      Number.isFinite(Date.parse(body.observed_at));
  const result = body.result;
  let outputContractPassed: boolean | null = null;
  if (passed && !negativeBranch) {
    const schema = schemas.get(operation);
    outputContractPassed = !!schema &&
      ajv.validate(schema as object, body) === true;
    passed = passed && outputContractPassed;
  }
  let oracle = negativeBranch
    ? "missing branch is a real provider 404, never empty success"
    : "typed project-scoped provider response";
  if (passed && !negativeBranch) {
    if (operation === "supabase.db.migrations.list") {
      oracle = "all applied release migration versions are visible";
      passed = Array.isArray(result) &&
        [
          "20261020183000",
          "20261020190000",
          "20261020193000",
          "20261020200000",
          "20261020202000",
          "20261020210000",
          "20261020213000",
        ]
          .every((version) => result.some((row) => row.version === version));
    } else if (operation === "supabase.schema.tables.list") {
      oracle = "public operation registry exists in the live table catalogue";
      passed = Array.isArray(result) &&
        result.some((row) =>
          row.table_schema === "public" &&
          row.table_name === "sandy_operation_registry"
        );
    } else if (operation === "supabase.schema.functions.list") {
      oracle =
        "deployed cancellation routine is present in live routine signatures";
      passed = Array.isArray(result) &&
        result.some((row) => row.name === "sandy_api_cancel_deployment_job");
    } else if (operation === "supabase.schema.indexes.list") {
      oracle =
        "registry primary-key index is visible without expression bodies";
      passed = Array.isArray(result) && result.some((row) =>
        row.indexname === "sandy_operation_registry_pkey"
      ) && result.every((row) =>
        !("indexdef" in row)
      );
    } else if (operation === "supabase.database.inspect") {
      passed = Array.isArray(result) &&
        result.some((row) => row.schema_name === "public");
    } else if (operation === "supabase.database.connections.list") {
      passed = Array.isArray(result) && result.length > 0 &&
        result.every((row) =>
          Number.isInteger(row.count) && row.count >= 0 && !("query" in row)
        );
    } else if (operation === "supabase.projects.get") {
      passed = result?.id === "zmqlyygzqoidkcwdysok";
    } else if (operation === "supabase.project.health") {
      oracle = "all five requested services have observed health states";
      passed = Array.isArray(result) &&
        ["auth", "db", "rest", "storage", "realtime"].every((name) =>
          result.some((row) =>
            row.name === name &&
            ["COMING_UP", "ACTIVE_HEALTHY", "UNHEALTHY"].includes(row.status)
          )
        );
    } else if (operation === "supabase.functions.secrets.list") {
      oracle =
        "deployed management binding name is present and no secret values escape";
      passed = Array.isArray(result) && result.some((row) =>
        row.name === "SANDY_SUPABASE_MANAGEMENT_TOKEN"
      ) && result.every((row) =>
        Object.keys(row).every((key) => ["name", "updated_at"].includes(key))
      );
    } else if (operation === "supabase.branches.list") {
      passed = Array.isArray(result);
    } else if (operation === "supabase.network.restrictions.get") {
      passed = result && ["applied", "stored"].includes(result.status);
    } else if (operation === "supabase.backups.list") {
      passed = result && Array.isArray(result.backups);
    } else if (boundedMetadata.includes(operation)) {
      passed = Array.isArray(result) && Number.isInteger(body.result_limit) &&
        result.length <= body.result_limit &&
        body.possibly_truncated === (result.length === body.result_limit);
      oracle =
        "actual typed bounded metadata; definitions, credentials and customer rows excluded";
      if (operation === "supabase.schema.materialized_views.list") {
        // Empty catalogue is a valid provider observation, not a positive object fixture.
        oracle =
          "observed public materialized-view catalogue (no existing-object fixture)";
      } else if (operation === "supabase.schema.triggers.list") {
        oracle =
          "existing task analysis trigger identity is visible without its body";
        passed = passed &&
          result.some((row: Record<string, unknown>) =>
            row.table_name === "sandy_tasks" &&
            row.name === "sandy_task_enqueue_after_save"
          );
      } else if (operation === "supabase.schema.types.list") {
        passed = passed &&
          result.some((row: Record<string, unknown>) =>
            row.name === "sandy_operation_registry"
          );
      } else if (operation === "supabase.schema.extensions.list") {
        passed = passed &&
          result.some((row: Record<string, unknown>) => row.name === "pg_cron");
      } else if (operation === "supabase.database.roles.list") {
        passed = passed &&
          result.some((row: Record<string, unknown>) =>
            row.name === "service_role"
          );
      } else if (operation === "supabase.database.locks.list") {
        passed = passed && result.length > 0 &&
          result.every((row: Record<string, unknown>) =>
            Number.isInteger(row.count) && Number(row.count) > 0
          );
      } else {
        passed = passed && result.length > 0;
      }
    }
  }
  tests.push({
    operation,
    passed,
    output_contract_passed: outputContractPassed,
    ...(boundedMetadata.includes(operation)
      ? {
        row_count: Array.isArray(result) ? result.length : null,
        result_limit: body.result_limit ?? null,
        possibly_truncated: body.possibly_truncated ?? null,
      }
      : {}),
    http_status: response.status,
    provider_request_id: body.provider_request_id ?? null,
    upstream_status: body.upstream_status ?? null,
    scenario: negativeBranch ? "missing_branch_negative_test" : "provider_read",
    error: body.error ?? null,
    oracle,
  });
}
const report = {
  project: "zmqlyygzqoidkcwdysok",
  tested_at: new Date().toISOString(),
  layer: "local_versioned_handler_to_real_management_api",
  deployed_endpoint_tested: false,
  controller_session_tested: false,
  tests,
};
console.log(JSON.stringify(report, null, 2));
if (Deno.args[0]) {
  await Deno.writeTextFile(
    Deno.args[0],
    JSON.stringify(report, null, 2) + "\n",
  );
}
if (tests.some((test) => !test.passed)) Deno.exit(1);
