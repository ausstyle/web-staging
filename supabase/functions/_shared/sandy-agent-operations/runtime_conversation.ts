import { Ajv } from "npm:ajv@8.17.1";
import { fullFormats } from "npm:ajv-formats@3.0.1/dist/formats.js";
import {
  isRuntimeConversationTask,
  type RuntimeConversationTask,
} from "./identity.ts";
import { runtimeConversationContract, runtimeConversationOperation, runtimeConversationVersion } from "./runtime_conversation_contract.ts";
import { fixedRuntimeResponses } from "./runtime_responses_transport.ts";

type Obj = Record<string, any>;
type Runtime = "sandy-agent-runtime-v2" | "sandy-agent-runtime-v1-backup-r50";
type ToolResult = { type: "function_call_output"; call_id: string; output: string };
export type RuntimeConversationArguments = { round: number; tool_results: ToolResult[] };
export type RuntimeConversation = Readonly<{ operation: typeof runtimeConversationOperation; runtime: Runtime; sourceSha256: string }>;
export type ConversationDependencies = { db: any; openaiKey: string; fetch?: typeof fetch };
type Session = {
  task: RuntimeConversationTask;
  initial: Obj;
  nextRound: number;
  previousResponse: string | null;
  pendingCallIds: string[];
  busy: boolean;
  poisoned: boolean;
};
const sessions = new WeakMap<object, Session>();
const profiles = {
  "sandy-agent-runtime-v2": {
    source: "d4354d6202851117b36b5e507bfecf52b0497524fb260f29c72f124d36986b78",
    tools: "ec0bfc54cf598a1e50944a9207be35df32656ba14ca3ccd9c1e82f77dd355b52",
  },
  "sandy-agent-runtime-v1-backup-r50": {
    source: "f4bfcd9191660fb4f2784d1e9d30151f204bee5eca096d49d02fa9fe330ab993",
    tools: "0217409b152fa55babcb907084edc00f93ef82065b4c52d8b7f078224a6b60fb",
  },
} as const;
const object = (v: unknown): v is Obj => !!v && typeof v === "object" && !Array.isArray(v);
const stable = (v: any): string => JSON.stringify(v && typeof v === "object" ?
  (Array.isArray(v) ? v.map(x => JSON.parse(stable(x))) : Object.fromEntries(Object.keys(v).sort().map(k => [k, JSON.parse(stable(v[k]))]))) : v);
const sha256 = async (value: string) => Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)))).map(v => v.toString(16).padStart(2, "0")).join("");
const ajv = new Ajv({ strict: false, formats: fullFormats });
const inputValid = ajv.compile(runtimeConversationContract.input_schema);
const outputValid = ajv.compile(runtimeConversationContract.output_schema);
function initialInputMatches(input: unknown, prompt: string) {
  if (typeof input === "string") return input === prompt;
  if (!Array.isArray(input) || input.length < 1 || input.length > 25 || input.length % 2 !== 1) return false;
  return input.every((item, i) => object(item) && Object.keys(item).length === 2 &&
    item.role === (i % 2 === 0 ? "user" : "assistant") && typeof item.content === "string" &&
    (i === input.length - 1 ? item.content === prompt : item.content.length <= (i % 2 === 0 ? 3000 : 4500)));
}

/** Only fixed server adapters export a constructor. The selected model and
 * instructions are captured from that runtime's existing server policy; neither
 * is accepted by the named operation's JSON input. Tool-schema hashes pin the
 * original source rather than granting a caller an arbitrary tool executor. */
