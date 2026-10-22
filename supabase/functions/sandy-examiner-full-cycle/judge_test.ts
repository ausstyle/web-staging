import assert from "node:assert/strict";
import { judgePilotAnswer } from "./judge.ts";
import { fixedExaminerGateway } from "../_shared/sandy-agent-operations/examiner_gateway_transport.ts";

const broker = { base: "https://zmqlyygzqoidkcwdysok.supabase.co", serviceCredential: "test-service-only" };
const verdict = { verdict: "pass", score: 4, reason: "Supported by the supplied independent evidence." };
const envelope = (result: unknown = verdict) => ({ status: "completed", output: [{ content: [{ type: "output_text", text: JSON.stringify(result) }] }] });

Deno.test("judge uses the existing service gateway authentication without an optional integration binding or provider key", async () => {
  let calls = 0;
  const answer = await judgePilotAnswer("Question", "Actual answer", "synthetic", broker, async (url, init) => {
    calls++;
    assert.equal(url, broker.base + "/functions/v1/sandy-openai-gateway-v4");
    const headers = new Headers(init?.headers);
    assert.equal(headers.get("authorization"), "Bearer test-service-only");
    assert.equal(headers.get("x-sandy-purpose"), "examiner");
    assert.equal(headers.has("x-sandy-integration-token"), false);
    assert.equal(String(init?.body).includes("test-service-only"), false);
    const body = JSON.parse(String(init?.body));
    assert.equal(body.model, "gpt-6-astra");
    assert.equal(body.store, false);
    return Response.json(envelope());
  });
  assert.equal(calls, 1);
  assert.deepEqual(answer, verdict);
});
Deno.test("judge receives separately sourced persisted execution evidence without promoting provider verification", async () => {
  const result = await judgePilotAnswer("Task count?", "Two tasks", "synthetic", broker, async (_url, init) => {
    const body = JSON.parse(String(init?.body));
    const input = JSON.parse(body.input[1].content);
    assert.equal(input.execution_evidence.source, "server_persisted_customer_request_task");
    assert.equal(input.execution_evidence.tools[0].count, 2);
    assert.equal(input.execution_evidence.provider_effect_independently_verified, false);
    assert.equal(String(init?.body).includes("private-customer"), false);
    assert.match(body.input[0].content, /needs_review/);
    return Response.json(envelope());
  }, { edgeStatus: 200, taskStatus: "completed", trace: [{ tool: "list_tasks", count: 2, success: true, customer_id: "private-customer" }] });
  assert.deepEqual(result, verdict);
});
for (const status of [401, 403, 404, 422, 429, 500]) {
  Deno.test(`gateway HTTP ${status} remains unscored with no retry or raw error disclosure`, async () => {
    let calls = 0;
    const answer = await judgePilotAnswer("Question", "Actual answer", "synthetic", broker, async () => {
      calls++;
      return new Response("upstream-sensitive-value", { status });
    });
    assert.equal(calls, 1);
    assert.deepEqual(answer, { verdict: "needs_review", score: null, reason: "judge_gateway_http_" + status });
  });
}
for (const patch of [{ status: "incomplete" }, { status: "failed" }, { error: { message: "sensitive" } }, { output: null }]) {
  Deno.test(`plausible judgment cannot pass an incomplete/error envelope: ${JSON.stringify(patch)}`, async () => {
    const answer = await judgePilotAnswer("Question", "Answer", "synthetic", broker, async () => Response.json({ ...envelope(), ...patch }));
    assert.equal(answer.verdict, "needs_review");
    assert.equal(answer.score, null);
  });
}
for (const result of [{ ...verdict, score: 6 }, { ...verdict, score: null }, { ...verdict, verdict: "new_state" }, { ...verdict, reason: "" }]) {
  Deno.test(`malformed result cannot establish a quality pass: ${JSON.stringify(result)}`, async () => {
    const answer = await judgePilotAnswer("Question", "Answer", "synthetic", broker, async () => Response.json(envelope(result)));
    assert.equal(answer.verdict, "needs_review");
  });
}
Deno.test("transport failure is unscored and never retried", async () => {
  let calls = 0;
  const answer = await judgePilotAnswer("Question", "Answer", "synthetic", broker, () => { calls++; throw Error("sensitive-upstream-detail"); });
  assert.equal(calls, 1);
  assert.equal(answer.verdict, "needs_review");
  assert.equal(answer.reason.includes("sensitive"), false);
});
Deno.test("missing answer does not consume a judge call", async () => {
  let calls = 0;
  const answer = await judgePilotAnswer("Question", "", "synthetic", broker, () => { calls++; throw Error(); });
  assert.equal(calls, 0);
  assert.equal(answer.verdict, "needs_review");
});
Deno.test("fixed gateway binding rejects foreign destinations and absent service credentials", () => {
  for (const config of [{ ...broker, base: "https://foreign.invalid" }, { ...broker, serviceCredential: "" }]) {
    assert.throws(() => fixedExaminerGateway({}, config), /binding_invalid/);
  }
});
