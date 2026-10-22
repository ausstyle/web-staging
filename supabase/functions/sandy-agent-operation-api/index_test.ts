import { createAgentOperationHandler } from "./index.ts";
import { agentOperationContracts } from "../_shared/sandy-agent-operations/contracts.ts";
import { authenticatePortalUser, authenticateRuntime, bindRuntimeTask, AgentPrincipal } from "../_shared/sandy-agent-operations/identity.ts";
import { AgentServices, executeAgentOperation, executeRuntimeOperation } from "../_shared/sandy-agent-operations/service.ts";
import {bindRuntimeConnectionPreflight} from "../_shared/sandy-agent-operations/runtime_connection_preflight.ts";

const CUSTOMER = "10000000-0000-4000-8000-000000000001";
const FOREIGN = "10000000-0000-4000-8000-000000000002";
const USER = "20000000-0000-4000-8000-000000000001";
const TASK = "30000000-0000-4000-8000-000000000001";
const DRAFT = "40000000-0000-4000-8000-000000000001";
function assert(condition: unknown, message = "assertion failed"): asserts condition { if (!condition) throw Error(message); }
function equal(a: unknown, b: unknown) { assert(JSON.stringify(a) === JSON.stringify(b), `Expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`); }
const clone = (x: any) => JSON.parse(JSON.stringify(x));
class Db {
  tables: Record<string, any[]> = {
    sandy_agent_tasks: [{ id: TASK, customer_id: CUSTOMER, channel: "web", request_id: "request_123456", status: "running", user_request: "Confirm send " + DRAFT }],
    sandy_ai_integrations: ["composio_connector", "openai_web_search", "openai_file_search", "openai_evals", "openai_agents"].map((integration_key) => ({ integration_key, enabled: true })),
    sandy_composio_connections: [{ customer_id: CUSTOMER, connected_account_id: "acct_mine", company_id: null, toolkit_slug: "gmail", status: "ACTIVE" },
      { customer_id: FOREIGN, connected_account_id: "acct_foreign", company_id: null, toolkit_slug: "gmail", status: "ACTIVE" }],
    sandy_agenda_companies: [],
    sandy_connected_gmail_outbox: [{ id: DRAFT, customer_id: CUSTOMER, connected_account_id: "acct_mine", workspace_company_id: null,
      recipient: "recipient@example.test", subject: "Exact subject", body_text: "Exact body", status: "awaiting_confirmation", provider_result: null }],
    sandy_memory_portal_accounts: [{ auth_user_id: USER, customer_id: CUSTOMER, revoked_at: null }],
    email_customer_addresses: [{ customer_id: CUSTOMER, normalized_email: "customer@example.test", is_primary: true }],
    sandy_controller_admins: [],
    sandy_agent_operation_audit: [],
    sandy_file_search_stores: [{ customer_id: CUSTOMER, vector_store_id: "vs_mine", verified_at: "2026-10-20T00:00:00Z" },
      { customer_id: FOREIGN, vector_store_id: "vs_foreign", verified_at: "2026-10-20T00:00:00Z" }],
    sandy_operation_registry: Object.entries(agentOperationContracts).map(([operation, c]) => ({ ...clone(c), operation,
      handler: "sandy-agent-operation-api", api_exposed: !c.is_mutation, ai_exposed: !c.is_mutation, verified: false })),
  };
  failAudit = false; counter = 100;
  from(table: string) { return new Query(this, table); }
}
class Query {
  filters: ((row: any) => boolean)[] = []; mode = "read"; data: any; maximum = Infinity;
  constructor(private db: Db, private table: string) {}
  select(_columns: string) { return this; }
  eq(name: string, value: any) { this.filters.push((r) => r[name] === value); return this; }
  is(name: string, value: any) { return this.eq(name, value); }
  in(name: string, values: any[]) { this.filters.push((r) => values.includes(r[name])); return this; }
  limit(n: number) { this.maximum = n; return this; }
  insert(data: any) { this.mode = "insert"; this.data = clone(data); return this; }
  update(data: any) { this.mode = "update"; this.data = clone(data); return this; }
  async run(single: boolean) {
    if (this.table === "sandy_agent_operation_audit" && this.db.failAudit) return { data: null, error: { code: "unavailable" } };
    const rows = this.db.tables[this.table] ??= [];
    if (this.mode === "insert") {
      if (this.table === "sandy_agent_operation_audit" && this.data.idempotency_key && rows.some((r) =>
        ["customer_id", "principal_kind", "operation", "idempotency_key"].every((k) => r[k] === this.data[k])))
        return { data: null, error: { code: "23505" } };
      const row = { id: "90000000-0000-4000-8000-" + String(++this.db.counter).padStart(12, "0"),
        ...(this.table === "sandy_connected_gmail_outbox" ? { status: "awaiting_confirmation", provider_result: null } : {}), ...this.data };
      rows.push(row); return { data: single ? clone(row) : [clone(row)], error: null };
    }
    const result = rows.filter((r) => this.filters.every((f) => f(r))).slice(0, this.maximum);
    if (this.mode === "update") for (const row of result) Object.assign(row, this.data);
    return { data: single ? clone(result[0] ?? null) : clone(result), error: null };
  }
  maybeSingle() { return this.run(true); }
  single() { return this.run(true); }
  then(resolve: (value: any) => unknown) { return this.run(false).then(resolve); }
}
const auth = { auth: { getUser: async (token: string) => token === "actual-user-jwt" ? {
  data: { user: { id: USER, email: "Customer@example.test", email_confirmed_at: "2026-10-20T00:00:00Z" } }, error: null,
} : { data: { user: null }, error: { code: "invalid" } } } };
function request(body?: unknown, token = "actual-user-jwt") { return new Request("https://sandy.example.test/agent", {
  method: "POST", headers: { authorization: "Bearer " + token, "content-type": "application/json" }, body: JSON.stringify(body ?? {}),
}); }
async function runtime(db: Db): Promise<AgentPrincipal> {
  const proof = await authenticateRuntime(request({}, "worker-secret"), db, "worker-secret");
  assert(proof);
  const context = await bindRuntimeTask(proof, db, { taskId: TASK, customerId: CUSTOMER, channel: "web", requestId: "request_123456" });
  assert(context); return context;
}
async function customer(db: Db): Promise<AgentPrincipal> {
  const context = await authenticatePortalUser(request(), db, auth, "worker-secret"); assert(context); return context;
}
function services(db: Db, fetcher?: typeof fetch): AgentServices {
  return { db, base: "https://zmqlyygzqoidkcwdysok.supabase.co", composioKey: "provider-only-secret",
    openaiKey: "model-only-secret", integrationToken: "broker-integration-secret", fetch: fetcher ?? (async () => { throw Error("Unexpected external request"); }) as typeof fetch };
}
const provider = (data: any, status = 200) => Response.json(data, { status });
const sendReceipt = { successful: true, data: { id: "abcdef12345678" } };
const verifiedReceipt = { successful: true, data: { id: "abcdef12345678", labelIds: ["SENT"],
  payload: { headers: [{ name: "Subject", value: "Exact subject" }, { name: "To", value: "recipient@example.test" }] } } };