async function bind(task: RuntimeConversationTask, runtime: Runtime, firstRequest: Obj): Promise<RuntimeConversation> {
  if (!isRuntimeConversationTask(task)) throw Error("runtime_conversation_task_required");
  const allowed = ["model", "instructions", "input", "tools", "tool_choice", "max_output_tokens"];
  if (!object(firstRequest) || Object.keys(firstRequest).some(k => !allowed.includes(k)) ||
    typeof firstRequest.model !== "string" || !/^[a-zA-Z0-9_.:-]{1,200}$/.test(firstRequest.model) ||
    typeof firstRequest.instructions !== "string" || firstRequest.instructions.length > 2 * 1024 * 1024 ||
    firstRequest.max_output_tokens !== 1600 || !initialInputMatches(firstRequest.input, task.requestText) ||
    !Array.isArray(firstRequest.tools) || JSON.stringify(firstRequest).length > 4 * 1024 * 1024) {
    throw Error("runtime_conversation_source_contract_invalid");
  }
  if (task.customerId === null ? firstRequest.tools.length !== 0 : await sha256(stable(firstRequest.tools)) !== profiles[runtime].tools) {
    throw Error("runtime_conversation_tool_profile_invalid");
  }
  if (firstRequest.tool_choice !== undefined) {
    const choice = firstRequest.tool_choice;
    if (task.customerId === null || !object(choice) || Object.keys(choice).length !== 2 || choice.type !== "function" ||
      !["search_connected_gmail", "inspect_sandy_operational_state"].includes(choice.name) ||
      !firstRequest.tools.some((tool: Obj) => tool.name === choice.name)) throw Error("runtime_conversation_tool_choice_invalid");
  }
  const capability = Object.freeze({ operation: runtimeConversationOperation, runtime, sourceSha256: profiles[runtime].source });
  sessions.set(capability, { task, initial: structuredClone(firstRequest), nextRound: 0, previousResponse: null, pendingCallIds: [], busy: false, poisoned: false });
  return capability;
}
export const bindV2RuntimeConversation = (task: RuntimeConversationTask, firstRequest: Obj) => bind(task, "sandy-agent-runtime-v2", firstRequest);
export const bindV1BackupRuntimeConversation = (task: RuntimeConversationTask, firstRequest: Obj) => bind(task, "sandy-agent-runtime-v1-backup-r50", firstRequest);

async function responseJson(response: Response): Promise<Obj | null> {
  const reader = response.body?.getReader();
  if (!reader) return null;
  const parts: Uint8Array[] = []; let size = 0;
  try {
    for (;;) {
      const part = await reader.read();
      if (part.done) break;
      size += part.value.byteLength;
      if (size > 2 * 1024 * 1024) { await reader.cancel(); return null; }
      parts.push(part.value);
    }
    const all = new Uint8Array(size); let offset = 0;
    for (const part of parts) { all.set(part, offset); offset += part.byteLength; }
    const data = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(all));
    return object(data) ? data : null;
  } catch { return null; }
}

/** Named internal application operation. This sends only model requests: it
 * never executes tools. Existing runtime branches retain their exact tool loop.
 * A durable claim precedes every paid round; unknown results cannot be retried. */
