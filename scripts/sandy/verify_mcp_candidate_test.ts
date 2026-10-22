import { strict as assert } from "node:assert";
import { acceptanceRequestEvidence, candidateUrl, managementRequest, selectManagementBinding, type ManagementEvidence, verify, verifyRestCatalogue } from "./verify_mcp_candidate.ts";

Deno.test("acceptance transport diagnostics preserve requests and errors without private data", async () => {
  const url = "https://zmqlyygzqoidkcwdysok.supabase.co/functions/v1/sandy-operation-api/v1/capabilities?cursor=private-cursor";
  const init = { headers: { authorization: "Bearer private-token" }, body: "private-body", method: "POST" };
  const error = new DOMException("private-timeout-detail", "TimeoutError");
  let calls = 0;
  const evidence = acceptanceRequestEvidence((async (input, options) => {
    calls++; assert.equal(input, url); assert.equal(options, init); throw error;
  }) as typeof fetch);
  await assert.rejects(() => evidence.request(url, init), e => e === error);
  assert.equal(calls, 1); // No automatic retry or changed authentication.
  assert.deepEqual(evidence.snapshot(), { endpoint: "API_REST_catalogue", method: "POST", http_status: null, outcome: "timeout" });
  assert.equal(JSON.stringify(evidence.snapshot()).includes("private"), false);
});

Deno.test("failure request snapshot survives session cleanup and hides arbitrary destinations", async () => {
  const evidence = acceptanceRequestEvidence((async () => new Response(null, { status: 403 })) as typeof fetch);
  const response = await evidence.request("https://sandy-api-review---sandy-engineering-mcp-fixture-ew.a.run.app/mcp", { method: "POST" });
  assert.equal(response.status, 403);
  const failure = evidence.snapshot();
  await evidence.request("https://zmqlyygzqoidkcwdysok.supabase.co/auth/v1/admin/users/private-id?secret=private-token");
  assert.deepEqual(failure, { endpoint: "candidate_mcp", method: "POST", http_status: 403, outcome: "response_received" });
  assert.equal(evidence.snapshot()?.endpoint, "project_auth");
  for (const url of ["https://private-user:private-password@outside.invalid/private-path?token=private-token",
    "https://zmqlyygzqoidkcwdysok.supabase.co/private-path", "http://api.supabase.com/private-path"]) {
    await evidence.request(url);
    assert.equal(evidence.snapshot()?.endpoint, "redacted_endpoint");
    assert.equal(JSON.stringify(evidence.snapshot()).includes("private"), false);
  }
});

Deno.test("release acceptance uses only the tagged endpoint of the exact preserved Sandy service", () => {
  const before = { service: "sandy-engineering-mcp", project: "elaborate-haven-511518-a5", source_commit_candidate: "a".repeat(40),
    url: "https://sandy-engineering-mcp-fixture-ew.a.run.app" };
  const after = { status: { traffic: [{ tag: "sandy-api-review", url: "https://sandy-api-review---sandy-engineering-mcp-fixture-ew.a.run.app" }] } };
  assert.equal(candidateUrl(before, after, "a".repeat(40)), "https://sandy-api-review---sandy-engineering-mcp-fixture-ew.a.run.app/mcp");
  for (const url of ["https://outside.invalid", "https://user:password@sandy-api-review---sandy-engineering-mcp-fixture-ew.a.run.app",
    "https://sandy-api-review---sandy-engineering-mcp-fixture-ew.a.run.app/other", "http://sandy-api-review---sandy-engineering-mcp-fixture-ew.a.run.app",
    "https://sandy-api-review---sandy-engineering-mcp-other.a.run.app"]) {
    assert.throws(() => candidateUrl(before, { status: { traffic: [{ tag: "sandy-api-review", url }] } }, "a".repeat(40)));
  }
  assert.throws(() => candidateUrl({ ...before, project: "other" }, after));
  assert.throws(() => candidateUrl(before, after, "b".repeat(40)));
});

