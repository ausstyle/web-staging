import { strict as assert } from "node:assert";
import { probeManagement } from "./probe_mcp_management.ts";
import { engineeringIdentityQuery } from "./verify_mcp_candidate.ts";

Deno.test("Management diagnosis makes only the two exact reads and never exports keys or acceptance success", async () => {
  const calls: string[] = [];
  const report = await probeManagement("synthetic-credential", (async (url, init) => {
    calls.push(String(url));
    if (calls.length === 1) return Response.json([{ name: "anon", api_key: "synthetic-anon-private" }, { name: "service_role", api_key: "synthetic-service-private" }]);
    assert.equal(init?.method, "POST");
    assert.deepEqual(JSON.parse(String(init?.body)), { read_only: true, query: engineeringIdentityQuery });
    return Response.json([{ user_id: "private-identity", controller_memberships: 0 }], { status: 201 });
  }) as typeof fetch);
  assert.equal(calls.length, 2);
  assert.equal(report.management_configuration_verified, true);
  assert.equal(report.acceptance_executed, false);
  for (const field of ["Auth_sessions_issued", "MCP_requests", "GCP_requests", "traffic_mutations"]) assert.equal(report[field], 0);
  const text = JSON.stringify(report);
  for (const value of ["synthetic-anon-private", "synthetic-service-private", "private-identity", "synthetic-credential"]) assert.equal(text.includes(value), false);
  assert.equal("passed" in report, false);
});

Deno.test("Management diagnosis records the exact failing HTTP request and stops before later operations", async () => {
  for (const status of [401, 403, 429, 503]) {
    let calls = 0;
    const report = await probeManagement("synthetic-credential", (async () => {
      calls++; return Response.json({ message: "private provider token synthetic-credential", code: "private-code" }, { status });
    }) as typeof fetch);
    assert.equal(calls, 1);
    assert.equal(report.management_configuration_verified, false);
    assert.equal(report.management_requests[0].http_status, status);
    assert.equal(report.management_requests[0].endpoint, "https://api.supabase.com/v1/projects/zmqlyygzqoidkcwdysok/api-keys");
    assert.equal(JSON.stringify(report).includes("synthetic-credential"), false);
    assert.equal(JSON.stringify(report).includes("private-code"), false);
  }
});

Deno.test("Management diagnosis identifies SQL rejection and never issues a session for an owner", async () => {
  for (const sqlFailure of [true, false]) {
    let calls = 0;
    const report = await probeManagement("synthetic", (async () => {
      if (++calls === 1) return Response.json([{ name: "anon", api_key: "fixture" }, { name: "service_role", api_key: "fixture" }]);
      return sqlFailure ? Response.json({ code: "42501", message: "private SQL details" }, { status: 403 })
        : Response.json([{ controller_memberships: 1 }]);
    }) as typeof fetch);
    assert.equal(calls, 2);
    assert.equal(report.management_configuration_verified, false);
    assert.equal(report.Auth_sessions_issued, 0);
    assert.equal(report.management_requests[1].method, "POST");
    if (sqlFailure) assert.equal(report.management_requests[1].provider_code, "42501");
    else assert.equal(report.error, "engineering_nonowner_identity_required");
    assert.equal(JSON.stringify(report).includes("private SQL details"), false);
  }
});

Deno.test("only exact public error literals are retained as safely redacted provider responses", async () => {
  for (const message of ["Forbidden", "Forbidden private-account-or-credential", "private SQL or response details"]) {
    const report = await probeManagement("synthetic", (async () => Response.json({ message }, { status: 403 })) as typeof fetch);
    assert.equal(report.management_requests[0].provider_response.message,
      message === "Forbidden" ? "Forbidden" : "[redacted provider message]");
    assert.equal(JSON.stringify(report).includes("private-account-or-credential"), false);
    assert.equal(JSON.stringify(report).includes("private SQL or response details"), false);
  }
});
