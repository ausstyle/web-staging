import { validGmailDraft } from "../sandy-agent-operations/connected-gmail.ts";
type Draft = { draft_id: string; to: string; subject: string; body: string };
/** Render the existing API's saved draft, never a proposed model argument.
 * Authorization, persistence, target selection and sending stay in Sandy API. */
export function pendingGmailDraft(
  tool: string,
  value: Record<string, any>,
): Draft | null {
  if (
    tool !== "prepare_gmail_message" || value.ok !== true ||
    value.awaiting_confirmation !== true || value.error ||
    typeof value.draft_id !== "string" ||
    !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(
      value.draft_id,
    ) ||
    ![value.to, value.subject, value.body].every((part) =>
      typeof part === "string"
    ) ||
    !validGmailDraft(value.to, value.subject, value.body)
  ) return null;
  return {
    draft_id: value.draft_id,
    to: value.to,
    subject: value.subject,
    body: value.body,
  };
}
export function pendingGmailReply(drafts: Draft[]): string | null {
  if (!drafts.length) return null;
  if (drafts.length === 1) {
    const draft = drafts[0];
    return "Gmail draft prepared; it has not been sent.\nTo: " + draft.to +
      "\nSubject: " + draft.subject + "\n\nDraft body:\n" + draft.body +
      "\n\nTo send this exact draft, reply: Confirm send " + draft.draft_id +
      ". Other requested work, if any, remains unverified.";
  }
  return "These Gmail drafts are prepared and have not been sent. Review each saved draft before confirming its exact ID:\n" +
    drafts.map((draft) =>
      draft.draft_id + " — " + draft.to + ": " + draft.subject
    ).join("\n") +
    "\nOther requested work, if any, remains unverified.";
}
