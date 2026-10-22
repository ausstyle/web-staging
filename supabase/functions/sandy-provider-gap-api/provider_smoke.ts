/** Authorized read-only provider-component probe. Does not mint or emulate a user session. */
import { gapContracts, type Obj, PROJECT } from "./contracts.ts";
import { Calls, type Dependencies, Refusal, validate } from "./runtime.ts";
import { executeSupabase } from "./providers.ts";
const token = Deno.env.get("SANDY_SUPABASE_MANAGEMENT_TOKEN");
if (!token) throw new Error("management_credential_unavailable");
const deps: Dependencies = {
  service: "",
  authorizeContext: async () => ({ allowed: false }),
  consumeGrant: async () => ({ allowed: false }),
  finishExecution: async () => ({ allowed: false }),
};
const end = Math.floor(Date.now() / 60000) * 60000, start = end - 60000;
const checks: Obj[] = [];
for (const operation of ["supabase.orgs.list", "supabase.project.logs.query"]) {
  const op = gapContracts[operation],
    calls = new Calls(deps, token, "supabase");
  try {
    const value = await executeSupabase(
      op,
      operation === "supabase.orgs.list" ? {} : {
        source: "edge_logs",
        start: new Date(start).toISOString(),
        end: new Date(end).toISOString(),
        limit: 1,
      },
      calls,
      Date.now(),
    );
    const resultSchema = (op.output_schema.properties as Obj).result as Obj;
    const schemaValid = validate(
      "smoke:" + operation,
      resultSchema,
      value.result,
    );
    if (!schemaValid) throw new Error("provider_projection_contract_failed");
    checks.push({
      operation,
      ok: true,
      http_status: calls.last?.status,
      provider_request_id: calls.last?.id,
      response_sha256: calls.last?.sha256,
      result_schema_valid: schemaValid,
      returned_count: operation === "supabase.orgs.list"
        ? (value.result.organizations as unknown[]).length
        : (value.result.entries as unknown[]).length,
      correct_bound_organization_observed: operation === "supabase.orgs.list"
        ? (value.result.organizations as unknown[]).length === 1
        : null,
      content_disclosed: false,
    });
  } catch (error) {
    checks.push({
      operation,
      ok: false,
      error: error instanceof Refusal
        ? error.code
        : "provider_projection_contract_failed",
      http_status: error instanceof Refusal
        ? error.providerStatus
        : calls.last?.status,
      provider_request_id: calls.last?.id,
      response_sha256: calls.last?.sha256,
      content_disclosed: false,
    });
  }
}
const evidence = {
  at: new Date().toISOString(),
  project_ref: PROJECT,
  level: "actual_read_only_provider_component",
  controller_session_tested: false,
  sandy_api_mcp_end_to_end_tested: false,
  provider_mutation_tested: false,
  credential_disclosed: false,
  window_start: new Date(start).toISOString(),
  window_end: new Date(end).toISOString(),
  checks,
};
console.log(JSON.stringify(evidence));
if (Deno.args[0]) {
  await Deno.writeTextFile(
    Deno.args[0],
    JSON.stringify(evidence, null, 2) + "\n",
  );
}