Deno.test("persisted read-only assessment mode rejects every mutation before provider execution or admission", async () => {
  const db = new Db(); db.tables.sandy_agent_tasks[0].plan = { execution_mode: "read_only_assessment" };
  const context = await runtime(db); equal(context.readOnly, true);
  let calls = 0;
  for (const operation of Object.entries(agentOperationContracts).filter(([, contract]) => contract.is_mutation).map(([name]) => name)) {
    const denied = await executeAgentOperation(context, operation, {}, services(db, (async () => { calls++; throw Error("must not execute"); }) as typeof fetch));
    equal(denied.status, 403); equal(denied.body.error, "read_only_assessment_mutation_denied"); equal(denied.body.executed, false);
  }
  equal(calls, 0); equal(db.tables.sandy_agent_operation_audit.length, 0);
  const forged = { ...context, readOnly: false } as AgentPrincipal;
  equal((await executeAgentOperation(forged, "gmail.messages.search", { query: "test" }, services(db))).status, 403);
});
Deno.test("a revoked voice source prevents the next operation even after principal binding",async()=>{
  const db=new Db();const sid="50000000-0000-4000-8000-000000000001";
  db.tables.sandy_agent_tasks[0].channel="voice";db.tables.sandy_agent_tasks[0].plan={voice_session_id:sid};
  db.tables.sandy_voice_call_sessions=[{id:sid,owner_customer_id:CUSTOMER,link_id:"link",created_at:new Date().toISOString(),state:"connected"}];
  db.tables.sandy_voice_call_links=[{id:"link",owner_customer_id:CUSTOMER,revoked_at:"now"}];
  db.tables.sandy_voice_private_auth=[{session_id:sid,owner_customer_id:CUSTOMER,verified_at:"verified"}];
  const proof=await authenticateRuntime(request({},"worker-secret"),db,"worker-secret");assert(proof);
  const principal=await bindRuntimeTask(proof,db,{taskId:TASK,customerId:CUSTOMER,channel:"voice",requestId:"request_123456"});assert(principal);
  const result=await executeAgentOperation(principal,"gmail.messages.search",{query:"test"},services(db));
  equal(result.status,403);equal(result.body.error,"voice_source_authorization_expired_or_revoked");equal(result.body.executed,false);equal(db.tables.sandy_agent_operation_audit.length,0);
});
Deno.test("read-only runtime connection inspection reaches the provider but never schedules discrepancy repair",async()=>{
 const db=new Db();db.tables.sandy_agent_tasks[0].plan={execution_mode:"read_only_assessment"};const principal=await runtime(db);
 const cap=bindRuntimeConnectionPreflight(principal,{channel:"web",requestId:"request_123456",connections:[{connected_account_id:"acct_mine",toolkit_slug:"gmail",company_id:null,status:"ACTIVE"}],workspaceNames:new Map(),connectionError:null,requestedService:null});
 let calls=0;const deps=services(db,(async()=>{calls++;return Response.json({items:[],next_cursor:null});}) as typeof fetch);
 deps.connectionPreflight=cap;deps.autoImproveKey="fixture";deps.defer=()=>{throw Error("must not schedule diagnosis");};
 const result=await executeRuntimeOperation(principal,"agent.runtime.connections.inspect",{},deps,"inspect-fixture");
 equal(calls,1);equal(result.mismatches,1);equal(result.findings_recorded,0);equal(result.diagnosis_requests_scheduled,0);equal(db.tables.sandy_supervisor_findings?.length||0,0);
 equal(db.tables.sandy_agent_operation_audit.length,1);
});

