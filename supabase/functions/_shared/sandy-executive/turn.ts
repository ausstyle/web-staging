import { Ajv } from "npm:ajv@8.17.1";

type ObjectValue = Record<string, any>;
export type ModelResponse = ObjectValue & { id: string; output: ObjectValue[] };
export type FunctionTool = {
  type: string;
  name: string;
  parameters: ObjectValue;
};
export type ToolOutput = {
  type: "function_call_output";
  call_id: string;
  output: string;
};
export type TurnState = "answered" | "partial" | "unknown_outcome";
export type TurnResult = {
  state: TurnState;
  text: string;
  reason: string | null;
  rounds: number;
  toolCalls: number;
};
export type TurnDependencies = {
  tools: FunctionTool[];
  invoke: (results?: ToolOutput[]) => Promise<ModelResponse>;
  // This must be the existing authorized Sandy API application boundary. The
  // loop cannot mint principals, resolve arbitrary handlers, or call providers.
  execute: (
    call: { name: string; arguments: string; call_id: string },
  ) => Promise<ObjectValue>;
  maxToolRounds?: number;
  maxToolCalls?: number;
  readOnlyTools?: readonly string[];
  deadline: number;
  now?: () => number;
};
const object = (v: unknown): v is ObjectValue =>
  !!v && typeof v === "object" && !Array.isArray(v);
const canonical = (v: any): string =>
  JSON.stringify(
    v === null || typeof v !== "object"
      ? v
      : Array.isArray(v)
      ? v.map((x) => JSON.parse(canonical(x)))
      : Object.fromEntries(
        Object.keys(v).sort().map((k) => [k, JSON.parse(canonical(v[k]))]),
      ),
  );
const partial =
  "I couldn't finish this request within the current execution limits. Some work may remain; I have not verified completion or scheduled a follow-up.";
const uncertain =
  "I couldn't verify the outcome of this request. An operation may already have run. Please check its recorded status before retrying; I have not started another attempt.";

/** One bounded control loop for the existing executive runtime. Channel adapters
 * supply transport context, while the runtime supplies its offered schemas and
 * its existing authorized operation dispatcher. No second mission ledger, model
 * gateway, or provider executor lives here. Limits never imply task completion.
 */
