import assert from "node:assert/strict";
import { assessmentEnvelope, runtimeRequestInput } from "./assessment.ts";
Deno.test("assessment envelope cannot execute on an older runtime or unset read-only mode", () => {
  const message = assessmentEnvelope({ channel: "email", request: "Reply", request_id: "fixture-message", execution_mode: "normal" });
  assert.equal(Object.hasOwn(message, "request"), false);
  assert.equal(Object.hasOwn(message, "request_id"), false);
  assert.equal(runtimeRequestInput(message)?.execution_mode, "read_only_assessment");
  assert.equal(runtimeRequestInput(message)?.channel, "email");
});
Deno.test("normal runtime requests keep their contract and malformed envelopes are rejected", () => {
  const normal = { request: "Hello", channel: "web" }; assert.equal(runtimeRequestInput(normal), normal);
  for (const value of [null, [], "text", { assessment: null }, { assessment: [] }]) assert.equal(runtimeRequestInput(value), null);
});
Deno.test("verified voice envelope rejects legacy dispatch and cannot select another channel",()=>{
  const envelope={verified_voice_turn:{voice_session_id:"session",channel:"web",request:"Continue"}};
  assert.equal(Object.hasOwn(envelope,"request"),false);
  assert.equal(runtimeRequestInput(envelope)?.channel,"voice");
  assert.equal(runtimeRequestInput({verified_voice_turn:{request:"forged"}}),null);
});
