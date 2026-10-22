// Isolated, non-production fixture. Platform JWT verification must stay enabled.
Deno.serve((request) => {
  if (request.method !== "GET") return Response.json({ error: "method_not_allowed" }, { status: 405 });
  console.info("sandy_engineering_execution_fixture_20261021_v1");
  return Response.json({
    fixture: "sandy_engineering_execution_fixture_20261021",
    version: 1,
    secret_configured: Deno.env.get("SANDY_MCP_ENGINEERING_TEST_20261021") !== undefined,
  }, { headers: { "cache-control": "no-store" } });
});