export async function runExecutiveTurn(
  deps: TurnDependencies,
): Promise<TurnResult> {
  const maxRounds = deps.maxToolRounds ?? 3;
  const maxCalls = deps.maxToolCalls ?? 24;
  const now = deps.now ?? Date.now;
  if (
    !Number.isInteger(maxRounds) || maxRounds < 0 || maxRounds > 3 ||
    !Number.isInteger(maxCalls) || maxCalls < 0 || maxCalls > 200 ||
    !Number.isFinite(deps.deadline)
  ) {
    throw Error("invalid_executive_budget");
  }
  const ajv = new Ajv({ strict: false, allErrors: false, ownProperties: true });
  const schemas = new Map<string, ReturnType<typeof ajv.compile>>();
  for (const tool of deps.tools) {
    if (
      tool.type !== "function" || typeof tool.name !== "string" ||
      schemas.has(tool.name)
    ) {
      throw Error("invalid_executive_tool_catalogue");
    }
    schemas.set(tool.name, ajv.compile(tool.parameters));
  }
  const seenCalls = new Set<string>();
  const seenInputs = new Set<string>();
  const readOnlyTools = new Set(deps.readOnlyTools ?? []);
  if ([...readOnlyTools].some((name) => !schemas.has(name))) {
    throw Error("invalid_executive_read_profile");
  }
  let effectRevision = 0;
  let failedTool = false;
  let pendingTool = false;
  let rounds = 0, toolCalls = 0;
  const finish = (
    state: TurnState,
    reason: string | null,
    text?: string,
  ): TurnResult => ({
    state,
    reason,
    text: text ?? (state === "unknown_outcome" ? uncertain : partial),
    rounds,
    toolCalls,
  });
  let results: ToolOutput[] | undefined;
  for (;;) {
    if (now() >= deps.deadline) return finish("partial", "execution_deadline");
    let response: ModelResponse;
    try {
      response = await deps.invoke(results);
    } catch {
      return finish("unknown_outcome", "model_outcome_unverified");
    }
    // Failed/incomplete Responses can contain both plausible text and calls.
    // Neither is a verified final answer; never dispatch from those envelopes.
    if (
      !object(response) || typeof response.id !== "string" || !response.id ||
      !Array.isArray(response.output) ||
      response.error ||
      (response.status !== undefined && response.status !== "completed")
    ) {
      return finish("partial", "model_response_not_complete");
    }
    const calls = response.output.filter((v) =>
      object(v) && v.type === "function_call"
    );
    if (!calls.length) {
      const text = response.output.flatMap((v) =>
        object(v) && Array.isArray(v.content)
          ? v.content.filter((c: unknown) =>
            object(c) && c.type === "output_text" && typeof c.text === "string"
          ).map((c: ObjectValue) => c.text)
          : []
      ).join("").trim();
      if (pendingTool) {
        return finish(
          "partial",
          "operation_not_finished",
          "The operation is still pending. I have not verified completion. Its existing recorded status should be checked before another attempt.",
        );
      }
      if (failedTool) {
        return finish(
          "partial",
          "tool_returned_error",
          "I couldn't complete this request because a tool returned an error. Any completed work remains recorded; I have not verified the full requested outcome or scheduled a follow-up.",
        );
      }
      return text
        ? finish("answered", null, text)
        : finish("partial", "empty_model_answer");
    }
    if (rounds >= maxRounds || calls.length > maxCalls - toolCalls) {
      return finish("partial", "tool_budget_exhausted");
    }
    // Validate the whole round's identities before any dispatch. A duplicate ID
    // cannot partially execute a batch and then overwrite a previous result.
    const ids = calls.map((c) => c.call_id);
    if (
      ids.some((id) =>
        typeof id !== "string" || id.length < 1 || id.length > 512 ||
        seenCalls.has(id)
      ) ||
      new Set(ids).size !== ids.length
    ) return finish("partial", "invalid_or_replayed_tool_call_id");
    results = [];
    let progress = false;
    for (const call of calls) {
      seenCalls.add(call.call_id);
      if (now() >= deps.deadline) {
        return finish("partial", "execution_deadline");
      }
      let args: unknown;
      try {
        args = typeof call.arguments === "string" &&
            call.arguments.length <= 64 * 1024
          ? JSON.parse(call.arguments)
          : null;
      } catch {
        args = null;
      }
      const schema = schemas.get(call.name);
      let result: ObjectValue;
      if (!schema || !object(args) || !schema(args)) {
        result = { error: "invalid_or_unoffered_tool", executed: false };
      } else {
        // A read-after-write verification needs fresh data. A repeated mutation
        // still has the same intended-effect identity across the entire turn.
        const readOnly = readOnlyTools.has(call.name);
        const input = call.name + ":" + canonical(args) +
          (readOnly ? ":revision:" + effectRevision : "");
        if (seenInputs.has(input)) {
          result = {
            error: "repeated_tool_call_not_executed",
            executed: false,
            reconciliation_required: true,
          };
        } else {
          // Reserve before awaiting: an exception never makes the same intended
          // effect safe to repeat under a fresh provider call ID.
          seenInputs.add(input);
          toolCalls++;
          progress = true;
          try {
            result = await deps.execute({
              name: call.name,
              arguments: call.arguments,
              call_id: call.call_id,
            });
          } catch {
            return finish("unknown_outcome", "tool_outcome_unverified");
          }
          if (!object(result)) {
            return finish("unknown_outcome", "invalid_tool_result");
          }
          if (
            result.reconciliation_required === true ||
            ["unknown", "UNKNOWN_OUTCOME", "uncertain"].includes(result.state)
          ) {
            return finish(
              "unknown_outcome",
              "tool_outcome_requires_reconciliation",
            );
          }
          if (
            !readOnly && !result.error && result.ok !== false &&
            result.success !== false
          ) effectRevision++;
        }
      }
      let output: string;
      if (result.error || result.ok === false || result.success === false) {
        failedTool = true;
      }
      if (
        [
          "queued",
          "QUEUED",
          "running",
          "RUNNING",
          "WAITING_APPROVAL",
          "WAITING_EXTERNAL",
          "accepted",
          "pending",
        ].includes(result.state) ||
        result.approval_pending === true
      ) pendingTool = true;
      try {
        output = JSON.stringify(result);
      } catch {
        return finish("unknown_outcome", "invalid_tool_result");
      }
      if (output.length > 2 * 1024 * 1024) {
        return finish("partial", "tool_result_size_limit");
      }
      results.push({
        type: "function_call_output",
        call_id: call.call_id,
        output,
      });
    }
    rounds++;
    if (
      !progress &&
      results.every((r) =>
        JSON.parse(r.output).error === "repeated_tool_call_not_executed"
      )
    ) {
      return finish("partial", "no_new_evidence");
    }
  }
}

/** Temporary captured V4 policy for customers outside the server canary. It
 * uses the same bound model operation and authorized dispatcher; it owns no
 * separate identity, state, providers or reasoning engine. Remove only after
 * canary acceptance and a compatibility/rollback window. */
export async function runCompatibilityTurn(
  deps: TurnDependencies,
): Promise<TurnResult> {
  let response = await deps.invoke(), rounds = 0, toolCalls = 0;
  for (; rounds < 3; rounds++) {
    const calls = (response.output || []).filter((v) =>
      v.type === "function_call"
    );
    if (!calls.length) break;
    const results: ToolOutput[] = [];
    for (const call of calls) {
      const result = await deps.execute({
        name: call.name,
        arguments: call.arguments,
        call_id: call.call_id,
      });
      toolCalls++;
      results.push({
        type: "function_call_output",
        call_id: call.call_id,
        output: JSON.stringify(result),
      });
    }
    response = await deps.invoke(results);
  }
  const text = (response.output || []).flatMap((v) =>
    (v.content || []).filter((c: any) => c.type === "output_text").map((
      c: any,
    ) => c.text)
  ).join("").trim();
  return { state: "answered", text, reason: null, rounds, toolCalls };
}
