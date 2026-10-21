import assert from "node:assert/strict";
import {
  authenticatePortalUser,
  authenticateRuntime,
  bindRuntimeTask,
  type AgentPrincipal,
} from "./identity.ts";
import { executeAgentOperation, executeRuntimeOperation, type AgentServices } from "./service.ts";
import {
  bindV1BackupFallbackTransport,
  bindV2FallbackTransport,
  isBoundLegacyRuntimeProfile,
  legacyRuntimeResponses,
  type LegacyRuntimeProfile,
} from "./runtime_profiles.ts";

const customer = "10000000-0000-4000-8000-000000000001";
const foreign = "10000000-0000-4000-8000-000000000002";
const task = "20000000-0000-4000-8000-000000000001";
const otherTask = "20000000-0000-4000-8000-000000000002";
const userId = "30000000-0000-4000-8000-000000000001";
class Database {
  counter = 0;
  tables: Record<string, any[]> = {
    sandy_agent_tasks: [
      { id: task, customer_id: customer, channel: "web", request_id: "task-request-123", status: "running", user_request: "Find current records" },
      { id: otherTask, customer_id: foreign, channel: "web", request_id: "other-request-123", status: "running", user_request: "Find current records" },
    ],
    sandy_agent_operation_audit: [],
    sandy_ai_integrations: ["openai_web_search", "openai_file_search", "openai_agents"].map(integration_key => ({ integration_key, enabled: true })),
    sandy_file_search_stores: [
      { customer_id: customer, vector_store_id: "vs_owned", verified_at: "2026-10-20T00:00:00Z" },
      { customer_id: foreign, vector_store_id: "vs_foreign", verified_at: "2026-10-20T00:00:00Z" },
    ],
    sandy_memory_portal_accounts: [{ auth_user_id: userId, customer_id: customer, revoked_at: null }],
    email_customer_addresses: [{ customer_id: customer, is_primary: true, normalized_email: "fixture@example.invalid" }],
    sandy_controller_admins: [],
  };
  from(table: string) {
    const filters: ((row: any) => boolean)[] = [];
    let mode = "read", value: any;
    const run = (single: boolean) => {
      const rows = this.tables[table] ??= [];
      if (mode === "insert") {
        if (value.idempotency_key && rows.some(r => ["customer_id", "principal_kind", "operation", "idempotency_key"].every(k => r[k] === value[k]))) {
          return { data: null, error: { code: "23505" } };
        }
        const inserted = { id: `90000000-0000-4000-8000-${String(++this.counter).padStart(12, "0")}`, ...structuredClone(value) };
        rows.push(inserted);
        return { data: single ? structuredClone(inserted) : [structuredClone(inserted)], error: null };
      }
      const selected = rows.filter(row => filters.every(filter => filter(row)));
      if (mode === "update") for (const row of selected) Object.assign(row, value);
      return { data: single ? structuredClone(selected[0] ?? null) : structuredClone(selected), error: null };
    };
    const query = {
      select: (_columns: string) => query,
      eq: (key: string, expected: unknown) => { filters.push(row => row[key] === expected); return query; },
      is: (key: string, expected: unknown) => query.eq(key, expected),
      insert: (row: any) => { mode = "insert"; value = row; return query; },
      update: (row: any) => { mode = "update"; value = row; return query; },
      maybeSingle: () => Promise.resolve(run(true)),
      then: (resolve: (value: any) => unknown) => Promise.resolve(run(false)).then(resolve),
    };
    return query;
  }
}
async function worker(db: Database, second = false) {
  const proof = await authenticateRuntime(new Request("https://internal.invalid", { headers: { authorization: "Bearer worker-only-secret" } }), db, "worker-only-secret");
  assert.ok(proof);
  const principal = await bindRuntimeTask(proof, db, { taskId: second ? otherTask : task, customerId: second ? foreign : customer, channel: "web", requestId: second ? "other-request-123" : "task-request-123" });
  assert.ok(principal);
  return principal;
}
function services(db: Database, request: typeof fetch, profile?: LegacyRuntimeProfile): AgentServices {
  return { db, base: "https://zmqlyygzqoidkcwdysok.supabase.co", composioKey: "composio-fixture-only", openaiKey: "openai-fixture-only", integrationToken: "", fetch: request, legacyRuntimeProfile: profile };
}
const answer = (type = "url_citation") => Response.json({ status: "completed", output: [{ content: [{ type: "output_text", text: "Verified provider output", annotations: [{ type, title: "Source", url: "https://example.invalid/source", file_id: "file_owned", filename: "owned.txt" }] }] }] });