Deno.test("protected MCP acceptance needs no VM grant and distinguishes an empty provider log window from event delivery", async () => {
  const original = globalThis.fetch;
  const calls: string[] = [];
  const tool = { name: "supabase.logs.query", inputSchema: { type: "object", required: ["source", "start", "end", "limit"] },
    outputSchema: { type: "object", required: ["provider_http_status", "result"] } };
  globalThis.fetch = (async (_url: unknown, init: RequestInit) => {
    const message = JSON.parse(String(init.body)); calls.push(message.method);
    let result;
    if (message.method === "initialize") result = { serverInfo: { name: "fixture", version: "test" } };
    else if (message.method === "tools/list") result = { tools: [tool] };
    else {
      assert.equal(message.params.name, "supabase.logs.query");
      const args = message.params.arguments;
      assert.equal(args.limit, 5);
      assert.ok(Date.parse(args.end) - Date.parse(args.start) <= 60000);
      const denied = args.source !== "function_logs";
      result = { isError: denied, content: [],
        _meta: { sandy_api: { status: denied ? 403 : 200, result: denied ? { executed: false } : {
          executed: true, admission_id: "11111111-1111-4111-8111-111111111111",
        } } }, structuredContent: denied ? {} : { provider_http_status: 200, result: { entries: [] } } };
    }
    return Response.json({ jsonrpc: "2.0", id: message.id, result });
  }) as typeof fetch;
  try {
    const proof = await verify("https://fixed-fixture.invalid/mcp", "synthetic.user", "synthetic.anon");
    assert.equal(proof.provider_log_query_verified, true);
    assert.equal(proof.matching_fixture_markers, 0);
    assert.equal(proof.log_event_delivery_verified, false);
    assert.equal(proof.VM_diagnostics_performed, false);
    assert.equal(proof.wrong_source_denied_before_admission, true);
    assert.deepEqual(calls, ["initialize", "tools/list", "tools/call", "tools/call"]);
  } finally { globalThis.fetch = original; }
});

Deno.test("REST acceptance rejects a server that ignores page limits and checks an advancing authorized catalogue", async () => {
  const original = globalThis.fetch;
  let ignoreLimit = true;
  const records = Array.from({ length: 5 }, (_, i) => ({ operation: "fixture.read." + i }));
  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = new URL(String(input));
    if (url.pathname.endsWith("/supabase.logs.query")) return Response.json({ ok: true,
      operation: { operation: "supabase.logs.query", input_schema: {}, output_schema: {} } });
    if (url.pathname.endsWith("/engineering.job.approve")) return Response.json({ error: "scope_denied" }, { status: 403 });
    if (url.searchParams.getAll("limit").length > 1) return Response.json({ error: "invalid_page" }, { status: 400 });
    return Response.json({ ok: true, catalogue_version: "a".repeat(64),
      operations: ignoreLimit ? [...records, { operation: "supabase.logs.query" }]
        : url.searchParams.has("cursor") ? [{ operation: "supabase.logs.query" }] : records,
      ...(!ignoreLimit && !url.searchParams.has("cursor") ? { next_cursor: "sc1." + "a".repeat(64) + ".5" } : {}) });
  }) as typeof fetch;
  try {
    await assert.rejects(() => verifyRestCatalogue("synthetic.user", "synthetic.anon"), /API_REST_catalogue_page_invalid/);
    ignoreLimit = false;
    const proof = await verifyRestCatalogue("synthetic.user", "synthetic.anon");
    assert.equal(proof.API_REST_discovery_pages, 2);
    assert.equal(proof.API_REST_operations_observed, 6);
    assert.equal(proof.out_of_scope_description_status, 403);
  } finally { globalThis.fetch = original; }
});