Deno.test("forged principals, serialized worker grants and mismatched task tenants cannot execute", async () => {
  const db = new Db();
  const forged = { kind: "trusted_runtime", customerId: CUSTOMER, taskId: TASK } as AgentPrincipal;
  const denied = await executeAgentOperation(forged, "gmail.messages.search", { query: "test" }, services(db));
  equal(denied.status, 403); equal(db.tables.sandy_agent_operation_audit.length, 0);
  equal(await bindRuntimeTask({ serviceCaller: true }, db, { taskId: TASK, customerId: CUSTOMER, channel: "web", requestId: "request_123456" }), null);
  const proof = await authenticateRuntime(request({}, "worker-secret"), db, "worker-secret"); assert(proof);
  equal(await bindRuntimeTask(proof, db, { taskId: TASK, customerId: FOREIGN, channel: "web", requestId: "request_123456" }), null);
  equal(await bindRuntimeTask(proof, db, { taskId: TASK, customerId: CUSTOMER, channel: "email", requestId: "request_123456" }), null);
});

Deno.test("customer sessions remain distinct from worker and API-key credentials; primary ownership is checked", async () => {
  const db = new Db();
  equal(await authenticatePortalUser(request({}, "worker-secret"), db, auth, "worker-secret"), null);
  const keyRequest = request(); keyRequest.headers.set("x-sandy-api-key", "opaque-not-a-session");
  equal(await authenticatePortalUser(keyRequest, db, auth, "worker-secret"), null);
  const user = await customer(db); equal(user.kind, "auth_user"); equal(user.taskId, null); equal(user.customerId, CUSTOMER);
  db.tables.email_customer_addresses[0].normalized_email = "other@example.test";
  equal(await authenticatePortalUser(request(), db, auth, "worker-secret"), null);
});

