import assert from "node:assert/strict";
import { setRuntimeDatabase } from "./testing/fallback_client.ts";

// Run with the test-only import map in testing/fallback_import_map.json. The
// actual candidate handlers, identity capabilities, Gmail code, contracts and
// shared application executor run; only Supabase transport and fetch are fake.
const CUSTOMER = "10000000-0000-4000-8000-000000000001";
const FOREIGN = "10000000-0000-4000-8000-000000000002";
const DRAFT = "30000000-0000-4000-8000-000000000001";
const COMPANY = "40000000-0000-4000-8000-000000000001";
const fixtures = {
  SUPABASE_SERVICE_ROLE_KEY: "fixture-runtime-service-credential",
  SUPABASE_URL: "https://zmqlyygzqoidkcwdysok.supabase.co",
  OPENAI_API_KEY: "fixture-runtime-openai-credential",
  COMPOSIO_API_KEY: "fixture-runtime-composio-credential",
  DENO_DEPLOYMENT_ID: "test-unverified-build",
};
const slugs = ["sandy-agent-runtime-v2", "sandy-agent-runtime-v1-backup-r50"];
type Obj = Record<string, any>;
class Database {
  serial = 0;
  bindForeignTask = false;
  queries: { table: string; filters: [string, unknown][] }[] = [];
  tables: Record<string, Obj[]> = {
    sandy_agent_tasks: [], sandy_agent_operation_audit: [],
    sandy_ai_integrations: ["composio_connector", "openai_web_search", "openai_file_search", "openai_evals", "openai_agents"].map(integration_key => ({ integration_key, enabled: true })),
    sandy_composio_connections: [
      { customer_id: CUSTOMER, toolkit_slug: "gmail", connected_account_id: "ca_owned", company_id: null, status: "ACTIVE" },
      { customer_id: CUSTOMER, toolkit_slug: "gmail", connected_account_id: "ca_company", company_id: COMPANY, status: "ACTIVE" },
      { customer_id: FOREIGN, toolkit_slug: "gmail", connected_account_id: "ca_foreign", company_id: null, status: "ACTIVE" },
    ],
    sandy_agenda_companies: [{ customer_id: CUSTOMER, id: COMPANY, name: "Fixture Company" }],
    sandy_file_search_stores: [{ customer_id: CUSTOMER, vector_store_id: "vs_owned", verified_at: "2026-10-20T00:00:00Z" }, { customer_id: FOREIGN, vector_store_id: "vs_foreign", verified_at: "2026-10-20T00:00:00Z" }],
    sandy_v2_release_control: [{ id: 1, public_version: "2.7.3" }],
    sandy_v2_runtime_policy: [{ policy_key: "executive_runtime", mode: "disabled" }, { policy_key: "adaptive_model_routing", mode: "disabled" }],
    sandy_connected_gmail_outbox: [{ id: DRAFT, customer_id: CUSTOMER, connected_account_id: "ca_owned", workspace_company_id: null, status: "awaiting_confirmation", recipient: "fixture@example.invalid", subject: "Original subject", body_text: "Original body", provider_result: {} }],
  };
  from(table: string) {
    const filters: ((row: Obj) => boolean)[] = [], recorded: [string, unknown][] = [];
    let mode = "read", value: Obj, maximum = Infinity, head = false;
    const run = (single: boolean) => {
      this.queries.push({ table, filters: structuredClone(recorded) });
      const rows = this.tables[table] ??= [];
      if (mode === "insert" || mode === "upsert") {
        if (table === "sandy_agent_tasks" && rows.some(r => r.request_id === value.request_id)) return { data: null, error: { code: "23505" } };
        if (table === "sandy_agent_operation_audit" && value.idempotency_key && rows.some(r => ["customer_id", "principal_kind", "operation", "idempotency_key"].every(k => r[k] === value[k]))) return { data: null, error: { code: "23505" } };
        const row: Obj = { id: `20000000-0000-4000-8000-${String(++this.serial).padStart(12, "0")}`, ...structuredClone(value) };
        if (table === "sandy_connected_gmail_outbox") row.status ??= "awaiting_confirmation";
        if (table === "sandy_agent_tasks" && this.bindForeignTask) row.customer_id = FOREIGN;
        rows.push(row);
        return { data: single ? structuredClone(row) : [structuredClone(row)], error: null };
      }
      const selected = rows.filter(row => filters.every(f => f(row))).slice(0, maximum);
      if (mode === "update") for (const row of selected) Object.assign(row, structuredClone(value));
      return { data: head ? null : single ? structuredClone(selected[0] ?? null) : structuredClone(selected), error: null, count: selected.length };
    };
    const query: any = {
      select: (_columns: string, options?: Obj) => { head = !!options?.head; return query; },
      eq: (key: string, expected: unknown) => { recorded.push([key, expected]); filters.push(row => row[key] === expected); return query; },
      is: (key: string, expected: unknown) => { recorded.push([key, expected]); filters.push(row => (row[key] ?? null) === expected); return query; },
      in: (key: string, allowed: unknown[]) => { filters.push(row => allowed.includes(row[key])); return query; },
      not: (key: string, operator: string, expected: any) => { filters.push(row => operator === "is" ? row[key] != null : !String(expected).replace(/[()]/g, "").split(",").includes(row[key])); return query; },
      order: () => query,
      limit: (n: number) => { maximum = n; return query; },
      insert: (row: Obj) => { mode = "insert"; value = row; return query; },
      upsert: (row: Obj) => { mode = "upsert"; value = row; return query; },
      update: (row: Obj) => { mode = "update"; value = row; return query; },
      maybeSingle: () => Promise.resolve(run(true)), single: () => Promise.resolve(run(true)),
      then: (resolve: (result: any) => unknown) => Promise.resolve(run(false)).then(resolve),
    };
    return query;
  }
  rpc(name: string) {
    const result = Promise.resolve({ data: null, error: { code: name + "_fixture_unavailable" } });
    return Object.assign(result, { abortSignal: () => result });
  }
}
type Recorded = { url: string; body: Obj; headers: Headers };
let importSerial = 0;
async function runtime(slug: string, db: Database, requests: Recorded[], options: { tools?: Obj[]; unknownSend?: boolean } = {}) {
  const previousEnv = Object.fromEntries(Object.keys(fixtures).map(key => [key, Deno.env.get(key)]));
  for (const [key, value] of Object.entries(fixtures)) Deno.env.set(key, value);
  const originalServe = Deno.serve, originalFetch = globalThis.fetch;
  let handler: ((req: Request) => Promise<Response>) | undefined;
  let conversations = 0;
  Deno.serve = ((value: any) => { handler = value; return {} as any; }) as typeof Deno.serve;
  globalThis.fetch = (async (url, init) => {
    const body = init?.body ? JSON.parse(String(init.body)) : {};
    const headers = new Headers(init?.headers);
    const target = String(url);
    requests.push({ url: target, body, headers });
    if (target === "https://api.openai.com/v1/responses") {
      assert.equal(headers.get("authorization"), "Bearer " + fixtures.OPENAI_API_KEY);
      assert.equal(headers.has("x-sandy-integration-token"), false);
      if (body.max_output_tokens === 1600 || body.previous_response_id) {
        if (++conversations === 1 && options.tools?.length) return Response.json({ id: "resp_fixture", output: options.tools.map((tool, i) => ({ type: "function_call", call_id: "call_" + i, name: tool.name, arguments: JSON.stringify(tool.args || {}) })) });
        return Response.json({ id: "resp_finished", output: [{ type: "message", content: [{ type: "output_text", text: "Fixture conversation complete." }] }] });
      }
      const annotation = body.tools?.[0]?.type === "file_search" ? { type: "file_citation", file_id: "file_fixture", filename: "fixture.txt" } : { type: "url_citation", title: "Fixture", url: "https://example.invalid/source" };
      return Response.json({ status: "completed", output: [{ content: [{ type: "output_text", text: "Fixture provider output", annotations: [annotation] }] }] });
    }
    if (target === "https://api.openai.com/v1/evals?limit=20") return Response.json({ data: [{ id: "eval_fixture", name: "Fixture eval", created_at: 123 }] });
    assert.ok(target.startsWith("https://backend.composio.dev/api/v3/tools/execute/"), "unexpected external URL: " + target);
    assert.equal(headers.get("x-api-key"), fixtures.COMPOSIO_API_KEY);
    assert.equal(body.user_id, "sandy_customer_" + CUSTOMER);
    assert.equal(body.connected_account_id, "ca_owned");
    if (target.endsWith("/GMAIL_SEND_EMAIL")) {
      if (options.unknownSend) throw Error("fixture interrupted after provider admission");
      return Response.json({ successful: true, data: { id: "abcdef1234567890" } });
    }
    if (target.endsWith("/GMAIL_FETCH_MESSAGE_BY_MESSAGE_ID")) return Response.json({ successful: true, data: { id: "abcdef1234567890", labelIds: ["SENT"], subject: "Original subject", headers: [{ name: "to", value: "fixture@example.invalid" }] } });
    assert.ok(target.endsWith("/GMAIL_FETCH_EMAILS"));
    return Response.json({ successful: true, data: { messages: [{ id: "abcdef1234567890", subject: "Fixture message", sender: "sender@example.invalid" }] } });
  }) as typeof fetch;
  setRuntimeDatabase(db);
  try {
    await import(new URL(`../../supabase/functions/${slug}/index.ts?compat=${++importSerial}`, import.meta.url).href);
    assert.ok(handler);
    return {
      invoke: async (prompt: string, extras: Obj = {}, headers: Record<string, string> = { authorization: "Bearer " + fixtures.SUPABASE_SERVICE_ROLE_KEY }) => {
        const request = new Request("https://internal.invalid/runtime", { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify({ channel: "web", request_id: "fixture-request-" + (++importSerial), customer_id: CUSTOMER, request: prompt, ...extras }) });
        const response = await handler!(request);
        return { status: response.status, body: await response.json() };
      },
      close: () => {
        Deno.serve = originalServe; globalThis.fetch = originalFetch;
        for (const [key, value] of Object.entries(previousEnv)) value === undefined ? Deno.env.delete(key) : Deno.env.set(key, value);
      },
    };
  } catch (error) {
    Deno.serve = originalServe; globalThis.fetch = originalFetch;
    for (const [key, value] of Object.entries(previousEnv)) value === undefined ? Deno.env.delete(key) : Deno.env.set(key, value);
    throw error;
  }
}
const audits = (db: Database) => db.tables.sandy_agent_operation_audit;
for (const slug of slugs) {
  Deno.test(`${slug}: service and hashed expiring QA authentication preserve task/conversation binding`, async () => {
    const db = new Database(), requests: Recorded[] = [], app = await runtime(slug, db, requests);
    try {
      assert.equal((await app.invoke("Confirm send " + DRAFT, {}, { authorization: "Bearer invalid" })).status, 403);
      assert.equal(db.tables.sandy_agent_tasks.length, 0);
      const token = "a".repeat(64);
      const hash = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token)))).map(v => v.toString(16).padStart(2, "0")).join("");
      db.tables.sandy_runtime_test_credentials = [{ id: 1, token_sha256: hash, expires_at: "2000-01-01T00:00:00Z" }];
      assert.equal((await app.invoke("Confirm send " + DRAFT, {}, { "x-sandy-qa-token": token })).status, 403);
      db.tables.sandy_runtime_test_credentials[0].expires_at = "2099-01-01T00:00:00Z";
      const result = await app.invoke("What time is it?", { conversation_id: DRAFT }, { "x-sandy-qa-token": token });
      assert.equal(result.status, 200); assert.equal(result.body.model, "system-clock");
      assert.equal(db.queries.some(q => q.table === "sandy_web_conversations"), false, "QA caller must not assert service-only conversation association");
      assert.equal(requests.length, 0);
    } finally { app.close(); }
  });
  Deno.test(`${slug}: exact confirmation performs one tenant-bound send and independent Sent Mail readback`, async () => {
    const db = new Database(), requests: Recorded[] = [], app = await runtime(slug, db, requests);
    try {
      const first = await app.invoke("Confirm send " + DRAFT);
      assert.equal(first.status, 200); assert.equal(first.body.tools_used[0].sent_mail_verified, true);
      const repeat = await app.invoke("Confirm send " + DRAFT);
      assert.equal(repeat.body.tools_used[0].duplicate_prevented, true);
      assert.equal(requests.filter(r => r.url.endsWith("/GMAIL_SEND_EMAIL")).length, 1);
      assert.equal(requests.filter(r => r.url.endsWith("/GMAIL_FETCH_MESSAGE_BY_MESSAGE_ID")).length, 1);
      assert.equal(db.tables.sandy_connected_gmail_outbox[0].status, "sent");
      assert.ok(audits(db).every(row => row.customer_id === CUSTOMER && row.principal_kind === "trusted_runtime" && row.auth_user_id === null && row.task_id));
      assert.equal(audits(db).length, 2);
    } finally { app.close(); }
  });
  Deno.test(`${slug}: unknown send and foreign draft/task never cause automatic resend or identity substitution`, async () => {
    const db = new Database(), requests: Recorded[] = [], app = await runtime(slug, db, requests, { unknownSend: true });
    try {
      const first = await app.invoke("Confirm send " + DRAFT);
      assert.equal(first.body.tools_used[0].sent_mail_verified, false);
      await app.invoke("Confirm send " + DRAFT);
      assert.equal(requests.filter(r => r.url.endsWith("/GMAIL_SEND_EMAIL")).length, 1);
      assert.equal(db.tables.sandy_connected_gmail_outbox[0].status, "sending");
      db.tables.sandy_connected_gmail_outbox[0].customer_id = FOREIGN;
      await app.invoke("Confirm send " + DRAFT);
      assert.equal(requests.length, 1);
      db.bindForeignTask = true;
      await app.invoke("Confirm send " + DRAFT);
      assert.equal(requests.length, 1); assert.equal(audits(db).length, 3);
    } finally { app.close(); }
  });
  Deno.test(`${slug}: recent inbox and empty-query tool search reuse bounded customer-owned Gmail provider implementation`, async () => {
    const db = new Database(), requests: Recorded[] = [], app = await runtime(slug, db, requests, { tools: [{ name: "search_connected_gmail", args: { query: "" } }] });
    try {
      const recent = await app.invoke("Show the last five emails in Gmail");
      assert.equal(recent.status, 200); assert.match(recent.body.response, /Retrieved 1 of 5/);
      assert.deepEqual(requests[0].body.arguments, { query: "in:inbox", max_results: 5, include_payload: false });
      const search = await app.invoke("Summarise selected Gmail items");
      assert.equal(search.status, 200);
      const read = requests.find(r => r.body.arguments?.query === "in:anywhere");
      assert.ok(read); assert.equal(read.body.arguments.max_results, 10); assert.equal(read.body.arguments.include_payload, true);
      assert.deepEqual(audits(db).map(row => row.operation), ["gmail.messages.recent", "gmail.messages.search"]);
    } finally { app.close(); }
  });
  Deno.test(`${slug}: original fallback Responses transport handles shared research/document/evaluation/planning tools`, async () => {
    const db = new Database(), requests: Recorded[] = [], tools = [
      { name: "research_web", args: { query: "Find current public information" } },
      { name: "search_customer_documents", args: { query: "Find private documents" } },
      { name: "list_evaluation_benchmarks" },
      { name: "draft_execution_plan", args: { goal: "Prepare the next execution plan" } },
    ], app = await runtime(slug, db, requests, { tools });
    try {
      const result = await app.invoke("Research and plan the next work");
      assert.equal(result.status, 200);
      const modelCalls = requests.filter(r => r.url === "https://api.openai.com/v1/responses");
      assert.equal(modelCalls.length, 5, "two original conversation rounds plus three shared paid operations");
      assert.equal(modelCalls[0].body.model, "gpt-5.2");
      assert.equal(modelCalls[1].body.model, "gpt-4.1-mini"); assert.equal(modelCalls[1].body.tools[0].type, "web_search_preview");
      assert.deepEqual(modelCalls[2].body.tools[0].vector_store_ids, ["vs_owned"]);
      assert.equal(modelCalls[3].body.max_output_tokens, 800); assert.equal(modelCalls[3].body.tools, undefined);
      assert.equal(requests.filter(r => r.url.endsWith("/v1/evals?limit=20")).length, 1);
      assert.deepEqual(audits(db).map(row => row.operation), ["agent.web.research", "agent.documents.search", "agent.evaluations.list", "agent.execution_plan.draft"]);
      assert.ok(audits(db).every(row => row.state === "succeeded" && row.customer_id === CUSTOMER && row.task_id === result.body.task_id));
    } finally { app.close(); }
  });
  Deno.test(`${slug}: disabled flags and unverified private store refuse action-provider execution`, async () => {
    const db = new Database(), requests: Recorded[] = [];
    db.tables.sandy_ai_integrations.forEach(row => row.enabled = false);
    db.tables.sandy_file_search_stores[0].verified_at = null;
    const app = await runtime(slug, db, requests, { tools: [{ name: "research_web", args: { query: "Find current public information" } }, { name: "search_customer_documents", args: { query: "Find private documents" } }, { name: "draft_execution_plan", args: { goal: "Prepare the next execution plan" } }] });
    try {
      assert.equal((await app.invoke("Research and plan the next work")).status, 200);
      assert.equal(requests.length, 2, "only unchanged conversation rounds are called");
      assert.ok(requests.every(r => r.body.max_output_tokens === 1600 || r.body.previous_response_id));
      assert.ok(audits(db).every(row => row.state === "failed"));
    } finally { app.close(); }
  });
}

Deno.test("fallback v2 public version fast path preserves authoritative metadata without model execution", async () => {
  const db = new Database(), requests: Recorded[] = [], app = await runtime(slugs[0], db, requests);
  try {
    const result = await app.invoke("What Sandy version are you running?");
    assert.equal(result.status, 200); assert.equal(result.body.response, "I'm running Sandy 2.7.3.");
    assert.equal(requests.length, 0); assert.equal(audits(db).length, 0);
  } finally { app.close(); }
});
