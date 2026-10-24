import { isRuntimeConversationTask, type RuntimeConversationTask } from "./identity.ts";

// Exact active entrypoint bytes independently read from Runtime35. This pin
// identifies sandy-agent-runtime-v4/index.ts, not the entire ESZIP bundle or its
// imported modules. The release manifest independently pins every bundled module.
// Numeric deployment revisions may change after secret-only configuration edits.
export const v4RuntimeConversationSource = Object.freeze({
  runtime: "sandy-agent-runtime-v4" as const,
  sourceSha256: "f4f15732b13e21d9fbd76de8173aac71672e4a5a49e8d17baf0884abe967f796",
  toolSchemaSha256: "3a6f4b1d9e3a600739d68013842bf119ec65e11f87fb4a308733befe4bbd2d6b",
  // Reuse the exact restricted profile reviewed in PR #212. Selection comes
  // from the persisted task capability, never a caller-selected tool subset.
  readOnlyToolSchemaSha256: "b828d6b1747cbdf6036f0d749283d9f42c8b3d01947b7d83747b166347d2a633",
});
export type V4ConversationBroker = {
  base: string;
  serviceCredential: string;
  integrationToken: string;
};

/** Server-only transport for the governed conversation service, never an HTTP
 * selector. The runtime automation credential authenticates the existing broker
 * call; it is not an Auth-user session or a substitute customer identity. The
 * caller must first claim the actual task/round through executeRuntimeConversation.
 */
export function fixedV4ConversationBroker(
  task: RuntimeConversationTask,
  body: Record<string, unknown>,
  broker: V4ConversationBroker,
  request: typeof fetch,
): Promise<Response> {
  if (!isRuntimeConversationTask(task)) throw Error("runtime_conversation_task_required");
  if (broker.base !== "https://zmqlyygzqoidkcwdysok.supabase.co" || !broker.serviceCredential) {
    throw Error("runtime_conversation_v4_broker_binding_invalid");
  }
  return request(broker.base + "/functions/v1/sandy-openai-gateway-v4", {
    method: "POST",
    headers: {
      "x-sandy-integration-token": broker.integrationToken,
      "x-sandy-purpose": "web",
      "x-sandy-task": task.requestText.replace(/[^\x20-\x7E]/g, " ").slice(0, 240),
      authorization: "Bearer " + broker.serviceCredential,
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(100000),
  });
}