Deno.test("temporary QA authentication retains hash and expiry checks but never becomes a user principal", async () => {
  const db = new Db(), token = "a".repeat(64);
  const hash = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token))))
    .map((v) => v.toString(16).padStart(2, "0")).join("");
  db.tables.sandy_runtime_test_credentials = [{ id: 1, token_sha256: hash, expires_at: "2026-10-21T00:00:00Z" }];
  const req = request({}, "not-service"); req.headers.set("x-sandy-qa-token", token);
  const proof = await authenticateRuntime(req, db, "worker-secret", Date.parse("2026-10-20T00:00:00Z")); assert(proof);
  equal(proof.serviceCaller, false);
  const ctx = await bindRuntimeTask(proof, db, { taskId: TASK, customerId: CUSTOMER, channel: "web", requestId: "request_123456" });
  equal(ctx?.kind, "trusted_runtime"); equal(ctx?.authUserId, null);
  equal(await authenticateRuntime(req, db, "worker-secret", Date.parse("2026-10-22T00:00:00Z")), null);
});

Deno.test("Gmail confirmed send uses immutable tenant-owned draft and independently verifies Sent Mail; replay never resends", async () => {
  const db = new Db(), calls: { url: string; init: RequestInit; body: any }[] = [];
  const fetcher = (async (url: any, init: RequestInit) => {
    calls.push({ url: String(url), init, body: JSON.parse(String(init.body)) });
    return provider(calls.length === 1 ? sendReceipt : verifiedReceipt);
  }) as typeof fetch;
  const ctx = await runtime(db), deps = services(db, fetcher);
  const args = { draft_id: DRAFT, confirmation: "Confirm send " + DRAFT };
  const first = await executeAgentOperation(ctx, "gmail.drafts.confirm_send", args, deps);
  equal(first.status, 200); equal(first.body.sent_mail_verified, true); equal(calls.length, 2);
  equal(calls[0].url, "https://backend.composio.dev/api/v3/tools/execute/GMAIL_SEND_EMAIL");
  equal(calls[1].url, "https://backend.composio.dev/api/v3/tools/execute/GMAIL_FETCH_MESSAGE_BY_MESSAGE_ID");
  equal(calls[0].body.connected_account_id, "acct_mine"); equal(calls[0].body.user_id, "sandy_customer_" + CUSTOMER);
  equal(calls[0].body.arguments.recipient_email, "recipient@example.test");
  equal(calls[0].body.arguments.body, "Exact body");
  equal(new Headers(calls[0].init.headers).get("authorization"), null);
  const repeat = await executeAgentOperation(ctx, "gmail.drafts.confirm_send", args, deps);
  equal(repeat.status, 200); equal(repeat.body.duplicate_prevented, true); equal(calls.length, 2);
  equal(db.tables.sandy_agent_operation_audit[0].principal_kind, "trusted_runtime");
  equal(db.tables.sandy_agent_operation_audit[0].auth_user_id, null);
  equal(db.tables.sandy_connected_gmail_outbox[0].status, "sent");
});

Deno.test("confirmation cannot come from an unrelated prompt or change the draft's tenant", async () => {
  const db = new Db(); db.tables.sandy_agent_tasks[0].user_request = "Please search my inbox";
  let calls = 0; const deps = services(db, (async () => { calls++; return provider(sendReceipt); }) as typeof fetch);
  const ctx = await runtime(db);
  const refused = await executeAgentOperation(ctx, "gmail.drafts.confirm_send", { draft_id: DRAFT, confirmation: "Confirm send " + DRAFT }, deps);
  equal(refused.body.error, "explicit_confirmation_required"); equal(calls, 0);
  db.tables.sandy_connected_gmail_outbox[0].customer_id = FOREIGN;
  const unavailable = await executeAgentOperation(await customer(db), "gmail.drafts.confirm_send", { draft_id: DRAFT, confirmation: "Confirm send " + DRAFT }, deps);
  equal(unavailable.body.ok, false); equal(calls, 0);
});

