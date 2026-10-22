import assert from "node:assert/strict";
import { emailCandidateOutcome } from "./outcome.ts";

Deno.test("an ordinary shadow answer remains a comparison candidate", () => {
  assert.deepEqual(emailCandidateOutcome(true, { ok: true, response: "A draft answer." }), {
    ready: true, candidate: "A draft answer.", completion: {},
  });
});
for (const state of ["partial", "unknown_outcome", "new_unrecognized_state"]) {
  Deno.test(`HTTP 200 ${state} cannot become a ready email candidate`, () => {
    const result = emailCandidateOutcome(true, { ok: true, response: "Unfinished work.",
      completion_state: state, completion_verified: true, continuation_scheduled: false });
    assert.equal(result.ready, false);
    assert.equal(result.completion.completion_verified, false);
    assert.equal(result.completion.continuation_scheduled, false);
  });
}
Deno.test("pending Gmail confirmation remains visible without implying delivery", () => {
  const result = emailCandidateOutcome(true, { ok: true, completion_state: "partial",
    response: "Draft saved. Confirm send 310caa46-8726-4d88-bbd0-7363491a2a1c. Nothing sent." });
  assert.equal(result.ready, false);
  assert.match(result.candidate!, /Confirm send/);
});
Deno.test("HTTP failure, absent output and error bodies do not produce a candidate", () => {
  for (const [ok, payload] of [[false, { ok: true, response: "Done." }], [true, {}], [true, { ok: false }], [true, null]] as const) {
    const result = emailCandidateOutcome(ok, payload);
    assert.equal(result.ready, false);
    assert.equal(result.candidate, null);
  }
});
