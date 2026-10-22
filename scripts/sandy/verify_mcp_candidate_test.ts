import { strict as assert } from "node:assert";
import { candidateUrl, managementRequest, type ManagementEvidence, verify, verifyRestCatalogue } from "./verify_mcp_candidate.ts";

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