Deno.test("interrupted send remains uncertain and a later confirmation cannot initiate another provider send", async () => {
  const db = new Db(); let sends = 0;
  const deps = services(db, (async () => { sends++; throw Error("lost sensitive provider response"); }) as typeof fetch);
  const ctx = await customer(db), args = { draft_id: DRAFT, confirmation: "Confirm send " + DRAFT };
  const first = await executeAgentOperation(ctx, "gmail.drafts.confirm_send", args, deps);
  equal(first.body.ok, false); equal(first.body.executed, null); equal(first.body.reconciliation_required, true);
  equal(db.tables.sandy_connected_gmail_outbox[0].status, "sending");
  const second = await executeAgentOperation(ctx, "gmail.drafts.confirm_send", args, deps);
  equal(second.body.ok, false); equal(sends, 1);
  assert(!JSON.stringify(first.body).includes("sensitive provider"));
});

Deno.test("provider acceptance alone is insufficient: wrong Sent Mail recipient/subject stays unknown", async () => {
  const db = new Db(); let count = 0;
  const wrong = clone(verifiedReceipt); wrong.data.payload.headers[0].value = "Different subject";
  const deps = services(db, (async () => provider(++count === 1 ? sendReceipt : wrong)) as typeof fetch);
  const ctx = await customer(db), args = { draft_id: DRAFT, confirmation: "Confirm send " + DRAFT };
  const result = await executeAgentOperation(ctx, "gmail.drafts.confirm_send", args, deps);
  equal(result.body.ok, false); equal(result.body.executed, null); equal(db.tables.sandy_connected_gmail_outbox[0].status, "sending");
  await executeAgentOperation(ctx, "gmail.drafts.confirm_send", args, deps);
  equal(count, 3); // one send total; the second confirmation only reads the existing message ID
});

Deno.test("draft preparation idempotency returns the saved result; changed scope and interrupted claims fail closed", async () => {
  const db = new Db(), ctx = await customer(db), deps = services(db);
  const args = { to: "recipient@example.test", subject: "Subject", body: "Body", idempotency_key: "draft-test-123" };
  const first = await executeAgentOperation(ctx, "gmail.drafts.prepare", args, deps);
  equal(first.status, 200); equal(first.body.awaiting_confirmation, true);
  const second = await executeAgentOperation(ctx, "gmail.drafts.prepare", args, deps);
  equal(second.body.draft_id, first.body.draft_id); equal(db.tables.sandy_connected_gmail_outbox.length, 2);
  const altered = await executeAgentOperation(ctx, "gmail.drafts.prepare", { ...args, subject: "Changed" }, deps);
  equal(altered.status, 409); equal(altered.body.error, "idempotency_scope_mismatch");
  db.tables.sandy_agent_operation_audit[0].state = "started";
  const interrupted = await executeAgentOperation(ctx, "gmail.drafts.prepare", args, deps);
  equal(interrupted.body.executed, null); equal(db.tables.sandy_connected_gmail_outbox.length, 2);
});

