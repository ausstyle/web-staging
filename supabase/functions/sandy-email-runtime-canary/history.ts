import { pairedChannelHistory } from "../_shared/sandy-executive/history.ts";
const uuid = (v: unknown): v is string => typeof v === "string" && /^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(v);

/** The source has already passed the existing QA allowlist. History stays in
 * that customer's conversation; an unsent draft is never an assistant turn.
 */
export async function emailExecutiveHistory(db: any, source: { customer_id: string; conversation_id: string | null; created_at: string }) {
  if (!uuid(source.customer_id)) throw Error("email_history_customer_binding_required");
  if (!source.conversation_id) return [];
  if (!uuid(source.conversation_id) || !Number.isFinite(Date.parse(source.created_at))) throw Error("email_history_source_binding_required");
  const result = await db.from("email_messages")
    .select("direction,body_text,delivery_status,sent_at,provider_message_id,created_at")
    .eq("customer_id", source.customer_id).eq("conversation_id", source.conversation_id)
    .lt("created_at", source.created_at).order("created_at", { ascending: false }).limit(24);
  if (result.error || !Array.isArray(result.data)) throw Error("email_history_unavailable");
  const messages = [...result.data].reverse().flatMap((m: any) => {
    if (typeof m.body_text !== "string") return [];
    if (m.direction === "incoming") return [{ role: "user", content: m.body_text }];
    if (m.direction === "outgoing" && m.delivery_status === "sent" && typeof m.provider_message_id === "string" && m.provider_message_id &&
      Number.isFinite(Date.parse(m.sent_at)) && Date.parse(m.sent_at) < Date.parse(source.created_at)) return [{ role: "assistant", content: m.body_text }];
    return [];
  });
  return pairedChannelHistory(messages);
}