export async function executeRuntimeConversation(
  capability: RuntimeConversation,
  args: RuntimeConversationArguments,
  deps: ConversationDependencies,
): Promise<{ status: number; body: Obj }> {
  const denied = (status: number, error: string, executed: boolean | null = false) => ({ status, body: {
    ok: false, operation: runtimeConversationOperation, error, executed, reconciliation_required: executed === null,
  } });
  const session = capability && typeof capability === "object" ? sessions.get(capability) : undefined;
  if (!session || !isRuntimeConversationTask(session.task)) return denied(403, "runtime_conversation_capability_required");
  if (!inputValid(args) || JSON.stringify(args).length > 4 * 1024 * 1024) return denied(400, "invalid_runtime_conversation_arguments");
  if (session.poisoned) return denied(409, "runtime_conversation_outcome_requires_reconciliation", null);
  if (session.busy || args.round !== session.nextRound) return denied(409, "runtime_conversation_round_not_admissible");
  if (args.round === 0 ? args.tool_results.length !== 0 :
    !session.previousResponse || session.pendingCallIds.length === 0 || args.tool_results.length !== session.pendingCallIds.length ||
    new Set(args.tool_results.map(v => v.call_id)).size !== args.tool_results.length ||
    args.tool_results.some(v => !session.pendingCallIds.includes(v.call_id))) return denied(400, "runtime_conversation_tool_results_mismatch");
  if (!deps.openaiKey) return denied(503, "runtime_conversation_provider_not_configured");
  const { task } = session;
  const current = await deps.db.from("sandy_agent_tasks").select("id,customer_id,channel,request_id,status,user_request")
    .eq("id", task.taskId).maybeSingle();
  if (current.error || !current.data || current.data.id !== task.taskId || current.data.customer_id !== task.customerId ||
    current.data.channel !== task.channel || current.data.request_id !== task.requestId ||
    current.data.user_request !== task.requestText || !["queued", "running"].includes(current.data.status)) {
    return denied(403, "runtime_conversation_persisted_task_mismatch");
  }
  const request: Obj = args.round === 0 ? structuredClone(session.initial) : {
    model: session.initial.model, instructions: session.initial.instructions,
    previous_response_id: session.previousResponse, input: structuredClone(args.tool_results),
    tools: structuredClone(session.initial.tools), max_output_tokens: 1600,
  };
  session.busy = true;
  try {
    const claim = await deps.db.from("sandy_runtime_conversation_audit").insert({
      operation: runtimeConversationOperation, contract_version: runtimeConversationVersion,
      principal_kind: "trusted_runtime", auth_user_id: null, customer_id: task.customerId,
      task_id: task.taskId, channel: task.channel, request_id: task.requestId,
      source_runtime: capability.runtime, source_sha256: capability.sourceSha256,
      round: args.round, selected_model: request.model, request_sha256: await sha256(stable(request)), state: "started",
    }).select("id").maybeSingle();
    if (claim.error || !claim.data?.id) return denied(claim.error?.code === "23505" ? 409 : 503,
      claim.error?.code === "23505" ? "runtime_conversation_round_requires_reconciliation" : "runtime_conversation_audit_unavailable");
    let data: Obj | null = null, providerAttempted = false;
    try {
      providerAttempted = true;
      const response = await fixedRuntimeResponses(request, deps.openaiKey, 100000, deps.fetch ?? fetch, false);
      data = await responseJson(response);
      if (!response.ok || !data) data = null;
    } catch { data = null; }
    const body = { ok: true, operation: runtimeConversationOperation, contract_version: runtimeConversationVersion,
      principal_kind: "trusted_runtime", customer_id: task.customerId, task_id: task.taskId,
      round: args.round, selected_model: request.model, response: data };
    const valid = outputValid(body);
    const calls = valid ? data!.output.filter((v: Obj) => v.type === "function_call") : [];
    const callIds = calls.map((v: Obj) => v.call_id);
    const validCalls = callIds.every((id: unknown) => typeof id === "string" && id.length > 0 && id.length <= 512) && new Set(callIds).size === callIds.length;
    // This receipt attests to the received envelope, not model/task completion.
    // Preserve actual status/error fields, including incomplete responses, as
    // the archived fallback wrapper does. No tool is executed here.
    const succeeded = valid && validCalls;
    const finished = await deps.db.from("sandy_runtime_conversation_audit").update({
      state: succeeded ? "succeeded" : providerAttempted ? "unknown" : "failed",
      provider_response_id: succeeded ? data!.id : null,
      response_sha256: succeeded ? await sha256(stable(data)) : null,
      error: succeeded ? null : "runtime_conversation_provider_outcome_unverified",
      finished_at: new Date().toISOString(),
    }).eq("id", claim.data.id).eq("task_id", task.taskId).eq("state", "started").select("id").maybeSingle();
    if (finished.error || !finished.data || !succeeded) {
      session.poisoned = true;
      return denied(502, finished.error || !finished.data ? "runtime_conversation_audit_completion_failed" : "runtime_conversation_provider_outcome_unverified", null);
    }
    session.nextRound++;
    session.previousResponse = data!.id;
    session.pendingCallIds = callIds;
    return { status: 200, body };
  } catch {
    session.poisoned = true;
    return denied(502, "runtime_conversation_operation_interrupted", null);
  } finally { session.busy = false; }
}