Deno.test("fixed Gmail search uses actual tenant/workspace binding and rejects malformed 2xx provider envelopes", async () => {
  const db = new Db(), ctx = await customer(db); let called = 0;
  const deps = services(db, (async (url: any, init: RequestInit) => {
    called++; equal(String(url), "https://backend.composio.dev/api/v3/tools/execute/GMAIL_FETCH_EMAILS");
    const body = JSON.parse(String(init.body)); equal(body.connected_account_id, "acct_mine");
    equal(body.user_id, "sandy_customer_" + CUSTOMER); equal(body.arguments.max_results, 10);
    equal(body.arguments.include_payload, true); equal(body.version, "20261015_00");
    return provider({ successful: true });
  }) as typeof fetch);
  const bad = await executeAgentOperation(ctx, "gmail.messages.search", { query: "invoice" }, deps);
  equal(bad.body.ok, false); equal(bad.body.error, "gmail_provider_read_failed"); equal(called, 1);
  const forged = await executeAgentOperation(ctx, "gmail.messages.search", { query: "invoice", customer_id: FOREIGN }, deps);
  equal(forged.status, 400); equal(called, 1);
  const workspace = await executeAgentOperation(ctx, "gmail.messages.search", { query: "invoice", workspace: "Other company" }, deps);
  equal(workspace.body.error, "workspace_not_found"); equal(called, 1);
});

Deno.test("recent inbox deduplicates pages, reports partial provider failure and does not invent missing messages", async () => {
  const db = new Db(), ctx = await runtime(db); let calls = 0;
  const deps = services(db, (async (_url: any, init: RequestInit) => {
    const body = JSON.parse(String(init.body)); equal(body.arguments.query, "in:inbox"); equal(body.arguments.include_payload, false);
    calls++;
    if (calls === 1) return provider({ successful: true, data: { messages: [{ id: "a", subject: "First", sender: "sender@example.test" }], nextPageToken: "page2" } });
    equal(body.arguments.page_token, "page2"); equal(body.arguments.max_results, 2);
    return provider({ successful: false, error: "do not expose provider diagnostics" }, 503);
  }) as typeof fetch);
  const result = await executeAgentOperation(ctx, "gmail.messages.recent", { limit: 3 }, deps);
  equal(result.body.ok, false); equal(result.legacy.details.returned, 1); equal(result.legacy.details.pages, 1);
  assert(result.legacy.response.includes("Retrieved 1 verified messages out of 3")); equal(calls, 2);
  assert(!JSON.stringify(result.body).includes("do not expose provider"));
});

Deno.test("document search derives the verified tenant store and fixed model broker; no arbitrary store/tool/host", async () => {
  const db = new Db(), ctx = await customer(db); let calls = 0;
  const deps = services(db, (async (url: any, init: RequestInit) => {
    calls++; equal(String(url), "https://zmqlyygzqoidkcwdysok.supabase.co/functions/v1/sandy-openai-gateway-v4");
    const body = JSON.parse(String(init.body)); equal(body.tools[0].vector_store_ids, ["vs_mine"]); equal(body.max_output_tokens, 1200);
    equal(new Headers(init.headers).get("x-sandy-integration-token"), "broker-integration-secret");
    return provider({ status: "completed", output: [{ content: [{ type: "output_text", text: "Verified answer", annotations: [{ type: "file_citation", file_id: "file-1", filename: "Mine.pdf" }] }] }] });
  }) as typeof fetch);
  const result = await executeAgentOperation(ctx, "agent.documents.search", { query: "find records", idempotency_key: "document-search-1" }, deps);
  equal(result.status, 200); equal(result.body.citations[0].file_id, "file-1"); equal(calls, 1);
  db.tables.sandy_file_search_stores[0].verified_at = null;
  const denied = await executeAgentOperation(ctx, "agent.documents.search", { query: "find records", idempotency_key: "document-search-2" }, deps);
  equal(denied.body.error, "customer_vector_store_unverified"); equal(denied.body.executed, false); equal(calls, 1);
  const forged = await executeAgentOperation(ctx, "agent.documents.search", { query: "find records", idempotency_key: "document-search-3", vector_store_id: "vs_foreign" }, deps);
  equal(forged.status, 400); equal(calls, 1);
});

Deno.test("model interruption is unknown and same-key replay never incurs a second model request", async () => {
  const db = new Db(), ctx = await customer(db); let calls = 0;
  const deps = services(db, (async () => { calls++; throw Error("connection interrupted"); }) as typeof fetch);
  const args = { goal: "Prepare a bounded plan", idempotency_key: "plan-request-1" };
  const result = await executeAgentOperation(ctx, "agent.execution_plan.draft", args, deps);
  equal(result.body.ok, false); equal(result.body.executed, null); equal(result.body.reconciliation_required, true);
  await executeAgentOperation(ctx, "agent.execution_plan.draft", args, deps); equal(calls, 1);
});

