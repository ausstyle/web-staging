import assert from "node:assert/strict";
import { confirmationOutcome, runtimeReplyOutcome } from "./outcome.ts";

const sent = {
  state: "sent", success: true, sent_mail_verified: true,
  message_id: "a1234567890bcdef", text: "Sent and verified in Sent Mail.",
};
Deno.test("independently verified Gmail receipt can complete the confirmation", () => {
  const outcome = confirmationOutcome(sent);
  assert.equal(outcome.state, "answered");
  assert.equal(outcome.verified, true);
  const web = runtimeReplyOutcome(true, {
    ok: true, response: outcome.text,
    completion_state: outcome.state, completion_verified: outcome.verified,
  });
  assert.equal(web.recordStatus, "completed");
  assert.equal(web.metadata.completion_verified, true);
});
for (const patch of [
  { state: "unknown" }, { state: "sending" }, { state: "recorded_sent_unverified" },
  { success: false }, { sent_mail_verified: false }, { message_id: null },
  { message_id: "invalid" }, { error: "audit_failed" }, { ok: false },
  { reconciliation_required: true }, { text: "" },
]) {
  Deno.test(`confirmation cannot complete with a missing or conflicting receipt: ${JSON.stringify(patch)}`, () => {
    const outcome = confirmationOutcome({ ...sent, ...patch });
    assert.equal(outcome.state, "unknown_outcome");
    assert.equal(outcome.verified, false);
    assert.notEqual(outcome.text, sent.text);
    const web = runtimeReplyOutcome(true, {
      ok: true, response: outcome.text, completion_state: outcome.state,
      completion_verified: true, // A conflicting flag cannot override uncertainty.
      continuation_scheduled: false,
    });
    assert.equal(web.delivered, true);
    assert.equal(web.recordStatus, "failed");
    assert.equal(web.response, outcome.text);
    assert.deepEqual(web.metadata, {
      completion_state: "unknown_outcome", completion_verified: false,
      continuation_scheduled: false,
    });
  });
}
Deno.test("definitive Gmail refusal is partial and preserves the safe reply", () => {
  for (const state of ["unavailable", "invalid_draft", "connection_unavailable", "failed", "cancelled"]) {
    const outcome = confirmationOutcome({ state, text: "Untrusted completion text." });
    assert.equal(outcome.state, "partial");
    assert.equal(outcome.verified, false);
    const web = runtimeReplyOutcome(true, { ok: true, response: outcome.text, completion_state: outcome.state });
    assert.equal(web.delivered, true);
    assert.equal(web.recordStatus, "failed");
    assert.equal(web.response, outcome.text);
  }
});
Deno.test("missing/malformed send output never counts as a completed send", () => {
  for (const value of [null, undefined, 42, [], {}, { success: true }]) {
    assert.equal(confirmationOutcome(value).state, "unknown_outcome");
  }
});
Deno.test("legacy successful runtime replies retain the response shape", () => {
  assert.deepEqual(runtimeReplyOutcome(true, { ok: true, response: "An ordinary answer." }), {
    delivered: true, response: "An ordinary answer.", recordStatus: "completed", metadata: {},
  });
});
Deno.test("HTTP 200 error, empty or malformed replies fail delivery", () => {
  for (const payload of [{ ok: false, response: "Done." }, { ok: true }, { response: "Done." }, { response: " " }, [], null]) {
    const outcome = runtimeReplyOutcome(true, payload);
    assert.equal(outcome.delivered, false);
    assert.equal(outcome.recordStatus, "failed");
    assert.equal(outcome.response, null);
  }
});
Deno.test("HTTP failure cannot be turned into a successful reply by a body", () => {
  assert.equal(runtimeReplyOutcome(false, { ok: true, response: "Done." }).delivered, false);
});
Deno.test("unknown future completion states fail closed without publishing completion text", () => {
  const outcome = runtimeReplyOutcome(true, {
    ok: true, response: "Everything is done.", completion_state: "new_unrecognized_state",
    completion_verified: true, continuation_scheduled: true,
  });
  assert.equal(outcome.recordStatus, "failed");
  assert.notEqual(outcome.response, "Everything is done.");
  assert.equal(outcome.metadata.completion_verified, false);
  assert.equal(Object.hasOwn(outcome.metadata, "continuation_scheduled"), false);
});