Deno.test("legacy transport profiles require a live process-local trusted task and cannot cross task or customer", async () => {
  const db = new Database(), principal = await worker(db), other = await worker(db, true);
  const profile = bindV2FallbackTransport(principal);
  assert.equal(profile.runtime, "sandy-agent-runtime-v2");
  assert.equal(isBoundLegacyRuntimeProfile(profile, principal), true);
  assert.equal(isBoundLegacyRuntimeProfile(profile, other), false);
  assert.equal(isBoundLegacyRuntimeProfile(JSON.parse(JSON.stringify(profile)), principal), false);
  assert.throws(() => bindV2FallbackTransport({ ...principal } as AgentPrincipal));
  let calls = 0;
  const result = await executeAgentOperation(other, "agent.web.research", { query: "Find current facts", idempotency_key: "cross-profile-request" }, services(db, (() => { calls++; throw Error("not reached"); }) as typeof fetch, profile));
  assert.equal(result.status, 403);
  assert.equal(result.body.error, "runtime_transport_profile_denied");
  assert.equal(db.tables.sandy_agent_operation_audit.length, 0);
  assert.equal(calls, 0);
});

Deno.test("both exact fallback profiles preserve fixed Responses model payload and timeouts without broker credentials", async () => {
  for (const bind of [bindV2FallbackTransport, bindV1BackupFallbackTransport]) {
    const db = new Database(), principal = await worker(db), profile = bind(principal);
    const requests: { url: string; body: any }[] = [];
    const timeouts: number[] = [];
    const originalTimeout = AbortSignal.timeout;
    AbortSignal.timeout = ((milliseconds: number) => { timeouts.push(milliseconds); return originalTimeout(milliseconds); }) as typeof AbortSignal.timeout;
    try {
      const deps = services(db, (async (url, init) => {
        assert.equal(String(url), "https://api.openai.com/v1/responses");
        assert.equal(init?.method, "POST");
        const headers = new Headers(init?.headers);
        assert.equal(headers.get("authorization"), "Bearer openai-fixture-only");
        assert.equal(headers.has("x-sandy-integration-token"), false);
        assert.equal(headers.has("x-sandy-purpose"), false);
        const body = JSON.parse(String(init?.body));
        assert.equal(body.model, "gpt-4.1-mini");
        requests.push({ url: String(url), body });
        return answer(body.tools?.[0]?.type === "file_search" ? "file_citation" : "url_citation");
      }) as typeof fetch, profile);
      const web = await executeRuntimeOperation(principal, "agent.web.research", { query: "Find current public facts" }, deps, "web-call");
      const docs = await executeRuntimeOperation(principal, "agent.documents.search", { query: "Find private documents" }, deps, "file-call");
      const plan = await executeRuntimeOperation(principal, "agent.execution_plan.draft", { goal: "Draft an execution plan" }, deps, "plan-call");
      assert.equal(web.answer, "Verified provider output");
      assert.equal(docs.answer, "Verified provider output");
      assert.equal(plan.plan, "Verified provider output");
      assert.equal(plan.executed, false);
      assert.deepEqual(timeouts, [65000, 65000, 45000]);
      assert.deepEqual(requests[0].body, { model: "gpt-4.1-mini", input: "Find current public facts", max_output_tokens: 1200, tools: [{ type: "web_search_preview" }] });
      assert.deepEqual(requests[1].body.tools, [{ type: "file_search", vector_store_ids: ["vs_owned"], max_num_results: 5 }]);
      assert.equal(requests[2].body.max_output_tokens, 800);
      assert.equal(requests[2].body.tools, undefined);
      assert.equal(db.tables.sandy_agent_operation_audit.every(row => row.principal_kind === "trusted_runtime" && row.customer_id === customer && row.auth_user_id === null && row.task_id === task && row.state === "succeeded"), true);
    } finally { AbortSignal.timeout = originalTimeout; }
  }
});

