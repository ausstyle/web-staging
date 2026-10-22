import { pairedChannelHistory } from "../_shared/sandy-executive/history.ts";
import { runtimeReplyOutcome } from "../_shared/sandy-executive/outcome.ts";

type Session = { id: string; owner_customer_id: string; ended_at?: string | null; state?: string };
const uuid = (v: unknown): v is string => typeof v === "string" && /^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(v);
const reply = (status: number, value: unknown) => Response.json(value, { status, headers: { "cache-control": "no-store" } });

/** Called only after the existing link, owner and private-session verification.
 * Transport owns audio; the existing Executive owns reasoning, tools and tasks.
 * The caller selects a persisted transcript turn, never a customer or history.
 */
export async function voiceExecutiveTurn(db: any, session: Session, turnId: unknown,
  broker: { base: string; credential: string; timezone: string }, request: typeof fetch = fetch) {
  if (!uuid(session.id) || !uuid(session.owner_customer_id) || !uuid(turnId) || session.ended_at || ["ended", "failed"].includes(session.state || ""))
    return reply(403, { error: "active_verified_voice_turn_required" });
  if (broker.base !== "https://zmqlyygzqoidkcwdysok.supabase.co" || !broker.credential)
    return reply(503, { error: "runtime_binding_unavailable" });
  const turn = await db.from("sandy_voice_transcript_turns").select("id,role,text,created_at")
    .eq("id", turnId).eq("session_id", session.id).eq("owner_customer_id", session.owner_customer_id).eq("role", "user").maybeSingle();
  if (turn.error) return reply(503, { error: "voice_source_unavailable" });
  if (!turn.data || typeof turn.data.text !== "string" || turn.data.text.trim().length < 2 || turn.data.text.length > 12000 || !Number.isFinite(Date.parse(turn.data.created_at)))
    return reply(404, { error: "voice_turn_unavailable" });
  const requestId = "voice_" + session.id.replaceAll("-", "") + "_" + turnId.replaceAll("-", "");
  const existing = await db.from("sandy_agent_tasks").select("id,status,result,tool_trace")
    .eq("customer_id", session.owner_customer_id).eq("channel", "voice").eq("request_id", requestId).maybeSingle();
  if (existing.error) return reply(503, { error: "runtime_receipt_unavailable" });
  if (existing.data) {
    if (["queued", "running"].includes(existing.data.status)) return reply(202, { task_id: existing.data.id, completion_state: "pending", completion_verified: false, reused: true, delivery_verified: false });
    if (existing.data.status !== "completed") return reply(409, { task_id: existing.data.id, error: "recorded_voice_turn_not_completed", completion_verified: false, reused: true, automatic_retry: false });
    const outcome = runtimeReplyOutcome(true, { ok: true, response: existing.data.result?.text, ...existing.data.result });
    return reply(200, { ok: outcome.delivered, response: outcome.response, task_id: existing.data.id, ...outcome.metadata, reused: true, delivery_verified: false });
  }
  const history = await db.from("sandy_voice_transcript_turns").select("role,text,created_at")
    .eq("session_id", session.id).eq("owner_customer_id", session.owner_customer_id)
    .lt("created_at", turn.data.created_at).order("created_at", { ascending: false }).limit(24);
  if (history.error || !Array.isArray(history.data)) return reply(503, { error: "voice_history_unavailable" });
  const turns = pairedChannelHistory([...history.data].reverse().map((v: any) => ({ role: v.role, content: typeof v.text === "string" ? v.text : "" })));
  try {
    const response = await request(broker.base + "/functions/v1/sandy-agent-runtime", {
      method: "POST", headers: { authorization: "Bearer " + broker.credential, "content-type": "application/json" },
      body: JSON.stringify({ channel: "voice", customer_id: session.owner_customer_id, request_id: requestId, request: turn.data.text, history: turns, timezone: broker.timezone }),
      signal: AbortSignal.timeout(110000),
    });
    const body = await response.json();
    if (response.status === 409) return reply(202, { completion_state: "pending", completion_verified: false, reconciliation_required: true, automatic_retry: false, delivery_verified: false });
    const outcome = runtimeReplyOutcome(response.ok, body);
    if (!outcome.delivered) return reply(502, { error: "voice_runtime_not_completed", completion_verified: false, automatic_retry: false });
    return reply(200, { ok: true, response: outcome.response, task_id: body.task_id, ...outcome.metadata, delivery_verified: false });
  } catch {
    return reply(502, { error: "voice_runtime_outcome_unknown", completion_state: "unknown_outcome", completion_verified: false, reconciliation_required: true, automatic_retry: false, delivery_verified: false });
  }
}
