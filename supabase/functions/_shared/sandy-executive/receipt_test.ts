import assert from "node:assert/strict";
import { type ModelResponse, runExecutiveTurn } from "./turn.ts";
import { classifyToolReceipt } from "./receipt.ts";
import { pendingGmailDraft, pendingGmailReply } from "./pending_reply.ts";

const tools = ["read", "write"].map((name) => ({
  type: "function",
  name,
  parameters: {
    type: "object",
    properties: { target: { type: "string" } },
    required: ["target"],
    additionalProperties: false,
  },
}));
const call = (name: string, call_id: string) => ({
  type: "function_call",
  name,
  call_id,
  arguments: JSON.stringify({
    target: name === "read" ? "same_record" : call_id,
  }),
});
const response = (output: any[]): ModelResponse => ({
  id: "response_fixture",
  status: "completed",
  output,
});
const final = response([{
  type: "message",
  content: [{ type: "output_text", text: "Everything is complete." }],
}]);
async function exercise(receipt: any, extra: Record<string, any> = {}) {
  const executed: string[] = [], outputs: any[] = [];
  let invocation = 0;
  const result = await runExecutiveTurn({
    tools,
    readOnlyTools: ["read"],
    deadline: 1000,
    now: () => 0,
    invoke: async (results) => {
      outputs.push(results);
      return invocation++ === 0 ? response([call("write", "first")]) : final;
    },
    execute: async (c) => {
      executed.push(c.call_id);
      return receipt;
    },
    ...extra,
  });
  return { result, executed, outputs };
}
for (
  const state of [
    "VERIFIED_FAILURE",
    "failed",
    "CANCELLED",
    "PARTIAL",
    "waiting_approval",
    "WAITING_EXTERNAL",
    "PROPOSED",
  ]
) {
  Deno.test(`canonical receipt ${state} cannot be overwritten by a fluent completion`, async () => {
    const observed = await exercise({ state, ok: true });
    assert.equal(observed.result.state, "partial");
    assert.notEqual(observed.result.text, "Everything is complete.");
  });
}
for (
  const receipt of [
    { state: "sending" },
    { state: "recorded_sent_unverified" },
    { state: "future_unknown_state" },
    { executed: null, error: "connection_lost" },
  ]
) {
  Deno.test(`unresolved receipt ${JSON.stringify(receipt)} stops before continuation`, async () => {
    const observed = await exercise(receipt);
    assert.equal(observed.result.state, "unknown_outcome");
    assert.equal(observed.outputs.length, 1);
    assert.equal(observed.executed.length, 1);
  });
}
Deno.test("admission without a verified outcome is pending even without a state field", async () => {
  const observed = await exercise({ accepted: true, job_id: "existing-job" });
  assert.equal(observed.result.state, "partial");
  assert.notEqual(observed.result.text, "Everything is complete.");
});
for (
  const receipt of [{ state: "QUEUED" }, { state: "VERIFIED_FAILURE" }, {
    state: "PARTIAL",
  }]
) {
  Deno.test(`unsettled precondition ${receipt.state} fences later writes in the same batch and later rounds`, async () => {
    let invocation = 0;
    const observed = await exercise(receipt, {
      invoke: async () =>
        invocation++ === 0
          ? response([call("write", "first"), call("write", "second")])
          : invocation === 2
          ? response([call("write", "third")])
          : final,
    });
    assert.deepEqual(observed.executed, ["first"]);
    assert.equal(observed.result.state, "partial");
  });
}
Deno.test("an unresolved mutation permits a fresh readback but never a second mutation", async () => {
  const executed: string[] = [];
  let invocation = 0;
  const observed = await exercise({}, {
    invoke: async () =>
      [
        response([call("read", "before")]),
        response([call("write", "queue")]),
        response([call("read", "after"), call("write", "unsafe")]),
        final,
      ][invocation++],
    execute: async (c: any) => {
      executed.push(c.call_id);
      return c.name === "write"
        ? { state: "QUEUED", accepted: true }
        : { records: [] };
    },
  });
  assert.deepEqual(executed, ["before", "queue", "after"]);
  assert.equal(observed.result.state, "partial");
});
Deno.test("an expired deadline cannot publish a late model answer", async () => {
  let now = 0;
  const observed = await exercise({}, {
    now: () => now,
    invoke: async () => {
      now = 1000;
      return final;
    },
  });
  assert.equal(observed.result.state, "partial");
  assert.equal(observed.result.reason, "execution_deadline");
  assert.notEqual(observed.result.text, "Everything is complete.");
});
Deno.test("every SC-04 truth state has an explicit disposition", () => {
  for (
    const state of [
      "PROPOSED",
      "QUEUED",
      "RUNNING",
      "WAITING_APPROVAL",
      "WAITING_EXTERNAL",
    ]
  ) {
    assert.equal(classifyToolReceipt({ state }), "pending");
    assert.equal(
      classifyToolReceipt({ state: state.toLowerCase() }),
      "pending",
    );
  }
  for (const state of ["VERIFIED_FAILURE", "CANCELLED"]) {
    assert.equal(classifyToolReceipt({ state }), "failed");
  }
  assert.equal(classifyToolReceipt({ state: "PARTIAL" }), "partial");
  assert.equal(classifyToolReceipt({ state: "UNKNOWN_OUTCOME" }), "unknown");
  assert.equal(
    classifyToolReceipt({ state: "VERIFIED_SUCCESS", accepted: true }),
    "returned",
  );
});
Deno.test("conflicting flags cannot convert unknown, failed or pending receipts to success", () => {
  assert.equal(
    classifyToolReceipt({ state: "VERIFIED_SUCCESS", executed: null }),
    "unknown",
  );
  assert.equal(
    classifyToolReceipt({
      state: "VERIFIED_SUCCESS",
      reconciliation_required: true,
    }),
    "unknown",
  );
  assert.equal(
    classifyToolReceipt({ state: "VERIFIED_SUCCESS", success: false }),
    "failed",
  );
  assert.equal(
    classifyToolReceipt({ state: "VERIFIED_SUCCESS", accepted: false }),
    "failed",
  );
  assert.equal(
    classifyToolReceipt({ state: "VERIFIED_SUCCESS", approval_pending: true }),
    "pending",
  );
  assert.equal(
    classifyToolReceipt({ state: "COMPLETED", requires_client_review: true }),
    "pending",
  );
});
Deno.test("only independently verified legacy Gmail sends are eligible results", () => {
  assert.equal(
    classifyToolReceipt({ state: "sent", success: true }),
    "unknown",
  );
  assert.equal(
    classifyToolReceipt({
      state: "sent",
      success: true,
      sent_mail_verified: true,
      message_id: "a1234567890bcdef",
      text: "Verified in Sent Mail.",
    }),
    "returned",
  );
});
Deno.test("legacy read records and nested domain state do not invent operation states", () => {
  assert.equal(
    classifyToolReceipt({ records: [{ state: "active" }] }),
    "returned",
  );
  assert.equal(
    classifyToolReceipt({ ok: true, draft_id: "fixture" }),
    "returned",
  );
  for (const state of ["", "new_state", 7, {}, []]) {
    assert.equal(classifyToolReceipt({ state }), "unknown");
  }
});
Deno.test("distinct mutations can continue after actual returned results", async () => {
  let invocation = 0;
  const observed = await exercise({ state: "VERIFIED_SUCCESS" }, {
    invoke: async () =>
      invocation++ === 0
        ? response([call("write", "one"), call("write", "two")])
        : invocation === 2
        ? response([call("write", "three")])
        : final,
  });
  assert.deepEqual(observed.executed, ["one", "two", "three"]);
  assert.equal(observed.result.state, "answered");
});
Deno.test("a prepared Gmail draft retains its exact content and confirmation flow without a false send claim", async () => {
  const draft = {
    ok: true,
    awaiting_confirmation: true,
    draft_id: "30000000-0000-4000-8000-000000000001",
    to: "fixture@example.invalid",
    subject: "Fixture subject",
    body: "Exact draft body for review.",
  };
  let models = 0, operations = 0;
  const outcome = await runExecutiveTurn({
    tools: [{
      type: "function",
      name: "prepare_gmail_message",
      parameters: {
        type: "object",
        properties: {},
        additionalProperties: false,
      },
    }],
    deadline: 1000,
    now: () => 0,
    invoke: async () =>
      models++ === 0
        ? response([{
          type: "function_call",
          name: "prepare_gmail_message",
          arguments: "{}",
          call_id: "draft",
        }])
        : final,
    execute: async () => {
      operations++;
      return draft;
    },
  });
  assert.equal(outcome.state, "partial");
  assert.equal(operations, 1);
  assert.ok(outcome.text.includes(draft.body));
  assert.ok(outcome.text.includes("Confirm send " + draft.draft_id));
  assert.ok(outcome.text.includes("has not been sent"));
  assert.equal(outcome.text.includes("Everything is complete."), false);
});
Deno.test("malformed or unrelated pending outputs cannot invent a saved Gmail draft", () => {
  const draft = {
    ok: true,
    awaiting_confirmation: true,
    draft_id: "30000000-0000-4000-8000-000000000001",
    to: "fixture@example.invalid",
    subject: "Fixture",
    body: "Fixture body",
  };
  assert.equal(pendingGmailDraft("read", draft), null);
  assert.equal(
    pendingGmailDraft("prepare_gmail_message", {
      ...draft,
      draft_id: "not-saved",
    }),
    null,
  );
  assert.equal(
    pendingGmailDraft("prepare_gmail_message", {
      ...draft,
      subject: "Unsafe\nheader",
    }),
    null,
  );
  assert.equal(
    pendingGmailDraft("prepare_gmail_message", { ...draft, ok: false }),
    null,
  );
  assert.equal(pendingGmailReply([]), null);
});
Deno.test("a deadline after saving a draft preserves its confirmation reference without another model call", async () => {
  let now = 0, models = 0;
  const draft = {
    ok: true,
    awaiting_confirmation: true,
    draft_id: "30000000-0000-4000-8000-000000000001",
    to: "fixture@example.invalid",
    subject: "Fixture",
    body: "Saved fixture body",
  };
  const result = await runExecutiveTurn({
    tools: [{
      type: "function",
      name: "prepare_gmail_message",
      parameters: {
        type: "object",
        properties: {},
        additionalProperties: false,
      },
    }],
    deadline: 1000,
    now: () => now,
    invoke: async () => {
      models++;
      return response([{
        type: "function_call",
        name: "prepare_gmail_message",
        arguments: "{}",
        call_id: "draft",
      }]);
    },
    execute: async () => {
      now = 1000;
      return draft;
    },
  });
  assert.equal(models, 1);
  assert.equal(result.state, "partial");
  assert.equal(result.reason, "execution_deadline");
  assert.ok(result.text.includes("Confirm send " + draft.draft_id));
  assert.ok(result.text.includes("has not been sent"));
});
