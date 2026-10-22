/** Read-only diagnosis of the intended Management binding. No Auth session,
 * MCP request, GCP action, configuration write or acceptance success is issued. */
import { engineeringIdentityQuery, managementRequest, type ManagementEvidence } from "./verify_mcp_candidate.ts";
type Obj = Record<string, any>;

export async function probeManagement(credential: string, transport?: typeof fetch) {
  const evidence: ManagementEvidence[] = [];
  const report: Obj = { mode: "management_diagnostics_only", observed_at: new Date().toISOString(),
    management_configuration_verified: false, management_requests: evidence, acceptance_executed: false,
    Auth_sessions_issued: 0, MCP_requests: 0, GCP_requests: 0, traffic_mutations: 0,
    credentials_recorded: false };
  try {
    if (!credential) throw Error("engineering_management_credential_unavailable");
    const keys = await managementRequest("/api-keys", credential, evidence, undefined, transport);
    if (!Array.isArray(keys) || !["service_role", "anon"].every(name => keys.some(row => row?.name === name && typeof row.api_key === "string" && row.api_key)))
      throw Error("engineering_session_configuration_unavailable");
    const rows = await managementRequest("/database/query", credential, evidence,
      { read_only: true, query: engineeringIdentityQuery }, transport);
    if (!Array.isArray(rows) || rows.length !== 1 || rows[0].controller_memberships !== 0)
      throw Error("engineering_nonowner_identity_required");
    report.required_key_names_present = true;
    report.eligible_nonowner_workload_count = 1;
    report.management_configuration_verified = true;
  } catch (error) {
    const code = error instanceof Error ? error.message : "";
    report.error = ["engineering_management_credential_unavailable", "engineering_management_request_failed",
      "engineering_session_configuration_unavailable", "engineering_nonowner_identity_required"].includes(code)
      ? code : "engineering_management_diagnostics_failed";
  }
  return report;
}

if (import.meta.main) {
  const index = Deno.args.indexOf("--output"), output = Deno.args[index + 1];
  if (index < 0 || !output) throw Error("diagnostic_output_required");
  const proxy = Deno.env.get("HTTPS_PROXY");
  const client = proxy ? Deno.createHttpClient({ proxy: { url: proxy }, http2: false }) : undefined;
  const transport: typeof fetch = (url, init) => fetch(url, { ...init, ...(client ? { client } : {}) });
  try {
    const report = await probeManagement(Deno.env.get("SANDY_SUPABASE_MANAGEMENT_TOKEN") ?? "", transport);
    const text = JSON.stringify(report, null, 2) + "\n";
    await Deno.writeTextFile(output, text, { mode: 0o600 });
    console.log(text);
    if (!report.management_configuration_verified) Deno.exitCode = 1;
  } finally { client?.close(); }
}