Deno.test("central audit failure prevents provider execution; paid-operation feature flag prevents model execution", async () => {
  const db = new Db(), ctx = await runtime(db); let calls = 0;
  const deps = services(db, (async () => { calls++; return provider({}); }) as typeof fetch);
  db.failAudit = true;
  const refused = await executeRuntimeOperation(ctx, "gmail.messages.search", { query: "test" }, deps, "test-call");
  equal(refused.error, "agent_audit_unavailable"); equal(calls, 0);
  db.failAudit = false; db.tables.sandy_ai_integrations.find((v) => v.integration_key === "openai_agents").enabled = false;
  const disabled = await executeAgentOperation(ctx, "agent.execution_plan.draft", { goal: "Test disabled plan", idempotency_key: "disabled-plan-1" }, deps);
  equal(disabled.body.error, "agent_feature_disabled"); equal(disabled.body.executed, false); equal(calls, 0);
});

Deno.test("API gates unverified writes, forged tenant/body fields, registry drift and project-wide eval ownership", async () => {
  const db = new Db(); let calls = 0;
  const handler = createAgentOperationHandler({ ...services(db, (async () => { calls++; return provider({}); }) as typeof fetch),
    serviceCredential: "worker-secret", auth });
  const draft = { operation: "gmail.drafts.prepare", arguments: { to: "recipient@example.test", subject: "Test", body: "Body", idempotency_key: "api-draft-123" } };
  const disabled = await handler(request(draft)); equal(disabled.status, 403); equal((await disabled.json()).executed, false);
  const record = db.tables.sandy_operation_registry.find((v) => v.operation === draft.operation); record.api_exposed = true;
  const unverified = await handler(request(draft)); equal((await unverified.json()).error, "unverified_mutation_disabled");
  equal((await handler(request({ operation: "gmail.messages.search", arguments: { query: "test" }, customer_id: FOREIGN }))).status, 400);
  const search = db.tables.sandy_operation_registry.find((v) => v.operation === "gmail.messages.search"); search.handler = "forged-handler";
  equal((await handler(request({ operation: search.operation, arguments: { query: "test" } }))).status, 503);
  const evals = await handler(request({ operation: "agent.evaluations.list", arguments: {} }));
  equal(evals.status, 403); equal((await evals.json()).error, "controller_owner_required"); equal(calls, 0);
  equal((await handler(request({ operation: "gmail.messages.search", arguments: { query: "test" } }, "worker-secret"))).status, 401);
});

Deno.test("explicit provider rejection cannot become successful send or be retried", async () => {
  const db = new Db(), ctx = await customer(db); let calls = 0;
  const deps = services(db, (async () => { calls++; return provider({ successful: false, error: "permission denied" }, 403); }) as typeof fetch);
  const args = { draft_id: DRAFT, confirmation: "Confirm send " + DRAFT };
  const result = await executeAgentOperation(ctx, "gmail.drafts.confirm_send", args, deps);
  equal(result.body.ok, false); equal(result.legacy.state, "failed");
  equal(db.tables.sandy_connected_gmail_outbox[0].status, "failed");
  await executeAgentOperation(ctx, "gmail.drafts.confirm_send", args, deps); equal(calls, 1);
});

