/** Real provider integration for the versioned handler, without a Controller session.
 * This exercises the local handler, not the deployed endpoint or end-user auth.
 * Only fixed read-only provider routes are called. No secret values are emitted.
 */
import { createProviderReadHandler } from "../../supabase/functions/sandy-provider-read-api/index.ts";
const token = Deno.env.get("SANDY_SUPABASE_MANAGEMENT_TOKEN");
if (!token) throw Error("management_binding_missing");
const service = crypto.randomUUID(); // local test harness only; never a production key
const handler = createProviderReadHandler({ service, management: token });
const tests: Record<string, unknown>[] = [];
let branchName: string | undefined;
for (
  const operation of [
    "supabase.projects.get",
    "supabase.project.health",
    "supabase.branches.list",
    "supabase.branches.get",
    "supabase.network.restrictions.get",
    "supabase.domains.get",
    "supabase.functions.secrets.list",
    "supabase.backups.list",
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
  const passed = negativeBranch
    ? response.status === 404 && body.upstream_status === 404
    : response.status === 200 && body.ok === true &&
      body.project_id === "zmqlyygzqoidkcwdysok";
  tests.push({
    operation,
    passed,
    http_status: response.status,
    provider_request_id: body.provider_request_id ?? null,
    upstream_status: body.upstream_status ?? null,
    scenario: negativeBranch ? "missing_branch_negative_test" : "provider_read",
    error: body.error ?? null,
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
