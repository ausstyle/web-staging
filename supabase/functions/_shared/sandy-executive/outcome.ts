type Value = Record<string, any>;
type ReplyOutcome = {
  delivered: boolean;
  response: string | null;
  recordStatus: "completed" | "failed";
  metadata: {
    completion_state?: "answered" | "partial" | "unknown_outcome";
    completion_verified?: boolean;
    continuation_scheduled?: false;
  };
};
const object = (value: unknown): value is Value =>
  value !== null && typeof value === "object" && !Array.isArray(value);

/** A send confirmation skips the model loop, but still needs the existing
 * executor's independently verified Sent Mail receipt. This does not authorize
 * or dispatch anything and never retries a send. */
export function confirmationOutcome(value: unknown) {
  const receipt = object(value) ? value : {};
  const verified = receipt.state === "sent" && receipt.success === true &&
    receipt.sent_mail_verified === true && !receipt.error && receipt.ok !== false &&
    receipt.reconciliation_required !== true &&
    typeof receipt.message_id === "string" && /^[a-f0-9]{8,64}$/i.test(receipt.message_id) &&
    typeof receipt.text === "string" && !!receipt.text.trim();
  if (verified) return {
    state: "answered" as const, verified: true, text: receipt.text as string,
    reason: null,
  };
  const refused = ["unavailable", "invalid_draft", "connection_unavailable", "failed", "cancelled", "canceled"].includes(receipt.state);
  const uncertain = receipt.reconciliation_required === true || !refused;
  return {
    state: uncertain ? "unknown_outcome" as const : "partial" as const,
    verified: false,
    text: uncertain
      ? "I couldn't verify this email's send result. It may already have been sent. I have not started another attempt; check the existing draft's recorded status before retrying."
      : "I couldn't complete this send request. No new send is verified. Review the draft's recorded status and the connected account before trying again.",
    reason: uncertain ? "gmail_send_outcome_unverified" : "gmail_send_not_completed",
  };
}

/** HTTP success describes delivery of a reply, not completion of the objective.
 * Legacy responses keep their original shape. Explicit runtime outcome metadata
 * survives the web adapter; partial answers remain available to follow-ups. */
export function runtimeReplyOutcome(httpOk: boolean, value: unknown): ReplyOutcome {
  const payload = object(value) ? value : {};
  const delivered = httpOk && payload.ok === true && typeof payload.response === "string" && !!payload.response.trim();
  const explicit = Object.hasOwn(payload, "completion_state");
  const valid = ["answered", "partial", "unknown_outcome"].includes(payload.completion_state);
  const state = explicit && valid ? payload.completion_state : "unknown_outcome";
  const response = explicit && !valid
    ? "I couldn't verify the runtime's final outcome. Check the recorded task before retrying."
    : delivered ? payload.response as string : null;
  return {
    delivered,
    response,
    recordStatus: delivered && (!explicit || state === "answered") ? "completed" : "failed",
    metadata: explicit ? {
      completion_state: state,
      completion_verified: state === "answered" && payload.completion_verified === true,
      ...(payload.continuation_scheduled === false ? { continuation_scheduled: false } : {}),
    } : {},
  };
}