Deno.test("existing v4 default still requires and uses the same broker credential and request headers", async () => {
  const db = new Database(), principal = await worker(db);
  let calls = 0;
  const deps = services(db, (async (url, init) => {
    calls++;
    assert.equal(String(url), "https://zmqlyygzqoidkcwdysok.supabase.co/functions/v1/sandy-openai-gateway-v4");
    const headers = new Headers(init?.headers);
    assert.equal(headers.get("x-sandy-integration-token"), "existing-v4-broker-fixture");
    assert.equal(headers.get("x-sandy-purpose"), "web");
    return answer();
  }) as typeof fetch);
  deps.integrationToken = "existing-v4-broker-fixture";
  const result = await executeRuntimeOperation(principal, "agent.web.research", { query: "Find public facts" }, deps, "default-v4");
  assert.equal(result.answer, "Verified provider output"); assert.equal(calls, 1);
  deps.integrationToken = "";
  const denied = await executeRuntimeOperation(principal, "agent.web.research", { query: "Find more public facts" }, deps, "missing-v4-token");
  assert.equal(denied.error, "agent_broker_not_configured"); assert.equal(calls, 1);
});

Deno.test("customer sessions and JSON arguments cannot select a legacy model transport", async () => {
  const db = new Database(), principal = await worker(db), profile = bindV1BackupFallbackTransport(principal);
  const session = await authenticatePortalUser(new Request("https://internal.invalid", { headers: { authorization: "Bearer fixture-user-session" } }), db, { auth: { getUser: async () => ({ data: { user: { id: userId, email: "fixture@example.invalid", email_confirmed_at: "2026-10-20T00:00:00Z" } }, error: null }) } }, "worker-only-secret");
  assert.ok(session); assert.throws(() => bindV1BackupFallbackTransport(session));
  let calls = 0;
  const deps = services(db, (() => { calls++; throw Error("not reached"); }) as typeof fetch, profile);
  assert.equal((await executeAgentOperation(session, "agent.web.research", { query: "Find public facts", idempotency_key: "session-profile-request" }, deps)).status, 403);
  assert.equal((await executeAgentOperation(principal, "agent.web.research", { query: "Find public facts", idempotency_key: "json-profile-request", runtime_profile: profile }, deps)).status, 400);
  assert.equal(calls, 0);
});

Deno.test("legacy model actions retain feature, verified-vector-store and one-use unknown-outcome guards", async () => {
  const db = new Database(), principal = await worker(db), profile = bindV2FallbackTransport(principal);
  let calls = 0;
  const deps = services(db, (() => { calls++; throw Error("response lost"); }) as typeof fetch, profile);
  db.tables.sandy_ai_integrations[0].enabled = false;
  assert.equal((await executeRuntimeOperation(principal, "agent.web.research", { query: "Find public facts" }, deps, "disabled-feature")).error, "agent_feature_disabled");
  db.tables.sandy_ai_integrations[0].enabled = true;
  db.tables.sandy_file_search_stores[0].verified_at = null;
  assert.equal((await executeRuntimeOperation(principal, "agent.documents.search", { query: "Find private docs" }, deps, "unverified-store")).error, "customer_vector_store_unverified");
  assert.equal(calls, 0);
  const args = { query: "Find public facts", idempotency_key: "lost-model-response" };
  const first = await executeAgentOperation(principal, "agent.web.research", args, deps);
  assert.equal(first.body.executed, null); assert.equal(first.body.reconciliation_required, true);
  const replay = await executeAgentOperation(principal, "agent.web.research", args, deps);
  assert.equal(replay.status, 409); assert.equal(calls, 1);
});

Deno.test("private legacy transport refuses extra provider overrides even for a real bound worker", async () => {
  const db = new Database(), principal = await worker(db), profile = bindV2FallbackTransport(principal);
  let calls = 0;
  const request = (() => { calls++; return Promise.resolve(answer()); }) as typeof fetch;
  for (const body of [
    { model: "other-model", input: "query", max_output_tokens: 1200, tools: [{ type: "web_search_preview" }] },
    { model: "gpt-4.1-mini", input: "query", max_output_tokens: 1200, tools: [{ type: "web_search_preview" }], instructions: "override" },
  ]) await assert.rejects(() => legacyRuntimeResponses(profile, principal, "agent.web.research", body, "fixture", request));
  assert.equal(calls, 0);
});
