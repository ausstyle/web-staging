import assert from "node:assert/strict";
import { setRuntimeDatabase } from "./testing/fallback_client.ts";
import { authenticateRuntime, authenticatePortalUser, bindRuntimeTask, bindRuntimeConversationTask, isAgentPrincipal, type RuntimeConversationTask } from "../../supabase/functions/_shared/sandy-agent-operations/identity.ts";
import { bindV2RuntimeConversation, bindV1BackupRuntimeConversation, executeRuntimeConversation, type RuntimeConversation } from "../../supabase/functions/_shared/sandy-agent-operations/runtime_conversation.ts";
import { executeAgentOperation, executeRuntimeOperation } from "../../supabase/functions/_shared/sandy-agent-operations/service.ts";
import { agentOperationContracts } from "../../supabase/functions/_shared/sandy-agent-operations/contracts.ts";
import { internalRuntimeRecordContracts } from "../../supabase/functions/_shared/sandy-agent-operations/runtime_record_contracts.ts";
import { createAgentOperationHandler } from "../../supabase/functions/sandy-agent-operation-api/index.ts";
import { bindRuntimeOperationalContext, type RuntimeOperationalFacts } from "../../supabase/functions/_shared/sandy-agent-operations/runtime_operational.ts";
import { internalRuntimeOperationalContracts } from "../../supabase/functions/_shared/sandy-agent-operations/runtime_operational_contracts.ts";
import { bindRuntimeConnectionPreflight } from "../../supabase/functions/_shared/sandy-agent-operations/runtime_connection_preflight.ts";
import { runtimeConnectionPreflightContract, runtimeConnectionPreflightOperationName } from "../../supabase/functions/_shared/sandy-agent-operations/runtime_connection_preflight_contract.ts";
import { collectRuntimeSnapshot } from "../../supabase/functions/_shared/sandy-agent-operations/runtime_snapshot.ts";
import { selectRuntimeModel } from "../../supabase/functions/_shared/sandy-agent-operations/runtime_model_policy.ts";

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
  SANDY_INTEGRATION_API_TOKEN: "fixture-runtime-broker-credential",
  SANDY_AUTO_IMPROVE_KEY: "",
  EMAIL_AI_INTERNAL_KEY: "",
  DENO_DEPLOYMENT_ID: "test-unverified-build",
};
const slugs = ["sandy-agent-runtime-v2", "sandy-agent-runtime-v1-backup-r50", "sandy-agent-runtime-v4"];
type Obj = Record<string, any>;
class Database {
  serial = 0;
  bindForeignTask = false;
  failAgentAudit = false;
  failAgentCompletion = false;
  failConversationAudit = false;
  failConversationCompletion = false;
  loseTaskWriteResponse = false;
  rpcValues: Record<string, any> = {};
  rpcCalls: { name: string; args: Obj }[] = [];
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
    let mode = "read", value: Obj, maximum = Infinity, head = false, columns: string[] | null = null;
    const project = (row: Obj | null) => row && columns ? Object.fromEntries(columns.filter(key => key in row).map(key => [key, row[key]])) : row;
    const run = (single: boolean) => {
      this.queries.push({ table, filters: structuredClone(recorded) });
      const rows = this.tables[table] ??= [];
      if (mode === "insert" || mode === "upsert") {
        if (table === "sandy_agent_operation_audit" && this.failAgentAudit) return { data: null, error: { code: "fixture_agent_audit_unavailable" } };
        if (table === "sandy_runtime_conversation_audit" && this.failConversationAudit) return { data: null, error: { code: "fixture_audit_unavailable" } };
        if (table === "sandy_runtime_conversation_audit" && rows.some(r => r.task_id === value.task_id && r.round === value.round)) return { data: null, error: { code: "23505" } };
        if (table === "sandy_agent_tasks" && rows.some(r => r.request_id === value.request_id)) return { data: null, error: { code: "23505" } };
        if (table === "sandy_agent_operation_audit" && value.idempotency_key && rows.some(r => ["customer_id", "principal_kind", "operation", "idempotency_key"].every(k => r[k] === value[k]))) return { data: null, error: { code: "23505" } };
        const row: Obj = { id: `20000000-0000-4000-8000-${String(++this.serial).padStart(12, "0")}`, ...structuredClone(value) };
        if (table === "sandy_connected_gmail_outbox") row.status ??= "awaiting_confirmation";
        if (table === "sandy_agent_tasks" && this.bindForeignTask) row.customer_id = FOREIGN;
        rows.push(row);
        if (table === "sandy_tasks" && this.loseTaskWriteResponse) return { data: null, error: { code: "fixture_committed_write_response_lost" } };
        return { data: single ? structuredClone(project(row)) : [structuredClone(project(row))], error: null };
      }
      const selected = rows.filter(row => filters.every(f => f(row))).slice(0, maximum);
      if (table === "sandy_agent_operation_audit" && mode === "update" && this.failAgentCompletion) return { data: null, error: { code: "fixture_agent_completion_unavailable" } };
      if (table === "sandy_runtime_conversation_audit" && mode === "update" && this.failConversationCompletion) return { data: null, error: { code: "fixture_completion_unavailable" } };
      if (mode === "update") for (const row of selected) Object.assign(row, structuredClone(value));
      return { data: head ? null : single ? structuredClone(project(selected[0] ?? null)) : structuredClone(selected.map(project)), error: null, count: selected.length };
    };
    const query: any = {
      select: (selected: string, options?: Obj) => { columns = selected === "*" ? null : selected.split(",").map(value => value.trim()); head = !!options?.head; return query; },
      eq: (key: string, expected: unknown) => { recorded.push([key, expected]); filters.push(row => row[key] === expected); return query; },
      is: (key: string, expected: unknown) => { recorded.push([key, expected]); filters.push(row => (row[key] ?? null) === expected); return query; },
      in: (key: string, allowed: unknown[]) => { filters.push(row => allowed.includes(row[key])); return query; },
      not: (key: string, operator: string, expected: any) => { filters.push(row => operator === "is" ? row[key] != null : !String(expected).replace(/[()]/g, "").split(",").includes(row[key])); return query; },
      order: () => query,
      ilike: (key: string, value: string) => { const text = value.replace(/^%|%$/g, "").toLowerCase(); filters.push(row => String(row[key] || "").toLowerCase().includes(text)); return query; },
      limit: (n: number) => { maximum = n; return query; },
      insert: (row: Obj) => { mode = "insert"; value = row; return query; },
      upsert: (row: Obj) => { mode = "upsert"; value = row; return query; },
      update: (row: Obj) => { mode = "update"; value = row; return query; },
      maybeSingle: () => Promise.resolve(run(true)), single: () => Promise.resolve(run(true)),
      then: (resolve: (result: any) => unknown) => Promise.resolve(run(false)).then(resolve),
    };
    return query;
  }
  rpc(name: string, args: Obj = {}) {
    this.rpcCalls.push({ name, args });
    const result = Promise.resolve(Object.hasOwn(this.rpcValues, name)
      ? { data: this.rpcValues[name], error: null }
      : { data: null, error: { code: name + "_fixture_unavailable" } });
    return Object.assign(result, { abortSignal: () => result });
  }
}
type Recorded = { url: string; body: Obj; headers: Headers };
let importSerial = 0;
async function runtime(slug: string, db: Database, requests: Recorded[], options: { tools?: Obj[]; unknownSend?: boolean; preflightBody?: any } = {}) {
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
    if (target === "https://api.openai.com/v1/responses" || target === fixtures.SUPABASE_URL + "/functions/v1/sandy-openai-gateway-v4") {
      const broker = target !== "https://api.openai.com/v1/responses";
      const conversation = body.max_output_tokens === 1600 || body.previous_response_id;
      assert.equal(headers.get("authorization"), "Bearer " + (broker && conversation ? fixtures.SUPABASE_SERVICE_ROLE_KEY : fixtures.OPENAI_API_KEY));
      assert.equal(headers.has("x-sandy-integration-token"), broker);
      if (broker) {
        assert.equal(headers.get("x-sandy-integration-token"), fixtures.SANDY_INTEGRATION_API_TOKEN);
        assert.equal(headers.get("x-sandy-purpose"), "web");
      }
      if (body.max_output_tokens === 1600 || body.previous_response_id) {
        if (++conversations === 1 && options.tools?.length) return Response.json({ id: "resp_fixture", output: options.tools.map((tool, i) => ({ type: "function_call", call_id: "call_" + i, name: tool.name, arguments: JSON.stringify(tool.args || {}) })) });
        return Response.json({ id: "resp_finished", output: [{ type: "message", content: [{ type: "output_text", text: "Fixture conversation complete." }] }] });
      }
      const annotation = body.tools?.[0]?.type === "file_search" ? { type: "file_citation", file_id: "file_fixture", filename: "fixture.txt" } : { type: "url_citation", title: "Fixture", url: "https://example.invalid/source" };
      return Response.json({ status: "completed", output: [{ content: [{ type: "output_text", text: "Fixture provider output", annotations: [annotation] }] }] });
    }
    if (target.startsWith("https://backend.composio.dev/api/v3.1/connected_accounts?")) {
      assert.equal(headers.get("x-api-key"), fixtures.COMPOSIO_API_KEY);
      assert.equal(new URL(target).searchParams.get("user_ids"), "sandy_customer_" + CUSTOMER);
      return Response.json(options.preflightBody ?? { items: ["ca_owned", "ca_company"].map(id => ({ id, user_id: "sandy_customer_" + CUSTOMER, status: "ACTIVE" })) });
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
      const modelCalls = requests.filter(r => r.url === "https://api.openai.com/v1/responses" || r.url === fixtures.SUPABASE_URL + "/functions/v1/sandy-openai-gateway-v4");
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
  Deno.test(`${slug}: source-selected approved model and nullable-customer zero-tool conversation remain compatible`, async () => {
    const db = new Database(), requests: Recorded[] = [];
    db.tables.sandy_v2_runtime_policy.find(row => row.policy_key === "adaptive_model_routing")!.mode = "enabled";
    db.tables.ai_task_routes = [{ task_type: "general_assistance", primary_model: "fixture-approved-model", enabled: true }];
    db.tables.ai_model_registry = [{ model_id: "fixture-approved-model", eligibility: "approved", verified_at: new Date().toISOString() }];
    const app = await runtime(slug, db, requests);
    try {
      const result = await app.invoke("Hello Sandy", { customer_id: null, model: "caller-selected-model", tools: [{ name: "dangerous_unregistered_tool" }] });
      assert.equal(result.status, 200); assert.equal(requests.length, 1);
      assert.equal(requests[0].body.model, "fixture-approved-model"); assert.deepEqual(requests[0].body.tools, []);
      assert.equal(audits(db).length, 0);
      const audit = db.tables.sandy_runtime_conversation_audit[0];
      assert.equal(audit.customer_id, null); assert.equal(audit.auth_user_id, null);
      assert.equal(audit.task_id, result.body.task_id); assert.equal(audit.selected_model, "fixture-approved-model");
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

Deno.test("active v4 preserves non-sensitive temporal context and tenant-bound extra lookup tool through its broker conversation", async () => {
  const db = new Database(), requests: Recorded[] = [], foreignTask = "62000000-0000-4000-8000-000000000001";
  db.tables.sandy_tasks = [
    { id: DRAFT, customer_id: CUSTOMER, title: "Owned task", archived_at: null, status: "todo" },
    { id: foreignTask, customer_id: FOREIGN, title: "Foreign task", archived_at: null, status: "todo" },
  ];
  db.rpcValues.sandy_temporal_current = [
    { predicate: "fixture_preference", value: "owned non-sensitive temporal fact", sensitivity: "normal", state: "active", source_ref: "fixture-owned-ref" },
    { predicate: "fixture_private", value: "sensitive fact must not enter model context", sensitivity: "sensitive", state: "active", source_ref: "fixture-sensitive-ref" },
  ];
  const app = await runtime("sandy-agent-runtime-v4", db, requests, { tools: [
    { name: "sandy_context_lookup", args: { operation: "tasks_get", query: "", id: DRAFT } },
    { name: "sandy_context_lookup", args: { operation: "tasks_get", query: "", id: foreignTask } },
  ] });
  try {
    const result = await app.invoke("Find the project record");
    assert.equal(result.status, 200); assert.equal(requests.length, 2);
    assert.equal(requests[0].body.tools.length, 13);
    assert.match(requests[0].body.instructions, /owned non-sensitive temporal fact/);
    assert.doesNotMatch(requests[0].body.instructions, /sensitive fact must not enter/);
    const temporal = db.rpcCalls.find(call => call.name === "sandy_temporal_current");
    assert.deepEqual(temporal?.args, { p_customer_id: CUSTOMER, p_limit: 40 });
    const results = requests[1].body.input.map((item: Obj) => JSON.parse(item.output));
    assert.equal(results[0].records[0].title, "Owned task"); assert.deepEqual(results[1].records, []);
    assert.ok(db.tables.sandy_runtime_conversation_audit.every(row => row.customer_id === CUSTOMER && row.source_runtime === "sandy-agent-runtime-v4"));
  } finally { app.close(); }
});

async function anonymousTask(db: Database): Promise<RuntimeConversationTask> {
  const taskId = "50000000-0000-4000-8000-000000000001";
  db.tables.sandy_agent_tasks.push({ id: taskId, customer_id: null, channel: "test", request_id: "nullable-task-request", user_request: "Hello from the actual task", status: "running" });
  const proof = await authenticateRuntime(new Request("https://internal.invalid", { headers: { authorization: "Bearer fixture-automation" } }), db, "fixture-automation");
  assert.ok(proof);
  const task = await bindRuntimeConversationTask(proof, db, { taskId, customerId: null, channel: "test", requestId: "nullable-task-request" });
  assert.ok(task);
  return task;
}
const initialConversation = (task: RuntimeConversationTask) => ({ model: "gpt-4.1-mini", instructions: "Fixed server adapter instructions", input: task.requestText, tools: [], max_output_tokens: 1600 });
const response = (output: Obj[] = []) => Response.json({ id: "resp_actual_provider_fixture", status: "completed", output });

Deno.test("nullable-customer conversation capability is unforgeable and cannot authorize any customer operation", async () => {
  const db = new Database(), task = await anonymousTask(db);
  assert.equal(task.customerId, null); assert.equal(task.authUserId, null); assert.equal(isAgentPrincipal(task), false);
  const fake = { ...task };
  await assert.rejects(() => bindV2RuntimeConversation(fake, initialConversation(task)), /runtime_conversation_task_required/);
  await assert.rejects(() => bindV2RuntimeConversation(JSON.parse(JSON.stringify(task)), initialConversation(task)), /runtime_conversation_task_required/);
  const forbidden = await executeAgentOperation(task as any, "gmail.messages.recent", { limit: 1 }, { db, base: fixtures.SUPABASE_URL, composioKey: "", openaiKey: "", integrationToken: "", fetch: (() => { throw Error("unreachable"); }) as typeof fetch });
  assert.equal(forbidden.status, 403);
  const taskId = task.taskId;
  assert.equal(await bindRuntimeConversationTask({ serviceCaller: true }, db, { taskId, customerId: null, channel: "test", requestId: task.requestId }), null);
  assert.equal(audits(db).length, 0);
});

Deno.test("both private conversation adapters preserve anonymous zero-tool transport and provider-bound continuation", async () => {
  for (const bind of [bindV2RuntimeConversation, bindV1BackupRuntimeConversation]) {
    const db = new Database(), task = await anonymousTask(db), initial = initialConversation(task);
    const cap = await bind(task, initial), requests: Obj[] = [], timeouts: number[] = [];
    const originalTimeout = AbortSignal.timeout;
    AbortSignal.timeout = ((ms: number) => { timeouts.push(ms); return originalTimeout(ms); }) as typeof AbortSignal.timeout;
    try {
      const fetcher = (async (url: any, init: any) => {
        assert.equal(String(url), "https://api.openai.com/v1/responses"); assert.equal(init.redirect, undefined);
        assert.equal(new Headers(init.headers).get("authorization"), "Bearer fixture-model");
        requests.push(JSON.parse(init.body));
        return requests.length === 1 ? response([{ type: "function_call", name: "unoffered_tool", call_id: "call_from_provider" }]) : response([{ type: "message", content: [{ type: "output_text", text: "No tool executed." }] }]);
      }) as typeof fetch;
      const first = await executeRuntimeConversation(cap, { round: 0, tool_results: [] }, { db, openaiKey: "fixture-model", fetch: fetcher });
      assert.equal(first.status, 200); assert.equal(first.body.customer_id, null); assert.equal(first.body.principal_kind, "trusted_runtime");
      assert.deepEqual(requests[0], initial);
      assert.equal((await executeRuntimeConversation(cap, { round: 1, tool_results: [{ type: "function_call_output", call_id: "foreign_call", output: "{}" }] }, { db, openaiKey: "fixture-model", fetch: fetcher })).status, 400);
      const results = [{ type: "function_call_output" as const, call_id: "call_from_provider", output: '{"error":"unsupported_tool"}' }];
      const second = await executeRuntimeConversation(cap, { round: 1, tool_results: results }, { db, openaiKey: "fixture-model", fetch: fetcher });
      assert.equal(second.status, 200);
      assert.deepEqual(requests[1], { model: initial.model, instructions: initial.instructions, previous_response_id: "resp_actual_provider_fixture", input: results, tools: [], max_output_tokens: 1600 });
      assert.deepEqual(timeouts, [100000, 100000]);
      assert.equal(db.tables.sandy_runtime_conversation_audit.length, 2);
      assert.ok(db.tables.sandy_runtime_conversation_audit.every(row => row.customer_id === null && row.auth_user_id === null && row.state === "succeeded"));
    } finally { AbortSignal.timeout = originalTimeout; }
  }
});

Deno.test("conversation public-shaped overrides, forged profiles, other prompts and added tools are refused before paid execution", async () => {
  const db = new Database(), task = await anonymousTask(db), initial = initialConversation(task);
  await assert.rejects(() => bindV2RuntimeConversation(task, { ...initial, tools: [{ type: "web_search_preview" }] }), /tool_profile_invalid/);
  await assert.rejects(() => bindV2RuntimeConversation(task, { ...initial, input: "An unrelated request" }), /source_contract_invalid/);
  await assert.rejects(() => bindV2RuntimeConversation(task, { ...initial, tool_choice: { type: "function", name: "search_connected_gmail" } }), /tool_choice_invalid/);
  const cap = await bindV2RuntimeConversation(task, initial);
  let calls = 0;
  const deps = { db, openaiKey: "fixture-model", fetch: (async () => { calls++; return response(); }) as typeof fetch };
  assert.equal((await executeRuntimeConversation(JSON.parse(JSON.stringify(cap)), { round: 0, tool_results: [] }, deps)).status, 403);
  assert.equal((await executeRuntimeConversation(cap, { round: 0, tool_results: [], model: "unapproved", tools: [], profile: "legacy" } as any, deps)).status, 400);
  db.tables.sandy_agent_tasks[0].customer_id = FOREIGN;
  assert.equal((await executeRuntimeConversation(cap, { round: 0, tool_results: [] }, deps)).status, 403);
  assert.equal(calls, 0); assert.equal(db.tables.sandy_runtime_conversation_audit?.length || 0, 0);
});

Deno.test("durable conversation audit failure and same-round concurrency prevent duplicate paid requests", async () => {
  const db = new Database(), task = await anonymousTask(db), cap = await bindV2RuntimeConversation(task, initialConversation(task));
  let calls = 0;
  const deps = { db, openaiKey: "fixture-model", fetch: (async () => { calls++; await Promise.resolve(); return response(); }) as typeof fetch };
  db.failConversationAudit = true;
  assert.equal((await executeRuntimeConversation(cap, { round: 0, tool_results: [] }, deps)).status, 503); assert.equal(calls, 0);
  db.failConversationAudit = false;
  const results = await Promise.all([executeRuntimeConversation(cap, { round: 0, tool_results: [] }, deps), executeRuntimeConversation(cap, { round: 0, tool_results: [] }, deps)]);
  assert.equal(results.filter(r => r.status === 200).length, 1); assert.equal(calls, 1);
  assert.equal((await executeRuntimeConversation(cap, { round: 0, tool_results: [] }, deps)).status, 409); assert.equal(calls, 1);
});

Deno.test("unknown conversation and missing final audit receipt cannot be retried, including through a fresh capability", async () => {
  for (const completionFailure of [false, true]) {
    const db = new Database(), task = await anonymousTask(db), initial = initialConversation(task), cap = await bindV2RuntimeConversation(task, initial);
    db.failConversationCompletion = completionFailure;
    let calls = 0;
    const deps = { db, openaiKey: "fixture-model", fetch: (async () => { calls++; if (!completionFailure) throw Error("fixture model result lost"); return response(); }) as typeof fetch };
    const first = await executeRuntimeConversation(cap, { round: 0, tool_results: [] }, deps);
    assert.equal(first.status, 502); assert.equal(first.body.executed, null);
    assert.equal((await executeRuntimeConversation(cap, { round: 0, tool_results: [] }, deps)).status, 409);
    const again = await bindV2RuntimeConversation(task, initial);
    assert.equal((await executeRuntimeConversation(again, { round: 0, tool_results: [] }, deps)).status, 409);
    assert.equal(calls, 1);
  }
});

Deno.test("known incomplete/failed envelopes preserve actual provider status and cannot redispatch the same paid round", async () => {
  for (const status of ["failed", "incomplete"]) {
    const db = new Database(), task = await anonymousTask(db), cap = await bindV2RuntimeConversation(task, initialConversation(task));
    let calls = 0;
    const deps = { db, openaiKey: "fixture-model", fetch: (async () => { calls++; return Response.json({ id: "resp_partial", status, output: [] }); }) as typeof fetch };
    const first = await executeRuntimeConversation(cap, { round: 0, tool_results: [] }, deps);
    assert.equal(first.status, 200); assert.equal(first.body.response.status, status);
    assert.equal(db.tables.sandy_runtime_conversation_audit[0].state, "succeeded");
    assert.equal((await executeRuntimeConversation(cap, { round: 0, tool_results: [] }, deps)).status, 409); assert.equal(calls, 1);
  }
});

const RECORD_TASK = "70000000-0000-4000-8000-000000000001";
const MISSION = "71000000-0000-4000-8000-000000000001";
async function recordPrincipal(db: Database) {
  db.tables.sandy_agent_tasks.push({ id: RECORD_TASK, customer_id: CUSTOMER, channel: "web", request_id: "runtime-records-request", user_request: "Perform the bounded customer record lookup", status: "running" });
  const proof = await authenticateRuntime(new Request("https://internal.invalid", { headers: { authorization: "Bearer fixture-worker" } }), db, "fixture-worker");
  assert.ok(proof);
  const principal = await bindRuntimeTask(proof, db, { taskId: RECORD_TASK, customerId: CUSTOMER, channel: "web", requestId: "runtime-records-request" });
  assert.ok(principal); return principal;
}
const recordServices = (db: Database) => ({ db, base: fixtures.SUPABASE_URL, openaiKey: "", composioKey: "", integrationToken: "", fetch: (() => { throw Error("record operation must never call a provider"); }) as typeof fetch });
function mission(db: Database) {
  db.tables.sandy_tasks = [{ id: MISSION, customer_id: CUSTOMER, title: "Actual owned mission", status: "in_progress", archived_at: null, metadata: { sandy_mission: true } }];
}
Deno.test("nine runtime record contracts remain separately exported and closed to actual customer sessions and JSON/API selection", async () => {
  assert.equal(Object.keys(agentOperationContracts).length, 8); assert.equal(Object.keys(internalRuntimeRecordContracts).length, 9);
  assert.ok(Object.values(internalRuntimeRecordContracts).every(item => item.internal_only && item.sensitive && !item.api_exposed && !item.ui_exposed && !item.ai_exposed));
  const db = new Database(), userId = "72000000-0000-4000-8000-000000000001";
  db.tables.sandy_memory_portal_accounts = [{ auth_user_id: userId, customer_id: CUSTOMER, revoked_at: null }];
  db.tables.email_customer_addresses = [{ customer_id: CUSTOMER, is_primary: true, normalized_email: "fixture@example.invalid" }];
  const auth = { auth: { getUser: async () => ({ data: { user: { id: userId, email: "fixture@example.invalid", email_confirmed_at: "2026-10-20T00:00:00Z" } }, error: null }) } };
  const request = new Request("https://internal.invalid/api", { method: "POST", headers: { authorization: "Bearer fixture-real-user", "content-type": "application/json" }, body: JSON.stringify({ operation: "agent.runtime.tasks.list", arguments: {} }) });
  const user = await authenticatePortalUser(request, db, auth, "fixture-service"); assert.ok(user);
  assert.equal((await executeAgentOperation(user, "agent.runtime.tasks.list", {}, recordServices(db))).status, 403);
  assert.equal((await executeAgentOperation(user, "agent.runtime.operational.activity", {}, recordServices(db))).status, 403);
  assert.equal((await executeAgentOperation(user, runtimeConnectionPreflightOperationName, { idempotency_key: "customer-denied-key" }, recordServices(db))).status, 403);
  const handler = createAgentOperationHandler({ ...recordServices(db), auth, serviceCredential: "fixture-service" });
  assert.equal((await handler(request)).status, 400);
  assert.equal(audits(db).length, 0);
});
Deno.test("shared runtime task listing preserves exact owned totals, delegation names and real in-progress status", async () => {
  const db = new Database(), principal = await recordPrincipal(db);
  db.tables.sandy_tasks = [
    { id: MISSION, customer_id: CUSTOMER, title: "Todo task", status: "todo", archived_at: null },
    { id: DRAFT, customer_id: CUSTOMER, title: "Doing task", status: "in_progress", archived_at: null },
    { id: COMPANY, customer_id: CUSTOMER, title: "Waiting task", status: "waiting", archived_at: null },
    { id: "73000000-0000-4000-8000-000000000001", customer_id: CUSTOMER, title: "Completed task", status: "completed", archived_at: null },
    { id: "73000000-0000-4000-8000-000000000002", customer_id: CUSTOMER, title: "Archived task", status: "todo", archived_at: "2026-10-20" },
    { id: "73000000-0000-4000-8000-000000000003", customer_id: FOREIGN, title: "Foreign task", status: "todo", archived_at: null },
  ];
  db.tables.sandy_task_delegations = [{ task_id: MISSION, assignee_customer_id: FOREIGN, status: "accepted", scope: "fixture delegation" }];
  db.tables.email_customers = [{ id: FOREIGN, display_name: "Delegated person" }];
  const result = await executeAgentOperation(principal, "agent.runtime.tasks.list", {}, recordServices(db));
  assert.equal(result.status, 200); assert.equal(result.body.task_id, RECORD_TASK);
  assert.equal(result.legacy.outstanding_count, 3); assert.equal(result.legacy.in_progress_count, 1); assert.equal(result.legacy.todo_is_in_progress, false);
  assert.deepEqual(result.legacy.status_breakdown, { todo: 1, in_progress: 1, waiting: 1 });
  assert.equal(result.legacy.tasks[0].delegations[0].assignee, "Delegated person");
  assert.equal(result.legacy.tasks.some((task: Obj) => task.title === "Foreign task"), false);
});
Deno.test("client-action and image-approval writes preserve mission ownership, immutable child IDs and same-key/deduplicated replay", async () => {
  const db = new Database(), principal = await recordPrincipal(db); mission(db);
  db.tables.sandy_ai_integrations.push({ integration_key: "openai_image", deployment_status: "staged_not_generated" });
  const deps = recordServices(db), args = { mission_id: MISSION, title: "Provide the document", details: "Upload the actual source document" };
  const first = await executeRuntimeOperation(principal, "agent.runtime.tasks.request_client_action", args, deps, "client-action-step");
  assert.equal(first.ok, true); assert.notEqual(first.task_id, RECORD_TASK);
  const repeat = await executeRuntimeOperation(principal, "agent.runtime.tasks.request_client_action", args, deps, "client-action-step");
  assert.equal(repeat.task_id, first.task_id);
  const duplicate = await executeRuntimeOperation(principal, "agent.runtime.tasks.request_client_action", args, deps, "separate-client-action-step");
  assert.equal(duplicate.task_id, first.task_id); assert.equal(duplicate.already_exists, true);
  const approval = await executeRuntimeOperation(principal, "agent.runtime.images.request_approval", { mission_id: MISSION, prompt: "A proposed image requiring client cost approval" }, deps, "image-approval-step");
  assert.equal(approval.ok, true); assert.equal(approval.approval_pending, true);
  const saved = db.tables.sandy_tasks.find(row => row.id === approval.task_id);
  assert.equal(saved?.metadata.cost_approval_required, true); assert.equal(saved?.metadata.assigned_to, "client");
  assert.equal(db.tables.sandy_tasks.length, 3);
  const foreign = await executeRuntimeOperation(principal, "agent.runtime.tasks.request_client_action", { ...args, mission_id: FOREIGN }, deps, "foreign-mission-step");
  assert.equal(foreign.error, "mission_unavailable"); assert.equal(db.tables.sandy_tasks.length, 3);
});
Deno.test("lost committed record write is unknown and the same audited step never repeats the write", async () => {
  const db = new Database(), principal = await recordPrincipal(db); mission(db); db.loseTaskWriteResponse = true;
  const args = { mission_id: MISSION, title: "Provide the document", details: "Actual client action" }, deps = recordServices(db);
  const first = await executeRuntimeOperation(principal, "agent.runtime.tasks.request_client_action", args, deps, "lost-child-result");
  assert.equal(first.state, "unknown"); assert.equal(db.tables.sandy_tasks.length, 2);
  assert.equal(audits(db)[0].state, "unknown");
  db.loseTaskWriteResponse = false;
  const repeat = await executeRuntimeOperation(principal, "agent.runtime.tasks.request_client_action", args, deps, "lost-child-result");
  assert.equal(repeat.error, "agent_operation_outcome_requires_reconciliation"); assert.equal(db.tables.sandy_tasks.length, 2);
});
Deno.test("history, connection and narrow record reads preserve customer scope and original bounded content", async () => {
  const db = new Database(), principal = await recordPrincipal(db), deps = recordServices(db);
  db.rpcValues.sandy_search_unified_history = [{ source: "fixture-owned-source", content: "x".repeat(2000) }];
  const history = await executeRuntimeOperation(principal, "agent.runtime.history.search", { query: "Earlier facts" }, deps, "history");
  assert.equal(history.matches[0].content.length, 1500); assert.deepEqual(db.rpcCalls.at(-1)?.args, { p_customer_id: CUSTOMER, p_query: "Earlier facts", p_limit: 8 });
  const connections = await executeRuntimeOperation(principal, "agent.runtime.connections.list", {}, deps, "connections");
  assert.deepEqual(connections.services.map((item: Obj) => item.account_id), ["ca_owned", "ca_company"]);
  db.tables.sandy_universal_files = [
    { id: DRAFT, owner_customer_id: CUSTOMER, display_name: "Owned file", library_state: "ready" },
    { id: MISSION, owner_customer_id: CUSTOMER, display_name: "Owned deleted file", library_state: "deleted" },
    { id: FOREIGN, owner_customer_id: FOREIGN, display_name: "Foreign file", library_state: "ready" },
  ];
  const files = await executeRuntimeOperation(principal, "agent.runtime.context.files.find", { query: "file" }, deps, "files");
  assert.deepEqual(files.records.map((item: Obj) => item.display_name), ["Owned file"]);
  db.tables.sandy_memory_archive = [
    { id: DRAFT, owner_customer_id: CUSTOMER, state: "active", channel: "web", content: "needle " + "x".repeat(1500) },
    { id: FOREIGN, owner_customer_id: FOREIGN, state: "active", channel: "web", content: "needle foreign" },
  ];
  const memory = await executeRuntimeOperation(principal, "agent.runtime.context.memory.search", { query: "needle" }, deps, "memory");
  assert.equal(memory.records.length, 1); assert.equal(memory.records[0].content.length, 900);
  assert.ok(audits(db).every(row => row.customer_id === CUSTOMER && row.task_id === RECORD_TASK && row.state === "succeeded"));
});

for (const slug of slugs) Deno.test(`${slug}: common record tool loop calls central audited contracts without changing the outer runtime result`, async () => {
  const db = new Database(), requests: Recorded[] = []; mission(db);
  db.rpcValues.sandy_search_unified_history = [{ channel: "web", content: "Owned history fixture" }];
  db.tables.sandy_ai_integrations.push({ integration_key: "openai_image", deployment_status: "staged" });
  const app = await runtime(slug, db, requests, { tools: [
    { name: "request_client_action", args: { mission_id: MISSION, title: "Provide the source", details: "Actual client action" } },
    { name: "list_tasks" }, { name: "search_history", args: { query: "Owned facts" } }, { name: "list_connected_services" },
    { name: "request_image_approval", args: { mission_id: MISSION, prompt: "An image proposed for client approval" } },
  ] });
  try {
    const result = await app.invoke("Help with the project plan");
    assert.equal(result.status, 200); assert.equal(requests.length, 2);
    const returned = requests[1].body.input.map((item: Obj) => JSON.parse(item.output));
    assert.equal(returned[0].ok, true); assert.notEqual(returned[0].task_id, result.body.task_id);
    assert.equal(returned[1].outstanding_count, 2); assert.equal(returned[2].matches[0].content, "Owned history fixture");
    assert.equal(returned[3].services.length, 2); assert.equal(returned[4].approval_pending, true);
    assert.equal(audits(db).length, 5); assert.ok(audits(db).every(row => row.state === "succeeded" && row.task_id === result.body.task_id));
  } finally { app.close(); }
});

function operationalFacts(): RuntimeOperationalFacts {
  return { channel: "web", activityFacts: { status: "verified", scope: "web_only", all_web_messages: 5, current_conversation_messages: null, current_conversation_state: "not_supplied_or_not_authorized" },
    communicationFacts: { status: "unavailable" }, services: [], connectionError: null, clock: "Tuesday, 20 October 2026 at 10:00 am", timezone: "UTC" };
}
Deno.test("operational snapshots bind the exact live principal and cannot be serialized, shared with another task principal or selected by JSON", async () => {
  const db = new Database(), principal = await recordPrincipal(db), facts = operationalFacts();
  const cap = bindRuntimeOperationalContext(principal, facts); assert.ok(cap);
  facts.activityFacts.all_web_messages = 999;
  const deps = { ...recordServices(db), runtimeContext: cap };
  const actual = await executeAgentOperation(principal, "agent.runtime.operational.activity", {}, deps);
  assert.equal(actual.status, 200); assert.equal(actual.legacy.all_web_messages, 5);
  assert.equal((await executeAgentOperation(principal, "agent.runtime.operational.activity", { context: cap }, deps)).status, 400);
  const forged = await executeAgentOperation(principal, "agent.runtime.operational.activity", {}, { ...deps, runtimeContext: JSON.parse(JSON.stringify(cap)) });
  assert.equal(forged.legacy.error, "runtime_operational_context_required");
  const otherDb = new Database(), otherPrincipal = await recordPrincipal(otherDb);
  const foreign = await executeAgentOperation(otherPrincipal, "agent.runtime.operational.activity", {}, { ...recordServices(otherDb), runtimeContext: cap });
  assert.equal(foreign.legacy.error, "runtime_operational_context_required");
  db.tables.sandy_agent_tasks[0].channel = "email";
  assert.equal((await executeAgentOperation(principal, "agent.runtime.operational.activity", {}, deps)).legacy.error, "runtime_operational_task_binding_mismatch");
  assert.ok(Object.values(internalRuntimeOperationalContracts).every(c => c.internal_only && c.sensitive && !c.api_exposed && !c.ui_exposed && !c.ai_exposed));
});
Deno.test("operational unknown activity and absent versions remain unknown while server timezone never becomes physical-location proof", async () => {
  const db = new Database(), principal = await recordPrincipal(db), facts = operationalFacts(); facts.activityFacts = { status: "unavailable" };
  const deps = { ...recordServices(db), runtimeContext: bindRuntimeOperationalContext(principal, facts) };
  assert.equal((await executeRuntimeOperation(principal, "agent.runtime.operational.activity", {}, deps, "activity")).error, "conversation_activity_unavailable");
  assert.equal((await executeRuntimeOperation(principal, "agent.runtime.operational.versions", {}, deps, "versions")).error, "unsupported_operational_domain");
  const environment = await executeRuntimeOperation(principal, "agent.runtime.operational.environment", {}, deps, "environment");
  assert.equal(environment.timezone, "UTC"); assert.equal(environment.physical_location, "not_available"); assert.equal(environment.precision, "none");
});
Deno.test("operational capability inspection respects channel filters and invalidates stale module status without claiming provider execution", async () => {
  const db = new Database(), principal = await recordPrincipal(db), deps = { ...recordServices(db), runtimeContext: bindRuntimeOperationalContext(principal, operationalFacts()) };
  db.tables.sandy_capability_catalog = [{ feature_key: "web-fixture", channels: ["web"] }, { feature_key: "email-fixture", channels: ["email"] }];
  db.tables.sandy_module_status = [{ module_key: "stale-fixture", operational_status: "operational", last_tested_at: "2000-01-01T00:00:00Z" }, { module_key: "fresh-fixture", operational_status: "partial", last_tested_at: new Date().toISOString() }];
  const result = await executeAgentOperation(principal, "agent.runtime.operational.capabilities", {}, deps);
  assert.equal(result.status, 200); assert.deepEqual(result.legacy.capabilities.map((item: Obj) => item.key), ["web-fixture"]);
  assert.equal(result.legacy.modules[0].operational_status, "unverified"); assert.equal(result.legacy.modules[0].stale, true);
  assert.equal(result.legacy.modules[1].operational_status, "partial"); assert.equal(result.legacy.modules[1].stale, false);
  assert.match(result.legacy.note, /not necessarily operational/);
});
for (const slug of slugs) Deno.test(`${slug}: operational tool domains share fixed contracts with preserved source-qualified counts and no fabricated version or location`, async () => {
  const db = new Database(), requests: Recorded[] = [], domains = ["conversation_activity", "communication_activity", "connections", "environment", "capabilities", "versions"];
  const app = await runtime(slug, db, requests, { tools: domains.map(domain => ({ name: "inspect_sandy_operational_state", args: { domain } })) });
  try {
    const result = await app.invoke("Inspect the recorded operational facts"); assert.equal(result.status, 200);
    const returned = requests[1].body.input.map((item: Obj) => JSON.parse(item.output));
    assert.equal(returned[0].scope, "web_only"); assert.equal(returned[0].all_web_messages, 0);
    assert.equal(returned[1].counts.email_authored_by_verified_customer, null);
    assert.match(returned[1].caveat, /not combine unverified email counts/);
    assert.ok(returned[2].services.every((item: Obj) => item.state === "locally_recorded_active_not_provider_verified"));
    assert.equal(returned[3].physical_location, "not_available");
    assert.equal(returned[5].error, slug === "sandy-agent-runtime-v1-backup-r50" ? "unsupported_operational_domain" : "version_registry_unavailable");
    assert.equal(audits(db).length, slug === "sandy-agent-runtime-v1-backup-r50" ? 5 : 6);
    assert.equal(Object.keys(agentOperationContracts).length, 8);
  } finally { app.close(); }
});

Deno.test("shared snapshot collector derives only actual customer facts and refuses serialized or non-customer conversation capabilities", async () => {
  const db = new Database(), principal = await recordPrincipal(db);
  db.tables.sandy_web_turns = [{ id: DRAFT, customer_id: CUSTOMER }, { id: FOREIGN, customer_id: FOREIGN }];
  const expected = { channel: "web", requestId: "runtime-records-request", conversationId: null };
  const facts = await collectRuntimeSnapshot(principal, db, expected);
  assert.equal(facts.activityFacts.all_web_messages, 1); assert.equal(facts.v2Connections.length, 2);
  const before = db.queries.length;
  await assert.rejects(() => collectRuntimeSnapshot(JSON.parse(JSON.stringify(principal)), db, expected), /runtime_snapshot_task_required/);
  assert.equal(db.queries.length, before);
  const proof = await authenticateRuntime(new Request("https://internal.invalid", { headers: { authorization: "Bearer fixture-worker" } }), db, "fixture-worker"); assert.ok(proof);
  const conversation = await bindRuntimeConversationTask(proof, db, { taskId: RECORD_TASK, customerId: CUSTOMER, channel: "web", requestId: expected.requestId }); assert.ok(conversation);
  await assert.rejects(() => collectRuntimeSnapshot(conversation, db, expected), /runtime_snapshot_task_required/);
  await assert.rejects(() => collectRuntimeSnapshot(principal, db, { ...expected, requestId: "another-request-id" }), /persisted_scope_mismatch/);
});
Deno.test("actual NULL-customer snapshot reads global policy only and never supplies a fabricated tenant or conversation", async () => {
  const db = new Database(), task = await anonymousTask(db); db.queries.length = 0;
  const expected = { channel: task.channel, requestId: task.requestId, conversationId: null };
  const facts = await collectRuntimeSnapshot(task, db, expected);
  assert.equal(facts.activityFacts.status, "not_checked"); assert.equal(facts.communicationFacts.status, "unavailable"); assert.deepEqual(facts.v2Connections, []); assert.deepEqual(facts.v2Services, []);
  assert.deepEqual([...new Set(db.queries.map(q => q.table))].sort(), ["sandy_agent_tasks", "sandy_v2_runtime_policy"]);
  await assert.rejects(() => collectRuntimeSnapshot(task, db, { ...expected, conversationId: DRAFT }), /anonymous_scope_mismatch/);
});

Deno.test("shared model policy keeps approved recent server routes, stale/disabled fallback and actual shadow task ownership", async () => {
  const db = new Database(), principal = await recordPrincipal(db), options = { mode: "enabled", prompt: principal.requestText, requestId: "runtime-records-request" };
  db.tables.ai_task_routes = [{ task_type: "general_assistance", primary_model: "fixture-approved-model", enabled: true }];
  db.tables.ai_model_registry = [{ model_id: "fixture-approved-model", eligibility: "approved", verified_at: "2000-01-01T00:00:00Z" }];
  assert.equal((await selectRuntimeModel(principal, db, options)).model, "gpt-4.1-mini");
  db.tables.ai_model_registry[0].verified_at = new Date().toISOString();
  assert.equal((await selectRuntimeModel(principal, db, { ...options, mode: "shadow" })).model, "gpt-4.1-mini");
  assert.equal((await selectRuntimeModel(principal, db, options)).model, "fixture-approved-model");
  assert.ok(db.tables.sandy_v2_model_decisions.every(row => row.customer_id === CUSTOMER && row.request_id === options.requestId));
  const count = db.tables.sandy_v2_model_decisions.length;
  await assert.rejects(() => selectRuntimeModel(JSON.parse(JSON.stringify(principal)), db, options), /task_required/);
  await assert.rejects(() => selectRuntimeModel(principal, db, { ...options, prompt: "An unrelated request" }), /scope_mismatch/);
  assert.equal(db.tables.sandy_v2_model_decisions.length, count);
});

for (const slug of slugs) {
  Deno.test(`${slug}: shared connection preflight preserves the existing fast path and rejects false provider confirmation`, async () => {
    for (const malformed of [false, true]) {
      const db = new Database(), requests: Recorded[] = [];
      db.tables.sandy_v2_runtime_policy[0].mode = "approved_recent";
      const app = await runtime(slug, db, requests, malformed ? { preflightBody: {} } : {});
      try {
        const result = await app.invoke("Which apps are connected?");
        assert.equal(result.status, 200); assert.equal(result.body.tools_used[0].tool, "v2_connection_preflight");
        assert.equal(result.body.tools_used[0].provider_check, malformed ? "unavailable" : "confirmed");
        assert.match(result.body.response, malformed ? /live provider status not verified/ : /confirmed active by provider/);
        assert.equal(requests.length, 1); assert.equal(db.tables.sandy_runtime_conversation_audit?.length || 0, 0);
        assert.equal(audits(db).length, 1); assert.equal(audits(db)[0].operation, runtimeConnectionPreflightOperationName);
        assert.equal(audits(db)[0].customer_id, CUSTOMER); assert.equal(audits(db)[0].state, "succeeded");
        assert.equal(db.tables.sandy_supervisor_findings?.length || 0, 0);
      } finally { app.close(); }
    }
  });
}
Deno.test("connection preflight is a closed cost/mutation contract and stable audit prevents repeated diagnosis or unknown replay", async () => {
  assert.equal(Object.keys(agentOperationContracts).length, 8);
  assert.ok(runtimeConnectionPreflightContract.is_mutation && runtimeConnectionPreflightContract.consumes_model_resources && runtimeConnectionPreflightContract.sensitive);
  assert.equal(runtimeConnectionPreflightContract.api_exposed, false);
  for (const completionLost of [false, true]) {
    const db = new Database(), principal = await recordPrincipal(db), work: Promise<unknown>[] = []; let provider = 0, diagnosis = 0;
    const deps = { ...recordServices(db), composioKey: "fixture-composio", autoImproveKey: "fixture-diagnosis", defer: (promise: Promise<unknown>) => work.push(promise),
      connectionPreflight: bindRuntimeConnectionPreflight(principal, { channel: "web", requestId: "runtime-records-request", connections: [db.tables.sandy_composio_connections[0]], workspaceNames: new Map(), connectionError: null, requestedService: null }),
      fetch: (async (url: any) => { if (String(url).startsWith("https://backend.composio.dev/")) { provider++; return Response.json({ items: [] }); } diagnosis++; return Response.json({ accepted: true }); }) as typeof fetch };
    db.failAgentCompletion = completionLost;
    const result = await executeRuntimeOperation(principal, runtimeConnectionPreflightOperationName, {}, deps, "same-preflight");
    await Promise.all(work);
    if (completionLost) assert.equal(result.state, "unknown"); else assert.equal(result.diagnosis_requests_scheduled, 1);
    const repeated = await executeRuntimeOperation(principal, runtimeConnectionPreflightOperationName, {}, deps, "same-preflight");
    if (completionLost) assert.equal(repeated.error, "agent_operation_outcome_requires_reconciliation"); else assert.deepEqual(repeated, result);
    assert.equal(provider, 1); assert.equal(diagnosis, 1); assert.equal(db.tables.sandy_supervisor_findings.length, 1);
  }
});
Deno.test("connection preflight cannot reach a provider without persisted audit and exact live request binding", async () => {
  const db = new Database(), principal = await recordPrincipal(db); let calls = 0;
  const deps = { ...recordServices(db), connectionPreflight: bindRuntimeConnectionPreflight(principal, { channel: "web", requestId: "runtime-records-request", connections: [], workspaceNames: new Map(), connectionError: null, requestedService: null }),
    fetch: (async () => { calls++; throw Error("unreachable"); }) as typeof fetch };
  db.failAgentAudit = true;
  assert.equal((await executeRuntimeOperation(principal, runtimeConnectionPreflightOperationName, {}, deps, "refused-audit")).error, "agent_audit_unavailable");
  db.failAgentAudit = false; db.tables.sandy_agent_tasks[0].request_id = "different-request";
  assert.equal((await executeRuntimeOperation(principal, runtimeConnectionPreflightOperationName, {}, deps, "refused-task")).error, "runtime_connection_preflight_task_mismatch");
  assert.equal(calls, 0);
});
