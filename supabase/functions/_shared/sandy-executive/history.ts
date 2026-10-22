type Turn = { user: string; assistant: string };
/** Only authenticated server adapters may supply history. Caller-supplied roles,
 * system prompts, identities and scopes are never imported into model messages.
 * Channel adapters remain responsible for verified source ownership/consent.
 */
export function normalizeRuntimeHistory(
  value: unknown,
  trustedServiceCaller: boolean,
): Turn[] {
  if (!trustedServiceCaller || !Array.isArray(value)) return [];
  return value.slice(-12).filter((v): v is Turn =>
    v !== null && typeof v === "object" &&
    typeof v.user === "string" && typeof v.assistant === "string"
  )
    .map((v) => ({
      user: v.user.slice(0, 3000),
      assistant: v.assistant.slice(0, 4500),
    }));
}

/** Adapt an already authorized chronological transport history. Skip incomplete
 * exchanges and preserve adjacent same-role messages without inventing replies.
 */
export function pairedChannelHistory(
  messages: { role: string; content: string }[],
): Turn[] {
  const turns: Turn[] = [];
  let user = "", assistant = "";
  for (const message of messages) {
    if (message.role === "user") {
      if (user && assistant) {
        turns.push({ user, assistant });
        user = "";
        assistant = "";
      }
      user += (user ? "\n" : "") + message.content;
    } else if (message.role === "assistant" && user) {
      assistant += (assistant ? "\n" : "") + message.content;
    }
  }
  if (user && assistant) turns.push({ user, assistant });
  return normalizeRuntimeHistory(turns, true);
}
