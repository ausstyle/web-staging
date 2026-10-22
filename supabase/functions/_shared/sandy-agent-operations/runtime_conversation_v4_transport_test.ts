import assert from "node:assert/strict";
import { authenticateRuntime, bindRuntimeConversationTask, type RuntimeConversationTask } from "./identity.ts";
import { fixedV4ConversationBroker, v4RuntimeConversationSource } from "./runtime_conversation_v4_transport.ts";

const TASK = "60000000-0000-4000-8000-000000000001";
const CUSTOMER = "61000000-0000-4000-8000-000000000001";
async function actualTask(customer: string | null) {
  const row = { id: TASK, customer_id: customer, channel: "web", request_id: "v4-broker-task-request", status: "running", user_request: "Source-bound request\nwith non-ASCII é and task detail ".repeat(8) };
  const db = { from: () => {
    const query = { select: () => query, eq: () => query, maybeSingle: () => Promise.resolve({ data: row, error: null }) };
    return query;
  } };
  const proof = await authenticateRuntime(new Request("https://internal.invalid", { headers: { authorization: "Bearer fixture-runtime-service" } }), db, "fixture-runtime-service");
  assert.ok(proof);
  const cap = await bindRuntimeConversationTask(proof, db, { taskId: TASK, customerId: customer, channel: "web", requestId: row.request_id });
  assert.ok(cap);
  return cap;
}
Deno.test("v4 conversation profile pins the exact active source and keeps original broker credentials, task header and timeout", async () => {
  assert.equal(v4RuntimeConversationSource.sourceSha256, "3aadfb520f651e9a6807cbb24b5d4409fcfbb25fb69fe5d72036916e44db8679");
  for (const customer of [CUSTOMER, null]) {
    const task = await actualTask(customer), payload = { model: "gpt-5.2", instructions: "Original server instructions", tools: [], input: task.requestText, max_output_tokens: 1600 };
    const originalTimeout = AbortSignal.timeout;
    let timeout = 0, calls = 0;
    AbortSignal.timeout = ((ms: number) => { timeout = ms; return originalTimeout(ms); }) as typeof AbortSignal.timeout;
    try {
      const result = await fixedV4ConversationBroker(task, payload, { base: "https://zmqlyygzqoidkcwdysok.supabase.co", serviceCredential: "fixture-runtime-service", integrationToken: "fixture-original-broker-token" }, (async (url, init) => {
        calls++;
        assert.equal(String(url), "https://zmqlyygzqoidkcwdysok.supabase.co/functions/v1/sandy-openai-gateway-v4");
        assert.equal(init?.method, "POST"); assert.equal(init?.redirect, undefined);
        const headers = new Headers(init?.headers);
        assert.equal(headers.get("authorization"), "Bearer fixture-runtime-service");
        assert.equal(headers.get("x-sandy-integration-token"), "fixture-original-broker-token");
        assert.equal(headers.get("x-sandy-purpose"), "web");
        assert.equal(headers.get("x-sandy-task"), task.requestText.replace(/[^\x20-\x7E]/g, " ").slice(0, 240));
        assert.deepEqual(JSON.parse(String(init?.body)), payload);
        return Response.json({ id: "resp_fixture", output: [] });
      }) as typeof fetch);
      assert.equal(result.status, 200); assert.equal(timeout, 100000); assert.equal(calls, 1);
    } finally { AbortSignal.timeout = originalTimeout; }
  }
});
Deno.test("v4 broker transport refuses serialized capabilities, customer-shaped identities and alternate hosts before provider request", async () => {
  const task = await actualTask(CUSTOMER), broker = { base: "https://zmqlyygzqoidkcwdysok.supabase.co", serviceCredential: "fixture-runtime-service", integrationToken: "fixture-original-broker-token" };
  const request = (() => { throw Error("provider must not be reached"); }) as typeof fetch;
  assert.throws(() => fixedV4ConversationBroker(JSON.parse(JSON.stringify(task)), {}, broker, request), /task_required/);
  assert.throws(() => fixedV4ConversationBroker({ ...task, kind: "auth_user" } as unknown as RuntimeConversationTask, {}, broker, request), /task_required/);
  assert.throws(() => fixedV4ConversationBroker(task, {}, { ...broker, base: "https://attacker.invalid" }, request), /binding_invalid/);
});
