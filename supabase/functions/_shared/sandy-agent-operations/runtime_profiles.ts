import { type AgentPrincipal, isAgentPrincipal } from "./identity.ts";

/** These are server-side compatibility capabilities, not API arguments. The
 * process-local binding cannot be reconstructed from JSON or an HTTP header. */
export type LegacyRuntimeProfile = Readonly<{
  runtime: "sandy-agent-runtime-v2" | "sandy-agent-runtime-v1-backup-r50";
  originalSourceSha256: string;
}>;
const bindings = new WeakMap<object, AgentPrincipal>();
const sourceHashes = {
  "sandy-agent-runtime-v2": "d4354d6202851117b36b5e507bfecf52b0497524fb260f29c72f124d36986b78",
  "sandy-agent-runtime-v1-backup-r50": "f4bfcd9191660fb4f2784d1e9d30151f204bee5eca096d49d02fa9fe330ab993",
} as const;

function bind(
  principal: AgentPrincipal,
  runtime: LegacyRuntimeProfile["runtime"],
): LegacyRuntimeProfile {
  if (!isAgentPrincipal(principal) || principal.kind !== "trusted_runtime" || !principal.taskId) {
    throw Error("verified_runtime_task_required");
  }
  const profile = Object.freeze({ runtime, originalSourceSha256: sourceHashes[runtime] });
  bindings.set(profile, principal);
  return profile;
}

export const bindV2FallbackTransport = (principal: AgentPrincipal): LegacyRuntimeProfile =>
  bind(principal, "sandy-agent-runtime-v2");
export const bindV1BackupFallbackTransport = (principal: AgentPrincipal): LegacyRuntimeProfile =>
  bind(principal, "sandy-agent-runtime-v1-backup-r50");
export const isBoundLegacyRuntimeProfile = (
  profile: unknown,
  principal: AgentPrincipal,
): profile is LegacyRuntimeProfile =>
  profile !== null && typeof profile === "object" &&
  isAgentPrincipal(principal) && principal.kind === "trusted_runtime" &&
  bindings.get(profile) === principal;

type ResponseOperation = "agent.web.research" | "agent.documents.search" | "agent.execution_plan.draft";
type JsonObject = Record<string, unknown>;
const exact = (value: JsonObject, keys: string[]) =>
  Object.keys(value).length === keys.length && Object.keys(value).every(key => keys.includes(key));
const planningInstructions = "Return a concise plan, dependencies and verification steps. This is planning only; never claim any action was performed.";

/** Preserve the original fallback Responses request and existing OpenAI binding.
 * Tenant lookup, consent/feature flags, output handling and durable claims remain
 * in the shared application service. This function never calls the v4 broker. */
export async function legacyRuntimeResponses(
  profile: LegacyRuntimeProfile,
  principal: AgentPrincipal,
  operation: ResponseOperation,
  body: JsonObject,
  openaiKey: string,
  request: typeof fetch,
): Promise<Response> {
  if (!isBoundLegacyRuntimeProfile(profile, principal)) throw Error("runtime_transport_profile_denied");
  if (!openaiKey || body.model !== "gpt-4.1-mini" || typeof body.input !== "string") {
    throw Error("legacy_response_contract_invalid");
  }
  if (operation === "agent.execution_plan.draft") {
    if (!exact(body, ["model", "input", "max_output_tokens", "instructions"]) ||
      body.max_output_tokens !== 800 || body.instructions !== planningInstructions || body.input.length > 3000) {
      throw Error("legacy_response_contract_invalid");
    }
  } else {
    if (!exact(body, ["model", "input", "max_output_tokens", "tools"]) || body.max_output_tokens !== 1200 ||
      !Array.isArray(body.tools) || body.tools.length !== 1 || !body.tools[0] ||
      typeof body.tools[0] !== "object" || Array.isArray(body.tools[0])) throw Error("legacy_response_contract_invalid");
    const tool = body.tools[0] as JsonObject;
    if (operation === "agent.web.research") {
      if (!exact(tool, ["type"]) || tool.type !== "web_search_preview" || body.input.length > 2000) {
        throw Error("legacy_response_contract_invalid");
      }
    } else if (operation === "agent.documents.search") {
      if (!exact(tool, ["type", "vector_store_ids", "max_num_results"]) || tool.type !== "file_search" ||
        tool.max_num_results !== 5 || !Array.isArray(tool.vector_store_ids) || tool.vector_store_ids.length !== 1 ||
        typeof tool.vector_store_ids[0] !== "string" || !/^vs_[A-Za-z0-9_-]+$/.test(tool.vector_store_ids[0]) ||
        body.input.length > 1000) throw Error("legacy_response_contract_invalid");
    } else throw Error("legacy_response_operation_invalid");
  }
  return request("https://api.openai.com/v1/responses", {
    method: "POST",
    redirect: "error",
    headers: { authorization: "Bearer " + openaiKey, "content-type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(operation === "agent.execution_plan.draft" ? 45000 : 65000),
  });
}