Deno.test("Management acceptance records exact endpoint and status without provider bodies or credentials", async () => {
  const credential = "synthetic-secret-never-record", providerSecret = "private-provider-data";
  for (const [status, message, classification] of [
    [401, "Invalid access token " + providerSecret, "token_invalid_expired_or_revoked"],
    [403, "Forbidden " + providerSecret, "authorization_denied"],
    [429, providerSecret, "rate_limited"], [503, providerSecret, "provider_unavailable"],
    [400, "column i.missing does not exist " + providerSecret, "database_column_missing"],
  ] as const) {
    const evidence: ManagementEvidence[] = [];
    const transport = (async (url, init) => {
      assert.equal(url, "https://api.supabase.com/v1/projects/zmqlyygzqoidkcwdysok/api-keys");
      assert.equal(init?.redirect, "error");
      assert.equal((init?.headers as Record<string, string>).authorization, "Bearer " + credential);
      return Response.json({ message, code: providerSecret }, { status });
    }) as typeof fetch;
    await assert.rejects(() => managementRequest("/api-keys", credential, evidence, undefined, transport), /engineering_management_request_failed/);
    assert.equal(evidence[0].http_status, status); assert.equal(evidence[0].classification, classification);
    assert.equal(JSON.stringify(evidence).includes(credential), false); assert.equal(JSON.stringify(evidence).includes(providerSecret), false);
  }
});
Deno.test("Management acceptance preserves read-only SQL, successful receipts and rejects other paths", async () => {
  const evidence: ManagementEvidence[] = [];
  const transport = (async (_url, init) => {
    assert.equal(init?.method, "POST"); assert.equal(JSON.parse(String(init.body)).read_only, true);
    return Response.json([{ fixture: true }], { status: 201 });
  }) as typeof fetch;
  assert.deepEqual(await managementRequest("/database/query", "synthetic", evidence, { read_only: true, query: "SELECT 1" }, transport), [{ fixture: true }]);
  assert.equal(evidence[0].classification, "success"); assert.equal(evidence[0].http_status, 201);
  await assert.rejects(() => managementRequest("/database/query", "synthetic", [], { query: "SELECT 1" }, transport), /contract_invalid/);
  await assert.rejects(() => managementRequest("/outside" as any, "synthetic", [], undefined, transport), /contract_invalid/);
  const errors: ManagementEvidence[] = [];
  await assert.rejects(() => managementRequest("/api-keys", "synthetic", errors, undefined,
    (async () => { throw Error("synthetic-private-error"); }) as typeof fetch), /engineering_management_request_failed/);
  assert.equal(errors[0].classification, "transport_unavailable");
  assert.equal(JSON.stringify(errors).includes("synthetic-private-error"), false);
});