Deno.test("web research preserves citations; planner is paid generation with executed:false for plan actions", async () => {
  const db = new Db(), ctx = await customer(db); let calls = 0;
  const deps = services(db, (async (_url: any, init: RequestInit) => {
    calls++;
    const body = JSON.parse(String(init.body));
    if (calls === 1) {
      equal(body.tools, [{ type: "web_search_preview" }]); equal(body.max_output_tokens, 1200);
      return provider({ status: "completed", output: [{ content: [{ type: "output_text", text: "Public source answer",
        annotations: [{ type: "url_citation", title: "Source", url: "https://example.test/source" }] }] }] });
    }
    equal(body.max_output_tokens, 800); assert(body.instructions.includes("planning only")); equal(body.tools, undefined);
    return provider({ status: "completed", output: [{ content: [{ type: "output_text", text: "1. Read. 2. Verify." }] }] });
  }) as typeof fetch);
  const web = await executeAgentOperation(ctx, "agent.web.research", { query: "Find current public facts", idempotency_key: "web-request-123" }, deps);
  equal(web.status, 200); equal(web.body.citations, [{ title: "Source", url: "https://example.test/source" }]);
  const plan = await executeAgentOperation(ctx, "agent.execution_plan.draft", { goal: "Draft the verification plan", idempotency_key: "plan-request-123" }, deps);
  equal(plan.status, 200); equal(plan.body.executed, false); equal(plan.body.plan, "1. Read. 2. Verify.");
});

Deno.test("fixed project evaluation listing requires an enabled owner; legacy trusted runtime stays explicitly distinct", async () => {
  const db = new Db(); db.tables.sandy_controller_admins = [{ auth_user_id: USER, role: "owner", enabled: true }];
  const deps = services(db, (async (url: any, init: RequestInit) => {
    equal(String(url), "https://api.openai.com/v1/evals?limit=20");
    equal(new Headers(init.headers).get("authorization"), "Bearer model-only-secret");
    return provider({ data: [{ id: "eval_1", name: "Benchmark", created_at: 1 }] });
  }) as typeof fetch);
  const owner = await executeAgentOperation(await customer(db), "agent.evaluations.list", {}, deps);
  equal(owner.status, 200); equal(owner.body.principal_kind, "auth_user"); equal(owner.body.read_only, true);
  const worker = await executeAgentOperation(await runtime(db), "agent.evaluations.list", {}, deps);
  equal(worker.status, 200); equal(worker.body.principal_kind, "trusted_runtime"); equal(worker.body.task_id, TASK);
});

Deno.test("API schema comparison tolerates JSONB key order but refuses changed contract semantics", async () => {
  const db = new Db();
  const search = db.tables.sandy_operation_registry.find((v) => v.operation === "gmail.messages.search");
  const original = search.input_schema;
  search.input_schema = Object.fromEntries(Object.entries(original).reverse());
  const deps = services(db, (async () => provider({ successful: true, data: { messages: [] } })) as typeof fetch);
  const handler = createAgentOperationHandler({ ...deps, serviceCredential: "worker-secret", auth });
  const ok = await handler(request({ operation: search.operation, arguments: { query: "test" }, channel: "mcp" }));
  equal(ok.status, 200); equal((await ok.json()).principal_kind, "auth_user");
  search.input_schema.additionalProperties = true;
  equal((await handler(request({ operation: search.operation, arguments: { query: "test" } }))).status, 503);
});

Deno.test("agent API bounds actual streamed bytes and rejects corrupt UTF8 before auditing or provider execution", async () => {
  const db = new Db(); let cancelled = false;
  const handler = createAgentOperationHandler({ ...services(db), serviceCredential: "worker-secret", auth });
  const body = new ReadableStream<Uint8Array>({
    pull(controller) { controller.enqueue(new Uint8Array(20000).fill(120)); },
    cancel() { cancelled = true; },
  });
  const oversized = await handler(new Request("https://sandy.example.test/agent", {
    method: "POST", headers: { authorization: "Bearer actual-user-jwt", "content-length": "1" }, body,
  }));
  equal(oversized.status, 413); equal((await oversized.json()).error, "request_too_large");
  assert(cancelled); equal(db.tables.sandy_agent_operation_audit.length, 0);
  const corrupt = await handler(new Request("https://sandy.example.test/agent", {
    method: "POST", headers: { authorization: "Bearer actual-user-jwt" }, body: new Uint8Array([255]),
  }));
  equal(corrupt.status, 400); equal((await corrupt.json()).error, "invalid_json");
  equal(db.tables.sandy_agent_operation_audit.length, 0);
});