Deno.test("binding assessment compares only fixed resources and selects an existing authorized binding after 403", async () => {
  const assessments: any[] = [], calls: string[] = [];
  const transport = (async (input, init) => {
    const url = new URL(String(input)), token = (init?.headers as Record<string, string>).authorization;
    calls.push(token + " " + url.pathname);
    if (url.pathname === "/v1/profile") return Response.json({ private: "never-output" }, { status: 403 });
    if (url.pathname === "/v1/organizations") return Response.json([]);
    if (url.pathname === "/v1/projects/zmqlyygzqoidkcwdysok") return Response.json({ ref: "zmqlyygzqoidkcwdysok", organization_slug: "fygliqnwsicjuawdofrp" });
    if (url.pathname.endsWith("/api-keys")) return token === "Bearer original-secret" ? Response.json({ message: "forbidden" }, { status: 403 })
      : Response.json([{ name: "service_role", api_key: "private-service" }, { name: "anon", api_key: "private-anon" }]);
    assert.equal(JSON.parse(String(init?.body)).read_only, true);
    return Response.json([{ acceptance_management_read_probe: 1 }], { status: 201 });
  }) as typeof fetch;
  const selected = await selectManagementBinding([
    { name: "SUPABASE_ACCESS_TOKEN", credential: "original-secret" },
    { name: "SANDY_SUPABASE_ACCESS_TOKEN", credential: "existing-secret" },
  ], assessments, transport);
  assert.equal(selected.name, "SANDY_SUPABASE_ACCESS_TOKEN");
  assert.equal(assessments[0].blocker, "project_visible_management_permission_denied");
  assert.equal(assessments[0].requests.find((r: any) => r.endpoint.endsWith("/api-keys")).http_status, 403);
  assert.equal(assessments[1].required_management_access_verified, true);
  assert.equal(assessments[1].account_ownership_verified, false);
  for (const value of ["original-secret", "existing-secret", "private-service", "private-anon", "never-output"]) assert.ok(!JSON.stringify(assessments).includes(value));
  assert.equal(calls.some(c => c.endsWith("/members")), false);
});
Deno.test("binding selection preserves a working primary and does not use alternate credentials for outages or wrong resources", async () => {
  for (const condition of ["working", "outage", "wrong-project", "denied"]) {
    const reports: any[] = [], tokens: string[] = [];
    const transport = (async (input, init) => {
      const url = new URL(String(input)); tokens.push((init?.headers as Record<string, string>).authorization);
      if (url.pathname.endsWith("/api-keys")) return condition === "outage" ? Response.json({}, { status: 503 })
        : condition === "denied" ? Response.json({}, { status: 403 }) : Response.json([{ name: "service_role", api_key: "private-service" }, { name: "anon", api_key: "private-anon" }]);
      if (url.pathname.endsWith("/database/query")) return Response.json([{ acceptance_management_read_probe: 1 }], { status: 201 });
      if (url.pathname.endsWith("/zmqlyygzqoidkcwdysok")) return Response.json({ ref: condition === "wrong-project" ? "other" : "zmqlyygzqoidkcwdysok", organization_slug: "fygliqnwsicjuawdofrp" });
      return Response.json({}, { status: 403 });
    }) as typeof fetch;
    const bindings = [{ name: "SUPABASE_ACCESS_TOKEN" as const, credential: "primary" },
      { name: "SANDY_SUPABASE_MANAGEMENT_TOKEN" as const, credential: condition === "denied" ? undefined : "alternate" }];
    if (condition === "working") assert.equal((await selectManagementBinding(bindings, reports, transport)).name, "SUPABASE_ACCESS_TOKEN");
    else await assert.rejects(() => selectManagementBinding(bindings, reports, transport), condition === "denied" ? /credential_scope_insufficient/ : condition === "outage" ? /request_failed/ : /project_binding_unverified/);
    assert.equal(tokens.includes("Bearer alternate"), false);
  }
});
Deno.test("account ownership is asserted only from an accessible matching profile and target organisation member", async () => {
  const reports: any[] = [], subject = "11111111-1111-4111-8111-111111111111";
  const transport = (async (input) => {
    const path = new URL(String(input)).pathname;
    if (path === "/v1/profile") return Response.json({ gotrue_id: subject, primary_email: "private@example.invalid", username: "private-user" });
    if (path.endsWith("/members")) return Response.json([{ user_id: subject, role_name: "Owner", email: "private@example.invalid" }, { user_id: "another-user", role_name: "Administrator" }]);
    if (path.endsWith("/api-keys")) return Response.json([{ name: "service_role", api_key: "service" }, { name: "anon", api_key: "anon" }]);
    if (path.endsWith("/database/query")) return Response.json([{ acceptance_management_read_probe: 1 }], { status: 201 });
    if (path === "/v1/organizations") return Response.json([{ slug: "fygliqnwsicjuawdofrp" }]);
    return Response.json({ ref: "zmqlyygzqoidkcwdysok", organization_slug: "fygliqnwsicjuawdofrp" });
  }) as typeof fetch;
  await selectManagementBinding([{ name: "SUPABASE_ACCESS_TOKEN", credential: "private-token" }], reports, transport);
  assert.equal(reports[0].account_ownership_verified, true); assert.deepEqual(reports[0].self_organization_roles, ["owner"]);
  for (const secret of [subject, "private@example.invalid", "private-user", "another-user", "private-token"]) assert.ok(!JSON.stringify(reports).includes(secret));
});
